// The compile's warning for Connections cut by doodads' no-pathing (src/map/compiled-pathing.ts):
// a way across that the pools' and the author's paint leave open and the doodads' paint closes, on
// the Ashen Crossing fixture's landing zone beside its surface, with a synthetic wall of paint; and
// the warning for a way through a Zone the doodads squeeze narrower than PATH_WIDTH.
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { MissionBlueprint } from "../../src/domain/mission-blueprint.js";
import { pathingCutWarnings, pathWidthWarnings } from "../../src/map/compiled-pathing.js";
import { loadWorkspace, parseMissionBlueprint } from "../../src/plugins/workspace.js";
import type { DoodadPaint } from "../../src/terrain/doodad-pathing.js";
import { pathingBit } from "../../src/terrain/write-cell-attribute.js";

const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));

/** The fixture with a connection from the landing zone (x 10-30) to the surface round it, crossing at (30, 20). */
async function crossing(): Promise<MissionBlueprint> {
  const workspace = await loadWorkspace(CROSSING);
  const blueprint = structuredClone(await parseMissionBlueprint(workspace, path.join(CROSSING, "missions", "ashen-crossing", "blueprint.json")));
  const landing = blueprint.zones.find((zone) => zone.id === "landing_zone")!;
  (landing.connections as unknown[]).push({ ...landing.connections[0]!, toZoneId: "surface", at: { x: 30, y: 20 } });
  return blueprint;
}

/** A layer with no-pathing down x 29.5-31, y 5-35: across the landing zone's east edge. */
function wall(size: number): Uint8Array {
  const cells = new Uint8Array(size * size);
  for (let sy = 5 * 4; sy < 35 * 4; sy++) for (let sx = 59; sx < 62; sx++) cells[Math.floor(sy / 4) * size + Math.floor(sx / 2)]! |= pathingBit(sx % 2, sy % 4);
  return cells;
}

describe("connections cut by the doodads' paint", () => {
  it("warns when the doodads close the way, and not when the author's own paint does", async () => {
    const blueprint = await crossing();
    const { width, height } = blueprint.mapSize;
    const terrain = { cellFlags: new Uint8Array(width * height), noPathing: new Uint8Array(width * height) };
    const paint: DoodadPaint = { cells: wall(width), byDoodad: new Map([["landing/wall", [0]]]), missing: new Map() };
    const blank = new Uint8Array(width * height);
    // The doodads' paint closes it.
    expect(pathingCutWarnings(blueprint, terrain, { cells: wall(width), withoutDoodads: blank, paint })).toEqual([expect.stringContaining("cuts landing_zone's connection to surface at (30, 20)")]);
    // The author's pathingPaint closes it: that's theirs, not the doodads'.
    expect(pathingCutWarnings(blueprint, terrain, { cells: wall(width), withoutDoodads: wall(width), paint })).toEqual([]);
    // Nothing closes it.
    expect(pathingCutWarnings(blueprint, terrain, { cells: blank, withoutDoodads: blank, paint })).toEqual([]);
  });
});

/** The fixture with the landing zone (x 10-30, y 10-30) crossed to the surface on its west edge at (10, 20) and its east edge at (30, 20). */
async function through(): Promise<MissionBlueprint> {
  const blueprint = await crossing();
  const landing = blueprint.zones.find((zone) => zone.id === "landing_zone")!;
  (landing.connections as unknown[]).push({ ...landing.connections[0]!, toZoneId: "surface", at: { x: 10, y: 20 } });
  return blueprint;
}

/** A layer with no-pathing down x 19.5-20.5 across the landing zone, but for a gap from y 20 of `gap` cells. */
function barrier(size: number, gap: number): Uint8Array {
  const cells = new Uint8Array(size * size);
  for (let sy = 10 * 4; sy < 30 * 4; sy++) {
    if (sy >= 20 * 4 && sy < (20 + gap) * 4) continue;
    for (let sx = 39; sx < 41; sx++) cells[Math.floor(sy / 4) * size + Math.floor(sx / 2)]! |= pathingBit(sx % 2, sy % 4);
  }
  return cells;
}

describe("ways through a Zone squeezed by the doodads' paint", () => {
  it("warns when the doodads leave a gap narrower than PATH_WIDTH, naming where and what, and not for a wide gap or the author's own paint", async () => {
    const blueprint = await through();
    const { width, height } = blueprint.mapSize;
    const terrain = { cellFlags: new Uint8Array(width * height) };
    const blank = new Uint8Array(width * height);
    const narrow = barrier(width, 2);
    const paint: DoodadPaint = { cells: narrow, byDoodad: new Map([["landing/wall", [Math.floor(19 * 4) * width * 2 + 40]]]), missing: new Map() };
    expect(pathWidthWarnings(blueprint, terrain, { cells: narrow, withoutDoodads: blank, paint })).toEqual([
      expect.stringMatching(/squeezes the way through landing_zone narrower than 3 cells between surface \(30, 20\) and surface \(10, 20\), near \(20, 2[01]\):.*Painted nearby: landing\/wall/),
    ]);
    // A gap wide enough.
    const wide = barrier(width, 4);
    expect(pathWidthWarnings(blueprint, terrain, { cells: wide, withoutDoodads: blank, paint: { ...paint, cells: wide } })).toEqual([]);
    // The author's own paint makes the gap: that's theirs.
    expect(pathWidthWarnings(blueprint, terrain, { cells: narrow, withoutDoodads: narrow, paint })).toEqual([]);
    // A crossing the doodads cut outright has the cut warning instead, and is left out here.
    expect(pathWidthWarnings(blueprint, terrain, { cells: narrow, withoutDoodads: blank, paint }, new Set(["landing_zone|surface@10,20"]))).toEqual([]);
  });
});
