// The report-missing-feature skill's script builds what Claude files from a JSON draft: the
// `gh issue create` arguments, the Markdown body for that route, and the prefilled issue-form URL.
// Nothing here calls GitHub: the arguments and the URL are checked as values.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { draftProblems, environmentLine, FIELDS, fileRoute, formUrl, GH_PERMISSION, ghComment, ghCreate, issueTitle, LABELS, markdownBody, osName, REPO, TEMPLATE, TITLE_PREFIX, URL_LIMIT, workspaceNames } from "../skills/report-missing-feature/scripts/report.mjs";

const draft = {
  title: "trigger folders inside a Kept trigger",
  missing: "A Blueprint can't declare a folder inside a Kept trigger.",
  workaround: "The folder was made by hand in the Editor.",
  suggestion: "A `folder` key on a Kept trigger's entry.",
  context: "Stage 5, the sync tool",
  environment: "plugin 0.1.0, core 0.1.0, macOS 15.2",
};

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FORM = path.join(REPO_ROOT, ".github", "ISSUE_TEMPLATE", "missing-feature.yml");
const SKILL = fileURLToPath(new URL("../skills/report-missing-feature/SKILL.md", import.meta.url));

type Yaml = string | boolean | Yaml[] | { [key: string]: Yaml };

/**
 * Reads the YAML an issue form is written in: block mappings and sequences by indentation, flow
 * sequences of plain words (`[a, b]`), quoted and plain scalars, and `|` block scalars. Enough for
 * the form, with no YAML library; anything else it meets it throws on, so a change to the form's
 * shape fails loudly instead of parsing wrong.
 */
function parseForm(source: string): Yaml {
  const lines = source.split("\n").map((raw) => ({ indent: raw.length - raw.trimStart().length, text: raw.trim() }));
  let at = 0;
  const skipBlank = () => {
    while (at < lines.length && (lines[at]!.text === "" || lines[at]!.text.startsWith("#"))) at++;
  };
  const scalar = (value: string): Yaml => {
    if (value === "true" || value === "false") return value === "true";
    if (/^\[.*\]$/.test(value)) return value.slice(1, -1).split(",").map((item) => scalar(item.trim()));
    if (/^".*"$/.test(value)) return JSON.parse(value) as string;
    if (/^'.*'$/.test(value)) return value.slice(1, -1).replaceAll("''", "'");
    if (/^[[{&*!|>%@`]/.test(value)) throw new Error(`unsupported YAML value: ${value}`);
    return value;
  };
  const blockScalar = (indent: number): string => {
    const kept: string[] = [];
    while (at < lines.length && (lines[at]!.text === "" || lines[at]!.indent > indent)) kept.push(lines[at++]!.text);
    return kept.join("\n").trim();
  };
  // A mapping's entries at `indent`, the first of which may already be split off a "- " line.
  const mapping = (indent: number, first?: string): { [key: string]: Yaml } => {
    const result: { [key: string]: Yaml } = {};
    let line = first;
    for (;;) {
      if (line === undefined) {
        skipBlank();
        if (at >= lines.length || lines[at]!.indent !== indent || lines[at]!.text.startsWith("- ")) return result;
        line = lines[at++]!.text;
      }
      const match = /^([\w-]+):(?:\s+(.*))?$/.exec(line);
      if (!match) throw new Error(`unsupported YAML line: ${line}`);
      const [, key, value] = match;
      result[key!] = value === undefined ? node(indent) : value === "|" ? blockScalar(indent) : scalar(value);
      line = undefined;
    }
  };
  const sequence = (indent: number): Yaml[] => {
    const result: Yaml[] = [];
    for (;;) {
      skipBlank();
      if (at >= lines.length || lines[at]!.indent !== indent || !lines[at]!.text.startsWith("- ")) return result;
      const item = lines[at++]!.text.slice(2);
      result.push(/^[\w-]+:/.test(item) ? mapping(indent + 2, item) : scalar(item));
    }
  };
  // The value nested under a key at `parent`: a sequence or a mapping, on the lines below.
  const node = (parent: number): Yaml => {
    skipBlank();
    const next = lines[at];
    if (!next || next.indent < parent || (next.indent === parent && !next.text.startsWith("- "))) throw new Error("a key with no value");
    return next.text.startsWith("- ") ? sequence(next.indent) : mapping(next.indent);
  };
  const form = mapping(0);
  skipBlank();
  if (at < lines.length) throw new Error(`unread YAML from line ${at + 1}`);
  return form;
}

describe("the issue form", () => {
  it("is read by the test's parser as GitHub reads it", () => {
    expect(parseForm('name: x\nlabels: [a, b]\nbody:\n  - type: markdown\n    attributes:\n      value: |\n        Hello.\n\n        Again.\n  - type: input\n    id: y\n    attributes:\n      label: "Y: why"\n    validations:\n      required: true\n')).toEqual({
      name: "x",
      labels: ["a", "b"],
      body: [
        { type: "markdown", attributes: { value: "Hello.\n\nAgain." } },
        { type: "input", id: "y", attributes: { label: "Y: why" }, validations: { required: true } },
      ],
    });
  });

  it("has the title prefix, labels and fields, with their labels and required ones, that the script fills", async () => {
    const form = parseForm(await readFile(FORM, "utf8")) as { [key: string]: Yaml };
    expect(form.title).toBe(TITLE_PREFIX);
    expect(form.labels).toEqual(LABELS);
    const fields = (form.body as { [key: string]: Yaml }[])
      .filter((item) => item.type !== "markdown")
      .map((item) => ({
        id: item.id,
        heading: (item.attributes as { [key: string]: Yaml }).label,
        required: (item.validations as { [key: string]: Yaml } | undefined)?.required === true,
      }));
    expect(fields).toEqual(FIELDS);
    expect(path.basename(FORM)).toBe(TEMPLATE);
  });

  it("is the one the skill names, with each field id, and the repo the script files to", async () => {
    const skill = await readFile(SKILL, "utf8");
    for (const { id } of FIELDS) expect(skill).toContain(`\`${id}\``);
    expect(skill).toContain(REPO);
    expect(skill).toContain(TITLE_PREFIX.trim());
    const required = /^(.*) are required\.$/m.exec(skill)?.[1] ?? "";
    expect([...required.matchAll(/`(\w+)`/g)].map(([, id]) => id)).toEqual(["title", ...FIELDS.filter((field) => field.required).map((field) => field.id)]);
  });
});

describe("the Markdown body", () => {
  it("has the form's headings, in its order, with each field under its own", () => {
    expect(markdownBody(draft)).toBe(
      [
        "### What was missing",
        "",
        "A Blueprint can't declare a folder inside a Kept trigger.",
        "",
        "### What was done instead",
        "",
        "The folder was made by hand in the Editor.",
        "",
        "### What support could look like (optional)",
        "",
        "A `folder` key on a Kept trigger's entry.",
        "",
        "### Where it came up (Co-design Stage or tool)",
        "",
        "Stage 5, the sync tool",
        "",
        "### Environment (plugin and core versions, OS)",
        "",
        "plugin 0.1.0, core 0.1.0, macOS 15.2",
        "",
      ].join("\n"),
    );
  });

  it("marks an empty optional field as the form does", () => {
    const body = markdownBody({ ...draft, suggestion: "  ", context: undefined });
    expect(body).toContain("### What support could look like (optional)\n\n_No response_\n");
    expect(body).toContain("### Where it came up (Co-design Stage or tool)\n\n_No response_\n");
  });
});

describe("the title", () => {
  it("is the capability after the form's prefix, added once", () => {
    expect(issueTitle(draft)).toBe("Missing: trigger folders inside a Kept trigger");
    expect(issueTitle({ ...draft, title: "Missing: trigger folders" })).toBe("Missing: trigger folders");
    expect(issueTitle({ ...draft, title: "  missing:   trigger folders " })).toBe("Missing: trigger folders");
  });
});

describe("a draft", () => {
  it("needs a title and both required fields", () => {
    expect(() => ghCreate({ ...draft, title: " " })).toThrow(/title/);
    expect(() => ghCreate({ ...draft, missing: "" })).toThrow(/missing/);
    expect(() => markdownBody({ ...draft, workaround: undefined })).toThrow(/workaround/);
    expect(() => draftProblems(null)).toThrow(/JSON object/);
  });

  it("has a title GitHub takes", () => {
    expect(() => issueTitle({ ...draft, title: "x".repeat(250) })).toThrow(/256/);
  });

  it("has only the form's fields and a title", () => {
    expect(() => markdownBody({ ...draft, mission: "x" })).toThrow(/mission/);
  });

  it("has a capability after the title's prefix", () => {
    for (const title of ["Missing:", "  missing:   ", "MISSING: "]) expect(() => issueTitle({ ...draft, title })).toThrow(/needs title/);
  });

  it("holds only strings, refusing any other value rather than dropping it", () => {
    expect(() => markdownBody({ ...draft, suggestion: ["a", "b"] })).toThrow("The draft's suggestion must be text, a JSON string.");
    expect(() => draftProblems({ ...draft, title: 7, context: null })).toThrow("The draft's title, context must be text, a JSON string.");
    expect(() => formUrl({ ...draft, environment: { plugin: "0.1.0" } })).toThrow(/environment/);
  });
});

describe("the gh route", () => {
  it("creates the issue in the public repo with the title and both labels, and the Markdown body on stdin", () => {
    expect(ghCreate(draft)).toEqual({
      args: ["issue", "create", "--repo", "TeamAntioch/sc2-adjutant", "--title", "Missing: trigger folders inside a Kept trigger", "--body-file", "-", "--label", "missing-feature", "--label", "needs-triage"],
      input: markdownBody(draft),
    });
  });

  it("files directly only for a user with push access (write and above), since GitHub drops anyone else's labels", () => {
    expect(GH_PERMISSION).toEqual(["repo", "view", "TeamAntioch/sc2-adjutant", "--json", "viewerPermission", "--jq", ".viewerPermission"]);
    for (const permission of ["ADMIN", "MAINTAIN", "WRITE", "write\n"]) expect(fileRoute(permission)).toBe("gh");
    for (const permission of ["TRIAGE", "READ", "NONE", "", "\n", undefined, null]) expect(fileRoute(permission)).toBe("form");
  });

  it("comments on an existing report with the same body, given its number with or without #", () => {
    const comment = { args: ["issue", "comment", "412", "--repo", "TeamAntioch/sc2-adjutant", "--body-file", "-"], input: markdownBody(draft) };
    expect(ghComment("412", draft)).toEqual(comment);
    expect(ghComment("#412", draft)).toEqual(comment);
    expect(() => ghComment("x12", draft)).toThrow("Not an issue number: x12");
  });
});

describe("the form route", () => {
  it("opens the form with the title and each filled field as its id, percent-encoded so a shell's quotes hold it", () => {
    const short = { title: "x's (a)!", missing: "a b\nc", workaround: "c&d=e", environment: "plugin 0.1.0", suggestion: " " };
    expect(formUrl(short)).toEqual({
      url: "https://github.com/TeamAntioch/sc2-adjutant/issues/new?template=missing-feature.yml&title=Missing%3A%20x%27s%20%28a%29%21&missing=a%20b%0Ac&workaround=c%26d%3De&environment=plugin%200.1.0",
      leftOut: [],
    });
  });

  it("leaves the suggestion out of a URL over GitHub's limit, and gives its text for the clipboard", () => {
    const suggestion = "a ".repeat(URL_LIMIT);
    const { url, leftOut, clipboard } = formUrl({ ...draft, suggestion });
    expect(url.length).toBeLessThanOrEqual(URL_LIMIT);
    expect(new URL(url).searchParams.has("suggestion")).toBe(false);
    expect(new URL(url).searchParams.get("missing")).toBe(draft.missing);
    expect(leftOut).toEqual(["suggestion"]);
    expect(clipboard).toBe(suggestion.trim());
  });

  it("leaves every field out when the required ones alone are over the limit, and gives the whole body, less the title the form has, for the clipboard", () => {
    const long = { ...draft, missing: "ü".repeat(URL_LIMIT / 2) };
    const { url, leftOut, clipboard } = formUrl(long);
    expect(url).toBe("https://github.com/TeamAntioch/sc2-adjutant/issues/new?template=missing-feature.yml&title=Missing%3A%20trigger%20folders%20inside%20a%20Kept%20trigger");
    expect(leftOut).toEqual(["missing", "workaround", "suggestion", "context", "environment"]);
    expect(clipboard).toBe(markdownBody(long));
  });
});

describe("the environment", () => {
  it("names the plugin's and core's versions and the OS, and nothing of the machine", () => {
    expect(environmentLine({ plugin: "0.1.0", core: "0.1.1", os: osName("darwin", "25.0.0", "15.2") })).toBe("plugin 0.1.0, core 0.1.1, macOS 15.2");
    expect(environmentLine({ plugin: "0.1.0", core: undefined, os: osName("win32", "10.0.26100") })).toBe("plugin 0.1.0, core not found, Windows 10.0.26100");
    expect(osName("linux", "6.8.0-45-generic")).toBe("Linux 6.8.0-45-generic");
    expect(osName("darwin", "25.0.0")).toBe("macOS (Darwin 25.0.0)");
  });
});

describe("the command line", () => {
  const SCRIPT = fileURLToPath(new URL("../skills/report-missing-feature/scripts/report.mjs", import.meta.url));
  const run = async (args: string[], cwd: string) => promisify(execFile)(process.execPath, [SCRIPT, ...args], { cwd });

  it("previews the exact text, gives the form URL and its clipboard text, and checks the draft against the Workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sc2-adjutant-report-"));
    try {
      await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "glasstide", name: "Glass Tide" } }));
      await writeFile(path.join(root, "draft.json"), JSON.stringify(draft));
      expect((await run(["preview", "draft.json"], root)).stdout).toBe(`${issueTitle(draft)}\n\n${markdownBody(draft)}`);
      expect(JSON.parse((await run(["url", "draft.json"], root)).stdout)).toEqual(formUrl(draft));
      expect((await run(["clipboard", "draft.json"], root)).stdout).toBe("");
      expect((await run(["check", "draft.json"], root)).stdout).toBe("Nothing to leave out found.\n");
      await writeFile(path.join(root, "draft.json"), JSON.stringify({ ...draft, context: "Stage 5 of Glass Tide" }));
      await expect(run(["check", "draft.json"], root)).rejects.toMatchObject({ code: 1, stdout: "context: the Workspace's name Glass Tide\n" });
      await expect(run(["fly", "draft.json"], root)).rejects.toMatchObject({ code: 2 });
      // An error is 2, apart from the 1 for finds: a draft that isn't JSON, lacks a field or holds a non-string.
      await writeFile(path.join(root, "draft.json"), "{ not json");
      await expect(run(["check", "draft.json"], root)).rejects.toMatchObject({ code: 2 });
      await writeFile(path.join(root, "draft.json"), JSON.stringify({ ...draft, missing: "" }));
      await expect(run(["check", "draft.json"], root)).rejects.toMatchObject({ code: 2, stderr: "The draft needs missing.\n" });
      await writeFile(path.join(root, "draft.json"), JSON.stringify({ ...draft, context: 5 }));
      await expect(run(["check", "draft.json"], root)).rejects.toMatchObject({ code: 2 });
      await expect(run(["check"], root)).rejects.toMatchObject({ code: 2 });
      await expect(run(["check", "absent.json"], root)).rejects.toMatchObject({ code: 2 });
      // A comment's text is the body alone, which is all `comment` posts; its draft needs no title.
      const { title: _title, ...comment } = draft;
      await writeFile(path.join(root, "draft.json"), JSON.stringify(comment));
      expect((await run(["preview", "draft.json", "--comment"], root)).stdout).toBe(markdownBody(draft));
      expect(ghComment("412", comment).input).toBe(markdownBody(draft));
      expect((await run(["check", "draft.json"], root)).stdout).toBe("Nothing to leave out found.\n");
      await expect(run(["preview", "draft.json"], root)).rejects.toMatchObject({ code: 2 });
      // A Workspace config that can't be read is named as the fault, not the draft.
      await writeFile(path.join(root, "sc2-adjutant.workspace.json"), "{ not json,");
      await expect(run(["check", "draft.json"], root)).rejects.toMatchObject({ code: 2, stderr: expect.stringMatching(/^The Workspace config .*sc2-adjutant\.workspace\.json can't be read, so its names can't be checked: .*The draft isn't at fault/) });
      await writeFile(path.join(root, "sc2-adjutant.workspace.json"), "null");
      await expect(run(["check", "draft.json"], root)).rejects.toMatchObject({ code: 2, stderr: expect.stringMatching(/isn't a JSON object/) });
      await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "glasstide", name: "Glass Tide" } }));
      expect((await run(["environment"], root)).stdout).toMatch(/^plugin \d+\.\d+\.\d+, core (?:\d+\.\d+\.\d+|not found), \S.*\n$/);
      expect((await run(["environment", "9.8.7"], root)).stdout).toMatch(/^plugin \d+\.\d+\.\d+, core 9\.8\.7, \S.*\n$/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("the check before the draft is shown", () => {
  it("finds paths, package names and long quotes in any field", () => {
    const leaky = {
      ...draft,
      missing: "The compile skips /Users/someone/maps/Glasstide.SC2Map/Triggers and C:\\maps\\x.txt.",
      workaround: 'Edited ~/maps by hand, and missions/glass-01/blueprint.json, then Glasstide.SC2Mod. Orla says "the tide will not wait for any of us".',
      suggestion: "Read ~/maps/<x>/Orla.SC2Map, Glass.v2.SC2Map and Glaß.SC2Map.",
    };
    expect(draftProblems(leaky, [])).toEqual([
      "missing: a path, /Users/someone/maps/Glasstide.SC2Map/Triggers",
      "missing: a path, C:\\maps\\x.txt",
      "workaround: a path, ~/maps",
      "workaround: a path, missions/glass-01/blueprint.json",
      "workaround: a map or mod name, Glasstide.SC2Mod",
      'workaround: a quote, is it Screenplay text? "the tide will not wait for any of us"',
      "suggestion: a path, ~/maps/<x>/Orla.SC2Map",
      "suggestion: a map or mod name, Glass.v2.SC2Map",
      "suggestion: a map or mod name, Glaß.SC2Map",
    ]);
  });

  it("finds the Workspace's names, as whole words in any case", () => {
    expect(draftProblems({ ...draft, title: "Glass Tide folders", context: "Stage 5 on glass-01" }, ["Glass Tide", "glass-01", "tid"])).toEqual([
      "title: the Workspace's name Glass Tide",
      "context: the Workspace's name glass-01",
    ]);
  });

  it("finds a map or mod name in a path too short to read as one, or one holding a placeholder", () => {
    const leaky = {
      ...draft,
      missing: "Glasstide.SC2Map/Triggers lost a folder, and so did Glasstide.SC2Map/.",
      workaround: "Edited missions/<id>/Glasstide.SC2Map and mods\\<id>\\GlassTide.SC2Mod by hand.",
    };
    expect(draftProblems(leaky, [])).toEqual([
      "missing: a map or mod name, Glasstide.SC2Map",
      "missing: a map or mod name, Glasstide.SC2Map",
      "workaround: a map or mod name, Glasstide.SC2Map",
      "workaround: a map or mod name, GlassTide.SC2Mod",
    ]);
  });

  it("tests every segment of a path with a placeholder that isn't one, sparing sc2-adjutant's own file names", () => {
    const leaky = {
      ...draft,
      missing: "Edited missions/<id>/glasstide-notes.txt and <Name>.SC2Map/Assets/orla_banner.dds by hand.",
      workaround: "Wrote mods\\<id>\\Base.SC2Data\\tide.xml and missions/<id>/Glasstide.SC2Map/<file>.",
      suggestion: "Read `missions/<id>/blueprint.json`, `missions/<id>/compile-record.json`, <workspace>/sc2-adjutant.workspace.json, missions/<id>/<id>.md and missions/*/*.json.",
    };
    expect(draftProblems(leaky, [])).toEqual([
      "missing: a file name in a path, glasstide-notes.txt",
      "missing: a file name in a path, orla_banner.dds",
      "workaround: a file name in a path, tide.xml",
      "workaround: a map or mod name, Glasstide.SC2Map",
    ]);
  });

  it("finds long single, curly single and backtick quotes, but not apostrophes or a path in backticks", () => {
    const quoted = {
      ...draft,
      missing: "Orla says 'the tide won't wait for any of us' at the gate.",
      workaround: "Then ‘we hold the line until dawn’ plays, and `Orla: hold the line, all of you` too.",
      suggestion: "It can't read the players' units or the mappers' maps, nor `missions/<id>/<Name>.SC2Map` and 'short one'.",
      context: "The 'Missing' label isn't on the players' units in the mappers' maps.",
    };
    expect(draftProblems(quoted, [])).toEqual([
      "missing: a quote, is it Screenplay text? 'the tide won't wait for any of us'",
      "workaround: a quote, is it Screenplay text? ‘we hold the line until dawn’",
      "workaround: a quote, is it Screenplay text? `Orla: hold the line, all of you`",
    ]);
  });

  it("finds a Workspace name of several words across any run of whitespace", () => {
    expect(draftProblems({ ...draft, missing: "In Glass\n  Tide the folder\twas lost.", context: "Glass Tide" }, ["Glass Tide"])).toEqual([
      "missing: the Workspace's name Glass Tide",
      "context: the Workspace's name Glass Tide",
    ]);
  });

  it("finds the Workspace's names inside paths, placeholders or not", () => {
    expect(draftProblems({ ...draft, context: "missions/glass-01/<Name>.SC2Map" }, ["glass-01"])).toEqual(["context: the Workspace's name glass-01"]);
    expect(draftProblems({ ...draft, context: "Glasstide.SC2Map/Triggers" }, ["Glasstide"])).toEqual(["context: a map or mod name, Glasstide.SC2Map", "context: the Workspace's name Glasstide"]);
  });

  it("reads a file:// URL as its path", () => {
    expect(draftProblems({ ...draft, context: "Opened file:///Users/name/Campaign/missions/x/Glasstide.SC2Map today." }, [])).toEqual(["context: a path, /Users/name/Campaign/missions/x/Glasstide.SC2Map"]);
  });

  it("finds a map or mod name with a possessive or punctuation round it", () => {
    expect(draftProblems({ ...draft, missing: "Glasstide.SC2Map's triggers and Hollow.SC2Mod’s data", workaround: "Opened Glasstide.SC2Map, then (Glasstide.SC2Map) and {Glasstide.SC2Map’s}." }, [])).toEqual([
      "missing: a map or mod name, Glasstide.SC2Map",
      "missing: a map or mod name, Hollow.SC2Mod",
      "workaround: a map or mod name, Glasstide.SC2Map",
      "workaround: a map or mod name, Glasstide.SC2Map",
      "workaround: a map or mod name, Glasstide.SC2Map",
    ]);
  });

  it("leaves placeholders, product terms, tool names and URLs alone", () => {
    const clean = {
      ...draft,
      missing: "Kept triggers in `missions/<id>/<Name>.SC2Map` can't hold a folder; *.SC2Map packages and plugin/core both.",
      workaround: 'See https://github.com/TeamAntioch/sc2-adjutant/issues/1, the compile_map tool and /sc2-adjutant:compile, "Stage 3", and the ComponentList.SC2Components file.',
    };
    expect(draftProblems(clean, [])).toEqual([]);
  });

  it("takes the Workspace's names from its config and its Missions' folders", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sc2-adjutant-report-"));
    try {
      await mkdir(path.join(root, "maps", "glass-01"), { recursive: true });
      await mkdir(path.join(root, "maps", "glass-02"));
      await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "glasstide", name: "Glass Tide" }, missions: "maps", campaignMod: "GlassTideMod" }));
      expect(await workspaceNames(root)).toEqual(["glasstide", "Glass Tide", "GlassTideMod", "glass-01", "glass-02"]);
      await rm(path.join(root, "maps"), { recursive: true });
      await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "glasstide", name: "Glass Tide" } }));
      expect(await workspaceNames(root)).toEqual(["glasstide", "Glass Tide"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("takes its mods' ids and folders, the package names in its folders, and the Campaign Mod's name from a Campaign Pack when the config names none", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sc2-adjutant-report-"));
    try {
      await mkdir(path.join(root, "missions", "glass-01", "Glasstide.SC2Map"), { recursive: true });
      await mkdir(path.join(root, "mods", "shard-campaign", "ShardCampaign.SC2Mod"), { recursive: true });
      await mkdir(path.join(root, "mods", "shard-assets"));
      await mkdir(path.join(root, "packs", "shard"), { recursive: true });
      await writeFile(path.join(root, "packs", "shard", "sc2-adjutant-plugin.json"), JSON.stringify({ name: "shard-pack", contributions: { campaignMod: "Shard Campaign" } }));
      await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "glasstide", name: "Glass Tide" }, campaignPack: "./packs/shard", mods: ["shard-campaign"] }));
      expect(await workspaceNames(root)).toEqual(["glasstide", "Glass Tide", "Shard Campaign", "shard-pack", "shard-campaign", "glass-01", "Glasstide", "shard-assets", "ShardCampaign"]);
      await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "glasstide", name: "Glass Tide" }, campaignPack: "bundled:campaign-example", mods: ["shard-campaign"] }));
      expect(await workspaceNames(root)).toContain("shard-campaign");
      expect(await workspaceNames(root)).not.toContain("Shard Campaign");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("takes each Mission's Blueprint title and the names of the Plugins it loads from local folders", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "sc2-adjutant-report-"));
    try {
      await mkdir(path.join(root, "missions", "glass-01"), { recursive: true });
      await mkdir(path.join(root, "missions", "glass-02"));
      await mkdir(path.join(root, "missions", "glass-03"));
      await writeFile(path.join(root, "missions", "glass-01", "blueprint.json"), JSON.stringify({ id: "glass-01", title: "The Drowned Gate" }));
      await writeFile(path.join(root, "missions", "glass-02", "blueprint.json"), "{ not json");
      for (const [folder, name] of [["style", "tide-style"], ["tools", "tide-sketcher"], ["mechs", "tide-pumps"]]) {
        await mkdir(path.join(root, "plugins", folder!), { recursive: true });
        await writeFile(path.join(root, "plugins", folder!, "sc2-adjutant-plugin.json"), JSON.stringify({ name }));
      }
      await writeFile(
        path.join(root, "sc2-adjutant.workspace.json"),
        JSON.stringify({ campaign: { id: "glasstide", name: "Glass Tide" }, stylePack: "./plugins/style", utilities: ["./plugins/tools", "bundled:workshop"], plugins: ["./plugins/mechs", "./plugins/absent", "bundled:hazard"] }),
      );
      expect(await workspaceNames(root)).toEqual(["glasstide", "Glass Tide", "tide-style", "tide-sketcher", "tide-pumps", "glass-01", "glass-02", "glass-03", "The Drowned Gate"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("the stock model animations case", () => {
  it("is a trigger in the skill's description, and its worked draft passes the check as it stands", async () => {
    const skill = await readFile(SKILL, "utf8");
    expect(skill.split("\n---")[0]).toContain("a stock model's animations recorded in the Workspace because core lacks them");
    const section = skill.split("## Stock model animations")[1];
    expect(section, "the skill's Stock model animations section").toBeDefined();
    const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(section!)![1]!) as Record<string, string>;
    expect(Object.keys(example).sort()).toEqual(["context", "missing", "suggestion", "title", "workaround"]);
    expect(example.missing).toContain("SMX3_Marine");
    expect(draftProblems(example, [])).toEqual([]);
  });
});
