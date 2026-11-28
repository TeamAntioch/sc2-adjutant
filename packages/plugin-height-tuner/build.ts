// One texture's test map: a small flat map of the base texture with a strip per variant, where the
// test texture's paint rises from 0 to 15/15 along the strip over the base held at 15/15.
//
// The map is a generated Mission Blueprint compiled by core into the Mission's git-ignored output,
// on the Mission's tileset (its lighting) with a set of two textures, the base and the test
// texture. The build then dresses the package: slots 2-7 get the variants' CTerrainTex copies (in
// t3Terrain.xml, t3SyncTextureInfo and the tileset override in TerrainData.xml, which also turns
// height blending on), t3TextureMasks gets the strips, and the variants' entries and normal maps
// go in as map-local data (Base.SC2Data/GameData/TerrainTexData.xml, Assets/Textures/).

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  compileMission,
  decodeDds,
  ddsLayout,
  recolourDdsAt,
  TEXELS_PER_CELL,
  workspaceFor,
  writeT3SyncTextureInfo,
  writeT3TextureMasks,
} from "@team-antioch/sc2-adjutant/plugin-sdk";

import { correlation, downsampled, flattenBands, type Height, integrateNormal, meanOf, readRed, type RedReading, redHeight, zeroShare } from "./heights.ts";
import { CATALOG_PATTERNS, extract, filesByLowerPath, findExtracted, gameFile, readCatalogs, stockHeightMapEnabled, stockTexture, type StockTexture } from "./stock.ts";
import { needsNormalMap, type Variant, variantHeight, variantLabel, variantName, variantRecipe, variantSuffix } from "./variants.ts";

/** The texture the strips are painted over unless told otherwise: the Bel'Shir grass the first texture was tuned on. */
export const DEFAULT_BASE = "BelShirGrassLightEx2";

// The layout, in cells. A strip is 32 cells long (16 steps of 2 cells) and 6 wide, with 10 cells of
// plain base between strips, so a Shot of half a strip shows none of the next. The margin keeps
// every Shot clear of the camera's bounds at the map's edge.
export const STRIP_LENGTH = 32;
export const STRIP_WIDTH = 6;
export const STRIP_GAP = 10;
export const MARGIN = 24;
/** Weight steps along a strip: 0 to 15 of 15. */
export const STEPS = 16;
/** A Shot frames half a strip (8 of its 16 steps) with a cell to spare each end, close enough to judge the ground. */
const SHOT_MARGIN = 1;
/** The two passes: each strip's low half, then its high half. */
export const PASSES = [
  { from: 0, label: "0-50%" },
  { from: 0.5, label: "50-100%" },
] as const;

/** The CTerrainTex fields a variant copies from the stock entry: what makes it look and blend as the stock one does. */
const COPIED_FIELDS = ["Texture", "EditorIcon", "Normalmap", "PhysicsMaterial", "TilingFreq", "POMScale", "HeightMapScale", "HeightMapOffset"] as const;

export type TuneOptions = {
  /** The Mission whose output the map goes in, and whose tileset (its lighting) the map is on. */
  readonly blueprintPath: string;
  readonly texture: string;
  readonly base?: string;
  readonly variants: readonly Variant[];
  /** The StarCraft II install, for its CASC storage. */
  readonly install: string;
  /** The CASC extractor; by default SC2_CASC_TOOL's. */
  readonly tool?: string;
  /** Degrees down from level for the Shots; the capture's default high view when unset. */
  readonly pitch?: number;
  readonly log?: (line: string) => void;
};

export type StripReport = {
  readonly variant: string;
  readonly label: string;
  readonly recipe: string;
  /** The CTerrainTex the strip is painted with: the stock id, or the variant's map-local copy. */
  readonly textureId: string;
  /** The normal map it names, in the map or the game. */
  readonly normalMap: string;
  readonly heightMapScale?: string;
  readonly heightMapOffset?: string;
  /** Its height's mean (0..1) and the share of the tile at 0, where the base shows through. */
  readonly heightMean: number;
  readonly zeroShare: number;
  /** [left, bottom, right, top] in cells: weight 0 at the left, 15/15 at the right. */
  readonly rect: readonly [number, number, number, number];
};

export type TuneReport = {
  readonly texture: string;
  readonly base: string;
  readonly tileset: string;
  readonly mapPath: string;
  readonly shotsPath: string;
  /** What the stock normal map's red channel holds, and so where the variants' heights came from. */
  readonly red: RedReading;
  readonly heightSource: "red channel" | "integrated from the normal";
  /** For a texture whose red channel is a height: how the integrated height agrees with it (about 0.9 when the sign is right). */
  readonly integratedAgreement?: number;
  /** Whether the tileset height-blends in stock data; the test map turns it on either way. */
  readonly stockHeightBlending: boolean | undefined;
  readonly strips: readonly StripReport[];
  readonly warnings: readonly string[];
};

/** The tuner's folder for one texture in a Mission's output. */
export const tuneFolder = (blueprintPath: string, texture: string): string => path.join(path.dirname(blueprintPath), "output", "height-tuner", texture);

/** Where a texture's stock files are extracted to: its own folder, so tuners run side by side don't share one. */
const extractFolder = (folder: string): string => path.join(folder, "extract");

/** The Still Review set a texture's strips are judged in. */
export const reviewSet = (texture: string): string => `height-${texture.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/** Cells: a strip's rectangle, by its index from the bottom. */
export function stripRect(index: number): [number, number, number, number] {
  const bottom = MARGIN + index * (STRIP_WIDTH + STRIP_GAP);
  return [MARGIN, bottom, MARGIN + STRIP_LENGTH, bottom + STRIP_WIDTH];
}

/** The map's size for `strips` strips, each side a multiple of 8 (the texture blocks). */
export function mapSize(strips: number): { readonly width: number; readonly height: number } {
  const up = (value: number): number => Math.ceil(value / 8) * 8;
  return { width: up(2 * MARGIN + STRIP_LENGTH), height: up(2 * MARGIN + strips * STRIP_WIDTH + (strips - 1) * STRIP_GAP) };
}

/**
 * Each texel's 8 layer weights (0..15), [texel * 8 + layer], rows from the bottom: the base on
 * layer 0 at 15 everywhere, strip i on layer i + 1 rising from 0 to 15 across it in STEPS steps.
 */
export function stripWeights(strips: number): Uint8Array {
  const { width, height } = mapSize(strips);
  const [maskWidth, maskHeight] = [width * TEXELS_PER_CELL, height * TEXELS_PER_CELL];
  const weights = new Uint8Array(maskWidth * maskHeight * 8);
  for (let texel = 0; texel < maskWidth * maskHeight; texel++) weights[texel * 8] = 15;
  const stepTexels = (STRIP_LENGTH * TEXELS_PER_CELL) / STEPS;
  for (let strip = 0; strip < strips; strip++) {
    const [left, bottom, right, top] = stripRect(strip).map((cells) => cells * TEXELS_PER_CELL) as [number, number, number, number];
    for (let y = bottom; y < top; y++) for (let x = left; x < right; x++) weights[(y * maskWidth + x) * 8 + strip + 1] = Math.min(15, Math.floor((x - left) / stepTexels));
  }
  return weights;
}

/**
 * The Shots of a test map, in two passes: every strip's low half (paint 0-50%, its left), then
 * every strip's high half (50-100%, its right), so the page shows the variants side by side at the
 * same weights. Each frames 18×8 cells, `close`, so the camera comes nearer than the player's own
 * (which shows about 32 cells across) and the ground's detail shows.
 */
export function stripShots(variants: readonly Variant[], pitch?: number): { rect: [number, number, number, number]; label: string; close: true; pitch?: number }[] {
  return PASSES.flatMap((pass) =>
    variants.map((variant, index) => {
      const [left, bottom, right, top] = stripRect(index);
      const start = left + pass.from * (right - left);
      return {
        rect: [start - SHOT_MARGIN, bottom - SHOT_MARGIN, start + (right - left) / 2 + SHOT_MARGIN, top + SHOT_MARGIN] as [number, number, number, number],
        label: `${index + 1}. ${variantLabel(variant)}, ${pass.label}`,
        close: true as const,
        ...(pitch !== undefined ? { pitch } : {}),
      };
    }),
  );
}

/** The CTerrainTex id of a variant's copy: `ShakurasCity2_HtCrush28`. */
export const variantTextureId = (texture: string, variant: Variant): string => `${texture}_Ht${variantSuffix(variant)}`;

/** The map path of a variant's normal map. */
export const variantNormalPath = (texture: string, variant: Variant): string => `Assets\\Textures\\HeightTune_${texture}_${variantSuffix(variant)}.dds`;

const xmlAttribute = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The map-local TerrainTexData.xml: a full copy of the stock entry per variant, with its own normal map, scale and offset. */
export function variantCatalog(stock: StockTexture, variants: readonly Variant[]): string {
  const entries = variants
    .filter((variant) => needsNormalMap(variant) || variant.scale !== undefined || variant.offset !== undefined)
    .map((variant) => {
      const fields: Record<string, string> = {};
      for (const name of COPIED_FIELDS) if (stock.fields[name] !== undefined) fields[name] = stock.fields[name]!;
      if (needsNormalMap(variant)) fields.Normalmap = variantNormalPath(stock.id, variant);
      if (variant.scale !== undefined) fields.HeightMapScale = String(variant.scale);
      if (variant.offset !== undefined) fields.HeightMapOffset = String(variant.offset);
      const lines = Object.entries(fields).map(([name, value]) => `        <${name} value="${xmlAttribute(value)}"/>`);
      return [`    <CTerrainTex id="${variantTextureId(stock.id, variant)}">`, ...lines, "    </CTerrainTex>"].join("\n");
    });
  return ['<?xml version="1.0" encoding="utf-8"?>', "<Catalog>", ...entries, "</Catalog>", ""].join("\n");
}

/** `xml`'s tileset override (the compile's map-local CTerrain) with the 8 slots `names` and height blending on. */
export function withSlots(terrainData: string, tileset: string, names: readonly string[]): string {
  const opening = new RegExp(`<CTerrain id="${tileset}">`);
  const at = terrainData.search(opening);
  if (at < 0) throw new Error(`The compiled map's TerrainData.xml has no <CTerrain id="${tileset}"> override to put the variants in`);
  const end = terrainData.indexOf("</CTerrain>", at);
  const body = terrainData
    .slice(at, end)
    .split("\n")
    .filter((line) => !/<(BlendTextures|HeightMapEnabled)\b/.test(line))
    .join("\n")
    .replace(/\s*$/, "");
  const added = [...names.map((name, index) => `        <BlendTextures index="${index}" value="${name}"/>`), '        <HeightMapEnabled value="1"/>'];
  return `${terrainData.slice(0, at)}${body}\n${added.join("\n")}\n    ${terrainData.slice(end)}`;
}

/** `xml` (t3Terrain.xml) with texture slots 0-7 named `names`. */
export function withSlotNames(terrainXml: string, names: readonly string[]): string {
  let out = terrainXml;
  names.forEach((name, slot) => {
    const line = new RegExp(`(<texture i="${slot}" name=")[^"]*(")`);
    if (!line.test(out)) throw new Error(`The compiled map's t3Terrain.xml has no texture slot ${slot}`);
    out = out.replace(line, `$1${name}$2`);
  });
  return out;
}

/** The tileset a test map is on: the Mission's, for its lighting, else BelShirEx2 (the default base's). */
export const testTileset = (mission: { readonly tilesetId?: string }): string => mission.tilesetId ?? "BelShirEx2";

/** The generated Blueprint the test map is compiled from. */
export function testBlueprint(mission: { readonly campaignId: string; readonly tilesetId?: string; readonly lighting?: string }, texture: string, base: string, strips: number): Record<string, unknown> {
  const { width, height } = mapSize(strips);
  const tilesetId = testTileset(mission);
  return {
    id: `height-tune-${texture.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    campaignId: mission.campaignId,
    title: `Height Tune ${texture}`,
    summary: `Height-map test strips of ${texture} over ${base}, written by the height-tuner Utility.`,
    setting: "A flat test field.",
    mapSize: { width, height },
    tilesetId,
    ...(mission.lighting !== undefined ? { lighting: mission.lighting } : {}),
    textures: [base, texture],
    zones: [
      {
        id: "ground",
        name: "Ground",
        elevation: 1,
        landform: "flat",
        role: "base",
        texture: base,
        polygon: [
          { x: 0, y: 0 },
          { x: width, y: 0 },
          { x: width, y: height },
          { x: 0, y: height },
        ],
        connections: [],
      },
    ],
    anchors: [],
    beats: [{ id: "look", title: "Look", summary: "Judge the strips.", zoneIds: ["ground"], anchorIds: [] }],
    screenplay: { title: `Height Tune ${texture}`, scenes: [] },
  };
}

/** The level the highest stones keep in a variant: the stock red's top for a real height, else a little under 1, as the stock tops are. */
const topLevel = (red: RedReading): number => (red.kind === "height" ? red.max / 255 : 0.96);

/** Builds one texture's test map and its Shots; returns what it wrote. */
export async function buildTestMap(options: TuneOptions): Promise<TuneReport> {
  const log = options.log ?? (() => undefined);
  const base = options.base ?? DEFAULT_BASE;
  const { texture, variants, blueprintPath } = options;
  if (texture === base) throw new Error(`The texture to tune and the base are both ${texture}: the strips need a base texture of another kind under them`);
  const warnings: string[] = [];
  const mission = JSON.parse(await readFile(blueprintPath, "utf8")) as { campaignId: string; tilesetId?: string; lighting?: string };
  const tileset = testTileset(mission);
  const folder = tuneFolder(blueprintPath, texture);
  await mkdir(folder, { recursive: true });

  // The stock catalogs, then the texture's normal map, from this machine's install.
  const extracted = extractFolder(folder);
  let files = await filesByLowerPath(extracted);
  if (!files.has("mods/core.sc2mod/base.sc2data/gamedata/terraintexdata.xml")) {
    log(`Extracting the stock terrain catalogs from ${options.install}`);
    await extract(options.install, CATALOG_PATTERNS, extracted, options.tool);
    files = await filesByLowerPath(extracted);
  }
  const catalogs = await readCatalogs(files);
  if (catalogs.textures.length === 0) throw new Error(`No stock TerrainTexData.xml came out of ${options.install}: is it a StarCraft II install?`);
  const stock = stockTexture(catalogs.textures, texture);
  if (!stock) throw new Error(`No stock CTerrainTex is called ${texture}`);
  if (!stockTexture(catalogs.textures, base)) throw new Error(`No stock CTerrainTex is called ${base} (the base)`);
  const normalGamePath = stock.fields.Normalmap;
  if (!normalGamePath) throw new Error(`${texture} names no Normalmap, so it has no height to tune`);
  const normal = gameFile(normalGamePath);
  let normalFile = findExtracted(files, normal.tail);
  if (!normalFile) {
    log(`Extracting ${normalGamePath}`);
    await extract(options.install, [normal.pattern], extracted, options.tool);
    files = await filesByLowerPath(extracted);
    normalFile = findExtracted(files, normal.tail);
    if (!normalFile) throw new Error(`${texture}'s normal map ${normalGamePath} isn't in ${options.install}'s storage (13 stock textures name files that aren't)`);
  }

  // The heights.
  const normalData = new Uint8Array(await readFile(normalFile));
  const layout = ddsLayout(normalData);
  if (layout.width !== layout.height) throw new Error(`${normalGamePath} is ${layout.width}×${layout.height}; the tuner reads square normal maps`);
  const top = decodeDds(normalData)[0]!;
  const red = readRed(top.rgba);
  const integrate = (): Height => integrateNormal(top.rgba, top.width);
  const source = red.kind === "height" ? redHeight(top.rgba, top.width) : integrate();
  const heightSource = red.kind === "height" ? "red channel" : "integrated from the normal";
  let integratedAgreement: number | undefined;
  if (red.kind === "height") {
    // The sign check the research asked for: the integrated height should agree with Blizzard's.
    integratedAgreement = correlation(integrate(), source);
    if (integratedAgreement < 0.5) warnings.push(`${texture}'s height integrated from its normal agrees with its red channel at only ${integratedAgreement.toFixed(2)}: its red channel may not be the height its normal shows`);
  } else {
    warnings.push(`${texture}'s red channel is ${red.kind === "flat" ? `flat (${Math.round(red.mean)} everywhere)` : "a copy of its normal's Y, not a height"}: the variants' heights are integrated from its normal instead`);
  }
  const flattened = flattenBands(source);

  // The test map.
  const blueprintFile = path.join(folder, "blueprint.json");
  await writeFile(blueprintFile, `${JSON.stringify(testBlueprint(mission, texture, base, variants.length), null, 2)}\n`);
  const mapPath = path.join(folder, `HeightTune${texture}.SC2Map`);
  await rm(mapPath, { recursive: true, force: true });
  log(`Compiling the test map into ${mapPath}`);
  const compiled = await compileMission(await workspaceFor(blueprintFile), blueprintFile, mapPath);
  warnings.push(...compiled.warnings);

  const strips: StripReport[] = [];
  const slotNames = [base];
  const assets = path.join(mapPath, "Assets", "Textures");
  for (const [index, variant] of variants.entries()) {
    const own = needsNormalMap(variant) || variant.scale !== undefined || variant.offset !== undefined;
    const textureId = own ? variantTextureId(texture, variant) : texture;
    slotNames.push(textureId);
    const height = variantHeight(variant, source, flattened, topLevel(red));
    let normalMap = normalGamePath;
    if (height) {
      normalMap = variantNormalPath(texture, variant);
      const levels = new Map<number, Height>();
      const atSize = (size: number): Height => levels.get(size) ?? (levels.set(size, downsampled(height, size)), levels.get(size)!);
      const written = recolourDdsAt(normalData, ([, g, b], x, y, width) => [atSize(width).values[y * width + x]! * 255, g, b]);
      await mkdir(assets, { recursive: true });
      await writeFile(path.join(assets, path.basename(normalMap.split("\\").join("/"))), written);
    }
    const shown = height ?? source;
    strips.push({
      variant: variantName(variant),
      label: variantLabel(variant),
      recipe: variantRecipe(variant),
      textureId,
      normalMap,
      ...(variant.scale !== undefined || stock.fields.HeightMapScale !== undefined ? { heightMapScale: String(variant.scale ?? stock.fields.HeightMapScale) } : {}),
      ...(variant.offset !== undefined || stock.fields.HeightMapOffset !== undefined ? { heightMapOffset: String(variant.offset ?? stock.fields.HeightMapOffset) } : {}),
      heightMean: round(meanOf(shown)),
      zeroShare: round(zeroShare(shown)),
      rect: stripRect(index),
    });
  }
  while (slotNames.length < 8) slotNames.push("");

  // Dress the package: the slots, the strips' paint and the variants' data.
  const terrainXmlFile = path.join(mapPath, "t3Terrain.xml");
  await writeFile(terrainXmlFile, withSlotNames(await readFile(terrainXmlFile, "utf8"), slotNames));
  const terrainDataFile = path.join(mapPath, "Base.SC2Data", "GameData", "TerrainData.xml");
  await writeFile(terrainDataFile, withSlots(await readFile(terrainDataFile, "utf8"), tileset, slotNames));
  const { width, height } = mapSize(variants.length);
  const weights = stripWeights(variants.length);
  await writeFile(path.join(mapPath, "t3TextureMasks"), writeT3TextureMasks({ width, height, textureWeights: new Uint8Array(width * height * 8), texelWeights: weights }));
  const dominant = new Uint32Array(width * height);
  const [maskWidth, half] = [width * TEXELS_PER_CELL, TEXELS_PER_CELL / 2];
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const centre = ((cy * TEXELS_PER_CELL + half) * maskWidth + cx * TEXELS_PER_CELL + half) * 8;
      for (let layer = 1; layer < 8; layer++) if (weights[centre + layer]! > 7) dominant[cy * width + cx] = layer;
    }
  }
  await writeFile(path.join(mapPath, "t3SyncTextureInfo"), writeT3SyncTextureInfo({ width, height, textureSetCount: 1, textureNames: slotNames, dominantTextureIndices: dominant, textureSetIndices: new Uint32Array(width * height) }));
  const textureDataFile = path.join(mapPath, "Base.SC2Data", "GameData", "TerrainTexData.xml");
  if (existsSync(textureDataFile)) throw new Error(`The compiled map already has a TerrainTexData.xml, which the tuner would overwrite: ${textureDataFile}`);
  await writeFile(textureDataFile, variantCatalog(stock, variants));

  const shotsPath = path.join(folder, "shots.json");
  await writeFile(shotsPath, `${JSON.stringify({ shots: stripShots(variants, options.pitch) }, null, 2)}\n`);
  const report: TuneReport = {
    texture,
    base,
    tileset,
    mapPath,
    shotsPath,
    red,
    heightSource,
    ...(integratedAgreement !== undefined ? { integratedAgreement: round(integratedAgreement) } : {}),
    stockHeightBlending: stockHeightMapEnabled(catalogs.terrains, tileset),
    strips,
    warnings,
  };
  if (report.stockHeightBlending !== true) warnings.push(`${tileset} doesn't height-blend in stock data; the test map turns it on, so a Mission on ${tileset} needs it turned on too for its ground to look like this`);
  await writeFile(path.join(folder, "tune.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const round = (value: number): number => Math.round(value * 1000) / 1000;
