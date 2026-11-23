// The named steps that make one file from another (domain/asset-source.ts's DERIVE_STEPS), with
// the machine's ffmpeg: an Asset Mod's derived Asset Sources and a Mission's voice files are both
// made by them. Each output is kept in a cache keyed by the step and the input's SHA-256, so a
// repeat compile writes the bytes it wrote before without encoding again, even after the machine's
// ffmpeg changes, and a package's compile record stays as it was.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";

import type { DeriveStep } from "../domain/asset-source.js";
import type { MachineConfig } from "./machine-config.js";
import { frameBytes, unsigned8Bit, wavChunks, wavFile, wavSeconds } from "./wav.js";

/** Makes a file by a named step from its source's bytes. */
export type Derive = (step: DeriveStep, input: Buffer) => Promise<Buffer>;

/** How to install ffmpeg on `platform`: winget's BtbN build on Windows (it has arm64 and libvorbis), else Homebrew's. */
export function ffmpegInstallHint(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "winget install BtbN.FFmpeg.GPL.9.0" : "brew install ffmpeg";
}

/**
 * The named steps, with ffmpeg: wav-to-ogg encodes Vorbis (libvorbis when ffmpeg has it, else its
 * own encoder), with nothing that changes from run to run. Each run is bounded (`runBounded`):
 * ffmpeg's own Vorbis encoder never finishes a WAV with no samples, writing output for as long as
 * it's left to run (one filled a 2 TB disk in 11 days), so it is given one silent sample frame
 * instead, and a run that goes wrong some other way is stopped.
 */
export const ffmpegDerive: Derive = async (step, input) => {
  const seconds = wavSeconds(input);
  // Never more seconds than any WAV of the input's size lasts, whatever its header claims: an input
  // this can't read, or whose sample rate is nonsense, is bounded by its size.
  const estimated = Math.min(seconds ?? Infinity, input.length / MIN_BYTES_PER_SECOND);
  const limits = encodeLimits(estimated);
  const dir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-derive-"));
  try {
    const from = path.join(dir, "in.wav");
    const to = path.join(dir, "out.ogg");
    await writeFile(from, input);
    // -fs only stops ffmpeg writing; runBounded's limits stop ffmpeg.
    const args = (codec: string[]) => ["-nostdin", "-loglevel", "error", "-y", "-i", from, "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", ...codec, "-fs", String(limits.maxOutputBytes), to];
    const failed = (error: unknown) => new Error(`The ${step} step failed: ${(error as Error).message}`, { cause: error });
    try {
      await runBounded("ffmpeg", args(["-c:a", "libvorbis"]), limits);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`The ${step} step needs ffmpeg on the PATH (${ffmpegInstallHint()})`, { cause: error });
      // Only an ffmpeg without libvorbis tries again, with its own Vorbis encoder, which takes only
      // stereo: not a libvorbis that failed, timed out or was capped.
      if (!/Unknown encoder 'libvorbis'/.test(String((error as { stderr?: unknown }).stderr ?? ""))) throw failed(error);
      if (seconds === 0) await writeFile(from, oneSilentFrame(input));
      try {
        await runBounded("ffmpeg", args(["-c:a", "vorbis", "-strict", "-2", "-ac", "2"]), limits);
      } catch (retryError) {
        throw failed(retryError);
      }
    }
    if ((await stat(to)).size >= limits.maxOutputBytes) throw new Error(`The ${step} step's output reached ${limits.maxOutputBytes} bytes, far more than an input of at most ${Math.ceil(estimated)} s makes, and was stopped`);
    return await readFile(to);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/** Fewer bytes a second than any WAV holds, even GSM 6.10's 1625, so a byte count over it is more seconds than any WAV of that size lasts. */
const MIN_BYTES_PER_SECOND = 1000;

/** A WAV with `wav`'s format and one sample frame of silence (0x80 for 8-bit PCM, which is unsigned): what ffmpeg's own Vorbis encoder is given for a WAV with no samples. */
function oneSilentFrame(wav: Buffer): Buffer {
  const format = wavChunks(wav)!.format!;
  return wavFile(format, Buffer.alloc(frameBytes(format), unsigned8Bit(format) ? 0x80 : 0));
}

/** How long one encode of an input `seconds` long may run, and how big its output may grow: far past what a real encode takes. */
export function encodeLimits(seconds: number): RunLimits {
  const whole = Math.ceil(seconds);
  // Vorbis at its highest quality is about 500 kbit/s for stereo: 64 KiB a second is more.
  // setTimeout takes at most 2^31 - 1 ms (about 24 days), and fires at once past it.
  return { timeoutMs: Math.min((60 + 2 * whole) * 1000, MAX_TIMEOUT_MS), maxOutputBytes: 1024 * 1024 + whole * 64 * 1024 };
}

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** What the kernel's cap allows past maxOutputBytes, so -fs, which lags ffmpeg's buffered writes, stops ffmpeg first. */
const KERNEL_CAP_HEADROOM = 256 * 1024;

/** The blocks `ulimit -f` is given for a run whose output may reach `maxOutputBytes`. */
export function kernelCapBlocks(maxOutputBytes: number): number {
  // ulimit -f counts blocks of 512 bytes (POSIX, dash) or 1024 (bash, even as macOS's sh): counted
  // in 512s, the cap is maxOutputBytes plus the headroom, or twice that.
  return Math.ceil((maxOutputBytes + KERNEL_CAP_HEADROOM) / 512);
}

/** The limits on one bounded run. */
export interface RunLimits {
  /** How long it may run before it is sent SIGTERM, then its process group SIGKILL `killGraceMs` later. */
  readonly timeoutMs: number;
  /** How big a file it may write: -fs stops ffmpeg here; the kernel stops any command 256 KiB past it, or past twice that, by the shell's block size. */
  readonly maxOutputBytes: number;
  /** How long it has to stop after SIGTERM before SIGKILL. */
  readonly killGraceMs?: number;
}

/**
 * Runs the command in a shell that bounds it, in a process group of its own. ffmpeg can ignore
 * SIGTERM, and outlive the process that started it, so: its files are capped by `ulimit -f`, which
 * the kernel enforces whatever becomes of this process; a watcher in the shell SIGKILLs it when
 * this process's end of its stdin closes, which happens however this process ends, even by
 * SIGKILL; and past the timeout the shell passes SIGTERM on to it, the watcher still watching,
 * and the whole group is sent SIGKILL after the grace. A subshell's traps are reset, so the
 * watcher keeps SIGTERM's default; only the shell is sent it. The shell tells this process, on its
 * stdout (the command's goes to /dev/null), when the command isn't there ("missing") and when a
 * lower file-size limit it was given stays ("limit <blocks>").
 */
const BOUNDED = [
  // A lower limit this shell was given stays: it can't be raised past its hard limit anyway.
  'current=$(ulimit -f)',
  'if [ "$current" = unlimited ] || [ "$current" -gt "$1" ]; then ulimit -f "$1" || exit 125; else echo "limit $current"; fi',
  "shift",
  'command -v "$1" >/dev/null 2>&1 || { echo missing; exit 127; }',
  "child=",
  "termed=",
  `trap 'termed=1; [ -n "$child" ] && kill -TERM "$child" 2>/dev/null' TERM`,
  // The watcher keeps this shell's stdin as fd 3; the command gets neither.
  "exec 3<&0 0</dev/null",
  '"$@" 3<&- >/dev/null &',
  "child=$!",
  '{ while read -r _ <&3; do :; done; kill -KILL "$child"; } >/dev/null 2>&1 &',
  "watcher=$!",
  "exec 3<&-",
  'wait "$child"',
  "status=$?",
  // A SIGTERM ends the wait early: wait again, until the command is gone (127: no such child).
  'while [ -n "$termed" ]; do termed=; wait "$child"; next=$?; [ "$next" -eq 127 ] || status=$next; done',
  'kill "$watcher" 2>/dev/null',
  'exit "$status"',
].join("\n");

/** `command` run with its arguments within `limits`; rejected with its stderr when it fails, with code ENOENT when it isn't there. */
export function runBounded(command: string, args: readonly string[], limits: RunLimits): Promise<{ readonly stderr: string }> {
  const posix = process.platform !== "win32";
  const blocks = String(kernelCapBlocks(limits.maxOutputBytes));
  const child = posix
    ? spawn("/bin/sh", ["-c", BOUNDED, "sh", blocks, command, ...args], { detached: true, stdio: ["pipe", "pipe", "pipe"] })
    : spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  const signal = (name: NodeJS.Signals, group: boolean) => {
    try {
      if (posix && child.pid !== undefined) process.kill(group ? -child.pid : child.pid, name);
      else child.kill(name);
    } catch {
      // Already gone.
    }
  };
  return new Promise((resolve, reject) => {
    let stderr = "";
    let said = "";
    let timedOut = false;
    let killer: NodeJS.Timeout | undefined;
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (said.length < 1024) said += chunk;
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      if (stderr.length < 64 * 1024) stderr += chunk;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      signal("SIGTERM", false);
      killer = setTimeout(() => signal("SIGKILL", true), limits.killGraceMs ?? 5000);
    }, limits.timeoutMs);
    const settle = () => {
      clearTimeout(timer);
      clearTimeout(killer);
      child.stdin?.destroy();
    };
    child.once("error", (error) => {
      settle();
      reject(Object.assign(error, { stderr }));
    });
    // Not "exit": the command holds stderr open for as long as it runs, even past its shell.
    child.once("close", (code, by) => {
      settle();
      // A command that finished as the timer fired still finished.
      if (code === 0) return resolve({ stderr });
      const lines = said.split("\n");
      if (lines.includes("missing")) return reject(Object.assign(new Error(`${command} was not found`), { code: "ENOENT", stderr }));
      const why = stderr.trim() ? `: ${stderr.trim()}` : "";
      if (timedOut) return reject(Object.assign(new Error(`${command} ran past ${Math.round(limits.timeoutMs / 1000)} s and was stopped${why}`), { stderr }));
      const how = by ? `was stopped by ${by}` : `exited with ${code}`;
      // The shell exits 128 + SIGXFSZ (25) when the kernel stops its command at the cap: this
      // process's, or a lower one the shell was given.
      const inherited = lines.find((line) => line.startsWith("limit "))?.slice("limit ".length);
      const cap = inherited === undefined ? `${limits.maxOutputBytes} bytes` : `the file-size limit of ${inherited} blocks (ulimit -f) it was started with`;
      const capped = posix && code === 128 + 25 ? `: its output passed ${cap}` : "";
      reject(Object.assign(new Error(`${command} ${how}${capped}${why}`), { stderr }));
    });
  });
}

/** What each step's output is named with in the cache. */
const STEP_EXTENSIONS: Record<DeriveStep, string> = { "wav-to-ogg": "ogg" };

/**
 * `derive`, with each output kept in `dir` (`<dir>/<step>/<SHA-256 of the input>.<extension>`,
 * beside a `.sha256` of the output): an input made before is read from there, not made again. A
 * cached file whose bytes don't match its recorded hash (cut short, or changed) is made again.
 * The cache is used only when this user owns `dir` and no one else can write to it, so a shared
 * temporary folder can't hand a compile someone else's file; otherwise, or when it can't be
 * written, every input is made afresh, which gives the same bytes, only slower.
 */
export function cachedDerive(derive: Derive, dir: string): Derive {
  let usable: Promise<boolean> | undefined;
  return async (step, input) => {
    if (!(await (usable ??= ownCacheDir(dir)))) return derive(step, input);
    const cached = path.join(dir, step, `${sha256(input)}.${STEP_EXTENSIONS[step]}`);
    const hashFile = `${cached}.sha256`;
    if (existsSync(cached) && existsSync(hashFile)) {
      const [bytes, recorded] = await Promise.all([readFile(cached), readFile(hashFile, "utf8")]);
      if (sha256(bytes) === recorded.trim()) return bytes;
    }
    const output = await derive(step, input);
    try {
      await mkdir(path.dirname(cached), { recursive: true, mode: 0o700 });
      // Written beside their final paths, then moved there, so a failure never leaves half a file.
      for (const [file, bytes] of [
        [cached, output],
        [hashFile, `${sha256(output)}\n`],
      ] as const) {
        const partial = `${file}.${process.pid}.partial`;
        await writeFile(partial, bytes);
        await rename(partial, file);
      }
    } catch {
      // A cache that can't be written only costs the next compile an encode.
    }
    return output;
  };
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/**
 * Whether `dir` and its parent are this user's own, `dir` made if it isn't there: each owned by
 * them, and writable by no one else (the parent too, or another user could swap `dir` out).
 */
async function ownCacheDir(dir: string): Promise<boolean> {
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const getuid = process.getuid;
    for (const folder of [dir, path.dirname(dir)]) {
      const info = await stat(folder);
      if (!info.isDirectory()) return false;
      // Windows has no owners or modes to check.
      if (process.platform === "win32" || getuid === undefined) continue;
      if (info.uid !== getuid() || (info.mode & 0o022) !== 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the machine keeps derived files: `<cacheDir>/derived` when its config sets a cacheDir,
 * else a folder of this user's own in the system's temporary folder.
 */
export function derivedCacheDir(machine: MachineConfig): string {
  if (machine.cacheDir) return path.join(machine.cacheDir, "derived");
  return path.join(tmpdir(), `sc2-adjutant-${process.getuid?.() ?? userInfo().username}`, "derived");
}

/** The machine's ffmpeg steps, cached by content in its derived cache. */
export const machineDerive = (machine: MachineConfig): Derive => cachedDerive(ffmpegDerive, derivedCacheDir(machine));
