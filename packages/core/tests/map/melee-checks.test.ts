// The melee checks (#216, spec #212 "Checks"): one failing fixture per error and per warning.
// Errors stop the build with nothing written, naming the rule and the object; warnings come
// back in the distance report with the map. The Editor's own reasons and TLMC's forbidden
// features are checked on written packages in melee-status.test.ts.
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MeleeMapBlueprintSchema } from "../../src/domain/melee-map-blueprint.js";
import { writeMeleeMap } from "../../src/map/compile-melee-map.js";
import { meleeBasePieces } from "../../src/map/melee-bases.js";
import { formatMeleeReport, type MeleeReport, meleeWarnings, rampShapeFindings, startBaseFindings, symmetryFindings } from "../../src/map/melee-checks.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/melee/two-spawns.json", import.meta.url));
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
const square = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const points = (...corners: [number, number][]) => corners.map(([x, y]) => ({ x, y }));

let folder: string;

beforeAll(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-melee-checks-"));
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

/** Builds a changed copy of the fixture into its own folder. */
async function build(name: string, change: (blueprint: typeof fixture) => void) {
  const blueprint = structuredClone(fixture);
  change(blueprint);
  const outputDir = path.join(folder, `${name}.SC2Map`);
  return { outputDir, result: writeMeleeMap(MeleeMapBlueprintSchema.parse(blueprint), outputDir) };
}

/** A level-3 ledge beside the main, with its own ramp down to the natural: a second way into the main. */
const ledge = (blueprint: typeof fixture): void => {
  // Under it, a rim a level down where it meets the middle, as the main has, so no cliff climbs two levels.
  blueprint.zones.push({ id: "ledge-rim", name: "Ledge Rim", elevation: 2, landform: "flat", role: "path", backdrop: true, polygon: points([60, 6], [68, 6], [68, 30], [64, 30], [64, 12], [60, 12]) });
  blueprint.zones.push({ id: "ledge", name: "Ledge", elevation: 3, landform: "flat", role: "path", polygon: square(54, 12, 64, 30), connections: [{ toZoneId: "natural", type: "ramp" }] });
};

describe("a melee rule broken stops the build, naming the rule and the object", { timeout: 30_000 }, () => {
  it("start-base: a gold start", async () => {
    const { outputDir, result } = await build("gold-start", (blueprint) => {
      blueprint.placements[0].params.minerals = "rich";
    });
    await expect(result).rejects.toThrow(/\[start-base\] start base main-base: it's a gold base/);
    expect(existsSync(outputDir)).toBe(false);
  });

  it("symmetry: a base near the centre that lands on its own turned copy", async () => {
    const { outputDir, result } = await build("centre-base", (blueprint) => {
      blueprint.placements.push({ id: "centre-base", zoneId: "middle", kind: "resource-base", params: { at: { x: 80, y: 72 }, facing: "north-west" } });
    });
    await expect(result).rejects.toThrow(/\[symmetry\] centre-base-rot\/mineral\/1: MineralField at \(86, 79\.5\) stands on centre-base\/geyser\/1 .*lands on its own turned copy/);
    expect(existsSync(outputDir)).toBe(false);
  });

  it("main-entrance: a second unblocked way off the main, besides its ramp", async () => {
    const { outputDir, result } = await build("ledge", ledge);
    await expect(result).rejects.toThrow(/\[main-entrance\] main main: a worker walks off it at cell \(57, 31\)/);
    expect(existsSync(outputDir)).toBe(false);
  });

  it("main-entrance: passes the second way when rocks block it", async () => {
    const { result } = await build("ledge-rocks", (blueprint) => {
      ledge(blueprint);
      blueprint.placements.push({ id: "ledge-rocks", zoneId: "natural", kind: "rocks", params: { at: { x: 60, y: 33 } } });
    });
    expect((await result).warnings).toEqual([]);
  });

  it("main-ramp: a main with no ramp down to its natural", async () => {
    const { outputDir, result } = await build("no-ramp", (blueprint) => {
      blueprint.zones[3].connections = [];
    });
    await expect(result).rejects.toThrow(/^Melee rule broken: \[main-ramp\] main main: it has no ramp connection/);
    expect(existsSync(outputDir)).toBe(false);
  });

  it("names every rule broken at once", async () => {
    const { result } = await build("two-rules", (blueprint) => {
      blueprint.placements[0].params.gas = "rich";
      blueprint.placements.push({ id: "centre-base", zoneId: "middle", kind: "resource-base", params: { at: { x: 80, y: 72 }, facing: "north-west" } });
    });
    await expect(result).rejects.toThrow(/^\d+ melee rules broken:\n {2}\[start-base\] start base main-base: it has rich gas[\s\S]*\[symmetry\]/);
  });
});

describe("the rules on their own", { timeout: 30_000 }, () => {
  const hall = { x: 34.5, y: 27.5 };
  const pieces = meleeBasePieces(hall, "south-west");

  it("start-base: the ladder template passes; a geyser a cell closer or a patch missing doesn't", () => {
    expect(startBaseFindings("main-base", hall, pieces)).toEqual([]);
    const closer = pieces.map((piece) => (piece.label === "geyser/0" ? { ...piece, x: piece.x + 1 } : piece));
    expect(startBaseFindings("main-base", hall, closer)).toEqual([{ rule: "start-base", object: "start base main-base", message: "VespeneGeyser at (28.5, 30.5) is 2 cells from the town hall, not 3" }]);
    expect(startBaseFindings("main-base", hall, pieces.slice(1))).toEqual([
      { rule: "start-base", object: "start base main-base", message: "it has 9 resources (3 large, 4 small, 2 geysers), not 4 large and 4 small patches and 2 geysers" },
    ]);
  });

  it("symmetry: an object with no partner of its kind within 1 cell of its turned spot", () => {
    const centre = { x: 80, y: 76 };
    const objects = [
      { id: "a", kind: "MineralField", x: 30, y: 30.5 },
      { id: "a-rot", kind: "MineralField", x: 130, y: 121.5 },
      { id: "b", kind: "VespeneGeyser", x: 40.5, y: 20.5 },
      { id: "b-rot", kind: "VespeneGeyser", x: 121.5, y: 129.5 },
    ];
    expect(symmetryFindings(objects, centre)).toEqual([
      { rule: "symmetry", object: "b", message: "VespeneGeyser at (40.5, 20.5) has no partner within 1 cell of (119.5, 131.5), its spot turned about the centre (80, 76)" },
      { rule: "symmetry", object: "b-rot", message: "VespeneGeyser at (121.5, 129.5) has no partner within 1 cell of (38.5, 22.5), its spot turned about the centre (80, 76)" },
    ]);
  });

  it("main-ramp: #215's old wide diagonal ramp, 27 cells of slope in a 7×7 box, isn't the ladder's", () => {
    // Its slope, as the wide template stamped it (terrain/ramps.ts DIAGONAL_SYNC), in its north-east frame.
    const wide = [
      [-2, -6], [-3, -5], [-2, -5], [-1, -5], [-4, -4], [-3, -4], [-2, -4], [-1, -4], [0, -4], [-5, -3], [-4, -3], [-3, -3], [-2, -3], [-1, -3],
      [0, -3], [-6, -2], [-5, -2], [-4, -2], [-3, -2], [-2, -2], [-1, -2], [-5, -1], [-4, -1], [-3, -1], [-2, -1], [-4, 0], [-3, 0],
    ].map(([x, y]) => ({ x: x! + 60, y: y! + 60, value: 160 }));
    expect(rampShapeFindings("main", wide, 2)).toEqual([
      { rule: "main-ramp", object: "main main", message: "its ramp has 27 cells of slope in a 7×7 box: the ladder main ramp has 15 in a 5×5, one level down" },
    ]);
  });
});

describe("the distance report's warnings", { timeout: 30_000 }, () => {
  // A report inside every band: what each warning's fixture changes one number of.
  const good: Omit<MeleeReport, "warnings"> = {
    distances: {
      mainToMain: { ground: { seconds: 45 }, air: 38 },
      rampToRamp: { seconds: 36 },
      naturalToNatural: { seconds: 33 },
      mainToNatural: { base: "natural-base", ground: { seconds: 8 } },
      mainToThird: { base: "third-base", ground: { seconds: 14 } },
      secondThird: { base: "other-third", ground: { seconds: 16 } },
      airVsGround: [{ base: "natural-base", air: 30, ground: 36, ratio: 0.83 }],
      mains: [],
    },
    bases: 16,
    goldBases: 0,
    richGasBases: 0,
  };
  const change = (distances: Partial<MeleeReport["distances"]>, rest: Partial<MeleeReport> = {}) => meleeWarnings({ ...good, ...rest, distances: { ...good.distances, ...distances } });

  it("has none inside the Standard bands", () => {
    expect(meleeWarnings(good)).toEqual([]);
  });

  it.each([
    ["ramp to ramp 39 s", { rampToRamp: { seconds: 39 } }, { rule: "ramp-to-ramp", object: "the main ramps", message: "ramp to ramp is 39 s, outside 33-38 s" }],
    ["main to natural 11 s", { mainToNatural: { base: "natural-base", ground: { seconds: 11 } } }, { rule: "main-to-natural", object: "natural-base", message: "main to natural is 11 s, outside 6-10 s" }],
    [
      "main to third 21 s",
      { mainToThird: { base: "third-base", ground: { seconds: 21 } }, secondThird: { base: "other-third", ground: { seconds: 22 } } },
      { rule: "main-to-third", object: "third-base", message: "main to third is 21 s, outside 10-20 s" },
    ],
    ["the next base 5 s past the third", { secondThird: { base: "other-third", ground: { seconds: 19 } } }, { rule: "second-third", object: "other-third", message: "the next base is 5 s past the third (third-base), more than about 4 s" }],
    ["air at 55% of ground", { airVsGround: [{ base: "third-base", air: 11, ground: 20, ratio: 0.55 }] }, { rule: "air-vs-ground", object: "third-base", message: "by air 11 s from the other main, 55% of its 20 s by ground" }],
  ] as const)("warns at %s", (_name, distances, warning) => {
    expect(change(distances)).toEqual([warning]);
  });

  it("warns when there's no natural, or only one third", () => {
    expect(change({ mainToNatural: undefined, mainToThird: undefined, secondThird: undefined })).toEqual([
      { rule: "main-to-natural", object: "the main", message: "no natural reachable by ground" },
      { rule: "main-to-third", object: "the main", message: "no third base reachable by ground" },
    ]);
    expect(change({ secondThird: undefined })).toEqual([{ rule: "second-third", object: "third-base", message: "it's the only third: no other base to take instead" }]);
  });

  it("compares the unrounded air ratio with 60%", () => {
    expect(change({ airVsGround: [{ base: "third-base", air: 11.9, ground: 20, ratio: 0.596 }] })).toEqual([
      { rule: "air-vs-ground", object: "third-base", message: "by air 11.9 s from the other main, 60% of its 20 s by ground" },
    ]);
  });

  it("warns at 12 bases", () => {
    expect(change({}, { bases: 12 })).toEqual([{ rule: "base-count", object: "the map", message: "12 bases, outside 14-16" }]);
  });

  it("are the compiled fixture's, a test map too small for the Standard bands", async () => {
    const { result } = await build("fixture", () => {});
    const { report, warnings } = await result;
    expect(warnings).toEqual([]);
    expect(report.warnings.map((warning) => warning.rule)).toEqual(["ramp-to-ramp", "main-to-natural", "main-to-third", "second-third", "base-count"]);
  });
});

describe("rocks", { timeout: 30_000 }, () => {
  it("give rocks-up and rocks-down times where they sit on the shortest path, and are turned with the half", async () => {
    const { result } = await build("rocks", (blueprint) => {
      // At the foot of the natural's ramp down to the middle, where the walk between the mains passes.
      blueprint.placements.push({ id: "rocks", zoneId: "middle", kind: "rocks", params: { at: { x: 74, y: 60 } } });
    });
    const { report, blueprint } = await result;
    expect(blueprint.placements.filter((placement) => placement.kind === "rocks").map((placement) => placement.params.at)).toEqual([
      { x: 74, y: 60 },
      { x: 86, y: 92 },
    ]);
    const { ground } = report.distances.mainToMain;
    expect(ground.rocksDown).toBeDefined();
    expect(ground.seconds).toBeGreaterThan(ground.rocksDown!);
    expect(formatMeleeReport(report)).toContain(`Main to main        ${ground.seconds.toFixed(1)} s (rocks down ${ground.rocksDown!.toFixed(1)} s)`);
  });

  it("are a placement, not a connection: a rocks or collapsible connection would draw nothing", () => {
    for (const type of ["rocks", "collapsible"]) {
      const connected = structuredClone(fixture);
      connected.zones[1].connections[0].type = type;
      expect(() => MeleeMapBlueprintSchema.parse(connected)).toThrow(/draws nothing for a rocks or collapsible connection/);
    }
  });
});
