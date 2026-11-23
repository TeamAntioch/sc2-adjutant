// A spoken placeholder is trimmed to its speech: a Cinematic times its lines by their voice files,
// back to back, so the silence a speech engine leaves at a file's ends would be a gap after each
// line. Synthetic WAVs only.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { wavLengthMs } from "../../src/cutscene/cinematic.js";
import type { Host } from "../../src/host/host.js";
import { emptyMachineConfig } from "../../src/host/machine-config.js";
import { PLACEHOLDER_MANIFEST, PLACEHOLDER_SAMPLE_RATE, silentWav, trimSilence, writePlaceholderVoices } from "../../src/host/placeholder-voices.js";
import type { Script } from "../../src/script/name-script.js";

const RATE = PLACEHOLDER_SAMPLE_RATE;
/** These placeholders stay WAVs, to be read as they were spoken. */
const WAV = { format: "wav" } as const;

/** A 16-bit mono WAV: `before` s of silence, `sound` s of a tone, `after` s of silence, with a padding chunk as afconvert writes one. */
function paddedWav(before: number, sound: number, after: number): Buffer {
  const samples = [...Array(Math.round(before * RATE)).fill(0), ...Array.from({ length: Math.round(sound * RATE) }, (_, i) => Math.round(8000 * Math.sin(i / 5))), ...Array(Math.round(after * RATE)).fill(0)];
  const filler = Buffer.alloc(8 + 12);
  filler.write("FLLR", 0, "ascii");
  filler.writeUInt32LE(12, 4);
  const data = Buffer.alloc(8 + samples.length * 2);
  data.write("data", 0, "ascii");
  data.writeUInt32LE(samples.length * 2, 4);
  samples.forEach((sample, i) => data.writeInt16LE(sample, 8 + i * 2));
  const format = silentWav(0).subarray(12, 36);
  const body = Buffer.concat([Buffer.from("WAVE", "ascii"), format, filler, data]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A one-line Script, the line's text `text`. */
const script = (text: string): Script =>
  ({ title: "t", fields: {}, conversationId: "c", scenes: [{ items: [{ kind: "line", speaker: "ORLA", character: "Orla", characterId: "Orla", soundId: "orla-1", lineId: "Line1", text }] }] }) as unknown as Script;

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

describe("trimming a voice file's silence", () => {
  it("cuts the silence at each end past a 50 ms margin, and drops the padding chunk", () => {
    const wav = paddedWav(0.3, 1, 0.4);
    expect(wavLengthMs(wav)).toBe(1700);
    const cut = trimSilence(wav)!;
    expect(wavLengthMs(cut)).toBe(1100);
    expect(cut.length).toBe(44 + Math.round(1.1 * RATE) * 2);
    expect(cut.toString("ascii", 36, 40)).toBe("data");
  });

  it("leaves alone a file that isn't a 16-bit PCM WAV, one that's silent all through, and one with nothing to cut", () => {
    expect(trimSilence(Buffer.from("spoken by Eddy: hello\n"))).toBeUndefined();
    expect(trimSilence(silentWav(1))).toBeUndefined();
    expect(trimSilence(trimSilence(paddedWav(0.3, 1, 0.4))!)).toBeUndefined();
  });
});

describe("a spoken placeholder", () => {
  it("is written trimmed to its speech, and marked trimmed in the manifest", async () => {
    const audio = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-trim-"));
    folders.push(audio);
    const result = await writePlaceholderVoices(speaker(paddedWav(0.2, 1.5, 0.5)), script("Hold the line."), audio, "missing", WAV);
    expect(result.spoken).toEqual(["orla-1"]);
    expect(wavLengthMs(await readFile(path.join(audio, "orla-1.wav")))).toBe(1600);
    expect(JSON.parse(await readFile(path.join(audio, PLACEHOLDER_MANIFEST), "utf8"))["orla-1"]).toMatchObject({ trimmed: true });
  });

  it("written before the trim is trimmed in place by a stale run, without speaking it again, and only once", async () => {
    const audio = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-trim-"));
    folders.push(audio);
    const host = speaker(paddedWav(0.2, 1.5, 0.5));
    await writePlaceholderVoices(host, script("Hold the line."), audio, "missing", WAV);
    // As an older core left it: the untrimmed file, its hash, no trimmed mark.
    const wav = path.join(audio, "orla-1.wav");
    const manifestPath = path.join(audio, PLACEHOLDER_MANIFEST);
    const untrimmed = paddedWav(0.2, 1.5, 0.5);
    await writeFile(wav, untrimmed);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const { trimmed: _trimmed, ...entry } = manifest["orla-1"];
    const { createHash } = await import("node:crypto");
    await writeFile(manifestPath, JSON.stringify({ "orla-1": { ...entry, sha1: createHash("sha1").update(untrimmed).digest("hex") } }));

    // A compile changes nothing on disk.
    await writePlaceholderVoices(host, script("Hold the line."), audio, "missing", WAV);
    expect(wavLengthMs(await readFile(wav))).toBe(2200);

    const result = await writePlaceholderVoices(host, script("Hold the line."), audio, "stale", WAV);
    expect(result).toMatchObject({ spoken: [], trimmed: ["orla-1"] });
    expect(host.calls()).toBe(1);
    expect(wavLengthMs(await readFile(wav))).toBe(1600);
    expect((await writePlaceholderVoices(host, script("Hold the line."), audio, "stale", WAV)).trimmed).toEqual([]);
  });

  it("replaced by a real recording is never trimmed", async () => {
    const audio = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-trim-"));
    folders.push(audio);
    const host = speaker(paddedWav(0.2, 1.5, 0.5));
    await writePlaceholderVoices(host, script("Hold the line."), audio, "missing", WAV);
    const manifestPath = path.join(audio, PLACEHOLDER_MANIFEST);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const { trimmed: _trimmed, ...entry } = manifest["orla-1"];
    await writeFile(manifestPath, JSON.stringify({ "orla-1": entry }));
    const recording = paddedWav(0.4, 2, 0.6);
    await writeFile(path.join(audio, "orla-1.wav"), recording);

    expect((await writePlaceholderVoices(host, script("Hold the line."), audio, "stale", WAV)).trimmed).toEqual([]);
    expect(await readFile(path.join(audio, "orla-1.wav"))).toEqual(recording);
  });
});
