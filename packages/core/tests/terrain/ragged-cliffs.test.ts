import { describe, expect, it } from "vitest";

import { type MissionBlueprint, MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { buildLayoutModel } from "../../src/layout/layout-model.js";
import { rasterizeTerrain, type TerrainRasterizationResult } from "../../src/terrain/rasterize.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const SIZE = 160;

/**
 * A 160×160 field (level 1) holding a long natural plateau (level 2, 16..144 × 16..64) joined to
 * the field by a ramp at (64, 16), a built pad (level 2, 24..136 × 96..112) and a natural pit
 * (level 0, 40..120 × 124..148) holding a banked pool.
 */
function blueprint(extra: Record<string, unknown> = {}): MissionBlueprint {
  return MissionBlueprintSchema.parse({
    id: "ragged",
    campaignId: "test",
    title: "Ragged",
    setting: "test",
    mapSize: { width: SIZE, height: SIZE },
    tilesetId: "BelShirEx2",
    zones: [
      { id: "field", name: "Field", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, SIZE, SIZE) },
      {
        id: "plateau",
        name: "Plateau",
        elevation: 2,
        landform: "ridge",
        role: "path",
        polygon: rect(16, 16, 144, 64),
        connections: [{ toZoneId: "field", type: "ramp", at: { x: 64, y: 16 } }],
      },
      { id: "pad", name: "Pad", elevation: 2, landform: "flat", role: "objective", surface: "built", polygon: rect(24, 96, 136, 112) },
      { id: "pit", name: "Pit", elevation: 0, landform: "canyon", role: "path", polygon: rect(40, 124, 120, 148) },
    ],
    water: [{ id: "pool", zoneId: "pit", type: "Agria", height: 2 }],
    anchors: [],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    screenplay: { title: "Ragged" },
    ...extra,
  });
}

const vertexLevel = (terrain: TerrainRasterizationResult, x: number, y: number): number => terrain.vertexCliffLevels[y * (SIZE + 1) + x]!;

/** For each even x in [x0, x1], the lowest even y in [y0, y1] whose vertex is at `level`. */
function southEdge(terrain: TerrainRasterizationResult, x0: number, x1: number, y0: number, y1: number, level: number): number[] {
  const rows: number[] = [];
  for (let x = x0; x <= x1; x += 2) {
    let y = y0;
    while (y <= y1 && vertexLevel(terrain, x, y) !== level) y += 2;
    rows.push(y);
  }
  return rows;
}

/** Cells reachable from `from` over cells without the cliff flag, 4-connected. */
function reachable(terrain: TerrainRasterizationResult, from: { x: number; y: number }): Uint8Array {
  const seen = new Uint8Array(SIZE * SIZE);
  const queue = [from.y * SIZE + from.x];
  seen[queue[0]!] = 1;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    const [x, y] = [cell % SIZE, Math.floor(cell / SIZE)];
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
      const next = ny * SIZE + nx;
      if (seen[next] || terrain.cellFlags[next]! & 0x01) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return seen;
}

// Each terrain takes a second or so to compile; the tests share them.
const memo = new Map<string, TerrainRasterizationResult>();
const compiled = (extra: Record<string, unknown> = {}): TerrainRasterizationResult => {
  const key = JSON.stringify(extra);
  if (!memo.has(key)) memo.set(key, rasterizeTerrain(blueprint(extra)));
  return memo.get(key)!;
};

describe("ragged natural cliff outlines", { timeout: 30_000 }, () => {
  it("wobble a long straight natural side by a few cells", () => {
    const terrain = compiled();
    // The plateau's south side, away from its corners and the ramp at x = 64.
    const rows = [...southEdge(terrain, 24, 44, 4, 30, 2), ...southEdge(terrain, 84, 136, 4, 30, 2)];
    expect(new Set(rows).size).toBeGreaterThan(2);
    for (const y of rows) expect(Math.abs(y - 16)).toBeLessThanOrEqual(6);
    // A wobble, not salt: neighbouring corners step at most one corner (2 cells) apart.
    for (let i = 1; i < rows.length; i++) if (i !== 11) expect(Math.abs(rows[i]! - rows[i - 1]!)).toBeLessThanOrEqual(2);
  });

  it("leave a built zone's sides straight", () => {
    const terrain = compiled();
    expect(new Set(southEdge(terrain, 28, 132, 86, 106, 2))).toEqual(new Set([96]));
  });

  it("are straight with raggedCliffs 0", () => {
    const terrain = compiled({ raggedCliffs: 0 });
    expect(new Set([...southEdge(terrain, 24, 44, 4, 30, 2), ...southEdge(terrain, 84, 136, 4, 30, 2)])).toEqual(new Set([16]));
  });

  it("grow with the amplitude", () => {
    const spread = (amplitude: number): number => {
      const rows = southEdge(compiled({ raggedCliffs: amplitude }), 84, 136, 0, 40, 2);
      return Math.max(...rows) - Math.min(...rows);
    };
    expect(spread(6)).toBeGreaterThan(spread(1));
  });

  it("are deterministic, and seeded per map", () => {
    const a = compiled();
    const b = rasterizeTerrain(blueprint());
    expect(a.vertexCliffLevels).toEqual(b.vertexCliffLevels);
    expect(a.syncCliff).toEqual(b.syncCliff);
    const other = compiled({ id: "ragged-two" });
    expect(other.vertexCliffLevels).not.toEqual(a.vertexCliffLevels);
  });

  it("follow terrainSeed over the id, so a renamed map keeps its old wobbles", () => {
    const original = compiled();
    const renamed = compiled({ id: "ragged-renamed", terrainSeed: "ragged" });
    expect(renamed.vertexCliffLevels).toEqual(original.vertexCliffLevels);
    expect(renamed.syncCliff).toEqual(original.syncCliff);
    const reseeded = compiled({ terrainSeed: "ragged-two" });
    expect(reseeded.vertexCliffLevels).toEqual(compiled({ id: "ragged-two" }).vertexCliffLevels);
    expect(reseeded.vertexCliffLevels).not.toEqual(original.vertexCliffLevels);
  });

  it("keep ramps where they were, and pathable", () => {
    const ragged = compiled();
    const straight = compiled({ raggedCliffs: 0 });
    expect(ragged.ramps).toEqual(straight.ramps);
    // The ramp's cells and the ground round it are as without the wobble.
    for (let y = 4; y < 28; y++) for (let x = 52; x < 76; x++) expect(ragged.syncCliff[y * SIZE + x], `cell ${x},${y}`).toBe(straight.syncCliff[y * SIZE + x]);
    // From the field's corner, up the ramp, onto the middle of the plateau.
    expect(reachable(ragged, { x: 4, y: 4 })[40 * SIZE + 80]).toBe(1);
  });

  it("are what the checker sees: each ground cell's zone is at the cell's level", () => {
    const bp = blueprint();
    const terrain = compiled();
    const model = buildLayoutModel(bp);
    const wrong: string[] = [];
    for (let cell = 0; cell < SIZE * SIZE; cell++) {
      const [x, y] = [cell % SIZE, Math.floor(cell / SIZE)];
      // A ramp's cells take its levels, whichever zone holds them.
      if (terrain.ramps.some((ramp) => Math.hypot(x - ramp.edge.x, y - ramp.edge.y) < 8)) continue;
      if (terrain.cellFlags[cell] !== 0x02 || terrain.syncCliff[cell]! % 64 !== 0) continue;
      const zone = bp.zones[model.owner[cell]!]!;
      if (zone.elevation !== terrain.syncCliff[cell]! / 64) wrong.push(`${x},${y} ${zone.id}`);
    }
    expect(wrong).toEqual([]);
  });

  it("are what the shores follow: the bank stands at the foot of the wobbled cliff", () => {
    const terrain = compiled();
    const low: string[] = [];
    for (let y = 114; y <= 158; y++) {
      for (let x = 30; x <= 130; x++) {
        if (vertexLevel(terrain, x, y) !== 0) continue;
        let foot = false;
        for (let dy = -2; dy <= 2 && !foot; dy++) for (let dx = -2; dx <= 2 && !foot; dx++) foot = vertexLevel(terrain, x + dx, y + dy) >= 1;
        if (foot && terrain.heights[y * (SIZE + 1) + x]! < 2 - 1.2 - 0.01) low.push(`${x},${y}`);
      }
    }
    expect(low).toEqual([]);
  });

  it("reject a negative amplitude", () => {
    expect(() => blueprint({ raggedCliffs: -1 })).toThrow();
  });
});
