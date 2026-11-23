import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { bundledDoodadFacings, DOODAD_FACINGS_PATH, getDoodadFacing } from "../../src/catalog/stock-catalog.js";
import { facingStripBlueprint, formatDoodadFacings, mergeFacings, readFacingStrip, STRIP_STAND_OFF } from "../../src/dressing/facing-strip.js";
import type { PlacedDoodad } from "../../src/map/read-objects-xml.js";
import { stableObjectId } from "../../src/map/stable-object-id.js";
import { rasterizeTerrain, terrainHeightAt } from "../../src/terrain/rasterize.js";
import { StyleBlueprintSchema } from "../support/workspaces.js";

const TYPES = ["NewFolsomLockers", "CompoundSewers_Tank", "SpacePlatformSign", "Korhal_WallCap", "DOM_LabWallScreens", "ZergWallDecorTwoHigh", "DOM_GroundTrims"];

describe("the facing strip", () => {
  const strip = StyleBlueprintSchema.parse(facingStripBlueprint(TYPES, { campaignId: "test" }));
  const terrain = rasterizeTerrain(strip);
  const ground = (x: number, y: number) => terrainHeightAt(terrain, strip.mapSize.width, x, y);
  const doodadAnchors = strip.anchors.filter((anchor) => anchor.kind === "doodad");

  it("stands one of each doodad at rotation 0 at the foot of a south-facing wall, over a point named for it", () => {
    expect(doodadAnchors.map((anchor) => anchor.doodadType)).toEqual(TYPES);
    const wall = strip.zones.find((zone) => zone.id === "wall-1")!;
    const edge = Math.min(...wall.polygon.map((p) => p.y));
    for (const anchor of doodadAnchors) {
      expect(anchor).toMatchObject({ rotation: 0, scale: 1 });
      expect(edge - anchor.position!.y).toBeCloseTo(STRIP_STAND_OFF, 9);
      const point = strip.anchors.find((other) => other.kind === "point" && other.name === anchor.doodadType)!;
      expect(point.position).toMatchObject({ x: anchor.position!.x, y: anchor.position!.y });
    }
    // The wall rises above the floor, and the floor at each doodad is level.
    const level = (x: number, y: number) => terrain.syncCliff[Math.floor(y) * strip.mapSize.width + Math.floor(x)]!;
    const [first] = doodadAnchors;
    expect(level(first!.position!.x, edge + 2)).toBeGreaterThan(level(first!.position!.x, first!.position!.y));
  });

  it("wraps onto more rows when one wall is full, and refuses more than a map holds", () => {
    const many = StyleBlueprintSchema.parse(facingStripBlueprint(Array.from({ length: 40 }, () => "DOM_Crate"), { campaignId: "test" }));
    expect(many.zones.filter((zone) => zone.id.startsWith("wall-"))).toHaveLength(2);
    expect(() => facingStripBlueprint(Array.from({ length: 400 }, () => "DOM_Crate"), { campaignId: "test" })).toThrow(/two strips/);
  });

  it("reads the author's saved rotations and moves back as fronts and placements", () => {
    const saved = (type: string, change: { dx?: number; dy?: number; up?: number; degrees?: number; flags?: string[] } = {}): PlacedDoodad => {
      const anchor = doodadAnchors.find((a) => a.doodadType === type)!;
      const x = anchor.position!.x + (change.dx ?? 0);
      const y = anchor.position!.y + (change.dy ?? 0);
      const heightOffset = change.flags?.includes("HeightOffset");
      return {
        id: stableObjectId(anchor.id),
        type,
        position: { x, y, z: heightOffset ? (change.up ?? 0) : ground(x, y) + (change.up ?? 0) },
        yaw: ((change.degrees ?? 0) * Math.PI) / 180,
        pitch: 0,
        roll: 0,
        scale: { x: 1, y: 1, z: 1 },
        flags: change.flags ?? [],
      };
    };
    const doodads = [
      saved("NewFolsomLockers"),
      saved("CompoundSewers_Tank", { degrees: 90 }),
      saved("SpacePlatformSign", { dy: 0.7, up: 2.2, flags: ["HeightOffset"] }),
      saved("Korhal_WallCap", { dy: STRIP_STAND_OFF + 0.8 }),
      saved("DOM_LabWallScreens", { dy: -2.5, degrees: 180 }),
      // Replaced by hand: a new Id, found as the nearest of its type.
      { ...saved("ZergWallDecorTwoHigh", { dx: 1, degrees: 270.02 }), id: 1 },
    ];
    const { readings, missing } = readFacingStrip(strip, doodads, ground, bundledDoodadFacings().placements);
    expect(missing).toEqual(["DOM_GroundTrims"]);
    expect(Object.fromEntries(readings.map((r) => [r.type, r.facing]))).toEqual({
      NewFolsomLockers: { front: 270, placement: "wall-foot" },
      CompoundSewers_Tank: { front: 180, placement: "wall-foot" },
      SpacePlatformSign: { front: 270, placement: "wall-face" },
      Korhal_WallCap: { front: 270, placement: "wall-top", standOff: -0.8 },
      DOM_LabWallScreens: { front: 90, placement: "wall-foot", standOff: 5.1 },
      ZergWallDecorTwoHigh: { front: 0, placement: "wall-foot" },
    });

    // Merged in, each replaces its entry, marked measured.
    const merged = mergeFacings(bundledDoodadFacings(), readings, "author, 2026-11-10, facing strip");
    expect(getDoodadFacing("ZergWallDecorTwoHigh", merged)).toEqual({ front: 0, placement: "wall-foot", standOff: 2.6, measured: "author, 2026-11-10, facing strip" });
    expect(getDoodadFacing("Korhal_WallCap", merged)?.standOff).toBe(-0.8);
    expect(Object.keys(merged.doodads)).toEqual([...Object.keys(merged.doodads)].sort());
  });

  it("writes doodad-facings.json in its own layout", () => {
    expect(formatDoodadFacings(bundledDoodadFacings())).toBe(readFileSync(DOODAD_FACINGS_PATH, "utf8"));
  });
});
