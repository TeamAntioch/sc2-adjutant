// A trigger's change in the Editor's form (#46): the outline's text with the changed lines marked.
import { describe, expect, it } from "vitest";

import { callersOfChanged, markedChanges, outlineDiff } from "../../src/map/outline-diff.js";
import type { TriggerOutline } from "../../src/map/outline-trigger.js";
import type { AuthoringTrigger } from "../../src/triggers/author-trigger.js";

const outline = (actions: AuthoringTrigger["actions"], unwritable: string[] = []): TriggerOutline => {
  const trigger: AuthoringTrigger = { name: "Opening", events: [{ function: "Map Initialization" }], conditions: [], actions };
  return { name: "Opening", id: "AAAA0001", owner: "Blueprint", file: "triggers/opening.json", trigger, unwritable, text: "" };
};
const wait = (seconds: number) => ({ function: "Wait", params: { Time: seconds } });
const pause = { function: "Pause All Units", params: { Pause: true } };

const marks = (diff: string): string[] => diff.split("\n").filter((line) => line.includes("←"));

describe("outlineDiff", () => {
  it("marks an added action's lines new", () => {
    const diff = outlineDiff(outline([wait(3)]), outline([wait(3), pause]));

    expect(marks(diff).length).toBeGreaterThan(0);
    expect(marks(diff).every((line) => line.endsWith("← new"))).toBe(true);
    expect(diff).toContain('"function": "Pause All Units",  ← new');
    // The rest of the outline is as it was, unmarked.
    expect(diff).toContain('"function": "Wait",\n');
  });

  it("marks a changed argument was, with the old line", () => {
    const diff = outlineDiff(outline([wait(3)]), outline([wait(4.5)]));

    expect(marks(diff)).toEqual(['        "Time": 4.5  ← was: "Time": 3']);
  });

  it("keeps a removed action's lines in place, marked remove", () => {
    const diff = outlineDiff(outline([wait(3), pause]), outline([wait(3)]));

    expect(marks(diff).length).toBeGreaterThan(0);
    expect(marks(diff).every((line) => line.endsWith("← remove"))).toBe(true);
    expect(diff).toContain('"function": "Pause All Units",  ← remove');
  });

  it("marks every line new for a trigger with nothing before it, and lists what the input can't express", () => {
    const diff = outlineDiff(undefined, outline([wait(3)], ["actions[0]: a thing"]));

    const [json, note] = diff.split("\nNot written back as it is");
    expect(json!.split("\n").every((line) => line.endsWith("← new"))).toBe(true);
    expect(note).toContain("- actions[0]: a thing");
  });

  it("marks nothing where nothing changed", () => {
    expect(marks(outlineDiff(outline([wait(3)]), outline([wait(3)])))).toEqual([]);
  });
});

describe("markedChanges", () => {
  it("pairs only lines of one key, so a changed value isn't a rewrite of its neighbour", () => {
    expect(markedChanges('{\n  "a": 1,\n  "b": 2\n}', '{\n  "a": 1,\n  "c": 2\n}')).toBe('{\n  "a": 1,\n  "b": 2  ← remove\n  "c": 2  ← new\n}');
  });
});

describe("callersOfChanged", () => {
  it("lists a function's callers when its parameters change", () => {
    expect(callersOfChanged("Spawn Wave", ["Count", "Where"], ["Count", "Region"], ["Opening", "Reinforce"])).toEqual(["Spawn Wave's parameters changed: (Count, Where) → (Count, Region). Its callers:", "- Opening", "- Reinforce"]);
  });

  it("lists nothing where the parameters are the same", () => {
    expect(callersOfChanged("Spawn Wave", ["Count"], ["Count"], ["Opening"])).toEqual([]);
  });
});
