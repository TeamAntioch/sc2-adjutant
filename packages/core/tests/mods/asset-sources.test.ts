// Asset Sources (ADR-0011): an Asset Mod's Blueprint says where each of its files comes from (a
// Workspace file with its hash, a community asset fetched to the machine's cache, a generated
// placeholder, or a file derived from another), and its voices give a conversation's lines a file
// each, the recording first. The Campaign Mod's sound set compiles those lines' SoundData entries
// from them. Harbour-Story and its Asset Mod Harbour-Art are synthetic; the fetch, the voice and
// the .wav → .ogg step are stand-ins, so nothing is downloaded or encoded.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Host } from "../../src/host/host.js";
import { emptyMachineConfig } from "../../src/host/machine-config.js";
import { createServer } from "../../src/mcp/server.js";
import { trackedByGit } from "../../src/mods/asset-sources.js";
import { compileMod, type CompileModOptions, EquivalenceError } from "../../src/mods/compile-mod.js";
import { importMod } from "../../src/mods/import-mod.js";
import { checkWorkspace } from "../../src/plugins/check-workspace.js";
import { loadWorkspace, WORKSPACE_FILE } from "../../src/plugins/workspace.js";
import { pullModScreenplays } from "../../src/mods/conversations.js";
import { screenplay, setAct } from "./harbour-chats.js";
import { declareRecordings, harbourWithArt, inArt, RECORDING, sha256, SOUND_DATA, SOUND_ENTRY, SOUND_SET, SOUNDS, VOICE, VOICE_FOLDER } from "./harbour-art.js";
import { binary, cleanupMods, declare, type Mod, put } from "./mod-fixture.js";
import { zip } from "./zip-fixture.js";

afterEach(cleanupMods);

let cacheDir: string;
beforeEach(async () => {
  cacheDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-asset-cache-"));
});
afterEach(() => rm(cacheDir, { recursive: true, force: true }));

type Spoken = { text: string; character: string; voice?: string };

/** A machine whose Host Adapter speaks a line as a WAV naming its voice and text, recording what it spoke. */
function speakingHost(spoken: Spoken[] = []): Host {
  const machine = { ...emptyMachineConfig(), cacheDir };
  return {
    machine,
    adapter: undefined,
    has: (name) => name === "tts.speak",
    run: (async (name: string, request: Spoken & { outputPath: string }) => {
      if (name !== "tts.speak") throw new Error(`no ${name}`);
      spoken.push({ text: request.text, character: request.character, voice: request.voice });
      await put(request.outputPath, Buffer.from(`RIFF placeholder ${request.voice}: ${request.text}`));
    }) as Host["run"],
  };
}

/** The .wav → .ogg step, as a stand-in: the WAV's bytes behind an OggS marker. */
const derive: CompileModOptions["derive"] = async (step, input) => {
  if (step !== "wav-to-ogg") throw new Error(`no step ${step}`);
  return Buffer.concat([Buffer.from("OggS "), input]);
};

describe("an Asset Mod's voices", () => {
  it("compile from their recordings, each a Workspace file, equivalent to the Editor's, with no placeholder spoken", async () => {
    const { art } = await harbourWithArt();
    await declareRecordings(art);
    const spoken: Spoken[] = [];

    const compiled = await compileMod(art.blueprintPath, { host: speakingHost(spoken), derive });

    expect(compiled.conversions).toEqual(SOUNDS.map((sound) => ({ item: `file:${VOICE(sound)}` })));
    expect(spoken).toEqual([]);
    for (const sound of SOUNDS) expect(Buffer.from(await inArt(art, VOICE(sound))).equals(Buffer.from(RECORDING(sound)))).toBe(true);
    // A second compile with nothing changed changes nothing.
    const record = await readFile(path.join(art.modDir, "compile-record.json"), "utf8");
    await compileMod(art.blueprintPath, { host: speakingHost(spoken), derive });
    expect(await readFile(path.join(art.modDir, "compile-record.json"), "utf8")).toBe(record);
    expect(existsSync(path.join(art.modDir, ".gitignore"))).toBe(false);
  });

  it("leave a Kept voice file alone while its declared recording's file isn't there, naming the line, and convert it once it's back", async () => {
    const { art } = await harbourWithArt();
    await declareRecordings(art);
    await rm(path.join(art.modDir, "voices", "Harbour-Quay-01-002-Dockhand.ogg"));
    const spoken: Spoken[] = [];

    const compiled = await compileMod(art.blueprintPath, { host: speakingHost(spoken), derive });

    const voice = VOICE("Harbour-Quay-01-002-Dockhand");
    expect(spoken).toEqual([]);
    expect(compiled.placeholders).toEqual([]);
    expect(Buffer.from(await inArt(art, voice)).equals(Buffer.from(RECORDING("Harbour-Quay-01-002-Dockhand")))).toBe(true);
    expect(compiled.record.entries.filter((entry) => "path" in entry && entry.path === voice)).toEqual([]);
    expect(compiled.warnings).toEqual([expect.stringMatching(/^Line01002 \(DOCKHAND\)'s recording voices\/Harbour-Quay-01-002-Dockhand\.ogg isn't there: Base\.SC2Assets\/Assets\/Sounds\/Conversations\/Harbour-Quay-01-002-Dockhand\.ogg is left as the package has it/)]);
    expect(existsSync(path.join(art.modDir, ".gitignore"))).toBe(false);

    await declareRecordings(art);
    const again = await compileMod(art.blueprintPath, { host: speakingHost(spoken), derive });
    expect(again.conversions).toEqual([{ item: `file:${voice}` }]);
  });

  it("once converted, leave a line's voice file and its record entry as they are while its recording's file is gone, never a placeholder over the tracked file", async () => {
    const { art } = await harbourWithArt();
    await declareRecordings(art);
    await compileMod(art.blueprintPath, { host: speakingHost(), derive });
    const record = await readFile(path.join(art.modDir, "compile-record.json"), "utf8");
    await rm(path.join(art.modDir, "voices", "Harbour-Quay-01-002-Dockhand.ogg"));

    const compiled = await compileMod(art.blueprintPath, { host: speakingHost(), derive });

    const voice = VOICE("Harbour-Quay-01-002-Dockhand");
    expect(Buffer.from(await inArt(art, voice)).equals(Buffer.from(RECORDING("Harbour-Quay-01-002-Dockhand")))).toBe(true);
    expect(compiled.placeholders).toEqual([]);
    expect(compiled.warnings).toEqual([expect.stringMatching(/^Line01002 \(DOCKHAND\)'s recording voices\/Harbour-Quay-01-002-Dockhand\.ogg isn't there/)]);
    expect(await readFile(path.join(art.modDir, "compile-record.json"), "utf8")).toBe(record);
    expect(existsSync(path.join(art.modDir, ".gitignore"))).toBe(false);
    expect(existsSync(path.join(art.modDir, "placeholders"))).toBe(false);

    await declareRecordings(art);
    await compileMod(art.blueprintPath, { host: speakingHost(), derive });
    expect(await readFile(path.join(art.modDir, "compile-record.json"), "utf8")).toBe(record);
  });

  it("take a recording that's a Git LFS pointer (the machine hasn't pulled it) for one that isn't there: the Workspace check passes and the package's file stays", async () => {
    const { art } = await harbourWithArt();
    await declareRecordings(art);
    await compileMod(art.blueprintPath, { host: speakingHost(), derive });
    const record = await readFile(path.join(art.modDir, "compile-record.json"), "utf8");
    const sound = "Harbour-Quay-01-002-Dockhand";
    await put(path.join(art.modDir, "voices", `${sound}.ogg`), `version https://git-lfs.github.com/spec/v1\noid sha256:${sha256(RECORDING(sound))}\nsize 800\n`);

    expect((await checkWorkspace(art.workspaceRoot)).problems).toEqual([]);
    const compiled = await compileMod(art.blueprintPath, { host: speakingHost(), derive });

    expect(compiled.warnings).toEqual([expect.stringMatching(/recording voices\/Harbour-Quay-01-002-Dockhand\.ogg is a Git LFS pointer/)]);
    expect(Buffer.from(await inArt(art, VOICE(sound))).equals(Buffer.from(RECORDING(sound)))).toBe(true);
    expect(await readFile(path.join(art.modDir, "compile-record.json"), "utf8")).toBe(record);
  });

  it("warn, once a placeholder is written over a voice file git tracks, that the next commit would record the placeholder over it", async () => {
    const { art } = await harbourWithArt();
    await declareRecordings(art, SOUNDS.slice(0, 2));
    await declare(art, { acceptedDifferences: [{ item: `file:${VOICE(SOUNDS[2]!)}`, reason: "Not recorded yet" }] });
    const git = (...args: string[]) => execFileSync("git", args, { cwd: art.workspaceRoot, encoding: "utf8" });
    git("init", "-q");
    git("add", "-A");
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "Harbour");

    const compiled = await compileMod(art.blueprintPath, { host: speakingHost(), derive });

    expect(compiled.warnings).toEqual([expect.stringMatching(/^Base\.SC2Assets\/Assets\/Sounds\/Conversations\/Harbour-Quay-02-001-Dockhand\.ogg is now made on each machine .* git rm --cached "Harbour-Art\.SC2Mod\/Base\.SC2Assets\/Assets\/Sounds\/Conversations\/Harbour-Quay-02-001-Dockhand\.ogg"/)]);
  });

  it("leave a .gitignore the author wrote in the mod's folder alone, refusing to make a file git should ignore beside it", async () => {
    const { art } = await harbourWithArt();
    await declareRecordings(art, SOUNDS.slice(0, 2));
    await declare(art, { acceptedDifferences: [{ item: `file:${VOICE(SOUNDS[2]!)}`, reason: "Not recorded yet" }] });
    await put(path.join(art.modDir, ".gitignore"), "notes/\n");

    await expect(compileMod(art.blueprintPath, { host: speakingHost(), derive })).rejects.toThrow(/\.gitignore isn't the one compile-mod writes/);
    expect(await readFile(path.join(art.modDir, ".gitignore"), "utf8")).toBe("notes/\n");
    expect(Buffer.from(await inArt(art, VOICE(SOUNDS[0]!))).equals(Buffer.from(RECORDING(SOUNDS[0]!)))).toBe(true);
    expect(JSON.parse(await readFile(path.join(art.modDir, "compile-record.json"), "utf8")).entries).toEqual([]);
  });

  it("give a line with no recording a placeholder: a new line has one until it's recorded", async () => {
    const { art } = await harbourWithArt();
    await declareRecordings(art, SOUNDS.slice(0, 2));
    await declare(art, { acceptedDifferences: [{ item: `file:${VOICE(SOUNDS[2]!)}`, reason: "Not recorded yet" }] });

    const compiled = await compileMod(art.blueprintPath, { host: speakingHost(), derive });

    expect(compiled.placeholders).toEqual([{ path: VOICE(SOUNDS[2]!), line: "Line02001", speaker: "DOCKHAND", reason: "it has no recording" }]);
  });

  it("give a line with no words silence, never asking the Host Adapter to speak nothing", async () => {
    const { story, art } = await harbourWithArt();
    await setAct(story, screenplay(""));
    await pullModScreenplays(story.blueprintPath);
    await declareRecordings(art, [SOUNDS[0]!, SOUNDS[2]!]);
    await declare(art, { acceptedDifferences: [{ item: `file:${VOICE(SOUNDS[1]!)}`, reason: "Not recorded yet" }] });
    const spoken: Spoken[] = [];

    await compileMod(art.blueprintPath, { host: speakingHost(spoken), derive });

    expect(spoken).toEqual([]);
    expect((await inArt(art, VOICE(SOUNDS[1]!))).subarray(0, 9).toString()).toBe("OggS RIFF");
  });

  it("give a placeholder to a line with no recording, kept out of git, which a fresh clone makes again without taking it for an Editor change", async () => {
    const { art } = await harbourWithArt();
    await declareRecordings(art, SOUNDS.slice(0, 2));
    await declare(art, { acceptedDifferences: [{ item: `file:${VOICE(SOUNDS[2]!)}`, reason: "Not recorded yet" }] });
    await compileMod(art.blueprintPath, { host: speakingHost(), derive });
    const voice = VOICE(SOUNDS[2]!);
    expect(await readFile(path.join(art.modDir, ".gitignore"), "utf8")).toContain(`/Harbour-Art.SC2Mod/${voice}\n`);

    await rm(path.join(art.modPackage, ...voice.split("/")));
    const compiled = await compileMod(art.blueprintPath, { host: speakingHost(), derive });

    expect((await inArt(art, voice)).toString()).toBe("OggS RIFF placeholder Fiona: She's stuck again.");
    expect(compiled.record.entries).toContainEqual({ kind: "uncommitted", path: voice });
  });

  it("give a line silence, with a warning, when the Host Adapter fails to speak it", async () => {
    const { art } = await harbourWithArt();
    await declareRecordings(art, SOUNDS.slice(0, 2));
    await declare(art, { acceptedDifferences: [{ item: `file:${VOICE(SOUNDS[2]!)}`, reason: "Not recorded yet" }] });
    const host: Host = { ...speakingHost(), run: (async () => { throw new Error("say crashed"); }) as Host["run"] };

    const compiled = await compileMod(art.blueprintPath, { host, derive });

    expect((await inArt(art, VOICE(SOUNDS[2]!))).subarray(0, 9).toString()).toBe("OggS RIFF");
    expect(compiled.warnings).toContainEqual(expect.stringMatching(/couldn't speak Harbour-Quay-02-001-Dockhand, so it got a silent placeholder: say crashed/));
  });

  it("warn about a placeholder an old manifest records without its hash, which is kept", async () => {
    const { art } = await harbourWithArt();
    await declareRecordings(art, SOUNDS.slice(0, 2));
    await declare(art, { acceptedDifferences: [{ item: `file:${VOICE(SOUNDS[2]!)}`, reason: "Not recorded yet" }] });
    await put(path.join(art.modDir, "placeholders", `${SOUNDS[2]}.wav`), "RIFF an old take");
    await put(path.join(art.modDir, "placeholders", "manifest.json"), JSON.stringify({ [SOUNDS[2]!]: "0123" }));

    const compiled = await compileMod(art.blueprintPath, { host: speakingHost(), derive });

    expect((await inArt(art, VOICE(SOUNDS[2]!))).toString()).toBe("OggS RIFF an old take");
    expect(compiled.warnings).toContainEqual(expect.stringMatching(/recorded them without their hash.*Harbour-Quay-02-001-Dockhand/));
  });

  it("refuse a recording whose file isn't in the voices' format, naming the step that converts it", async () => {
    const { art } = await harbourWithArt();
    const wav = Buffer.from("RIFF a take");
    await put(path.join(art.modDir, "voices", `${SOUNDS[0]}.wav`), wav);
    await declare(art, { voices: [{ conversation: "HarbourChats", folder: VOICE_FOLDER, recordings: { [SOUNDS[0]!]: { file: `voices/${SOUNDS[0]}.wav`, sha256: sha256(wav) } } }] });

    expect((await checkWorkspace(art.workspaceRoot)).problems).toEqual([
      expect.objectContaining({ mod: "harbour-art", path: `voices.0.recordings.${SOUNDS[0]}`, message: expect.stringMatching(/makes a \.wav file, not the voices' \.ogg: give it as \{ "derived": "wav-to-ogg"/) }),
    ]);
    await expect(compileMod(art.blueprintPath, { host: speakingHost(), derive })).rejects.toThrow(/makes a \.wav file, not the voices' \.ogg/);
  });

  it("speak placeholders through compile_mod on the server's own machine", async () => {
    const { art } = await harbourWithArt();
    await declare(art, { voices: [{ conversation: "HarbourChats", groups: [2], folder: VOICE_FOLDER, format: "wav" }] });
    const spoken: Spoken[] = [];
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer({ workspaceRoot: art.workspaceRoot, host: speakingHost(spoken) }).connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);

    try {
      const reply = await client.callTool({ name: "compile_mod", arguments: { mod: "harbour-art" } });
      expect(reply.isError).toBeFalsy();
    } finally {
      await client.close();
    }
    expect(spoken).toEqual([{ text: "She's stuck again.", character: "Dockhand", voice: "Fiona" }]);
  });

  it("refuse a recording for a Sound the conversation doesn't play", async () => {
    const { art } = await harbourWithArt();
    await declareRecordings(art);
    const blueprint = JSON.parse(await readFile(art.blueprintPath, "utf8"));
    blueprint.voices[0].recordings["Harbour-Quay-09-001-Dockhand"] = blueprint.voices[0].recordings[SOUNDS[0]!];
    await declare(art, { voices: blueprint.voices });

    await expect(compileMod(art.blueprintPath, { host: speakingHost(), derive })).rejects.toThrow(/voices\.0 records Harbour-Quay-09-001-Dockhand, which no line of HarbourChats plays/);
  });
});

describe("a Workspace file", () => {
  it("whose hash doesn't match fails the Workspace check and the compile", async () => {
    const { art } = await harbourWithArt();
    await declareRecordings(art);
    await put(path.join(art.modDir, "voices", "Harbour-Quay-01-001-Harbourmaster.ogg"), binary(99, 800));

    const check = await checkWorkspace(art.workspaceRoot);

    expect(check.problems).toEqual([
      expect.objectContaining({ mod: "harbour-art", file: "mods/harbour-art/voices/Harbour-Quay-01-001-Harbourmaster.ogg", path: "voices.0.recordings.Harbour-Quay-01-001-Harbourmaster", message: expect.stringMatching(/has the SHA-256 [0-9a-f]{64}, not the [0-9a-f]{64} the Blueprint records/) }),
    ]);
    await expect(compileMod(art.blueprintPath, { host: speakingHost(), derive })).rejects.toThrow(/voices\/Harbour-Quay-01-001-Harbourmaster\.ogg has the SHA-256/);
  });
});

describe("a community asset", () => {
  const GULL = "Base.SC2Assets/Assets/Textures/gull.dds";
  const download = binary(4);
  const declared = { path: GULL, source: { url: "https://assets.example/gull-pack/gull.dds", version: "1.2", licence: "CC-BY-4.0", sha256: sha256(download) } };

  it("fetches once into the machine's cache, compiles into the package, and is never staged in git", async () => {
    const { art } = await harbourWithArt();
    await declare(art, { assets: [declared] });
    const fetched: string[] = [];
    const fetch = async (url: string) => {
      fetched.push(url);
      return new Response(download);
    };

    const compiled = await compileMod(art.blueprintPath, { host: speakingHost(), derive, fetch });
    await compileMod(art.blueprintPath, { host: speakingHost(), derive, fetch });

    expect(fetched).toEqual(["https://assets.example/gull-pack/gull.dds"]);
    expect(compiled.conversions).toEqual([{ item: `file:${GULL}` }]);
    expect(existsSync(path.join(cacheDir, "community-assets", declared.source.sha256, "gull.dds"))).toBe(true);
    expect(compiled.record.entries).toContainEqual({ kind: "uncommitted", path: GULL });

    const git = (...args: string[]) => execFileSync("git", args, { cwd: art.workspaceRoot, encoding: "utf8" });
    git("init", "-q");
    git("add", "-A");
    const staged = git("diff", "--cached", "--name-only").split("\n");
    expect(staged).toContain("mods/harbour-art/blueprint.json");
    expect(staged).toContain("mods/harbour-art/.gitignore");
    expect(staged.filter((file) => file.endsWith("gull.dds"))).toEqual([]);
  });

  it("whose path has gitignore's special characters is still kept out of git", async () => {
    const { art } = await harbourWithArt();
    // Windows allows no * in a file's name; [, ] and # it does.
    const star = process.platform === "win32" ? "" : "*";
    const odd = `Base.SC2Assets/Assets/Textures/gull[1] ${star}#.dds`;
    await declare(art, { assets: [{ ...declared, path: odd }] });

    await compileMod(art.blueprintPath, { host: speakingHost(), derive, fetch: async () => new Response(download) });

    const git = (...args: string[]) => execFileSync("git", args, { cwd: art.workspaceRoot, encoding: "utf8" });
    git("init", "-q");
    await put(path.join(art.modPackage, "Base.SC2Assets", "Assets", "Textures", `gull1 ${star}#.dds`), binary(8));
    git("add", "-A");
    const staged = git("diff", "--cached", "--name-only", "-z").split("\0");
    expect(staged).toContain(`mods/harbour-art/Harbour-Art.SC2Mod/Base.SC2Assets/Assets/Textures/gull1 ${star}#.dds`);
    expect(staged).not.toContain(`mods/harbour-art/Harbour-Art.SC2Mod/${odd}`);
  });

  it("that another of the Blueprint's writers also makes is refused before it's fetched", async () => {
    const { art } = await harbourWithArt();
    await declare(art, { assets: [declared], files: [{ path: GULL, source: "art/gull.dds" }] }, { "art/gull.dds": "gull" });
    const fetched: string[] = [];

    await expect(compileMod(art.blueprintPath, { host: speakingHost(), derive, fetch: async (url) => (fetched.push(url), new Response(download)) })).rejects.toThrow(/writes Base\.SC2Assets\/Assets\/Textures\/gull\.dds twice/);
    expect(fetched).toEqual([]);
  });

  it("whose download doesn't have its hash is refused, and nothing is cached", async () => {
    const { art } = await harbourWithArt();
    await declare(art, { assets: [declared] });
    const fetch = async () => new Response(binary(5));

    await expect(compileMod(art.blueprintPath, { host: speakingHost(), derive, fetch })).rejects.toThrow(/https:\/\/assets\.example\/gull-pack\/gull\.dds \(version 1\.2\) downloaded with the SHA-256 [0-9a-f]{64}, not the [0-9a-f]{64} the Blueprint records/);
    expect(existsSync(path.join(cacheDir, "community-assets", declared.source.sha256))).toBe(false);
  });
});

describe("a community asset in an archive", () => {
  const GULL = "Base.SC2Assets/Assets/Textures/gull.dds";
  const CRY = "Base.SC2Assets/Assets/Sounds/gull.wav";
  const pack = zip({ "Gull Pack/readme.txt": "Credit the Gull Pack", "Gull Pack/Assets/Textures/gull.dds": binary(4), "Gull Pack/Assets/Sounds/gull.wav": Buffer.from("RIFF a gull's cry") }, ["Gull Pack/Assets/Sounds/gull.wav"]);
  const source = { url: "https://assets.example/files/gull-pack.zip", version: "2.0", licence: "CC-BY-4.0", sha256: sha256(pack) };

  it("takes each file it names from the archive, fetched once for all of them, deflated or stored", async () => {
    const { art } = await harbourWithArt();
    await declare(art, {
      assets: [
        { path: GULL, source: { ...source, member: "Gull Pack/Assets/Textures/gull.dds" } },
        { path: CRY, source: { ...source, member: "Gull Pack/Assets/Sounds/gull.wav" } },
      ],
    });
    const fetched: string[] = [];
    const fetch = async (url: string) => (fetched.push(url), new Response(pack));

    const compiled = await compileMod(art.blueprintPath, { host: speakingHost(), derive, fetch });

    expect(fetched).toEqual([source.url]);
    expect(await inArt(art, GULL)).toEqual(Buffer.from(binary(4)));
    expect((await inArt(art, CRY)).toString()).toBe("RIFF a gull's cry");
    expect(compiled.conversions).toEqual([{ item: `file:${GULL}` }]);
    expect(compiled.record.entries).toContainEqual({ kind: "uncommitted", path: CRY });
    expect(existsSync(path.join(cacheDir, "community-assets", source.sha256, "gull-pack.zip"))).toBe(true);
  });

  it("refuses a member the archive hasn't got, naming what it has", async () => {
    const { art } = await harbourWithArt();
    await declare(art, { assets: [{ path: GULL, source: { ...source, member: "Gull Pack/gull.dds" } }] });

    await expect(compileMod(art.blueprintPath, { host: speakingHost(), derive, fetch: async () => new Response(pack) })).rejects.toThrow(/has no Gull Pack\/gull\.dds: it has Gull Pack\/readme\.txt, Gull Pack\/Assets\/Textures\/gull\.dds, Gull Pack\/Assets\/Sounds\/gull\.wav/);
  });

  it("makes a file in its member's format, for a voice", async () => {
    const { art } = await harbourWithArt();
    await declare(art, {
      voices: [{ conversation: "HarbourChats", folder: "Base.SC2Assets/Assets/Sounds/Conversations", recordings: { "Harbour-Quay-01-001-Harbourmaster": { ...source, member: "Gull Pack/Assets/Sounds/gull.wav" } } }],
    });

    await expect(compileMod(art.blueprintPath, { host: speakingHost(), derive, fetch: async () => new Response(pack) })).rejects.toThrow(/makes a \.wav file, not the voices' \.ogg/);
  });
});

describe("a derived Asset Source", () => {
  it("is made from its source by its named step", async () => {
    const { art } = await harbourWithArt();
    const wav = Buffer.from("RIFF a gull's cry");
    await put(path.join(art.modDir, "sounds", "gull.wav"), wav);
    await declare(art, {
      assets: [{ path: "Base.SC2Assets/Assets/Sounds/gull.ogg", source: { derived: "wav-to-ogg", from: { file: "sounds/gull.wav", sha256: sha256(wav) } } }],
    });

    const compiled = await compileMod(art.blueprintPath, { host: speakingHost(), derive });

    expect((await inArt(art, "Base.SC2Assets/Assets/Sounds/gull.ogg")).toString()).toBe("OggS RIFF a gull's cry");
    // Made from Workspace files alone, it's committed with the package.
    expect(compiled.record.entries).toContainEqual(expect.objectContaining({ kind: "file", path: "Base.SC2Assets/Assets/Sounds/gull.ogg" }));
  });
});

describe("a Campaign Mod's sound set", () => {
  it("compiles a CSound for each line from its Asset Source, equivalent to the Editor's", async () => {
    const { story, art } = await harbourWithArt();
    await declareRecordings(art);
    await declare(story, { soundSets: [SOUND_SET] });

    const compiled = await compileMod(story.blueprintPath);

    expect(compiled.conversions).toEqual(SOUNDS.map((sound) => ({ item: SOUND_ENTRY(sound) })));
    expect(await readFile(path.join(story.modPackage, ...SOUND_DATA.split("/")), "utf8")).toContain(`<CSound default="1" id="Dialogue_Harbour" parent="Mission">`);
  });

  it("compiles while another of the Workspace's mods can't be read", async () => {
    const { story, art } = await harbourWithArt();
    await declareRecordings(art);
    await declare(story, { soundSets: [SOUND_SET] });
    const configFile = path.join(story.workspaceRoot, WORKSPACE_FILE);
    const config = JSON.parse(await readFile(configFile, "utf8"));
    await writeFile(configFile, JSON.stringify({ ...config, mods: [...config.mods, "lost"] }));

    const compiled = await compileMod(story.blueprintPath);

    expect(compiled.conversions).toEqual(SOUNDS.map((sound) => ({ item: SOUND_ENTRY(sound) })));
  });

  it("refuses a line whose Sound has no Asset Source in the mod's Asset Mods, naming it", async () => {
    const { story, art } = await harbourWithArt();
    await declareRecordings(art);
    const blueprint = JSON.parse(await readFile(art.blueprintPath, "utf8"));
    await declare(art, { voices: [{ ...blueprint.voices[0], groups: [1] }] });
    await declare(story, { soundSets: [SOUND_SET] });

    await expect(compileMod(story.blueprintPath)).rejects.toThrow(/soundSets\.0: Line02001's Sound Harbour-Quay-02-001-Dockhand has no Asset Source in the Asset Mods Harbour-Story depends on \(Harbour-Art\)/);
  });
});

describe("trackedByGit", () => {
  it("takes each path literally, not as a glob", async () => {
    const { art } = await harbourWithArt();
    const git = (...args: string[]) => execFileSync("git", args, { cwd: art.workspaceRoot, encoding: "utf8" });
    git("init", "-q");
    await put(path.join(art.modPackage, "Textures", "gull1.dds"), "a gull");
    git("add", "-A");

    expect(await trackedByGit(art.modPackage, ["Textures/gull[1].dds", "Textures/*.dds"])).toEqual([]);
    expect(await trackedByGit(art.modPackage, ["Textures/gull1.dds"])).toEqual(["Textures/gull1.dds"]);
  });
});
