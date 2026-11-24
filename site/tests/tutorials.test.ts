// The tutorials' reader (#980): scripts/tutorials.ts, which the reference script runs over
// site/tutorials/. A <ToolCall> must name a tool the server lists, with inputs it takes, and an
// <Objective>'s `needs` must be a Host Adapter capability, or the reader throws and the build fails.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { Field, HostAdapter, Tool } from "../lib/reference-types";
import { type Known, parseTutorial, readTutorials } from "../scripts/tutorials.ts";

const SITE = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = path.join(SITE, "tests", "fixtures", "tutorials");

const field = (name: string, required = false): Field => ({ name, type: "string", required, description: name });
const TOOLS: Pick<Tool, "name" | "inputs">[] = [
  { name: "get_session_state", inputs: [field("mission"), field("workspace")] },
  { name: "compile_map", inputs: [field("mission", true), field("refresh"), field("keep")] },
  { name: "test_mission", inputs: [field("mission", true)] },
];
const HOSTS: HostAdapter[] = [
  { name: "host-macos", label: "macOS", capabilities: ["editor.open", "editor.refresh", "editor.testDocument"] },
  { name: "host-windows", label: "Windows", capabilities: ["editor.open", "editor.testDocument", "game.launch"] },
];
const known: Known = { tools: TOOLS, hostAdapters: HOSTS, finders: ["Doodad Finder", "Set Finder"] };

/** A tutorial's source: its meta, then `body`. */
const source = (body: string) => `export const meta = { title: "T", summary: "S", minutes: 3 };\n\n${body}\n`;
const parse = (body: string) => parseTutorial(source(body), "01-test.mdx", known);

describe("the tutorials' reader", () => {
  it("reads each tutorial in its folder, in the order of the numbers its file names start with", () => {
    const tutorials = readTutorials(path.join(FIXTURES, "good"), known);
    expect(tutorials.map(({ slug, number, title, minutes }) => ({ slug, number, title, minutes }))).toEqual([
      { slug: "sample-briefing", number: 1, title: "A sample briefing", minutes: 5 },
      { slug: "second", number: 2, title: "A second briefing", minutes: 2 },
    ]);
    expect(tutorials[0]!.summary).toBe("Compile a Mission, then play it.");
  });

  it("lists each objective, with an id from its title unless it gives one", () => {
    const [tutorial] = readTutorials(path.join(FIXTURES, "good"), known);
    expect(tutorial!.objectives.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: "compile-it", title: "Compile it" },
      { id: "play", title: "Play it" },
    ]);
  });

  it("marks an objective that needs a Host Adapter capability with the Host Adapters that have it", () => {
    const [tutorial] = readTutorials(path.join(FIXTURES, "good"), known);
    expect(tutorial!.objectives[0]).toMatchObject({ needs: [], hostAdapters: [] });
    expect(tutorial!.objectives[1]).toMatchObject({ needs: ["editor.testDocument"], hostAdapters: ["macOS", "Windows"] });
    expect(parse(`<Objective title="Refresh" needs={["editor.open", "editor.refresh"]}>\n\nx\n\n</Objective>`).objectives[0]).toMatchObject({
      needs: ["editor.open", "editor.refresh"],
      hostAdapters: ["macOS"],
    });
  });

  it("marks an objective that needs a Finder with that Finder, and a Finder with a capability with both", () => {
    expect(parse(`<Objective title="Browse" needs="Doodad Finder">\n\nx\n\n</Objective>`).objectives[0]).toMatchObject({
      needs: [],
      finders: ["Doodad Finder"],
      hostAdapters: [],
    });
    expect(parse(`<Objective title="Look" needs={["Doodad Finder", "editor.open"]}>\n\nx\n\n</Objective>`).objectives[0]).toMatchObject({
      needs: ["editor.open"],
      finders: ["Doodad Finder"],
    });
    const [tutorial] = readTutorials(path.join(FIXTURES, "good"), known);
    expect(tutorial!.objectives[1]).toMatchObject({ finders: [] });
  });

  it("lists the tools its tool calls name, block or inline, each once, in the order they're first called", () => {
    const tutorials = readTutorials(path.join(FIXTURES, "good"), known);
    expect(tutorials.map((tutorial) => tutorial.tools)).toEqual([["compile_map", "test_mission"], ["get_session_state"]]);
  });

  it("lists the skills its links point to, each once, and fails on a link to a skill the plugin doesn't ship", () => {
    const body = `See [the skill](/skills/level-design/) and [again](/skills/level-design/#tools), then [another][m], not [a tool](/tools/compile_map/).\n\n[m]: /skills/melee-design`;
    expect(parse(body).skills).toEqual(["level-design", "melee-design"]);
    const withSkills: Known = { ...known, skills: ["level-design", "melee-design"] };
    expect(parseTutorial(source(body), "01-test.mdx", withSkills).skills).toEqual(["level-design", "melee-design"]);
    expect(() => parseTutorial(source("[gone](/skills/vanished/)"), "01-test.mdx", withSkills)).toThrow(/01-test\.mdx.*vanished/);
  });

  it("fails on a tool call naming a tool the server doesn't list", () => {
    expect(() => parse(`<ToolCall name="compile_everything" args={{ mission: "m" }} />`)).toThrow(/01-test\.mdx.*compile_everything.*isn't a tool/);
  });

  it("fails on a tool call naming an input its tool doesn't take", () => {
    expect(() => parse(`<ToolCall name="compile_map" args={{ mission: "m", missions: ["n"] }} />`)).toThrow(/compile_map.*missions/);
  });

  it("fails on a tool call that leaves out a required input", () => {
    expect(() => parse(`<ToolCall name="compile_map" args={{ refresh: true }} />`)).toThrow(/compile_map.*mission/);
  });

  it("fails on a tool call with no name, or with args that aren't written out", () => {
    expect(() => parse(`<ToolCall args={{ mission: "m" }} />`)).toThrow(/name/);
    expect(() => parse(`<ToolCall name="compile_map" args={{ mission: someMission }} />`)).toThrow(/args/);
    expect(() => parse(`<ToolCall name="compile_map" args="mission" />`)).toThrow(/args/);
  });

  it("fails on an objective needing a capability no Host Adapter has, or one that isn't a capability", () => {
    expect(() => parse(`<Objective title="Speak" needs="tts.speak">\n\nx\n\n</Objective>`)).toThrow(/tts\.speak/);
    expect(() => parse(`<Objective title="Fly" needs="editor.fly">\n\nx\n\n</Objective>`)).toThrow(/editor\.fly.*Doodad Finder/);
  });

  it("fails on two objectives with one id, an objective with no title, or a tutorial with no meta", () => {
    expect(() => parse(`<Objective title="Go">\n\nx\n\n</Objective>\n\n<Objective title="Go!">\n\ny\n\n</Objective>`)).toThrow(/go/);
    expect(() => parse(`<Objective>\n\nx\n\n</Objective>`)).toThrow(/title/);
    expect(() => parseTutorial(`<Objective title="Go">\n\nx\n\n</Objective>\n`, "01-test.mdx", known)).toThrow(/meta/);
  });

  it("fails the reference script, and so the site build, on a tutorial naming a tool the server doesn't list", () => {
    const folder = mkdtempSync(path.join(tmpdir(), "sc2-adjutant-tutorials-"));
    try {
      const run = () =>
        execFileSync(process.execPath, [path.join(SITE, "scripts", "reference.ts"), path.join(folder, "reference.json"), "--tutorials", path.join(FIXTURES, "unknown-tool")], {
          stdio: "pipe",
          encoding: "utf8",
        });
      expect(run).toThrow(/compile_everything/);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }, 60_000);
});
