import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { type EditorRegion, readRegionsXml } from "../../src/map/read-regions-xml.js";
import { writeMapPackage } from "../../src/map/write-map-package.js";
import { syncRegions } from "../../src/sync/sync-regions.js";
import { EMPTY_REGISTRY } from "../../src/plugins/plugin-api.js";

/** Core alone: no Plugins, the game's catalog. */
const CORE_ALONE = { registry: EMPTY_REGISTRY, catalog: EMPTY_CATALOG };

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Two zones (regions 1 and 2) and a set piece (region 3). */
function blueprint(): Record<string, unknown> {
  return {
    id: "sync",
    campaignId: "test",
    title: "Sync",
    setting: "test",
    mapSize: { width: 64, height: 64 },
    tilesetId: "MarSara",
    zones: [
      { id: "field", name: "Field", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 64, 64) },
      { id: "temple", name: "Temple", elevation: 1, landform: "flat", role: "objective", polygon: [{ x: 40, y: 40 }, { x: 56, y: 44 }, { x: 52, y: 58 }, { x: 38, y: 54 }] },
    ],
    placements: [
      {
        id: "bunker-fight",
        zoneId: "field",
        kind: "set-piece",
        params: { story: "marines held a bunker here and lost", at: { x: 18, y: 18 }, radius: 7, anchor: ["BunkerWrecked"], props: ["AvernusBarrier"], clutter: ["Bonepile"] },
      },
    ],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    screenplay: { title: "Sync" },
  };
}

/** The Regions a compile of `raw` writes. */
async function compile(raw: Record<string, unknown>): Promise<EditorRegion[]> {
  const outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-sync-regions-"));
  try {
    await writeMapPackage({ blueprint: MissionBlueprintSchema.parse(raw), outputDir, includeRegions: true });
    return readRegionsXml(await readFile(path.join(outputDir, "Regions"), "utf8"));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

type Zone = Record<string, unknown> & { id: string };
const zone = (raw: Record<string, unknown>, id: string): Zone => (raw["zones"] as Zone[]).find((z) => z.id === id)!;
const redraw = (regions: EditorRegion[], id: number, change: Partial<EditorRegion>): EditorRegion[] => regions.map((r) => (r.id === id ? { ...r, ...change } : r));

describe("syncRegions", () => {
  it("changes nothing when the Editor changed nothing", async () => {
    const raw = blueprint();
    const regions = await compile(raw);
    expect(regions.map((r) => r.name)).toEqual(["Field", "Temple", "bunker-fight"]);
    const { blueprint: synced, report } = syncRegions(raw, regions, CORE_ALONE);
    expect(report).toEqual({ zonesRedrawn: [], boundsRedrawn: [], added: [], changed: [], removed: [], ignored: [] });
    expect(synced).toEqual(raw);
  });

  it("keeps a zone's redrawn region as its trigger area, at the same region id", async () => {
    const raw = blueprint();
    const drawn = { shapes: [{ type: "circle" as const, center: { x: 47, y: 49 }, radius: 7.5 }], invisible: true };
    const { blueprint: synced, report } = syncRegions(raw, redraw(await compile(raw), 2, drawn), CORE_ALONE);
    expect(report.zonesRedrawn).toEqual(["temple"]);
    expect(zone(synced, "temple")["region"]).toEqual(drawn);
    // The polygon, and so the terrain, is untouched.
    expect(zone(synced, "temple")["polygon"]).toEqual(zone(raw, "temple")["polygon"]);
    const again = await compile(synced);
    expect(again[1]).toEqual({ id: 2, name: "Temple", ...drawn });
    expect(syncRegions(synced, again, CORE_ALONE).report.zonesRedrawn).toEqual([]);
    // Drawn back to the polygon's bounds, the override goes.
    const bounds = { shapes: [{ type: "rect" as const, quad: [38, 40, 56, 58] as [number, number, number, number] }] };
    const back = syncRegions(synced, redraw(again, 2, { ...bounds, invisible: undefined } as Partial<EditorRegion>), CORE_ALONE);
    expect(zone(back.blueprint, "temple")["region"]).toBeUndefined();
  });

  it("keeps a Beat's bounds region redrawn as one rectangle as that Beat's area, and reports any other shape (ADR-0015)", async () => {
    const raw = blueprint();
    (raw["beats"] as Record<string, unknown>[])[0]!["camera"] = { bounds: ["temple"], transition: [0, 0, 60, 60] };
    (raw["beats"] as Record<string, unknown>[])[0]!["playable"] = ["field"];
    const regions = await compile(raw);
    // Zones (1, 2), the set piece (3), then the bounds regions (4-6).
    expect(regions.map((r) => r.name)).toEqual(["Field", "Temple", "bunker-fight", "Bounds Only Playable", "Bounds Only Camera", "Bounds Only Transition"]);
    expect(syncRegions(raw, regions, CORE_ALONE).report.boundsRedrawn).toEqual([]);
    const redrawn = redraw(redraw(redraw(regions, 4, { shapes: [{ type: "rect", quad: [4, 4, 60, 60] }] }), 5, { shapes: [{ type: "rect", quad: [50, 58, 36, 38] }] }), 6, {
      shapes: [{ type: "circle", center: { x: 30, y: 30 }, radius: 20 }],
    });
    const { blueprint: synced, report } = syncRegions(raw, redrawn, CORE_ALONE);
    expect(report.boundsRedrawn).toEqual(["only playable", "only camera"]);
    const beat = (synced["beats"] as Record<string, unknown>[])[0]!;
    expect(beat["playable"]).toEqual([4, 4, 60, 60]);
    expect(beat["camera"]).toEqual({ bounds: [36, 38, 50, 58], transition: [0, 0, 60, 60] });
    expect(report.ignored).toEqual(["beat only: its transition bounds are a rectangle, so a region drawn with other shapes isn't kept (draw one rectangle)"]);
    // One the Editor hasn't touched since the compile stays as the Blueprint says, though the Blueprint has moved on.
    const moved = structuredClone(raw);
    ((moved["zones"] as Record<string, unknown>[])[1]!)["polygon"] = rect(30, 30, 60, 60);
    expect(syncRegions(moved, regions, CORE_ALONE, undefined, new Set(), new Set([5])).report.boundsRedrawn).toEqual([]);
    expect(syncRegions(moved, regions, CORE_ALONE).report.boundsRedrawn).toEqual(["only camera"]);
    // A rectangle with no area, or off the map, isn't kept.
    const flat = syncRegions(raw, redraw(regions, 5, { shapes: [{ type: "rect", quad: [10, 10, 10, 30] }] }), CORE_ALONE);
    expect(flat.report.boundsRedrawn).toEqual([]);
    expect(flat.report.ignored).toEqual(["beat only: its camera bounds were redrawn as [10, 10, 10, 30], which has no area or runs off the 64×64 map, so they aren't kept"]);
    // Deleted, it comes back.
    expect(syncRegions(raw, regions.filter((r) => r.id !== 5), CORE_ALONE).report.ignored).toEqual(["beat only: its camera bounds region was deleted, but triggers use it, so it comes back"]);
  });

  it("adds a region the author drew, writes it after the set pieces, and removes it when deleted", async () => {
    const raw = blueprint();
    const ambush: EditorRegion = { id: 4, name: "Ambush Trigger", shapes: [{ type: "rect", quad: [20, 30, 30, 36] }, { type: "diamond", center: { x: 25, y: 33 }, width: 2, height: 2, negative: true }] };
    const { blueprint: synced, report } = syncRegions(raw, [...(await compile(raw)), ambush], CORE_ALONE);
    expect(report.added).toEqual(["ambush-trigger"]);
    expect(synced["regions"]).toEqual([{ id: "ambush-trigger", name: "Ambush Trigger", shapes: ambush.shapes }]);
    const again = await compile(synced);
    expect(again[3]).toEqual(ambush);
    const removed = syncRegions(synced, again.slice(0, 3), CORE_ALONE);
    expect(removed.report.removed).toEqual(["ambush-trigger"]);
    expect(removed.blueprint["regions"]).toBeUndefined();
  });

  it("reports what it can't keep: a set piece's region, a renamed or deleted zone region", async () => {
    const raw = blueprint();
    const regions = (await compile(raw)).filter((r) => r.id !== 1);
    const edited = redraw(redraw(regions, 2, { name: "Old Temple" }), 3, { shapes: [{ type: "circle", center: { x: 18, y: 18 }, radius: 3 }] });
    const { blueprint: synced, report } = syncRegions(raw, edited, CORE_ALONE);
    expect(report.ignored).toEqual([
      'zone temple: renamed "Old Temple" in the Editor (rename the zone instead)',
      "set piece bunker-fight: its region is a label (edit the set piece instead)",
      "zone field: its region was deleted, but triggers use it, so it comes back",
    ]);
    expect(synced).toEqual(raw);
  });

  it("with a compile record, finds each Compiled region by the id it was written at, and leaves Kept regions in the package", async () => {
    const raw = blueprint();
    const compiled = await compile(raw);
    // The field's region was renumbered past a Kept region holding 1 (numberRegions): the record lists 4, 2, 3.
    const kept: EditorRegion = { id: 1, name: "Author's Gate", shapes: [{ type: "rect", quad: [1, 1, 4, 4] }] };
    const field = { ...compiled[0]!, id: 4, shapes: [{ type: "rect" as const, quad: [0, 0, 60, 60] as [number, number, number, number] }] };
    const saved = [kept, compiled[1]!, compiled[2]!, field];

    const { blueprint: synced, report } = syncRegions(raw, saved, CORE_ALONE, [4, 2, 3]);

    expect(report.zonesRedrawn).toEqual(["field"]);
    expect(zone(synced, "field")["region"]).toEqual({ shapes: field.shapes });
    expect(report.added).toEqual([]);
    expect(synced["regions"]).toBeUndefined();
    expect(report.ignored).toEqual([]);
  });
});
