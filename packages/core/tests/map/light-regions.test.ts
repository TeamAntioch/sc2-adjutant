import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getStockLight } from "../../src/catalog/light-catalog.js";
import { fingerprint } from "../../src/domain/compile-record.js";
import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { editorChanges } from "../../src/map/editor-changes.js";
import { cellRegionWeights, LIGHTING_MAP, lightingMapTga, lightRegionOverride, lightRegionWarnings, regionFields, withTgaFooter } from "../../src/map/light-regions.js";
import { buildMissionGameData } from "../../src/triggers/build-mission-triggers.js";

// terrain-test: BelShirEx2. Its Zones are replaced by a backdrop over the whole map and two
// walkable Zones with 8 cells of rock between them: `west` (x 0-16) and `east` (x 24-32).
const raw = JSON.parse(await readFile(new URL("../fixtures/terrain-test/blueprint.json", import.meta.url), "utf8")) as Record<string, unknown>;
const square = (x0: number, x1: number) => [
  { x: x0, y: 0 },
  { x: x1, y: 0 },
  { x: x1, y: 32 },
  { x: x0, y: 32 },
];
const zone = (id: string, polygon: { x: number; y: number }[], extra: Record<string, unknown> = {}) => ({ id, name: id, elevation: 1, landform: "flat", role: "path", polygon, ...extra });
const parse = (options: { west?: unknown; east?: unknown; rock?: unknown; extra?: Record<string, unknown> } = {}) =>
  MissionBlueprintSchema.parse({
    ...raw,
    mapSize: { width: 32, height: 32 },
    ramps: [],
    anchors: [],
    beats: [{ id: "look", title: "Look", summary: "Look.", zoneIds: ["west"], anchorIds: [] }],
    zones: [
      zone("rock", square(0, 32), { elevation: 3, backdrop: true, ...(options.rock !== undefined ? { lightRegion: options.rock } : {}) }),
      zone("west", square(0, 16), options.west !== undefined ? { lightRegion: options.west } : {}),
      zone("east", square(24, 32), options.east !== undefined ? { lightRegion: options.east } : {}),
    ],
    lightRegions: { regions: { "2": { from: "StarshipDark" } } },
    ...options.extra,
  });

/** The mask's pixel at cell-space pixel (px, py), py from the south: its weights as regions 1-4. */
function pixel(tga: Buffer, px: number, py: number): [number, number, number, number] {
  const width = tga.readUInt16LE(12);
  const height = tga.readUInt16LE(14);
  const at = 18 + ((height - 1 - py) * width + px) * 4;
  return [tga[at + 2]!, tga[at + 1]!, tga[at]!, tga[at + 3]!];
}

describe("lighting regions", () => {
  it("paints each cell with its nearest walkable Zone's region, splitting the rock between", () => {
    const weights = cellRegionWeights(parse({ east: 2 }));
    const at = (x: number, y: number) => [...weights.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
    expect(at(2, 5)).toEqual([1, 0, 0, 0]);
    expect(at(19, 5)).toEqual([1, 0, 0, 0]);
    expect(at(20, 5)).toEqual([0, 1, 0, 0]);
    expect(at(30, 5)).toEqual([0, 1, 0, 0]);
  });

  it("mixes a Zone's listed regions in equal shares", () => {
    const weights = cellRegionWeights(parse({ east: [1, 2], extra: { lightRegions: { regions: { "2": {}, "3": {} } } } }));
    expect([...weights.subarray((5 * 32 + 30) * 4, (5 * 32 + 30) * 4 + 4)]).toEqual([0.5, 0.5, 0, 0]);
  });

  it("writes the mask as the Editor saves it: 4 px a cell, 32-bit BGRA, top-left origin, a TGA 2.0 footer", () => {
    const tga = lightingMapTga(parse({ east: 2, extra: { lightRegions: { regions: { "2": {} }, blend: 0 } } }))!;
    expect([...tga.subarray(0, 18)]).toEqual([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 128, 0, 128, 0, 32, 0x28]);
    expect(tga.length).toBe(18 + 128 * 128 * 4 + 26);
    expect(tga.subarray(tga.length - 18).toString("ascii")).toBe("TRUEVISION-XFILE.\0");
    // R is region 1, G region 2; hard edges with blend 0, at cell 20 (pixel 80).
    expect(pixel(tga, 10, 10)).toEqual([255, 0, 0, 0]);
    expect(pixel(tga, 79, 10)).toEqual([255, 0, 0, 0]);
    expect(pixel(tga, 80, 10)).toEqual([0, 255, 0, 0]);
  });

  it("puts the map's north edge on the image's top row", () => {
    const blueprint = MissionBlueprintSchema.parse({
      ...raw,
      mapSize: { width: 32, height: 32 },
      ramps: [],
      anchors: [],
      beats: [{ id: "look", title: "Look", summary: "Look.", zoneIds: ["south"], anchorIds: [] }],
      zones: [zone("south", [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 32, y: 16 }, { x: 0, y: 16 }]), zone("north", [{ x: 0, y: 16 }, { x: 32, y: 16 }, { x: 32, y: 32 }, { x: 0, y: 32 }], { lightRegion: 4 })],
      lightRegions: { regions: { "4": {} }, blend: 0 },
    });
    const tga = lightingMapTga(blueprint)!;
    // The first stored row is the north edge, region 4 (alpha).
    expect([tga[18 + 2], tga[18 + 3]]).toEqual([0, 255]);
    expect([tga[tga.length - 26 - 4 + 2], tga[tga.length - 26 - 1]]).toEqual([255, 0]);
  });

  it("blends an edge over about `blend` cells, every pixel adding to 255", () => {
    const tga = lightingMapTga(parse({ east: 2 }))!;
    // Middle of the rock (cell 20): about half and half; 4 cells either side, mostly one region.
    const [r, g] = pixel(tga, 80, 64);
    expect(Math.abs(r - g)).toBeLessThan(20);
    expect(pixel(tga, 64, 64)[0]).toBeGreaterThan(225);
    expect(pixel(tga, 96, 64)[1]).toBeGreaterThan(225);
    for (let px = 0; px < 128; px += 7) {
      const weights = pixel(tga, px, 64);
      expect(weights.reduce((sum, weight) => sum + weight, 0)).toBe(255);
    }
  });

  it("writes no mask when no walkable Zone is painted with a declared region", () => {
    expect(lightingMapTga(parse())).toBeUndefined();
    expect(lightingMapTga(parse({ rock: 2 }))).toBeUndefined();
    expect(lightingMapTga(parse({ east: 3 }))).toBeUndefined();
    expect(buildMissionGameData(parse())["LightData.xml"]).toBeUndefined();
  });

  it("copies a region's ambient and directional colours from its `from`, knobs turned", () => {
    const dark = getStockLight("StarshipDark")!.fields;
    const base = getStockLight("BelShirSunset")!.fields;
    const fields = regionFields({ ambient: { scale: 0.5 }, key: { scale: 2 } }, dark, base, [0.2, 0.4, 0.6]);
    const ambient = dark["ToDInfoArray/0/AmbientColor"]!.split(",").map((c) => (Number(c) * 0.5).toFixed(6)).join(",");
    expect(fields.UseDefault).toBe("0");
    expect(fields.AmbientColor).toBe(ambient);
    expect(fields["DiffuseColor/Key"]).toBe(dark["ToDInfoArray/0/DirectionalLight/Key/Color"]);
    expect(fields["DiffuseMultiplier/Key"]).toBe((Number(dark["ToDInfoArray/0/DirectionalLight/Key/ColorMultiplier"] ?? 1) * 2).toFixed(6));
    expect(fields["DiffuseColor/Back"]).toBe(dark["ToDInfoArray/0/DirectionalLight/Back/Color"]);
    // Environment and fog dim as the ambient does against the base Light's.
    const environment = Number(fields.AmbientEnvironmentMultiplier);
    expect(environment).toBeGreaterThan(0);
    expect(environment).toBeLessThan(1);
    expect(fields.FogColor).toBe([0.2, 0.4, 0.6].map((c) => (c * environment).toFixed(6)).join(","));
  });

  it("dims the base Light's own environment multiplier, not 1, when it has one", () => {
    const base = { ...getStockLight("BelShirSunset")!.fields, "ToDInfoArray/0/AmbientEnvironmentMultiplier": "0.400000" };
    expect(regionFields({}, base, base, undefined).AmbientEnvironmentMultiplier).toBe("0.400000");
    expect(regionFields({ ambient: { scale: 0.5 } }, base, base, undefined).AmbientEnvironmentMultiplier).toBe("0.200000");
  });

  it("takes a region's own specular, environment and fog", () => {
    const base = getStockLight("BelShirSunset")!.fields;
    const fields = regionFields({ specular: { color: [1, 0, 0], scale: 0.5 }, environment: 0.25, fog: [0.1, 0.1, 0.1] }, base, base, undefined);
    expect(fields.SpecularColor).toBe("1.000000,0.000000,0.000000");
    // BelShirSunset's key: multiplier 1, specular multiplier 1.25.
    expect(fields.SpecularMultiplier).toBe("0.625000");
    expect(fields.AmbientEnvironmentMultiplier).toBe("0.250000");
    expect(fields.FogColor).toBe("0.100000,0.100000,0.100000");
  });

  it("writes the regions as a map-local override of a stock Light holding only them", () => {
    const xml = buildMissionGameData(parse({ east: 2, extra: { lighting: "BelShirSunset" } }))["LightData.xml"]!;
    const light = /<CLight id="BelShirSunset">[^]*?<\/CLight>/.exec(xml)![0];
    expect(light).toContain('<LightRegions index="1">');
    expect(light).toContain('<DiffuseColor index="Key" value=');
    expect(light).not.toContain("HDRExposure");
    expect(light).not.toContain('<LightRegions index="2">');
  });

  it("writes the regions into the Blueprint's own Light when `lighting` is one of `lights`", () => {
    const blueprint = parse({ east: 2, extra: { lighting: "Dusk", lights: [{ id: "Dusk", from: "BelShirSunset", exposure: 1.2 }] } });
    const xml = buildMissionGameData(blueprint)["LightData.xml"]!;
    expect(xml.match(/<CLight /g)).toHaveLength(1);
    const light = /<CLight id="Dusk">[^]*?<\/CLight>/.exec(xml)![0];
    expect(light).toContain('<Param index="HDRExposure" value="1.200000"/>');
    expect(light).toContain('<LightRegions index="1">');
    expect(lightRegionOverride(blueprint)!.light).toBe("Dusk");
  });

  it("holds the regions in the tileset's Light when the Blueprint has no `lighting`", () => {
    expect(lightRegionOverride(parse({ east: 2 }))!.light).toBe("BelShirEx2");
  });

  it("warns of a region no one declares, one no Zone paints, a backdrop's, an unknown `from` and a Light switch", () => {
    const blueprint = parse({
      west: 3,
      east: 2,
      rock: 2,
      extra: {
        lighting: "BelShirSunset",
        lightRegions: { regions: { "2": { from: "NoSuchLight" }, "4": {} } },
        transitions: [{ id: "night", cue: { type: "missionStart" }, light: { to: "StarshipDark" } }],
      },
    });
    expect(lightRegionWarnings(blueprint)).toEqual([
      "Zone rock is a backdrop: its lightRegion isn't painted, and it takes its nearest walkable Zone's.",
      "Zone west names lighting region 3, which lightRegions.regions doesn't declare: it's painted as region 1.",
      "Lighting region 4 is declared, but no walkable Zone names it in its lightRegion.",
      "Lighting region 2 copies NoSuchLight, which is none of lights, a Plugin's Lights or data/light-catalog.json: it's written as BelShirSunset until that's fixed.",
      "A transition switches to Light StarshipDark, which holds no lighting regions: they're BelShirSunset's, and don't show while StarshipDark is on.",
    ]);
    expect(lightRegionWarnings(parse({ east: 2 }))).toEqual([]);
    expect(lightRegionWarnings(parse({ extra: { lightRegions: undefined } }))).toEqual([]);
  });

  it("refuses a region a light doesn't have per region, and a Zone region out of range", () => {
    expect(() => parse({ extra: { lightRegions: { regions: { "2": { exposure: 1 } } } } })).toThrow();
    expect(() => parse({ extra: { lightRegions: { regions: { "2": { key: { direction: [0, 0, -1] } } } } } })).toThrow();
    expect(() => parse({ extra: { lightRegions: { regions: { "1": {} } } } })).toThrow();
    expect(() => parse({ east: 5 })).toThrow();
    expect(() => parse({ east: [2, 2] })).toThrow();
  });
});

describe("the lighting mask and the Editor", () => {
  it("adds the TGA 2.0 footer only when it's missing", () => {
    const tga = lightingMapTga(parse({ east: 2 }))!;
    expect(withTgaFooter(tga)).toBe(tga);
    expect(withTgaFooter(tga.subarray(0, tga.length - 26)).equals(tga)).toBe(true);
  });

  it("isn't an Editor change when saved without its footer, and is when repainted", async () => {
    const tga = lightingMapTga(parse({ east: 2 }))!;
    const root = await mkdtemp(path.join(os.tmpdir(), "light-regions-"));
    const record = { version: 1, entries: [{ kind: "file", path: LIGHTING_MAP, fingerprint: fingerprint(tga) }] } as never;
    const fresh = (file: string) => (file === LIGHTING_MAP ? tga : undefined);
    await writeFile(path.join(root, LIGHTING_MAP), tga.subarray(0, tga.length - 26));
    expect(await editorChanges(root, record, fresh)).toEqual([]);
    const repainted = Buffer.from(tga);
    repainted[18 + 3] = 255;
    repainted[18 + 2] = 0;
    await writeFile(path.join(root, LIGHTING_MAP), repainted);
    expect((await editorChanges(root, record, fresh)).map((change) => change.name)).toEqual([`file:${LIGHTING_MAP}`]);
  });
});
