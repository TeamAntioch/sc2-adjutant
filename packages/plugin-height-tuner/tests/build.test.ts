// A texture's test map, built end to end without the game: a fake install whose "storage" is a
// folder, read by a fake extractor that takes stormex's options, and core's real compile.
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { decodeDds } from "@team-antioch/sc2-adjutant/src/catalog/dds.js";
import { readT3TextureMasks } from "@team-antioch/sc2-adjutant/src/terrain/read-t3-texture-masks.js";
import { afterEach, describe, expect, it } from "vitest";

import { buildTestMap, mapSize, STEPS, stripRect, stripWeights, withSlots, withSlotNames } from "../build.ts";
import { catalogEntries, stockHeightMapEnabled, stockTexture } from "../stock.ts";
import { DEFAULT_VARIANTS, parseVariants } from "../variants.ts";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const CORE_TEX = `<?xml version="1.0" encoding="us-ascii"?>
<Catalog>
    <CTerrainTex default="1">
        <PhysicsMaterial value="Dirt"/>
    </CTerrainTex>
</Catalog>`;
const VOID_TEX = `<?xml version="1.0" encoding="us-ascii"?>
<Catalog>
    <CTerrainTex id="BelShirGrassLightEx2">
        <Texture value="Assets\\Textures\\BelShirEx2_4.dds"/>
        <Normalmap value="Assets\\Textures\\BelShirEx2_4Normal.dds"/>
        <HeightMapScale value="3"/>
    </CTerrainTex>
    <CTerrainTex id="ShakurasCity2">
        <Texture value="Assets\\Textures\\ShakurasCity_2.dds"/>
        <EditorIcon value="Assets\\Textures\\ShakurasCity_2.dds"/>
        <Normalmap value="Assets\\Textures\\ShakurasCity_2Normal.dds"/>
        <DoodadEntry Model="Pebble" Probability="0.1"/>
    </CTerrainTex>
</Catalog>`;
const VOID_TERRAIN = `<Catalog>
    <CTerrain id="AiurTempleJungle">
        <HeightMapEnabled value="1"/>
    </CTerrain>
</Catalog>`;

/** An uncompressed 32-bit BGRA .dds with every mip level: a normal map whose red holds stones. */
function normalMapDds(size: number): Uint8Array {
  const levels = Math.log2(size) + 1;
  const header = new Uint8Array(128);
  const view = new DataView(header.buffer);
  header.set([0x44, 0x44, 0x53, 0x20]);
  view.setUint32(4, 124, true);
  view.setUint32(8, 0x1 | 0x2 | 0x4 | 0x1000 | 0x20000, true);
  view.setUint32(12, size, true);
  view.setUint32(16, size, true);
  view.setUint32(28, levels, true);
  view.setUint32(76, 32, true);
  view.setUint32(80, 0x41, true);
  view.setUint32(88, 32, true);
  view.setUint32(92, 0xff0000, true);
  view.setUint32(96, 0xff00, true);
  view.setUint32(100, 0xff, true);
  view.setUint32(104, 0xff000000, true);
  view.setUint32(108, 0x1000 | 0x400000 | 0x8, true);
  const parts = [header];
  for (let level = 0; level < levels; level++) {
    const side = size >> level;
    const texels = new Uint8Array(side * side * 4);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const red = Math.round(127 + 100 * Math.sin((8 * Math.PI * x) / side) * Math.sin((8 * Math.PI * y) / side));
        texels.set([0, 128, red, 128], 4 * (y * side + x)); // B, G, R, A
      }
    }
    parts.push(texels);
  }
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) (out.set(part, at), (at += part.length));
  return out;
}

/** A folder standing in for the install's storage, and an extractor that copies its matching files out as stormex would. */
async function fakeInstall(root: string): Promise<{ install: string; tool: string }> {
  const install = path.join(root, "install");
  const put = async (relative: string, data: string | Uint8Array): Promise<void> => {
    await mkdir(path.dirname(path.join(install, relative)), { recursive: true });
    await writeFile(path.join(install, relative), data);
  };
  await put("mods/core.sc2mod/base.sc2data/GameData/TerrainTexData.xml", CORE_TEX);
  await put("mods/void.sc2mod/base.sc2data/GameData/TerrainTexData.xml", VOID_TEX);
  await put("mods/void.sc2mod/base.sc2data/GameData/TerrainData.xml", VOID_TERRAIN);
  await put("mods/void.sc2mod/base.sc2assets/Assets/Textures/ShakurasCity_2Normal.dds", normalMapDds(64));
  const tool = path.join(root, "fake-stormex.mjs");
  await writeFile(
    tool,
    `#!/usr/bin/env node
import { cpSync, readdirSync } from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const value = (flag) => args[args.indexOf(flag) + 1];
const [storage, pattern, out] = [value("-S"), new RegExp(value("-I"), "i"), value("-o")];
for (const file of readdirSync(storage, { recursive: true, withFileTypes: true })) {
  if (!file.isFile()) continue;
  const relative = path.relative(storage, path.join(file.parentPath, file.name));
  if (pattern.test(relative.split(path.sep).join("\\\\"))) cpSync(path.join(storage, relative), path.join(out, relative));
}
`,
  );
  await chmod(tool, 0o755);
  return { install, tool };
}

async function workspace(): Promise<{ root: string; blueprint: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-height-tuner-"));
  folders.push(root);
  await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixtures" }, missions: "missions" }));
  const blueprint = path.join(root, "missions", "field", "blueprint.json");
  await mkdir(path.dirname(blueprint), { recursive: true });
  await writeFile(blueprint, JSON.stringify({ id: "field", campaignId: "fixtures", tilesetId: "AiurTempleJungle" }));
  return { root, blueprint };
}

describe("the stock catalogs", () => {
  it("merge a texture's entry over the kind's default, leaving out nested fields", () => {
    const stock = stockTexture([CORE_TEX, VOID_TEX], "ShakurasCity2")!;
    expect(stock.fields).toEqual({ PhysicsMaterial: "Dirt", Texture: "Assets\\Textures\\ShakurasCity_2.dds", EditorIcon: "Assets\\Textures\\ShakurasCity_2.dds", Normalmap: "Assets\\Textures\\ShakurasCity_2Normal.dds" });
    expect(stockTexture([CORE_TEX, VOID_TEX], "NoSuchTexture")).toBeUndefined();
    expect(stockHeightMapEnabled([VOID_TERRAIN], "AiurTempleJungle")).toBe(true);
  });

  it("take a parent's fields under the entry's own", () => {
    const xml = `<Catalog><CTerrainTex id="Template"><Texture value="a.dds"/><TilingFreq value="2"/></CTerrainTex><CTerrainTex id="Child" parent="Template"><Texture value="b.dds"/></CTerrainTex></Catalog>`;
    expect(catalogEntries(xml, "CTerrainTex").map((entry) => entry.id)).toEqual(["Template", "Child"]);
    expect(stockTexture([xml], "Child")!.fields).toEqual({ Texture: "b.dds", TilingFreq: "2" });
  });
});

describe("the strips' paint", () => {
  it("holds the base at 15 everywhere and raises each strip from 0 to 15 in even steps", () => {
    const { width } = mapSize(2);
    const maskWidth = width * 8;
    const weights = stripWeights(2);
    const [left, bottom, right] = stripRect(1).map((cells) => cells * 8) as [number, number, number];
    const at = (x: number, y: number, layer: number): number => weights[(y * maskWidth + x) * 8 + layer]!;
    expect(at(0, 0, 0)).toBe(15);
    expect([at(left, bottom, 2), at(left + (right - left) / 2, bottom, 2), at(right - 1, bottom, 2)]).toEqual([0, STEPS / 2, 15]);
    expect(at(left, bottom, 1)).toBe(0);
    expect(at(right, bottom, 2)).toBe(0);
  });
});

describe("the package's slots", () => {
  it("names texture slots in t3Terrain.xml and the tileset override, with height blending on", () => {
    const names = ["Base", "Test", "Test_HtCrush25", "", "", "", "", ""];
    expect(withSlotNames('<texture i="0" name="Base"/>\n<texture i="1" name="Test"/>\n<texture i="2" name=""/>\n<texture i="3" name=""/>\n<texture i="4" name=""/>\n<texture i="5" name=""/>\n<texture i="6" name=""/>\n<texture i="7" name=""/>', names)).toContain('<texture i="2" name="Test_HtCrush25"/>');
    const data = withSlots('<Catalog>\n    <CTerrain id="T">\n        <BlendTextures index="0" value="Base"/>\n        <Light value="X"/>\n    </CTerrain>\n</Catalog>\n', "T", names);
    expect(data).toContain('<Light value="X"/>');
    expect(data.match(/<BlendTextures /g)).toHaveLength(8);
    expect(data).toContain('<BlendTextures index="2" value="Test_HtCrush25"/>');
    expect(data).toContain('<HeightMapEnabled value="1"/>');
    expect(() => withSlots("<Catalog/>", "T", names)).toThrow(/no <CTerrain id="T">/);
  });
});

describe("buildTestMap", () => {
  it("compiles the map, gives each variant its slot, entry and normal map, paints the strips and writes the Shots", async () => {
    const { root, blueprint } = await workspace();
    const { install, tool } = await fakeInstall(root);
    const variants = parseVariants(DEFAULT_VARIANTS);
    const report = await buildTestMap({ blueprintPath: blueprint, texture: "ShakurasCity2", variants, install, tool });

    expect(report.red.kind).toBe("height");
    expect(report.stockHeightBlending).toBe(true);
    expect(report.strips.map((strip) => strip.textureId)).toEqual(["ShakurasCity2", "ShakurasCity2_HtCrush15", "ShakurasCity2_HtCrush25", "ShakurasCity2_HtCrush40", "ShakurasCity2_HtInvertedCrush15", "ShakurasCity2_HtInvertedCrush25", "ShakurasCity2_HtInvertedCrush40"]);
    expect(report.strips[2]!.zeroShare).toBeCloseTo(0.25, 1);

    const map = report.mapPath;
    const terrain = await readFile(path.join(map, "t3Terrain.xml"), "utf8");
    expect(terrain).toContain('<texture i="0" name="BelShirGrassLightEx2"/>');
    expect(terrain).toContain('<texture i="7" name="ShakurasCity2_HtInvertedCrush40"/>');
    const data = await readFile(path.join(map, "Base.SC2Data", "GameData", "TerrainData.xml"), "utf8");
    expect(data).toContain('<BlendTextures index="4" value="ShakurasCity2_HtCrush40"/>');
    expect(data).toContain('<HeightMapEnabled value="1"/>');

    const catalog = await readFile(path.join(map, "Base.SC2Data", "GameData", "TerrainTexData.xml"), "utf8");
    expect(catalog.match(/<CTerrainTex /g)).toHaveLength(6);
    expect(catalog).toContain('<Normalmap value="Assets\\Textures\\HeightTune_ShakurasCity2_Crush25.dds"/>');
    expect(catalog).toContain('<Texture value="Assets\\Textures\\ShakurasCity_2.dds"/>');
    expect(catalog).not.toContain("DoodadEntry");

    // The crushed normal keeps G and A and puts a quarter of the top level's red at 0.
    const written = decodeDds(new Uint8Array(await readFile(path.join(map, "Assets", "Textures", "HeightTune_ShakurasCity2_Crush25.dds"))));
    const stock = decodeDds(normalMapDds(64));
    expect(written).toHaveLength(stock.length);
    const top = written[0]!.rgba;
    let zero = 0;
    for (let i = 0; i < top.length / 4; i++) {
      if (top[4 * i] === 0) zero++;
      expect([top[4 * i + 1], top[4 * i + 3]]).toEqual([stock[0]!.rgba[4 * i + 1], stock[0]!.rgba[4 * i + 3]]);
    }
    expect(zero / (top.length / 4)).toBeCloseTo(0.25, 1);

    const masks = readT3TextureMasks(await readFile(path.join(map, "t3TextureMasks")));
    const { width, height } = mapSize(variants.length);
    expect([masks.maskWidth, masks.maskHeight]).toEqual([width * 8, height * 8]);
    const [left, bottom, right] = stripRect(6).map((cells) => cells * 8) as [number, number, number];
    expect([masks.layers[7]![bottom * masks.maskWidth + left], masks.layers[7]![bottom * masks.maskWidth + right - 1], masks.layers[0]![0]]).toEqual([0, 15, 15]);

    const shots = JSON.parse(await readFile(report.shotsPath, "utf8")) as { shots: { rect: number[]; label: string }[] };
    expect(shots.shots).toHaveLength(7);
    expect(shots.shots[1]!.label).toBe("2. crush 15% (0 to 100% left to right)");
    for (const { rect } of shots.shots) expect(rect[0]! >= 0 && rect[1]! >= 0 && rect[2]! <= width && rect[3]! <= height).toBe(true);
    expect(existsSync(path.join(path.dirname(report.shotsPath), "tune.json"))).toBe(true);
  });

  it("refuses a texture the stock catalogs don't have, and the base as the texture to tune", async () => {
    const { root, blueprint } = await workspace();
    const { install, tool } = await fakeInstall(root);
    await expect(buildTestMap({ blueprintPath: blueprint, texture: "Nope", variants: parseVariants("stock"), install, tool })).rejects.toThrow(/No stock CTerrainTex is called Nope/);
    await expect(buildTestMap({ blueprintPath: blueprint, texture: "BelShirGrassLightEx2", variants: parseVariants("stock"), install, tool })).rejects.toThrow(/both BelShirGrassLightEx2/);
  });
});
