// A Mission's texture usage, read from its own Map Package (src/kept-terrain/texture-usage.ts,
// ADR-0016): what each slot of each texture set paints, by Zone, and what a proposed texture set
// over some of its generating Zones would reuse, need and free; and each stretch of boundary between
// sets that needs cover, rendered on request (kept-terrain/set-boundaries.ts). Reads; writes nothing.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { lookUpTextures } from "@team-antioch/sc2-asset-catalog/catalog/texture-catalog.js";

import { stockTextures } from "../catalog/stock-catalog.js";
import { generatingZones, listedZoneIds, textureSetOfZone } from "../domain/mission-blueprint.js";
import { ownedCells } from "../kept-terrain/generating-zones.js";
import { readCellFlagCells } from "../kept-terrain/kept-cliffs.js";
import { describeRegionUsage, paintRegionUsage, type RegionUsage } from "../kept-terrain/paint-region-usage.js";
import { type KeptTextures, readKeptTextures } from "../kept-terrain/paint-brushes.js";
import type { BoundaryStretch } from "../kept-terrain/set-boundaries.js";
import { cellZones, describeUsage, proposeSet, type SetProposal, textureUsage, type TextureUsage } from "../kept-terrain/texture-usage.js";
import { parseMissionBlueprint, type Workspace } from "../plugins/workspace.js";
import { clampCrop, cliffMask, CROP_MARGIN, type CropRect, windowCells } from "../study/render-crop.js";
import { darkenCells, enlarge, PX, renderTextureBlend, textureColours } from "../study/render-layers.js";
import { LAYERS } from "../terrain/texture-grid.js";
import { layerColours } from "./layer-colours.js";
import { missionMapPackage } from "./mission-package.js";
import type { RgbImage } from "./read-tga.js";

export type TextureUsageRequest = {
  /** A proposed set: its textures, and the generating Zones it would paint (by default the Blueprint's set of that id, when `set` names one). */
  readonly proposal?: { readonly textures?: readonly string[] | undefined; readonly zones?: readonly string[] | undefined; readonly set?: string | undefined };
  /** Render the boundary stretches over the ground round them. */
  readonly render?: boolean | undefined;
};

export type TextureUsageResult = {
  readonly usage: TextureUsage;
  /** Each of the Blueprint's Paint Regions, measured as painted beside its mix (ADR-0028). */
  readonly regions: readonly RegionUsage[];
  readonly proposal?: SetProposal;
  readonly text: string;
  readonly mapPackage: string;
  /** With `render`, when the map has a stretch to show: the stretches over the ground round them. */
  readonly render?: BoundaryRender;
};

/** A rectangle of cells, x and y its south-west corner. */
export type CellArea = CropRect;

export type BoundaryRender = {
  /** One view to each cluster of stretches, in the order of their first stretch, so sets far apart don't shrink into one map-wide picture. */
  readonly views: readonly { readonly area: CellArea; readonly image: RgbImage }[];
  /** Which colour is which, in every view: the kinds, then each texture. */
  readonly legend: Readonly<Record<string, string>>;
};

/** A render's legend as one line. */
export const legendLine = (render: BoundaryRender): string => Object.entries(render.legend).map(([what, colour]) => `${what}: ${colour}`).join(", ");

/** A view's cells, as texture_usage gives them: "cells 47-88 × 39-80". */
export const areaLine = ({ x, y, width, height }: CellArea): string => `cells ${x}-${x + width - 1} × ${y}-${y + height - 1}`;

/** The Mission's texture usage, and a proposal's, as above. */
export async function missionTextureUsage(workspace: Workspace, blueprintPath: string, request: TextureUsageRequest = {}): Promise<TextureUsageResult> {
  const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
  const mapPackage = await missionMapPackage(blueprintPath);
  for (const file of ["t3Terrain.xml", "t3TextureMasks", "t3SyncTextureInfo"]) {
    if (!existsSync(path.join(mapPackage, file))) throw new Error(`${mapPackage} has no ${file}: compile the Mission, or import a map for it, first`);
  }
  const textures = readKeptTextures(
    await readFile(path.join(mapPackage, "t3Terrain.xml"), "utf8"),
    await readFile(path.join(mapPackage, "t3TextureMasks")),
    await readFile(path.join(mapPackage, "t3SyncTextureInfo")),
  );
  const { width, height } = textures;
  const generating = generatingZones(blueprint);
  const { owned, owner } = ownedCells(blueprint, width, height);
  const cellFlags = await readCellFlagCells(mapPackage, width, height);
  const usage = textureUsage(textures, cellZones(width, height, blueprint.zones, { owned, owner, generating }), cellFlags);
  const shown = request.render && usage.boundaries.stretches.length ? { render: renderBoundaries(textures, usage.boundaries.stretches, cellFlags) } : {};
  const regions = paintRegionUsage(blueprint, textures);
  const regionLines = describeRegionUsage(regions);
  const describe = (...args: Parameters<typeof describeUsage>) => [describeUsage(...args), ...regionLines].join("\n");

  const asked = request.proposal;
  if (!asked) return { usage, regions, text: describe(usage), mapPackage, ...shown };
  const declared = asked.set === undefined ? undefined : blueprint.textureSets?.find((set) => set.id === asked.set);
  const proposed = asked.textures ?? declared?.textures;
  const zones = asked.zones ?? declared?.zones;
  if (!proposed || !zones) {
    const lacking = [!proposed && "textures", !zones && "zones"].filter(Boolean).join(" and ");
    throw new Error(asked.set !== undefined && !declared ? `The Blueprint has no texture set ${asked.set}: give the proposal's ${lacking}` : `A proposal needs its ${lacking}, or set: one of the Blueprint's textureSets`);
  }
  // A declared set's Zones are those it paints (its levels' too); a proposal's, those it lists.
  const sets = blueprint.textureSets ?? [];
  const zoneIds =
    asked.zones === undefined && declared
      ? [...textureSetOfZone(sets, blueprint.zones)].flatMap(([id, index]) => (sets[index] === declared ? [id] : []))
      : listedZoneIds({ zones }, blueprint.zones);
  lookUpTextures(stockTextures(), proposed);
  const indices = new Map(generating.map((zone, index) => [zone.id, index]));
  for (const id of zoneIds) {
    if (!indices.has(id)) throw new Error(`${id} isn't a generating Zone of the Blueprint: a texture set paints generating Zones ("terrain": "generate")`);
  }
  const wanted = new Set(zoneIds.map((id) => indices.get(id)!));
  const cells = Uint8Array.from(owner, (index, cell) => (owned[cell] && wanted.has(index) ? 1 : 0));
  // A set the Blueprint declares is in the package already once compiled: compare its Zones' cells as the set before it.
  const proposal = proposeSet(textures, usage, proposed, cells, owned);
  return { usage, regions, proposal, text: describe(usage, proposal, proposed), mapPackage, ...shown };
}

const COLOURS = { cut: [230, 30, 30], artifact: [230, 0, 200] } as const;

/** The cells a stretch's pixels cover, either side of its line: [x0, y0, x1, y1), x1 and y1 past the end. */
const stretchBox = (s: BoundaryStretch): [number, number, number, number] => (s.line === "x" ? [s.at - 1, s.from, s.at + 1, s.to + 1] : [s.from, s.at - 1, s.to + 1, s.at + 1]);

/** The stretches grouped where their boxes, `margin` cells round each (a cropped render's, by default), touch or overlap: each group with its padded box, in the order of its first stretch. */
export function stretchClusters(stretches: readonly BoundaryStretch[], margin = CROP_MARGIN): { box: [number, number, number, number]; stretches: BoundaryStretch[] }[] {
  let clusters = stretches.map((stretch) => {
    const [x0, y0, x1, y1] = stretchBox(stretch);
    return { box: [x0 - margin, y0 - margin, x1 + margin, y1 + margin] as [number, number, number, number], stretches: [stretch] };
  });
  // Merge until no two boxes meet: a merged box can reach a third.
  for (let merged = true; merged; ) {
    merged = false;
    const out: typeof clusters = [];
    for (const cluster of clusters) {
      const [ax0, ay0, ax1, ay1] = cluster.box;
      const into = out.find(({ box: [bx0, by0, bx1, by1] }) => ax0 <= bx1 && bx0 <= ax1 && ay0 <= by1 && by0 <= ay1);
      if (!into) {
        out.push(cluster);
        continue;
      }
      const [bx0, by0, bx1, by1] = into.box;
      into.box = [Math.min(ax0, bx0), Math.min(ay0, by0), Math.max(ax1, bx1), Math.max(ay1, by1)];
      into.stretches.push(...cluster.stretches);
      merged = true;
    }
    clusters = out;
  }
  return clusters;
}

/**
 * The stretches over the ground round them, as the paint brushes render it (each pixel 2×2 texels,
 * the textures' colours blended by weight, north up), cliff cells darkened: hard cuts red, artifacts
 * magenta, one pixel each side of the block edge, then scaled up as the brushes' renders are. One
 * view to each cluster of stretches ({@link stretchClusters}), so each stays readable.
 */
export function renderBoundaries(textures: KeptTextures, stretches: readonly BoundaryStretch[], cellFlags?: Uint8Array): BoundaryRender {
  const names = [...new Set(textures.slots.slice(0, textures.setCount * LAYERS))];
  const colours = textureColours(names);
  // Cliff cells darkened, as the brushes' area render has them.
  const cliffs = cliffMask(cellFlags, textures);
  const views = stretchClusters(stretches).map(({ box: [x0, y0, x1, y1], stretches: shown }) => {
    const area = clampCrop(x0, y0, x1, y1, textures);
    return { area, image: renderView(textures, shown, area, colours, windowCells(cliffs, area, textures.width)) };
  });
  const rgbOf = (colour: readonly number[]) => `rgb(${colour.join(",")})`;
  const legend: Record<string, string> = { "hard cut": rgbOf(COLOURS.cut), artifact: rgbOf(COLOURS.artifact), "under a cliff": "darkened" };
  for (const name of names) if (name) legend[name] = rgbOf(colours.get(name)!);
  return { views, legend };
}

function renderView(
  textures: KeptTextures,
  stretches: readonly BoundaryStretch[],
  crop: CellArea,
  colours: ReturnType<typeof textureColours>,
  cliffs: Uint8Array,
): RgbImage {
  const size = { width: crop.width, height: crop.height };
  const image = darkenCells(renderTextureBlend(size, textures.masks, crop, layerColours(textures, colours)), size, cliffs);
  const paint = (px: number, py: number, colour: readonly number[]) => {
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) return;
    image.rgb.set(colour, (py * image.width + px) * 3);
  };
  // Image rows run top-down, north up.
  const row = (cellY: number) => (size.height - 1 - (cellY - crop.y)) * PX;
  for (const s of stretches) {
    const colour = COLOURS[s.kind];
    for (let i = s.from; i <= s.to; i++) {
      for (let k = 0; k < PX; k++) {
        if (s.line === "x") for (const px of [(s.at - crop.x) * PX - 1, (s.at - crop.x) * PX]) paint(px, row(i) + k, colour);
        else for (const py of [row(s.at) + PX - 1, row(s.at) + PX]) paint((i - crop.x) * PX + k, py, colour);
      }
    }
  }
  return enlarge(image);
}
