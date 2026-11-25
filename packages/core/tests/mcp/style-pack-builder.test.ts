// A dry run of the style-pack-builder skill (#30), the claude-plugin's, on a copy of the studio
// fixture with no Style Pack: each step's tools through one MCP server session, on a machine with
// no Host Adapter (so capture is refused and the run goes on from the studies), and the files the
// skill writes by hand, ending on a pack that the Workspace check passes and that the server serves
// as exemplar-design reads it. The analysis and the mapper's answers are stand-ins: what's under
// test is that the steps join up, not the taste.
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { checkWorkspace, isError } from "../../src/plugins/check-workspace.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { connect, copyOf, text } from "./harness.js";

const CONFIG = "sc2-adjutant.workspace.json";

type Client = Awaited<ReturnType<typeof connect>>;
const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
  const reply = await client.callTool({ name, arguments: args });
  expect(reply.isError, `${name}: ${text(reply)}`).toBeFalsy();
  return reply;
};
const resource = async (client: Client, uri: string) => {
  const { contents } = await client.readResource({ uri });
  return contents.map((content) => ("text" in content ? content.text : "")).join("\n");
};

/** The studio fixture without its Style Pack, and two source maps in its exemplarMaps folder. */
async function workspace(): Promise<string> {
  const root = await copyOf("studio");
  await rm(path.join(root, "style-pack"), { recursive: true });
  const { stylePack: _, ...config } = JSON.parse(await readFile(path.join(root, CONFIG), "utf8")) as Record<string, unknown>;
  await writeFile(path.join(root, CONFIG), JSON.stringify(config, null, 2));
  const plaza = path.join(root, "exemplar-sources/Plaza.SC2Map");
  await compileMission(await loadWorkspace(root), path.join(root, "missions/plaza/blueprint.json"), plaza);
  await cp(plaza, path.join(root, "exemplar-sources/Square.SC2Map"), { recursive: true });
  return root;
}

afterEach(() => vi.unstubAllEnvs());

type Knowledge = { id: string; title: string; description: string; file: string };
const MIXTURES_ENTRY: Knowledge = { id: "mixtures", title: "Mood mixtures (data)", description: "Every dressed place with its mood, and each mood's mixture.", file: "exemplar-maps/mixtures.json" };

/**
 * Step 7's manifest and guide, as the skill says: the manifest gets only the entries it lacks, with
 * the lessons description naming the ids it holds, and the guide is written over its stub the first
 * time, then updated where it says something, the mapper's ratified text kept.
 */
async function packageThePack(pack: string, { lessonIds, guideLine }: { lessonIds: string[]; guideLine: string }) {
  const manifestFile = path.join(pack, "sc2-adjutant-plugin.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as { contributions: { knowledge: Knowledge[] } };
  const { knowledge } = manifest.contributions;
  if (!knowledge.some((entry) => entry.id === MIXTURES_ENTRY.id)) knowledge.push(MIXTURES_ENTRY);
  const lessons = knowledge.find((entry) => entry.id === "lessons")!;
  lessons.description = `The ratified Design Lessons (${lessonIds.join(", ")}): each rule, its evidence, weight and Blueprint hook.`;
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));

  const guideFile = path.join(pack, "knowledge/GUIDE.md");
  const guide = await readFile(guideFile, "utf8");
  const stub = !guide.includes("## Propose a look");
  await writeFile(guideFile, stub ? `# This pack's look, step by step\n\n## Propose a look\n\n${guideLine}\n` : `${guide}${guideLine}\n`);
}

describe("a dry run of the style-pack-builder skill", () => {
  it("reaches a pack that passes the Workspace check and serves its lessons, guide and moods", async () => {
    vi.stubEnv("SC2_RESEARCH_DIR", "");
    const root = await workspace();
    const client = await connect(root);
    const pack = path.join(root, "style-pack");
    const exemplars = path.join(pack, "exemplar-maps");

    // 1. Scaffold: no style-pack Plugin yet, so make one.
    expect(JSON.stringify((await call(client, "list_plugins")).structuredContent)).not.toContain("style-pack");
    const made = (await call(client, "scaffold_style_pack")).structuredContent as { name: string };
    const name = made.name;

    // 2. Add the maps, with the provenance the mapper gave.
    await call(client, "add_exemplar_map", { id: "plaza", map: "Plaza.SC2Map", provenance: "made" });
    await call(client, "add_exemplar_map", { id: "square", map: "Square.SC2Map", provenance: "edited", note: "a copy of plaza" });

    // 3. Study each map in a call of its own, then find every map's places.
    for (const id of ["plaza", "square"]) await call(client, "study_exemplar", { ids: [id] });
    expect((await call(client, "find_places")).structuredContent).toMatchObject({ maps: ["plaza", "square"], places: 2, moods: {} });

    // 4. Capture: this machine can't, so the run goes on from the studies.
    const capture = await client.callTool({ name: "capture_exemplar", arguments: {} });
    expect(capture.isError).toBe(true);
    expect(text(capture)).toContain("editor.captureTour");

    // 5. Analyse: the report, then candidates and a proposed mood drafted into candidate-lessons.md.
    const report = (await call(client, "exemplar_report")).structuredContent as { measures: { id: string; verdict: string; spread: { min: number; max: number } | null; agreeing: string[] }[] };
    const lead = report.measures.find((measure) => measure.agreeing.length === 2 && measure.spread);
    expect(lead, "a measure both maps agree on").toBeDefined();
    const candidates = await readFile(path.join(exemplars, "candidate-lessons.md"), "utf8");
    expect(candidates).toContain("No candidates yet.\n");
    await writeFile(
      path.join(exemplars, "candidate-lessons.md"),
      candidates.replace("No candidates yet.\n", "## Candidate moods\n\n### open ground\n\n**Rule.** every place (the catch-all)\n"),
    );

    // 6. Ratify: the mapper keeps one lesson, in their words.
    const lessons = await readFile(path.join(exemplars, "LESSONS.md"), "utf8");
    expect(lessons).toContain("No lessons are ratified yet.\n");
    const lesson = [
      `## DL-01. Keep ${lead!.id} where these maps keep it`,
      "",
      `**Rule.** Keep ${lead!.id} between ${lead!.spread!.min} and ${lead!.spread!.max}.`,
      "",
      `**Evidence.**\n- ${lead!.id}: ${lead!.spread!.min} to ${lead!.spread!.max} across plaza (made) and square (edited); ${lead!.verdict}`,
      "",
      "**Weight.** Low: two maps, one a copy of the other.",
      "",
      "**Blueprint hook.** dressing; no style-rule slot",
      "",
      '**Ratified.** 2026-11-24, the mapper: "yes, that one\'s mine"',
      "",
    ].join("\n");
    await writeFile(path.join(exemplars, "LESSONS.md"), lessons.replace("No lessons are ratified yet.\n", lesson));

    // 7. Package: the moods into the mixtures, the guide, the manifest's mixtures entry; check.
    const mixturesFile = path.join(exemplars, "mixtures.json");
    const mixtures = JSON.parse(await readFile(mixturesFile, "utf8")) as Record<string, unknown>;
    await writeFile(mixturesFile, JSON.stringify({ ...mixtures, moodRules: [{ name: "lab", when: [[{ motifs: ["lab"], atLeast: 0.5 }]] }, { name: "open ground" }] }, null, 1));
    expect((await call(client, "find_places")).structuredContent).toMatchObject({ places: 2, moods: { "open ground": 2 } });

    await packageThePack(pack, { lessonIds: ["DL-01"], guideLine: "Dress each Zone from the open ground mood, after DL-01." });

    const check = await checkWorkspace(root, { sc2Path: undefined });
    expect(check.problems.filter(isError)).toEqual([]);

    // Read back as exemplar-design will, in the same session.
    const plugins = (await call(client, "list_plugins")).structuredContent as { plugins: { name: string; roles: string[]; contributions: Record<string, string[]> }[] };
    expect(plugins.plugins.find((plugin) => plugin.roles.includes("style-pack"))).toMatchObject({ name, contributions: { knowledge: expect.arrayContaining(["guide", "lessons", "candidate-lessons", "mixtures"]) } });
    expect(await resource(client, `sc2-adjutant://plugins/${name}/knowledge/lessons`)).toContain("## DL-01.");
    expect(await resource(client, `sc2-adjutant://plugins/${name}/knowledge/candidate-lessons`)).toContain("## Candidate moods");
    expect(await resource(client, `sc2-adjutant://plugins/${name}/knowledge/guide`)).toContain("after DL-01");
    expect(await resource(client, `sc2-adjutant://plugins/${name}/knowledge/mixtures`)).toContain('"open ground"');

    // A second run: step 1 picks the pack up, a third map is added and studied, and the mapper
    // keeps a second lesson. Packaging again keeps the Workspace loading and the ratified guide.
    expect(plugins.plugins.find((plugin) => plugin.roles.includes("style-pack"))).toBeDefined();
    await cp(path.join(root, "exemplar-sources/Plaza.SC2Map"), path.join(root, "exemplar-sources/Court.SC2Map"), { recursive: true });
    await call(client, "add_exemplar_map", { id: "court", map: "Court.SC2Map", provenance: "approved" });
    await call(client, "study_exemplar", { ids: ["court"] });
    expect((await call(client, "find_places")).structuredContent).toMatchObject({ maps: ["plaza", "square", "court"], places: 3, moods: { "open ground": 3 } });
    const kept = await readFile(path.join(exemplars, "LESSONS.md"), "utf8");
    await writeFile(path.join(exemplars, "LESSONS.md"), `${kept}\n${lesson.replace("DL-01", "DL-02")}`);
    await packageThePack(pack, { lessonIds: ["DL-01", "DL-02"], guideLine: "Light it as DL-02 says." });

    const again = await checkWorkspace(root, { sc2Path: undefined });
    expect(again.problems.filter(isError)).toEqual([]);
    const relisted = (await call(client, "list_plugins")).structuredContent as { plugins: { roles: string[]; contributions: Record<string, string[]> }[] };
    expect(relisted.plugins.find((plugin) => plugin.roles.includes("style-pack"))!.contributions.knowledge!.filter((id) => id === "mixtures")).toHaveLength(1);
    const guide = await resource(client, `sc2-adjutant://plugins/${name}/knowledge/guide`);
    expect(guide).toContain("after DL-01");
    expect(guide).toContain("as DL-02 says");
    expect(await resource(client, `sc2-adjutant://plugins/${name}/knowledge/lessons`)).toContain("## DL-02.");
  });
});
