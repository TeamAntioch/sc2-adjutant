// Placeholder voice lines for a Screenplay: one per line at its final path,
// `<audioDir>/<sound id>.<format>`, so Transmissions time correctly and real recordings drop in
// later. The format is the Mission's voice format, .ogg unless its Blueprint says .wav: each line
// is made as a 16-bit mono WAV, trimmed, then encoded to Ogg Vorbis with ffmpeg (host/derive.ts).
// The Host Adapter speaks them when it has `tts.speak`; otherwise core writes silence of the
// line's estimated length. A spoken line is trimmed to its speech before it is encoded, so a
// Cinematic that times its lines by their files leaves no gap after each. A manifest in the
// folder records what each placeholder was made from and its file's hash, so unchanged lines are
// skipped and a file it didn't write (a real recording, in either format) is never replaced
// (host/voice-files.ts says which of a line's two files is its voice).

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { type Script, scriptLines } from "../script/name-script.js";
import { estimateLineSeconds } from "../triggers/build-mission-triggers.js";
import { type Derive, machineDerive } from "./derive.js";
import type { Host } from "./host.js";
import { DEFAULT_VOICE_FORMAT, findVoiceFile, type ManifestEntry, PLACEHOLDER_MANIFEST, readPlaceholderManifest, sha1, type VoiceFormat, voiceFilePath } from "./voice-files.js";
import { pcmFormat, wavChunks, wavFile, wavSeconds } from "./wav.js";

export { PLACEHOLDER_MANIFEST } from "./voice-files.js";

/** The voice for a line whose character gives none; the Campaign Pack's characters give the rest. */
export const DEFAULT_VOICE = "Eddy (English (US))";

export type PlaceholderVoices = {
  readonly audioDir: string;
  /** Sound ids of the lines the Host Adapter spoke. */
  readonly spoken: readonly string[];
  /** Sound ids of the lines that got silence. */
  readonly silent: readonly string[];
  /** Sound ids of spoken placeholders whose text changed, kept because the host can't speak. */
  readonly outdated: readonly string[];
  /**
   * Sound ids of voice files an old manifest records without the file's hash and that no longer
   * match their line: each might since be a real recording, so it is kept. `adoptUnhashed`
   * vouches that they are placeholders.
   */
  readonly unhashed: readonly string[];
  /** Sound ids of spoken placeholders written before core trimmed them, trimmed in place now (`stale` mode only). */
  readonly trimmed: readonly string[];
  /** Sound ids of up-to-date .wav placeholders encoded to .ogg in place, for a Mission whose voice format is .ogg (`stale` mode only). */
  readonly converted: readonly string[];
  /** Sound ids whose placeholder was deleted because a recording, in the other format, now voices the line (`stale` mode only). */
  readonly superseded: readonly string[];
  /** Lines the Host Adapter failed to speak in `missing` mode (or with `silenceOnFailure`), which got silence or kept their file, and why. */
  readonly failed: readonly { readonly soundId: string; readonly reason: string }[];
};

/**
 * Which lines to write:
 * - `missing`: only lines with no voice file in either format, as a compile does; nothing on disk
 *   is replaced, but for an .ogg placeholder of a "wav" Mission, which its package can't take.
 * - `stale`: also lines whose placeholder no longer matches, because its text changed, because
 *   the host can now speak a line that is silent, or because it is in the other format. A spoken
 *   placeholder is never replaced by silence, and a voice file that isn't the placeholder the
 *   manifest records (a real recording) is never replaced.
 */
export type PlaceholderMode = "missing" | "stale";

export type PlaceholderOptions = {
  /** The format placeholders are written in: the Mission's voice format, .ogg by default. */
  readonly format?: VoiceFormat;
  /** Encodes a WAV to Ogg Vorbis; the machine's ffmpeg, cached by content, by default. */
  readonly derive?: Derive;
  /**
   * The author vouches that every voice file an old manifest records without its hash is still
   * the placeholder it wrote, not a recording: each entry gets the file's hash, so a line whose
   * text changed is written again like any other.
   */
  readonly adoptUnhashed?: boolean;
  /**
   * In `stale` mode, a line the Host Adapter fails to speak is reported in `failed` instead of
   * stopping the run, as in `missing` mode: it gets silence when it has no voice file yet, and
   * keeps the one it has otherwise (a spoken placeholder is never replaced by silence).
   */
  readonly silenceOnFailure?: boolean;
};

/** The writes running or queued for each audio folder, so two callers never share a manifest at once. */
const writing = new Map<string, Promise<unknown>>();

export async function writePlaceholderVoices(host: Host, script: Script, audioDir: string, mode: PlaceholderMode, options: PlaceholderOptions = {}): Promise<PlaceholderVoices> {
  const key = path.resolve(audioDir);
  const run = (writing.get(key) ?? Promise.resolve()).then(() => writeVoices(host, script, audioDir, mode, options));
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  writing.set(key, settled);
  void settled.then(() => {
    if (writing.get(key) === settled) writing.delete(key);
  });
  return run;
}

async function writeVoices(host: Host, script: Script, audioDir: string, mode: PlaceholderMode, options: PlaceholderOptions): Promise<PlaceholderVoices> {
  const speaks = host.has("tts.speak");
  const format = options.format ?? DEFAULT_VOICE_FORMAT;
  const derive = options.derive ?? machineDerive(host.machine);
  /** A made WAV in the placeholders' format. */
  const encoded = async (wav: Buffer): Promise<Buffer> => (format === "ogg" ? derive("wav-to-ogg", wav) : wav);
  const manifestPath = path.join(audioDir, PLACEHOLDER_MANIFEST);
  const manifest: Record<string, ManifestEntry> = await readPlaceholderManifest(audioDir);
  const saveManifest = (): Promise<void> => writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const spoken: string[] = [];
  const silent: string[] = [];
  const outdated: string[] = [];
  const unhashed: string[] = [];
  const trimmed: string[] = [];
  const converted: string[] = [];
  const superseded: string[] = [];
  let adopted = false;
  const failed: { soundId: string; reason: string }[] = [];

  for (const line of scriptLines(script)) {
    const target = voiceFilePath(audioDir, line.soundId, format);
    // A line with no words has nothing to speak (a speech engine writes a broken file for it): it gets silence.
    const voice = speaks && line.text.trim() !== "" ? (line.voice ?? DEFAULT_VOICE) : undefined;
    const from = voice === undefined ? silentKey(line.text) : spokenKey(voice, line.text);
    const text = textKey(line.text);
    let found = await findVoiceFile(audioDir, line.soundId, format, manifest, { hashAlways: true });
    const old = manifest[line.soundId];
    if (found && typeof old === "string" && options.adoptUnhashed) {
      // Vouched for as a placeholder: an older npm run tts only ever wrote .wav files, so the .wav
      // gets the hash (and its text's, when its key shows the text unchanged). An .ogg beside it is
      // then a recording, which voices the line; a line with only an .ogg is left, and reported.
      const wav = [found, found.other].find((file) => file?.format === "wav");
      if (wav) {
        manifest[line.soundId] = { from: old, sha1: sha1(await readFile(wav.path)), ...(old === from ? { text } : {}) };
        adopted = true;
        found = await findVoiceFile(audioDir, line.soundId, format, manifest, { hashAlways: true });
      }
    }
    // An .ogg placeholder can't go into a "wav" Mission's package: it is made again as a .wav, even
    // on a compile, and even as silence on a host that can't speak, so the Mission still compiles.
    const unusable = found !== undefined && found.placeholder && found.format === "ogg" && format === "wav";
    // The placeholder file this line has now, which a new one replaces, in either format.
    let replaced: string | undefined = unusable ? found!.path : undefined;
    if (found && !unusable) {
      if (mode === "missing") continue;
      const file = found.path;
      let entry = manifest[line.soundId];
      // A file the manifest doesn't know, or that changed since it was written, is a real recording.
      if (!found.placeholder && (entry === undefined || typeof entry === "object")) {
        // A placeholder in the other format that it took the place of is ours, and goes.
        if (found.other?.placeholder) {
          await rm(found.other.path, { force: true });
          delete manifest[line.soundId];
          await saveManifest();
          superseded.push(line.soundId);
        }
        continue;
      }
      if (typeof entry === "string") {
        // An old entry without the file's hash: it may be a recording by now, so it is only reported.
        if (entry !== from) unhashed.push(line.soundId);
        continue;
      }
      entry = entry!;
      replaced = file;
      const spokenEntry = !entry.from.startsWith(SILENT);
      // A spoken placeholder that's still its line's, written before core trimmed them: trimmed in
      // place, without speaking it again (a host that can't speak can still trim). Only a WAV can be.
      const current = entry.from === from || (voice === undefined && spokenEntry && entry.text === text);
      if (current && spokenEntry && !entry.trimmed) {
        const cut = found.format === "wav" ? trimSilence(await readFile(file)) : undefined;
        entry = { ...entry, ...(cut ? { sha1: sha1(cut) } : {}), trimmed: true };
        manifest[line.soundId] = entry;
        if (cut) {
          await writeFile(file, cut);
          trimmed.push(line.soundId);
        }
        await saveManifest();
      }
      // A current placeholder in the other format: a .wav is encoded to .ogg as it is, without
      // speaking it again; an .ogg is made again as a .wav, below, when the host can speak it.
      if (current && found.format !== format && format === "ogg") {
        const ogg = await encoded(await readFile(file));
        await writeAtomically(target, ogg);
        manifest[line.soundId] = { ...entry, sha1: sha1(ogg) };
        await rm(file, { force: true });
        await saveManifest();
        converted.push(line.soundId);
        continue;
      }
      if (entry.from === from && found.format === format) continue;
      // Without a voice, a spoken placeholder stays: up to date if its text is unchanged, else out of date.
      if (voice === undefined && spokenEntry) {
        if (entry.text !== text) outdated.push(line.soundId);
        continue;
      }
    }

    // Made beside the final path, then moved there, so a failure never leaves half a file.
    await mkdir(audioDir, { recursive: true });
    const partial = path.join(audioDir, `.${line.soundId}.partial.wav`);
    let made = voice === undefined ? ("silent" as const) : ("spoken" as const);
    try {
      if (voice !== undefined) {
        try {
          await host.run("tts.speak", { text: line.text, character: line.character, voice, outputPath: partial });
        } catch (error) {
          // A compile still gets a voice file for every line: silence, with the reason reported.
          if (mode !== "missing" && !options.silenceOnFailure) throw error;
          failed.push({ soundId: line.soundId, reason: error instanceof Error ? error.message : String(error) });
          if (found && !unusable) continue;
          made = "silent";
        }
      }
      const spokenWav = made === "spoken" ? await readFile(partial) : undefined;
      // A speech engine given nothing it can say (`say` on "...") writes a WAV with no samples:
      // the line is reported as silent, and gets its silence. Its entry keeps the spoken key, as
      // speaking it again would give nothing again, until its voice or text changes; its silence
      // needs no trim.
      const unspoken = spokenWav !== undefined && wavSeconds(spokenWav) === 0;
      // Trimmed to its speech as a WAV, before it is encoded.
      const wav = spokenWav === undefined || unspoken ? silentWav(estimateLineSeconds(line.text)) : (trimSilence(spokenWav) ?? spokenWav);
      const written = await encoded(wav);
      await writeAtomically(target, written);
      if (replaced && replaced !== target) await rm(replaced, { force: true });
      manifest[line.soundId] = made === "silent" ? { from: silentKey(line.text), sha1: sha1(written), text } : { from, sha1: sha1(written), text, trimmed: true };
      if (unspoken) made = "silent";
    } finally {
      await rm(partial, { force: true });
    }
    (made === "silent" ? silent : spoken).push(line.soundId);
    // Saved after each line, so a later failure doesn't orphan the lines already written.
    await saveManifest();
  }

  // Adopted entries are saved even when no line was written.
  if (adopted) await saveManifest();
  return { audioDir, spoken, silent, outdated, unhashed, trimmed, converted, superseded, failed };
}

/** Writes `bytes` beside `file`, then moves them there. */
async function writeAtomically(file: string, bytes: Buffer): Promise<void> {
  const partial = path.join(path.dirname(file), `.${path.basename(file)}.partial`);
  try {
    await writeFile(partial, bytes);
    await rename(partial, file);
  } finally {
    await rm(partial, { force: true });
  }
}

const SILENT = "silent:";

/** As `npm run tts` has always keyed a spoken line, so existing manifests stay valid. */
function spokenKey(voice: string, text: string): string {
  return sha1(Buffer.from(`${voice}\n${text}`));
}

function textKey(text: string): string {
  return sha1(Buffer.from(text));
}

function silentKey(text: string): string {
  return `${SILENT}${sha1(Buffer.from(text))}`;
}

/** The sample rate and format `npm run tts` has always written: 16-bit mono at 22050 Hz. */
export const PLACEHOLDER_SAMPLE_RATE = 22050;

/** A 16-bit mono PCM WAV of silence. */
export function silentWav(seconds: number): Buffer {
  return wavFile(pcmFormat(1, PLACEHOLDER_SAMPLE_RATE, 16), Buffer.alloc(Math.round(seconds * PLACEHOLDER_SAMPLE_RATE) * 2));
}

/** Below this, a 16-bit sample is silence: about -50 dBFS, under a speech engine's quietest breath. */
export const SILENCE_LEVEL = 100;
/** Kept at each end of a trimmed line, so its first and last sounds don't start or stop abruptly. */
export const TRIM_MARGIN_SECONDS = 0.05;

/**
 * A 16-bit PCM WAV with the silence at its ends cut, past a short margin; undefined when it isn't
 * one, when it's silent all through, or when there's nothing to cut. Other chunks (a speech
 * engine's padding) are dropped: the result is a plain fmt and data file.
 */
export function trimSilence(wav: Buffer): Buffer | undefined {
  const { format, data } = wavChunks(wav) ?? {};
  if (!format || format.length < 16 || !data || format.readUInt16LE(0) !== 1 || format.readUInt16LE(14) !== 16) return undefined;
  const channels = format.readUInt16LE(2);
  const rate = format.readUInt32LE(4);
  const frameBytes = channels * 2;
  const frames = Math.floor(data.length / frameBytes);
  const loud = (frame: number): boolean => {
    for (let channel = 0; channel < channels; channel++) if (Math.abs(data!.readInt16LE(frame * frameBytes + channel * 2)) > SILENCE_LEVEL) return true;
    return false;
  };
  let first = 0;
  while (first < frames && !loud(first)) first++;
  if (first === frames) return undefined;
  let last = frames - 1;
  while (!loud(last)) last--;
  const margin = Math.round(TRIM_MARGIN_SECONDS * rate);
  const from = Math.max(0, first - margin);
  const to = Math.min(frames, last + 1 + margin);
  if (from === 0 && to === frames && wav.length === 44 + frames * frameBytes) return undefined;
  return wavFile(format.subarray(0, 16), data.subarray(from * frameBytes, to * frameBytes));
}
