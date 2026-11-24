// The Blizzard baseline: core's lesson-neutral measures (measures.ts) over every campaign mission of
// Wings of Liberty, Heart of the Swarm, Legacy of the Void and Nova Covert Ops, so a Style Pack's
// consistency report can tell a mapper's taste from what every SC2 campaign map does. The
// maintainer builds it once from the game's storage (scripts/build-blizzard-baseline.mjs); it
// ships as data/blizzard-baseline.json, with no maps and no frames, and mappers never extract anything.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { type MapMeasures, type MeasureId, MEASURES } from "./measures.js";
import { round } from "./stats.js";

export const BLIZZARD_CAMPAIGNS = ["Wings of Liberty", "Heart of the Swarm", "Legacy of the Void", "Nova Covert Ops"] as const;
export type BlizzardCampaign = (typeof BLIZZARD_CAMPAIGNS)[number];

/** A campaign mission's map: its id (the map file's name), campaign, and folder in the game's storage. */
export type BlizzardMission = { readonly id: string; readonly campaign: BlizzardCampaign; readonly storagePath: string };

const missions = (campaign: BlizzardCampaign, folder: string, ids: readonly string[]): BlizzardMission[] =>
  ids.map((id) => ({ id, campaign, storagePath: `${folder}/${id}.sc2map` }));

const LIBERTY = "campaigns/liberty.sc2campaign/base.sc2maps/maps/campaign";
const SWARM = "campaigns/swarm.sc2campaign/base.sc2maps/maps/campaign";
const VOID = "campaigns/void.sc2campaign/base.sc2maps/maps/campaign/void";
const NOVA = "mods/novastoryassets.sc2mod";

/**
 * Every map a campaign mission plays on: the main missions with each branch's alternative and the
 * secret mission, Heart of the Swarm's evolution missions, Legacy of the Void's prologue (Whispers of
 * Oblivion, shipped in the Swarm campaign's folder) and epilogue. Left out: the story rooms between
 * missions, the tutorials, the test map, the Lost Viking arcade and the challenge maps, none of
 * which is a mission's battlefield.
 */
export const BLIZZARD_CAMPAIGN_MISSIONS: readonly BlizzardMission[] = [
  ...missions("Wings of Liberty", LIBERTY, [
    "thanson01", "thanson02", "thanson03a", "thanson03b",
    "thorner01", "thorner02", "thorner03", "thorner04", "thorner05s",
    "traynor01", "traynor02", "traynor03",
    "ttosh01", "ttosh02", "ttosh03a", "ttosh03b",
    "ttychus01", "ttychus02", "ttychus03", "ttychus04", "ttychus05",
    "tvalerian01", "tvalerian02a", "tvalerian02b", "tvalerian03",
    "tzeratul01", "tzeratul02", "tzeratul03", "tzeratul04",
  ]),
  ...missions("Heart of the Swarm", `${SWARM}/swarm`, [
    "zchar01", "zchar02", "zchar03",
    "zexpedition01", "zexpedition02", "zexpedition03",
    "zhybrid01", "zhybrid02", "zhybrid03",
    "zkorhal01", "zkorhal02", "zkorhal03",
    "zlab01", "zlab02", "zlab03",
    "zspace01", "zspace02",
    "zzerus01", "zzerus02", "zzerus03",
  ]),
  ...missions("Heart of the Swarm", `${SWARM}/swarm/evolution`, [
    "zevolutionbaneling", "zevolutionhydralisk", "zevolutionmutalisk", "zevolutionroach", "zevolutionswarmhost", "zevolutionultralisk", "zevolutionzergling",
  ]),
  ...missions("Legacy of the Void", `${SWARM}/voidprologue`, ["voidprologue01", "voidprologue02", "voidprologue03"]),
  ...missions("Legacy of the Void", VOID, [
    "paiur01", "paiur02", "paiur03", "paiur04", "paiur05", "paiur06",
    "pkorhal01", "pkorhal02",
    "pmoebius01",
    "ppurifier01", "ppurifier02", "ppurifier03",
    "pshakuras01", "pshakuras02",
    "ptaldarim01", "ptaldarim02",
    "pulnar01", "pulnar02", "pulnar03",
    "sc2epilogue01", "sc2epilogue02", "sc2epilogue03",
  ]),
  ...missions("Nova Covert Ops", `${NOVA}/base.sc2maps/maps/campaign/nova`, ["nova01", "nova02", "nova03"]),
  ...missions("Nova Covert Ops", `${NOVA}/base2.sc2maps/maps/campaign/nova`, ["nova04", "nova05", "nova06"]),
  ...missions("Nova Covert Ops", `${NOVA}/base3.sc2maps/maps/campaign/nova`, ["nova07", "nova08", "nova09"]),
];

/** How a measure's values spread over the maps that have one: percentiles interpolate between neighbouring values. */
export type MeasureSpread = {
  readonly maps: number;
  readonly min: number;
  readonly p10: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly p90: number;
  readonly max: number;
  readonly mean: number;
};

/**
 * The spread of `values`, nulls left out; null when none has a value. Unlike a Map Study's
 * quantiles (stats.ts, nearest rank, for reading one map's numbers), the percentiles interpolate:
 * a consistency report compares a mapper's few maps against them, where a step from one map's
 * value to the next would move the edge of the spread.
 */
export function measureSpread(values: readonly (number | null)[]): MeasureSpread | null {
  const sorted = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const at = (q: number) => {
    const position = q * (sorted.length - 1);
    const below = Math.floor(position);
    const above = Math.min(sorted.length - 1, below + 1);
    return round(sorted[below]! + (sorted[above]! - sorted[below]!) * (position - below));
  };
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { maps: sorted.length, min: sorted[0]!, p10: at(0.1), p25: at(0.25), median: at(0.5), p75: at(0.75), p90: at(0.9), max: sorted.at(-1)!, mean: round(mean) };
}

/** One map the baseline measured. */
export type BaselineMap = { readonly id: string; readonly campaign: BlizzardCampaign; readonly name?: string };

/** One measure across the baseline's maps. */
export type BaselineMeasure = {
  /** What it measures, as MEASURES says. */
  readonly description: string;
  readonly spread: MeasureSpread | null;
  /** Every map's value by its id; null where the map has nothing to measure. */
  readonly maps: Readonly<Record<string, number | null>>;
};

/** A campaign mission the install the baseline was built from didn't hold, and why. */
export type UnavailableMap = { readonly id: string; readonly campaign: BlizzardCampaign; readonly reason: string };

export type BlizzardBaseline = {
  readonly baselineVersion: number;
  readonly note: string;
  readonly maps: readonly BaselineMap[];
  /** Missions left out because the install held no data for them; a rebuild from a fuller install measures them. */
  readonly unavailable: readonly UnavailableMap[];
  readonly measures: Readonly<Record<MeasureId, BaselineMeasure>>;
};

export const BLIZZARD_BASELINE_VERSION = 1;

/** The baseline over `maps`, each with its measures, naming the missions it couldn't measure. */
export function buildBlizzardBaseline(maps: readonly (BaselineMap & { readonly measures: MapMeasures })[], unavailable: readonly UnavailableMap[] = []): BlizzardBaseline {
  const measures = Object.fromEntries(
    MEASURES.map(({ id, description }) => {
      const values = maps.map((m) => m.measures[id]);
      return [id, { description, spread: measureSpread(values), maps: Object.fromEntries(maps.map((m, k) => [m.id, values[k]!])) }];
    }),
  ) as Record<MeasureId, BaselineMeasure>;
  return {
    baselineVersion: BLIZZARD_BASELINE_VERSION,
    note: "Core's lesson-neutral measures (src/study/measures.ts) over every campaign mission of Wings of Liberty, Heart of the Swarm, Legacy of the Void and Nova Covert Ops: per measure, its spread over the maps with a value and each map's value. Built by scripts/build-blizzard-baseline.mjs; data/README.md says why it ships.",
    maps: maps.map(({ id, campaign, name }) => ({ id, campaign, ...(name ? { name } : {}) })),
    unavailable: [...unavailable],
    measures,
  };
}

const spreadSchema = z.object({
  maps: z.number().int().positive(),
  min: z.number(),
  p10: z.number(),
  p25: z.number(),
  median: z.number(),
  p75: z.number(),
  p90: z.number(),
  max: z.number(),
  mean: z.number(),
});

const baselineSchema = z.object({
  baselineVersion: z.literal(BLIZZARD_BASELINE_VERSION),
  note: z.string(),
  maps: z.array(z.object({ id: z.string(), campaign: z.enum(BLIZZARD_CAMPAIGNS), name: z.string().optional() })),
  unavailable: z.array(z.object({ id: z.string(), campaign: z.enum(BLIZZARD_CAMPAIGNS), reason: z.string() })),
  measures: z.record(z.string(), z.object({ description: z.string(), spread: spreadSchema.nullable(), maps: z.record(z.string(), z.number().nullable()) })),
});

export const BLIZZARD_BASELINE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/blizzard-baseline.json");

let cached: BlizzardBaseline | undefined;

/**
 * The shipped baseline. Refused when its file doesn't parse, or its measures aren't the ones core
 * gives (one missing, or one core no longer has), which means core's measures changed without
 * the maintainer rebuilding it.
 */
export function readBlizzardBaseline(file = BLIZZARD_BASELINE_PATH): BlizzardBaseline {
  if (file === BLIZZARD_BASELINE_PATH && cached) return cached;
  const parsed = baselineSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const ids = new Set<string>(MEASURES.map(({ id }) => id));
  const missing = [...ids].filter((id) => !parsed.measures[id]);
  const stale = Object.keys(parsed.measures).filter((id) => !ids.has(id));
  if (missing.length || stale.length) {
    const problems = [missing.length ? `has no ${missing.join(", ")}` : "", stale.length ? `has ${stale.join(", ")}, which core doesn't measure` : ""].filter(Boolean);
    throw new Error(`${file} ${problems.join(" and ")}: rebuild it with scripts/build-blizzard-baseline.mjs`);
  }
  // Its measures are exactly core's, checked above, which is what the schema's string keys can't say.
  const baseline = parsed as unknown as BlizzardBaseline;
  if (file === BLIZZARD_BASELINE_PATH) cached = baseline;
  return baseline;
}
