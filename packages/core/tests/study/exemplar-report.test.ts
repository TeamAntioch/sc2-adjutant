// The consistency report (#28): a Style Pack's Map Studies, measure by measure, against a stub
// Blizzard baseline, in a copy of the studio fixture Workspace whose pack lists the maps written here.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadWorkspace } from "../../src/plugins/workspace.js";
import { buildBlizzardBaseline } from "../../src/study/blizzard-baseline.js";
import { exemplarReport } from "../../src/study/exemplar-report.js";
import { type MapMeasures, type MeasureId, MEASURES } from "../../src/study/measures.js";
import { copyOf } from "../mcp/harness.js";

type Provenance = "made" | "edited" | "approved";
type Exemplar = { readonly id: string; readonly provenance: Provenance; readonly measures?: Partial<MapMeasures>; readonly studied?: boolean };

const allNull = (): MapMeasures => Object.fromEntries(MEASURES.map(({ id }) => [id, null])) as MapMeasures;

/** A baseline over one Blizzard map per value, every other measure unmeasured. */
function stubBaseline(values: Partial<Record<MeasureId, readonly number[]>>, unavailable = 0) {
  const count = Math.max(...Object.values(values).map((v) => v!.length));
  const maps = Array.from({ length: count }, (_, k) => ({
    id: `blizzard${k}`,
    campaign: "Wings of Liberty" as const,
    measures: { ...allNull(), ...Object.fromEntries(Object.entries(values).map(([id, v]) => [id, v![k] ?? null])) },
  }));
  const missing = Array.from({ length: unavailable }, (_, k) => ({ id: `nova0${k + 1}`, campaign: "Nova Covert Ops" as const, reason: "not downloaded" }));
  return buildBlizzardBaseline(maps, missing);
}

/** The studio Workspace with its pack listing `exemplars`, each studied (with its measures) unless `studied` is false. */
async function studio(exemplars: readonly Exemplar[]) {
  const root = await copyOf("studio");
  const dir = path.join(root, "style-pack/exemplar-maps");
  await writeFile(path.join(dir, "exemplars.json"), JSON.stringify({ exemplars: exemplars.map(({ id, provenance }) => ({ id, map: `${id}.SC2Map`, provenance })) }));
  for (const { id, provenance, measures, studied } of exemplars) {
    if (studied === false) continue;
    await mkdir(path.join(dir, id), { recursive: true });
    await writeFile(path.join(dir, id, "study.json"), JSON.stringify({ mapStudyVersion: 1, exemplar: { id, provenance }, measures: { ...allNull(), ...measures } }));
  }
  return loadWorkspace(root);
}

// Blizzard's blend widths run 1 to 2 (middle half 1.25 to 1.75); its main-level top texture shares 0.3 to 0.7.
const BLIZZARD = stubBaseline({
  "blend.width": [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2],
  "topTextureShare.mainLevel": [0.3, 0.34, 0.38, 0.42, 0.46, 0.5, 0.54, 0.58, 0.62, 0.66, 0.7],
  "doodadDensity.perHundredCells": [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
});

describe("exemplarReport", () => {
  it("ranks first, as distinctive, a measure the maps agree on outside Blizzard's spread", async () => {
    const workspace = await studio([
      { id: "a", provenance: "made", measures: { "blend.width": 3.1, "topTextureShare.mainLevel": 0.5 } },
      { id: "b", provenance: "made", measures: { "blend.width": 3.2, "topTextureShare.mainLevel": 0.52 } },
      { id: "c", provenance: "made", measures: { "blend.width": 3.0, "topTextureShare.mainLevel": 0.48 } },
    ]);

    const report = await exemplarReport(workspace, { baseline: BLIZZARD });

    expect(report.measures[0]).toMatchObject({ id: "blend.width", verdict: "distinctive", side: "above", spread: { min: 3, max: 3.2 }, outliers: [] });
  });

  it("labels agreement inside Blizzard's spread common practice, ranked below what is distinctive", async () => {
    const workspace = await studio([
      { id: "a", provenance: "made", measures: { "blend.width": 3.1, "topTextureShare.mainLevel": 0.5 } },
      { id: "b", provenance: "made", measures: { "blend.width": 3.2, "topTextureShare.mainLevel": 0.52 } },
      { id: "c", provenance: "made", measures: { "blend.width": 3.0, "topTextureShare.mainLevel": 0.48 } },
    ]);

    const { measures } = await exemplarReport(workspace, { baseline: BLIZZARD });

    const common = measures.find((m) => m.id === "topTextureShare.mainLevel")!;
    expect(common).toMatchObject({ verdict: "common practice", side: "within", spread: { min: 0.48, max: 0.52, median: 0.5 }, percentile: 0.5 });
    expect(measures.indexOf(common)).toBe(1);
  });

  it("names a map outside the others' agreement as an outlier", async () => {
    const workspace = await studio([
      { id: "a", provenance: "made", measures: { "blend.width": 3.1 } },
      { id: "b", provenance: "made", measures: { "blend.width": 3.2 } },
      { id: "c", provenance: "made", measures: { "blend.width": 3.0 } },
      { id: "d", provenance: "made", measures: { "blend.width": 1.2 } },
    ]);

    const { measures } = await exemplarReport(workspace, { baseline: BLIZZARD });

    expect(measures[0]).toMatchObject({ id: "blend.width", verdict: "distinctive", agreeing: ["c", "a", "b"], outliers: [{ id: "d", value: 1.2 }] });
  });

  it("lists a measure the maps don't agree on as a question, with the maps outside the largest group", async () => {
    const workspace = await studio([
      { id: "a", provenance: "made", measures: { "doodadDensity.perHundredCells": 2 } },
      { id: "b", provenance: "made", measures: { "doodadDensity.perHundredCells": 9 } },
      { id: "c", provenance: "made", measures: { "doodadDensity.perHundredCells": 20 } },
    ]);

    const { measures } = await exemplarReport(workspace, { baseline: BLIZZARD });

    const question = measures.find((m) => m.id === "doodadDensity.perHundredCells")!;
    expect(question).toMatchObject({ verdict: "question", agreeing: ["a"], spread: { min: 2, max: 20 }, outliers: [{ id: "b", value: 9 }, { id: "c", value: 20 }] });
    expect(question.side).toBeUndefined();
  });

  it("counts the maps with nothing to measure against agreement", async () => {
    const workspace = await studio([
      { id: "a", provenance: "made", measures: { "blend.width": 3.1 } },
      { id: "b", provenance: "made", measures: { "blend.width": 3.2 } },
      { id: "c", provenance: "made" },
      { id: "d", provenance: "made" },
    ]);

    const { measures } = await exemplarReport(workspace, { baseline: BLIZZARD });

    expect(measures.find((m) => m.id === "blend.width")).toMatchObject({ verdict: "question", agreeing: ["a", "b"], unmeasured: ["c", "d"] });
  });

  it("weighs a made map's evidence over approved ones", async () => {
    // Two approved maps (weight 2) can't outvote one made map (3), so the made map leaves no agreement…
    const disputed = await studio([
      { id: "mine", provenance: "made", measures: { "blend.width": 3.1 } },
      { id: "admired1", provenance: "approved", measures: { "blend.width": 1.2 } },
      { id: "admired2", provenance: "approved", measures: { "blend.width": 1.3 } },
    ]);
    expect((await exemplarReport(disputed, { baseline: BLIZZARD })).measures.find((m) => m.id === "blend.width")).toMatchObject({ verdict: "question" });

    // …and of two distinctive measures three maps each agree on, the one both made maps agree on ranks first.
    const both = await studio([
      { id: "m1", provenance: "made", measures: { "blend.width": 3.1, "doodadDensity.perHundredCells": 30 } },
      { id: "m2", provenance: "made", measures: { "blend.width": 3.2, "doodadDensity.perHundredCells": 2 } },
      { id: "e", provenance: "edited", measures: { "blend.width": 1.2, "doodadDensity.perHundredCells": 30.5 } },
      { id: "a", provenance: "approved", measures: { "blend.width": 3.1, "doodadDensity.perHundredCells": 30.2 } },
    ]);
    const ranked = (await exemplarReport(both, { baseline: BLIZZARD })).measures;
    expect(ranked.slice(0, 2).map((m) => [m.id, m.verdict, m.evidence, m.outliers.map((o) => o.id)])).toEqual([
      ["blend.width", "distinctive", 7, ["e"]],
      ["doodadDensity.perHundredCells", "distinctive", 6, ["m2"]],
    ]);
  });

  it("refuses, naming them, when an Exemplar Map has no study yet", async () => {
    const workspace = await studio([
      { id: "a", provenance: "made" },
      { id: "b", provenance: "made", studied: false },
      { id: "c", provenance: "edited", studied: false },
    ]);

    await expect(exemplarReport(workspace, { baseline: BLIZZARD })).rejects.toThrow("No Map Study to report on for Exemplar Map b (no study), c (no study): run study_exemplar for them first");
  });

  it("names with them a study of another version, or one without every measure, which it won't compare", async () => {
    const workspace = await studio([
      { id: "a", provenance: "made" },
      { id: "old", provenance: "made" },
      { id: "partial", provenance: "made" },
      { id: "none", provenance: "made", studied: false },
    ]);
    const dir = path.join(workspace.root, "style-pack/exemplar-maps");
    await writeFile(path.join(dir, "old/study.json"), JSON.stringify({ mapStudyVersion: 0, measures: allNull() }));
    await writeFile(path.join(dir, "partial/study.json"), JSON.stringify({ mapStudyVersion: 1, measures: { ...allNull(), "blend.width": "wide", "pit.profile": { deep: true } } }));

    await expect(exemplarReport(workspace, { baseline: BLIZZARD })).rejects.toThrow(
      "No Map Study to report on for Exemplar Map old (a study of another version (0, not 1)), partial (a study from before its measures), none (no study)",
    );
  });

  it("reports only the maps ids names, and refuses an id the pack doesn't list", async () => {
    const workspace = await studio([
      { id: "a", provenance: "made" },
      { id: "b", provenance: "made", studied: false },
    ]);

    expect((await exemplarReport(workspace, { ids: ["a"], baseline: BLIZZARD })).maps).toEqual([{ id: "a", provenance: "made" }]);
    await expect(exemplarReport(workspace, { ids: ["z"], baseline: BLIZZARD })).rejects.toThrow("no Exemplar Map z (its Exemplar Maps: a, b)");
  });

  it("names the campaign missions the baseline couldn't measure, and places measures Blizzard has no value for as no baseline", async () => {
    const workspace = await studio([
      { id: "a", provenance: "made", measures: { "lighting.changes": 4 } },
      { id: "b", provenance: "made", measures: { "lighting.changes": 4 } },
    ]);

    const report = await exemplarReport(workspace, { baseline: stubBaseline({ "blend.width": [1, 2] }, 2) });

    expect(report.baseline).toEqual({ maps: 2, unavailable: ["nova01", "nova02"] });
    expect(report.measures.find((m) => m.id === "lighting.changes")).toMatchObject({ verdict: "no baseline", blizzard: null, percentile: null });
  });
});
