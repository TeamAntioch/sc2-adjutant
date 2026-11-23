// How the Windows Host Adapter runs WhiteoutFlakes (whiteoutflakes.ts), apart from running it: the
// GPU or WARP verdict for a viewer build, and the copies of the viewer's folder its workers run from.
//
// - The viewer keeps its pipeline cache and PSO trace beside its exe on Windows, and processes
//   sharing them corrupt them, so each concurrent worker runs a copy of the viewer's whole folder,
//   kept between runs so the caches stay warm and copied afresh for a new build.
// - A GPU whose driver can't run the viewer (a Parallels VM's loses the D3D11 device during setup)
//   makes it fail --headless-test. The build script's patch makes WF_D3D11_WARP=1 create the D3D11
//   device on WARP, Windows' software rasterizer, so a build is tested once on the GPU, then on WARP
//   if that fails, and the verdict is kept on disk for that build.

import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/** Whether the process with this id is running. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it runs, as another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** How old a lock with no pid in it must be to count as abandoned (its writer died before writing), in ms. */
const EMPTY_LOCK_MS = 10_000;

/** The pid a lock's content (`<pid> <token>`) names; undefined when it names none. */
export function lockOwner(content: string): number | undefined {
  const owner = Number(content.split(" ")[0]);
  return Number.isInteger(owner) && owner > 0 ? owner : undefined;
}

/**
 * Whether the lock as read (`content`) is abandoned: its process has gone, or it has no pid and is
 * too old to be one still being written.
 */
async function abandoned(lock: string, content: string, alive: (pid: number) => boolean): Promise<boolean> {
  const owner = lockOwner(content);
  if (owner !== undefined) return !alive(owner);
  const written = await stat(lock).then((stats) => stats.mtimeMs, () => Date.now());
  return Date.now() - written > EMPTY_LOCK_MS;
}

/**
 * Takes an abandoned lock out of the way, if it is still the one read as `content`: renamed aside
 * first, which only one process can do to it, then checked. A lock another process created since,
 * renamed aside by mistake, is put back.
 */
async function takeOver(lock: string, content: string): Promise<void> {
  const aside = `${lock}.${process.pid}-${randomUUID()}`;
  try {
    await rename(lock, aside);
  } catch {
    // Another process took it over first.
    return;
  }
  const moved = await readFile(aside, "utf8").catch(() => content);
  if (moved !== content) await writeFile(lock, moved, { flag: "wx" }).catch(() => undefined);
  await rm(aside, { force: true });
}

/**
 * Claims the lowest numbered worker folder under `dir` that no worker, in this process or another,
 * holds: `<n>.lock` holds its owner's pid and a token of the claim's own, created only if it doesn't
 * exist, and a lock whose process has gone is taken over. Worker numbers are only unique within a
 * process, and a second process running from the same copy would share its caches, or delete the
 * exe under it for a new build. Resolves to the folder and a release that frees it, which removes
 * the lock only while it is still this claim's.
 */
export async function claimWorker(dir: string, alive: (pid: number) => boolean = processAlive): Promise<{ readonly folder: string; readonly release: () => Promise<void> }> {
  await mkdir(dir, { recursive: true });
  for (let slot = 0; ; slot++) {
    const lock = path.join(dir, `${slot}.lock`);
    for (let attempt = 0; attempt < 3; attempt++) {
      const mine = `${process.pid} ${randomUUID()}`;
      try {
        await writeFile(lock, mine, { flag: "wx" });
        const release = async () => {
          if ((await readFile(lock, "utf8").catch(() => undefined)) === mine) await rm(lock, { force: true });
        };
        return { folder: path.join(dir, String(slot)), release };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const content = await readFile(lock, "utf8").catch(() => undefined);
      // Released meanwhile: try it again.
      if (content === undefined) continue;
      // Held by a running process (this one included), or being written: the next slot.
      if (!(await abandoned(lock, content, alive))) break;
      await takeOver(lock, content);
    }
  }
}

/** A failure setting up a test, such as copying the viewer, which says nothing about the GPU. */
export class TestSetupFailed extends Error {}

/**
 * Removes probe folders (`probe-<pid>-gpu`, `-warp`) under `dir` whose process has gone: a probe
 * interrupted partway leaves its copy of the viewer behind.
 */
export async function removeStaleProbes(dir: string, alive: (pid: number) => boolean = processAlive): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    names.map(async (name) => {
      const pid = /^probe-(\d+)-(gpu|warp)$/.exec(name)?.[1];
      if (pid !== undefined && Number(pid) !== process.pid && !alive(Number(pid))) await rm(path.join(dir, name), { recursive: true, force: true }).catch(() => undefined);
    }),
  );
}

/** Whether the viewer's --headless-test output says it passed. */
export function headlessPassed(output: string): boolean {
  return /^\[headless\] PASS\b/m.test(output);
}

/** What a --headless-test run printed that says how it ended, for an error. */
const verdictLine = (output: string): string =>
  output.split(/\r?\n/).filter((line) => line.startsWith("[headless]")).at(-1) ?? (output.trim().split(/\r?\n/).at(-1) || "no output");

/**
 * Whether the viewer needs WARP: false when its smoke test passes on the GPU, true when it fails
 * there and passes on WARP. `test` runs --headless-test (on WARP when `warp`) and resolves to what it
 * printed; a run that rejects (crashed, timed out) failed. Neither passing is an error, and so is a
 * test that couldn't be set up (TestSetupFailed), which decides nothing.
 */
export async function decideWarp(test: (warp: boolean) => Promise<string>): Promise<boolean> {
  const tried = async (warp: boolean): Promise<string> =>
    test(warp).catch((error: unknown) => {
      if (error instanceof TestSetupFailed) throw error;
      return `${(error as { stdout?: string }).stdout ?? ""}\n${(error as Error).message}`;
    });
  const gpu = await tried(false);
  if (headlessPassed(gpu)) return false;
  const warp = await tried(true);
  if (headlessPassed(warp)) return true;
  throw new Error(`the WhiteoutFlakes viewer fails --headless-test on the GPU (${verdictLine(gpu)}) and on WARP (${verdictLine(warp)})`);
}

/**
 * The verdict kept in `file` for the viewer build `build` (its path and modification time), else
 * decided now and kept. A verdict that can't be decided isn't kept.
 */
export async function cachedVerdict(file: string, build: string, decide: () => Promise<boolean>): Promise<boolean> {
  try {
    const kept = JSON.parse(await readFile(file, "utf8")) as { build?: unknown; warp?: unknown };
    if (kept.build === build && typeof kept.warp === "boolean") return kept.warp;
  } catch {
    // No verdict yet, or not one.
  }
  const warp = await decide();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ build, warp }));
  return warp;
}

/** The viewer's environment: the caller's, with the WARP switch set only for WARP. */
export function viewerEnv(warp: boolean, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const { WF_D3D11_WARP: _, ...rest } = env;
  return warp ? { ...rest, WF_D3D11_WARP: "1" } : rest;
}

const STAMP = ".viewer-build";

/**
 * The worker's copy of the viewer whose exe is `exe` (built at `builtMs`) in `workerDir`: the exe's
 * whole folder (shaders, translations, fonts), copied when the worker has another build or none, and
 * kept as it is otherwise, with the caches the viewer wrote beside it. Resolves to the copy's exe.
 */
export async function prepareWorker(exe: string, builtMs: number, workerDir: string): Promise<string> {
  const build = `${exe}\n${builtMs}`;
  const copy = path.join(workerDir, path.basename(exe));
  const current = await readFile(path.join(workerDir, STAMP), "utf8").catch(() => undefined);
  if (current === build) return copy;
  await rm(workerDir, { recursive: true, force: true });
  await cp(path.dirname(exe), workerDir, { recursive: true });
  await writeFile(path.join(workerDir, STAMP), build);
  return copy;
}
