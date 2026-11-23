import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { expandDressing } from "../../src/dressing/expand-dressing.js";
import { readObjectsXml } from "../../src/map/read-objects-xml.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { writeMapPackage } from "../../src/map/write-map-package.js";
import { walkedGround } from "../../src/dressing/walked-ground.js";
import { syncDoodads } from "../../src/sync/sync-doodads.js";
import { rasterizeTerrain, terrainHeightAt } from "../../src/terrain/rasterize.js";
import { EMPTY_REGISTRY } from "../../src/plugins/plugin-api.js";

/** Core alone: no Plugins, the game's catalog. */
const CORE_ALONE = { registry: EMPTY_REGISTRY, catalog: EMPTY_CATALOG };

// terrain-test's level-0 pit (cells 20-36 × 56-72, floor 0, ground 8) holding Agria water at 5.9.
const raw = JSON.parse(await readFile(new URL("../fixtures/terrain-test/blueprint.json", import.meta.url), "utf8")) as Record<string, unknown>;
const WATER = 5.9;
const pool = { id: "pit", zoneId: "pit", type: "Agria", height: WATER };
const shores = { pile: { large: ["ZerusRockLarge"], small: ["AgriaDebris"] }, spacing: 3, sunken: ["RockGiant"], sunkenSpacing: 3 };
const withWater = (extra: Record<string, unknown> = {}) => ({ ...raw, water: [pool], dressing: { shores }, ...extra });
const parse = (extra: Record<string, unknown> = {}) => MissionBlueprintSchema.parse(withWater(extra));

describe("shores (DL-13)", () => {
  const blueprint = parse();
  const terrain = rasterizeTerrain(blueprint);
  const at = (x: number, y: number) => terrainHeightAt(terrain, 128, x, y);

  it("raises the pit's floor into banks that wander above and below the surface", () => {
    // Just inside the cliff's foot, all round the pit.
    const edge = [
      ...Array.from({ length: 12 }, (_, i) => [22.5 + i, 58.5]),
      ...Array.from({ length: 12 }, (_, i) => [22.5 + i, 69.5]),
      ...Array.from({ length: 12 }, (_, i) => [22.5, 58.5 + i]),
      ...Array.from({ length: 12 }, (_, i) => [33.5, 58.5 + i]),
    ];
    const heights = edge.map(([x, y]) => at(x!, y!));
    expect(heights.some((h) => h > WATER)).toBe(true);
    expect(heights.some((h) => h < WATER)).toBe(true);
    expect(Math.max(...heights)).toBeLessThan(WATER + 0.8 + 0.31);
    // The middle stays well under the surface.
    expect(at(28, 64)).toBeLessThan(2);
    // Without a bank, the floor is flat to the cliff.
    const flat = rasterizeTerrain(parse({ water: [{ ...pool, bank: false }] }));
    expect(terrainHeightAt(flat, 128, 22.5, 64)).toBeLessThan(0.5);
  });

  const doodads = expandDressing(blueprint, terrain).doodads.filter((d) => d.id.startsWith("shores/"));

  it("heaps piles at the waterline, each standing on the ground and ignoring placement", () => {
    const piles = doodads.filter((d) => !d.id.includes("/sunken/"));
    expect(new Set(piles.map((d) => d.id.split("/").slice(0, 3).join("/"))).size).toBeGreaterThan(3);
    for (const d of piles) {
      expect(d.forcePlacement).toBe(true);
      expect(d.z).toBeCloseTo(at(d.x, d.y), 5);
      // Near the surface: a pile heaps round a waterline cell, its small pieces a little up or down the bank.
      expect(Math.abs(d.z - WATER)).toBeLessThan(2.5);
    }
  });

  it("stands sunken pieces in the shallows", () => {
    const sunken = doodads.filter((d) => d.id.includes("/sunken/"));
    expect(sunken.length).toBeGreaterThan(0);
    for (const d of sunken) {
      expect(d.type).toBe("RockGiant");
      expect(WATER - d.z).toBeGreaterThan(0.3);
      expect(WATER - d.z).toBeLessThan(1.5);
    }
  });

  it("puts nothing on a pool's banks without shore dressing", () => {
    expect(expandDressing(parse({ dressing: {} }), terrain).doodads).toEqual([]);
  });

  describe("lights", () => {
    const lights = { light: "LightOmniCyanLarge", accent: "LightOmniRedLarge", accentChance: 0.3 };
    // Rasterizing the 128×128 map paints its textures, the slow part: each variant's terrain is
    // rasterized once, and shared by lights that differ only in their own settings, which terrain
    // doesn't read. Unchanged, it is the shores' own terrain above.
    const terrains = new Map([[JSON.stringify({}), terrain]]);
    const lit = (extra: Record<string, unknown> = {}, more: Record<string, unknown> = {}) => {
      const b = parse({ dressing: { shores: { ...shores, lights: { ...lights, ...more } } }, ...extra });
      const key = JSON.stringify(extra);
      if (!terrains.has(key)) terrains.set(key, rasterizeTerrain(parse({ dressing: { shores: { ...shores, lights } }, ...extra })));
      return { blueprint: b, lights: expandDressing(b, terrains.get(key)!).doodads.filter((d) => d.id.includes("/light/")) };
    };
    let litByDefault: ReturnType<typeof lit> | undefined;
    /** lit() with no changes, computed once. */
    const litDefault = () => (litByDefault ??= lit());

    it("strings lights along the waterline, apart, just above the surface", () => {
      const placed = litDefault().lights;
      expect(placed.length).toBeGreaterThan(5);
      expect(new Set(placed.map((d) => d.type))).toEqual(new Set(["LightOmniCyanLarge", "LightOmniRedLarge"]));
      for (const d of placed) {
        expect(d.z).toBeCloseTo(WATER + 0.2, 5);
        expect(Math.abs(WATER - at(d.x, d.y))).toBeLessThan(0.5);
        for (const other of placed) if (other !== d) expect(Math.hypot(other.x - d.x, other.y - d.y)).toBeGreaterThanOrEqual(2.5);
      }
    });

    it("lights only the shore near the player's route", () => {
      // The hero (46, 46) walks into the pit's north-east corner (36, 56); its far shores stay dark.
      const descent = {
        zones: (raw["zones"] as { id: string }[]).map((zone) =>
          zone.id === "field" ? { ...zone, connections: [{ toZoneId: "pit", type: "open" }] } : zone.id === "pit" ? { ...zone, connections: [{ toZoneId: "field", type: "open" }] } : zone,
        ),
        objectives: [{ id: "descend", title: "Descend", description: "Reach the pit.", type: "primary", beatId: "look", completeWhen: { type: "anchorEntersZone", anchorId: "hero_zeratul", zoneId: "pit" } }],
      };
      const { blueprint: routed, lights: placed } = lit(descent);
      const walked = walkedGround(routed);
      expect(walked.reduce((n, cell) => n + cell, 0)).toBeLessThan(40);
      expect(placed.length).toBeGreaterThan(0);
      expect(placed.length).toBeLessThan(litDefault().lights.length);
      const route = [...walked.keys()].filter((cell) => walked[cell]).map((cell) => ({ x: (cell % 128) + 0.5, y: Math.floor(cell / 128) + 0.5 }));
      for (const d of placed) expect(Math.min(...route.map((cell) => Math.hypot(cell.x - d.x, cell.y - d.y)))).toBeLessThanOrEqual(10);
    });

    it("lights fewer stretches the shorter its reach from walked ground", () => {
      // With the pit a backdrop, only the ground round it is walked: a short reach lights only where the bank meets the cliff.
      const backdrop = { zones: (raw["zones"] as { id: string }[]).map((zone) => (zone.id === "pit" ? { ...zone, backdrop: true } : zone)) };
      const near = lit(backdrop, { reach: 1 }).lights;
      for (const d of near) expect(Math.min(d.x - 20, 36 - d.x, d.y - 56, 72 - d.y)).toBeLessThan(1.6);
      expect(lit(backdrop, { reach: 8 }).lights.length).toBeGreaterThan(near.length);
    });
  });

  it("syncs an Editor edit to a shore piece into dressing.shores.edits", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-shores-"));
    try {
      await writeMapPackage({ blueprint, outputDir, includeObjects: true });
      const objects = readObjectsXml(await readFile(path.join(outputDir, "Objects"), "utf8"));
      const target = doodads[0]!;
      const editor = { ...objects, doodads: objects.doodads.filter((d) => d.id !== stableObjectId(target.id)) };
      const { blueprint: synced, report } = syncDoodads(withWater(), editor, CORE_ALONE);
      expect(report.dressingRemoved).toEqual([target.id]);
      const edits = (synced["dressing"] as { shores: { edits: Record<string, unknown> } }).shores.edits;
      expect(edits).toEqual({ [target.id.slice("shores/".length)]: { removed: true } });
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 20_000);
});
