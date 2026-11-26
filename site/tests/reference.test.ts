// The tool reference (#977): scripts/reference.ts run as the site build runs it, against core's
// built server, and the pages the static export makes from it. This is the guard that keeps a
// tool's page from coming out blank: every tool needs a title and a description, and every
// input a description.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Reference } from "../lib/reference-types";

const SITE = fileURLToPath(new URL("..", import.meta.url));
const OUT = path.join(SITE, "out");

let folder: string;
let reference: Reference;

beforeAll(() => {
  folder = mkdtempSync(path.join(tmpdir(), "sc2-adjutant-reference-"));
  const file = path.join(folder, "reference.json");
  execFileSync(process.execPath, [path.join(SITE, "scripts", "reference.ts"), file], { stdio: "pipe" });
  reference = JSON.parse(readFileSync(file, "utf8")) as Reference;
}, 60_000);

afterAll(() => rmSync(folder, { recursive: true, force: true }));

const tool = (name: string) => {
  const found = reference.tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`no ${name} in the reference`);
  return found;
};

const command = (slug: string) => {
  const found = reference.commands.find((candidate) => candidate.slug === slug);
  if (!found) throw new Error(`no /${slug} in the reference`);
  return found;
};

describe("the tool reference", () => {
  it("lists the server's tools, compile_map among them", () => {
    expect(reference.tools.length).toBeGreaterThan(40);
    expect(reference.tools.map((entry) => entry.name)).toContain("compile_map");
  });

  it("gives every tool a title and a description", () => {
    for (const entry of reference.tools) {
      expect(entry.title?.trim(), `${entry.name}'s title`).toBeTruthy();
      expect(entry.description?.trim(), `${entry.name}'s description`).toBeTruthy();
    }
  });

  it("gives every input a description", () => {
    const missing = reference.tools.flatMap((entry) => entry.inputs.filter((input) => !input.description?.trim()).map((input) => `${entry.name}.${input.name}`));
    expect(missing).toEqual([]);
  });

  it("reads each input's type and whether it is required", () => {
    expect(tool("compile_map").inputs.find((input) => input.name === "mission")).toMatchObject({ type: "string", required: true });
    expect(tool("compile_map").inputs.find((input) => input.name === "keep")).toMatchObject({ type: "string[]", required: false });
    expect(tool("compile_map").inputs.find((input) => input.name === "workspace")).toMatchObject({ required: false });
  });

  it("puts every tool in one of the server's six groups, in the order the server registers them", () => {
    expect(reference.groups.map((group) => group.id)).toEqual(["catalog", "compile", "blueprint", "capture", "session", "stylePack"]);
    const grouped = reference.groups.flatMap((group) => group.tools);
    expect([...grouped].sort()).toEqual(reference.tools.map((entry) => entry.name).sort());
    expect(tool("compile_map").group).toBe("compile");
    expect(tool("get_blueprint").group).toBe("blueprint");
    expect(tool("find_places").group).toBe("stylePack");
  });

  it("reads whether a tool writes from its hints", () => {
    expect(tool("get_blueprint").writes).toBe("none");
    expect(tool("preview").writes).toBe("adds");
    expect(tool("patch_blueprint").writes).toBe("overwrites");
  });

  it("marks a tool only a capable host lists with the capability or Finder it needs", () => {
    expect(tool("compile_map").needs).toEqual({ kind: "none" });
    expect(tool("speak_placeholder_voices").needs).toEqual({ kind: "capability", capabilities: ["tts.speak"] });
    expect(tool("find_doodads").needs).toEqual({ kind: "finder", finder: "Doodad Finder" });
    expect(tool("find_sets").needs).toEqual({ kind: "finder", finder: "Set Finder" });
  });

  it("marks a tool listed on every machine but refused without a capability with the capability it needs", () => {
    expect(tool("capture_exemplar").needs).toEqual({ kind: "refused", capabilities: ["editor.captureTour"] });
    expect(tool("capture_shots").needs).toEqual({ kind: "refused", capabilities: ["editor.captureTour"] });
  });

  it("matches a tool to the root npm script of the same name as its CLI twin", () => {
    expect(tool("compile_map").cli).toBe("npm run compile-map");
    expect(tool("get_blueprint").cli).toBeNull();
  });
});

describe("the skill and command reference", () => {
  it("lists every skill and command the plugin ships, each with a description", () => {
    expect(reference.skills.map((skill) => skill.slug)).toEqual(expect.arrayContaining(["level-design", "doodad-search", "melee-design"]));
    expect(reference.commands.map((command) => command.slug)).toEqual(expect.arrayContaining(["co-design", "check", "compile", "sign-off"]));
    for (const entry of [...reference.skills, ...reference.commands]) expect(entry.description.trim(), `${entry.slug}'s description`).toBeTruthy();
  });

  it("names each tool a command's allowed-tools lets it call by the server's name, and every one exists", () => {
    expect(command("co-design").allowedTools).toEqual(["get_session_state", "list_plugins"]);
    expect(command("compile").allowedTools).toEqual([]);
    const names = new Set(reference.tools.map((entry) => entry.name));
    for (const entry of reference.commands) for (const allowed of entry.allowedTools) expect(names.has(allowed), `${entry.slug} allows ${allowed}`).toBe(true);
  });

  it("keeps the Claude Code tools a command's allowed-tools lets it call as written, apart from the server's", () => {
    expect(command("init")).toMatchObject({ allowedTools: [], tools: [] });
    expect(command("init").claudeCodeTools).toEqual(expect.arrayContaining(["Bash(node --version)", "Bash(npx @team-antioch/sc2-adjutant init:*)"]));
    expect(command("co-design").claudeCodeTools).toEqual([]);
  });

  it("reads a command's argument hint and whether Claude may run it on its own", () => {
    expect(command("compile")).toMatchObject({ argumentHint: "<mission> [folder for the Map Package]", modelInvocable: true });
    expect(command("check")).toMatchObject({ argumentHint: null, modelInvocable: true });
    expect(command("sign-off").modelInvocable).toBe(false);
    expect(command("compile").invocation).toBe("/sc2-adjutant:compile");
  });

  it("lists the tools a skill or command names in backticks, and no word that isn't a tool", () => {
    const skill = reference.skills.find((entry) => entry.slug === "doodad-search");
    expect(skill?.tools).toEqual(expect.arrayContaining(["search_doodads", "find_doodads", "build_doodad_search_page"]));
    // The cinematography skill's reference files name compile_cutscene; its SKILL.md doesn't.
    expect(reference.skills.find((entry) => entry.slug === "cinematography")?.tools).toContain("compile_cutscene");
    expect(reference.skills.find((entry) => entry.slug === "cinematography")?.tools).not.toContain("pool_size");
    expect(command("check").tools).toEqual(expect.arrayContaining(["check_workspace", "get_blueprint", "patch_blueprint"]));
    expect(command("compile").tools).toEqual(expect.arrayContaining(["compile_map", "get_session_state"]));
  });

  it("lists under each tool's Used by the skills and commands that drive it", () => {
    expect(tool("search_doodads").usedBy.skills).toContain("doodad-search");
    expect(tool("compile_map").usedBy.commands).toContain("compile");
    expect(tool("list_plugins").usedBy.commands).toContain("co-design");
    for (const entry of reference.tools) {
      for (const slug of entry.usedBy.skills) expect(reference.skills.find((skill) => skill.slug === slug)?.tools, `${slug} drives ${entry.name}`).toContain(entry.name);
      for (const slug of entry.usedBy.commands) expect(command(slug).tools, `/${slug} drives ${entry.name}`).toContain(entry.name);
    }
  });
});

/** A page of the static export in site/out/, as HTML. */
const page = (route: string) => readFileSync(path.join(OUT, route, "index.html"), "utf8");

describe("the tool pages", () => {

  it("index every tool by group on the Tools page", () => {
    const html = page("tools");
    for (const group of reference.groups) expect(html, group.id).toContain(`id="${group.id}"`);
    for (const entry of reference.tools) expect(html, entry.name).toContain(`href="/tools/${entry.name}/"`);
  });

  it("give each tool a page with its inputs, what it writes, what it needs, its CLI twin and a Used by section", () => {
    for (const entry of reference.tools) {
      const html = page(`tools/${entry.name}`);
      expect(html, entry.name).toContain(entry.name);
      for (const heading of ["inputs", "writes", "needs", "cli-twin", "used-by"]) expect(html, `${entry.name} #${heading}`).toContain(`id="${heading}"`);
      for (const input of entry.inputs) expect(html, `${entry.name}.${input.name}`).toContain(`<code>${input.name}</code>`);
    }
    expect(page("tools/compile_map")).toContain("npm run compile-map");
    expect(page("tools/speak_placeholder_voices")).toContain("tts.speak");
    const capture = page("tools/capture_exemplar");
    expect(capture).toContain("<code>editor.captureTour</code>");
    expect(capture).not.toContain("Nothing: the server lists it on every machine.");
  });

  it("link each tool's Used by to the skills and commands that drive it", () => {
    for (const entry of reference.tools) {
      const html = page(`tools/${entry.name}`);
      for (const slug of entry.usedBy.skills) expect(html, `${entry.name} used by ${slug}`).toContain(`href="/skills/${slug}/"`);
      for (const slug of entry.usedBy.commands) expect(html, `${entry.name} used by /${slug}`).toContain(`href="/commands/${slug}/"`);
    }
    expect(page("tools/search_doodads")).toContain(`href="/skills/doodad-search/"`);
    expect(page("tools/compile_map")).toContain("/sc2-adjutant:compile");
  });
});

describe("the skill and command pages", () => {

  it("index every skill on the Skills page and every command on the Commands page", () => {
    for (const skill of reference.skills) expect(page("skills"), skill.slug).toContain(`href="/skills/${skill.slug}/"`);
    for (const command of reference.commands) expect(page("commands"), command.slug).toContain(`href="/commands/${command.slug}/"`);
  });

  it("give each skill a page with what triggers it and the tools it drives, linked", () => {
    for (const skill of reference.skills) {
      const html = page(`skills/${skill.slug}`);
      for (const heading of ["triggers", "tools"]) expect(html, `${skill.slug} #${heading}`).toContain(`id="${heading}"`);
      for (const name of skill.tools) expect(html, `${skill.slug} drives ${name}`).toContain(`href="/tools/${name}/"`);
    }
    expect(page("skills/melee-design")).toContain("Use when someone wants a melee or ladder map");
  });

  it("give each command a page with how it runs, its argument hint and the tools it drives, linked", () => {
    for (const command of reference.commands) {
      const html = page(`commands/${command.slug}`);
      expect(html, command.slug).toContain(`/sc2-adjutant:${command.slug}`);
      for (const heading of ["triggers", "arguments", "tools"]) expect(html, `${command.slug} #${heading}`).toContain(`id="${heading}"`);
      for (const name of command.tools) expect(html, `/${command.slug} drives ${name}`).toContain(`href="/tools/${name}/"`);
    }
    expect(page("commands/compile")).toContain("&lt;mission&gt; [folder for the Map Package]");
  });

  it("give a command that drives none of the server's tools a page that says so, with the Claude Code tools it runs without asking", () => {
    const html = page("commands/init");
    const tools = html.slice(html.indexOf('id="tools"'));
    expect(tools).toContain("none of the server&#x27;s tools");
    expect(tools).not.toContain("It names no tool.");
    expect(tools).toContain("<code>Bash(node --version)</code>");
    expect(tools).toContain("<code>Bash(npx @team-antioch/sc2-adjutant init:*)</code>");
    expect(page("commands/co-design")).not.toContain("Claude Code tools");
  });
});

const tutorial = (slug: string) => {
  const found = reference.tutorials.find((candidate) => candidate.slug === slug);
  if (!found) throw new Error(`no tutorial ${slug} in the reference`);
  return found;
};

/** The first element of `html` matching `pattern`, or "". */
const part = (html: string, pattern: RegExp) => pattern.exec(html)?.[0] ?? "";
const RAIL = /<nav[^>]*aria-label="Objectives".*?<\/nav>/s;

describe("the tutorials", () => {
  it("lists each tutorial in site/tutorials/, with its objectives and the tools its tool calls name", () => {
    const first = tutorial("first-mission");
    expect(first).toMatchObject({ number: 1, title: "Your first Mission", file: "01-first-mission.mdx" });
    expect(first.objectives.length).toBeGreaterThan(3);
    expect(first.tools).toEqual(expect.arrayContaining(["get_session_state", "sign_off_stage", "compile_map"]));
  });

  it("marks the step that plays the Mission with the Host Adapters that can run Test Document", () => {
    const step = tutorial("first-mission").objectives.find((objective) => objective.needs.includes("editor.testDocument"));
    expect(step?.hostAdapters).toEqual(["macOS", "Windows"]);
    expect(reference.hostAdapters.map((adapter) => adapter.label)).toEqual(["macOS", "Windows"]);
  });

  it("lists the doodads tutorial second, marking the steps whose tools only the Doodad Finder serves", () => {
    const doodads = tutorial("finding-doodads");
    expect(doodads).toMatchObject({ number: 2, title: "Finding doodads", file: "02-finding-doodads.mdx" });
    expect(doodads.tools).toEqual(expect.arrayContaining(["find_doodads", "search_doodads", "build_doodad_search_page", "open_doodad_finder"]));
    const finderTools = reference.tools.filter((entry) => entry.needs.kind === "finder" && entry.needs.finder === "Doodad Finder").map((entry) => entry.name);
    expect(finderTools).toEqual(expect.arrayContaining(["find_doodads", "open_doodad_finder"]));
    expect(doodads.objectives.filter((objective) => objective.finders.includes("Doodad Finder")).length).toBeGreaterThan(0);
    expect(tutorial("first-mission").objectives.every((objective) => objective.finders.length === 0)).toBe(true);
  });

  it("lists the melee tutorial third, compiling with compile_melee_map in steps that need no Host Adapter or Finder", () => {
    const melee = tutorial("melee-map");
    expect(melee).toMatchObject({ number: 3, title: "A 1v1 melee map", file: "03-melee-map.mdx" });
    expect(melee.tools).toEqual(["list_plugins", "compile_melee_map"]);
    expect(melee.objectives.every((objective) => objective.hostAdapters.length === 0 && objective.finders.length === 0)).toBe(true);
  });

  it("lists the cutscene tutorial fourth, marking its text-to-speech, Set Finder and Test Document steps", () => {
    const cutscene = tutorial("cutscene");
    expect(cutscene).toMatchObject({ number: 4, title: "A cutscene with placeholder voices", file: "04-cutscene.mdx" });
    expect(cutscene.tools).toEqual(expect.arrayContaining(["speak_placeholder_voices", "find_sets", "import_set", "compile_map", "compile_cutscene"]));
    expect(cutscene.objectives.find((objective) => objective.id === "voices")).toMatchObject({ needs: ["tts.speak"], hostAdapters: ["macOS", "Windows"] });
    expect(cutscene.objectives.filter((objective) => objective.finders.includes("Set Finder")).map((objective) => objective.id)).toEqual(["set"]);
    expect(cutscene.objectives.filter((objective) => objective.needs.includes("editor.testDocument")).map((objective) => objective.id)).toEqual(["play", "revise"]);
  });

  it("lists the Trigger Scene tutorial fifth, marking its Test Document steps", () => {
    const triggerScene = tutorial("trigger-scene");
    expect(triggerScene).toMatchObject({ number: 5, title: "An in-game cutscene on the map", file: "05-trigger-scene.mdx" });
    expect(triggerScene.tools).toEqual(expect.arrayContaining(["get_blueprint", "patch_blueprint", "compile_map", "test_mission", "reopen_stage", "sign_off_stage"]));
    expect(triggerScene.tools).not.toContain("compile_cutscene");
    expect(triggerScene.objectives.filter((objective) => objective.needs.includes("editor.testDocument")).map((objective) => objective.id)).toEqual(["play", "revise"]);
  });

  it("lists the Style Pack tutorial sixth, calling every Style Pack tool, with only its captures needing a Host Adapter", () => {
    const stylePack = tutorial("style-pack");
    expect(stylePack).toMatchObject({ number: 6, title: "Your own Style Pack", file: "06-style-pack.mdx" });
    const group = reference.groups.find((entry) => entry.id === "stylePack")!;
    expect(stylePack.tools).toEqual(expect.arrayContaining(group.tools));
    expect(stylePack.objectives.filter((objective) => objective.needs.length > 0).map((objective) => objective.id)).toEqual(["capture"]);
    expect(stylePack.objectives.find((objective) => objective.id === "capture")).toMatchObject({ needs: ["editor.captureTour"] });
    expect(stylePack.skills).toEqual(expect.arrayContaining(["style-pack-builder", "exemplar-design"]));
  });

  it("lists the Still Review tutorial seventh, calling every Still Review tool, with only its captures needing a Host Adapter", () => {
    const stills = tutorial("still-review");
    expect(stills).toMatchObject({ number: 7, title: "Reviewing stills in game", file: "07-still-review.mdx" });
    expect(stills.tools).toEqual(expect.arrayContaining(["shots_for_zones", "capture_shots", "build_still_review", "record_still_feedback"]));
    expect(stills.objectives.filter((objective) => objective.needs.length > 0).map((objective) => objective.id)).toEqual(["capture", "retake", "round-2"]);
    expect(stills.objectives.filter((objective) => objective.needs.length > 0).every((objective) => objective.needs.join() === "editor.captureTour")).toBe(true);
    expect(stills.skills).toEqual(["still-review"]);
  });

  it("lists under each skill the tutorials that link to its page, and only those", () => {
    for (const skill of reference.skills) {
      const linking = reference.tutorials.filter((candidate) => candidate.skills.includes(skill.slug)).map((candidate) => candidate.slug);
      expect(skill.tutorials, skill.slug).toEqual(linking);
    }
    expect(reference.skills.find((skill) => skill.slug === "style-pack-builder")?.tutorials).toEqual(["style-pack"]);
  });

  it("lists under each tool's Used by the tutorials whose tool calls name it, and only those", () => {
    expect(tool("compile_map").usedBy.tutorials).toContain("first-mission");
    expect(tool("find_doodads").usedBy.tutorials).not.toContain("first-mission");
    expect(tool("find_doodads").usedBy.tutorials).toEqual(["finding-doodads"]);
    expect(tool("compile_melee_map").usedBy.tutorials).toEqual(["melee-map"]);
    expect(tool("compile_cutscene").usedBy.tutorials).toEqual(["cutscene"]);
    for (const entry of reference.tools) {
      const naming = reference.tutorials.filter((candidate) => candidate.tools.includes(entry.name)).map((candidate) => candidate.slug);
      expect(entry.usedBy.tutorials, entry.name).toEqual(naming);
    }
  });
});

describe("the tutorial pages", () => {
  it("index every tutorial in the mission-select grid on the Tutorials page", () => {
    const grid = part(page("tutorials"), /<ol[^>]*aria-label="Mission select".*?<\/ol>/s);
    for (const entry of reference.tutorials) expect(grid, entry.slug).toContain(`href="/tutorials/${entry.slug}/"`);
    expect(grid).toContain("Your first Mission");
    expect(grid).toContain("Finding doodads");
    expect(grid).toContain("A 1v1 melee map");
    expect(grid).toContain("A cutscene with placeholder voices");
    expect(grid).toContain("An in-game cutscene on the map");
    expect(grid).toContain("Your own Style Pack");
    expect(grid, "no locked card once every planned tutorial is written").not.toContain("aria-disabled");
  });

  it("give each tutorial a page with its objectives in the rail, each linked to its step", () => {
    for (const entry of reference.tutorials) {
      const html = page(`tutorials/${entry.slug}`);
      const rail = part(html, RAIL);
      for (const objective of entry.objectives) {
        expect(rail, `${entry.slug} rail ${objective.id}`).toContain(`href="#${objective.id}"`);
        expect(html, `${entry.slug} step ${objective.id}`).toContain(`id="${objective.id}"`);
      }
    }
  });

  it("mark a step that needs a Host Adapter capability, in the rail and on the step", () => {
    const html = page("tutorials/first-mission");
    expect(part(html, RAIL)).toContain("macOS · Windows");
    const step = part(html, /<section[^>]*id="stage-4".*?<\/section>/s);
    expect(step).toContain("editor.testDocument");
    expect(step).toContain("macOS · Windows");
  });

  it("mark a step that needs the Doodad Finder, in the rail and on the step", () => {
    const html = page("tutorials/finding-doodads");
    expect(part(html, RAIL)).toContain("Doodad Finder");
    const marked = tutorial("finding-doodads").objectives.find((objective) => objective.finders.includes("Doodad Finder"))!;
    const step = part(html, new RegExp(`<section[^>]*id="${marked.id}".*?</section>`, "s"));
    expect(step).toContain("needs the Doodad Finder");
  });

  it("show the session as the author's turns and Claude's, each tool call linked to its tool page", () => {
    const html = page("tutorials/first-mission");
    expect(html).toContain('data-turn="you"');
    expect(html).toContain('data-turn="claude"');
    for (const name of tutorial("first-mission").tools) expect(html, name).toContain(`href="/tools/${name}/"`);
  });

  it("link a tool's Used by to the tutorials that call it, by title", () => {
    for (const entry of reference.tools) {
      for (const slug of entry.usedBy.tutorials) expect(page(`tools/${entry.name}`), `${entry.name} used by ${slug}`).toContain(`href="/tutorials/${slug}/"`);
    }
    expect(page("tools/compile_map")).toContain("Your first Mission");
  });

  it("link a skill's page to the tutorials that link to it, by title, and give a skill no tutorial links no such section", () => {
    for (const skill of reference.skills) {
      const html = page(`skills/${skill.slug}`);
      if (skill.tutorials.length === 0) expect(html, skill.slug).not.toContain('id="tutorials"');
      for (const slug of skill.tutorials) expect(part(html, /id="tutorials".*$/s), `${skill.slug} in ${slug}`).toContain(`href="/tutorials/${slug}/"`);
    }
    expect(page("skills/style-pack-builder")).toContain("Your own Style Pack");
  });
});
