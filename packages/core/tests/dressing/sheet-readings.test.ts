import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { type DoodadFacings, type DoodadSheetReadings, DoodadSheetReadingsSchema, frontFromPictures, sheetPictureAzimuth } from "@team-antioch/sc2-asset-catalog/catalog/doodad-facings.js";
import { bundledDoodadFacings, bundledSheetReadings, compositeFrontFrom, DOODAD_SHEET_READINGS_PATH, getDoodadFront, rotationToFace, coreDoodadSources } from "../../src/catalog/stock-catalog.js";
import { formatSheetReadings, mergeSheetReadings, parseReaderLines, sheetCandidates, suggestedStandOff } from "../../src/catalog/sheet-readings.js";
import { searchDoodads } from "@team-antioch/sc2-asset-catalog/catalog/doodad-search.js";
import { CompositeSchema } from "../../src/domain/mission-blueprint.js";
import { expandDressing } from "../../src/dressing/expand-dressing.js";
import { rasterizeTerrain } from "../../src/terrain/rasterize.js";
import { StyleBlueprintSchema } from "../support/workspaces.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const degrees = (radians: number): number => Math.round(((((radians * 180) / Math.PI) % 360) + 360) % 360);
const SOUTH = (3 * Math.PI) / 2;

/** A 64×64 floor with a wall rising above y 40, facing south into the room. */
const room = (params: Record<string, unknown>, composites: unknown[] = []) =>
  StyleBlueprintSchema.parse({
    id: "sheets",
    campaignId: "test",
    title: "Sheets",
    setting: "test",
    mapSize: { width: 64, height: 64 },
    raggedCliffs: 0,
    tilesetId: "MarSara",
    zones: [
      { id: "floor", name: "Floor", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 64, 64) },
      { id: "wall", name: "Wall", elevation: 2, landform: "ridge", role: "path", polygon: rect(0, 40, 64, 64) },
    ],
    anchors: [],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    placements: [{ id: "bay", zoneId: "floor", kind: "set-piece", params: { story: "an armoury against the wall", at: { x: 32, y: 37 }, radius: 6, nestle: true, ...params } }],
    composites,
    screenplay: { title: "Sheets" },
  });
const expand = (blueprint: ReturnType<typeof room>) => expandDressing(blueprint, rasterizeTerrain(blueprint));

const facings: DoodadFacings = { about: "test", placements: { "wall-foot": { standOff: 2.6, about: "." }, "wall-face": { standOff: 1.9, height: 2.2, about: "." }, "wall-top": { about: "." }, free: { about: "." } }, doodads: { Measured: { front: 180, placement: "wall-foot", measured: "author" } } };
const read = "agent, 2026-11-11, catalog sheet";
const readings: DoodadSheetReadings = {
  about: "test",
  pictures: "test",
  doodads: {
    Measured: { faces: [0, 1], sure: true, read },
    Sure: { faces: [3, 0], sure: true, placement: "wall-foot", read },
    Doubtful: { faces: [2, 3], sure: false, placement: "free", read },
    Diagonal: { faces: [1], sure: true, placement: "wall-face", read },
    Frontless: { faces: [], sure: true, read },
  },
};

describe("reading fronts from the catalog's renders", () => {
  it("knows which way each picture looks, as calibrated against the author's measurements", () => {
    expect([0, 1, 2, 3].map(sheetPictureAzimuth)).toEqual([315, 225, 135, 45]);
    // A front measured south shows in a0 and a1; DOM_LabWallScreens' north in a2 and a3; ElectricConduitPathMedium's west in a1 and a2.
    expect(frontFromPictures([0, 1])).toBe(270);
    expect(frontFromPictures([2, 3])).toBe(90);
    expect(frontFromPictures([1, 2])).toBe(180);
    expect(frontFromPictures([3, 0])).toBe(0);
    expect(frontFromPictures([1])).toBe(225);
    expect(frontFromPictures([])).toBeUndefined();
  });

  it("takes a measurement first, then a sure reading two pictures agree on, and nothing else", () => {
    expect(getDoodadFront("Measured", facings, readings)).toEqual({ front: 180, source: "measured" });
    expect(getDoodadFront("Sure", facings, readings)).toEqual({ front: 0, source: "sheet" });
    expect(getDoodadFront("Doubtful", facings, readings)).toBeUndefined();
    expect(getDoodadFront("Diagonal", facings, readings)).toBeUndefined();
    expect(getDoodadFront("Frontless", facings, readings)).toBeUndefined();
    expect(rotationToFace("Sure", SOUTH, facings, readings)).toEqual({ rotation: SOUTH, source: "sheet" });
    expect(rotationToFace("Doubtful", SOUTH, facings, readings)).toEqual({ rotation: SOUTH });
  });

  it("names the members a composite's front was read for", () => {
    const recipe = (types: string[]) => CompositeSchema.parse({ id: "rack", kind: "detail", style: "built", members: types.map((type, n) => ({ type, x: n, y: 0, yaw: 0 })) });
    const mixed = compositeFrontFrom(recipe(["Sure", "Sure", "Doubtful"]), facings, readings);
    expect(degrees(mixed.front!)).toBe(0);
    expect(mixed.sheet).toEqual(["Sure"]);
    expect(compositeFrontFrom(recipe(["Sure", "Measured"]), facings, readings)).toEqual({ sheet: [] });
  });

  it("suggests a deep floor piece's stand-off from its bounds", () => {
    // The author's DOM_LabWallScreens, front 90: 4.63 deep behind its origin, measured at 5.1.
    expect(suggestedStandOff({ min: [-4.332, -4.635, -0.962], max: [4.332, -0.455, 3.604] }, 90, 2.6)).toBe(5.1);
    // SignsWarning, 0.08 deep: the default does.
    expect(suggestedStandOff({ min: [-0.297, -0.112, -0.05], max: [0.305, 0.077, 1.319] }, 270, 2.6)).toBeUndefined();
    // A culling cube says nothing about the shape.
    expect(suggestedStandOff({ min: [-4.094, -4.094, -3.45], max: [4.094, 4.094, 4.739] }, 270, 2.6)).toBeUndefined();
  });

  it("merges a reader's lines, leaving measured doodads alone", () => {
    const lines = parseReaderLines('{"id":"Measured","faces":[2,3],"sure":true}\n\n{"id":"Rack","faces":[2,3],"sure":true,"placement":"wall-foot","note":"open rack, solid back"}\n');
    const { readings: merged, skipped } = mergeSheetReadings(readings, lines, read, facings, { Rack: { min: [-1, -3.2, 0], max: [1, 1, 2] } });
    expect(skipped).toEqual(["Measured"]);
    expect(merged.doodads.Rack).toEqual({ faces: [2, 3], sure: true, placement: "wall-foot", standOff: 3.7, note: "open rack, solid back", read });
    expect(merged.doodads.Measured).toEqual(readings.doodads.Measured);
    // Merged again without its bounds, it keeps its suggestion; turned another way, it loses it.
    expect(mergeSheetReadings(merged, lines.slice(1), read, facings).readings.doodads.Rack?.standOff).toBe(3.7);
    expect(mergeSheetReadings(merged, [{ ...lines[1]!, faces: [0, 1] }], read, facings).readings.doodads.Rack?.standOff).toBeUndefined();
    expect(() => parseReaderLines('{"id":"Bad","faces":[0,2],"sure":true}')).toThrow(/line 1: .*side by side/);
    expect(() => parseReaderLines('{"faces":[],"sure":true}')).toThrow(/line 1: no id/);
  });

  it("picks the doodads worth reading", () => {
    const catalog = { Console: { kind: "other", description: { role: "prop" } }, Rock: { kind: "rock" }, Glow: { kind: "other", description: { role: "effect" } }, Copy: { kind: "other", sharesPicture: ["Console"] }, Unrendered: { kind: "other" }, Measured: { kind: "other" }, Sure: { kind: "other" } };
    expect(sheetCandidates(catalog, new Set(["Console", "Rock", "Glow", "Copy", "Measured", "Sure"]), facings, readings)).toEqual(["Console"]);
  });
});

describe("core's sheet readings (doodad-sheet-readings.json)", () => {
  const bundled = bundledSheetReadings();

  it("validates, is kept in its format, and reads no doodad the author measured", () => {
    const text = readFileSync(DOODAD_SHEET_READINGS_PATH, "utf8");
    expect(formatSheetReadings(DoodadSheetReadingsSchema.parse(JSON.parse(text)))).toBe(text);
    const measured = bundledDoodadFacings().doodads;
    expect(Object.keys(bundled.doodads).filter((id) => id in measured)).toEqual([]);
    const doodads = JSON.parse(readFileSync(new URL("../../data/doodads.json", import.meta.url), "utf8")) as Record<string, unknown>;
    expect(Object.keys(bundled.doodads).filter((id) => !(id in doodads))).toEqual([]);
  });

  it("holds the pass of 2026-11-11", () => {
    expect(Object.keys(bundled.doodads).length).toBeGreaterThan(1400);
    expect(bundled.doodads.XelNagaWall).toMatchObject({ faces: [2, 3], sure: true, placement: "wall-foot" });
    expect(getDoodadFront("SpaceGunRack")).toEqual({ front: 0, source: "sheet" });
    // The author's BraxisAlphaMonitorBig's model, read as a diagonal: a suggestion only.
    expect(getDoodadFront("SpacePlatformMonitor")).toBeUndefined();
  });
});

describe("dressing with sheet readings", () => {
  it("turns a sure sheet front to its yaw and names it in one warning", () => {
    const { doodads, warnings } = expand(room({ at: { x: 20, y: 20 }, anchor: [{ type: "SpaceGunRack", yaw: 270 }], props: [{ type: "XelNagaWall", yaw: 270, count: 2 }] }));
    expect(degrees(doodads.find((d) => d.type === "SpaceGunRack")!.rotation)).toBe(270);
    for (const d of doodads.filter((x) => x.type === "XelNagaWall")) expect(degrees(d.rotation)).toBe(180);
    const sheet = warnings.filter((w) => /read from catalog sheets/.test(w));
    expect(sheet).toEqual([expect.stringMatching(/^3 pieces turned by fronts read from catalog sheets, not measured: SpaceGunRack ×1, XelNagaWall ×2 /)]);
    expect(warnings.filter((w) => /isn't measured/.test(w))).toEqual([]);
  });

  it("leaves out of the count the pieces the author removed, turned or swapped by hand", () => {
    const edits = { "SpaceGunRack/0": { removed: true }, "XelNagaWall/0": { rotation: 1 } };
    const { warnings } = expand(room({ at: { x: 20, y: 20 }, anchor: [{ type: "SpaceGunRack", yaw: 270 }], props: [{ type: "XelNagaWall", yaw: 270, count: 2 }], edits }));
    expect(warnings.filter((w) => /read from catalog sheets/.test(w))).toEqual([expect.stringMatching(/^1 pieces turned by fronts read from catalog sheets, not measured: XelNagaWall ×1 /)]);
  });

  it("leaves a doubtful reading's yaw as its rotation, with the unmeasured warning", () => {
    const { doodads, warnings } = expand(room({ at: { x: 20, y: 20 }, anchor: [{ type: "Aiur_Temple_Statue", yaw: 90 }] }));
    expect(degrees(doodads.find((d) => d.type === "Aiur_Temple_Statue")!.rotation)).toBe(90);
    expect(warnings).toEqual([expect.stringMatching(/Aiur_Temple_Statue's front isn't measured .* or read for sure from its sheet/)]);
  });

  it("backs a sheet-read piece onto the wall as a floor piece at the default stand-off, whatever its sheet suggests", () => {
    const { doodads, warnings } = expand(room({ props: [{ type: "XelNagaWall", count: 1, against: "wall" }, { type: "CastanarMonitorWall", count: 1, against: "wall" }] }));
    const wall = doodads.find((d) => d.type === "XelNagaWall")!;
    // Its bounds suggest 4.1, but a suggestion doesn't place it.
    expect(wall.y).toBeCloseTo(40 - 2.6, 6);
    expect(degrees(wall.rotation)).toBe(180);
    const monitor = doodads.find((d) => d.type === "CastanarMonitorWall")!;
    expect(monitor.y).toBeCloseTo(40 - 2.6, 6);
    expect(degrees(monitor.rotation)).toBe(0);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/CastanarMonitorWall's sheet suggests it hangs on the wall's face, but its placement isn't measured/),
        expect.stringMatching(/2 pieces turned by fronts read from catalog sheets/),
      ]),
    );
  });

  it("turns a composite by its members' sheet fronts and counts its pieces", () => {
    const composites = [{ id: "armoury", kind: "detail", style: "built", members: [{ type: "SpaceGunRack", x: -1, y: 0, yaw: 0 }, { type: "SpaceGunRack", x: 1, y: 0, yaw: 0 }] }];
    const { doodads, warnings } = expand(room({ at: { x: 20, y: 20 }, anchor: [{ composite: "armoury", yaw: 270 }] }, composites));
    for (const d of doodads.filter((x) => x.type === "SpaceGunRack")) expect(degrees(d.rotation)).toBe(270);
    expect(warnings).toEqual([expect.stringMatching(/^2 pieces turned by fronts read from catalog sheets, not measured: SpaceGunRack ×2 /)]);
  });
});

describe("search_doodads with sheet readings", () => {
  it("gives a sheet reading's front as read, with its placement as a suggestion", () => {
    const { results } = searchDoodads({ words: ["gun", "rack"] }, coreDoodadSources());
    expect(results.find((r) => r.id === "SpaceGunRack")?.facing).toEqual({ front: 0, placement: "wall-foot", source: "sheet", sure: true });
    const monitor = searchDoodads({ words: ["SpacePlatformMonitor"] }, coreDoodadSources()).results.find((r) => r.id === "SpacePlatformMonitor");
    expect(monitor?.facing).toEqual({ front: 225, placement: "wall-face", source: "sheet", sure: true, diagonal: true });
    const lockers = searchDoodads({ words: ["NewFolsomLockers"] }, coreDoodadSources()).results.find((r) => r.id === "NewFolsomLockers");
    expect(lockers?.facing).toMatchObject({ front: 270, source: "measured" });
  });
});
