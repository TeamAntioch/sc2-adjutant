// A trigger's change in the Editor's form (#46): the outline's text with the changed lines marked.
import { describe, expect, it } from "vitest";

import { markedChanges, outlineDiff } from "../../src/map/outline-diff.js";
import { editorForm } from "../../src/map/editor-form.js";
import type { TriggerOutline } from "../../src/map/outline-trigger.js";
import type { AuthoringTrigger } from "../../src/triggers/author-trigger.js";

const outline = (actions: AuthoringTrigger["actions"], unwritable: string[] = []): TriggerOutline => {
  const trigger: AuthoringTrigger = { name: "Opening", events: [{ function: "Map Initialization" }], conditions: [], actions };
  return { name: "Opening", id: "AAAA0001", owner: "Blueprint", file: "triggers/opening.json", trigger, unwritable, text: "" };
};
const wait = (seconds: number) => ({ function: "Wait", params: { Time: seconds } });
const pause = { function: "Pause All Units", params: { Pause: true } };

const marks = (diff: string): string[] => diff.split("\n").filter((line) => line.includes("←"));

describe("editorForm", () => {
  it("writes a call as its name and every argument, a block's statements under its slot's name", () => {
    const trigger: AuthoringTrigger = {
      name: "Opening",
      initiallyOff: true,
      variables: [{ name: "Mode", type: "Boolean", value: false }],
      events: [{ function: "Map Initialization" }],
      conditions: [],
      actions: [
        { function: "Set Variable", params: { Variable: { variable: "Mode" }, Value: true } },
        { function: "If Then Else", params: { Condition: { function: "Compare", params: { Left: { variable: "Mode" }, Right: { preset: "Active" } } } }, blocks: { Then: [wait(2), { comment: "later" }] } },
      ],
    };

    expect(editorForm(trigger)).toBe(
      [
        "Trigger Opening (initially off)",
        "Local Variables",
        "  Mode (Boolean) = false",
        "Events",
        "  Map Initialization",
        "Actions",
        "  Set Variable (Variable = Mode, Value = true)",
        "  If Then Else (Condition = Compare (Left = Mode, Right = Active))",
        "    Then",
        "      Wait (Time = 2)",
        "      // later",
      ].join("\n"),
    );
  });
});

describe("outlineDiff", () => {
  it("marks an added action's lines new", () => {
    const diff = outlineDiff(outline([wait(3)]), outline([wait(3), pause]));

    expect(marks(diff)).toEqual(["  Pause All Units (Pause = true)  ← new"]);
    // The rest is as it was, unmarked.
    expect(diff).toContain("  Wait (Time = 3)\n");
  });

  it("marks a changed argument was, with the old line", () => {
    const diff = outlineDiff(outline([wait(3)]), outline([wait(4.5)]));

    expect(marks(diff)).toEqual(["  Wait (Time = 4.5)  ← was: Wait (Time = 3)"]);
  });

  it("keeps a removed action's lines in place, marked remove", () => {
    const diff = outlineDiff(outline([wait(3), pause]), outline([wait(3)]));

    expect(marks(diff)).toEqual(["  Pause All Units (Pause = true)  ← remove"]);
  });

  it("marks every line new for a trigger with nothing before it, and lists what the input can't express", () => {
    const diff = outlineDiff(undefined, outline([wait(3)], ["actions[0]: a thing"]));

    const [form, note] = diff.split("\nNot written back as it is");
    expect(form!.split("\n").every((line) => line.endsWith("← new"))).toBe(true);
    expect(note).toContain("- actions[0]: a thing");
  });

  it("marks nothing where nothing changed", () => {
    expect(marks(outlineDiff(outline([wait(3)]), outline([wait(3)])))).toEqual([]);
  });
});


describe("markedChanges", () => {
  it("pairs a removed and an added call of one name as a changed line, and leaves others removed and new", () => {
    expect(markedChanges("A\n  Wait (Time = 1)\n  Kill (Unit = x)\nZ", "A\n  Wait (Time = 2)\n  Spawn (Unit = y)\nZ")).toBe("A\n  Kill (Unit = x)  ← remove\n  Wait (Time = 2)  ← was: Wait (Time = 1)\n  Spawn (Unit = y)  ← new\nZ");
  });
});
