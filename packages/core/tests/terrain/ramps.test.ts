import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { rasterizeTerrain } from "../../src/terrain/rasterize.js";
import { writeT3TerrainXml } from "../../src/terrain/write-t3-terrain-xml.js";
import { HEIGHT_QUANTIZE_BIAS } from "../../src/terrain/write-t3-height-map.js";

// The Editor added ramps by hand to our generated terrain-test map at the centre of
// Low Plateau's west and south edges; the blueprint now asks for the same two ramps.
const FIXTURE = "../fixtures/editor-terrain/ramps";
const SIZE = 128;
const fixture = (name: string): Promise<Buffer> => readFile(new URL(`${FIXTURE}/${name}`, import.meta.url));
const blueprint = MissionBlueprintSchema.parse(
  JSON.parse(await readFile(new URL("../fixtures/terrain-test/blueprint.json", import.meta.url), "utf8")),
);
const terrain = rasterizeTerrain(blueprint);

const editorXml = (await fixture("t3Terrain.xml")).toString("utf8");
const editorHeightMap = await fixture("t3HeightMap");
const scale = Number(/quantizeScale="([^"]+)"/.exec(editorXml)![1]);
const bias = Number(/quantizeBias="([^"]+)"/.exec(editorXml)![1]);

// The two straight ramps' footprints (cells x 16..19 × y 24..31 and x 24..31 × y 16..19) with a margin.
const nearStraightRamps = (x: number, y: number): boolean =>
  (x >= 14 && x <= 22 && y >= 22 && y <= 34) || (x >= 22 && x <= 34 && y >= 14 && y <= 22);

describe("ramps against the Editor's", () => {
  it("writes the same cliff heights and levels around both ramps", () => {
    const mismatches: string[] = [];
    for (let vy = 0; vy <= SIZE; vy++) {
      for (let vx = 0; vx <= SIZE; vx++) {
        if (!nearStraightRamps(vx, vy)) continue;
        const offset = 32 + (vy * (SIZE + 1) + vx) * 6;
        const r1 = editorHeightMap.readUInt16LE(offset + 2) * scale - bias;
        const r2 = editorHeightMap.readUInt16LE(offset + 4);
        const index = vy * (SIZE + 1) + vx;
        if (Math.abs(terrain.cliffHeights[index]! - r1) > 0.01 || terrain.vertexCliffLevels[index] !== r2) {
          mismatches.push(`(${vx},${vy}) ours ${terrain.vertexCliffLevels[index]}:${terrain.cliffHeights[index]} editor ${r2}:${r1.toFixed(2)}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(HEIGHT_QUANTIZE_BIAS).toBeGreaterThan(8);
  });

  it("writes the same sync cliff levels and cell flags", async () => {
    const sync = await fixture("t3SyncCliffLevel");
    const flags = await fixture("t3CellFlags");
    const mismatches: string[] = [];
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (!nearStraightRamps(x, y)) continue;
        const i = y * SIZE + x;
        if (sync.readUInt16LE(32 + i * 2) !== terrain.syncCliff[i]) mismatches.push(`sync (${x},${y})`);
        if (flags[flags.length - SIZE * SIZE + i] !== terrain.cellFlags[i]) mismatches.push(`flags (${x},${y})`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("marks the same cliff cells as ramp cells", () => {
    const editorFlags = new Map(
      [...editorXml.matchAll(/<cc i="(\d+)" f="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])] as const),
    );
    const near = (index: number): boolean => nearStraightRamps((index % 64) * 2, Math.floor(index / 64) * 2);
    const ours = terrain.cliffCells.filter((cell) => near(cell.index)).map((cell) => [cell.index, cell.flags]);
    const editor = [...editorFlags].filter(([index]) => near(index)).sort(([a], [b]) => a - b);
    expect(ours).toEqual(editor);
  });

  it("writes the same <ramp> elements, apart from the unused leftHi/rightHi offsets", () => {
    const xml = writeT3TerrainXml({ catalog: EMPTY_CATALOG, tilesetId: "BelShirEx2", width: SIZE, height: SIZE, textureSetIndex: 0, cliffCells: terrain.cliffCells, ramps: terrain.ramps });
    const normalise = (ramp: string): string => ramp.replace(/ (leftHi|rightHi)="[^"]*"/g, "");
    // Only the two Editor-placed ramps on Low Plateau (mid centres within x, y < 40).
    const onLowPlateau = (ramp: string): boolean => {
      const [, x, y] = / mid="[^"]*c=\(([-\d.e+]+), ([-\d.e+]+)\)/.exec(ramp)!;
      return Number(x) < 40 && Number(y) < 40;
    };
    const ramps = (text: string): string[] =>
      [...text.matchAll(/<ramp dir="[13]"[^>]*\/>/g)].map((m) => normalise(m[0])).filter(onLowPlateau).sort();
    expect(ramps(editorXml)).toHaveLength(2);
    expect(ramps(xml)).toEqual(ramps(editorXml));
  });

  describe("the diagonal ramp on the Octagon", () => {
    // A ramp connection at the Editor's ramp (base (92,56), uphill north-east), without our
    // own west ramp on the Octagon so the connection isn't overruled.
    const diagonal = rasterizeTerrain(
      MissionBlueprintSchema.parse({
        ...blueprint,
        ramps: blueprint.ramps.filter((ramp) => ramp.zoneId !== "octagon"),
        zones: blueprint.zones.map((zone) =>
          zone.id === "octagon" ? { ...zone, connections: [{ toZoneId: "field", type: "ramp", at: { x: 92, y: 56 } }] } : zone,
        ),
      }),
    );
    // Its footprint (cells x 86..93 × y 50..58) with a margin.
    const nearDiagonal = (x: number, y: number): boolean => x >= 82 && x <= 100 && y >= 44 && y <= 64;

    it("is placed where the Editor put it, without moving ground", () => {
      expect(diagonal.ramps).toContainEqual({ id: "octagon-field", direction: 7, edge: { x: 92, y: 56 }, lowLevel: 1 });
      expect(diagonal.vertexCliffLevels).toEqual(terrain.vertexCliffLevels);
    });

    it("writes the same cliff heights, sync cliff levels, cell flags and ramp cliff cells", async () => {
      const sync = await fixture("t3SyncCliffLevel");
      const flags = await fixture("t3CellFlags");
      const editorFlags = new Map([...editorXml.matchAll(/<cc i="(\d+)" f="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])] as const));
      const ourFlags = new Map(diagonal.cliffCells.map((cell) => [cell.index, cell.flags]));
      const mismatches: string[] = [];
      for (let y = 0; y <= SIZE; y++) {
        for (let x = 0; x <= SIZE; x++) {
          if (!nearDiagonal(x, y)) continue;
          const v = y * (SIZE + 1) + x;
          const r1 = editorHeightMap.readUInt16LE(32 + v * 6 + 2) * scale - bias;
          if (Math.abs(diagonal.cliffHeights[v]! - r1) > 0.01) mismatches.push(`height (${x},${y})`);
          if (x === SIZE || y === SIZE) continue;
          const i = y * SIZE + x;
          if (sync.readUInt16LE(32 + i * 2) !== diagonal.syncCliff[i]) mismatches.push(`sync (${x},${y})`);
          if (flags[flags.length - SIZE * SIZE + i] !== diagonal.cellFlags[i]) mismatches.push(`flags (${x},${y})`);
          const cliff = (y >> 1) * (SIZE / 2) + (x >> 1);
          if (x % 2 === 0 && y % 2 === 0 && editorFlags.get(cliff) !== ourFlags.get(cliff)) mismatches.push(`cliff cell (${x},${y})`);
        }
      }
      expect(mismatches).toEqual([]);
    });

    it("writes the same <ramp> element, to the float", () => {
      const xml = writeT3TerrainXml({ catalog: EMPTY_CATALOG, tilesetId: "BelShirEx2", width: SIZE, height: SIZE, textureSetIndex: 0, cliffCells: diagonal.cliffCells, ramps: diagonal.ramps });
      const numbers = (ramp: string): number[] =>
        [...ramp.replace(/ (leftHi|rightHi)="[^"]*"/g, "").matchAll(/-?\d+(\.\d+)?(e[+-]\d+)?/g)].map((m) => Math.round(Number(m[0]) * 1e5) / 1e5 + 0);
      const ours = /<ramp dir="7"[^>]*\/>/.exec(xml)![0];
      const editor = [...editorXml.matchAll(/<ramp dir="7"[^>]*\/>/g)].map((m) => m[0]);
      expect(editor).toHaveLength(1);
      expect(numbers(ours)).toEqual(numbers(editor[0]!));
    });
  });

  it("refuses a ramp into a level-0 pit", () => {
    const pitRamp = { ...blueprint, ramps: [{ id: "into_pit", zoneId: "pit", edge: "east" as const, offset: 0 }] };
    expect(() => rasterizeTerrain(pitRamp)).toThrow(/level-0 pit/);
  });
});
