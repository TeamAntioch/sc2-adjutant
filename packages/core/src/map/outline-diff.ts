// A trigger's change in the Editor's form (#46): the trigger after the change as editor-form.ts
// writes it, one line to a call, each line it changed marked `← new`, `← was: <old line>` or `← remove`
// (a removed line stays in its place, so the reader sees where it was). No other notation.

import type { Workspace } from "../plugins/workspace.js";
import type { AuthoringTrigger } from "../triggers/author-trigger.js";
import { editorForm } from "./editor-form.js";
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

/** A line's head, its indent and its words before the first parenthesis: two lines of one head are one call changed. */
const headOf = (line: string): string => /^\s*[^(]*/.exec(line)![0].trimEnd();

/**
 * `after`'s text with each changed line marked against `before`'s. In a run of changes, a removed
 * line and an added one with the same head (a call, its arguments changed) are one changed line: the
 * new line, `← was: ` the old.
 */
export function markedChanges(before: string, after: string): string {
  const edits = lineEdits(before.split("\n"), after.split("\n"));
  const out: string[] = [];
  for (let at = 0; at < edits.length; ) {
    if (edits[at]!.op === "keep") {
      out.push(edits[at++]!.line);
      continue;
    }
    // One run of changes: its removed lines and its added ones.
    const run = [];
    while (at < edits.length && edits[at]!.op !== "keep") run.push(edits[at++]!);
    const removed = run.filter((edit) => edit.op === "del").map((edit) => edit.line);
    const added = run.filter((edit) => edit.op === "add").map((edit) => edit.line);
    const was = new Map<number, string>();
    const taken = new Set<number>();
    added.forEach((line, index) => {
      const old = removed.findIndex((other, at) => !taken.has(at) && headOf(other) === headOf(line));
      if (old !== -1) {
        taken.add(old);
        was.set(index, removed[old]!);
      }
    });
    removed.forEach((line, index) => {
      if (!taken.has(index)) out.push(`${line}  ← remove`);
    });
    added.forEach((line, index) => out.push(was.has(index) ? `${line}  ← was: ${was.get(index)!.trim()}` : `${line}  ← new`));
  }
  return out.join("\n");
}

/**
 * The trigger after the change as the Editor's form (editor-form.ts) with each line it changed
 * marked against `before`'s (every line new where there is none), then what the outline's input
 * can't express, as the outline lists it.
 */
export function outlineDiff(before: TriggerOutline | undefined, after: TriggerOutline): string {
  const marked = before === undefined ? editorForm(after.trigger).split("\n").map((line) => `${line}  ← new`).join("\n") : markedChanges(editorForm(before.trigger), editorForm(after.trigger));
  return marked + outlineText(after.trigger, after.unwritable).slice(JSON.stringify(after.trigger, null, 2).length);
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
