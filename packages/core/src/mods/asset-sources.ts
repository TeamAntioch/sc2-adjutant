// An Asset Mod's files from their Asset Sources (ADR-0011, domain/asset-source.ts). The compile
// plans each file the Blueprint declares (its `assets`, and a voice file per line of its `voices`),
// then makes it:
//
//   Workspace file    read from the mod's folder; refused unless it has the SHA-256 recorded
//   community asset   from the machine's cache (<cacheDir>/community-assets/<sha256>/), fetched
//                     there once, refused unless the download has the SHA-256 recorded
//   generated (tts)   the line's placeholder, written by the machine's Host Adapter in the voice its
//                     character declares (silence without one) into placeholders/ in the mod's folder
//   game file         exported from the machine's game by its Host Adapter (model.export, with
//                     its textures), once a model in a compile, however many files are taken from it
//   derived           its source, made by the named step: wav-to-ogg with ffmpeg (host/derive.ts);
//                     retexture (catalog/m3-retexture.ts) and recolour (catalog/dds.ts,
//                     catalog/recolour.ts) in core
//
// For a voice, the recording wins: a line gets a placeholder only when the Blueprint declares no
// recording for it. Whether a file is committed follows from the Blueprint alone: a file made from
// anything but Workspace files is uncommitted (each machine makes its own, so the mod folder's
// .gitignore lists it), and a declared recording's file is committed. A recording whose Workspace
// file this machine doesn't have (not there, or a Git LFS pointer not pulled) is held: the compile
// leaves its voice file, and its record entry, as the package has them, and warns.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { decodeDds, recolourDds } from "../catalog/dds.js";
import { retextureM3 } from "../catalog/m3-retexture.js";
import { readM3TexturePaths } from "../catalog/m3-textures.js";
import { meanChroma, recolourTexel } from "../catalog/recolour.js";
import {
  type AssetSource,
  type CommunityAssetSource,
  type GameFileSource,
  isCommitted,
  isCommunityAsset,
  isDerived,
  isEncoded,
  isGameFile,
  isGenerated,
  sameStoragePath,
  type WorkspaceFileSource,
  workspaceFilesOf,
} from "../domain/asset-source.js";
import type { ModBlueprint } from "../domain/mod-blueprint.js";
import type { Derive } from "../host/derive.js";
import type { Host } from "../host/host.js";
import { hostContext } from "../host/machine-config.js";
import { type PlaceholderVoices, writePlaceholderVoices } from "../host/placeholder-voices.js";
import type { Workspace } from "../plugins/workspace.js";
import type { Script, ScriptLine } from "../script/name-script.js";
import { isInside } from "../util/inside.js";
import { zipMembers } from "../util/zip.js";
import { conversationLines, lineSound, type ModScript, workspaceConversation } from "./conversations.js";
import { campaignMod, readModBlueprint } from "./workspace-mods.js";

/** Where an Asset Mod's placeholder voices are made, in its folder: git-ignored, with their manifest. */
export const PLACEHOLDERS_DIR = "placeholders";

/** Makes a file by a named step from its source's bytes (host/derive.ts: ffmpeg, cached by content). */
export type { Derive } from "../host/derive.js";
export { ffmpegDerive } from "../host/derive.js";
/** Downloads a community asset. */
export type Fetch = (url: string) => Promise<Response>;

/** A line voiced by a placeholder, and why it has no recording. */
export type Placeholder = { readonly path: string; readonly line: string; readonly speaker: string; readonly reason: string };

/** One file of the Asset Mod the compile makes: where it goes, its source and who declared it. */
export type PlannedAsset = {
  readonly path: string;
  readonly source: AssetSource;
  /** Where the Blueprint declares it, such as assets.0 or voices.0.recordings.<Sound>. */
  readonly from: string;
  /** Whether it is made from Workspace files alone, and so committed with the package. */
  readonly committed: boolean;
  /** Set when it is a line's placeholder voice. */
  readonly placeholder?: Placeholder;
  /** Set when its recording's Workspace file isn't on this machine: the package's file is left as it is, and this is the warning. */
  readonly held?: string;
};

/** A Sound ID's line, from the Campaign Mod's Screenplay that voices it, for a placeholder. */
type SoundLine = { readonly script: ModScript; readonly line: ScriptLine };

export type AssetPlan = { readonly files: readonly PlannedAsset[]; readonly lines: ReadonlyMap<string, SoundLine> };

/**
 * The files the Asset Mod's Blueprint declares, each with the source it will be made from: a
 * line's recording, or its placeholder. `workspace` is read only when the Blueprint has voices or
 * generated sources, for the lines of the Campaign Mod's Screenplays.
 */
export async function planAssets(blueprint: ModBlueprint, modDir: string, workspace: () => Promise<Workspace>): Promise<AssetPlan> {
  const files: PlannedAsset[] = [];
  const lines = new Map<string, SoundLine>();
  const conversations = new Map<string, Promise<ModScript>>();
  const conversation = async (id: string, who: string): Promise<ModScript> => {
    if (!conversations.has(id)) conversations.set(id, workspace().then((found) => workspaceConversation(found, id, who)));
    return conversations.get(id)!;
  };

  for (const [index, voices] of blueprint.voices.entries()) {
    const script = await conversation(voices.conversation, `The Asset Mod's voices.${index}`);
    const voiced = conversationLines(script, voices.groups);
    const sounds = new Set(voiced.map(({ sound }) => sound));
    const stray = Object.keys(voices.recordings).filter((sound) => !sounds.has(sound));
    if (stray.length > 0) throw new Error(`voices.${index} records ${stray.join(", ")}, which no line of ${voices.conversation}${voices.groups ? ` (groups ${voices.groups.join(", ")})` : ""} plays: remove the recording, or give it the Sound its line plays`);
    for (const { line, sound } of voiced) {
      lines.set(sound, { script, line });
      const file = `${voices.folder}/${sound}.${voices.format}`;
      const from = `voices.${index}.recordings.${sound}`;
      const recording = voices.recordings[sound];
      if (recording) {
        const absent = (await Promise.all(workspaceFilesOf(recording).map((source) => absentProblem(source, modDir)))).find((problem) => problem !== undefined);
        const held = absent && `${line.lineId} (${line.speaker})'s recording ${absent}: ${file} is left as the package has it until it's back (git lfs pull, or put the file back); a placeholder is made only for a line the Blueprint records no recording for`;
        files.push({ path: file, source: recording, from, committed: isCommitted(recording), ...(held ? { held } : {}) });
        continue;
      }
      const generated: AssetSource = { generated: "tts", sound };
      const source: AssetSource = voices.format === "ogg" ? { derived: "wav-to-ogg", from: generated } : generated;
      files.push({ path: file, source, from, committed: false, placeholder: { path: file, line: line.lineId, speaker: line.speaker, reason: "it has no recording" } });
    }
  }

  // The lines of every Screenplay of the Campaign Mod, by Sound, read once when an asset generates a placeholder.
  let campaignLines: Promise<Map<string, SoundLine>> | undefined;
  for (const [index, asset] of blueprint.assets.entries()) {
    files.push({ path: asset.path, source: asset.source, from: `assets.${index}`, committed: isCommitted(asset.source) });
    for (const sound of generatedSounds(asset.source)) {
      if (lines.has(sound)) continue;
      campaignLines ??= soundLines(await workspace(), (id) => conversation(id, `The Asset Mod's assets.${index}`));
      const found = (await campaignLines).get(sound);
      if (!found) throw new Error(`assets.${index} generates a placeholder for the Sound ${sound}, which no line of the Campaign Mod's Screenplays plays`);
      lines.set(sound, found);
    }
  }

  const seen = new Map<string, string>();
  for (const file of files) {
    const other = seen.get(file.path.toLowerCase());
    if (other) throw new Error(`The Asset Mod's ${other} and ${file.from} both make ${file.path}: a file has one Asset Source`);
    seen.set(file.path.toLowerCase(), file.from);
  }
  return { files, lines };
}

/** The Sound IDs `source` generates a placeholder for. */
function generatedSounds(source: AssetSource): string[] {
  if (isGenerated(source)) return [source.sound];
  return isDerived(source) ? generatedSounds(source.from) : [];
}

/** Each line of the Campaign Mod's Screenplays, by the Sound it plays (the first Screenplay's, when two play one), each read through `conversation`. */
async function soundLines(workspace: Workspace, conversation: (id: string) => Promise<ModScript>): Promise<Map<string, SoundLine>> {
  const out = new Map<string, SoundLine>();
  const mod = await campaignMod(workspace);
  if (!mod) return out;
  for (const screenplay of (await readModBlueprint(mod.blueprintPath)).screenplays) {
    const script = await conversation(screenplay.conversation);
    for (const { line, sound } of conversationLines(script)) if (!out.has(sound)) out.set(sound, { script, line });
  }
  return out;
}

export type MakeAssetsOptions = {
  readonly modDir: string;
  /** The machine: its Host Adapter speaks placeholders, its cacheDir holds community assets. */
  readonly host: () => Promise<Host>;
  readonly fetch: Fetch;
  readonly derive: Derive;
};

/**
 * Each planned file's bytes, by its path, and advice for the author; placeholders are written (or
 * kept, when unchanged) in the mod's placeholders/ first, which a compile that then stops leaves
 * there, as it leaves the machine's cache.
 */
export async function makeAssets(plan: AssetPlan, options: MakeAssetsOptions): Promise<{ readonly files: Map<string, Buffer>; readonly warnings: readonly string[] }> {
  const { files: placeholders, outdated, unhashed, failed } = await writePlaceholders(plan, options);
  const warnings = [
    ...(outdated.length ? [`${outdated.length} placeholder voice(s) may no longer match their line's text and were kept, since this machine's Host Adapter can't speak: ${outdated.join(", ")}`] : []),
    ...(unhashed.length
      ? [`${unhashed.length} placeholder voice(s) in ${PLACEHOLDERS_DIR}/ no longer match their line, but its manifest recorded them without their hash, so each might be a recording and was kept: ${unhashed.join(", ")} (delete the file to have it made again)`]
      : []),
    ...failed.map(({ soundId, reason }) => `The Host Adapter couldn't speak ${soundId}, so it got a silent placeholder: ${reason}`),
    ...plan.files.flatMap((file) => (file.held ? [file.held] : [])),
  ];
  const out = new Map<string, Buffer>();
  // Each community archive's members, by its SHA-256, read once however many members are taken from it; each game model's export, likewise.
  const made: Made = { placeholders, archives: new Map(), games: new Map(), warnings: [] };
  // The storage paths this Asset Mod makes, for a retexture's new paths: a package path's part from Assets/ on.
  const makes = new Set(plan.files.map((file) => sameStoragePath(storagePathOf(file.path))));
  for (const file of plan.files) {
    if (file.held) continue;
    try {
      out.set(file.path, await make(file.source, options, made, `The Asset Mod's ${file.from} (${file.path})`));
    } catch (error) {
      throw new Error(`The Asset Mod's ${file.from} (${file.path}): ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    for (const step of derivedSteps(file.source)) {
      if (step.derived !== "retexture") continue;
      const elsewhere = Object.values(step.textures).filter((texture) => !makes.has(sameStoragePath(texture)));
      if (elsewhere.length > 0) {
        made.warnings.push(
          `The Asset Mod's ${file.from} (${file.path}) draws ${elsewhere.join(", ")}, which its Blueprint doesn't declare: the model shows ${elsewhere.length === 1 ? "it" : "them"} only if the package already holds ${elsewhere.length === 1 ? "it" : "them"}, or the game or another mod the map loads has ${elsewhere.length === 1 ? "it" : "them"}`,
        );
      }
    }
  }
  return { files: out, warnings: [...warnings, ...made.warnings] };
}

/** A package path's storage path, from its Assets/ folder on (`Base.SC2Assets/Assets/Textures/x.dds` is `Assets/Textures/x.dds`). */
const storagePathOf = (packagePath: string): string => /(?:^|\/)(assets\/.*)$/i.exec(packagePath)?.[1] ?? packagePath;

/** The derived steps `source` is made by, outermost first. */
const derivedSteps = (source: AssetSource): Extract<AssetSource, { derived: string }>[] => (isDerived(source) ? [source, ...derivedSteps(source.from)] : []);

/** What a compile's files are made with: the placeholders, the community archives and game models read so far, and the warnings. */
type Made = { readonly placeholders: ReadonlyMap<string, string>; readonly archives: Archives; readonly games: GameModels; readonly warnings: string[] };

/** A compile's community archives, each's members by name, keyed by the archive's SHA-256. */
type Archives = Map<string, Map<string, () => Buffer>>;
/** A compile's game models, each exported once: its .m3 and the textures it names, by their storage path compared as the game does. */
type GameModels = Map<string, Promise<{ readonly m3: Buffer; readonly textures: ReadonlyMap<string, Buffer> }>>;

/** The file `source` makes; `where` names the asset, for its warnings. */
async function make(source: AssetSource, options: MakeAssetsOptions, made: Made, where: string): Promise<Buffer> {
  if (isEncoded(source)) return options.derive(source.derived, await make(source.from, options, made, where));
  if (isDerived(source)) {
    const input = await make(source.from, options, made, where);
    if (source.derived === "retexture") {
      try {
        return Buffer.from(retextureM3(input, source.textures));
      } catch (error) {
        throw new Error(`retexture: ${(error as Error).message}`, { cause: error });
      }
    }
    try {
      const recolour = recolourTexel(source);
      // Only a hue turn is lost on grey; a saturation or lightness change still does what it says.
      if (source.hue !== undefined && source.hue % 360 !== 0 && (source.lightness ?? 1) === 1 && meanChroma(decodeDds(input)[0]!.rgba) < GREY) {
        made.warnings.push(`${where} turns the hue of a texture that is all but grey, which a hue turn barely changes: map it onto a gradient instead`);
      }
      return Buffer.from(recolourDds(input, recolour));
    } catch (error) {
      throw new Error(`recolour: the texture can't be recoloured, since ${(error as Error).message}`, { cause: error });
    }
  }
  if (isGenerated(source)) return readFile(made.placeholders.get(source.sound)!);
  if (isCommunityAsset(source)) return communityAsset(source, options, made.archives);
  if (isGameFile(source)) return gameFile(source, options, made.games);
  return workspaceFile(source, options.modDir);
}

/** A texture's mean chroma below which a hue shift is warned about. */
const GREY = 0.02;

/** The game file from the machine's game, its model exported with its textures through the Host Adapter the first time the compile needs it. */
async function gameFile(source: GameFileSource, options: MakeAssetsOptions, games: GameModels): Promise<Buffer> {
  const key = sameStoragePath(source.game);
  let job = games.get(key);
  if (!job) games.set(key, (job = exportGameModel(source.game, options)));
  const { m3, textures } = await job;
  if (source.member === undefined) return m3;
  const texture = textures.get(sameStoragePath(source.member));
  if (texture) return texture;
  const named = readM3TexturePaths(m3);
  throw new Error(
    named.some((name) => sameStoragePath(name) === sameStoragePath(source.member!))
      ? `the game's ${source.game} names ${source.member}, but the Host Adapter's export didn't write it`
      : `the game's ${source.game} doesn't name ${source.member}: it names ${named.join(", ") || "no texture"}`,
  );
}

async function exportGameModel(model: string, options: MakeAssetsOptions): Promise<{ readonly m3: Buffer; readonly textures: ReadonlyMap<string, Buffer> }> {
  const host = await options.host();
  if (!host.has("model.export")) {
    const adapter = host.adapter ? `${host.adapter.name}, from ${host.machine.file}` : "none";
    throw new Error(`a game file is exported from the game by the machine's Host Adapter, with model.export, and this machine's (${adapter}) doesn't have it`);
  }
  const scratch = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-game-file-"));
  try {
    const file = path.join(scratch, "model.m3");
    try {
      await host.run("model.export", { model, outputPath: file, textures: true });
    } catch (error) {
      throw new Error(`the game's ${model} couldn't be exported: ${(error as Error).message}`, { cause: error });
    }
    const m3 = await readFile(file);
    const textures = new Map<string, Buffer>();
    for (const texture of readM3TexturePaths(m3)) {
      // model.export writes each texture at its storage path under the model's folder.
      const written = path.join(scratch, ...texture.split(/[\\/]/));
      if (existsSync(written)) textures.set(sameStoragePath(texture), await readFile(written));
    }
    return { m3, textures };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Why this machine doesn't have the Workspace file `source`, if it doesn't: it isn't there, or it's a Git LFS pointer whose file hasn't been pulled. */
export async function absentProblem(source: WorkspaceFileSource, modDir: string): Promise<string | undefined> {
  const full = path.join(modDir, source.file);
  if (!existsSync(full)) return `${source.file} isn't there`;
  return isLfsPointer(await readFile(full)) ? `${source.file} is a Git LFS pointer, its file not pulled on this machine` : undefined;
}

/** Whether `bytes` are a Git LFS pointer file, as a checkout without the LFS objects has them. */
export const isLfsPointer = (bytes: Buffer): boolean => bytes.length < 1024 && bytes.subarray(0, LFS_POINTER.length).toString("latin1") === LFS_POINTER;
const LFS_POINTER = "version https://git-lfs.github.com/spec/v1";

/** Why the Workspace file `source` can't be used, if it can't: it isn't in the mod's folder, this machine doesn't have it, or it has another hash. */
export async function workspaceFileProblem(source: WorkspaceFileSource, modDir: string): Promise<string | undefined> {
  const full = path.join(modDir, source.file);
  if (!(await isInside(modDir, full))) return `${source.file} isn't in the mod's folder ${modDir}`;
  const absent = await absentProblem(source, modDir);
  if (absent) return absent;
  const found = sha256(await readFile(full));
  return found === source.sha256 ? undefined : `${source.file} has the SHA-256 ${found}, not the ${source.sha256} the Blueprint records: put back the file it records, or record this one's hash`;
}

async function workspaceFile(source: WorkspaceFileSource, modDir: string): Promise<Buffer> {
  const problem = await workspaceFileProblem(source, modDir);
  if (problem) throw new Error(problem);
  return readFile(path.join(modDir, source.file));
}

/** The community asset from the machine's cache, fetched into it first when it isn't there; its member, when it names one in the archive. */
async function communityAsset(source: CommunityAssetSource, options: MakeAssetsOptions, archives: Archives): Promise<Buffer> {
  if (source.member === undefined) return communityDownload(source, options);
  let members = archives.get(source.sha256);
  if (!members) {
    const download = await communityDownload(source, options);
    try {
      members = zipMembers(download);
    } catch (error) {
      throw new Error(`${source.url} (version ${source.version}) names the member ${source.member}, but the download can't be read as a zip archive: ${(error as Error).message}`, { cause: error });
    }
    archives.set(source.sha256, members);
  }
  const member = members.get(source.member);
  if (!member) throw new Error(`${source.url} (version ${source.version}) has no ${source.member}: it has ${[...members.keys()].join(", ")}`);
  return member();
}

/** The download of a community asset, from the machine's cache, fetched into it first when it isn't there. */
async function communityDownload(source: CommunityAssetSource, options: MakeAssetsOptions): Promise<Buffer> {
  const cacheDir = hostContext((await options.host()).machine).requirePath("cacheDir");
  const folder = path.join(cacheDir, "community-assets", source.sha256);
  const name = path.basename(new URL(source.url).pathname) || "asset";
  const cached = path.join(folder, name);
  if (existsSync(cached)) {
    const bytes = await readFile(cached);
    if (sha256(bytes) === source.sha256) return bytes;
  }
  const response = await options.fetch(source.url);
  if (!response.ok) throw new Error(`${source.url} (version ${source.version}) couldn't be fetched: ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const found = sha256(bytes);
  if (found !== source.sha256) throw new Error(`${source.url} (version ${source.version}) downloaded with the SHA-256 ${found}, not the ${source.sha256} the Blueprint records: check the version, and record the new hash only once its licence (${source.licence}) is checked again`);
  await mkdir(folder, { recursive: true });
  const partial = `${cached}.partial`;
  await writeFile(partial, bytes);
  await rename(partial, cached);
  return bytes;
}

/** Writes the placeholder of each generated Sound into placeholders/, a conversation at a time; their WAVs by Sound, and the Sounds whose spoken placeholder may be out of date. */
async function writePlaceholders(plan: AssetPlan, options: MakeAssetsOptions): Promise<{ readonly files: Map<string, string> } & Pick<PlaceholderVoices, "outdated" | "unhashed" | "failed">> {
  const wanted = new Set(plan.files.flatMap((file) => (file.held ? [] : generatedSounds(file.source))));
  const out = new Map<string, string>();
  const outdated: string[] = [];
  const unhashed: string[] = [];
  const failed: PlaceholderVoices["failed"][number][] = [];
  if (wanted.size === 0) return { files: out, outdated, unhashed, failed };
  const dir = path.join(options.modDir, PLACEHOLDERS_DIR);
  const host = await options.host();
  const byScript = new Map<ModScript, Set<string>>();
  for (const sound of wanted) {
    const { script } = plan.lines.get(sound)!;
    byScript.set(script, (byScript.get(script) ?? new Set()).add(sound));
    out.set(sound, path.join(dir, `${sound}.wav`));
  }
  // Stale placeholders are made again; a line the Host Adapter fails to speak gets silence (or keeps its file), as a Mission's compile does.
  for (const [script, sounds] of byScript) {
    // Kept as WAVs: an .ogg voice is derived from its placeholder by its own wav-to-ogg step.
    const written = await writePlaceholderVoices(host, onlySounds(script, sounds), dir, "stale", { format: "wav", silenceOnFailure: true });
    outdated.push(...written.outdated);
    unhashed.push(...written.unhashed);
    failed.push(...written.failed);
  }
  return { files: out, outdated, unhashed, failed };
}

/** `script` with only the lines playing `sounds`, each named by its Sound, as its placeholder's file is. */
function onlySounds({ screenplay, script }: ModScript, sounds: ReadonlySet<string>): Script {
  const sound = (line: ScriptLine): string => lineSound(screenplay, line);
  return {
    ...script,
    scenes: script.scenes.map((scene) => ({
      ...scene,
      items: scene.items.flatMap((item) => (item.kind !== "line" ? [] : sounds.has(sound(item)) ? [{ ...item, soundId: sound(item) }] : [])),
    })),
  };
}

const run = promisify(execFile);

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** A placeholder as the compile reports it. */
export const formatPlaceholder = (placeholder: Placeholder): string => `Placeholder voice: ${placeholder.path}, for ${placeholder.line} (${placeholder.speaker}), since ${placeholder.reason}`;

/**
 * Which of `files` (package paths) git tracks in the package at `pkg`: an uncommitted file that's
 * tracked, such as a recording a placeholder now stands in for, would be committed over it. None
 * outside a git repository.
 */
export async function trackedByGit(pkg: string, files: readonly string[]): Promise<string[]> {
  if (files.length === 0) return [];
  try {
    // Each path as it is, not a glob: a file named gull[1].dds is that file alone.
    const { stdout } = await run("git", ["--literal-pathspecs", "ls-files", "-z", "--", ...files], { cwd: pkg, maxBuffer: 16 * 1024 * 1024 });
    return stdout.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}
