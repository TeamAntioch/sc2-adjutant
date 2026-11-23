// A Mission's voice files in its Screenplay's `audioDir`: each line's is `<sound id>.ogg` or
// `<sound id>.wav`, a real recording or a placeholder `npm run tts` (or a compile) wrote. The
// placeholders' manifest records the hash of each file it wrote, so a file it doesn't know, or
// that changed since, is a recording. When a line has both files, a recording wins over a
// placeholder; two recordings, or a placeholder and a file an old manifest recorded without its
// hash, are settled by the Mission's voice format (`screenplay.script.voiceFormat`).

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { VOICE_FORMATS } from "../domain/asset-source.js";
import type { Derive } from "./derive.js";

export type VoiceFormat = (typeof VOICE_FORMATS)[number];

/** A Mission's voice format when its Blueprint gives none: placeholders are .ogg, and the Map Package's voice files are. */
export const DEFAULT_VOICE_FORMAT: VoiceFormat = "ogg";

export const PLACEHOLDER_MANIFEST = "manifest.json";

/**
 * What a placeholder was made from, the hash of the file written, so a file replaced since (a real
 * recording) is recognised, and the hash of its text, so a host that can't speak can still tell
 * an unchanged spoken line. `npm run tts` used to record only the first, as a string; such a file
 * can't be checked, so it is never replaced, only reported, unless the author adopts it.
 */
export type ManifestEntry = string | { readonly from: string; readonly sha1: string; readonly text?: string; readonly trimmed?: boolean };
export type PlaceholderManifest = Record<string, ManifestEntry>;

/**
 * The placeholders' manifest in `audioDir`, empty when there is none. A manifest that can't be
 * read throws, unless `lenient`: a reader that only finds and times voice files (a check, a
 * Cinematic's timing, a compile's copy) gets an empty one then, so a line's voice file is chosen
 * by the voice format alone. The writer stays strict, so a broken manifest never forgets which
 * files are its placeholders.
 */
export async function readPlaceholderManifest(audioDir: string, { lenient = false }: { readonly lenient?: boolean } = {}): Promise<PlaceholderManifest> {
  const file = path.join(audioDir, PLACEHOLDER_MANIFEST);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(await readFile(file, "utf8")) as PlaceholderManifest;
  } catch (error) {
    if (lenient) return {};
    throw new Error(`${file} can't be read (${(error as Error).message}): fix it or delete it (a deleted manifest makes every voice file there count as a recording)`, { cause: error });
  }
}

export function sha1(data: Uint8Array): string {
  return createHash("sha1").update(data).digest("hex");
}

/** A line's voice file in `audioDir`. */
export type VoiceFile = {
  readonly path: string;
  readonly format: VoiceFormat;
  /**
   * Whether it is the placeholder the manifest records, by its hash. Worked out only when the
   * line has both files, or when asked for (`hashAlways`); false otherwise.
   */
  readonly placeholder: boolean;
  /** The line's other file, in the other format, that this one won over. */
  readonly other?: Omit<VoiceFile, "other" | "unhashed">;
  /** Whether the manifest's entry for the line is an old one, without a file's hash, so neither file can be told from a recording. */
  readonly unhashed: boolean;
};

/** The path of `soundId`'s voice file in `format`. */
export const voiceFilePath = (audioDir: string, soundId: string, format: VoiceFormat): string => path.join(audioDir, `${soundId}.${format}`);

/**
 * `soundId`'s voice file in `audioDir`, if it has one: a recording over a placeholder, else the
 * one in `format` (see the top of this file). Files are hashed only to choose between two, unless
 * `hashAlways`, as the placeholder writer asks.
 */
export async function findVoiceFile(audioDir: string, soundId: string, format: VoiceFormat, manifest: PlaceholderManifest, { hashAlways = false }: { readonly hashAlways?: boolean } = {}): Promise<VoiceFile | undefined> {
  const entry = manifest[soundId];
  const unhashed = typeof entry === "string";
  const present = [format, ...VOICE_FORMATS.filter((other) => other !== format)].map((candidate) => ({ path: voiceFilePath(audioDir, soundId, candidate), format: candidate })).filter((file) => existsSync(file.path));
  if (present.length === 0) return undefined;
  const hashed = hashAlways || present.length > 1;
  const [first, second] = await Promise.all(present.map(async (file) => ({ ...file, placeholder: hashed && typeof entry === "object" && entry.sha1 === sha1(await readFile(file.path)) })));
  if (!second) return { ...first!, unhashed };
  const [winner, other] = first!.placeholder && !second.placeholder ? [second, first!] : [first!, second];
  return { ...winner, other, unhashed };
}

/** Each line's voice file in `audioDir`, by its sound ID, for those that have one (the manifest read leniently). */
export async function findVoiceFiles(audioDir: string, soundIds: Iterable<string>, format: VoiceFormat): Promise<Map<string, VoiceFile>> {
  const manifest = await readPlaceholderManifest(audioDir, { lenient: true });
  const out = new Map<string, VoiceFile>();
  for (const soundId of soundIds) {
    const file = await findVoiceFile(audioDir, soundId, format, manifest);
    if (file) out.set(soundId, file);
  }
  return out;
}

/** A warning for a line with both an .ogg and a .wav when neither is known to be its placeholder, or undefined. */
export function twoFilesWarning(soundId: string, audioDir: string, file: VoiceFile): string | undefined {
  if (!file.other || file.placeholder || file.other.placeholder) return undefined;
  const settled = `the .${file.format} voices it (the Mission's voice format)`;
  return file.unhashed
    ? `${soundId} has two voice files in ${audioDir}, a .ogg and a .wav, and its manifest entry is an old one with no hash, so neither can be told from a recording: ${settled}. If the .wav is the placeholder an older npm run tts wrote, run npm run tts -- <blueprint> --adopt-unhashed, which deletes it; otherwise remove the one that shouldn't voice the line`
    : `${soundId} has two voice files in ${audioDir}, a .ogg and a .wav, and neither is its placeholder: ${settled}; remove the other`;
}

/**
 * What goes into the Map Package for each line with a voice file, by its sound ID, in `format`:
 * a file in that format, copied as it is, or a .wav encoded to Ogg Vorbis by `derive` for an
 * "ogg" Mission. An .ogg can't go into a "wav" Mission's package, which takes only .wav files.
 * With a warning for each line with two files that neither is known to be the placeholder of.
 */
export async function packageVoiceFiles(
  audioDir: string,
  soundIds: readonly string[],
  format: VoiceFormat,
  derive: Derive,
): Promise<{ readonly files: Map<string, Uint8Array | { readonly copyFrom: string }>; readonly missing: readonly string[]; readonly warnings: readonly string[] }> {
  const found = await findVoiceFiles(audioDir, soundIds, format);
  const files = new Map<string, Uint8Array | { readonly copyFrom: string }>();
  const missing: string[] = [];
  const warnings: string[] = [];
  for (const soundId of soundIds) {
    const file = found.get(soundId);
    if (!file) {
      missing.push(soundId);
      continue;
    }
    const warning = twoFilesWarning(soundId, audioDir, file);
    if (warning) warnings.push(warning);
    if (file.format === format) files.set(soundId, { copyFrom: file.path });
    else if (format === "ogg") files.set(soundId, await derive("wav-to-ogg", await readFile(file.path)));
    else throw new Error(`${file.path} is an .ogg, but the Mission's voice format is wav (screenplay.script.voiceFormat), which takes only .wav files: give the line a .wav, or set voiceFormat to "ogg"`);
  }
  return { files, missing, warnings };
}
