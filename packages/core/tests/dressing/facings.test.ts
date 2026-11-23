import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DoodadFacingsSchema } from "@team-antioch/sc2-asset-catalog/catalog/doodad-facings.js";
import { bundledDoodadFacings, compositeFront, DOODAD_FACINGS_PATH, getDoodadFacing, rotationToFace } from "../../src/catalog/stock-catalog.js";
import { CompositeSchema } from "../../src/domain/mission-blueprint.js";
import { expandDressing } from "../../src/dressing/expand-dressing.js";
import { rasterizeTerrain, terrainHeightAt } from "../../src/terrain/rasterize.js";
import { StyleBlueprintSchema } from "../support/workspaces.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const degrees = (radians: number): number => Math.round((((radians * 180) / Math.PI) % 360 + 360) % 360 * 1000) / 1000;

/** A 64×64 floor with a wall: the north one rises above y 40, facing south into the room, like the author's test strip. */
function room(params: Record<string, unknown>, { wall = rect(0, 40, 64, 64), composites = [] as unknown[] } = {}) {
  return {
    id: "facings",
    campaignId: "test",
    title: "Facings",
    setting: "test",
    mapSize: { width: 64, height: 64 },
    raggedCliffs: 0,
    tilesetId: "MarSara",
    zones: [
      { id: "floor", name: "Floor", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 64, 64) },
      { id: "wall", name: "Wall", elevation: 2, landform: "ridge", role: "path", polygon: wall },
    ],
    anchors: [],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    placements: [{ id: "bay", zoneId: "floor", kind: "set-piece", params: { story: "a lab bay against the wall", at: { x: 32, y: 37 }, radius: 6, nestle: true, ...params } }],
    composites,
    screenplay: { title: "Facings" },
  };
}

const expand = (raw: ReturnType<typeof room>) => {
  const parsed = StyleBlueprintSchema.parse(raw);
  const terrain = rasterizeTerrain(parsed);
  return { ...expandDressing(parsed, terrain), ground: (x: number, y: number) => terrainHeightAt(terrain, 64, x, y) };
};

describe("doodad facings (doodad-facings.json)", () => {
  const facings = bundledDoodadFacings();

  it("validates, and names only doodads the game has", () => {
    expect(() => DoodadFacingsSchema.parse(JSON.parse(readFileSync(DOODAD_FACINGS_PATH, "utf8")))).not.toThrow();
    const doodads = JSON.parse(readFileSync(new URL("../../data/doodads.json", import.meta.url), "utf8")) as Record<string, unknown>;
    expect(Object.keys(facings.doodads).filter((id) => !(id in doodads))).toEqual([]);
  });

  it("records the author's test strip of 2026-11-09", () => {
    const front = (front: number) => Object.entries(facings.doodads).filter(([, f]) => f.front === front).map(([id]) => id).sort();
    expect(front(180)).toEqual(["CompoundSewers_Tank", "ElectricConduitPathMedium", "JarbanMinor_Tank"]);
    expect(front(90)).toEqual(["DOM_LabWallScreens"]);
    expect(front(270)).toHaveLength(49);
    expect(front(270)).toEqual(expect.arrayContaining(["SpacePlatformSign", "NewFolsomLockers", "MoebiusLabConsoles", "DOM_LabConsoles", "DOM_Crate", "Tarsonis_Guardrail"]));
    const placed = (placement: string) => Object.entries(facings.doodads).filter(([, f]) => f.placement === placement).map(([id]) => id).sort();
    expect(placed("wall-top")).toEqual(["HybridWallPillar2High", "Korhal_WallCap"]);
    expect(placed("wall-face")).toEqual(["BraxisAlphaMonitorBig", "CastanarLightboard", "Korhal_CorporateSignage", "SpaceCamera", "SpacePlatformSign", "UmojanLabAlarms", "UmojanLabMonitorWall"]);
    expect(getDoodadFacing("SpaceCamera")).toMatchObject({ standOff: 1.9, height: 2.2 });
    expect(getDoodadFacing("BraxisAlphaMonitorBig")).toMatchObject({ height: 3.7 });
    expect(getDoodadFacing("NewFolsomLockers")).toMatchObject({ standOff: 2.6 });
    expect(getDoodadFacing("DOM_LabWallScreens")).toMatchObject({ standOff: 5.1 });
    expect(getDoodadFacing("Korhal_WallCap")?.standOff).toBeUndefined();
    // Measured on Kept maps only, never on the strip: unknown.
    expect(getDoodadFacing("ZergWallDecorTwoHigh")).toBeUndefined();
    expect(getDoodadFacing("DOM_GroundTrims")).toBeUndefined();
  });

  it("turns a measured front to a facing, and an unmeasured doodad's rotation to it", () => {
    const south = (3 * Math.PI) / 2;
    expect(degrees(rotationToFace("NewFolsomLockers", south).rotation)).toBe(0);
    expect(degrees(rotationToFace("CompoundSewers_Tank", south).rotation)).toBe(90);
    expect(degrees(rotationToFace("DOM_LabWallScreens", south).rotation)).toBe(180);
    expect(rotationToFace("ZergWallDecorTwoHigh", south)).toEqual({ rotation: south });
    expect(rotationToFace("NewFolsomLockers", south).source).toBe("measured");
  });

  it("finds a composite's front from its measured members when they agree", () => {
    const recipe = (members: { type: string; yaw: number }[], front?: number) =>
      CompositeSchema.parse({ id: "bank", kind: "detail", style: "built", members: members.map((m, n) => ({ ...m, x: n, y: 0 })), ...(front === undefined ? {} : { front }) });
    // A console at yaw 0 faces south; screens at yaw 180 do too.
    expect(degrees(compositeFront(recipe([{ type: "DOM_LabConsoles", yaw: 0 }, { type: "DOM_LabWallScreens", yaw: Math.PI }]))!)).toBe(270);
    expect(compositeFront(recipe([{ type: "DOM_LabConsoles", yaw: 0 }, { type: "DOM_LabWallScreens", yaw: 0 }]))).toBeUndefined();
    expect(compositeFront(recipe([{ type: "ZergWallDecorTwoHigh", yaw: 0 }]))).toBeUndefined();
    expect(degrees(compositeFront(recipe([{ type: "ZergWallDecorTwoHigh", yaw: 0 }], 45))!)).toBe(45);
  });
});

describe("dressing with measured facings", () => {
  it("turns a member's front to its yaw", () => {
    const { doodads, warnings } = expand(room({ at: { x: 20, y: 20 }, anchor: [{ type: "CompoundSewers_Tank", yaw: 270 }], props: [{ type: "ZergWallDecorTwoHigh", yaw: 270, count: 1 }] }));
    expect(degrees(doodads.find((d) => d.type === "CompoundSewers_Tank")!.rotation)).toBe(90);
    expect(degrees(doodads.find((d) => d.type === "ZergWallDecorTwoHigh")!.rotation)).toBe(270);
    expect(warnings).toEqual([expect.stringMatching(/ZergWallDecorTwoHigh's front isn't measured .* yaw 270 is taken as its rotation/)]);
  });

  it("backs floor pieces onto the wall, front to the room, clear of the slope", () => {
    const { doodads, warnings, ground } = expand(room({ props: [{ type: "NewFolsomLockers", count: 3, against: "wall" }, { type: "CompoundSewers_Tank", count: 2, against: "wall" }, { type: "DOM_LabWallScreens", count: 1, against: "wall" }] }));
    expect(warnings).toEqual([]);
    const lockers = doodads.filter((d) => d.type === "NewFolsomLockers");
    expect(lockers).toHaveLength(3);
    for (const d of lockers) {
      expect(d.y).toBeCloseTo(40 - 2.6, 6);
      expect(degrees(d.rotation)).toBe(0);
      expect(d.z).toBeCloseTo(ground(d.x, d.y), 6);
    }
    for (const d of doodads.filter((x) => x.type === "CompoundSewers_Tank")) expect(degrees(d.rotation)).toBe(90);
    const screens = doodads.find((d) => d.type === "DOM_LabWallScreens")!;
    expect(screens.y).toBeCloseTo(40 - 5.1, 6);
    expect(degrees(screens.rotation)).toBe(180);
  });

  it("hangs a wall-face piece over the slope at its height", () => {
    const { doodads, ground } = expand(room({ props: [{ type: "SpacePlatformSign", count: 2, against: "wall" }, { type: "BraxisAlphaMonitorBig", count: 1, against: "wall" }] }));
    const signs = doodads.filter((d) => d.type === "SpacePlatformSign");
    expect(signs).toHaveLength(2);
    for (const d of signs) {
      expect(d.y).toBeCloseTo(40 - 1.9, 6);
      expect(d.z - ground(d.x, d.y)).toBeCloseTo(2.2, 6);
      expect(d.forcePlacement).toBe(true);
      expect(degrees(d.rotation)).toBe(0);
    }
    const monitor = doodads.find((d) => d.type === "BraxisAlphaMonitorBig")!;
    expect(monitor.z - ground(monitor.x, monitor.y)).toBeCloseTo(3.7, 6);
  });

  it("faces whichever way the wall faces", () => {
    // A wall rising east of x 40, facing west.
    const { doodads } = expand(room({ props: [{ type: "NewFolsomLockers", count: 2, against: "wall" }] }, { wall: rect(40, 0, 64, 64) }));
    for (const d of doodads.filter((x) => x.type === "NewFolsomLockers")) {
      expect(d.x).toBeCloseTo(40 - 2.6, 6);
      expect(degrees(d.rotation)).toBe(270);
    }
  });

  it("warns about a wall-top piece and an unmeasured one, and places the unmeasured one at the foot", () => {
    const { doodads, warnings } = expand(room({ props: [{ type: "Korhal_WallCap", count: 1, against: "wall" }, { type: "ZergWallDecorTwoHigh", count: 1, against: "wall" }] }));
    expect(doodads.filter((d) => d.type === "Korhal_WallCap")).toEqual([]);
    const decor = doodads.find((d) => d.type === "ZergWallDecorTwoHigh")!;
    expect(decor.y).toBeCloseTo(40 - 2.6, 6);
    expect(degrees(decor.rotation)).toBe(270);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Korhal_WallCap stands on a wall's top/),
        expect.stringMatching(/ZergWallDecorTwoHigh's front isn't measured .* stands at the wall's foot/),
        expect.stringMatching(/placed 0 of 1 Korhal_WallCap/),
      ]),
    );
  });

  it("backs a composite onto the wall by its front, each piece standing off as measured", () => {
    const composites = [
      {
        id: "bank",
        kind: "detail",
        style: "built",
        members: [
          { type: "DOM_LabConsoles", x: -1, y: 0, yaw: 0 },
          { type: "DOM_LabWallScreens", x: 1, y: 0, yaw: Math.PI },
        ],
      },
    ];
    const { doodads, warnings } = expand(room({ anchor: [{ composite: "bank", against: "wall" }] }, { composites }));
    expect(warnings).toEqual([]);
    const consoles = doodads.find((d) => d.type === "DOM_LabConsoles")!;
    const screens = doodads.find((d) => d.type === "DOM_LabWallScreens")!;
    // The screens need 5.1 cells, so the whole shape stands that far out, square to the wall.
    expect(screens.y).toBeCloseTo(40 - 5.1, 6);
    expect(consoles.y).toBeCloseTo(40 - 5.1, 6);
    expect(degrees(consoles.rotation)).toBe(0);
    expect(degrees(screens.rotation)).toBe(180);
    expect(Math.abs(screens.x - consoles.x)).toBeCloseTo(2, 6);
  });

  it("turns a composite's front to its yaw", () => {
    const composites = [{ id: "bank", kind: "detail", style: "built", members: [{ type: "DOM_LabConsoles", x: 0, y: 0, yaw: 0 }] }];
    const { doodads } = expand(room({ at: { x: 20, y: 20 }, anchor: [{ composite: "bank", yaw: 90 }] }, { composites }));
    expect(degrees(doodads.find((d) => d.type === "DOM_LabConsoles")!.rotation)).toBe(180);
  });

  it("says when no wall is in reach", () => {
    const { doodads, warnings } = expand(room({ at: { x: 20, y: 20 }, props: [{ type: "NewFolsomLockers", count: 1, against: "wall" }] }));
    expect(doodads.filter((d) => d.type === "NewFolsomLockers")).toEqual([]);
    expect(warnings).toEqual(expect.arrayContaining([expect.stringMatching(/no wall within its radius for NewFolsomLockers/)]));
  });

  it("refuses a member with both a yaw and against", () => {
    expect(() => StyleBlueprintSchema.parse(room({ props: [{ type: "NewFolsomLockers", yaw: 90, against: "wall" }] }))).toThrow(/yaw` or `against`/);
  });
});
