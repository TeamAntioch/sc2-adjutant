import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { getTerrainObject, type TerrainObject } from "../../src/catalog/terrain-objects.js";
import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { rasterizeTerrain } from "../../src/terrain/rasterize.js";
import { readT3HeightMap } from "../../src/terrain/read-t3-height-map.js";
import { readT3SyncCliffLevel } from "../../src/terrain/read-t3-sync-cliff-level.js";
import { placeTerrainObjects, stampVertices, terrainObjectWarnings } from "../../src/terrain/terrain-objects.js";
import { writeT3TerrainXml } from "../../src/terrain/write-t3-terrain-xml.js";

// Terrain objects placed by hand in the Editor on our generated terrain-objects map; the fixture
// blueprints ask for the same placements (see the fixture README).
const FIXTURE = "../fixtures/editor-terrain/terrain-objects";
const SIZE = 128;
const fixture = (name: string): Promise<Buffer> => readFile(new URL(`${FIXTURE}/${name}`, import.meta.url));
const load = async (name: string) => MissionBlueprintSchema.parse(JSON.parse((await fixture(name)).toString("utf8")));

const blueprint = await load("blueprint.json");
const terrain = rasterizeTerrain(blueprint);
const editorXml = (await fixture("t3Terrain.xml")).toString("utf8");
const editorLevels = readT3HeightMap(await fixture("t3HeightMap")).cliffLevels;

// Within 10 vertices of an object; elsewhere the Editor's save also differs from our compiler
// beside the plateau ramp, which has nothing to do with terrain objects.
const nearObject = (x: number, y: number): boolean =>
  terrain.terrainObjects.some((object) => Math.abs(object.x - x) <= 10 && Math.abs(object.y - y) <= 10);

describe("terrain objects against the Editor's", () => {
  it("writes the same cliffDoodadList", () => {
    const xml = writeT3TerrainXml({ catalog: EMPTY_CATALOG, tilesetId: "Castanar", width: SIZE, height: SIZE, textureSetIndex: 0, terrainObjects: terrain.terrainObjects });
    const list = (text: string): string[] => [...text.matchAll(/<cliffDoodad [^>]*>/g)].map((match) => match[0]);
    expect(list(xml)).toEqual(list(editorXml));
  });

  it("stamps the same vertex cliff levels", () => {
    const mismatches: string[] = [];
    for (let vy = 0; vy <= SIZE; vy++) {
      for (let vx = 0; vx <= SIZE; vx++) {
        const i = vy * (SIZE + 1) + vx;
        if (nearObject(vx, vy) && terrain.vertexCliffLevels[i] !== editorLevels[i]) mismatches.push(`(${vx},${vy})`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("writes the same cell flags, and sync levels short only of the Editor's flares at the bridge ends", async () => {
    const sync = readT3SyncCliffLevel(await fixture("t3SyncCliffLevel")).syncCliff;
    const flags = await fixture("t3CellFlags");
    const mismatches: string[] = [];
    // The Editor widens each bridge deck diagonally at its ends, following the model: those cells
    // are a level higher than ours, 8 per bridge. Every other sync level matches.
    const flares: number[] = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x;
        if (!nearObject(x, y)) continue;
        if (flags[flags.length - SIZE * SIZE + i] !== terrain.cellFlags[i]) mismatches.push(`flags (${x},${y})`);
        if (sync[i] === terrain.syncCliff[i]) continue;
        flares.push(sync[i]! - terrain.syncCliff[i]!);
      }
    }
    expect(mismatches).toEqual([]);
    expect(flares.length).toBeLessThanOrEqual(16);
    expect(flares.every((difference) => difference === 64)).toBe(true);
  });

  it("marks the same cliff cells, apart from the Editor's bit-4 ring around each object", () => {
    const editor = new Map([...editorXml.matchAll(/<cc i="(\d+)" f="(\d+)"/g)].map((match) => [Number(match[1]), Number(match[2]) & ~4]));
    const ours = new Map(terrain.cliffCells.map((cell) => [cell.index, cell.flags & ~4]));
    const near = (index: number): boolean => nearObject((index % 64) * 2, Math.floor(index / 64) * 2);
    const pick = (cells: Map<number, number>): [number, number][] => [...cells].filter(([index, flags]) => near(index) && flags !== 0).sort(([a], [b]) => a - b);
    expect(pick(ours)).toEqual(pick(editor));
  });

  it("turns a stamp a quarter anticlockwise per rot, as the Editor does", async () => {
    const rotation = rasterizeTerrain(await load("rotation/blueprint.json"));
    const levels = readT3HeightMap(await fixture("rotation/t3HeightMap")).cliffLevels;
    for (const object of rotation.terrainObjects) {
      const off = object.stamp.filter((vertex) => levels[vertex.y * (SIZE + 1) + vertex.x] !== vertex.level);
      expect(off, `rot ${object.rotation}`).toEqual([]);
    }
  });

  it("reads a stamp's rows west to east, as the Editor does", async () => {
    // An asymmetric stamp: mirrored, 148 of its 195 vertices would be wrong.
    const xml = (await fixture("row-direction/t3Terrain.xml")).toString("utf8");
    const [, type, x, y, rot] = xml.match(/<cliffDoodad name="([^"]+)" pos="([\d.]+) ([\d.]+) [^"]*" rot="(\d)"/)!;
    expect(type).toBe("TerrainObjectCastanarBridgeD14x12");
    const levels = readT3HeightMap(await fixture("row-direction/t3HeightMap")).cliffLevels;
    const stamp = stampVertices(getTerrainObject(type!)!, Number(x), Number(y), Number(rot));
    expect(stamp.filter((vertex) => levels[vertex.y * (SIZE + 1) + vertex.x] !== vertex.level)).toEqual([]);
  });
});

describe("terrain object stamps", () => {
  // North row "BA", south row "AA": a level-1 vertex in the north-west corner.
  const corner: TerrainObject = { package: "", model: "", tileset: "", size: { across: 3, down: 3 }, levels: [0, 1], heightCodes: ["BAA", "AAA", "A A"] };
  const high = (rotation: number) => stampVertices(corner, 10, 10, rotation).filter((vertex) => vertex.level === 1).map(({ x, y }) => [x, y]);

  it("reads row 0 as the north edge, west to east, and skips spaces", () => {
    expect(high(0)).toEqual([[9, 11]]);
    expect(stampVertices(corner, 10, 10, 0)).toHaveLength(8);
  });

  it("moves north to west with each turn", () => {
    expect(high(1)).toEqual([[9, 9]]);
    expect(high(2)).toEqual([[11, 9]]);
    expect(high(3)).toEqual([[11, 11]]);
  });

  it("warns when the corners on a stamp's edge don't meet the ground", () => {
    // Centred on (11,11), the stamp's edge corners are (10,10), (12,10), (10,12) and (12,12).
    const placed = [{ id: "pit", type: "Test", x: 11, y: 11, z: -8, rotation: 0, stamp: stampVertices(corner, 11, 11, 0) }];
    expect(terrainObjectWarnings(placed, new Uint8Array(21 * 21).fill(1), 20)).toEqual([expect.stringMatching(/pit .* at 3 of the 4 corners on its edge/)]);
    expect(terrainObjectWarnings(placed, new Uint8Array(21 * 21), 20)).toEqual([expect.stringMatching(/at 1 of the 4/)]);
  });

  it("refuses a stamp whose edges miss the cliff grid", () => {
    const at = (x: number, y: number) =>
      MissionBlueprintSchema.parse({ ...blueprint, terrainObjects: [{ id: "bridge", type: "TerrainObjectCastanarBridge6x10", at: { x, y } }] });
    expect(() => placeTerrainObjects(at(67, 64))).toThrow(/miss the 2×2 cliff grid.*\(67, 63\)/);
    expect(placeTerrainObjects(at(67, 63))[0]!.stamp).toHaveLength(77);
  });
});
