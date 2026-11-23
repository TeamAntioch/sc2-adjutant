// Texture sets on a fully generated Mission (#533, ADR-0016): a Blueprint's `textureSets` compile
// into the package from scratch, each set's name and slots in t3Terrain.xml, its Zones' blocks on
// it, t3SyncTextureInfo with set_count sets, and each set's CTerrain override in TerrainData.xml.
// A block shared by Zones of two sets snaps to the set whose Zones cover most of its cells.
//
// The Blueprint is the terrain-test fixture's 128×128 BelShirEx2 map, flat: a field over the whole
// map (set 0) and, on texture set "metal", a yard on blocks 8-9 × 8-9, a porch covering 48 of block
// 138's 64 cells (the field the other 16) and a pad covering 32 of block 135's (a tie with the field).
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { dominantLayer, readKeptTextures, setTextures } from "../../src/kept-terrain/paint-brushes.js";
import { writeMapPackage } from "../../src/map/write-map-package.js";
import { freshTextures } from "../../src/terrain/generated-texture-sets.js";
import { rasterizeTerrain } from "../../src/terrain/rasterize.js";
import { readT3TextureMasks } from "../../src/terrain/read-t3-texture-masks.js";
import { writeT3SyncTextureInfo } from "../../src/terrain/write-t3-sync-texture-info.js";
import { writeT3TerrainXml } from "../../src/terrain/write-t3-terrain-xml.js";
import { texelMasks, writeT3TextureMasks } from "../../src/terrain/write-t3-texture-masks.js";

const raw = JSON.parse(await readFile(new URL("../fixtures/terrain-test/blueprint.json", import.meta.url), "utf8"));
const rect = (x: number, y: number, width: number, height: number) => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];
const zone = (id: string, polygon: { x: number; y: number }[], extra: Record<string, unknown> = {}) => ({ id, name: id, elevation: 1, landform: "flat", role: "path", polygon, connections: [], ...extra });
const METAL = ["BraxisAlphaPlatesEx2", "KorhalPlatformEx2_4", "MarSaraPanels"];

/** `value` with each typed array (a Buffer too) replaced by its type, length and a hash of its bytes, for a fast toEqual. */
function asBytes(value: unknown): unknown {
  if (ArrayBuffer.isView(value)) {
    const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    return { type: value.constructor.name, byteLength: value.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  if (Array.isArray(value)) return value.map(asBytes);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, asBytes(entry)]));
  return value;
}

function blueprintWith(extra: Record<string, unknown> = {}) {
  return MissionBlueprintSchema.parse({
    ...raw,
    anchors: raw.anchors.filter((anchor: { zoneId: string }) => anchor.zoneId === "field"),
    ramps: [],
    zones: [
      { ...raw.zones[0], connections: [] },
      zone("yard", rect(64, 64, 16, 16), { texture: "MarSaraPanels" }),
      zone("porch", rect(80, 64, 6, 8), { texture: "MarSaraPanels" }),
      zone("pad", rect(60, 64, 4, 8), { texture: "MarSaraPanels" }),
    ],
    textureSets: [{ id: "metal", textures: METAL, zones: ["yard", "porch", "pad"] }],
    ...extra,
  });
}

describe("texture sets on a generated Mission", () => {
  const outputDirs: string[] = [];
  afterAll(() => Promise.all(outputDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

  it("are accepted by the Blueprint schema", () => {
    expect(blueprintWith().textureSets).toHaveLength(1);
  });

  /** The schema's issues for the Blueprint with `extra`, as "path: message". */
  const issues = (extra: Record<string, unknown>) => {
    const result = MissionBlueprintSchema.safeParse({ ...blueprintWith(), ...extra });
    return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  };
  const TEXTURES = ["BelShirDirtLightEx2", "BelShirGrassEx2", "BelShirRockEx2", "BelShirDirtEx2"];

  it("let a set's Zone name a texture only its set holds, beside the Blueprint's own textures", async () => {
    // MarSaraPanels is the metal set's, not one of the Blueprint's 4.
    expect(issues({ textures: TEXTURES })).toEqual([]);
    // A Zone in no set is still held to the Blueprint's textures.
    const zones = [...blueprintWith().zones, zone("shed", rect(0, 0, 8, 8), { texture: "MarSaraPanels" })];
    expect(issues({ textures: TEXTURES, zones })).toEqual(["zones.4.texture: Zone texture MarSaraPanels is not one of the blueprint's textures"]);
    // And the compile paints the yard with it, on the set's layer 2.
    const { textures } = await compiled(blueprintWith({ textures: TEXTURES }));
    expect(setTextures(textures, 1)[dominantLayer(textures.masks, 128, 70 * 128 + 70)]).toBe("MarSaraPanels");
    expect(setTextures(textures, 0).slice(0, 4)).toEqual(TEXTURES);
  });

  it("let a built Zone of a set go without the palette's built texture: it wears its set's", () => {
    const texturePalette = { main: "BelShirDirtLightEx2" };
    const built = (id: string) => ({ ...blueprintWith().zones.find((z) => z.id === id)!, surface: "built" });
    const zones = blueprintWith().zones.map((z) => (z.id === "yard" ? { ...built("yard"), texture: undefined } : z));
    expect(issues({ texturePalette, zones })).toEqual([]);
    // A built Zone in no set still needs one.
    expect(issues({ texturePalette, zones: [...zones, zone("shed", rect(0, 0, 8, 8), { surface: "built" })] })).toEqual([
      "zones.4.surface: A built zone needs the palette's built texture or its own",
    ]);
  });

  it("need a map size that is a multiple of 8 each way", () => {
    expect(issues({ mapSize: { width: 124, height: 128 } })).toEqual([
      "textureSets: Texture sets go on 8×8-cell blocks, and the map is 124×128 cells: make it a multiple of 8 each way",
    ]);
    expect(issues({ mapSize: { width: 124, height: 128 }, textureSets: undefined })).toEqual([]);
  });

  /** The package compiled from `blueprint`, and its files. */
  async function compiled(blueprint = blueprintWith()) {
    const outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-"));
    outputDirs.push(outputDir);
    const result = await writeMapPackage({ blueprint, outputDir });
    const read = (file: string) => readFile(path.join(outputDir, ...file.split("/")));
    const terrainXml = (await read("t3Terrain.xml")).toString("utf8");
    const sync = await read("t3SyncTextureInfo");
    const textures = readKeptTextures(terrainXml, await read("t3TextureMasks"), sync);
    return { result, read, terrainXml, sync, textures };
  }
  // Compiling paints the 128×128 map's textures, the slow part: the tests that only read the
  // default Blueprint's package share one compile.
  let defaultPackage: ReturnType<typeof compiled> | undefined;
  const compiledDefault = () => (defaultPackage ??= compiled());
  // Blocks are 8×8 cells, 16 to a row on a 128-cell map.
  const block = (bx: number, by: number) => by * 16 + bx;
  const YARD = [block(8, 8), block(9, 8), block(8, 9), block(9, 9)];

  it("writes each set's name and slots in t3Terrain.xml, with its Zones' blocks on it", async () => {
    const { terrainXml } = await compiledDefault();
    // The set's name is the tileset listing most of its textures, not set 0's BelShirEx2.
    const name = /<textureSet i="1" name="([^"]*)"\/>/.exec(terrainXml)![1]!;
    expect(name).not.toBe("");
    expect(name).not.toBe("BelShirEx2");
    expect(terrainXml).toContain('<textureSet i="0" name="BelShirEx2"/>');
    expect(terrainXml).toContain('<textureSet i="2" name=""/>');
    METAL.forEach((texture, layer) => expect(terrainXml).toContain(`<texture i="${8 + layer}" name="${texture}"/>`));
    expect(terrainXml).toContain('<texture i="11" name=""/>');
    const tileSet = (i: number) => /tileSet="(\d+)"/.exec(terrainXml.match(new RegExp(`<blockTextureSet i="${i}" [^>]*>`))![0])![1];
    for (const i of YARD) expect(tileSet(i), `block ${i}`).toBe("1");
    expect(tileSet(block(10, 8))).toBe("1");
    expect(tileSet(block(7, 8))).toBe("0");
    expect(tileSet(0)).toBe("0");
    expect([...terrainXml.matchAll(/tileSet="1"/g)]).toHaveLength(5);
  });

  it("writes t3SyncTextureInfo with set_count sets of 8 names, each cell on its block's set", async () => {
    const { sync, textures } = await compiledDefault();
    expect(sync.readUInt32LE(16)).toBe(2);
    // readKeptTextures checks every cell's set against its block's in t3Terrain.xml.
    expect(textures.syncNames).toHaveLength(16);
    expect(textures.syncNames.slice(8)).toEqual([...METAL, "", "", "", "", ""]);
    expect(textures.syncNames[0]).toBe("BelShirDirtLightEx2");
    const cellSet = (x: number, y: number) => sync.readUInt32LE(textures.syncCells + (y * 128 + x) * 8 + 4);
    expect(cellSet(64, 64)).toBe(1);
    expect(cellSet(87, 71)).toBe(1);
    expect(cellSet(60, 64)).toBe(0);
    expect(cellSet(0, 0)).toBe(0);
  });

  it("lists each set's textures in its tileset's CTerrain override in TerrainData.xml, CRLF as the Editor writes it", async () => {
    const { read, terrainXml } = await compiledDefault();
    const name = /<textureSet i="1" name="([^"]*)"\/>/.exec(terrainXml)![1]!;
    const terrainData = (await read("Base.SC2Data/GameData/TerrainData.xml")).toString("utf8");
    const entry = terrainData.slice(terrainData.indexOf(`<CTerrain id="${name}">`));
    expect(entry.slice(0, entry.indexOf("</CTerrain>"))).toBe(
      [`<CTerrain id="${name}">`, ...METAL.map((texture, index) => `        <BlendTextures index="${index}" value="${texture}"/>`), "    "].join("\r\n"),
    );
    expect(terrainData.replaceAll("\r\n", "")).not.toContain("\n");
    const components = (await read("ComponentList.SC2Components")).toString("utf8");
    expect(components).toContain(">GameData</DataComponent>");
  });

  it("paints each Zone on its block's set's layers, a snapped block's other cells from its set", async () => {
    const { textures } = await compiledDefault();
    const shown = (x: number, y: number) => setTextures(textures, textures.blockSets[block(Math.floor(x / 8), Math.floor(y / 8))]!)[dominantLayer(textures.masks, 128, y * 128 + x)];
    // The yard, inside its blocks, and the porch's cells: MarSaraPanels, layer 2 of set 1.
    expect(dominantLayer(textures.masks, 128, 70 * 128 + 70)).toBe(2);
    expect(shown(70, 70)).toBe("MarSaraPanels");
    expect(shown(82, 66)).toBe("MarSaraPanels");
    // The field's 16 cells in the porch's block (set 1) wear the porch's texture too.
    expect(shown(87, 68)).toBe("MarSaraPanels");
    // The pad's 32 cells tie with the field's in block 135, which stays on set 0: the pad wears the field's texture.
    expect(shown(62, 68)).toBe(shown(57, 68));
    expect(shown(62, 68)).not.toBe("MarSaraPanels");
    // No texel of a set-1 block has weight on a layer set 1 leaves empty (3-7). One expect over
    // the weighted texels: an expect per texel (100,000 of them) is slow.
    const weighted: string[] = [];
    for (const b of [...YARD, block(10, 8)]) {
      const bx = (b % 16) * 64;
      const by = Math.floor(b / 16) * 64;
      for (let ty = by; ty < by + 64; ty++) for (let tx = bx; tx < bx + 64; tx++) for (let layer = 3; layer < 8; layer++) if (textures.masks.layers[layer]![ty * textures.masks.maskWidth + tx] !== 0) weighted.push(`texel ${tx},${ty} layer ${layer}`);
    }
    expect(weighted).toEqual([]);
  });

  it("warns of each snapped block, saying which set it went to and whose cells it took", async () => {
    const { result } = await compiledDefault();
    const warning = result.warnings.find((text) => text.includes("Zones of two texture sets"))!;
    expect(warning).toMatch(/^2 blocks hold Zones of two texture sets/);
    expect(warning).toContain("block 135 (cells 56-63 × 64-71) went to set 0 (the Zones in no set), over Zone pad's 32 cells");
    expect(warning).toContain("block 138 (cells 80-87 × 64-71) went to texture set metal (set 1), over Zone field's 16 cells");
    // The set's boundary with set 0 needs cover, as beside Kept ground (#539): the yard's west edge is a hard cut.
    const boundary = result.warnings.find((text) => text.startsWith("Texture set metal's boundary needs cover"))!;
    expect(boundary).toMatch(/Hard cut along x = 64, y 64-79 \(16 cells\): \w+ \(set 0, cells at x 63\) \| MarSaraPanels \(set 1, cells at x 64\)/);
  });

  it("gives a block two sets tie for to the set listed first, and a set's Zone with no texture the set's first", async () => {
    const DUNES = ["CharDunes_1", "CharDunes_5"];
    const { result, terrainXml, textures } = await compiled(
      blueprintWith({
        zones: [
          { ...raw.zones[0], connections: [] },
          zone("west", rect(0, 0, 4, 8)),
          zone("east", rect(4, 0, 4, 8)),
          zone("dunes", rect(16, 0, 8, 8)),
        ],
        textureSets: [
          { id: "dunes", textures: DUNES, zones: ["east", "dunes"] },
          { id: "metal", textures: METAL, zones: ["west"] },
        ],
      }),
    );
    // dunes is listed first, so it is set 1 and wins block 0, 32 cells each.
    DUNES.forEach((texture, layer) => expect(terrainXml).toContain(`<texture i="${8 + layer}" name="${texture}"/>`));
    METAL.forEach((texture, layer) => expect(terrainXml).toContain(`<texture i="${16 + layer}" name="${texture}"/>`));
    expect(textures.blockSets[0]).toBe(1);
    expect(textures.blockSets[2]).toBe(1);
    expect(textures.setCount).toBe(3);
    // metal is set 2, though it ends up on no block.
    expect(textures.blockSets.includes(2)).toBe(false);
    expect(result.warnings.join("\n")).toContain("block 0 (cells 0-7 × 0-7) went to texture set dunes (set 1), over Zone west's 32 cells");
    // The dunes Zone has no texture: it wears CharDunes_1, layer 0 of set 1, and west the same once snapped.
    expect(dominantLayer(textures.masks, 128, 4 * 128 + 20)).toBe(0);
    expect(dominantLayer(textures.masks, 128, 4 * 128 + 1)).toBe(0);
  });

  it("start from a fresh map's textures as its files would read: one set of the Mission's 8, every block on it, nothing painted", () => {
    const textures = ["BelShirDirtLightEx2", "BelShirGrassEx2", "", "BelShirRockEx2", "", "", "", ""];
    const [width, height] = [64, 40];
    const cells = width * height;
    // Typed arrays compared as bytes (toEqual walks their 1.3M elements one by one, seconds).
    expect(asBytes(freshTextures("BelShirEx2", width, height, textures))).toEqual(
      asBytes(
        readKeptTextures(
          writeT3TerrainXml({ tilesetId: "BelShirEx2", width, height, textureSetIndex: 0, textures, catalog: EMPTY_CATALOG }),
          writeT3TextureMasks({ width, height, textureWeights: new Uint8Array(cells * 8) }),
          writeT3SyncTextureInfo({ width, height, textureSetCount: 1, textureNames: textures, dominantTextureIndices: new Uint32Array(cells), textureSetIndices: new Uint32Array(cells) }),
        ),
      ),
    );
  });

  it("read the painted masks as t3TextureMasks holds them, for the boundary warnings", () => {
    const terrain = rasterizeTerrain(blueprintWith());
    const { width, height } = blueprintWith().mapSize;
    const masks = texelMasks(width, height, terrain.texelWeights);
    const written = readT3TextureMasks(writeT3TextureMasks({ width, height, textureWeights: terrain.textureWeights, texelWeights: terrain.texelWeights }));
    expect([masks.maskWidth, masks.maskHeight]).toEqual([written.maskWidth, written.maskHeight]);
    // Layer by layer, byte for byte (toEqual over 8 × 1M texels is too slow).
    expect(masks.layers.map((layer, index) => Buffer.from(layer).equals(Buffer.from(written.layers[index]!)))).toEqual(Array(8).fill(true));
  });
});
