// A half-map Melee Map Blueprint rotated 180° about the playable area's centre (#214): every
// object lands on its partner within a cell, as the melee research (§0, §1) measured symmetry on
// the ladder maps, and the compiled terrain is the same turned round.
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MeleeMapBlueprintSchema } from "../../src/domain/melee-map-blueprint.js";
import { compileMeleeMap, writeMeleeMap } from "../../src/map/compile-melee-map.js";
import { readT3HeightMap } from "../../src/terrain/read-t3-height-map.js";
import { readT3SyncCliffLevel } from "../../src/terrain/read-t3-sync-cliff-level.js";
import { readT3TextureMasks } from "../../src/terrain/read-t3-texture-masks.js";

const FIXTURE = fileURLToPath(new URL("../fixtures/melee/two-spawns.json", import.meta.url));
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8"));
// The playable area is [12, 8, 148, 144]: 136×136, centred across, the larger margin at the top.
const CENTRE = { x: 80, y: 76 };
const PLAYABLE = { left: 12, bottom: 8, right: 148, top: 144 };

type MapObject = { readonly kind: string; readonly x: number; readonly y: number };

let outputDir: string;
let warnings: readonly string[];

beforeAll(async () => {
  outputDir = path.join(await mkdtemp(path.join(tmpdir(), "sc2-adjutant-melee-symmetry-")), "two-spawns.SC2Map");
  ({ warnings } = await compileMeleeMap(FIXTURE, outputDir, { savedAt: new Date("2026-10-31T00:00:00Z") }));
}, 30_000);

afterAll(async () => {
  await rm(path.dirname(outputDir), { recursive: true, force: true });
});

async function mapObjects(): Promise<MapObject[]> {
  const objects = await readFile(path.join(outputDir, "Objects"), "utf8");
  const at = (position: string) => position.split(",").map(Number) as [number, number];
  return [
    ...[...objects.matchAll(/<ObjectUnit [^>]*Position="([^"]+)"[^>]*UnitType="([^"]+)"/g)].map((match) => ({ kind: match[2]!, ...xy(at(match[1]!)) })),
    ...[...objects.matchAll(/<ObjectPoint [^>]*Position="([^"]+)"[^>]*Type="([^"]+)"/g)].map((match) => ({ kind: match[2]!, ...xy(at(match[1]!)) })),
  ];
}
const xy = ([x, y]: [number, number]) => ({ x, y });

/** Each playable cell whose cliff level differs from the cell it turns onto. */
async function cliffMismatches(mapDir: string): Promise<string[]> {
  const { width, syncCliff } = readT3SyncCliffLevel(await readFile(path.join(mapDir, "t3SyncCliffLevel")));
  const mismatches: string[] = [];
  for (let y = PLAYABLE.bottom; y < PLAYABLE.top; y++) {
    for (let x = PLAYABLE.left; x < PLAYABLE.right; x++) {
      const [rx, ry] = [2 * CENTRE.x - 1 - x, 2 * CENTRE.y - 1 - y];
      if (syncCliff[y * width + x] !== syncCliff[ry * width + rx]) mismatches.push(`(${x},${y})`);
    }
  }
  return mismatches;
}

describe("a half-map Melee Map Blueprint, rotated 180°", { timeout: 30_000 }, () => {
  it("compiles without warnings", () => {
    expect(warnings).toEqual([]);
  });

  it("pairs every object with a partner of its kind within 1 cell of it turned about the centre, one to one", async () => {
    const objects = await mapObjects();
    // Three resource bases of 8 fields and 2 geysers, one start and one unbuildable plate, each twice.
    expect(objects.length).toBe(2 * (3 * 10 + 1 + 1));
    const unclaimed = new Set(objects);
    const unpartnered = objects.filter((object) => {
      const partner = [...unclaimed].find((other) => other.kind === object.kind && Math.hypot(other.x - (2 * CENTRE.x - object.x), other.y - (2 * CENTRE.y - object.y)) <= 1);
      unclaimed.delete(partner!);
      return partner === undefined;
    });
    expect(unpartnered).toEqual([]);
  });

  it("starts the players at the main's town hall and its rotation", async () => {
    const starts = (await mapObjects()).filter((object) => object.kind === "StartLoc");
    expect(starts).toEqual([
      { kind: "StartLoc", x: 34.5, y: 27.5 },
      { kind: "StartLoc", x: 125.5, y: 124.5 },
    ]);
  });

  it("writes terrain that's the same turned round: each playable cell's cliff level and each vertex's height", async () => {
    expect(await cliffMismatches(outputDir)).toEqual([]);
    // The fixture has ramps, ragged cliffs and three levels, so the comparison has something to catch.
    const { syncCliff } = readT3SyncCliffLevel(await readFile(path.join(outputDir, "t3SyncCliffLevel")));
    expect(new Set(syncCliff).size).toBeGreaterThan(3);

    const { vertexWidth, heights, cliffLevels } = readT3HeightMap(await readFile(path.join(outputDir, "t3HeightMap")));
    const heightMismatches: string[] = [];
    for (let y = PLAYABLE.bottom; y <= PLAYABLE.top; y++) {
      for (let x = PLAYABLE.left; x <= PLAYABLE.right; x++) {
        const [rx, ry] = [2 * CENTRE.x - x, 2 * CENTRE.y - y];
        const [a, b] = [y * vertexWidth + x, ry * vertexWidth + rx];
        if (heights[a] !== heights[b] || cliffLevels[a] !== cliffLevels[b]) heightMismatches.push(`(${x},${y})`);
      }
    }
    expect(heightMismatches).toEqual([]);
  });

  it("paints textures that are the same turned round, texel by texel, seams and patches included", async () => {
    const { maskWidth, layers } = readT3TextureMasks(await readFile(path.join(outputDir, "t3TextureMasks")));
    const perCell = maskWidth / 160;
    const mismatches: string[] = [];
    layers.forEach((layer, index) => {
      for (let ty = PLAYABLE.bottom * perCell; ty < PLAYABLE.top * perCell; ty++) {
        for (let tx = PLAYABLE.left * perCell; tx < PLAYABLE.right * perCell; tx++) {
          const [rx, ry] = [2 * CENTRE.x * perCell - 1 - tx, 2 * CENTRE.y * perCell - 1 - ty];
          if (layer[ty * maskWidth + tx] !== layer[ry * maskWidth + rx]) mismatches.push(`layer ${index} (${tx},${ty})`);
        }
      }
    });
    expect(mismatches.slice(0, 5)).toEqual([]);
    // More than one texture shows, so seams were drawn.
    expect(layers.filter((layer) => layer.some((weight, texel) => weight > 0 && texel % maskWidth >= PLAYABLE.left * perCell)).length).toBeGreaterThan(1);
  });

  it("gives the rotated half stable ids: each authored id with -rot", async () => {
    const outDir = path.join(path.dirname(outputDir), "ids.SC2Map");
    const { blueprint } = await writeMeleeMap(MeleeMapBlueprintSchema.parse(fixture), outDir);
    expect(blueprint.zones.map((zone) => zone.id)).toEqual(["middle", "natural", "natural-rot", "main-rim", "main-rim-rot", "main", "main-rot"]);
    expect(blueprint.placements.map((placement) => placement.id)).toEqual(["main-base", "main-base-rot", "natural-base", "natural-base-rot", "third-base", "third-base-rot"]);
    expect(blueprint.starts).toEqual(["main-base", "main-base-rot"]);
  });
});

describe("an explicit ramp", { timeout: 30_000 }, () => {
  it("is placed in the half and turned onto the other, its rotation named <id>-rot", async () => {
    const half = structuredClone(fixture);
    half.zones[1].connections = [];
    half.ramps = [{ id: "natural-ramp", zoneId: "natural", edge: "east", offset: 16 }];
    const outDir = path.join(path.dirname(outputDir), "explicit-ramp.SC2Map");
    const { blueprint } = await writeMeleeMap(MeleeMapBlueprintSchema.parse(half), outDir);
    expect(blueprint.ramps.map((ramp) => ramp.id)).toEqual(["natural-ramp", "natural-ramp-rot"]);
    expect(await cliffMismatches(outDir)).toEqual([]);
  });
});

describe("rotated ids", { timeout: 30_000 }, () => {
  it("fail the build when an authored id of any kind already has a copy's name", async () => {
    const clash = structuredClone(fixture);
    clash.ramps = [{ id: "main-base-rot", zoneId: "natural", edge: "east", offset: 16 }];
    const outDir = path.join(path.dirname(outputDir), "clash.SC2Map");
    await expect(writeMeleeMap(MeleeMapBlueprintSchema.parse(clash), outDir)).rejects.toThrow(/main-base-rot is the name the rotation gives main-base's copy/);
  });
});

describe("a zone across the centre", { timeout: 30_000 }, () => {
  it("needs to be symmetric in the playable area only: the margins differ, so a whole-map zone is fine", async () => {
    const wholeMap = structuredClone(fixture);
    wholeMap.zones[0].polygon = [{ x: 0, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 160 }, { x: 0, y: 160 }];
    const outDir = path.join(path.dirname(outputDir), "whole-map.SC2Map");
    const { blueprint } = await writeMeleeMap(MeleeMapBlueprintSchema.parse(wholeMap), outDir);
    expect(blueprint.zones.filter((zone) => zone.id.startsWith("middle")).map((zone) => zone.id)).toEqual(["middle"]);
  });

  it("fails the build, naming the zone, unless it's symmetric under the rotation", async () => {
    const lopsided = structuredClone(fixture);
    lopsided.zones[0].polygon[1].x = 146;
    const outDir = path.join(path.dirname(outputDir), "lopsided.SC2Map");
    await expect(writeMeleeMap(MeleeMapBlueprintSchema.parse(lopsided), outDir)).rejects.toThrow(/Zone middle .*symmetric/);
  });
});
