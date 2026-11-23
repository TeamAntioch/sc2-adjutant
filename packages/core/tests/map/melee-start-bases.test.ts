// Standard start bases and the main ramp on a compiled melee map (#215): the start base is the
// melee research's template (§1), our port of Blizzard's town-hall rule (§0) finds its StartLoc,
// the main ramp is the Editor's diagonal ramp, and each player gets one unbuildable plate 5-8
// cells from the ramp's top (§1 "Watchtowers, rocks").
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MeleeMapBlueprintSchema } from "../../src/domain/melee-map-blueprint.js";
import { compileMeleeMap, writeMeleeMap } from "../../src/map/compile-melee-map.js";
import { isGeyser, meleeBasePieces, meleeTownHallSpot, offCorner, resourceGap } from "../../src/map/melee-bases.js";
import { meleeMains } from "../../src/map/melee-mains.js";
import { readT3SyncCliffLevel } from "../../src/terrain/read-t3-sync-cliff-level.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/melee/two-spawns.json", import.meta.url));
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));

type MapObject = { readonly kind: string; readonly x: number; readonly y: number };

let outputDir: string;

beforeAll(async () => {
  outputDir = path.join(await mkdtemp(path.join(tmpdir(), "sc2-adjutant-melee-bases-")), "two-spawns.SC2Map");
  await compileMeleeMap(FIXTURE, outputDir, { savedAt: new Date("2026-10-31T00:00:00Z") });
}, 30_000);

afterAll(async () => {
  await rm(path.dirname(outputDir), { recursive: true, force: true });
});

async function mapObjects(mapDir = outputDir): Promise<MapObject[]> {
  const objects = await readFile(path.join(mapDir, "Objects"), "utf8");
  const object = (kind: string, position: string): MapObject => {
    const [x, y] = position.split(",").map(Number) as [number, number];
    return { kind, x, y };
  };
  return [
    ...[...objects.matchAll(/<ObjectUnit [^>]*Position="([^"]+)"[^>]*UnitType="([^"]+)"/g)].map((match) => object(match[2]!, match[1]!)),
    ...[...objects.matchAll(/<ObjectPoint [^>]*Position="([^"]+)"[^>]*Type="([^"]+)"/g)].map((match) => object(match[2]!, match[1]!)),
  ];
}

/** Each diagonal ramp's direction and top (its base piece's centre, the `edge` vertex), from t3Terrain.xml. */
async function ramps(mapDir = outputDir): Promise<{ dir: number; top: { x: number; y: number } }[]> {
  const xml = await readFile(path.join(mapDir, "t3Terrain.xml"), "utf8");
  return [...xml.matchAll(/<ramp dir="(\d)"[^>]* base="[^"]*c=\(([^,]+), ([^)]+)\)/g)].map((match) => ({ dir: Number(match[1]), top: { x: Number(match[2]), y: Number(match[3]) } }));
}

const square = (x: number, y: number) => [{ x, y }, { x: x + 8, y }, { x: x + 8, y: y + 8 }, { x, y: y + 8 }];
const near = (a: MapObject, b: MapObject, reach: number): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= reach;

describe("a compiled melee map's start bases", { timeout: 30_000 }, () => {
  it("lay out the research's template round each StartLoc, facing away from the main ramp", async () => {
    const objects = await mapObjects();
    const starts = objects.filter((object) => object.kind === "StartLoc");
    expect(starts).toHaveLength(2);
    // The half's main ramp climbs south-west into the main, so its minerals wrap the south-west corner; the other main's are turned round.
    for (const [start, facing] of [
      [starts[0]!, "south-west"],
      [starts[1]!, "north-east"],
    ] as const) {
      const resources = objects.filter((object) => object.kind !== "StartLoc" && !object.kind.startsWith("Unbuildable") && near(object, start, 11));
      const expected = meleeBasePieces(start, facing).map(({ unitType, x, y }) => ({ kind: unitType, x, y }));
      expect(resources).toEqual(expect.arrayContaining(expected));
      expect(resources).toHaveLength(10);
      for (const resource of resources) {
        const gap = resourceGap(start, { unitType: resource.kind, ...resource });
        if (isGeyser(resource.kind)) expect(gap).toBe(3);
        else expect([2, 3, 4]).toContain(gap);
        if (gap === 2) expect(offCorner(start, resource)).toBe(true);
      }
    }
  });

  it("put the town hall where our NearResources rule finds it, on the drawn terrain", async () => {
    const objects = await mapObjects();
    const { width, syncCliff } = readT3SyncCliffLevel(await readFile(path.join(outputDir, "t3SyncCliffLevel")));
    const level = (x: number, y: number) => syncCliff[y * width + x]!;
    for (const start of objects.filter((object) => object.kind === "StartLoc")) {
      const resources = objects.filter((object) => /Mineral|Geyser/.test(object.kind) && near(object, start, 11)).map((object) => ({ unitType: object.kind, x: object.x, y: object.y }));
      expect(meleeTownHallSpot(resources, { level, buildable: (x, y) => level(x, y) % 64 === 0 })).toEqual({ x: start.x, y: start.y });
    }
  });
});

describe("the main ramp", { timeout: 30_000 }, () => {
  it("is the Editor's diagonal ramp, one per main, and the turned copy of the half's", async () => {
    const diagonal = (await ramps()).filter((ramp) => ramp.dir >= 4);
    // South-west uphill into the half's main (4), north-east into its copy (7).
    expect(diagonal.map((ramp) => ramp.dir)).toEqual([4, 7]);
    expect(diagonal[1]!.top).toEqual({ x: 160 - diagonal[0]!.top.x, y: 152 - diagonal[0]!.top.y });
  });

  it("is the ladder main ramp: 15 cells of slope in a 5×5 box, stepping 8 a cell, its top edge √2 wide", async () => {
    // Melee research §2 "Main ramp": the same on all 19 two-player ladder maps.
    const { width, syncCliff } = readT3SyncCliffLevel(await readFile(path.join(outputDir, "t3SyncCliffLevel")));
    const xml = await readFile(path.join(outputDir, "t3Terrain.xml"), "utf8");
    expect([...xml.matchAll(/<ramp dir="[4-7]"[^>]* base="[^"]* w=([^ ]+) /g)].map((match) => Number(match[1]))).toEqual([1.414214, 1.414214]);
    for (const { top } of (await ramps()).filter((ramp) => ramp.dir >= 4)) {
      const slope: { x: number; y: number; value: number }[] = [];
      for (let y = top.y - 6; y < top.y + 6; y++) {
        for (let x = top.x - 6; x < top.x + 6; x++) {
          const value = syncCliff[y * width + x]!;
          if (value % 64 !== 0) slope.push({ x, y, value });
        }
      }
      expect(slope).toHaveLength(15);
      const xs = slope.map((cell) => cell.x);
      const ys = slope.map((cell) => cell.y);
      expect([Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]).toEqual([4, 4]);
      expect([...new Set(slope.map((cell) => cell.value))].sort()).toEqual([136, 144, 152, 160, 168, 176]);
    }
  });

  it("is diagonal wherever the main's corner meets the natural, the connection's `at` setting only its position", async () => {
    const elsewhere = structuredClone(fixture);
    // The main's north-west corner instead: the ramp climbs south-east into it.
    elsewhere.zones[1].polygon = [{ x: 8, y: 30 }, { x: 54, y: 30 }, { x: 54, y: 72 }, { x: 8, y: 72 }];
    elsewhere.zones[3].polygon = [{ x: 16, y: 10 }, { x: 54, y: 10 }, { x: 54, y: 44 }, { x: 16, y: 44 }];
    elsewhere.zones[3].connections[0].at = { x: 18, y: 42 };
    // The main's rim follows it, so it still meets the middle a level at a time.
    elsewhere.zones[2].polygon = [{ x: 10, y: 6 }, { x: 60, y: 6 }, { x: 60, y: 46 }, { x: 54, y: 46 }, { x: 54, y: 10 }, { x: 16, y: 10 }, { x: 16, y: 30 }, { x: 10, y: 30 }];
    const outDir = path.join(path.dirname(outputDir), "elsewhere.SC2Map");
    const { warnings } = await writeMeleeMap(MeleeMapBlueprintSchema.parse(elsewhere), outDir);
    expect(warnings).toEqual([]);
    expect((await ramps(outDir)).filter((ramp) => ramp.dir >= 4).map((ramp) => ramp.dir)).toEqual([5, 6]);
  });

  it("notches the ramp into a straight shared edge, a 45° step the width of the narrow ramp", async () => {
    const straight = structuredClone(fixture);
    // The natural only above the main: a straight shared edge, no corner to cut.
    straight.zones[1].polygon = [{ x: 14, y: 44 }, { x: 54, y: 44 }, { x: 54, y: 72 }, { x: 14, y: 72 }];
    straight.zones[1].connections[0].at = { x: 54, y: 60 };
    straight.zones[3].connections[0].at = { x: 34, y: 44 };
    // The main's east side meets the middle all the way down now: the rim goes with it.
    straight.zones[2].polygon = [{ x: 10, y: 6 }, { x: 60, y: 6 }, { x: 60, y: 46 }, { x: 54, y: 46 }, { x: 54, y: 10 }, { x: 14, y: 10 }, { x: 14, y: 44 }, { x: 10, y: 44 }];
    const outDir = path.join(path.dirname(outputDir), "straight.SC2Map");
    const { warnings } = await writeMeleeMap(MeleeMapBlueprintSchema.parse(straight), outDir);
    expect(warnings).toEqual([]);
    expect((await ramps(outDir)).filter((ramp) => ramp.dir >= 4)).toEqual([
      { dir: 4, top: { x: 33, y: 43 } },
      { dir: 7, top: { x: 127, y: 109 } },
    ]);
  });

  it("fails the build, naming the main, when the natural doesn't meet it", async () => {
    const apart = structuredClone(fixture);
    // The natural pulled away from the main: a strip of the middle between them.
    apart.zones[1].polygon = [{ x: 14, y: 50 }, { x: 70, y: 50 }, { x: 70, y: 72 }, { x: 14, y: 72 }];
    apart.zones[1].connections[0].at = { x: 70, y: 60 };
    const outDir = path.join(path.dirname(outputDir), "apart.SC2Map");
    await expect(writeMeleeMap(MeleeMapBlueprintSchema.parse(apart), outDir)).rejects.toThrow(/^Melee rule broken: \[main-ramp\] main main: no room for its diagonal ramp up from natural near/);
  });
});

describe("the unbuildable plate", { timeout: 30_000 }, () => {
  it("is one per player, at its main ramp's foot, 5-8 cells from the ramp's top", async () => {
    const plates = (await mapObjects()).filter((object) => object.kind === "UnbuildablePlatesDestructible");
    const tops = (await ramps()).filter((ramp) => ramp.dir >= 4).map((ramp) => ramp.top);
    expect(plates).toHaveLength(2);
    for (const top of tops) {
      const distance = Math.min(...plates.map((plate) => Math.hypot(plate.x - top.x, plate.y - top.y)));
      expect(distance).toBeGreaterThanOrEqual(5);
      expect(distance).toBeLessThanOrEqual(8);
    }
    // The other half's is the half's turned about the centre (80, 76).
    expect(plates[1]).toEqual({ ...plates[0], x: 160 - plates[0]!.x, y: 152 - plates[0]!.y });
  });

  it("stands on the natural's flat ground", async () => {
    const plates = (await mapObjects()).filter((object) => object.kind === "UnbuildablePlatesDestructible");
    const { width, syncCliff } = readT3SyncCliffLevel(await readFile(path.join(outputDir, "t3SyncCliffLevel")));
    for (const plate of plates) {
      const cells = [-1, 0].flatMap((dx) => [-1, 0].map((dy) => syncCliff[(plate.y + dy) * width + plate.x + dx]));
      // The natural is level 2.
      expect(cells).toEqual([128, 128, 128, 128]);
    }
  });
});

describe("a start base's town hall", { timeout: 30_000 }, () => {
  it("fails the build when the town-hall rule wouldn't find it on its StartLoc", async () => {
    const cramped = structuredClone(fixture);
    // Against the main's west cliff: the 5×5 there isn't level ground.
    cramped.placements[0].params.at = { x: 15, y: 27 };
    const outDir = path.join(path.dirname(outputDir), "cramped.SC2Map");
    await expect(writeMeleeMap(MeleeMapBlueprintSchema.parse(cramped), outDir)).rejects.toThrow(/\[start-base\] start base main-base: the town-hall rule puts its town hall at .*, not on its StartLoc \(15.5, 27.5\)/);
  });
});

describe("a main", { timeout: 30_000 }, () => {
  const parse = (blueprint: unknown) => MeleeMapBlueprintSchema.parse(blueprint);

  it("sits on the top level", () => {
    const low = structuredClone(fixture);
    low.zones.push({ id: "plateau", name: "Plateau", elevation: 3, landform: "flat", role: "path", polygon: square(100, 20) });
    for (const [index, elevation] of [[0, 1], [1, 1], [3, 2]] as const) low.zones[index].elevation = elevation;
    low.zones[1].connections = [];
    expect(() => meleeMains(parse(low))).toThrow(/\[main-ramp\] main main: it's at level 2 \(start base main-base\), below plateau at 3: a main sits on the map's top level/);
  });

  it("has one ramp connection, one level down, and no ramps[] entry", () => {
    const none = structuredClone(fixture);
    none.zones[3].connections = [];
    expect(() => meleeMains(parse(none))).toThrow(/\[main-ramp\] main main: it has no ramp connection/);

    const two = structuredClone(fixture);
    two.zones.push({ id: "pocket", name: "Pocket", elevation: 2, landform: "flat", role: "path", polygon: square(60, 14), connections: [{ toZoneId: "main", type: "ramp" }] });
    expect(() => meleeMains(parse(two))).toThrow(/\[main-ramp\] main main: it has ramp connections to natural, pocket/);

    const explicit = structuredClone(fixture);
    explicit.ramps = [{ id: "main-ramp", zoneId: "main", edge: "north" }];
    expect(() => meleeMains(parse(explicit))).toThrow(/a main's ramp is always the diagonal one/);
  });

  it("is named by its start base; any other base needs a facing", () => {
    expect(meleeMains(parse(fixture))).toEqual([{ zoneId: "main", naturalId: "natural", rampId: "main-natural" }]);
    const unfaced = structuredClone(fixture);
    delete unfaced.placements[1].params.facing;
    expect(() => parse(unfaced)).toThrow(/Resource base natural-base needs a `facing`/);
  });
});

describe("a melee base", { timeout: 30_000 }, () => {
  const parse = (blueprint: unknown) => MeleeMapBlueprintSchema.parse(blueprint);

  it("is gold or rich-gas, not both", () => {
    const both = structuredClone(fixture);
    both.placements[2].params = { ...both.placements[2].params, minerals: "rich", gas: "rich" };
    expect(() => parse(both)).toThrow(/gold or rich-gas, not both/);
  });
});
