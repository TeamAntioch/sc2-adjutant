// The style-pack-builder skill (#30) walks a mapper from a handful of maps to a Style Pack of their
// own through the Style Pack tools. Each numbered step names the tool it uses and ends on when it's
// done, so a run takes the same path every time; and the skill names every Style Pack tool, so a
// tool added to the group or renamed fails here until the skill says when to use it.
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { STYLE_PACK_TOOLS } from "../../core/src/mcp/tools/style-pack.ts";

const SKILL = await readFile(new URL("../skills/style-pack-builder/SKILL.md", import.meta.url), "utf8");

/** The skill's numbered steps (`## 1. Scaffold`), each with its text up to the next heading. */
const steps = [...SKILL.matchAll(/^## (\d+)\. ([^\n]+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)].map(([, n, title, body]) => ({ n: Number(n), title: title!, body: body! }));

/** The tools a step's text names, as code (`study_exemplar`). */
const toolsIn = (text: string) => [...text.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map(([, name]) => name!);

describe("the style-pack-builder skill", () => {
  it("has the ticket's seven steps, in order", () => {
    expect(steps.map((step) => step.title.split(/[ :]/)[0])).toEqual(["Scaffold", "Add", "Study", "Capture", "Analyse", "Ratify", "Package"]);
    expect(steps.map((step) => step.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it.each(STYLE_PACK_TOOLS)("names %s in a step", (tool) => {
    expect(steps.flatMap((step) => toolsIn(step.body))).toContain(tool);
  });

  it("names the tool each step uses, or says it uses none, and ends every step on when it's done", () => {
    for (const step of steps) {
      if (!/\buses no tool\b/.test(step.body)) expect(toolsIn(step.body), `step ${step.n}`).not.toEqual([]);
      expect(step.body, `step ${step.n}`).toMatch(/\*\*Done when\*\*/);
    }
  });
});
