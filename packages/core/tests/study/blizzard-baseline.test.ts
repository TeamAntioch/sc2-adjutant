import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BLIZZARD_CAMPAIGN_MISSIONS,
  buildBlizzardBaseline,
  readBlizzardBaseline,
} from "../../src/study/blizzard-baseline.js";
import { type MapMeasures, MEASURES } from "../../src/study/measures.js";

const measuresOf = (values: Partial<MapMeasures>): MapMeasures =>
  Object.fromEntries(MEASURES.map(({ id }) => [id, values[id] ?? null])) as MapMeasures;

describe("buildBlizzardBaseline", () => {
  it("gives each measure its spread over the maps that have a value, and each map's value", () => {
    const maps = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((v, k) => ({
      id: `m${k}`,
      campaign: "Wings of Liberty",
      measures: measuresOf({ "blend.width": v }),
    }));
    maps.push({ id: "none", campaign: "Wings of Liberty", measures: measuresOf({}) });
    const baseline = buildBlizzardBaseline(maps);
    const width = baseline.measures["blend.width"];
    // Percentiles interpolate between neighbouring values: the 25th sits a quarter of the way from 0.3 to 0.4.
    expect(width.spread).toEqual({ maps: 10, min: 0.1, p10: 0.19, p25: 0.325, median: 0.55, p75: 0.775, p90: 0.91, max: 1, mean: 0.55 });
    expect(width.maps.m3).toBe(0.4);
    expect(width.maps.none).toBeNull();
    expect(baseline.measures["backdrop.share"].spread).toBeNull();
    expect(baseline.maps.map((m) => m.id)).toEqual([...maps.map((m) => m.id)]);
    expect(baseline.unavailable).toEqual([]);
  });

  it("names the missions it couldn't measure, and leaves them out of every measure", () => {
    const gone = { id: "nova01", campaign: "Nova Covert Ops", reason: "not downloaded" };
    const baseline = buildBlizzardBaseline([{ id: "m0", campaign: "Wings of Liberty", measures: measuresOf({ "blend.width": 1 }) }], [gone]);
    expect(baseline.unavailable).toEqual([gone]);
    expect(Object.keys(baseline.measures["blend.width"].maps)).toEqual(["m0"]);
  });
});

describe("readBlizzardBaseline", () => {
  const write = (content: object) => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "baseline-")), "baseline.json");
    writeFileSync(file, JSON.stringify(content));
    return file;
  };
  const built = buildBlizzardBaseline([{ id: "m0", campaign: "Wings of Liberty", measures: measuresOf({}) }]);

  it("refuses a baseline with a measure core no longer gives", () => {
    const file = write({ ...built, measures: { ...built.measures, "old.measure": built.measures["blend.width"] } });
    expect(() => readBlizzardBaseline(file)).toThrow(/old\.measure, which core doesn't measure/);
  });

  it("refuses a baseline that lacks one of core's measures", () => {
    const { "blend.width": _, ...rest } = built.measures;
    expect(() => readBlizzardBaseline(write({ ...built, measures: rest }))).toThrow(/has no blend\.width/);
  });
});

describe("data/blizzard-baseline.json", () => {
  const baseline = readBlizzardBaseline();

  it("covers every measure", () => {
    expect(Object.keys(baseline.measures).sort()).toEqual(MEASURES.map((m) => m.id).sort());
  });

  it("covers every campaign mission of the four campaigns, measured or named as missing from the install it was built from", () => {
    const measured = baseline.maps.map((m) => m.id).sort();
    const unavailable = baseline.unavailable.map((m) => m.id);
    expect([...measured, ...unavailable].sort()).toEqual(BLIZZARD_CAMPAIGN_MISSIONS.map((m) => m.id).sort());
    for (const { id } of MEASURES) expect(Object.keys(baseline.measures[id].maps).sort()).toEqual(measured);
    const campaigns = new Set([...baseline.maps, ...baseline.unavailable].map((m) => m.campaign));
    expect(campaigns).toEqual(new Set(["Wings of Liberty", "Heart of the Swarm", "Legacy of the Void", "Nova Covert Ops"]));
    for (const m of baseline.unavailable) expect(m.reason).not.toBe("");
  });

  it("holds spreads that agree with the maps' values", () => {
    for (const { id } of MEASURES) {
      const { spread, maps } = baseline.measures[id];
      const values = Object.values(maps).filter((v): v is number => v !== null);
      if (!values.length) expect(spread).toBeNull();
      else expect(spread).toMatchObject({ maps: values.length, min: Math.min(...values), max: Math.max(...values) });
    }
  });
});
