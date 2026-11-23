import { existsSync, readFileSync, symlinkSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { writeMapInfo } from "../../src/terrain/write-map-info.js";
import { readObjectsXml } from "../../src/map/read-objects-xml.js";
import { aggregatePlacement, findMapFolders, isVegetationName, mapFoldersUnder, nameSegments, formatPlacementStats, placementStatsFor, readPlacementRecord, type PlacementRecord } from "../../src/study/placement-stats.js";

const FIXTURE = path.resolve(import.meta.dirname, "../fixtures/editor-terrain/texture-sets");

const record = (map: string, tileset: string, playableCells: number, doodads: { type: string; texture?: string }[]): PlacementRecord => ({
  map,
  tileset,
  playableCells,
  hasTextures: doodads.some((doodad) => doodad.texture !== undefined),
  doodads,
});

describe("aggregatePlacement", () => {
  const trees = (n: number, texture?: string) => Array.from({ length: n }, () => ({ type: "OakTree", ...(texture ? { texture } : {}) }));
  const rocks = (n: number) => Array.from({ length: n }, () => ({ type: "BigRock" }));

  it("gives density over a tileset's maps together, and the lowest and highest map", () => {
    const stats = aggregatePlacement([record("a", "Grass", 1000, [...trees(10), ...rocks(10)]), record("b", "Grass", 3000, rocks(30))]);
    const grass = stats.tilesets[0]!;
    expect(grass).toMatchObject({ tileset: "Grass", maps: ["a", "b"], playableCells: 4000, doodads: 50, per1000Cells: 12.5, perMap: { low: 10, high: 20 } });
    expect(grass.topTypes[0]).toEqual({ type: "BigRock", count: 40, share: 0.8, per1000Cells: 10 });
    expect(grass.vegetation).toMatchObject({ count: 10, shareOfDoodads: 0.2, per1000Cells: 2.5, texturedMaps: 0, pairs: [] });
  });

  it("keeps tilesets apart", () => {
    const stats = aggregatePlacement([record("a", "Grass", 100, rocks(1)), record("b", "Snow", 100, rocks(3))]);
    expect(stats.tilesets.map((tileset) => [tileset.tileset, tileset.per1000Cells])).toEqual([["Grass", 10], ["Snow", 30]]);
  });

  it("pairs vegetation with the texture under it, only for types placed often enough", () => {
    const stats = aggregatePlacement([record("a", "Grass", 1000, [...trees(6, "Moss"), ...trees(2, "Dirt"), { type: "RareBush", texture: "Dirt" }])]);
    const { pairs, byTexture, texturedMaps } = stats.tilesets[0]!.vegetation;
    expect(texturedMaps).toBe(1);
    expect(pairs).toEqual([
      { type: "OakTree", texture: "Moss", count: 6, share: 0.75 },
      { type: "OakTree", texture: "Dirt", count: 2, share: 0.25 },
    ]);
    expect(byTexture[0]).toEqual({ texture: "Moss", count: 6, share: 0.667 });
  });

  it("takes a replacement vegetation rule", () => {
    const stats = aggregatePlacement([record("a", "Grass", 1000, rocks(4))], [], { isVegetation: (type) => type === "BigRock" });
    expect(stats.tilesets[0]!.vegetation.count).toBe(4);
  });

  it("writes tables, and says when no map has texture masks", () => {
    const text = formatPlacementStats(aggregatePlacement([record("a", "Grass", 1000, trees(3))], [{ map: "bad", reason: "no terrain" }]));
    expect(text).toContain("| Grass | 1 | 1000 | 3 | 3 |");
    expect(text).toContain("Skipped: bad (no terrain)");
    expect(text).toContain("none of these maps has texture masks");
  });
});

describe("vegetation by name", () => {
  it("matches plant words as whole segments", () => {
    for (const type of ["BelShirTree", "Aiur_Trees_Regular", "Elsecaro_Bush4x4", "PortCity_Garden_Plants", "Aiur_Plantlife", "SnowRefinery_Natural_Brambles", "MarSaraCactus", "Shakuras_SmallBrush", "Reeds_Large", "TarsonisGardenPlant"]) expect(isVegetationName(type), type).toBe(true);
  });

  it("does not take a plant word hidden inside another word, or a place name", () => {
    for (const type of ["Aiur_Rock_Cliff_Jungle", "AiurTempleJungle_Pillar", "Breed_Pit", "Seedling", "Rootless_Pillar", "Treadmill", "Forestry_Sign", "Brushed_Steel"]) expect(isVegetationName(type), type).toBe(false);
  });

  it("splits names at case changes, underscores and digits", () => {
    expect(nameSegments("Aiur_TreesRegular2")).toEqual(["aiur", "trees", "regular"]);
    expect(nameSegments("XMLTree")).toEqual(["xml", "tree"]);
  });
});

describe("reading map folders", () => {
  async function tinyMap(root: string, name: string, objects: string): Promise<string> {
    const dir = path.join(root, name);
    await mkdir(dir, { recursive: true });
    await copyFile(path.join(FIXTURE, "t3Terrain.xml"), path.join(dir, "t3Terrain.xml"));
    await writeFile(path.join(dir, "t3TextureMasks"), gunzipSync(await readFile(path.join(FIXTURE, "t3TextureMasks.gz"))));
    await writeFile(path.join(dir, "MapInfo"), writeMapInfo({ width: 128, height: 128, tilesetId: "BelShirEx1", fogType: "Dark", playableBounds: [8, 8, 120, 120], players: [] }));
    await writeFile(path.join(dir, "Objects"), `<?xml version="1.0" encoding="utf-8"?>\n<PlacedObjects Version="27">\n${objects}\n</PlacedObjects>\n`);
    return dir;
  }
  const tree = (id: number, x: number, y: number) => `  <ObjectDoodad Id="${id}" Position="${x},${y},8" Scale="1,1,1" Type="BelShirTree"/>`;

  it("reads a map's tileset, playable cells and the texture under each doodad", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "placement-"));
    const dir = await tinyMap(root, "tiny", [tree(1, 60.5, 50.5), tree(2, 15.5, 15.5)].join("\n"));
    const result = readPlacementRecord(dir);
    expect(result).toMatchObject({ map: "tiny", tileset: "BelShirEx1", playableCells: 112 * 112, hasTextures: true });
    expect(result.doodads).toHaveLength(2);
    expect(result.doodads.every((doodad) => doodad.type === "BelShirTree" && doodad.texture)).toBe(true);
    expect(result.doodads[0]!.texture).toMatch(/^CharDunes/); // inside the second texture set's blocks
    expect(result.doodads[1]!.texture).not.toMatch(/^CharDunes/);
  });

  it("reads doodads at the edge of the map and past it, clamped to the nearest cell", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "placement-"));
    const dir = await tinyMap(root, "edges", [tree(1, 0.1, 0.1), tree(2, 127.9, 127.9), tree(3, -5, 300), tree(4, 56.2, 48.2), tree(5, 79.8, 71.8)].join("\n"));
    const { doodads } = readPlacementRecord(dir);
    expect(doodads).toHaveLength(5);
    expect(doodads.every((doodad) => doodad.texture)).toBe(true);
    // The two inside the second set's blocks, at its corners, are on its textures; the far corners are not.
    expect(doodads[3]!.texture).toMatch(/^CharDunes/);
    expect(doodads[4]!.texture).toMatch(/^CharDunes/);
    expect(doodads[0]!.texture).not.toMatch(/^CharDunes/);
  });

  it("finds map folders under a root, and skips one it cannot read with the reason", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "placement-"));
    await tinyMap(root, "one", tree(1, 20.5, 20.5));
    const broken = await tinyMap(root, "two", tree(1, 20.5, 20.5));
    await writeFile(path.join(broken, "t3Terrain.xml"), "<not terrain/>");
    await mkdir(path.join(root, "not-a-map"));
    symlinkSync(path.join(root, "gone"), path.join(root, "dangling"));
    expect(findMapFolders(root).map((dir) => path.basename(dir))).toEqual(["one", "two"]);
    const stats = placementStatsFor(root);
    expect(stats.maps).toBe(1);
    expect(stats.skipped.map((entry) => entry.map).sort()).toEqual(["dangling", "two"]);
    expect(stats.skipped.find((entry) => entry.map === "dangling")!.reason).toContain("points nowhere");
    expect(mapFoldersUnder(root).dangling).toEqual(["dangling"]);
  });
});

// Blizzard's maps are not in the repo: point this at a folder of unpacked ones (each map a folder) to read them all.
const MAPS = process.env.SC2_PLACEMENT_MAPS;
describe.skipIf(!MAPS || !existsSync(MAPS))("a folder of real maps (SC2_PLACEMENT_MAPS)", () => {
  it("reads every map folder or says why not, and counts every doodad its Objects file places", () => {
    const stats = placementStatsFor(MAPS!);
    const { folders, dangling } = mapFoldersUnder(MAPS!);
    expect(stats.maps + stats.skipped.length).toBe(folders.length + dangling.length);
    expect(stats.maps).toBeGreaterThan(0);
    const skipped = new Set(stats.skipped.map((entry) => entry.map));
    const placed = folders.filter((dir) => !skipped.has(path.basename(dir))).reduce((sum, dir) => sum + readObjectsXml(readFileSync(path.join(dir, "Objects"), "utf8")).doodads.length, 0);
    expect(stats.tilesets.reduce((sum, tileset) => sum + tileset.doodads, 0)).toBe(placed);
  });
});
