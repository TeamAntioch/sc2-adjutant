import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { expandDressing } from "../../src/dressing/expand-dressing.js";
import { type ObjectsFile, type PlacedDoodad, readObjectsXml } from "../../src/map/read-objects-xml.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { writeMapPackage } from "../../src/map/write-map-package.js";
import { syncDoodads } from "../../src/sync/sync-doodads.js";
import { rasterizeTerrain, terrainHeightAt } from "../../src/terrain/rasterize.js";
import { EMPTY_REGISTRY } from "../../src/plugins/plugin-api.js";

/** Core alone: no Plugins, the game's catalog. */
const CORE_ALONE = { registry: EMPTY_REGISTRY, catalog: EMPTY_CATALOG };

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A field with a mesa, a set piece, cliff piles, and two doodad anchors (one a beat refers to). */
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
      {
        id: "mesa",
        name: "Mesa",
        elevation: 2,
        landform: "ridge",
        role: "path",
        polygon: rect(36, 36, 56, 56),
        connections: [{ toZoneId: "field", type: "ramp", at: { x: 46, y: 36 } }],
      },
    ],
    anchors: [
      { id: "crate", name: "Crate", zoneId: "field", kind: "doodad", doodadType: "AvernusBarrier", position: { x: 10, y: 40 } },
      { id: "beacon", name: "Beacon", zoneId: "field", kind: "doodad", doodadType: "AvernusBarrier", position: { x: 12, y: 44 } },
    ],
    beats: [{ id: "only", title: "Only", summary: "Test beat.", anchorIds: ["beacon"] }],
    placements: [
      {
        id: "bunker-fight",
        zoneId: "field",
        kind: "set-piece",
        params: {
          story: "marines held a bunker here and lost",
          at: { x: 18, y: 18 },
          radius: 7,
          anchor: ["BunkerWrecked"],
          props: ["AvernusBarrier"],
          clutter: ["Bonepile"],
        },
      },
    ],
    dressing: { cliffs: { spacing: 4, natural: { large: ["ZerusRockLarge"], small: ["AgriaDebris"] } } },
    screenplay: { title: "Sync" },
  };
}

/** The Objects a compile of `raw` writes. */
async function compile(raw: Record<string, unknown>): Promise<ObjectsFile> {
  const outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-sync-"));
  try {
    await writeMapPackage({ blueprint: MissionBlueprintSchema.parse(raw), outputDir, includeObjects: true });
    return readObjectsXml(await readFile(path.join(outputDir, "Objects"), "utf8"));
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

/** The Objects with one doodad changed (or removed, for `null`), as if saved by the Editor. */
function edit(objects: ObjectsFile, id: string, change: ((doodad: PlacedDoodad) => PlacedDoodad) | null): ObjectsFile {
  const objectId = stableObjectId(id);
  expect(objects.doodads.some((d) => d.id === objectId)).toBe(true);
  const doodads = objects.doodads.flatMap((d) => (d.id !== objectId ? [d] : change ? [change(d)] : []));
  return { ...objects, doodads };
}

/** The ground's height, where the Editor stands a doodad it moves. */
const groundAt = (raw: Record<string, unknown>, x: number, y: number): number =>
  terrainHeightAt(rasterizeTerrain(MissionBlueprintSchema.parse(raw)), 64, x, y);

const doodadOf = (objects: ObjectsFile, id: string): PlacedDoodad | undefined => objects.doodads.find((d) => d.id === stableObjectId(id));

/** A doodad the compiler didn't make, as the Editor writes it. */
const fresh = (id: number, type: string, x: number, y: number, z: number): PlacedDoodad => ({
  id,
  type,
  position: { x, y, z },
  yaw: 1,
  pitch: 0,
  roll: 0,
  scale: { x: 1, y: 1, z: 1 },
  flags: [],
});

describe("syncing doodads from the Editor", () => {
  it("changes nothing when nothing was edited", async () => {
    const raw = blueprint();
    const { blueprint: synced, report } = syncDoodads(raw, await compile(raw), CORE_ALONE);
    expect(synced).toEqual(raw);
    expect(Object.values(report).every((ids) => ids.length === 0)).toBe(true);
  });

  it("records a moved, turned set-piece doodad as an edit, and recompiles it there, leaving the rest", async () => {
    const raw = blueprint();
    const before = await compile(raw);
    const id = "bunker-fight/Bonepile/2";
    const editor = edit(before, id, (d) => ({ ...d, position: { x: 20.5, y: 15.25, z: groundAt(raw, 20.5, 15.25) }, yaw: 0.5, tintColor: "200,180,160,255", flags: ["ForcePlacement"] }));
    const { blueprint: synced, report } = syncDoodads(raw, editor, CORE_ALONE);
    expect(report.dressingEdited).toEqual([id]);
    const params = (synced["placements"] as { params: Record<string, unknown> }[])[0]!.params;
    expect(params["edits"]).toEqual({ "Bonepile/2": { x: 20.5, y: 15.25, rotation: 0.5, tint: "200,180,160", forcePlacement: true } });

    const after = await compile(synced);
    const moved = doodadOf(after, id)!;
    expect([moved.position.x, moved.position.y, moved.yaw, moved.tintColor, moved.flags]).toEqual([20.5, 15.25, 0.5, "200,180,160", ["ForcePlacement"]]);
    for (const d of before.doodads) if (d.id !== stableObjectId(id)) expect(after.doodads.find((a) => a.id === d.id)).toEqual(d);
  });

  it("removes a deleted cliff-pile doodad by its seed", async () => {
    const raw = blueprint();
    const before = await compile(raw);
    const parsed = MissionBlueprintSchema.parse(raw);
    const pile = expandDressing(parsed, rasterizeTerrain(parsed)).doodads.find((d) => d.id.startsWith("cliffs/"))!;
    const { blueprint: synced, report } = syncDoodads(raw, edit(before, pile.id, null), CORE_ALONE);
    expect(report.dressingRemoved).toEqual([pile.id]);
    const cliffs = (synced["dressing"] as { cliffs: { edits: Record<string, unknown> } }).cliffs;
    expect(cliffs.edits).toEqual({ [pile.id.slice("cliffs/".length)]: { removed: true } });
    expect(doodadOf(await compile(synced), pile.id)).toBeUndefined();
  });

  it("records a raised doodad as a height offset", async () => {
    const raw = blueprint();
    const before = await compile(raw);
    const id = "bunker-fight/AvernusBarrier/0";
    const z = doodadOf(before, id)!.position.z;
    const { blueprint: synced } = syncDoodads(raw, edit(before, id, (d) => ({ ...d, position: { ...d.position, z: z + 1.5 } })), CORE_ALONE);
    const params = (synced["placements"] as { params: Record<string, unknown> }[])[0]!.params;
    expect(params["edits"]).toEqual({ "AvernusBarrier/0": { heightOffset: 1.5 } });
    expect(doodadOf(await compile(synced), id)!.position.z).toBeCloseTo(z + 1.5, 3);
  });

  it("puts a new doodad inside a set piece into it, and one elsewhere into a new anchor in its zone", async () => {
    const raw = blueprint();
    const before = await compile(raw);
    const editor = {
      ...before,
      doodads: [...before.doodads, fresh(900001, "MarSaraCrack", 19, 19, groundAt(raw, 19, 19)), fresh(900002, "ZerusRockLarge", 46, 46, groundAt(raw, 46, 46))],
    };
    const { blueprint: synced, report } = syncDoodads(raw, editor, CORE_ALONE);
    expect(report.setPieceAdded).toEqual(["bunker-fight: MarSaraCrack"]);
    expect(report.anchorsAdded).toEqual(["mesa-zerusrocklarge-1"]);
    const params = (synced["placements"] as { params: Record<string, unknown> }[])[0]!.params;
    expect(params["added"]).toEqual([{ type: "MarSaraCrack", x: 19, y: 19, rotation: 1, scale: 1, variation: 0 }]);
    const anchor = (synced["anchors"] as { id: string; zoneId: string }[]).find((a) => a.id === "mesa-zerusrocklarge-1")!;
    expect(anchor.zoneId).toBe("mesa");

    // Recompiled, the added set-piece doodad is there and a second sync changes nothing.
    const after = await compile(synced);
    expect(doodadOf(after, "bunker-fight/added/1")!.type).toBe("MarSaraCrack");
    const again = syncDoodads(synced, after, CORE_ALONE);
    expect(again.blueprint).toEqual(synced);
  });

  it("updates a moved doodad anchor, drops a deleted one, and keeps one a beat refers to", async () => {
    const raw = blueprint();
    let editor = edit(await compile(raw), "crate", (d) => ({ ...d, position: { x: 11, y: 41, z: groundAt(raw, 11, 41) }, scale: { x: 1.2, y: 1.2, z: 1.2 } }));
    editor = edit(editor, "beacon", null);
    const { blueprint: synced, report } = syncDoodads(raw, editor, CORE_ALONE);
    expect(report.anchorsChanged).toEqual(["crate"]);
    expect(report.anchorsKept).toEqual(["beacon"]);
    const crate = (synced["anchors"] as Record<string, unknown>[]).find((a) => a["id"] === "crate")!;
    expect(crate["position"]).toEqual({ x: 11, y: 41 });
    expect(crate["scale"]).toBe(1.2);

    const { blueprint: dropped, report: dropReport } = syncDoodads(raw, edit(await compile(raw), "crate", null), CORE_ALONE);
    expect(dropReport.anchorsRemoved).toEqual(["crate"]);
    expect((dropped["anchors"] as { id: string }[]).map((a) => a.id)).toEqual(["beacon"]);
  });

  it("is stable: syncing the recompiled map again changes nothing", async () => {
    const raw = blueprint();
    const before = await compile(raw);
    const editor = edit(before, "bunker-fight/Bonepile/0", (d) => ({ ...d, position: { x: d.position.x + 1, y: d.position.y, z: groundAt(raw, d.position.x + 1, d.position.y) }, scale: { x: 1.3, y: 1.3, z: 0.8 } }));
    const once = syncDoodads(raw, editor, CORE_ALONE).blueprint;
    const twice = syncDoodads(once, await compile(once), CORE_ALONE);
    expect(twice.blueprint).toEqual(once);
    expect(Object.values(twice.report).every((ids) => ids.length === 0)).toBe(true);
  });
});
