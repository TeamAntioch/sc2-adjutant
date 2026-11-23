import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { StyleBlueprintSchema, styleWorkspace } from "../support/workspaces.js";
import { expandDressing, type PlacedDoodad } from "../../src/dressing/expand-dressing.js";
import { readObjectsXml } from "../../src/map/read-objects-xml.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { writeMapPackage } from "../../src/map/write-map-package.js";
import { syncDoodads } from "../../src/sync/sync-doodads.js";
import { rasterizeTerrain, terrainHeightAt } from "../../src/terrain/rasterize.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const curb = { members: ["XelNaga_Curb"], variations: [0, 1, 2, 3] };
const plants = { members: ["AiurFoliage_Ex2"] };

/** A level-1 field with a built plaza (16-32 × 16-32) and a level-2 mesa (40-56 × 40-56). */
function blueprint(extra: { dressing?: unknown; plaza?: Record<string, unknown>; mesa?: Record<string, unknown> } = {}): Record<string, unknown> {
  return {
    id: "edges",
    campaignId: "test",
    title: "Edges",
    setting: "test",
    mapSize: { width: 64, height: 64 },
    tilesetId: "MarSara",
    // Lines traced a known distance from straight walls.
    raggedCliffs: 0,
    zones: [
      { id: "field", name: "Field", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 64, 64) },
      { id: "plaza", name: "Plaza", elevation: 1, landform: "flat", role: "path", surface: "built", polygon: rect(16, 16, 32, 32), ...extra.plaza },
      { id: "mesa", name: "Mesa", elevation: 2, landform: "ridge", role: "path", polygon: rect(40, 40, 56, 56), ...extra.mesa },
    ],
    dressing: extra.dressing ?? { edges: { built: curb, lip: plants } },
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    screenplay: { title: "Edges" },
  };
}

const expand = (raw: Record<string, unknown>): PlacedDoodad[] => {
  const parsed = StyleBlueprintSchema.parse(raw);
  return expandDressing(parsed, rasterizeTerrain(parsed)).doodads;
};
const ofKind = (doodads: PlacedDoodad[], zone: string, kind: string) => doodads.filter((d) => d.id.startsWith(`edges/${zone}/${kind}/`));

describe("edge lines", () => {
  it("runs curbs end to end round a built zone, turned across the run, just inside it", () => {
    const run = ofKind(expand(blueprint()), "plaza", "built");
    // Four 16-cell sides, a piece every 1.6 cells.
    expect(run.length).toBe(40);
    for (const d of run) {
      expect([0, 1, 2, 3]).toContain(d.variation);
      // Every piece sits 0.3 inside one side of the plaza.
      const inset = Math.min(d.x - 16, 32 - d.x, d.y - 16, 32 - d.y);
      expect(inset).toBeCloseTo(0.3, 5);
      // Along an east-west side the run points along x, so the piece turns a quarter from it.
      const alongX = Math.min(d.y - 16, 32 - d.y) < 0.5;
      const quarters = (d.rotation / (Math.PI / 2)) % 2;
      expect(Math.round(quarters) % 2).toBe(alongX ? 1 : 0);
    }
  });

  it("grows a cliff's lip in clumps from its crest, at the lip's height", () => {
    const parsed = StyleBlueprintSchema.parse(blueprint());
    const terrain = rasterizeTerrain(parsed);
    const lip = ofKind(expandDressing(parsed, terrain).doodads, "mesa", "lip");
    // Dense: well over one piece per cell of the mesa's 64-cell edge.
    expect(lip.length).toBeGreaterThan(80);
    const top = terrainHeightAt(terrain, 64, 48, 48);
    const ins = lip.map((d) => Math.min(d.x - 40, 56 - d.x, d.y - 40, 56 - d.y));
    for (const [i, d] of lip.entries()) {
      // From the crest (the cliff mesh's top cell, a cell outside the polygon) to a cell or so in.
      expect(ins[i]).toBeGreaterThan(-1);
      expect(ins[i]).toBeLessThan(2.6);
      // On the mesa's top, not partway down its cliff.
      expect(Math.abs(d.z - top)).toBeLessThan(0.7);
    }
    // Some lean out over the crest, and most hug the edge.
    expect(ins.filter((v) => v < -0.5).length).toBeGreaterThan(lip.length / 4);
    expect(ins.filter((v) => v < 0).length).toBeGreaterThan(lip.length / 3);
    // Clumped: bare stretches along the edge between them.
    const around = lip.map((d) => (d.y < 40.8 ? d.x - 40 : d.x > 55.2 ? 16 + d.y - 40 : d.y > 55.2 ? 32 + 56 - d.x : 48 + 56 - d.y)).sort((a, b) => a - b);
    // Wild, not a border: how far in a clump reaches varies along the edge (per 2-cell stretch).
    const deepest = new Map<number, number>();
    lip.forEach((d, i) => {
      const stretch = Math.floor((d.y < 40.8 ? d.x - 40 : d.x > 55.2 ? 16 + d.y - 40 : d.y > 55.2 ? 32 + 56 - d.x : 48 + 56 - d.y) / 2);
      deepest.set(stretch, Math.max(deepest.get(stretch) ?? -Infinity, ins[i]!));
    });
    expect(Math.max(...deepest.values()) - Math.min(...deepest.values())).toBeGreaterThan(1);
    const bare = around.map((v, i) => (i === 0 ? v + 64 - around.at(-1)! : v - around[i - 1]!));
    expect(Math.max(...bare)).toBeGreaterThan(2);
    // The field has no lip, and the plaza is level with it: nothing planted there.
    expect(ofKind(expandDressing(parsed, terrain).doodads, "plaza", "lip")).toEqual([]);
  });

  it("keeps rocks on a lip wholly on the crest; only plants lean over it", () => {
    const rocks = { members: ["TyphonRock", "BrokenRocks", "Elsecaro_Small_Rock_Group"] };
    const lip = ofKind(expand(blueprint({ dressing: { edges: { lip: rocks } } })), "mesa", "lip");
    expect(lip.length).toBeGreaterThan(20);
    for (const d of lip) {
      const inside = Math.min(d.x - 40, 56 - d.x, d.y - 40, 56 - d.y);
      // Small rocks (1 cell across at scale 1): the centre at least half its width in from the crest.
      expect(inside).toBeGreaterThanOrEqual((d.scale as number) / 2 - 1e-9);
    }
  });

  it("plants the rim of a pit inside a wider zone, on the high ground round it", () => {
    const raw = blueprint();
    (raw["zones"] as unknown[]).push({ id: "pit", name: "Pit", elevation: 0, landform: "canyon", role: "path", polygon: rect(4, 40, 20, 56) });
    const parsed = StyleBlueprintSchema.parse(raw);
    const terrain = rasterizeTerrain(parsed);
    const rim = ofKind(expandDressing(parsed, terrain).doodads, "field", "lip");
    expect(rim.length).toBeGreaterThan(40);
    const field = terrainHeightAt(terrain, 64, 30, 10);
    for (const d of rim) {
      // From the crest of the cliff mesh round the pit, on the field's level.
      const outside = Math.max(4 - d.x, d.x - 20, 40 - d.y, d.y - 56);
      expect(outside).toBeGreaterThan(0.5);
      expect(outside).toBeLessThan(5.3);
      expect(Math.abs(d.z - field)).toBeLessThan(0.7);
    }
    for (const [i, a] of rim.entries()) for (const b of rim.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(0.5);
  });

  it("follows a ragged cliff's lip off its polygon's side", { timeout: 30_000 }, () => {
    // A long mesa (16..112 × 24..72) on a 128×96 field, its cliff wobbling up to 4 cells.
    const long = (raggedCliffs: number) => {
      const raw = { ...blueprint(), mapSize: { width: 128, height: 96 }, raggedCliffs };
      raw.zones = [
        { id: "field", name: "Field", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 128, 96) },
        { id: "mesa", name: "Mesa", elevation: 2, landform: "ridge", role: "path", polygon: rect(16, 24, 112, 72) },
      ];
      const parsed = StyleBlueprintSchema.parse(raw);
      const terrain = rasterizeTerrain(parsed);
      return { terrain, lip: ofKind(expandDressing(parsed, terrain).doodads, "mesa", "lip") };
    };
    const straight = long(0).lip;
    const { terrain, lip } = long(4);
    // About as dense as along straight sides, though the crest wanders.
    expect(lip.length).toBeGreaterThan(straight.length * 0.75);
    const top = terrainHeightAt(terrain, 128, 64, 48);
    const fromSide = lip.map((d) => Math.min(d.x - 16, 112 - d.x, d.y - 24, 72 - d.y));
    for (const d of lip) expect(Math.abs(d.z - top)).toBeLessThan(0.7);
    // Some stand where the cliff wandered: further out, or further in, than a straight lip's.
    expect(fromSide.some((v) => v < -1.5 || v > 3.5)).toBe(true);
  });

  it("spaces a planted lip line evenly when it doesn't clump", () => {
    const colonnade = { members: ["TempleColumn"], step: 3, inset: 1, jitter: 0, clumps: 0, aligned: true };
    const lip = ofKind(expand(blueprint({ mesa: { edges: { lip: colonnade } } })), "mesa", "lip");
    expect(lip.length).toBeGreaterThan(15);
    // Each a cell in from the side it traces, and a step from the next.
    for (const d of lip) expect([d.x - 40, 56 - d.x, d.y - 40, 56 - d.y].some((v) => Math.abs(v - 1) < 1e-6)).toBe(true);
    for (const [i, a] of lip.entries()) for (const b of lip.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(3);
  });

  it("wears a broken run: wreckage over each cut end, debris in the gaps", () => {
    const breaks = { caps: ["Aiur_City_Debris"], debris: ["Aiur_Destroyed_Protoss_Units"] };
    const all = ofKind(expand(blueprint({ dressing: { edges: { built: { ...curb, gaps: 0.3, breaks } } } })), "plaza", "built");
    const curbs = all.filter((d) => d.type === "XelNaga_Curb");
    const caps = all.filter((d) => d.id.includes("/cap/"));
    const debris = all.filter((d) => d.id.includes("/debris/"));
    expect(caps.length).toBeGreaterThan(5);
    expect(debris.length).toBeGreaterThan(5);
    for (const cap of caps) {
      expect(cap.type).toBe("Aiur_City_Debris");
      // Shrunk to noise.
      expect(cap.scale).toBeGreaterThanOrEqual(0.08);
      expect(cap.scale).toBeLessThanOrEqual(0.16);
      // On a cut: about half a step from the curb it covers.
      const nearest = Math.min(...curbs.map((c) => Math.hypot(c.x - cap.x, c.y - cap.y)));
      expect(nearest).toBeGreaterThan(0.5);
      expect(nearest).toBeLessThan(1.1);
    }
    for (const d of debris) expect(d.type).toBe("Aiur_Destroyed_Protoss_Units");
    // An unbroken run has no wear.
    const whole = ofKind(expand(blueprint({ dressing: { edges: { built: { ...curb, breaks } } } })), "plaza", "built");
    expect(whole.every((d) => d.type === "XelNaga_Curb")).toBe(true);
  });

  it("keeps the ground level under a built zone's curbs, a cell past its edge", () => {
    const terrain = rasterizeTerrain(StyleBlueprintSchema.parse(blueprint()));
    const at = (vx: number, vy: number) => terrain.heights[vy * 65 + vx]!;
    // The plaza's west edge is x 16: level out to x 15, rough by x 13.
    for (let vy = 18; vy <= 30; vy++) for (const vx of [15, 16, 20]) expect(at(vx, vy)).toBe(at(24, 24));
    expect(new Set(Array.from({ length: 12 }, (_, i) => at(12, 18 + i))).size).toBeGreaterThan(1);
  });

  it("paints a built zone's texture right to its edge, under its curbs, palette or not", () => {
    const terrain = rasterizeTerrain(StyleBlueprintSchema.parse(blueprint()));
    // Without a palette the plaza (zone 1) wears layer 1, the field layer 0.
    const share = (x: number, y: number) => terrain.textureWeights[(y * 64 + x) * 8 + 1]! / 15;
    for (let y = 17; y <= 30; y++) {
      expect(share(16, y)).toBeGreaterThan(0.8);
      expect(share(31, y)).toBeGreaterThan(0.8);
      expect(share(14, y)).toBeLessThan(0.2);
    }
  });

  it("lets a zone set its own line, or none, and breaks a run by its gaps", () => {
    const own = expand(blueprint({ plaza: { edges: { built: { members: ["StarshipHallTrim"], step: 2 } } }, mesa: { edges: { lip: "none" } } }));
    const trim = ofKind(own, "plaza", "built");
    expect(new Set(trim.map((d) => d.type))).toEqual(new Set(["StarshipHallTrim"]));
    expect(trim.length).toBe(32);
    expect(ofKind(own, "mesa", "lip")).toEqual([]);
    const broken = ofKind(expand(blueprint({ dressing: { edges: { built: { ...curb, gaps: 0.5 } } } })), "plaza", "built");
    expect(broken.length).toBeGreaterThan(10);
    expect(broken.length).toBeLessThan(30);
  });

  it("syncs an Editor edit to an edge piece into dressing.edges.edits", async () => {
    const raw = blueprint();
    const outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-edges-"));
    try {
      await writeMapPackage({ blueprint: StyleBlueprintSchema.parse(raw), outputDir, includeObjects: true });
      const objects = readObjectsXml(await readFile(path.join(outputDir, "Objects"), "utf8"));
      const target = ofKind(expand(raw), "plaza", "built")[0]!;
      const edited = { ...objects, doodads: objects.doodads.filter((d) => d.id !== stableObjectId(target.id)) };
      const { blueprint: synced, report } = syncDoodads(raw, edited, styleWorkspace);
      expect(report.dressingRemoved).toEqual([target.id]);
      expect((synced["dressing"] as { edges: { edits: unknown } }).edges.edits).toEqual({ [target.id.slice("edges/".length)]: { removed: true } });
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 20_000);
});
