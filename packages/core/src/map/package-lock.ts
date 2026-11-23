// A lock across processes for writing a Map Package. oneAtATime (mcp/tools/mission-files.ts) only
// queues the writes of one process, so two sessions on one package could each read it, then each
// write, and the second would lose the first's changes. This holds a lock file while a compile or a
// Kept edit reads and writes the package.
//
// The lock file is `sc2-adjutant-locks/<hash of the package's real path>.lock` in the machine's
// temp folder, not in the package (nothing to ignore, nothing for a compile to mistake for Kept
// Content). It is made with the exclusive-create flag, so exactly one process makes it, and says
// who made it: `{ pid, startedAt, token }`.
//
// A waiter takes the lock over when its owner can't still be writing: the owner's process is gone
// (signal 0 finds no such pid), or it began longer ago than `staleMs`, or the file is torn (half
// written) and older than `tornMs`. Otherwise it polls until `waitMs` passes, then refuses naming
// the owner. The lock is freed in a `finally`, only if the file is still ours, so a lock taken over
// from a hung owner isn't released from under its new holder.
//
// Taking over has a small race: two waiters can both judge one lock stale. Each moves the stale
// file aside by renaming it, and only one rename finds it; the other then fails to create the lock
// and polls again. A third process that created a fresh lock between a waiter's check and its rename
// could lose it; the window is a few milliseconds and the check re-reads the file just before.
//
// Within one process the lock is re-entrant, so a task that takes a package's lock again (a compile
// that calls a Kept edit) doesn't wait on itself.

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type LockOptions = {
  /** How long to wait for another writer before refusing. Default 30 s. */
  readonly waitMs?: number;
  /** How often to look again. Default 100 ms. */
  readonly pollMs?: number;
  /** A lock begun this long ago is taken over whatever its owner's process is doing. Default 2 hours. */
  readonly staleMs?: number;
  /** A lock file that doesn't parse is taken over once it is this old. Default 2 s. */
  readonly tornMs?: number;
};

type Owner = { readonly pid: number; readonly startedAt: string; readonly token: string };

/** What an option left out is, kept in one place so a test can shorten the wait for every caller. */
export const lockDefaults: Required<LockOptions> = { waitMs: 30_000, pollMs: 100, staleMs: 2 * 3_600_000, tornMs: 2_000 };

const LOCK_DIR = "sc2-adjutant-locks";
const held = new AsyncLocalStorage<ReadonlySet<string>>();

/** The lock file for the package at `mapPackage` (made or not): named from the package's real path, so two spellings of it share one. */
export async function lockFileFor(mapPackage: string): Promise<string> {
  const resolved = path.resolve(mapPackage);
  const real = await realpath(resolved).catch(async () => path.join(await realpath(path.dirname(resolved)).catch(() => path.dirname(resolved)), path.basename(resolved)));
  return path.join(tmpdir(), LOCK_DIR, `${createHash("sha256").update(real).digest("hex").slice(0, 32)}.lock`);
}

/** Runs `task` holding the cross-process lock on `mapPackage`; frees it however the task ends. */
export async function withPackageLock<T>(mapPackage: string, task: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  const lock = await lockFileFor(mapPackage);
  const mine = held.getStore();
  if (mine?.has(lock)) return task();
  const token = await acquire(lock, mapPackage, options);
  try {
    return await held.run(new Set([...(mine ?? []), lock]), task);
  } finally {
    await release(lock, token);
  }
}

async function acquire(lock: string, mapPackage: string, options: LockOptions): Promise<string> {
  const { waitMs, pollMs, staleMs, tornMs } = { ...lockDefaults, ...options };
  await mkdir(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    const token = randomUUID();
    try {
      const file = await open(lock, "wx");
      try {
        await file.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), token } satisfies Owner));
      } finally {
        await file.close();
      }
      return token;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const owner = await readOwner(lock);
    if (await stale(lock, owner, staleMs, tornMs)) {
      await takeOver(lock, owner);
      continue;
    }
    if (Date.now() >= deadline) {
      const who = owner ? `process ${owner.pid} since ${owner.startedAt}` : "another process";
      throw new Error(`${path.basename(mapPackage)} is being written by ${who}: wait for it to finish, then try again (lock ${lock})`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** The lock's owner, or undefined when the file is gone or doesn't parse. */
async function readOwner(lock: string): Promise<Owner | undefined> {
  try {
    const owner = JSON.parse(await readFile(lock, "utf8")) as Partial<Owner>;
    return typeof owner.pid === "number" && typeof owner.startedAt === "string" && typeof owner.token === "string" ? (owner as Owner) : undefined;
  } catch {
    return undefined;
  }
}

async function stale(lock: string, owner: Owner | undefined, staleMs: number, tornMs: number): Promise<boolean> {
  if (!owner) {
    // Torn, or freed between the failed create and this read: only a torn one that has sat is taken.
    const age = await stat(lock).then((info) => Date.now() - info.mtimeMs, () => undefined);
    return age === undefined ? true : age >= tornMs;
  }
  if (Date.now() - Date.parse(owner.startedAt) > staleMs) return true;
  try {
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    // EPERM means the process exists but isn't ours to signal: it is alive.
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** Moves a stale lock aside, if it is still the one judged stale, and removes it. */
async function takeOver(lock: string, judged: Owner | undefined): Promise<void> {
  const now = await readOwner(lock);
  if ((now?.token ?? undefined) !== (judged?.token ?? undefined)) return;
  const aside = `${lock}.stale-${process.pid}-${randomUUID()}`;
  try {
    await rename(lock, aside);
  } catch {
    return;
  }
  await rm(aside, { force: true });
}

async function release(lock: string, token: string): Promise<void> {
  if ((await readOwner(lock))?.token === token) await rm(lock, { force: true });
}
