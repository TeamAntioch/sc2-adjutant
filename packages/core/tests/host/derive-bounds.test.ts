// The wav-to-ogg step's guards against a runaway ffmpeg. ffmpeg's own Vorbis encoder (the one an
// ffmpeg without libvorbis falls back to) never finishes a WAV with no samples: on 2026-11-13 one,
// orphaned when the MCP server that started it went away, had run for 11 days, ignored SIGTERM,
// and written 1.5 TB to an out.ogg whose folder had been deleted. That encoder is now given one
// silent sample frame for such an input, and every run is bounded: a timeout that ends in SIGKILL, an output cap the kernel enforces, and
// a watcher that kills the command when its parent goes, however it goes.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { wavLengthMs } from "../../src/cutscene/cinematic.js";
import { encodeLimits, ffmpegDerive, kernelCapBlocks, runBounded } from "../../src/host/derive.js";
import { silentWav, trimSilence } from "../../src/host/placeholder-voices.js";
import { pcmFormat, wavFile, wavSeconds } from "../../src/host/wav.js";
import { tempFolder } from "../mcp/harness.js";

const posix = process.platform !== "win32";

/** vite-node's CLI (a devDependency), which runs the TypeScript fixture as a process of its own. */
const viteNodeCli = (() => {
  const manifest = createRequire(import.meta.url).resolve("vite-node/package.json");
  const { bin } = JSON.parse(readFileSync(manifest, "utf8")) as { bin: Record<string, string> };
  return path.join(path.dirname(manifest), bin["vite-node"]!);
})();

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** The body of an ffmpeg without libvorbis that encodes to "OggS". */
const NO_LIBVORBIS = ['for a; do last=$a; done', `case "$*" in *libvorbis*) echo "[aost#0:0 @ 0x1] Unknown encoder 'libvorbis'" >&2; exit 1;; esac`, 'printf OggS > "$last"'];

/**
 * Runs `run` with an ffmpeg first on the PATH whose script is `body`, after it keeps each WAV it
 * is given as `<prefix>0`, `<prefix>1`, ...; returns that prefix.
 */
async function withFakeFfmpeg(body: readonly string[], run: () => Promise<unknown>): Promise<string> {
  const bin = await tempFolder();
  const ffmpeg = path.join(bin, "ffmpeg");
  const keep = ['n=$(ls "$0".in.* 2>/dev/null | wc -l | tr -d " ")', 'i=; for a; do [ "$prev" = -i ] && i=$a; prev=$a; done', '[ -n "$i" ] && cp "$i" "$0.in.$n"'];
  await writeFile(ffmpeg, ["#!/bin/sh", ...keep, ...body, ""].join("\n"));
  await chmod(ffmpeg, 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${saved}`;
  try {
    await run();
  } finally {
    process.env.PATH = saved;
  }
  return `${ffmpeg}.in.`;
}

/** A 16-bit mono WAV at 22050 Hz whose data chunk says `declared` bytes and holds `bytes`. */
function wavWith(bytes: number, declared = bytes): Buffer {
  const wav = silentWav(bytes / 2 / 22050);
  wav.writeUInt32LE(declared, 40);
  return wav;
}

/** Whether a process is running. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(test: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await test()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return test();
}

describe("a WAV's length", () => {
  it("is its samples' seconds, none for a header with no data, and to the file's end for a streamed WAV's size", () => {
    expect(wavSeconds(silentWav(1.5))).toBeCloseTo(1.5, 3);
    expect(wavSeconds(silentWav(0))).toBe(0);
    expect(wavSeconds(wavWith(1))).toBe(0);
    expect(wavSeconds(wavWith(22050 * 2, 0xffffffff))).toBeCloseTo(1, 3);
    // A writer that can't seek back leaves the size 0; ffmpeg reads such a chunk to the end too.
    expect(wavSeconds(wavWith(22050 * 2, 0))).toBeCloseTo(1, 3);
    expect(wavLengthMs(wavWith(22050 * 2, 0))).toBe(1000);
    expect(wavSeconds(Buffer.from("not a wav"))).toBeUndefined();
  });

  it("is timed by its sample rate and frame size, not the byte rate its header claims, and finds a fmt chunk after the data", () => {
    const wav = silentWav(1);
    wav.writeUInt32LE(1, 28);
    expect(wavSeconds(wav)).toBeCloseTo(1, 3);
    // A wrong blockAlign too: ffmpeg reads a PCM frame as each channel's sample.
    wav.writeUInt16LE(1, 32);
    expect(wavSeconds(wav)).toBeCloseTo(1, 3);
    const fmtLast = Buffer.concat([Buffer.from("RIFF\0\0\0\0WAVE"), wav.subarray(36), wav.subarray(12, 36)]);
    expect(wavSeconds(fmtLast)).toBeCloseTo(1, 3);
  });

  it("is timed by whole bytes a sample for a width that isn't a multiple of 8", () => {
    expect(pcmFormat(2, 8000, 12).readUInt16LE(12)).toBe(4);
    expect(wavSeconds(wavFile(pcmFormat(2, 8000, 12), Buffer.alloc(32_000)))).toBeCloseTo(1, 3);
  });

  it("is a compressed WAV's bytes over its byte rate, its blocks holding many samples each", () => {
    // IMA ADPCM, 22050 Hz mono: 512-byte blocks of 1017 samples, 11100 bytes a second.
    const format = pcmFormat(1, 22050, 4);
    format.writeUInt16LE(0x11, 0);
    format.writeUInt32LE(11100, 8);
    format.writeUInt16LE(512, 12);
    expect(wavSeconds(wavFile(format, Buffer.alloc(111_000)))).toBeCloseTo(10, 3);
    expect(wavLengthMs(wavFile(format, Buffer.alloc(111_000)))).toBe(10_000);
  });

  it("is none for a data chunk of size 0 before another chunk, and runs to the end only past bytes that aren't one", () => {
    const list = Buffer.concat([Buffer.from("LIST"), Buffer.from([4, 0, 0, 0]), Buffer.from("INFO")]);
    const empty = Buffer.concat([silentWav(0), list]);
    expect(wavSeconds(empty)).toBe(0);
    expect(trimSilence(empty)).toBeUndefined();
  });
});

describe("the wav-to-ogg step's guards", () => {
  it.skipIf(!posix)("give ffmpeg's own Vorbis encoder one silent sample frame for a WAV with no samples, and libvorbis the WAV as it is", async () => {
    const given = await withFakeFfmpeg(NO_LIBVORBIS, async () => {
      expect((await ffmpegDerive("wav-to-ogg", silentWav(0))).toString()).toBe("OggS");
    });
    expect(await readFile(`${given}0`)).toEqual(silentWav(0));
    const fallback = await readFile(`${given}1`);
    expect(wavSeconds(fallback)).toBeCloseTo(1 / 22050, 6);
    expect(fallback.subarray(12, 36)).toEqual(silentWav(0).subarray(12, 36));
  });

  it.skipIf(!posix)("give an 8-bit WAV with no samples an unsigned silent frame, 0x80, in either fmt form", async () => {
    // WAVE_FORMAT_EXTENSIBLE: 22 more bytes, then a subformat GUID starting with PCM's tag.
    const extensible = Buffer.concat([pcmFormat(1, 8000, 8), Buffer.alloc(24)]);
    extensible.writeUInt16LE(0xfffe, 0);
    extensible.writeUInt16LE(22, 16);
    extensible.writeUInt16LE(1, 24);
    for (const format of [pcmFormat(1, 8000, 8), extensible]) {
      const given = await withFakeFfmpeg(NO_LIBVORBIS, () => ffmpegDerive("wav-to-ogg", wavFile(format, Buffer.alloc(0))));
      const fallback = await readFile(`${given}1`);
      expect(fallback.subarray(28 + format.length, 29 + format.length)).toEqual(Buffer.from([0x80]));
    }
  });

  it.skipIf(!posix)("don't try ffmpeg's own encoder again when libvorbis itself failed", async () => {
    const failing = ['echo "[libvorbis @ 0x1] encoder setup failed" >&2', "exit 1"];
    const given = await withFakeFfmpeg(failing, async () => {
      await expect(ffmpegDerive("wav-to-ogg", silentWav(1))).rejects.toThrow("encoder setup failed");
    });
    expect(existsSync(`${given}1`)).toBe(false);
  });

  it.skipIf(!hasFfmpeg)("encode a WAV with no samples, whichever Vorbis encoder the machine's ffmpeg has", async () => {
    const started = Date.now();
    expect((await ffmpegDerive("wav-to-ogg", silentWav(0))).subarray(0, 4).toString()).toBe("OggS");
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);

  it("allow far more time and output than a real encode takes, within what a timer can count, and the kernel's cap more than -fs's", () => {
    expect(encodeLimits(0)).toEqual({ timeoutMs: 60_000, maxOutputBytes: 1024 * 1024 });
    expect(encodeLimits(10)).toEqual({ timeoutMs: 80_000, maxOutputBytes: 1024 * 1024 + 10 * 64 * 1024 });
    expect(encodeLimits(1e9).timeoutMs).toBe(2 ** 31 - 1);
    // Counted in 512-byte blocks (dash), the cap is still 256 KiB past maxOutputBytes.
    expect(kernelCapBlocks(1024 * 1024) * 512).toBeGreaterThanOrEqual(1024 * 1024 + 256 * 1024);
  });

  it.skipIf(!posix)("bound an input whose header claims a nonsense sample rate by its size", async () => {
    const wav = silentWav(1);
    wav.writeUInt32LE(1, 24);
    await withFakeFfmpeg(['while [ "$1" != -fs ]; do shift; done', 'echo "fs=$2" >&2', "exit 1"], async () => {
      // 44 kB is at most 44 s of any WAV, even GSM's.
      await expect(ffmpegDerive("wav-to-ogg", wav)).rejects.toThrow(`fs=${encodeLimits(44144 / 1000).maxOutputBytes}`);
    });
  });

  it.skipIf(!posix)("keep a lower file-size limit the process was started with, rather than fail to raise it", async () => {
    const fixture = fileURLToPath(new URL("./fixtures/bounded-run.ts", import.meta.url));
    const run = spawnSync("/bin/sh", ["-c", 'ulimit -f 65536 && exec "$@"', "sh", process.execPath, viteNodeCli, fixture], { encoding: "utf8" });
    expect(run.stderr).not.toContain("ulimit");
    expect(run.status).toBe(0);
  }, 30_000);

  it.skipIf(!posix)("name a lower file-size limit the process was started with when that stops the run", async () => {
    const fixture = fileURLToPath(new URL("./fixtures/bounded-run.ts", import.meta.url));
    const out = path.join(await tempFolder(), "out");
    const run = spawnSync("/bin/sh", ["-c", 'ulimit -f 256 && exec "$@"', "sh", process.execPath, viteNodeCli, fixture, `head -c 1048576 /dev/zero > "${out}"`], { encoding: "utf8" });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("its output passed the file-size limit of 256 blocks (ulimit -f) it was started with");
  }, 30_000);

  it.skipIf(!posix)("say what stopped the run beside what the command said, and call only a command not there missing", async () => {
    await expect(runBounded("/bin/sh", ["-c", 'echo "a warning" >&2; trap "" TERM; while :; do sleep 0.1; done'], { timeoutMs: 300, maxOutputBytes: 1024 * 1024, killGraceMs: 300 })).rejects.toThrow(/ran past 0 s and was stopped: a warning/);
    await expect(runBounded("/bin/sh", ["-c", "echo 'error while loading shared libraries: libvorbisenc.so.2' >&2; exit 127"], { timeoutMs: 10_000, maxOutputBytes: 1024 * 1024 })).rejects.toSatisfy((error: NodeJS.ErrnoException) => error.code !== "ENOENT" && error.message.includes("libvorbisenc"));
    await expect(runBounded("no-such-command-here", [], { timeoutMs: 10_000, maxOutputBytes: 1024 * 1024 })).rejects.toMatchObject({ code: "ENOENT" });
    await expect(runBounded("/no/such/command", [], { timeoutMs: 10_000, maxOutputBytes: 1024 * 1024 })).rejects.toMatchObject({ code: "ENOENT" });
    // A command's own stdout isn't taken for the shell's word that it's missing.
    await expect(runBounded("/bin/sh", ["-c", "echo missing; exit 3"], { timeoutMs: 10_000, maxOutputBytes: 1024 * 1024 })).rejects.toSatisfy((error: NodeJS.ErrnoException) => error.code !== "ENOENT" && error.message.includes("exited with 3"));
  });

  it.skipIf(!posix)("keep a command that finished as its time ran out", async () => {
    // It ignores the SIGTERM, then finishes well within the grace.
    await expect(runBounded("/bin/sh", ["-c", 'trap "" TERM; sleep 0.5; exit 0'], { timeoutMs: 200, maxOutputBytes: 1024 * 1024, killGraceMs: 5000 })).resolves.toBeDefined();
  });

  it.skipIf(!posix)("SIGKILL a command that ignores SIGTERM once its time is up", async () => {
    const started = Date.now();
    await expect(runBounded("/bin/sh", ["-c", 'trap "" TERM; while :; do sleep 0.1; done'], { timeoutMs: 300, maxOutputBytes: 1024 * 1024, killGraceMs: 300 })).rejects.toThrow("ran past");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it.skipIf(!posix)("stop a command whose output grows past its cap, and let one write up to it", async () => {
    const dir = await tempFolder();
    const cap = 64 * 1024;
    const full = path.join(dir, "full");
    await runBounded("/bin/sh", ["-c", `head -c ${cap} /dev/zero > "${full}"`], { timeoutMs: 10_000, maxOutputBytes: cap });
    expect((await stat(full)).size).toBe(cap);
    const out = path.join(dir, "out");
    await expect(runBounded("/bin/sh", ["-c", `trap "" TERM; while :; do echo xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx; done > "${out}"`], { timeoutMs: 10_000, maxOutputBytes: cap })).rejects.toThrow("its output passed");
    // ulimit -f counts 512- or 1024-byte blocks, by shell.
    expect((await stat(out)).size).toBeLessThanOrEqual(2 * kernelCapBlocks(cap) * 512);
  });

  /** Runs bounded-parent.ts, SIGKILLs it once `ready` has passed, and whether its command then died. */
  async function commandDiesWithParent(extra: string[] = [], waitMs = 0): Promise<boolean> {
    const pidFile = path.join(await tempFolder(), "pid");
    const parent = spawn(process.execPath, [viteNodeCli, fileURLToPath(new URL("./fixtures/bounded-parent.ts", import.meta.url)), pidFile, ...extra], { stdio: "ignore" });
    try {
      expect(await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "", 20_000)).toBe(true);
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      expect(alive(pid)).toBe(true);
      parent.kill("SIGKILL");
      return await until(() => !alive(pid), 5000);
    } finally {
      parent.kill("SIGKILL");
    }
  }

  it.skipIf(!posix)("kill the command when the process that ran it dies, even by SIGKILL", async () => {
    expect(await commandDiesWithParent()).toBe(true);
  }, 30_000);

  it.skipIf(!posix)("still kill a command that ignored the timeout's SIGTERM when the process that ran it dies before the SIGKILL", async () => {
    expect(await commandDiesWithParent(["300", "600000"], 1000)).toBe(true);
  }, 30_000);

  // The failure itself: ffmpeg's own Vorbis encoder given a WAV with no samples. Some builds may
  // finish it; the ones that don't must be stopped, by the cap or the timeout, within seconds.
  it.skipIf(!posix || !hasFfmpeg)("end ffmpeg's own Vorbis encoder on a WAV with no samples, which it never finishes", async () => {
    const dir = await tempFolder();
    const from = path.join(dir, "in.wav");
    const to = path.join(dir, "out.ogg");
    await writeFile(from, silentWav(0));
    const cap = 256 * 1024;
    const started = Date.now();
    await runBounded("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-i", from, "-c:a", "vorbis", "-strict", "-2", "-ac", "2", to], { timeoutMs: 3000, maxOutputBytes: cap, killGraceMs: 500 }).catch(() => undefined);
    expect(Date.now() - started).toBeLessThan(10_000);
    if (existsSync(to)) expect((await stat(to)).size).toBeLessThanOrEqual(2 * kernelCapBlocks(cap) * 512);
  }, 20_000);
});
