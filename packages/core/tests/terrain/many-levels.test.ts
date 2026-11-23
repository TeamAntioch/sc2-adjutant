import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { writeMapPackage } from "../../src/map/write-map-package.js";
import { CLIFF_HEIGHTS, cliffHeight, MAX_CLIFF_LEVEL } from "../../src/terrain/cliffs.js";
import { rasterizeTerrain } from "../../src/terrain/rasterize.js";
import { readT3TerrainXml } from "../../src/terrain/read-t3-terrain-xml.js";

// Terraces up to the Editor's top level, as the author's "so many cliffs" test map has them:
// squares round the centre of a 256-cell map, each one level
// above the one round it with an 8-cell tread, and a ramp down from each, its edge turning a
// quarter a level.
const SIZE = 256;
const CENTRE = SIZE / 2;
const EDGES = ["south", "east", "north", "west"] as const;
const half = (level: number): number => 124 - 8 * (level - 2);
const raw = JSON.parse(await readFile(new URL("../fixtures/terrain-test/blueprint.json", import.meta.url), "utf8"));
const levels = Array.from({ length: MAX_CLIFF_LEVEL - 1 }, (_, i) => i + 2);
const square = (h: number) => [
  { x: CENTRE - h, y: CENTRE - h },
  { x: CENTRE + h, y: CENTRE - h },
  { x: CENTRE + h, y: CENTRE + h },
  { x: CENTRE - h, y: CENTRE + h },
];
const blueprint = MissionBlueprintSchema.parse({
  ...raw,
  mapSize: { width: SIZE, height: SIZE },
  anchors: raw.anchors.filter((anchor: { zoneId: string }) => anchor.zoneId === "field"),
  zones: [
    { ...raw.zones[0], polygon: square(CENTRE) },
    ...levels.map((level) => ({ id: `level_${level}`, name: `Level ${level}`, elevation: level, landform: "flat", role: "path", polygon: square(half(level)), connections: [] })),
  ],
  ramps: levels.map((level) => ({ id: `down_${level}`, zoneId: `level_${level}`, edge: EDGES[level % 4] })),
});
const terrain = rasterizeTerrain(blueprint);
const vertex = (x: number, y: number): number => y * (SIZE + 1) + x;
// A corner in the middle of each level's tread, west of the centre, where no ramp is.
const onTread = (level: number): number => vertex(CENTRE - half(level) + 4, CENTRE);

describe("cliff levels 0-15", () => {
  it("gives each level its height: -8 for the pit, then 2 a level from ground", () => {
    expect(CLIFF_HEIGHTS).toEqual([-8, 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28]);
    expect(() => cliffHeight(MAX_CLIFF_LEVEL + 1)).toThrow("outside the Editor's 0 to 15");
  });

  it("refuses an elevation above 15", () => {
    const zones = blueprint.zones.map((zone, i) => (i === 1 ? { ...zone, elevation: 16 } : zone));
    expect(MissionBlueprintSchema.safeParse({ ...blueprint, zones }).error?.issues.map((issue) => issue.path.join("."))).toContain("zones.1.elevation");
  });

  it("raises each terrace to its level and height, with a ramp down from each", () => {
    for (const level of [1, ...levels]) {
      const v = level === 1 ? vertex(2, CENTRE) : onTread(level);
      expect(terrain.vertexCliffLevels[v], `level ${level}`).toBe(level);
      expect(terrain.cliffHeights[v], `level ${level}`).toBeCloseTo(2 * (level - 1), 5);
    }
    expect(terrain.ramps.map((ramp) => ramp.lowLevel + 1)).toEqual(levels);
  });

  describe("compiled", () => {
    let outputDir: string | undefined;
    afterAll(async () => {
      if (outputDir) await rm(outputDir, { recursive: true, force: true });
    });

    it("widens t3HeightMap's quantization to fit level 15, as the Editor does, and writes every level within a step", async () => {
      outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-levels-"));
      await writeMapPackage({ blueprint, outputDir });
      const xml = await readFile(path.join(outputDir, "t3Terrain.xml"), "utf8");
      const { quantizeBias, quantizeScale } = readT3TerrainXml(xml);
      // The Editor's for the author's map, whose top is level 15's 28 too: a top of 28 + 1.
      expect(quantizeBias).toBe(9);
      expect(quantizeScale).toBeCloseTo(5.798428e-4, 9);
      expect(0xffff * quantizeScale - quantizeBias).toBeGreaterThanOrEqual(29);
      expect(xml.match(/<ramp /g)).toHaveLength(levels.length);

      const heightMap = await readFile(path.join(outputDir, "t3HeightMap"));
      const decode = (raw: number): number => raw * quantizeScale - quantizeBias;
      for (const level of levels) {
        const at = 32 + onTread(level) * 6;
        expect(heightMap.readUInt16LE(at + 4), `level ${level}`).toBe(level);
        expect(Math.abs(decode(heightMap.readUInt16LE(at + 2)) - 2 * (level - 1)), `level ${level}`).toBeLessThanOrEqual(quantizeScale);
      }
    }, 60_000);
  });
});
