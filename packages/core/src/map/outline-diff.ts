// A trigger's change in the Editor's form (#46): the outline's own text (outline-trigger.ts) of the
// trigger after the change, each line it changed marked `← new`, `← was: <old line>` or `← remove`
// (a removed line stays in its place, so the reader sees where it was). No other notation.

import type { Workspace } from "../plugins/workspace.js";
import type { AuthoringTrigger } from "../triggers/author-trigger.js";
import { outlineText, outlineTrigger, type TriggerOutline } from "./outline-trigger.js";
import { writeBlueprintTrigger, type WrittenBlueprintTrigger } from "./write-blueprint-trigger.js";

/** The lines of `before` and `after` as an edit script: each line kept, removed or added, in order. */
function lineEdits(before: readonly string[], after: readonly string[]): { readonly op: "keep" | "del" | "add"; readonly line: string }[] {
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  const a = before.slice(head, before.length - tail);
  const b = after.slice(head, after.length - tail);
  // Longest common subsequence of the lines between the shared head and tail.
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) lcs[i * width + j] = a[i] === b[j] ? lcs[(i + 1) * width + j + 1]! + 1 : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
  }
  const edits: { op: "keep" | "del" | "add"; line: string }[] = before.slice(0, head).map((line) => ({ op: "keep", line }));
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) edits.push({ op: "keep", line: a[i++]! }), j++;
    else if (j < b.length && (i === a.length || lcs[i * width + j + 1]! >= lcs[(i + 1) * width + j]!)) edits.push({ op: "add", line: b[j++]! });
    else edits.push({ op: "del", line: a[i++]! });
  }
  return [...edits, ...before.slice(before.length - tail).map((line) => ({ op: "keep" as const, line }))];
}

/** A line's key, the text before its first colon: two lines of one key are one value changed. */
const keyOf = (line: string): string | undefined => /^\s*("(?:[^"\\]|\\.)*"):/.exec(line)?.[0];

/**
 * `after`'s text with each changed line marked against `before`'s. A removed line and an added one
 * of the same key (and indent) are one changed value: the new line, `← was: ` the old.
 */
export function markedChanges(before: string, after: string): string {
  const edits = lineEdits(before.split("\n"), after.split("\n"));
  const out: string[] = [];
  for (let at = 0; at < edits.length; ) {
    if (edits[at]!.op === "keep") {
      out.push(edits[at++]!.line);
      continue;
    }
    // One run of changes: its removed lines, then its added ones (as the edit script lists them, in either order).
    const run = [];
    while (at < edits.length && edits[at]!.op !== "keep") run.push(edits[at++]!);
    const removed = run.filter((edit) => edit.op === "del").map((edit) => edit.line);
    const added = run.filter((edit) => edit.op === "add").map((edit) => edit.line);
    // A removed line and an added one of the same key are one value changed: the removed one is its `was`, an object or list on one line.
    const was = new Map<string, { readonly text: string; readonly indices: readonly number[] }>();
    removed.forEach((line, index) => {
      const key = keyOf(line);
      if (key === undefined || was.has(key) || !added.some((other) => keyOf(other) === key)) return;
      const indent = /^\s*/.exec(line)![0];
      // An object or list opened here ends at the next removed line closing it at this indent; if the run doesn't close it, only this line is the old one.
      const closing = /[{[]$/.test(line) ? removed.findIndex((other, at) => at > index && /^\s*[}\]],?$/.test(other) && /^\s*/.exec(other)![0] === indent) : -1;
      const end = closing === -1 ? index : closing;
      const indices = Array.from({ length: end - index + 1 }, (_, offset) => index + offset);
      was.set(key, { text: indices.map((at) => removed[at]!.trim()).join(" "), indices });
    });
    const paired = new Set([...was.values()].flatMap((entry) => entry.indices));
    removed.forEach((line, index) => {
      if (!paired.has(index)) out.push(`${line}  ← remove`);
    });
    const used = new Set<string>();
    for (const line of added) {
      const key = keyOf(line);
      const old = key !== undefined && !used.has(key) ? was.get(key) : undefined;
      if (key !== undefined && old !== undefined) used.add(key);
      out.push(old !== undefined ? `${line}  ← was: ${old.text.replace(/,$/, "")}` : `${line}  ← new`);
    }
  }
  return out.join("\n");
}

/**
 * The outline's text with each line it changed marked against `before`'s (every line new where
 * there is none), then what the input can't express, as the outline lists it.
 */
export function outlineDiff(before: TriggerOutline | undefined, after: TriggerOutline): string {
  const json = (outline: TriggerOutline): string => JSON.stringify(outline.trigger, null, 2);
  const marked = before === undefined ? json(after).split("\n").map((line) => `${line}  ← new`).join("\n") : markedChanges(json(before), json(after));
  return marked + outlineText(after.trigger, after.unwritable).slice(json(after).length);
}

/**
 * Where a function's parameters changed, the callers to look at: one line naming the parameters
 * before and after, then each caller. Nothing where they didn't change.
 */
export function callersOfChanged(fn: string, before: readonly string[], after: readonly string[], callers: readonly string[]): string[] {
  if (before.length === after.length && before.every((name, index) => name === after[index])) return [];
  return [`${fn}'s parameters changed: (${before.join(", ")}) → (${after.join(", ")}). Its callers:`, ...(callers.length > 0 ? callers.map((caller) => `- ${caller}`) : ["- none"])];
}

/**
 * writeBlueprintTrigger, with the change it made when it replaced a trigger: its outline before,
 * and after it as written, as outlineDiff gives it. A new trigger has none.
 */
export async function writeBlueprintTriggerShowingChange(workspace: Workspace, blueprintPath: string, trigger: AuthoringTrigger): Promise<{ readonly written: WrittenBlueprintTrigger; readonly diff?: string }> {
  // The trigger it replaces, outlined before it is written over (a new one has none; a Kept one of the name is refused when it is written).
  const was = await outlineTrigger(workspace, blueprintPath, trigger.id ?? trigger.name).then(
    (outline) => (outline.owner === "Blueprint" ? outline : undefined),
    () => undefined,
  );
  const written = await writeBlueprintTrigger(workspace, blueprintPath, trigger);
  if (written.created || was === undefined) return { written };
  return { written, diff: outlineDiff(was, await outlineTrigger(workspace, blueprintPath, written.id)) };
}
