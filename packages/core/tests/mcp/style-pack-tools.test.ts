// study_exemplar and find_places (#25): a Style Pack's Map Studies and places, built through the
// MCP server on a fixture Workspace with a local Style Pack and one small Exemplar Map, whose source
// map is compiled from the fixture's own Mission into the folder the Workspace config's exemplarMaps names.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { compileMission } from "../../src/map/compile-mission.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { MEASURES } from "../../src/study/measures.js";
import { connect, copyOf, text } from "./harness.js";

/** A copy of the studio fixture, with its Exemplar Map's source map compiled. */
async function studio(): Promise<string> {
  const root = await copyOf("studio");
  await compileMission(await loadWorkspace(root), path.join(root, "missions/plaza/blueprint.json"), path.join(root, "exemplar-sources/Plaza.SC2Map"));
  return root;
}

afterEach(() => vi.unstubAllEnvs());

const exemplarDir = (root: string) => path.join(root, "style-pack/exemplar-maps");

describe("study_exemplar", () => {
  it("writes study.json and the layer images into the pack's folder for the map", async () => {
    const root = await studio();
    const client = await connect(root);

    const reply = await client.callTool({ name: "study_exemplar", arguments: { ids: ["plaza"] } });
    expect(reply.isError, text(reply)).toBeFalsy();

    const studyDir = path.join(exemplarDir(root), "plaza");
    const study = JSON.parse(await readFile(path.join(studyDir, "study.json"), "utf8")) as { exemplar: { id: string; provenance: string }; measures: Record<string, unknown> };
    expect(study.exemplar).toEqual({ id: "plaza", provenance: "made" });
    // The lesson-neutral measures, so a consistency report reads them without the source map.
    expect(Object.keys(study.measures).sort()).toEqual(MEASURES.map((m) => m.id).sort());
    const images = (await readdir(studyDir)).filter((name) => name.endsWith(".png"));
    expect(images.length).toBeGreaterThan(0);
    expect(reply.structuredContent).toMatchObject({ studied: [{ id: "plaza", studyDir, images: expect.arrayContaining(images) }] });
  });

  it("serves the new study as the pack's knowledge at once, with no restart", async () => {
    const root = await studio();
    const client = await connect(root);
    const studies = async () => (await client.listResources()).resources.map((resource) => resource.uri).filter((uri) => uri.includes("/knowledge/study-"));
    expect(await studies()).toEqual([]);

    await client.callTool({ name: "study_exemplar", arguments: { ids: ["plaza"] } });
    expect(await studies()).toEqual(["sc2-adjutant://plugins/studio-style/knowledge/study-plaza"]);
  });

  it("refuses a call that names no maps, so no call grows with the pack, and writes nothing", async () => {
    const root = await studio();
    const client = await connect(root);

    for (const args of [{}, { ids: [] }]) {
      const reply = await client.callTool({ name: "study_exemplar", arguments: args });
      expect(reply.isError).toBe(true);
      expect(text(reply)).toContain("ids");
    }
    expect(existsSync(path.join(exemplarDir(root), "plaza"))).toBe(false);
  });

  it("refuses an id the pack doesn't list, naming it and the pack's ids, and writes nothing", async () => {
    const root = await studio();
    const client = await connect(root);

    const reply = await client.callTool({ name: "study_exemplar", arguments: { ids: ["plaza", "harbour"] } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("no Exemplar Map harbour (its Exemplar Maps: plaza)");
    expect(existsSync(path.join(exemplarDir(root), "plaza"))).toBe(false);
  });

  it("refuses a missing source map, naming the map and the exemplarMaps setting", async () => {
    const root = await copyOf("studio");
    const client = await connect(root);

    const reply = await client.callTool({ name: "study_exemplar", arguments: { ids: ["plaza"] } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain(`No source map for Exemplar Map plaza (${path.join(root, "exemplar-sources/Plaza.SC2Map")})`);
    expect(text(reply)).toContain("set exemplarMaps");
  });

  it("refuses when no folder for the source maps is set, naming the setting", async () => {
    const root = await studio();
    const config = path.join(root, "sc2-adjutant.workspace.json");
    const { exemplarMaps: _, ...rest } = JSON.parse(await readFile(config, "utf8")) as Record<string, unknown>;
    await writeFile(config, JSON.stringify(rest));
    const client = await connect(root);

    const reply = await client.callTool({ name: "study_exemplar", arguments: { ids: ["plaza"] } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toMatch(/set exemplarMaps in the machine config .*, or SC2_ADJUTANT_EXEMPLAR_MAPS/);
  });
});

type Mixtures = {
  generated: string;
  maps: string[];
  moodRules: unknown[];
  moods: Record<string, { places: number }>;
  places: { map: string; mood?: string; center: [number, number]; visible: number; frames?: string[] }[];
};
const mixturesFile = (root: string) => path.join(exemplarDir(root), "mixtures.json");
const mixturesOf = async (root: string) => JSON.parse(await readFile(mixturesFile(root), "utf8")) as Mixtures;

describe("find_places", () => {
  it("writes the pack's places to its mixtures file, with no moods when the pack has none", async () => {
    const root = await studio();
    const client = await connect(root);

    const reply = await client.callTool({ name: "find_places", arguments: {} });
    expect(reply.isError, text(reply)).toBeFalsy();

    const mixtures = await mixturesOf(root);
    expect(mixtures.maps).toEqual(["plaza"]);
    expect(mixtures.moodRules).toEqual([]);
    expect(mixtures.moods).toEqual({});
    expect(mixtures.places).toHaveLength(1);
    expect(mixtures.places[0]).toMatchObject({ map: "plaza", center: [31.5, 31.5], visible: 9 });
    expect(mixtures.places[0]!.mood).toBeUndefined();
    expect(reply.structuredContent).toEqual({ file: mixturesFile(root), maps: ["plaza"], places: 1, moods: {}, withoutFrames: ["plaza"] });
  });

  it("gives each place the first of the pack's recorded moods it passes, keeps them, and lists the frames in the pack's captures", async () => {
    vi.stubEnv("SC2_RESEARCH_DIR", "");
    const root = await studio();
    const moodRules = [{ name: "lab", when: [[{ motifs: ["lab"], atLeast: 0.15 }]] }, { name: "kerbside", when: [[{ motifs: ["decal", "structure"], atLeast: 0.5 }]] }, { name: "wild ground" }];
    await writeFile(mixturesFile(root), JSON.stringify({ generated: "2026-01-01", maps: [], moodRules, moods: {}, places: [] }));
    const tour = path.join(exemplarDir(root), "plaza/captures/places-default");
    await mkdir(tour, { recursive: true });
    await writeFile(path.join(tour, "stops.txt"), "1 31.5 31.5\n2 50 50\n");
    const client = await connect(root);

    const reply = await client.callTool({ name: "find_places", arguments: { ids: ["plaza"] } });
    expect(reply.isError, text(reply)).toBeFalsy();

    const mixtures = await mixturesOf(root);
    expect(mixtures.moodRules).toEqual(moodRules);
    expect(mixtures.places[0]).toMatchObject({ mood: "kerbside", frames: ["plaza/frames/places-default/001.jpg"] });
    expect(Object.keys(mixtures.moods)).toEqual(["kerbside"]);
    expect(reply.structuredContent).toMatchObject({ moods: { kerbside: 1 }, withoutFrames: [] });
  });

  it("refuses a mixtures file it can't read the moods of, naming the file", async () => {
    const root = await studio();
    const client = await connect(root);

    await writeFile(mixturesFile(root), "{ \"moodRules\": [], }");
    const broken = await client.callTool({ name: "find_places", arguments: {} });
    expect(broken.isError).toBe(true);
    expect(text(broken)).toContain(`${mixturesFile(root)} isn't valid JSON`);

    await writeFile(mixturesFile(root), JSON.stringify({ moodRules: [{ name: "wild ground", when: [] }] }));
    const empty = await client.callTool({ name: "find_places", arguments: {} });
    expect(empty.isError).toBe(true);
    expect(text(empty)).toContain(`${mixturesFile(root)}: its moodRules aren't valid: moodRules.0.when`);
  });

  it("refuses an id the pack doesn't list, and leaves the mixtures file alone", async () => {
    const root = await studio();
    const client = await connect(root);

    const reply = await client.callTool({ name: "find_places", arguments: { ids: ["harbour"] } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("no Exemplar Map harbour");
    expect(existsSync(mixturesFile(root))).toBe(false);
  });

  it("refuses a missing source map, naming it", async () => {
    const root = await copyOf("studio");
    const client = await connect(root);

    const reply = await client.callTool({ name: "find_places", arguments: {} });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("No source map for Exemplar Map plaza");
    expect(existsSync(mixturesFile(root))).toBe(false);
  });
});

describe("exemplar_report", () => {
  it("refuses, naming the map, when an Exemplar Map has no study yet", async () => {
    const client = await connect(await copyOf("studio"));

    const reply = await client.callTool({ name: "exemplar_report", arguments: {} });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("No Map Study to report on for Exemplar Map plaza (no study): run study_exemplar for it first");
  });

  it("reports every measure of the pack's studies against the shipped baseline, naming the missions it couldn't measure", async () => {
    const root = await studio();
    const client = await connect(root);
    await client.callTool({ name: "study_exemplar", arguments: { ids: ["plaza"] } });

    const reply = await client.callTool({ name: "exemplar_report", arguments: {} });
    expect(reply.isError, text(reply)).toBeFalsy();

    const report = reply.structuredContent as { maps: unknown[]; baseline: { maps: number; unavailable: string[] }; measures: { id: string; verdict: string }[] };
    expect(report.maps).toEqual([{ id: "plaza", provenance: "made" }]);
    expect(report.measures.map((m) => m.id).sort()).toEqual(MEASURES.map((m) => m.id).sort());
    // One map can't agree with itself.
    expect(new Set(report.measures.map((m) => m.verdict))).toEqual(new Set(["too few maps"]));
    expect(report.baseline.unavailable).toContain("nova01");
    expect(text(reply)).toContain("the baseline couldn't measure nova01");
    expect(text(reply)).toContain("Too few maps with a value to tell:");
  });
});
