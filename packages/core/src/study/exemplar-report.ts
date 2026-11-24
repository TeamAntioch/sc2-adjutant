// The consistency report (#28): which habits a Style Pack's Exemplar Maps share, and which of those
// are the mapper's own rather than what every SC2 campaign map does. It reads each map's Map Study
// (its lesson-neutral measures, measures.ts), so it needs no source map, and compares them with the
// Blizzard baseline (blizzard-baseline.ts). It names no pack's lessons: only the maps and Blizzard's.
//
// Per measure, the maps agree when the largest group of them (by provenance weight) whose values lie
// within one Blizzard middle half (p25 to p75; see `tolerance` for a measure without one) of each
// other holds at least two maps and two thirds of every map's weight, the maps with nothing to
// measure counted too; the rest are its outliers. Agreement wholly outside Blizzard's spread (p10 to p90)
// is distinctive; agreement that touches it is common practice; no agreement is a question for the mapper.

import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { ExemplarMap, ExemplarProvenance } from "../plugins/plugin-api.js";
import { WORKSPACE_FILE, type Workspace } from "../plugins/workspace.js";
import { type BlizzardBaseline, type MeasureSpread, readBlizzardBaseline } from "./blizzard-baseline.js";
import { MAP_STUDY_VERSION } from "./map-study.js";
import { type MeasureId, MEASURES } from "./measures.js";
import { round } from "./stats.js";
import { pickExemplars } from "./study-exemplars.js";

/** How much a map's evidence weighs, by its provenance: a map its author made most. */
export const PROVENANCE_WEIGHT: Readonly<Record<ExemplarProvenance, number>> = { made: 3, edited: 2, approved: 1 };

/** The share of the maps' weight that must agree on a measure. */
const AGREEING_WEIGHT = 2 / 3;

/**
 * - distinctive: the maps agree, outside Blizzard's spread
 * - common practice: the maps agree, and Blizzard's maps do the same
 * - question: the maps don't agree
 * - no baseline: the maps agree, but no Blizzard map has a value to compare
 * - too few maps: fewer than two maps have a value
 */
export const VERDICTS = ["distinctive", "common practice", "question", "no baseline", "too few maps"] as const;
export type Verdict = (typeof VERDICTS)[number];

/** One map's value of a measure. */
export type MapValue = { readonly id: string; readonly value: number };

/** Blizzard's spread of a measure, as the report places the maps against it. */
export type BlizzardSpread = Pick<MeasureSpread, "maps" | "p10" | "p25" | "median" | "p75" | "p90">;

export type ReportMeasure = {
  readonly id: MeasureId;
  readonly description: string;
  readonly verdict: Verdict;
  /** Where the agreeing maps sit against Blizzard's spread (p10 to p90); absent without agreement and a baseline. */
  readonly side?: "above" | "below" | "within";
  /** The agreeing maps' values (every map's with a value, for a question); null when no map has one. */
  readonly spread: { readonly min: number; readonly max: number; readonly median: number } | null;
  /** The maps in the spread, by id; for a question, the largest group, which falls short of agreeing. */
  readonly agreeing: readonly string[];
  /** The maps with a value outside the spread. */
  readonly outliers: readonly MapValue[];
  /** The maps with nothing to measure (no pit, no props of a kind). */
  readonly unmeasured: readonly string[];
  /** The agreeing maps' provenance weight (made 3, edited 2, approved 1), every map's for a question. */
  readonly evidence: number;
  readonly blizzard: BlizzardSpread | null;
  /** The share of Blizzard's maps below the spread's median (ties counting half); null without a baseline. */
  readonly percentile: number | null;
};

export type ExemplarReport = {
  readonly maps: readonly { readonly id: string; readonly provenance: ExemplarProvenance }[];
  /** The Blizzard maps the baseline measured, and the campaign missions it couldn't. */
  readonly baseline: { readonly maps: number; readonly unavailable: readonly string[] };
  /** Every measure, distinctive first, then common practice, questions, and those it can't place. */
  readonly measures: readonly ReportMeasure[];
};

/** As much of a study as the report reads: its version and its measures, any others it holds left alone. */
const StudyMeasuresSchema = z.object({ mapStudyVersion: z.unknown(), measures: z.record(z.string(), z.unknown()).optional() }).passthrough();

const isMeasureValue = (v: unknown): v is number | null => v === null || typeof v === "number";

type StudiedMap = { readonly id: string; readonly provenance: ExemplarProvenance; readonly measures: Readonly<Record<string, number | null>> };

/** The measures in `exemplar`'s study, or why it has none to report. */
async function readStudy(exemplar: ExemplarMap): Promise<StudiedMap | { readonly id: string; readonly missing: string }> {
  const file = path.join(exemplar.studyDir, "study.json");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { id: exemplar.id, missing: "no study" };
    throw error;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = StudyMeasuresSchema.safeParse(json);
  if (!parsed.success) return { id: exemplar.id, missing: "a study.json that isn't a Map Study" };
  const { mapStudyVersion, measures } = parsed.data;
  if (mapStudyVersion !== MAP_STUDY_VERSION) return { id: exemplar.id, missing: `a study of another version (${String(mapStudyVersion)}, not ${MAP_STUDY_VERSION})` };
  if (!measures || MEASURES.some(({ id }) => !isMeasureValue(measures[id]))) return { id: exemplar.id, missing: "a study from before its measures" };
  return { id: exemplar.id, provenance: exemplar.provenance, measures: Object.fromEntries(MEASURES.map(({ id }) => [id, measures[id] as number | null])) };
}

export type ExemplarReportOptions = {
  /** The Exemplar Maps to report on, by id; every one the pack lists when not given. */
  readonly ids?: readonly string[];
  /** The baseline to compare with; the shipped one by default. */
  readonly baseline?: Pick<BlizzardBaseline, "maps" | "unavailable" | "measures">;
};

/**
 * The consistency report of the active Style Pack's Exemplar Maps (`ids`, every one when not given),
 * from their Map Studies. Refused, naming them, when a map has no study yet or one from before its
 * measures, and for an id the pack doesn't list.
 */
export async function exemplarReport(workspace: Workspace, { ids, baseline = readBlizzardBaseline() }: ExemplarReportOptions = {}): Promise<ExemplarReport> {
  const pack = workspace.stylePack;
  if (!pack) throw new Error(`The Workspace names no Style Pack (stylePack in ${path.join(workspace.root, WORKSPACE_FILE)}), so it has no Exemplar Maps`);
  const listed = workspace.registry.contributions("exemplarMaps").filter((exemplar) => exemplar.plugin === pack);
  if (!listed.length) throw new Error(`The Style Pack ${pack} lists no Exemplar Maps to report on: add them to its exemplars.json, then run study_exemplar`);
  const read = await Promise.all(pickExemplars(listed, ids).map(readStudy));
  const unstudied = read.filter((study) => "missing" in study);
  if (unstudied.length) {
    throw new Error(`No Map Study to report on for Exemplar Map ${unstudied.map(({ id, missing }) => `${id} (${missing})`).join(", ")}: run study_exemplar for ${unstudied.length > 1 ? "them" : "it"} first`);
  }
  const studies = read as StudiedMap[];
  const measures = MEASURES.map(({ id, description }) => reportMeasure(id, description, studies, baseline.measures[id].spread, Object.values(baseline.measures[id].maps)));
  return {
    maps: studies.map(({ id, provenance }) => ({ id, provenance })),
    baseline: { maps: baseline.maps.length, unavailable: baseline.unavailable.map(({ id }) => id) },
    measures: rank(measures),
  };
}

type Weighted = MapValue & { readonly weight: number };

const sum = (values: readonly Weighted[]) => values.reduce((total, v) => total + v.weight, 0);

const median = (sorted: readonly number[]) => {
  const middle = (sorted.length - 1) / 2;
  return (sorted[Math.floor(middle)]! + sorted[Math.ceil(middle)]!) / 2;
};

/**
 * How far apart values can be and still agree: Blizzard's middle half (p25 to p75), else its middle
 * 80% (p10 to p90), else its whole range, and when every Blizzard map has the same value, a tenth
 * of the largest of the maps' values.
 */
function tolerance(blizzard: MeasureSpread | null, values: readonly Weighted[]): number {
  const widths = blizzard ? [blizzard.p75 - blizzard.p25, blizzard.p90 - blizzard.p10, blizzard.max - blizzard.min] : [];
  return widths.find((w) => w > 0) ?? Math.max(...values.map((v) => Math.abs(v.value))) / 10;
}

/** The heaviest run of `sorted` values within `width` of its first: by weight, then by maps, then the narrowest. */
function heaviestRun(sorted: readonly Weighted[], width: number): Weighted[] {
  let best: Weighted[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const run = sorted.slice(i).filter((v) => v.value - sorted[i]!.value <= width + 1e-9);
    const spanOf = (r: readonly Weighted[]) => r.at(-1)!.value - r[0]!.value;
    const better = sum(run) - sum(best) || run.length - best.length || (best.length ? spanOf(best) - spanOf(run) : 1);
    if (better > 0) best = run;
  }
  return best;
}

function reportMeasure(id: MeasureId, description: string, studies: readonly StudiedMap[], blizzard: MeasureSpread | null, blizzardValues: readonly (number | null)[]): ReportMeasure {
  const values: Weighted[] = studies.flatMap((study) => {
    const value = study.measures[id];
    return value === null || value === undefined ? [] : [{ id: study.id, value, weight: PROVENANCE_WEIGHT[study.provenance] }];
  });
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const unmeasured = studies.filter((study) => !values.some((v) => v.id === study.id)).map((study) => study.id);
  const against = blizzard ? { maps: blizzard.maps, p10: blizzard.p10, p25: blizzard.p25, median: blizzard.median, p75: blizzard.p75, p90: blizzard.p90 } : null;
  const base = { id, description, unmeasured, blizzard: against };
  const known = blizzardValues.filter((v): v is number => v !== null);
  /** The run's spread, with the share of Blizzard's maps below its median (taken unrounded, so ties count). */
  const placedOf = (run: readonly Weighted[]) => {
    if (!run.length) return { spread: null, percentile: null };
    const middle = median(run.map((v) => v.value));
    const percentile = known.length ? round((known.filter((v) => v < middle).length + known.filter((v) => v === middle).length / 2) / known.length, 2) : null;
    return { spread: { min: run[0]!.value, max: run.at(-1)!.value, median: round(middle) }, percentile };
  };
  if (sorted.length < 2) {
    return { ...base, verdict: "too few maps", ...placedOf(sorted), agreeing: sorted.map((v) => v.id), outliers: [], evidence: sum(sorted) };
  }
  const run = heaviestRun(sorted, tolerance(blizzard, sorted));
  const outliers = sorted.filter((v) => !run.includes(v)).map(({ id: map, value }) => ({ id: map, value }));
  // Two thirds of every map's weight, the unmeasured too: two maps with a pit don't make a habit of five maps.
  const everyMap = studies.reduce((total, study) => total + PROVENANCE_WEIGHT[study.provenance], 0);
  if (run.length < 2 || sum(run) < AGREEING_WEIGHT * everyMap - 1e-9) {
    return { ...base, verdict: "question", ...placedOf(sorted), agreeing: run.map((v) => v.id), outliers, evidence: sum(sorted) };
  }
  const placed = placedOf(run);
  const spread = placed.spread!;
  const percentile = placed.percentile;
  const agreed = { ...base, spread, agreeing: run.map((v) => v.id), outliers, evidence: sum(run), percentile };
  if (!blizzard) return { ...agreed, verdict: "no baseline" };
  const side = spread.min > blizzard.p90 ? "above" : spread.max < blizzard.p10 ? "below" : "within";
  return { ...agreed, verdict: side === "within" ? "common practice" : "distinctive", side };
}

/** How far the spread sits outside Blizzard's p10 to p90, in Blizzard's own p10-to-p90 widths. */
function distance(measure: ReportMeasure): number {
  const { spread, blizzard } = measure;
  if (!spread || !blizzard) return 0;
  const width = blizzard.p90 - blizzard.p10 || 1;
  return Math.max(spread.min - blizzard.p90, blizzard.p10 - spread.max, 0) / width;
}

/** By verdict (VERDICTS' order), then the heaviest evidence, then the farthest from Blizzard's spread, then MEASURES' order. */
function rank(measures: readonly ReportMeasure[]): ReportMeasure[] {
  return [...measures].sort((a, b) => VERDICTS.indexOf(a.verdict) - VERDICTS.indexOf(b.verdict) || b.evidence - a.evidence || distance(b) - distance(a));
}
