// Part of a script scene, named by a stage direction's address, `S<scene>><n>`: `S07>2` is
// scene 7's second stage direction, and the part it starts runs from it to the next
// stage direction (or the scene's end). A script cue with `from` plays only that part, so a scene
// of several messages, each introduced by a stage direction, plays each on its own cue.

import type { ParsedScene } from "./parse-script.js";

/** A stage direction's address, `S<scene>><n>`: `S01>2` is scene 1's second. */
export const DIRECTION_ADDRESS = /^S(\d+)>([1-9]\d*)$/;

/** The scene and the stage direction's place among its scene's (from 1) that `address` names. */
export function directionAddress(address: string): { readonly scene: number; readonly direction: number } | undefined {
  const match = DIRECTION_ADDRESS.exec(address);
  return match ? { scene: Number(match[1]), direction: Number(match[2]) } : undefined;
}

/** `address` as one spelling of its stage direction (`S7>4` and `S07>4` are `S07>4`), so two spellings of one part are one; as it is if it names none. */
export function canonicalAddress(address: string): string {
  const parsed = directionAddress(address);
  return parsed ? `S${String(parsed.scene).padStart(2, "0")}>${parsed.direction}` : address;
}

/** The lines of `scene`'s part from the stage direction `from` names to the next one, or undefined when the scene has no such stage direction. */
export function scenePartLines<Line extends { readonly kind: "line" }>(scene: ParsedScene<Line>, from: string): Line[] | undefined {
  const address = directionAddress(from);
  if (!address || address.scene !== scene.number) return undefined;
  const lines: Line[] = [];
  let direction = 0;
  for (const item of scene.items) {
    if (item.kind === "direction") direction++;
    else if (direction === address.direction) lines.push(item as Line);
    if (direction > address.direction) break;
  }
  return direction >= address.direction ? lines : undefined;
}

/** How many stage directions `scene` has: the parts its cues' `from`s can name. */
export const directionCount = (scene: ParsedScene<{ readonly kind: "line" }>): number => scene.items.filter((item) => item.kind === "direction").length;

/**
 * What's wrong with the script cues' `from`s against the Screenplay's `scenes`, each with its
 * cue's place in `cues`: a stage direction the scene doesn't have, or one with no lines before the
 * next, whose cue would play nothing. A cue on a scene the Screenplay lacks, or naming another
 * scene's stage direction, is reported as that, elsewhere.
 */
export function scenePartProblems(cues: readonly { readonly scene: number; readonly from?: string | undefined }[], scenes: readonly ParsedScene<{ readonly kind: "line" }>[]): { readonly index: number; readonly message: string }[] {
  return cues.flatMap(({ scene: number, from }, index) => {
    const scene = scenes.find((candidate) => candidate.number === number);
    if (from === undefined || !scene || directionAddress(from)?.scene !== number) return [];
    const lines = scenePartLines(scene, from);
    if (!lines) return [{ index, message: `${from} names no stage direction of scene ${number}, which has ${directionCount(scene)}` }];
    if (lines.length === 0) return [{ index, message: `${from} has no lines before the next stage direction, so its cue would play nothing` }];
    return [];
  });
}

/** The lines of `scene` a script cue plays: all of them, its part's (`from`), or its one `line` (a sound ID, one line's: nameScript refuses two sharing one); undefined when the scene has no such part or line. */
export function cuedLines<Line extends { readonly kind: "line"; readonly soundId: string }>(scene: ParsedScene<Line>, { from, line }: { readonly from?: string | undefined; readonly line?: string | undefined }): Line[] | undefined {
  if (from !== undefined) return scenePartLines(scene, from);
  const lines = scene.items.filter((item): item is Line => item.kind === "line");
  if (line === undefined) return lines;
  const found = lines.find((candidate) => candidate.soundId === line);
  return found ? [found] : undefined;
}

/**
 * What's wrong with the script cues' `line`s against the named Screenplay's `scenes`, each with
 * its cue's place in `cues`: a sound ID that is another scene's line, or no line at all. A cue on a
 * scene the Screenplay lacks is reported as that, elsewhere.
 */
export function sceneLineProblems(
  cues: readonly { readonly scene: number; readonly line?: string | undefined }[],
  scenes: readonly ParsedScene<{ readonly kind: "line"; readonly soundId: string }>[],
): { readonly index: number; readonly message: string }[] {
  const soundIds = new Map(scenes.map((scene) => [scene.number, cuedLines(scene, {})!.map((item) => item.soundId)]));
  const sceneOf = new Map([...soundIds].flatMap(([number, ids]) => ids.map((id) => [id, number] as const)));
  return cues.flatMap(({ scene: number, line }, index) => {
    const ids = soundIds.get(number);
    if (line === undefined || !ids || ids.includes(line)) return [];
    const other = sceneOf.get(line);
    if (other !== undefined) return [{ index, message: `${line} is a line of scene ${other}, not of scene ${number}` }];
    return [{ index, message: `${line} is no line of scene ${number}, ${ids.length > 0 ? `whose lines are ${ids.join(", ")}` : "which has none"}` }];
  });
}
