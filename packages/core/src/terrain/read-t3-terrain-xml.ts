import { xmlElement, xmlElements } from "../map/xml-elements.js";

export type T3TerrainRamp = {
  readonly dir: number;
  readonly hi: number;
  readonly lo: number;
  /** Centre of the ramp's base edge, in cells. */
  readonly base: { readonly x: number; readonly y: number };
  /** Width of the ramp's base edge, in cells. */
  readonly width: number;
};

export type T3TerrainCliffCell = {
  /** Index into the cliff-cell grid, which has one cell per 2x2 terrain cells. */
  readonly index: number;
  readonly flags: number;
  /** Index into `cliffSets`. */
  readonly cliffSet: number;
  readonly variation: number;
};

export type T3Terrain = {
  readonly version: number;
  readonly tilesetId: string;
  /** Cells: vertex dims minus one. */
  readonly width: number;
  readonly height: number;
  readonly quantizeBias: number;
  readonly quantizeScale: number;
  readonly cliffSets: readonly string[];
  readonly ramps: readonly T3TerrainRamp[];
  /** Up to 8 texture-set (tileset) names; each owns 8 consecutive `textures`. */
  readonly textureSets: readonly string[];
  /** 64 blend texture names: set `s`, mask layer `l` is `textures[s * 8 + l]`. */
  readonly textures: readonly string[];
  /** Texture set per 8x8-cell block, row-major from y = 0. */
  readonly blockTextureSets: readonly number[];
  readonly cliffCellGridWidth: number;
  readonly cliffCells: readonly T3TerrainCliffCell[];
  readonly cliffDoodads: readonly { readonly name: string; readonly x: number; readonly y: number; readonly z: number; readonly rot: number }[];
};

function nums(value: string | undefined): number[] {
  return (value ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
}

/** `u(..) r(..) c=(x, y) w=.. h=..` -> centre and width. */
function rampEdge(value: string | undefined): { x: number; y: number; w: number } {
  const c = /c=\(([^,]+),\s*([^)]+)\)/.exec(value ?? "");
  const w = /w=([^\s]+)/.exec(value ?? "");
  return { x: Number(c?.[1] ?? 0), y: Number(c?.[2] ?? 0), w: Number(w?.[1] ?? 0) };
}

function indexedNames(xml: string, tag: string, count: number): string[] {
  const names = new Array<string>(count).fill("");
  for (const { attrs } of xmlElements(xml, tag)) names[Number(attrs.i)] = attrs.name ?? "";
  return names;
}

/** Reads t3Terrain.xml as the Editor saves it (version 115). */
export function readT3TerrainXml(xml: string): T3Terrain {
  const terrain = xmlElement(xml, "terrain");
  const heightMap = xmlElement(xml, "heightMap");
  if (!heightMap) throw new Error("t3Terrain.xml: no <heightMap>");
  const [vertexWidth = 0, vertexHeight = 0] = nums(heightMap.attrs.dim);
  const width = vertexWidth - 1;
  const height = vertexHeight - 1;
  const vertData = xmlElement(xml, "vertData");

  const ramps = xmlElements(xml, "ramp").map(({ attrs }) => {
    const base = rampEdge(attrs.base);
    return { dir: Number(attrs.dir), hi: Number(attrs.hi), lo: Number(attrs.lo), base: { x: base.x, y: base.y }, width: base.w };
  });

  const blockTextureSets: number[] = [];
  for (const { attrs } of xmlElements(xml, "blockTextureSet")) blockTextureSets[Number(attrs.i)] = Number(attrs.tileSet ?? 0);

  return {
    version: Number(terrain?.attrs.version ?? 0),
    tilesetId: heightMap.attrs.tileSet ?? "",
    width,
    height,
    quantizeBias: Number(vertData?.attrs.quantizeBias ?? 9),
    quantizeScale: Number(vertData?.attrs.quantizeScale ?? 2.746134e-4),
    cliffSets: indexedNames(xml, "cliffSet", Number(xmlElement(xml, "cliffSetList")?.attrs.num ?? 0)),
    ramps,
    textureSets: indexedNames(xml, "textureSet", 8),
    textures: indexedNames(xml, "texture", 64),
    blockTextureSets,
    cliffCellGridWidth: Math.floor(width / 2),
    cliffCells: xmlElements(xml, "cc").map(({ attrs }) => ({
      index: Number(attrs.i),
      flags: Number(attrs.f ?? 1),
      cliffSet: Number(attrs.cid ?? 0),
      variation: Number(attrs.cvar ?? 0),
    })),
    cliffDoodads: xmlElements(xml, "cliffDoodad").map(({ attrs }) => {
      const [x = 0, y = 0, z = 0] = nums(attrs.pos);
      return { name: attrs.name ?? "", x, y, z, rot: Number(attrs.rot ?? 0) };
    }),
  };
}

/** Texture name for a mask layer at a cell, via that cell's block texture set. */
export function textureAt(terrain: T3Terrain, cellX: number, cellY: number, layer: number): string {
  const blocksPerRow = Math.floor(terrain.width / 8);
  const set = terrain.blockTextureSets[Math.floor(cellY / 8) * blocksPerRow + Math.floor(cellX / 8)] ?? 0;
  return terrain.textures[set * 8 + layer] ?? "";
}
