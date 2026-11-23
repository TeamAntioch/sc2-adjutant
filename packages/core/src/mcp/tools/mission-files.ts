// Where a Mission's files go and the order they're written in, shared by the tools that compile or edit them.

import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { missionMapPackage } from "../../map/mission-package.js";
import { nextStepHint, readStageState } from "../../session/co-design-stages.js";
import { isInside, realPathOf } from "../../util/inside.js";
import { writeTarget } from "../../util/replace-file.js";

/**
 * The next-step line for a Mission's Stage. Only advice: when the Stage record can't be read, the
 * line says why, and the tool's own work (a saved edit, a compiled package) is still reported.
 */
export async function stageHint(blueprintPath: string): Promise<string> {
  try {
    return nextStepHint(await readStageState(blueprintPath));
  } catch (error) {
    return `Next: unknown, since the Stage record can't be used. ${(error as Error).message}`;
  }
}

/**
 * `folder` resolved against the Workspace root, refused unless it is a folder inside the
 * Workspace. Compared by real paths, so a symlink in the Workspace can't lead out of it.
 */
export async function insideWorkspace(root: string, folder: string, what = "The output folder", inside = "a folder inside"): Promise<string> {
  const resolved = path.resolve(root, folder);
  if (!(await isInside(root, resolved))) throw new Error(`${what} ${folder} must be ${inside} the Workspace ${root}`);
  return resolved;
}

/**
 * The Map Package a tool reads or adds to: `map` inside the Workspace, or the Mission's compiled
 * package, where compile_map writes it and the author saves it from the Editor. It must exist.
 */
export async function existingMapPackage(root: string, blueprintPath: string, map: string | undefined): Promise<string> {
  const target = map ? await insideWorkspace(root, map, "The Map Package", "inside") : await missionMapPackage(blueprintPath);
  if (!existsSync(path.join(target, "ComponentList.SC2Components"))) {
    throw new Error(`No Map Package at ${target}: compile_map writes the Mission's package there; open it in the Editor, and save it after any changes there`);
  }
  return target;
}

/** `<mission folder>/output/<name>.SC2Map`, where a terrain preview or a melee map is written by default. */
const defaultMapPackage = (blueprintPath: string, name: string): string => path.join(path.dirname(blueprintPath), "output", `${name}.SC2Map`);

/**
 * `<mission folder>/output/<mission>.SC2Map`. The output folder gets a `.gitignore` that ignores
 * everything in it, so a compiled package isn't committed whatever the Workspace's layout.
 */
export async function defaultOutputDir(blueprintPath: string, name: string): Promise<string> {
  const output = path.join(path.dirname(blueprintPath), "output");
  const ignore = path.join(output, ".gitignore");
  if (!existsSync(ignore)) {
    await mkdir(output, { recursive: true });
    await writeFile(ignore, "# Compiled Map Packages, written by sc2-adjutant\n*\n");
  }
  return defaultMapPackage(blueprintPath, name);
}

/** The last task queued for each key: a compile by its output folder, an edit or a sign-off by its file, each by real path. */
const queues = new Map<string, Promise<unknown>>();

/** Runs `task` after every earlier task for `key` has settled, so two writes of one file or folder don't interleave. */
export function oneAtATime<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(key) ?? Promise.resolve()).then(task);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, settled);
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key);
  });
  return run;
}

/**
 * Runs `task`, which reads a Map Package to edit a Blueprint, in turn with both: after any compile
 * into the package and any edit of the Blueprint. Nothing waits on a package while holding a
 * Blueprint, so the two queues can't deadlock.
 */
export async function readingMapToEdit<T>(mapPath: string, blueprintPath: string, task: () => Promise<T>): Promise<T> {
  const [mapKey, editKey] = [await realPathOf(mapPath), `edit:${await writeTarget(blueprintPath)}`];
  return oneAtATime(mapKey, () => oneAtATime(editKey, task));
}
