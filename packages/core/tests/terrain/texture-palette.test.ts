import { describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { missionTextures, textureStarkness } from "../../src/catalog/tileset-textures.js";
import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { StyleBlueprintSchema } from "../support/workspaces.js";
import { TEXELS_PER_CELL } from "../../src/terrain/texture-grid.js";
import { rasterizeTerrain } from "../../src/terrain/rasterize.js";
import { buildMissionGameData } from "../../src/triggers/build-mission-triggers.js";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** A 64×64 field (main level), a mesa (high), a pit (low) and a built yard, with a palette mixing tilesets. */
function blueprint(palette: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) {
  return {
    id: "palette",
    campaignId: "test",
    title: "Palette",
    setting: "test",
    mapSize: { width: 64, height: 64 },
    tilesetId: "BelShirEx2",
    zones: [
      { id: "field", name: "Field", elevation: 1, landform: "flat", role: "base", polygon: rect(0, 0, 64, 64) },
      { id: "mesa", name: "Mesa", elevation: 2, landform: "ridge", role: "path", polygon: rect(40, 40, 56, 56) },
      { id: "pit", name: "Pit", elevation: 0, landform: "canyon", role: "path", polygon: rect(6, 40, 18, 52) },
      { id: "yard", name: "Yard", elevation: 1, landform: "flat", role: "base", surface: "built", polygon: rect(30, 6, 46, 22) },
    ],
    anchors: [],
    beats: [{ id: "only", title: "Only", summary: "Test beat." }],
    screenplay: { title: "Palette" },
    ...(palette ? { texturePalette: palette } : {}),
    ...extra,
  };
}

const palette = {
  main: "MarSaraDirt",
  low: "CharLavaCracks",
  high: "MarSaraDarkSand",
  variety: ["MarSaraSand", "MarSaraRocky"],
  built: "KorhalPlatform1",
};
const parsed = StyleBlueprintSchema.parse(blueprint(palette));
const terrain = rasterizeTerrain(parsed);
const textures = missionTextures(EMPTY_CATALOG, parsed);
const W = 64;
const dominant = (x: number, y: number): string => {
  const weights = [...terrain.textureWeights.subarray((y * W + x) * 8, (y * W + x) * 8 + 8)];
  return textures[weights.indexOf(Math.max(...weights))]!;
};

describe("texture palette", () => {
  it("makes the mission's textures from the palette, then the tileset's", () => {
    expect(textures.slice(0, 6)).toEqual(["MarSaraDirt", "MarSaraSand", "MarSaraRocky", "MarSaraDarkSand", "CharLavaCracks", "KorhalPlatform1"]);
    expect(textures).toHaveLength(8);
    expect(textures.slice(6).every((name) => name !== "")).toBe(true);
  });

  it("writes them as the tileset's blend textures in map data, since they differ from BelShir's", () => {
    const terrainData = buildMissionGameData(parsed)["TerrainData.xml"]!;
    expect(terrainData).toContain('<CTerrain id="BelShirEx2">');
    expect(terrainData).toContain('<BlendTextures index="0" value="MarSaraDirt"/>');
    expect(terrainData).toContain('<BlendTextures index="5" value="KorhalPlatform1"/>');
  });

  it("paints each elevation band with its texture and the built zone with the built one", () => {
    expect(dominant(48, 48)).toBe("MarSaraDarkSand");
    expect(dominant(12, 46)).toBe("CharLavaCracks");
    expect(dominant(38, 14)).toBe("KorhalPlatform1");
  });

  /** The main level's open cells: off the mesa, the pit and the yard with its crisp edge. */
  const openMain = (x: number, y: number): boolean => terrain.syncCliff[y * W + x] === 64 && !(x >= 28 && x < 48 && y >= 4 && y < 24);

  it("washes the main level with the variety textures, the main one keeping about two thirds by weight", () => {
    const weights = new Map<string, number>();
    let total = 0;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        if (!openMain(x, y)) continue;
        total += 15;
        textures.forEach((name, layer) => weights.set(name, (weights.get(name) ?? 0) + terrain.textureWeights[(y * W + x) * 8 + layer]!));
      }
    }
    const share = (name: string): number => (weights.get(name) ?? 0) / total;
    expect(share("MarSaraDirt")).toBeGreaterThan(0.5);
    expect(share("MarSaraDirt")).toBeLessThan(0.8);
    expect(share("MarSaraSand")).toBeGreaterThan(0.05);
    expect(share("MarSaraRocky")).toBeGreaterThan(0.05);
  });

  it("makes a variety patch a wash, not a swap: most open cells hold two textures, and few lose the main one altogether", () => {
    let open = 0;
    let mixed = 0;
    let solid = 0;
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        if (!openMain(x, y)) continue;
        open++;
        const weights = terrain.textureWeights.subarray((y * W + x) * 8, (y * W + x) * 8 + 8);
        if (Math.max(...weights) < 15) mixed++;
        if (weights[textures.indexOf("MarSaraDirt")]! === 0) solid++;
      }
    }
    expect(mixed / open).toBeGreaterThan(0.5);
    // A wash has a core at full strength, so it still reads in dim light.
    expect(solid / open).toBeGreaterThan(0);
    expect(solid / open).toBeLessThan(0.1);
  });

  it("paints each zone its one texture, with no advice, when no Style Pack is active", () => {
    // Core alone: no variety patches (DL-01) and no cliff advice (DL-02), even with no low band.
    const plain = MissionBlueprintSchema.parse(blueprint({ ...palette, low: undefined }));
    const painted = rasterizeTerrain(plain);
    const names = missionTextures(EMPTY_CATALOG, plain);
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        if (painted.syncCliff[y * W + x] !== 64) continue;
        const weights = [...painted.textureWeights.subarray((y * W + x) * 8, (y * W + x) * 8 + 8)];
        expect(["MarSaraDirt", "KorhalPlatform1"]).toContain(names[weights.indexOf(Math.max(...weights))]);
      }
    }
    expect(painted.textureWarnings).toEqual([]);
  });

  it("keeps a built zone's edge crisp: a 2-3 texel fade, as on Blizzard's built maps", () => {
    const layer = textures.indexOf("KorhalPlatform1");
    const T = TEXELS_PER_CELL;
    const weight = (tx: number, ty: number): number => terrain.texelWeights[(ty * W * T + tx) * 8 + layer]!;
    // Across the yard's west edge (x = 30), row by row: the run of texels with the built texture
    // neither absent nor full.
    for (let ty = 8 * T; ty < 20 * T; ty += 3) {
      const fade = [...Array(4 * T).keys()].map((i) => 28 * T + i).filter((tx) => weight(tx, ty) > 0 && weight(tx, ty) < 15);
      expect(fade.length).toBeGreaterThanOrEqual(2);
      expect(fade.length).toBeLessThanOrEqual(3);
      expect(Math.min(...fade)).toBeGreaterThanOrEqual(30 * T - 2);
      expect(Math.max(...fade)).toBeLessThanOrEqual(30 * T + 1);
      expect(weight(30 * T - 3, ty)).toBe(0);
      expect(weight(30 * T + 2, ty)).toBe(15);
    }
  });

  it("refuses a palette texture no tileset has", () => {
    expect(() => rasterizeTerrain(StyleBlueprintSchema.parse(blueprint({ ...palette, high: "MarSaraDarkSnad" })))).toThrow(
      /Palette texture MarSaraDarkSnad isn't a known texture/,
    );
  });

  it("lets a zone's own texture win", () => {
    const own = blueprint(palette);
    (own.zones[1] as { texture?: string }).texture = "MarSaraSand";
    expect(rasterizeTerrain(StyleBlueprintSchema.parse(own)).textureWeights[(48 * W + 48) * 8 + 1]).toBe(15);
  });

  it("validates the palette", () => {
    const errors = (raw: unknown): string[] => {
      const result = StyleBlueprintSchema.safeParse(raw);
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };
    expect(errors(blueprint(palette))).toEqual([]);
    expect(errors(blueprint({ ...palette, built: undefined }))).toEqual(["A built zone needs the palette's built texture or its own"]);
    expect(errors(blueprint(palette, { textures: ["MarSaraDirt"] }))).toContain("Palette texture MarSaraSand is not one of the blueprint's textures");
    expect(errors(blueprint({ main: "A", low: "B", high: "C", variety: ["D", "E", "F"], built: "G" }))).toEqual([]);
    expect(errors(blueprint({ ...palette, variety: ["A", "B", "C", "D"] }))).not.toEqual([]);
  });

  it("gives a stark variety texture less ground than a calm one, by its picture's contrast", () => {
    // Pebbly ShakurasCity2 and lumpy Zerus3 are stark; smooth BelShirDirtLightEx2 is calm.
    expect(textureStarkness("ShakurasCity2")).toBe(1);
    expect(textureStarkness("Zerus3")).toBe(1);
    expect(textureStarkness("BelShirDirtLightEx2")).toBe(0);
    expect(textureStarkness("BelShirGrassLightEx2")).toBe(0);
    const grass = { ...palette, main: "BelShirGrassLightEx2", variety: ["ShakurasCity2", "BelShirDirtLightEx2"] };
    const parsedGrass = StyleBlueprintSchema.parse(blueprint(grass));
    const painted = rasterizeTerrain(parsedGrass);
    const names = missionTextures(EMPTY_CATALOG, parsedGrass);
    const weight = (name: string): number => {
      let sum = 0;
      let cells = 0;
      for (let y = 0; y < W; y++) {
        for (let x = 0; x < W; x++) {
          if (!openMain(x, y)) continue;
          cells++;
          sum += painted.textureWeights[(y * W + x) * 8 + names.indexOf(name)]! / 15;
        }
      }
      return sum / cells;
    };
    expect(weight("BelShirDirtLightEx2")).toBeGreaterThan(0.1);
    expect(weight("ShakurasCity2")).toBeGreaterThan(0.005);
    expect(weight("ShakurasCity2")).toBeLessThan(weight("BelShirDirtLightEx2") / 2);
    // Even at its core a stark texture takes about half a cell, so the grass shows through it.
    let most = 0;
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (openMain(x, y)) most = Math.max(most, painted.textureWeights[(y * W + x) * 8 + names.indexOf("ShakurasCity2")]!);
    expect(most).toBeGreaterThanOrEqual(5);
    expect(most).toBeLessThanOrEqual(9);
  });

  describe("bands (DL-01, DL-02)", () => {
    /** Each texture's share of a zone's ground, by weight. */
    const shares = (painted: ReturnType<typeof rasterizeTerrain>, names: string[], x0: number, y0: number, x1: number, y1: number) => {
      const counts = new Map<string, number>();
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          names.forEach((name, layer) => counts.set(name, (counts.get(name) ?? 0) + painted.textureWeights[(y * W + x) * 8 + layer]! / 15));
        }
      }
      const total = (x1 - x0) * (y1 - y0);
      return (name: string): number => (counts.get(name) ?? 0) / total;
    };
    const paint = (raw: ReturnType<typeof blueprint>) => {
      const parsed = StyleBlueprintSchema.parse(raw);
      return { painted: rasterizeTerrain(parsed), names: missionTextures(EMPTY_CATALOG, parsed) };
    };

    it("touches high ground for play lightly with the palette's variety", () => {
      const share = shares(terrain, textures, 42, 42, 54, 54);
      expect(share("MarSaraDarkSand")).toBeGreaterThan(0.6);
      expect(share("MarSaraSand") + share("MarSaraRocky")).toBeLessThan(0.3);
    });

    it("patches a band with its own variety at full strength", () => {
      const { painted, names } = paint(blueprint({ ...palette, high: { texture: "MarSaraDarkSand", variety: ["MarSaraBlackenedRock"] } }));
      const share = shares(painted, names, 42, 42, 54, 54);
      // A wash on a 12-cell mesa, of a texture stark enough to be painted lightly.
      expect(share("MarSaraBlackenedRock")).toBeGreaterThan(0.02);
      expect(share("MarSaraSand") + share("MarSaraRocky")).toBe(0);
    });

    it("keeps a backdrop zone to its one signature texture", () => {
      const raw = blueprint(palette);
      (raw.zones[2] as { backdrop?: boolean }).backdrop = true;
      const { painted, names } = paint(raw);
      expect(shares(painted, names, 8, 42, 16, 50)("CharLavaCracks")).toBe(1);
    });

    it("gives each level away from the main level its own band, the last repeating", () => {
      const raw = blueprint({ ...palette, high: ["MarSaraDarkSand", "MarSaraBlackenedRock"] });
      raw.zones.push({ id: "peak", name: "Peak", elevation: 3, landform: "ridge", role: "path", polygon: rect(46, 46, 52, 52) } as (typeof raw.zones)[number]);
      const { painted, names } = paint(raw);
      expect(shares(painted, names, 47, 47, 51, 51)("MarSaraBlackenedRock")).toBeGreaterThan(0.6);
      expect(painted.textureWarnings).toEqual([]);
    });

    it("warns when a cliff joins two levels with the same texture", () => {
      const raw = blueprint({ ...palette, low: undefined });
      raw.zones.push({ id: "peak", name: "Peak", elevation: 3, landform: "ridge", role: "path", polygon: rect(46, 46, 52, 52) } as (typeof raw.zones)[number]);
      expect(paint(raw).painted.textureWarnings).toEqual([
        "Levels 0 and 1 mostly both wear MarSaraDirt, so the cliff between them doesn't change texture (DL-02): set the palette's low.",
        "Levels 2 and 3 mostly both wear MarSaraDarkSand, so the cliff between them doesn't change texture (DL-02): give the two levels different textures (a high band per level, or a zone's own texture).",
      ]);
    });

    it("judges the cliff by what's painted, so a zone's own texture clears the warning", () => {
      const raw = blueprint({ ...palette, low: undefined });
      (raw.zones[2] as { texture?: string }).texture = "BelShirDirtDarkEx2";
      expect(paint(raw).painted.textureWarnings).toEqual([]);
    });

    it("asks for a band per level when a whole side is unset", () => {
      // The main level is 1 (the field); a ledge at 2 and a peak at 3 above it, no high bands.
      const raw = blueprint({ ...palette, high: undefined });
      (raw.zones[1] as { texture?: string }).texture = "MarSaraRocky";
      raw.zones.push({ id: "peak", name: "Peak", elevation: 3, landform: "ridge", role: "path", texture: "MarSaraRocky", polygon: rect(46, 46, 52, 52) } as (typeof raw.zones)[number]);
      expect(paint(raw).painted.textureWarnings).toEqual([
        "Levels 2 and 3 mostly both wear MarSaraRocky, so the cliff between them doesn't change texture (DL-02): set the palette's high, a band per level.",
      ]);
    });

    it("patches a zone that falls back to main like the main level", () => {
      const { painted, names } = paint(blueprint({ ...palette, high: undefined }));
      const share = shares(painted, names, 42, 42, 54, 54);
      expect(share("MarSaraSand") + share("MarSaraRocky")).toBeGreaterThan(0.1);
    });

    it("counts band variety against the 8-texture limit", () => {
      const result = StyleBlueprintSchema.safeParse(
        blueprint({ main: "A", variety: ["B", "C", "D"], high: { texture: "E", variety: ["F", "G", "H"] }, low: "I" }),
      );
      expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toContain("A texture palette can use at most 8 textures");
    });
  });
});
