import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { type ObjectsFile, readObjectsXml } from "../../src/map/read-objects-xml.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { writeMapPackage } from "../../src/map/write-map-package.js";
import { syncAnchors } from "../../src/sync/sync-anchors.js";
import { EMPTY_REGISTRY } from "../../src/plugins/plugin-api.js";

/** Core alone: no Plugins, the game's catalog. */
const CORE_ALONE = { registry: EMPTY_REGISTRY, catalog: EMPTY_CATALOG };

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A field and a mesa, a hero an objective refers to, a marine, a rally point and an intro camera. */
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
      { id: "mesa", name: "Mesa", elevation: 1, landform: "flat", role: "objective", polygon: rect(36, 36, 56, 56) },
    ],
    anchors: [
      { id: "hero", name: "Hero", zoneId: "field", kind: "unit", unitType: "Marine", player: 1, position: { x: 10, y: 10 } },
      { id: "marine", name: "Marine", zoneId: "field", kind: "unit", unitType: "Marine", player: 1, position: { x: 12, y: 10 } },
      { id: "rally", name: "Rally", zoneId: "field", kind: "point", position: { x: 20, y: 20 } },
      {
        id: "intro",
        name: "Intro",
        zoneId: "field",
        kind: "camera",
        position: { x: 30, y: 30 },
        cameraTarget: { x: 30, y: 30 },
        cameraValues: [
          { index: "Distance", value: 34 },
          { index: "Pitch", value: 45 },
        ],
      },
    ],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    objectives: [
      {
        id: "arrive",
        title: "Arrive",
        description: "Reach the mesa.",
        type: "primary",
        beatId: "only",
        completeWhen: { type: "anchorEntersZone", anchorId: "hero", zoneId: "mesa" },
      },
    ],
    screenplay: { title: "Sync" },
  };
}

/** The Objects a compile of `raw` writes. */
async function compile(raw: Record<string, unknown>): Promise<{ objects: ObjectsFile; xml: string }> {
  const outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-sync-anchors-"));
  try {
    await writeMapPackage({ blueprint: MissionBlueprintSchema.parse(raw), outputDir, includeObjects: true });
    const xml = await readFile(path.join(outputDir, "Objects"), "utf8");
    return { objects: readObjectsXml(xml), xml };
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

type Anchor = Record<string, unknown> & { id: string };
const anchorsOf = (raw: Record<string, unknown>): Anchor[] => raw["anchors"] as Anchor[];
const anchor = (raw: Record<string, unknown>, id: string): Anchor => anchorsOf(raw).find((a) => a.id === id)!;
const objectId = (id: string): number => stableObjectId(id);

describe("syncAnchors", () => {
  it("changes nothing when the Editor changed nothing", async () => {
    const raw = blueprint();
    const { objects } = await compile(raw);
    const { blueprint: synced, report } = syncAnchors(raw, objects, CORE_ALONE);
    expect(report).toEqual({ changed: [], added: [], removed: [], kept: [], notKept: [] });
    expect(synced).toEqual(raw);
  });

  it("updates a unit moved, turned, handed over and set not to be created", async () => {
    const raw = blueprint();
    const { objects } = await compile(raw);
    const units = objects.units.map((u) =>
      u.id === objectId("marine") ? { ...u, position: { x: 14.25, y: 11.5, z: 0 }, yaw: 1.5708, player: 2, flags: ["UnitNoCreate", "ForcePlacement"] } : u,
    );
    const { blueprint: synced, report } = syncAnchors(raw, { ...objects, units }, CORE_ALONE);
    expect(report.changed).toEqual(["marine"]);
    expect(anchor(synced, "marine")).toMatchObject({ position: { x: 14.25, y: 11.5 }, rotation: 1.5708, player: 2, flags: ["UnitNoCreate"], forcePlacement: true });
    // Compiled again, the Editor's flags come back.
    const { xml } = await compile(synced);
    expect(xml).toContain('<Flag Index="UnitNoCreate" Value="1"/>');
    expect(syncAnchors(synced, (await compile(synced)).objects, CORE_ALONE).report.changed).toEqual([]);
  });

  it("updates a camera retargeted and a point renamed", async () => {
    const raw = blueprint();
    const { objects } = await compile(raw);
    // The compiler writes the default game camera with Distance 34 (the default) and Pitch 45 on top.
    const cameras = objects.cameras.map((c) => ({ ...c, target: { x: 32, y: 28 }, values: c.values.map((v) => (v.index === "FieldOfView" ? { ...v, value: 40 } : v)) }));
    const points = objects.points.map((p) => ({ ...p, name: "Muster", type: "StartLoc" }));
    const { blueprint: synced, report } = syncAnchors(raw, { ...objects, cameras, points }, CORE_ALONE);
    expect(report.changed.sort()).toEqual(["intro", "rally"]);
    expect(anchor(synced, "intro")).toMatchObject({
      cameraTarget: { x: 32, y: 28 },
      // Only what differs from the defaults stays.
      cameraValues: [
        { index: "FieldOfView", value: 40 },
        { index: "Pitch", value: 45 },
      ],
    });
    expect(anchor(synced, "rally")).toMatchObject({ name: "Muster", pointType: "StartLoc" });
  });

  it("adds what the compiler didn't make as anchors in the zone they stand in", async () => {
    const raw = blueprint();
    const { objects } = await compile(raw);
    const units = [...objects.units, { id: 777, type: "SiegeTank", player: 2, position: { x: 40, y: 40, z: 0 }, yaw: 0, scale: { x: 1, y: 1, z: 1 }, flags: [], extras: ["AIRebuild"] }];
    const cameras = [...objects.cameras, { id: 778, name: "Overlook", position: { x: 50, y: 50, z: 0 }, yaw: 0, target: { x: 50, y: 50 }, values: [{ index: "Distance", value: 40 }], flags: [], extras: [] }];
    const { blueprint: synced, report } = syncAnchors(raw, { ...objects, units, cameras }, CORE_ALONE);
    expect(report.added).toEqual(["mesa-siegetank-1", "mesa-overlook-1"]);
    expect(anchor(synced, "mesa-siegetank-1")).toMatchObject({ zoneId: "mesa", kind: "unit", unitType: "SiegeTank", player: 2, position: { x: 40, y: 40 } });
    expect(anchor(synced, "mesa-overlook-1")).toMatchObject({ kind: "camera", name: "Overlook", cameraTarget: { x: 50, y: 50 }, cameraValues: [{ index: "Distance", value: 40 }] });
    expect(report.notKept).toEqual(["mesa-siegetank-1: AIRebuild"]);
    // The new anchors compile to the Editor's objects: a second sync finds them, not new ones.
    const again = syncAnchors(synced, (await compile(synced)).objects, CORE_ALONE).report;
    expect(again.added).toEqual([]);
  });

  it("removes a deleted anchor unless something refers to it", async () => {
    const raw = blueprint();
    const { objects } = await compile(raw);
    const units = objects.units.filter((u) => u.id !== objectId("hero") && u.id !== objectId("marine"));
    const { blueprint: synced, report } = syncAnchors(raw, { ...objects, units }, CORE_ALONE);
    expect(report.removed).toEqual(["marine"]);
    expect(report.kept).toEqual(["hero"]);
    expect(anchorsOf(synced).map((a) => a.id)).toEqual(["hero", "rally", "intro"]);
  });
});
