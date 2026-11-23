// What Import does alike for a Map Package (ADR-0010) and a mod package (ADR-0011): claims the new
// folder, copies the package into it byte for byte, and leaves nothing half-imported when a later
// step fails. The source is only read.

import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

/**
 * Makes `dir` (refused with `alreadyThere` when it's there), copies the unpacked package `source`
 * to `target` inside it, then runs `rest`. Made here or refused, so an import running beside this
 * one under the same id is never removed by its cleanup. When the copy or `rest` fails, `dir` is
 * removed and that failure rethrown.
 */
export async function importPackage<T>(source: string, dir: string, target: string, alreadyThere: string, rest: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(dir), { recursive: true });
  try {
    await mkdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(alreadyThere);
    throw error;
  }
  try {
    await cp(source, target, { recursive: true, preserveTimestamps: true, errorOnExist: true, force: false });
    return await rest();
  } catch (error) {
    throw await undoing(error, () => rm(dir, { recursive: true, force: true }));
  }
}

/**
 * Runs every undo step, even after one fails, and gives back the failure that called for them; one
 * that can't be undone is named in its message, so the author knows what's left to clear by hand.
 */
export async function undoing(failure: unknown, ...steps: (() => Promise<unknown>)[]): Promise<unknown> {
  const undone = await Promise.allSettled(steps.map((step) => step()));
  const left = undone.flatMap((result) => (result.status === "rejected" ? [result.reason instanceof Error ? result.reason.message : String(result.reason)] : []));
  if (left.length === 0) return failure;
  const message = failure instanceof Error ? failure.message : String(failure);
  return new Error(`${message} (and it couldn't be undone: ${left.join("; ")})`, { cause: failure });
}
