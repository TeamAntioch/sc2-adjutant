// A Mission's voices in Ogg Vorbis (#497): placeholders are .ogg by default, a .wav voice file is
// encoded to .ogg as it goes into the Map Package and an .ogg is copied, a line's voice file may
// be either, and a recording wins over a placeholder. The encoder is a stand-in, the WAV's bytes
// behind an OggS marker, except where ffmpeg itself is the point.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { voiceLengthsMs } from "../../src/cutscene/cinematic.js";
import { cachedDerive, type Derive, ffmpegDerive, ffmpegInstallHint } from "../../src/host/derive.js";
import { bareHost, type Host } from "../../src/host/host.js";
import { emptyMachineConfig } from "../../src/host/machine-config.js";
import { PLACEHOLDER_MANIFEST, silentWav, trimSilence, writePlaceholderVoices } from "../../src/host/placeholder-voices.js";
import { findVoiceFile, findVoiceFiles, packageVoiceFiles, readPlaceholderManifest } from "../../src/host/voice-files.js";
import { compileMission } from "../../src/map/compile-mission.js";
import { missionMapPackage } from "../../src/map/mission-package.js";
import { loadWorkspace, readMissionBlueprint } from "../../src/plugins/workspace.js";
import { readMissionScript, type Script, type ScriptLine } from "../../src/script/name-script.js";
import { copyOf, tempFolder } from "../mcp/harness.js";

/** The .wav → .ogg step, as a stand-in, recording each WAV it was given. */
function standIn(given: Buffer[] = []): Derive {
  return async (step, input) => {
    if (step !== "wav-to-ogg") throw new Error(`no step ${step}`);
    given.push(input);
    return Buffer.concat([Buffer.from("OggS "), input]);
  };
}

/** A one-line Script, its line's sound `orla-1`. */
const script = (text: string): Script =>
  ({ title: "t", fields: {}, conversationId: "c", scenes: [{ items: [{ kind: "line", speaker: "ORLA", character: "Orla", characterId: "Orla", soundId: "orla-1", lineId: "Line1", text }] }] }) as unknown as Script;
const line = (soundId: string, text = "Hold the line."): ScriptLine => ({ kind: "line", soundId, text }) as unknown as ScriptLine;

/** A 16-bit mono WAV at 22050 Hz: `before` s of silence, then `sound` s of a tone. */
function toneWav(before: number, sound: number): Buffer {
  const wav = silentWav(before + sound);
  for (let i = Math.round(before * 22050); i < Math.round((before + sound) * 22050); i++) wav.writeInt16LE(Math.round(8000 * Math.sin(i / 5)), 44 + i * 2);
  return wav;
}

/** A Host whose `tts.speak` writes `wav`, counting its calls. */
function speaker(wav: Buffer): Host & { readonly calls: () => number } {
  let calls = 0;
  return {
    machine: emptyMachineConfig(),
    adapter: undefined,
    has: (name) => name === "tts.speak",
    run: (async (_name: string, request: { outputPath: string }) => {
      calls++;
      await writeFile(request.outputPath, wav);
    }) as Host["run"],
    calls: () => calls,
  };
}

/** An Ogg page: its granule position and one packet. */
function oggPage(granule: bigint, packet: Buffer): Buffer {
  const header = Buffer.alloc(28);
  header.write("OggS", 0, "ascii");
  header.writeBigInt64LE(granule, 6);
  header[26] = 1;
  header[27] = packet.length;
  return Buffer.concat([header, packet]);
}

/** A minimal Ogg Vorbis file `ms` long at 22050 Hz: the identification header, then a last page at its sample count. */
function oggOf(ms: number): Buffer {
  const id = Buffer.alloc(30);
  id[0] = 1;
  id.write("vorbis", 1, "ascii");
  id[11] = 1;
  id.writeUInt32LE(22050, 12);
  return Buffer.concat([oggPage(0n, id), oggPage(BigInt(Math.round((ms / 1000) * 22050)), Buffer.alloc(4))]);
}

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("a Mission's placeholder voices", () => {
  it("are .ogg by default: spoken, trimmed to the speech, then encoded, the manifest hashing the .ogg", async () => {
    const audio = await tempFolder();
    const given: Buffer[] = [];
    const result = await writePlaceholderVoices(speaker(toneWav(0.4, 1)), script("Hold the line."), audio, "missing", { derive: standIn(given) });

    expect(result.spoken).toEqual(["orla-1"]);
    expect(await readdir(audio)).toEqual(["manifest.json", "orla-1.ogg"]);
    // The encoder was given the trimmed WAV.
    expect(given).toEqual([trimSilence(toneWav(0.4, 1))]);
    const ogg = await readFile(path.join(audio, "orla-1.ogg"));
    expect(ogg.subarray(0, 5).toString()).toBe("OggS ");
    const found = await findVoiceFile(audio, "orla-1", "ogg", await readPlaceholderManifest(audio), { hashAlways: true });
    expect(found).toMatchObject({ format: "ogg", placeholder: true });
  });

  it("are the line's silence, reported as silent and not spoken again, when the speech engine writes a WAV with no samples", async () => {
    // What `say` then afconvert make of nothing to say ("..."): a WAV whose data chunk is empty.
    const empty = silentWav(0);
    const audio = await tempFolder();
    const given: Buffer[] = [];
    const result = await writePlaceholderVoices(speaker(empty), script("Hold the line."), audio, "missing", { derive: standIn(given) });

    expect(result.silent).toEqual(["orla-1"]);
    expect(result.spoken).toEqual([]);
    expect(given).toEqual([silentWav(3)]);
    // Kept under its spoken key: speaking it again would give nothing again, and a later run
    // leaves its manifest as it was.
    const entry = (await readPlaceholderManifest(audio))["orla-1"]!;
    expect(entry.from).not.toMatch(/^silent:/);
    const before = await readFile(path.join(audio, PLACEHOLDER_MANIFEST), "utf8");
    const host = speaker(empty);
    await writePlaceholderVoices(host, script("Hold the line."), audio, "stale", { derive: standIn(given) });
    expect(host.calls()).toBe(0);
    expect(await readFile(path.join(audio, PLACEHOLDER_MANIFEST), "utf8")).toBe(before);
  });

  it("are .wav for a Mission whose voice format is wav, with nothing encoded", async () => {
    const audio = await tempFolder();
    const given: Buffer[] = [];
    await writePlaceholderVoices(bareHost(), script("Hold the line."), audio, "missing", { format: "wav", derive: standIn(given) });
    expect(await readdir(audio)).toEqual(["manifest.json", "orla-1.wav"]);
    expect(given).toEqual([]);
  });

  it("count a line's voice file in either format as there, in a compile's missing mode", async () => {
    const audio = await tempFolder();
    await writeFile(path.join(audio, "orla-1.wav"), toneWav(0, 1));
    const host = speaker(toneWav(0, 1));
    await writePlaceholderVoices(host, script("Hold the line."), audio, "missing", { derive: standIn() });
    expect(host.calls()).toBe(0);
    expect(await readdir(audio)).toEqual(["orla-1.wav"]);
  });

  it("encode an up-to-date .wav placeholder to .ogg in place on a stale run, without speaking it again, and leave it on a compile", async () => {
    const audio = await tempFolder();
    const host = speaker(toneWav(0, 1));
    await writePlaceholderVoices(host, script("Hold the line."), audio, "missing", { format: "wav" });
    const wav = await readFile(path.join(audio, "orla-1.wav"));

    await writePlaceholderVoices(host, script("Hold the line."), audio, "missing", { derive: standIn() });
    expect(await readdir(audio)).toEqual(["manifest.json", "orla-1.wav"]);

    const result = await writePlaceholderVoices(host, script("Hold the line."), audio, "stale", { derive: standIn() });
    expect(result).toMatchObject({ converted: ["orla-1"], spoken: [] });
    expect(host.calls()).toBe(1);
    expect(await readdir(audio)).toEqual(["manifest.json", "orla-1.ogg"]);
    expect(await readFile(path.join(audio, "orla-1.ogg"))).toEqual(Buffer.concat([Buffer.from("OggS "), wav]));
    // Still the line's placeholder: a changed line is spoken again.
    const again = await writePlaceholderVoices(host, script("Hold the line, now."), audio, "stale", { derive: standIn() });
    expect(again.spoken).toEqual(["orla-1"]);
  });

  it("never replace a recording in the other format, and delete the placeholder it took the place of", async () => {
    const audio = await tempFolder();
    const host = speaker(toneWav(0, 1));
    await writePlaceholderVoices(host, script("Hold the line."), audio, "missing", { derive: standIn() });
    await writeFile(path.join(audio, "orla-1.wav"), "recorded\n");

    // The recording voices the line, whatever the format.
    const manifest = await readPlaceholderManifest(audio);
    expect(await findVoiceFile(audio, "orla-1", "ogg", manifest)).toMatchObject({ path: path.join(audio, "orla-1.wav"), placeholder: false, other: { format: "ogg", placeholder: true } });

    const result = await writePlaceholderVoices(host, script("Hold the line, now."), audio, "stale", { derive: standIn() });
    expect(result).toMatchObject({ spoken: [], superseded: ["orla-1"] });
    expect(await readdir(audio)).toEqual(["manifest.json", "orla-1.wav"]);
    expect(await readFile(path.join(audio, "orla-1.wav"), "utf8")).toBe("recorded\n");
    expect(JSON.parse(await readFile(path.join(audio, PLACEHOLDER_MANIFEST), "utf8"))).toEqual({});
  });

  it("adopt only an old .wav placeholder, never an .ogg recording beside it, which then voices the line", async () => {
    const audio = await tempFolder();
    // An older npm run tts wrote the .wav and recorded only a key; the author has since dropped in an .ogg recording.
    await writeFile(path.join(audio, "orla-1.wav"), toneWav(0, 1));
    await writeFile(path.join(audio, "orla-1.ogg"), "recorded\n");
    await writeFile(path.join(audio, PLACEHOLDER_MANIFEST), JSON.stringify({ "orla-1": "an old key" }));

    const result = await writePlaceholderVoices(speaker(toneWav(0, 1)), script("Hold the line, now."), audio, "stale", { adoptUnhashed: true, derive: standIn() });
    expect(result).toMatchObject({ spoken: [], superseded: ["orla-1"] });
    expect(await readdir(audio)).toEqual(["manifest.json", "orla-1.ogg"]);
    expect(await readFile(path.join(audio, "orla-1.ogg"), "utf8")).toBe("recorded\n");
  });

  it("leave an .ogg alone with an old unhashed entry, even when adopting: an older npm run tts never wrote one", async () => {
    const audio = await tempFolder();
    await writeFile(path.join(audio, "orla-1.ogg"), "recorded\n");
    await writeFile(path.join(audio, PLACEHOLDER_MANIFEST), JSON.stringify({ "orla-1": "an old key" }));
    const result = await writePlaceholderVoices(speaker(toneWav(0, 1)), script("Hold the line."), audio, "stale", { adoptUnhashed: true, derive: standIn() });
    expect(result).toMatchObject({ spoken: [], unhashed: ["orla-1"] });
    expect(await readFile(path.join(audio, "orla-1.ogg"), "utf8")).toBe("recorded\n");
  });

  it("remake an .ogg placeholder as a .wav for a Mission whose voice format is wav, even on a compile, and as silence on a host that can't speak", async () => {
    const audio = await tempFolder();
    await writePlaceholderVoices(speaker(toneWav(0, 1)), script("Hold the line."), audio, "missing", { derive: standIn() });

    const result = await writePlaceholderVoices(bareHost(), script("Hold the line."), audio, "missing", { format: "wav", derive: standIn() });
    expect(result.silent).toEqual(["orla-1"]);
    expect(await readdir(audio)).toEqual(["manifest.json", "orla-1.wav"]);
    expect((await packageVoiceFiles(audio, ["orla-1"], "wav", standIn())).files.get("orla-1")).toEqual({ copyFrom: path.join(audio, "orla-1.wav") });
  });

  it("refuse a manifest that can't be read, which readers that only find voice files get past", async () => {
    const audio = await tempFolder();
    await writeFile(path.join(audio, "orla-1.wav"), toneWav(0, 1));
    await writeFile(path.join(audio, PLACEHOLDER_MANIFEST), "{ <<<<<<< HEAD");
    await expect(writePlaceholderVoices(bareHost(), script("Hold the line."), audio, "stale", { derive: standIn() })).rejects.toThrow(/manifest\.json can't be read/);
    expect((await voiceLengthsMs([line("orla-1")], audio)).lengths.get("orla-1")).toBe(1000);
    expect((await findVoiceFiles(audio, ["orla-1"], "ogg")).get("orla-1")).toMatchObject({ format: "wav" });
  });

  it("settle two recordings of a line by the Mission's voice format", async () => {
    const audio = await tempFolder();
    await writeFile(path.join(audio, "orla-1.wav"), "recorded wav\n");
    await writeFile(path.join(audio, "orla-1.ogg"), "recorded ogg\n");
    expect((await findVoiceFiles(audio, ["orla-1"], "ogg")).get("orla-1")).toMatchObject({ format: "ogg", other: { format: "wav" } });
    expect((await findVoiceFiles(audio, ["orla-1"], "wav")).get("orla-1")).toMatchObject({ format: "wav", other: { format: "ogg" } });
    const { warnings } = await packageVoiceFiles(audio, ["orla-1"], "ogg", standIn());
    expect(warnings).toEqual([expect.stringMatching(/^orla-1 has two voice files .*neither is its placeholder: the \.ogg voices it/)]);
  });

  it("warn of an old unhashed entry beside two files, pointing at --adopt-unhashed", async () => {
    const audio = await tempFolder();
    await writeFile(path.join(audio, "orla-1.wav"), "old placeholder\n");
    await writeFile(path.join(audio, "orla-1.ogg"), "recorded\n");
    await writeFile(path.join(audio, PLACEHOLDER_MANIFEST), JSON.stringify({ "orla-1": "an old key" }));
    const { warnings } = await packageVoiceFiles(audio, ["orla-1"], "ogg", standIn());
    expect(warnings).toEqual([expect.stringContaining("--adopt-unhashed")]);
  });
});

describe("a Mission's voice files in its Map Package", () => {
  it("are an .ogg copied as it is, and a .wav encoded to .ogg", async () => {
    const audio = await tempFolder();
    await writeFile(path.join(audio, "a.ogg"), "an ogg\n");
    await writeFile(path.join(audio, "b.wav"), "a wav\n");
    const { files, missing } = await packageVoiceFiles(audio, ["a", "b", "c"], "ogg", standIn());
    expect(files.get("a")).toEqual({ copyFrom: path.join(audio, "a.ogg") });
    expect(Buffer.from(files.get("b") as Uint8Array).toString()).toBe("OggS a wav\n");
    expect(missing).toEqual(["c"]);
  });

  it("are refused as .ogg for a Mission whose voice format is wav", async () => {
    const audio = await tempFolder();
    await writeFile(path.join(audio, "a.ogg"), "an ogg\n");
    await expect(packageVoiceFiles(audio, ["a"], "wav", standIn())).rejects.toThrow(/a\.ogg is an \.ogg, but the Mission's voice format is wav/);
  });

  it("compile into an .ogg Mission's package, with the CSounds on the .ogg, and the same bytes and record on a repeat compile", async () => {
    const root = await copyOf("radio");
    const blueprintPath = path.join(root, "missions", "radio-field", "blueprint.json");
    // The fixture's voice format is wav; this Mission takes the default.
    await writeFile(blueprintPath, (await readFile(blueprintPath, "utf8")).replace('"voiceFormat": "wav", ', ""));
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);
    const mission = (await readMissionScript(blueprint, blueprintPath, workspace))!;
    expect(mission.voiceFormat).toBe("ogg");
    const [recorded, placeholder] = mission.script.scenes[0]!.items.filter((item): item is ScriptLine => item.kind === "line").map((item) => item.soundId);
    await mkdir(mission.audioDir, { recursive: true });
    // A recording given as .wav, and the other line left to a placeholder.
    await writeFile(path.join(mission.audioDir, `${recorded}.wav`), "recorded\n");

    const given: Buffer[] = [];
    const compile = () => compileMission(workspace, blueprintPath, undefined, { derive: standIn(given) });
    await compile();
    const pkg = await missionMapPackage(blueprintPath);
    const conversations = path.join(pkg, "Assets", "Sounds", "Conversations");
    expect((await readdir(conversations)).sort()).toEqual([`${recorded}.ogg`, `${placeholder}.ogg`].sort());
    expect(await readFile(path.join(conversations, `${recorded}.ogg`), "utf8")).toBe("OggS recorded\n");
    // The placeholder was written as .ogg in the audio folder, and copied as it is.
    expect(await readFile(path.join(conversations, `${placeholder}.ogg`))).toEqual(await readFile(path.join(mission.audioDir, `${placeholder}.ogg`)));
    const sounds = await readFile(path.join(pkg, "Base.SC2Data", "GameData", "SoundData.xml"), "utf8");
    expect(sounds).toContain(`<File value="Assets\\Sounds\\Conversations\\${recorded}.ogg"/>`);
    expect(sounds).not.toContain(".wav");

    const record = await readFile(path.join(path.dirname(blueprintPath), "compile-record.json"), "utf8");
    const bytes = await readFile(path.join(conversations, `${recorded}.ogg`));
    await compile();
    expect(await readFile(path.join(path.dirname(blueprintPath), "compile-record.json"), "utf8")).toBe(record);
    expect(await readFile(path.join(conversations, `${recorded}.ogg`))).toEqual(bytes);
  });

  it("drop a .wav the last compile wrote when the Mission's voices become .ogg", async () => {
    const root = await copyOf("radio");
    const blueprintPath = path.join(root, "missions", "radio-field", "blueprint.json");
    const workspace = await loadWorkspace(root);
    await compileMission(workspace, blueprintPath, undefined, { derive: standIn() });
    const conversations = path.join(await missionMapPackage(blueprintPath), "Assets", "Sounds", "Conversations");
    expect((await readdir(conversations)).every((file) => file.endsWith(".wav"))).toBe(true);

    await writeFile(blueprintPath, (await readFile(blueprintPath, "utf8")).replace('"voiceFormat": "wav", ', ""));
    await compileMission(await loadWorkspace(root), blueprintPath, undefined, { derive: standIn() });
    const files = await readdir(conversations);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((file) => file.endsWith(".ogg"))).toBe(true);
  });
});

describe("a line's length", () => {
  it("is timed from its .ogg or its .wav, the recording over the placeholder", async () => {
    const audio = await tempFolder();
    await writeFile(path.join(audio, "a.ogg"), oggOf(2500));
    await writeFile(path.join(audio, "b.wav"), silentWav(1.5));
    const { lengths, estimated } = await voiceLengthsMs([line("a"), line("b"), line("c")], audio);
    expect(lengths.get("a")).toBe(2500);
    expect(lengths.get("b")).toBe(1500);
    expect(estimated).toEqual(["c"]);
  });
});

describe("the wav-to-ogg step", () => {
  it("asks for ffmpeg when the machine has none", async () => {
    const saved = process.env.PATH;
    process.env.PATH = await tempFolder();
    try {
      await expect(ffmpegDerive("wav-to-ogg", silentWav(0.5))).rejects.toThrow(`The wav-to-ogg step needs ffmpeg on the PATH (${process.platform === "win32" ? "winget install BtbN.FFmpeg.GPL.9.0" : "brew install ffmpeg"})`);
    } finally {
      process.env.PATH = saved;
    }
  });

  it("names how to install ffmpeg on the machine's platform", () => {
    expect(ffmpegInstallHint("win32")).toBe("winget install BtbN.FFmpeg.GPL.9.0");
    expect(ffmpegInstallHint("darwin")).toBe("brew install ffmpeg");
  });

  it("encodes each input once, keeping its output in the cache by the input's hash", async () => {
    // Inside a folder of the user's own: the cache refuses one whose parent others can write to, as /tmp is on Linux.
    const cache = path.join(await tempFolder(), "derived");
    const given: Buffer[] = [];
    const derive = cachedDerive(standIn(given), cache);
    const first = await derive("wav-to-ogg", silentWav(0.5));
    expect(await derive("wav-to-ogg", silentWav(0.5))).toEqual(first);
    expect(given).toHaveLength(1);
    await derive("wav-to-ogg", silentWav(0.6));
    expect(given).toHaveLength(2);
    expect((await readdir(path.join(cache, "wav-to-ogg"))).filter((file) => file.endsWith(".ogg"))).toHaveLength(2);

    // A cached file cut short is made again.
    const [file] = (await readdir(path.join(cache, "wav-to-ogg"))).filter((name) => name.endsWith(".ogg"));
    await writeFile(path.join(cache, "wav-to-ogg", file!), "Ogg");
    await derive("wav-to-ogg", silentWav(0.5));
    await derive("wav-to-ogg", silentWav(0.6));
    expect(given).toHaveLength(3);
  });

  it.skipIf(process.platform === "win32")("keeps no cache in a folder others can write to", async () => {
    const cache = await tempFolder();
    await chmod(cache, 0o777);
    const given: Buffer[] = [];
    const derive = cachedDerive(standIn(given), path.join(cache, "derived"));
    await derive("wav-to-ogg", silentWav(0.5));
    await derive("wav-to-ogg", silentWav(0.5));
    expect(given).toHaveLength(2);
    expect(existsSync(path.join(cache, "derived", "wav-to-ogg"))).toBe(false);
  });

  it.skipIf(!hasFfmpeg)("makes the same Ogg Vorbis bytes from the same WAV every time, about as long", async () => {
    const wav = toneWav(0, 1.2);
    const once = await ffmpegDerive("wav-to-ogg", wav);
    expect(once.subarray(0, 4).toString()).toBe("OggS");
    expect(await ffmpegDerive("wav-to-ogg", wav)).toEqual(once);
    const audio = await tempFolder();
    await writeFile(path.join(audio, "a.ogg"), once);
    const ms = (await voiceLengthsMs([line("a")], audio)).lengths.get("a")!;
    expect(Math.abs(ms - 1200)).toBeLessThan(30);
  });
});
