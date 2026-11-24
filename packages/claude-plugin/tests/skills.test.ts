// Each shipped skill is a folder whose SKILL.md names it in its frontmatter and says when to use it,
// and whose relative links lead to files that exist inside the shipped skills: a skill ships
// alone, so it can't link into the repo around it (name such a doc, or use a public URL).
// Every shipped file, skills and commands alike, is for any author: it holds nothing of one
// author's campaign, words or machine, and reads the Style Pack's and Campaign Pack's knowledge
// through the MCP server (its resources, prompts and tools), never from a pack's files.
// The reference docs in docs/reference ship in the public repo beside them: theirs and the skills'
// links lead only to files a reader of that repo has.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { AUTHOR_WORDS, matches, monorepoPacks, packTerms } from "./author-specific.ts";

const SKILLS = fileURLToPath(new URL("../skills/", import.meta.url));
const skills = (await readdir(SKILLS, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

/** The targets of a Markdown file's relative links (any link without a scheme), less their anchors. */
function relativeLinks(text: string): string[] {
  return [...text.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)].map(([, target]) => target!.split("#")[0]!).filter((target) => target !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(target));
}

const PLUGIN = fileURLToPath(new URL("../", import.meta.url));
/** Every Markdown file the plugin ships: its skills, with their reference files, and its commands. */
const shipped = [
  ...(await readdir(SKILLS, { recursive: true })).filter((name) => name.endsWith(".md")).map((name) => path.join("skills", name)),
  ...(await readdir(path.join(PLUGIN, "commands"))).filter((name) => name.endsWith(".md")).map((name) => path.join("commands", name)),
].sort();

const packs = await monorepoPacks();
const AUTHOR_SPECIFIC = [...AUTHOR_WORDS, ...packs.flatMap(({ manifest, description }) => packTerms(manifest, description))];

/** Ways of reading a Plugin's knowledge by its files instead of through the MCP server. */
const PACK_FILE_READS: readonly RegExp[] = [
  /\bpackages\/[\w.-]+/g,
  /\bnode_modules\//g,
  /sc2-adjutant-plugin\.json/g,
  /`(?:stylePack|campaignPack)`\s+folder/gi,
  /\bcontributions\.\w+/g,
];

const REPO = path.resolve(PLUGIN, "..", "..");
const REFERENCE = path.join(REPO, "docs", "reference");
/** Every reference doc, as a path from the repo's root. */
const referenceDocs = (await readdir(REFERENCE, { recursive: true })).filter((name) => name.endsWith(".md")).map((name) => path.join("docs", "reference", name)).sort();

/** The folders of this repo that aren't part of its public tree, from the repo's root. */
const OUTSIDE_PUBLIC_TREE = ["docs/research"];
const toPosix = (file: string) => file.split(path.sep).join("/");
/** Whether a path from the repo's root leaves the repo or goes into a folder outside its public tree. */
const outsidePublicTree = (relative: string) =>
  relative.startsWith("..") || path.isAbsolute(relative) || OUTSIDE_PUBLIC_TREE.some((folder) => toPosix(relative) === folder || toPosix(relative).startsWith(`${folder}/`));

/** The problems with a doc's relative links and the paths it names: each must lead to a file in the public tree. */
function publicTreeProblems(file: string, text: string): string[] {
  const problems: string[] = [];
  for (const target of relativeLinks(text)) {
    const resolved = path.resolve(REPO, path.dirname(file), decodeURIComponent(target));
    if (outsidePublicTree(path.relative(REPO, resolved))) problems.push(`${target} is outside the public tree`);
    else if (!existsSync(resolved)) problems.push(`${target} doesn't exist`);
  }
  const withoutUrls = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s)>\]]+/gi, "");
  for (const [mention] of withoutUrls.matchAll(/(?<![\w.-])docs\/research\b[^\s`)"']*/g)) problems.push(`names ${mention}, outside the public tree`);
  return problems;
}
const authorSpecific = (text: string, patterns: readonly RegExp[] = AUTHOR_SPECIFIC) => matches(patterns, text);
const packFileReads = (text: string) => matches(PACK_FILE_READS, text);

describe("the shipped skills", () => {
  it("are level-design, hero-mission-design, encounter-design, ally-design, cinematography, exemplar-design, texture-sets, doodad-search, custom-doodads, boss-design, boss-build, melee-design, report-missing-feature and sound-mix", () => {
    expect(skills.sort()).toEqual(["ally-design", "boss-build", "boss-design", "cinematography", "custom-doodads", "doodad-search", "encounter-design", "exemplar-design", "hero-mission-design", "level-design", "melee-design", "report-missing-feature", "sound-mix", "texture-sets"]);
  });

  // The plugin's descriptions and READMEs list the skills by hand: each must name every one, and
  // this repo's .claude/skills must link to it, so a skill added to skills/ alone fails here.
  const LISTINGS = [".claude-plugin/marketplace.json", "packages/claude-plugin/.claude-plugin/plugin.json", "packages/claude-plugin/package.json", "README.md", "packages/claude-plugin/README.md"];

  it.each(skills)("%s is named in every listing of the plugin's skills, and linked from .claude/skills", async (skill) => {
    const missing: string[] = [];
    for (const listing of LISTINGS) if (!new RegExp(`\\b${skill}\\b`).test(await readFile(path.join(REPO, listing), "utf8"))) missing.push(listing);
    expect(missing).toEqual([]);
    expect(existsSync(path.join(REPO, ".claude", "skills", skill, "SKILL.md"))).toBe(true);
  });

  it.each(skills)("%s names itself and says when to use it", async (skill) => {
    const text = await readFile(path.join(SKILLS, skill, "SKILL.md"), "utf8");
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(text)?.[1] ?? "";
    expect(frontmatter).toMatch(new RegExp(`^name: ${skill}$`, "m"));
    expect(frontmatter).toMatch(/^description: .*\bUse\b/m);
  });

  it.each(skills)("%s links only to files that exist inside the shipped skills", async (skill) => {
    const folder = path.join(SKILLS, skill);
    const broken: string[] = [];
    for (const file of (await readdir(folder, { recursive: true })).filter((name) => name.endsWith(".md"))) {
      const text = await readFile(path.join(folder, file), "utf8");
      for (const target of relativeLinks(text)) {
        const resolved = path.resolve(folder, path.dirname(file), target);
        const relative = path.relative(SKILLS, resolved);
        if (relative.startsWith("..") || path.isAbsolute(relative)) broken.push(`${file}: ${target} leaves the shipped skills`);
        else if (!existsSync(resolved)) broken.push(`${file}: ${target} doesn't exist`);
      }
    }
    expect(broken).toEqual([]);
  });

  it.each(shipped)("%s names no path outside the public tree", async (file) => {
    expect(publicTreeProblems(path.join("packages", "claude-plugin", file), await readFile(path.join(PLUGIN, file), "utf8"))).toEqual([]);
  });

  it.each(shipped)("%s holds nothing of one author's own", async (file) => {
    expect(authorSpecific(await readFile(path.join(PLUGIN, file), "utf8"))).toEqual([]);
  });

  it.each(shipped)("%s reads Plugins through the server, not from their folders", async (file) => {
    expect(packFileReads(await readFile(path.join(PLUGIN, file), "utf8"))).toEqual([]);
  });

  it("finds the monorepo's packs to hold the skills apart from", () => {
    expect(packs.length).toBeGreaterThan(0);
  });

  it("catches a pack's names, title, characters and Mechanics, an author's verdicts and quotes, dates and home folders", () => {
    const pack = { name: "campaign-glasstide", roles: ["campaign-pack"], contributions: { mechanics: ["tide"], naming: ["gt"], characters: ["ORLA"], screenplaySource: ["glasstide-script"] } };
    const terms = [...AUTHOR_WORDS, ...packTerms(pack, "The Glass Tide Campaign Pack Plugin for sc2-adjutant.")];
    const text = [
      "As in Glass Tide (campaign-glasstide, the glasstide repo), Orla's line, named by the GT template from glasstide-script.",
      "Use the `tide`, as the tide's shelters show. The author rejected bases without workers.",
      'The author wants "a thin rim of light". Reviewed 2026-10-25 in /Users/someone/maps and ~/repos.',
    ].join("\n");
    expect(authorSpecific(text, terms)).toEqual([
      "author rejected",
      "author wants",
      'author wants "a thin rim of light"',
      "2026-10-25",
      "/Users/",
      "~/",
      "campaign-glasstide",
      "glasstide",
      "Glass Tide",
      "GT",
      "Orla",
      "glasstide-script",
      "`tide`",
      "the tide",
    ]);
    expect(authorSpecific("Ask the author whether they have a tileset in mind; record the author's words in the pack. The tides of play.", terms)).toEqual([]);
  });

  it("catches the author's own Campaign by core's marker, inside identifiers too", () => {
    expect(authorSpecific("Give hero_moloch the CharMoloch actor, as in the Decaying Moon.", AUTHOR_WORDS)).toEqual(["moloch", "Moloch", "Decaying Moon"]);
  });

  it("catches reads of a pack's folder, manifest or package, and leaves the server's resources alone", () => {
    const text = [
      "Open the `stylePack` folder's `sc2-adjutant-plugin.json`.",
      "Read packages/plugin-style-antioch/knowledge/guide.md, or node_modules/some-pack/lessons.md.",
      "Its `contributions.knowledge` lists each file.",
    ].join("\n");
    expect(packFileReads(text)).toHaveLength(5);
    expect(packFileReads("Read `sc2-adjutant://plugins/<plugin>/knowledge/<id>` with the server; `list_plugins` names the `style-pack`.")).toEqual([]);
  });

  it("catches links and paths outside the public tree, and missing files, and leaves public ones alone", () => {
    const text = [
      "[a](../research/melee/README.md) [b](./melee-maps.md) [d](../../../elsewhere.md)",
      "[e](./no-such-doc.md) [f](https://example.com/docs/research/x) Run `docs/research/blizzard-music/scripts/x.py`.",
      '[g](../research/y.md "notes") See `$SC2_RESEARCH_DIR/docs/research/z.md`.',
    ].join("\n");
    expect(publicTreeProblems("docs/reference/x.md", text)).toEqual([
      "../research/melee/README.md is outside the public tree",
      "../../../elsewhere.md is outside the public tree",
      "./no-such-doc.md doesn't exist",
      "../research/y.md is outside the public tree",
      "names docs/research/blizzard-music/scripts/x.py, outside the public tree",
      "names docs/research/z.md, outside the public tree",
    ]);
  });

  it("finds bare, ./ and ../ links, and leaves URLs and anchors alone", () => {
    expect(relativeLinks("[a](PRINCIPLES.md) [b](./x/y.md#z) [c](../../docs/d.md) [e](https://example.com/e) [f](#g) [h](mailto:h@example.com)")).toEqual(["PRINCIPLES.md", "./x/y.md", "../../docs/d.md"]);
  });
});

describe("the reference docs", () => {
  it("are found", () => {
    expect(referenceDocs.length).toBeGreaterThan(0);
  });

  it.each(referenceDocs)("%s links and names only paths in the public tree", async (file) => {
    expect(publicTreeProblems(file, await readFile(path.join(REPO, file), "utf8"))).toEqual([]);
  });
});
