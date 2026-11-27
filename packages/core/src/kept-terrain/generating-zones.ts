// Generating Zones beside Kept ground (ADR-0010, spec #247): a Zone flagged `terrain: "generate"`
// in a Mission with Kept terrain owns its cells, and the compile writes only those. The Zone is a
// compile-time edit of the package's own terrain, with the brushes' modules (kept-ground.ts,
// kept-cliffs.ts, cliff-brushes.ts, paint-brushes.ts):
//
// - **Its cells** are the 2×2 cliff cells wholly inside a generating Zone, so its cliffs sit on the
//   cliff grid. A vertex on the edge of those cells is a corner of a Kept cell as well, so it stays
//   as the package has it, and only the vertices inside change: every Kept cell keeps every byte,
//   unless the Zones' ground needs a wider quantization, which rewrites every vertex by less than a step.
// - **Cliff level.** Each corner of the cliff grid inside the cells goes to its Zone's elevation,
//   and the rest follows by the generator's rule (setCornerLevels). Where the Zone's level differs
//   from the Kept ground round it, its own edge cells become cliff, in the Zone's `cliff` set when
//   the map has it, else the set most of the Kept cliffs near it wear. Where a Connection crosses
//   into Kept ground the levels must agree (seamProblems, which the checker reports).
// - **Height.** The base layer is the generator's, blended over BLEND cells from the Kept ground's
//   height at the seam, so the ground meets without a step.
// - **Texture.** The cells are painted with the Zone's `texture`, by default the texture most of the
//   Kept ground round it has. A Zone in one of the Blueprint's `textureSets` is painted from that set,
//   whose blocks the compile moves it onto first (texture-sets.ts, ADR-0016); any other Zone from
//   the sets its cells' blocks are on, which must each hold its texture. A Zone owns its cells whole,
//   so they are painted up to a boundary between sets.
// - **Kept objects stay Kept.** A Kept doodad on the cells moves with the ground (as a height brush
//   moves it), the Zone's dressing keeps clear of it, and nothing is removed.
//
// The compile record lists the cells in each terrain file it writes, with a fingerprint of what it
// wrote there (terrainCellsFingerprint), so a hand edit in the Editor is found at the next compile
// and kept or discarded, cell by cell (findCellChanges).

import { type CompileRecordEntry, fingerprint } from "../domain/compile-record.js";
import { generatingZones, type MissionBlueprint } from "../domain/mission-blueprint.js";
import { expandDressing, type PlacedDoodad, type PlacedSetPiece } from "../dressing/expand-dressing.js";
import { readObjectsXml } from "../map/read-objects-xml.js";
import { bindLikeOriginal, blueprintPlugins } from "../plugins/plugin-api.js";
import { vertexHeightAt } from "../study/terrain-grid.js";
import { type CornerGrid } from "../terrain/cliffs.js";
import { hiddenCellMask, unownedHiddenWarning, writeHiddenBit } from "../terrain/hidden-cells.js";
import { containsPoint, rasterizeTerrain, type TerrainRasterizationResult } from "../terrain/rasterize.js";
import { readT3TerrainXml } from "../terrain/read-t3-terrain-xml.js";
import { readT3TextureMasks } from "../terrain/read-t3-texture-masks.js";
import { getTilesetCliffSets } from "../catalog/tileset-cliff-sets.js";
import { cellsMask } from "./area.js";
import { cornerGrid, setCornerLevels } from "./cliff-brushes.js";
import { cliffCellZone, zoneCliffChoices } from "../terrain/cliff-sets.js";
import { type CliffCellEntry, type KeptCliffs, writeKeptCliffs } from "./kept-cliffs.js";
import { decodeKeptGround, type KeptGround, setQuantization, writeKeptGround, type WrittenGround } from "./kept-ground.js";
import type { HeightQuantization } from "../terrain/write-t3-height-map.js";
import { cellSet, dominantLayer, findSlot, findTexture, type KeptTextures, paintRegionStroke, paintSlot, type PaintStroke, type PaintTarget, setTextures, slotTarget, usesSets, writePaint } from "./paint-brushes.js";
import { rasterisePaintRegions, type RasterisedRegion } from "../terrain/paint-regions.js";
import { setBoundaryWarnings } from "./set-boundaries.js";
import { planTextureSets, type TextureSetEntry, textureSetEntries, textureSetTerrainEntries, writeTextureSetXml } from "./texture-sets.js";

/** The terrain files a generating Zone writes, cell by cell, each listed on the compile record with its cells. */
export const ZONE_TERRAIN_FILES = ["t3HeightMap", "t3SyncHeightMap", "t3SyncCliffLevel", "t3CellFlags", "t3Terrain.xml", "t3TextureMasks", "t3SyncTextureInfo"] as const;
export type ZoneTerrainFile = (typeof ZONE_TERRAIN_FILES)[number];

/** Cells over which a Zone's ground blends from the Kept ground's height at its seam. */
export const BLEND = 3;
/** A Kept doodad whose ground moves less than this stays where it is. */
const MOVE_EPSILON = 1e-3;
/** Cliff cells round a Zone whose cliffs give it its cliff set. */
const NEAR = 4;
/** Cells round the Zones' cells within which a Kept doodad may crowd their dressing (past the largest doodad spacing). */
const NEAR_DOODAD = 8;

/** The Kept package's terrain, as the brushes read it. */
export type KeptTerrain = { readonly ground: KeptGround; readonly cliffs: KeptCliffs; readonly textures: KeptTextures; readonly objects: string | undefined };

export type ZoneGround = {
  /** 1 for each cell a generating Zone owns: [y * width + x]. */
  readonly owned: Uint8Array;
  /** Each terrain file as it is after the Zones, written over only in their cells. */
  readonly files: Readonly<Record<ZoneTerrainFile, Buffer | string>>;
  /** The compile record's terrain-cells entries: the cells in each file, fingerprinted as written. */
  readonly entries: readonly (Extract<CompileRecordEntry, { kind: "terrain-cells" }> & { readonly file: ZoneTerrainFile })[];
  /** The compile record's texture-set entries: the Blueprint's sets as written (ADR-0016). */
  readonly textureSets: readonly TextureSetEntry[];
  /** Whether the texture sets changed t3Terrain.xml's texture lines or blocks, or the sync file's sets, beyond the Zones' cells. */
  readonly textureSetsChanged: boolean;
  /** The sets' map-local CTerrain overrides (TerrainData.xml entries), one per set written. */
  readonly textureSetTerrain: readonly string[];
  /** The tilesets of the sets the compile leaves alone (kept), whose overrides stay as the package has them. */
  readonly keptSetTilesets: readonly string[];
  /** The Kept doodads that moved with the ground: their new heights, by Id. */
  readonly doodadHeights: ReadonlyMap<number, number>;
  readonly moved: readonly { readonly id: number; readonly type: string; readonly by: number }[];
  /** The Zones' dressing, standing in their cells, clear of Kept doodads, at the new ground's height. */
  readonly dressing: { readonly doodads: PlacedDoodad[]; readonly setPieces: PlacedSetPiece[]; readonly warnings: string[] };
  /** The terrain as written (writtenTerrain), the Kept ground with the Zones in it: what the dressing and the units stand on. */
  readonly terrain: TerrainRasterizationResult;
  /** The total height per vertex after the Zones. */
  readonly heights: Float32Array;
  /** Whether a cliff cell changed, which leaves the static shadow bake stale. */
  readonly cliffsChanged: boolean;
  readonly warnings: readonly string[];
};

const FOOT = "Nothing was compiled";

/**
 * The package's terrain with the Blueprint's generating Zones written into it, as above. `keptCells`
 * are cells the author kept from an earlier compile (a hand edit): no Zone writes them.
 */
export function generateBesideKept(
  blueprint: MissionBlueprint,
  kept: KeptTerrain,
  {
    keptCells,
    compiledObjects = new Set(),
    previousSets = [],
    keptSets = new Set(),
    keptTilesets = new Set(),
    hidden,
  }: {
    readonly keptCells?: Uint8Array;
    readonly compiledObjects?: ReadonlySet<number>;
    /** The last compile's texture-set entries, and the ids of the sets the author kept. */
    readonly previousSets?: readonly TextureSetEntry[];
    readonly keptSets?: ReadonlySet<string>;
    /** Tilesets the package's own TerrainData.xml overrides, which no set may take as its name. */
    readonly keptTilesets?: ReadonlySet<string>;
    /** Which of the Zones' cells (`owned`) take the hidden bit, and what; by default every one, from the Zones' hiddenCells. */
    readonly hidden?: (owned: Uint8Array) => { readonly writable: Uint8Array; readonly hidden: Uint8Array };
  } = {},
): ZoneGround {
  const { ground, cliffs, textures } = kept;
  const { width, height, columns } = ground;
  if (blueprint.mapSize.width !== width || blueprint.mapSize.height !== height) {
    throw new Error(`The Blueprint's mapSize is ${blueprint.mapSize.width}×${blueprint.mapSize.height}, but its Map Package's terrain is ${width}×${height}: set mapSize to the package's. ${FOOT}`);
  }
  const zones = generatingZones(blueprint);
  const warnings: string[] = [];
  const { owned, owner } = ownedCells(blueprint, width, height, keptCells);
  // The Blueprint's texture sets, and the blocks their Zones' cells are in moved onto them.
  const plan = blueprint.textureSets?.length || previousSets.length ? planTextureSets({ blueprint, textures, owned, owner, zones, previous: previousSets, keptIds: keptSets, keptTilesets }) : undefined;
  if (plan) warnings.push(...plan.warnings);

  // The cliff grid's corners inside the cells go to their Zone's elevation.
  const before = cornerGrid(ground);
  const after: CornerGrid = { ...before, levels: Uint8Array.from(before.levels) };
  const blocks = width / 2;
  const ownedBlock = (bx: number, by: number) => bx >= 0 && by >= 0 && bx < blocks && by < height / 2 && owned[2 * by * width + 2 * bx] === 1;
  for (let cy = 1; cy < before.rows - 1; cy++) {
    for (let cx = 1; cx < before.columns - 1; cx++) {
      if (![[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]].every(([bx, by]) => ownedBlock(bx!, by!))) continue;
      after.levels[cy * before.columns + cx] = zoneAt(zones, { x: 2 * cx, y: 2 * cy }, owner[2 * cy * width + 2 * cx]!).elevation;
    }
  }
  const sets = [...cliffs.cliffSets];
  // With no cell to write (every Zone Kept), no set is chosen, so a map without one isn't refused.
  // Each generating Zone's choice of cliff set (its own, else its group's), by its index among them.
  const choices = zoneCliffChoices(blueprint, zones);
  const chosen = owned.includes(1) ? cliffSetsFor(zones, choices, cliffs, sets, owned, width, height, warnings) : { fallback: undefined, byZone: new Map<number, number>() };
  const cliffEdit = setCornerLevels(ground, cliffs, before, after, { cliffSet: chosen.fallback, cliffSets: sets, foot: FOOT });
  // A Zone that names a cliff set (its own or its group's) wears it on the cliffs it made, by the
  // rule a generated map follows (cliffCellZone): the Zone on top, or the floor of a backdrop's wall.
  if (chosen.byZone.size > 0) {
    const cells = new Map(cliffEdit.cliffs.cells!);
    const zoneChoices = choices.map((choice, index) => (chosen.byZone.has(index) ? choice : undefined));
    const cornerZone = (cx: number, cy: number): number => {
      const cell = Math.min(2 * cy, height - 1) * width + Math.min(2 * cx, width - 1);
      return owned[cell] ? owner[cell]! : -1;
    };
    for (const [index, entry] of cells) {
      const [bx, by] = [index % blocks, Math.floor(index / blocks)];
      const cell = 2 * by * width + 2 * bx;
      const was = cliffs.cells.get(index);
      if (!owned[cell] || !(entry.f & 1) || (was && was.f === entry.f && was.cid === entry.cid)) continue;
      const corners = [[bx, by], [bx + 1, by], [bx, by + 1], [bx + 1, by + 1]]
        .filter(([x, y]) => x! < after.columns && y! < after.rows)
        .map(([x, y]) => ({ level: after.levels[y! * after.columns + x!]!, zone: cornerZone(x!, y!) }));
      // A cliff topped by Kept ground keeps its Zone's choice, as the cells it was made in.
      const zone = cliffCellZone(corners, zones, zoneChoices);
      const own = chosen.byZone.get(zone >= 0 ? zone : owner[cell]!);
      if (own === undefined) continue;
      cells.set(index, { ...entry, cid: own });
    }
    cliffEdit.cliffs = { ...cliffEdit.cliffs, cells };
  }
  // The Zones' hidden cells (zone.hiddenCells): their own cells take the hidden bit from the field,
  // less those the author kept as the Editor left them (src/map/hidden-cells-changes.ts), and every
  // other bit but the cliff one stays as the package has it.
  const field = hiddenCellMask(blueprint, width, height);
  const unowned = unownedHiddenWarning(field, owned, width);
  if (unowned) warnings.push(unowned);
  const hide = hidden ? hidden(owned) : { writable: owned, hidden: field };
  cliffEdit.cliffs = { ...cliffEdit.cliffs, cellFlags: writeHiddenBit(cliffEdit.cliffs.cellFlags!, hide.hidden, hide.writable) };

  // The base layer: the generator's, blended in from the Kept ground's height at the seam.
  const generator = generatorBlueprint(blueprint);
  const generated = rasterizeTerrain(generator);
  const interior = interiorVertices(owned, width, height);
  const blended = (on: KeptGround): Float64Array => {
    const { distance, seam } = seamDistances(interior, on.base, columns, height + 1);
    const base = Float64Array.from(on.base);
    for (let v = 0; v < base.length; v++) {
      if (!interior[v]) continue;
      const t = Math.min(1, distance[v]! / BLEND);
      const w = t * t * (3 - 2 * t);
      const own = generated.heights[v]! - generated.cliffHeights[v]!;
      base[v] = seam[v]! + w * (own - seam[v]!);
    }
    return base;
  };
  const first = writeKeptGround(ground, { base: blended(ground), cliff: cliffEdit.ground.cliff!, levels: cliffEdit.ground.levels! });
  // Ground higher (or lower) than the map's quantization holds widens it, as the Editor does (the
  // author's call, #525): every vertex is rewritten, each Kept one within a step of the new scale
  // of where it was, and <vertData> says so. Hand edits are found on heights to 0.01, so the
  // widening alone doesn't read as one. The seam's Kept heights moved with it, so the Zones'
  // ground is blended again from them, as the next compile would: compiled again, nothing changes.
  const written = first.requantized ? settle(first, first.requantized, blended) : first;
  if (written.requantized) {
    const { quantizeBias, quantizeScale } = written.requantized;
    warnings.push(
      `The generating Zones' ground needs more range than t3HeightMap's quantization gives (bias ${ground.quantizeBias}, scale ${ground.quantizeScale.toExponential(6)}), so it was widened to bias ${quantizeBias}, scale ${quantizeScale.toExponential(6)}, as the Editor does: every vertex of t3HeightMap is rewritten, Kept ones within ${quantizeScale.toExponential(2)} of their height`,
    );
  }
  const cliffFiles = writeKeptCliffs(cliffs, cliffEdit.cliffs);
  const terrainXml = cliffFiles["t3Terrain.xml"] ?? cliffs.xml;

  // Paint: each Zone's cells with its texture. On a map with one set, by slot, as the Zone's
  // texture names it; with several, by name, from the sets the cells' blocks are on.
  const base = plan?.textures ?? textures;
  const bySlot = !usesSets(base);
  const strokes: PaintStroke[] = [];
  let current = base;
  // Zones with a texture first; one without takes its neighbours' as this compile paints them,
  // counting only Kept cells and Zones painted already, so a second compile paints it the same.
  const pending = Uint8Array.from(owned);
  const order = [...zones.entries()].sort(([a, za], [b, zb]) => Number(za.texture === undefined) - Number(zb.texture === undefined) || a - b);
  for (const [index, zone] of order) {
    const cells = Uint8Array.from(owner, (o) => (o === index ? 1 : 0));
    if (!cells.includes(1)) continue;
    const mask = cellsMask(cells, width, height, zone.id);
    if (bySlot) {
      const slot = zone.texture === undefined ? surroundingSlot(current, cells, pending, width, height) : zoneSlot(base, zone.id, zone.texture);
      const stroke = paintSlot(current, mask, slotTarget(current, slot));
      strokes.push(stroke);
      current = { ...current, masks: stroke.masks };
      for (let cell = 0; cell < cells.length; cell++) if (cells[cell]) pending[cell] = 0;
      continue;
    }
    const set = plan?.setOfZone.get(zone.id);
    const target = zoneTarget(current, zone, set, cells, pending);
    const stroke = paintSlot(current, mask, target, { band: false });
    if (stroke.offSetBlocks.length > 0) {
      const blocks = stroke.offSetBlocks;
      const onSets = [...new Set(blocks.map((block) => current.blockSets[block]!))];
      throw new Error(
        `Zone ${zone.id}'s texture ${target.texture} isn't in texture set${onSets.length === 1 ? "" : "s"} ${onSets.join(", ")}, which ${blocks.length === 1 ? "block" : "blocks"} ${blocks.slice(0, 4).join(", ")}${blocks.length > 4 ? ` and ${blocks.length - 4} more` : ""} of its cells ${blocks.length === 1 ? "is" : "are"} on: add the Zone to a texture set holding it (textureSets[].zones), or paint it with a texture of those sets. ${FOOT}`,
      );
    }
    strokes.push(stroke);
    current = { ...current, masks: stroke.masks };
    for (let cell = 0; cell < cells.length; cell++) if (cells[cell]) pending[cell] = 0;
  }
  // Then the Paint Regions, in order, over the Zones' cells alone (ADR-0028), each from the set its cells' blocks are on.
  for (const region of keptPaintRegions(blueprint, current, zones, owner, owned)) {
    const stroke = paintRegionStroke(current, region);
    strokes.push(stroke);
    current = { ...current, masks: stroke.masks };
  }
  const paint = strokes.length ? writePaint(base, mergeStrokes(strokes)) : { masks: base.masksFile, sync: base.syncFile };
  if (plan) warnings.push(...setBoundaryWarnings(plan, current, cliffEdit.cliffs.cellFlags ?? cliffs.cellFlags));

  const files: Record<ZoneTerrainFile, Buffer | string> = {
    t3HeightMap: written.heightMap,
    t3SyncHeightMap: written.syncHeightMap,
    t3SyncCliffLevel: cliffFiles["t3SyncCliffLevel"] ?? cliffs.syncCliffFile,
    t3CellFlags: cliffFiles["t3CellFlags"] ?? cliffs.cellFlagsFile,
    "t3Terrain.xml": (() => {
      const xml = plan ? writeTextureSetXml(terrainXml, textures, plan) : terrainXml;
      return written.requantized ? setQuantization(xml, written.requantized) : xml;
    })(),
    t3TextureMasks: paint.masks,
    t3SyncTextureInfo: paint.sync,
  };
  const rects = cellRects(owned, width, height);
  const entries: ZoneGround["entries"] = rects.length
    ? ZONE_TERRAIN_FILES.map((file) => ({ kind: "terrain-cells" as const, file, cells: rects, fingerprint: terrainCellsFingerprint(file, files[file], owned, width, height, files["t3Terrain.xml"].toString()) }))
    : [];

  // Kept doodads on the cells move with the ground; the dressing keeps clear of every Kept doodad.
  const doodads = kept.objects === undefined ? [] : readObjectsXml(kept.objects).doodads.filter((doodad) => !compiledObjects.has(doodad.id));
  const doodadHeights = new Map<number, number>();
  const moved: { id: number; type: string; by: number }[] = [];
  for (const doodad of doodads) {
    const { x, y, z } = doodad.position;
    if (x < 0 || y < 0 || x >= width || y >= height || !owned[Math.floor(y) * width + Math.floor(x)]) continue;
    // HeightOffset alone makes z a height above the ground, which follows without a change.
    if (doodad.flags.includes("HeightOffset") && !doodad.flags.includes("HeightAbsolute")) continue;
    const by = vertexHeightAt(written.heights, columns, x, y) - vertexHeightAt(ground.heights, columns, x, y);
    if (Math.abs(by) < MOVE_EPSILON) continue;
    doodadHeights.set(doodad.id, z + by);
    moved.push({ id: doodad.id, type: doodad.type, by });
  }
  // Only Kept doodads near the cells can crowd the Zones' dressing.
  const bounds = boundsOf(owned, width, height);
  const standing = doodads
    .filter(({ position: { x, y } }) => x >= bounds.x0 - NEAR_DOODAD && x <= bounds.x1 + NEAR_DOODAD && y >= bounds.y0 - NEAR_DOODAD && y <= bounds.y1 + NEAR_DOODAD)
    .map((doodad) => ({ type: doodad.type, x: doodad.position.x, y: doodad.position.y, scale: Math.max(doodad.scale.x, doodad.scale.y, doodad.scale.z) }));
  // Dressed, and units placed, on the terrain as written: the Zones' cliffs against the Kept levels
  // at their seams, not the generator's for the Zones alone.
  const terrain = writtenTerrain(generated, written, cliffEdit, sets);
  const crossings = seamCrossings(blueprint);
  const dressed = owned.includes(1) ? expandDressing(generator, terrain, { standing, crossings }) : { doodads: [], setPieces: [], warnings: [] };
  const zoneDoodads = dressed.doodads.filter((doodad) => doodad.x >= 0 && doodad.y >= 0 && doodad.x < width && doodad.y < height && owned[Math.floor(doodad.y) * width + Math.floor(doodad.x)] === 1);
  // Set pieces in Kept Zones stand on the package's own ground, clear of its doodads and the Zones' dressing.
  const keptPieces = keptSetPieces(blueprint);
  const pieces = keptPieces
    ? expandDressing(keptPieces, terrain, {
        standing: [
          ...doodads.map((doodad) => ({ type: doodad.type, x: doodad.position.x, y: doodad.position.y, scale: Math.max(doodad.scale.x, doodad.scale.y, doodad.scale.z) })),
          ...zoneDoodads.map((doodad) => ({ type: doodad.type, x: doodad.x, y: doodad.y, scale: typeof doodad.scale === "number" ? doodad.scale : Math.max(...doodad.scale) })),
        ],
        crossings,
      })
    : { doodads: [], setPieces: [], warnings: [] };
  const dressing = {
    doodads: [...zoneDoodads, ...pieces.doodads],
    setPieces: [...dressed.setPieces, ...pieces.setPieces],
    warnings: [...dressed.warnings, ...pieces.warnings],
  };

  // A ramp into Kept ground is seamProblems' to report; one between two generating Zones is this one's.
  const generatingIds = new Set(zones.map((zone) => zone.id));
  if (zones.some((zone) => zone.connections.some((connection) => connection.type === "ramp" && generatingIds.has(connection.toZoneId)))) {
    warnings.push("Two generating Zones beside Kept ground have a ramp Connection between them, and ramps aren't generated there yet: add one with the add-ramp brush (edit-terrain) once the Zones are compiled");
  }
  const textureSets = plan ? textureSetEntries(plan, files["t3Terrain.xml"].toString()) : [];
  const textureSetsChanged = plan !== undefined && (plan.movedBlocks.length > 0 || plan.changedSlots.length > 0 || plan.renamedSets.length > 0 || plan.textures.setCount !== textures.setCount);
  const textureSetTerrain = plan ? textureSetTerrainEntries(plan) : [];
  return { owned, files, entries, textureSets, textureSetsChanged, textureSetTerrain, keptSetTilesets: plan?.keptTilesets ?? [], doodadHeights, moved, dressing, terrain, heights: written.heights, cliffsChanged: cliffEdit.cliffCells > 0, warnings };
}

/**
 * The terrain as the compile writes it, in the generator's shape for the dressing and the units:
 * the package's levels, heights, sync cliff levels, cell flags and cliff cells after the Zones. The
 * rest (textures, pathing paint) is the generator's for the Zones, which the compile doesn't write
 * beside Kept ground.
 */
/** The ground written once more over a widened write, blended from the seam as it now is. */
function settle(first: WrittenGround, quantize: HeightQuantization, blended: (on: KeptGround) => Float64Array): WrittenGround {
  const again = decodeKeptGround(first.heightMap, first.syncHeightMap, quantize);
  const second = writeKeptGround(again, { base: blended(again), cliff: again.cliff, levels: again.levels });
  if (second.requantized) throw new Error(`The generating Zones' ground still didn't fit t3HeightMap's quantization once it was widened. ${FOOT}`);
  return { ...second, changed: Uint8Array.from(first.changed, (value, v) => value | second.changed[v]!), requantized: quantize };
}

function writtenTerrain(
  generated: TerrainRasterizationResult,
  written: ReturnType<typeof writeKeptGround>,
  cliffEdit: { readonly ground: { readonly levels?: Uint8Array; readonly cliff?: Float64Array }; readonly cliffs: { readonly cells?: ReadonlyMap<number, CliffCellEntry>; readonly syncCliff?: Uint16Array; readonly cellFlags?: Uint8Array } },
  sets: readonly string[],
): TerrainRasterizationResult {
  const vertices = written.heights.length;
  const syncHeights = new Int16Array(vertices);
  for (let v = 0; v < vertices; v++) syncHeights[v] = written.syncHeightMap.readInt16LE(64 + v * 4);
  const cliffCells = [...(cliffEdit.cliffs.cells ?? [])]
    .filter(([, entry]) => entry.f & 3)
    .sort((a, b) => a[0] - b[0])
    .map(([index, entry]) => ({ index, variation: entry.cvar, flags: entry.f, ...(entry.cid ? { cliffSet: entry.cid } : {}) }));
  return {
    ...generated,
    syncCliff: cliffEdit.cliffs.syncCliff!,
    cellFlags: cliffEdit.cliffs.cellFlags!,
    heights: written.heights,
    cliffHeights: Float32Array.from(cliffEdit.ground.cliff!),
    vertexCliffLevels: cliffEdit.ground.levels!,
    syncHeights,
    cliffCells,
    cliffSets: [...sets],
    ramps: [],
    terrainObjects: [],
    terrainObjectWarnings: [],
  };
}

/** The Blueprint the dressing sees for set pieces in Kept Zones: those Zones and their set pieces alone, with no dressing of their own. */
function keptSetPieces(blueprint: MissionBlueprint): MissionBlueprint | undefined {
  const keptZones = blueprint.zones.filter((zone) => zone.terrain === "kept");
  const ids = new Set(keptZones.map((zone) => zone.id));
  const placements = blueprint.placements.filter((placement) => placement.kind === "set-piece" && ids.has(placement.zoneId));
  if (placements.length === 0) return undefined;
  const out: MissionBlueprint = {
    ...blueprint,
    zones: keptZones.map(({ edges: _edges, texture: _texture, ...zone }) => ({ ...zone, connections: [] })),
    placements,
    dressing: undefined,
    ramps: [],
    terrainObjects: [],
    water: [],
    raggedCliffs: 0,
  };
  return bindLikeOriginal(out, blueprint);
}

/**
 * The Blueprint's Paint Regions rasterised beside Kept ground: on the generating Zones' cells only
 * (`owner` indexes `zones`), each cell on its block's set as the package has it. A region naming a
 * texture that set lacks is refused, which the schema can't tell for a Zone in no texture set.
 */
function keptPaintRegions(blueprint: MissionBlueprint, textures: KeptTextures, zones: MissionBlueprint["zones"], owner: Int16Array, owned: Uint8Array): RasterisedRegion[] {
  if (!blueprint.paintRegions?.length) return [];
  try {
    return rasterisePaintRegions(blueprint.paintRegions, {
      width: textures.width,
      height: textures.height,
      owner,
      // A region's `zone` is a generating Zone (the schema's rule beside Kept ground).
      zones,
      setOf: (x, y) => cellSet(textures, x, y),
      setTextures: (set) => setTextures(textures, set),
      setLabel: (set) => `texture set ${set} (${textures.sets[set] || "unnamed"})`,
      paints: (cell) => owned[cell] === 1,
      patchPeriod: blueprintPlugins(blueprint).styleRules().varietyPatches?.period,
    });
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}. ${FOOT}`, { cause: error });
  }
}

/** The Blueprint the generator sees: the generating Zones alone, with straight outlines and no ramps, terrain objects or water of their own yet. */
function generatorBlueprint(blueprint: MissionBlueprint): MissionBlueprint {
  const zones = generatingZones(blueprint);
  const ids = new Set(zones.map((zone) => zone.id));
  // Paint Regions are painted here too, over the package's own textures (paintRegionStroke).
  const { paintRegions: _paintRegions, ...rest } = blueprint;
  const out: MissionBlueprint = {
    ...rest,
    // A Zone's texture is one of the map's own 8, painted here; the generator's palette doesn't have it.
    zones: zones.map(({ texture: _texture, ...zone }) => ({ ...zone, connections: zone.connections.filter((connection) => ids.has(connection.toZoneId)) })),
    placements: blueprint.placements.filter((placement) => ids.has(placement.zoneId)),
    ramps: [],
    terrainObjects: [],
    water: [],
    raggedCliffs: 0,
  };
  return bindLikeOriginal(out, blueprint);
}

/**
 * The cells the generating Zones own, and which owns each (its index among them, or -1): whole 2×2
 * cliff cells inside a generating Zone, none of them inside a Kept Zone (whose ground isn't
 * touched, wherever it lies) or kept by the author.
 */
export function ownedCells(blueprint: Pick<MissionBlueprint, "zones">, width: number, height: number, keptCells?: Uint8Array): { owned: Uint8Array; owner: Int16Array } {
  const zones = generatingZones(blueprint);
  const keptZones = blueprint.zones.filter((zone) => zone.terrain === "kept");
  const owned = new Uint8Array(width * height);
  const owner = new Int16Array(width * height).fill(-1);
  const inZone = (x: number, y: number) =>
    zones.some((zone) => containsPoint(zone.polygon, { x: x + 0.5, y: y + 0.5 })) && !keptZones.some((zone) => containsPoint(zone.polygon, { x: x + 0.5, y: y + 0.5 }));
  for (let by = 0; by < height / 2; by++) {
    for (let bx = 0; bx < width / 2; bx++) {
      const cells = [[2 * bx, 2 * by], [2 * bx + 1, 2 * by], [2 * bx, 2 * by + 1], [2 * bx + 1, 2 * by + 1]] as const;
      if (!cells.every(([x, y]) => inZone(x, y) && !keptCells?.[y * width + x])) continue;
      let index = -1;
      zones.forEach((zone, i) => {
        if (containsPoint(zone.polygon, { x: 2 * bx + 1, y: 2 * by + 1 })) index = i;
      });
      for (const [x, y] of cells) {
        owned[y * width + x] = 1;
        owner[y * width + x] = index;
      }
    }
  }
  return { owned, owner };
}

/** The cells' bounding box. */
function boundsOf(cells: Uint8Array, width: number, height: number): { x0: number; y0: number; x1: number; y1: number } {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (cells[y * width + x]) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x + 1), Math.max(y1, y + 1)];
  return { x0, y0, x1, y1 };
}

/** The `at` of each Connection between a generating Zone and a Kept one, from either side: crossings the dressing keeps clear of. */
function seamCrossings(blueprint: MissionBlueprint): { x: number; y: number }[] {
  const terrain = new Map(blueprint.zones.map((zone) => [zone.id, zone.terrain]));
  return blueprint.zones.flatMap((zone) =>
    zone.connections.flatMap((connection) => (connection.at && terrain.get(connection.toZoneId) !== zone.terrain && terrain.has(connection.toZoneId) ? [connection.at] : [])),
  );
}

/** The Zone a corner of the cliff grid belongs to: the last one holding it, else the one owning the cell north-east of it. */
function zoneAt<Zone extends { readonly polygon: readonly { x: number; y: number }[] }>(zones: readonly Zone[], point: { x: number; y: number }, fallback: number): Zone {
  for (let index = zones.length - 1; index >= 0; index--) if (containsPoint(zones[index]!.polygon, point)) return zones[index]!;
  return zones[Math.max(0, fallback)]!;
}

/** 1 for each vertex whose four cells are all owned: the vertices the Zones write. */
export function interiorVertices(owned: Uint8Array, width: number, height: number): Uint8Array {
  const columns = width + 1;
  const interior = new Uint8Array(columns * (height + 1));
  for (let y = 1; y < height; y++) {
    for (let x = 1; x < width; x++) {
      if (owned[(y - 1) * width + x - 1] && owned[(y - 1) * width + x] && owned[y * width + x - 1] && owned[y * width + x]) interior[y * columns + x] = 1;
    }
  }
  return interior;
}

/** Each interior vertex's distance (cells) to the nearest vertex outside, and that vertex's base height. */
function seamDistances(interior: Uint8Array, base: Float64Array, columns: number, rows: number): { distance: Float64Array; seam: Float64Array } {
  const distance = new Float64Array(interior.length).fill(Infinity);
  const seam = new Float64Array(interior.length);
  const sources: number[] = [];
  for (let v = 0; v < interior.length; v++) {
    if (interior[v]) continue;
    const x = v % columns;
    const y = Math.floor(v / columns);
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => x + dx! >= 0 && y + dy! >= 0 && x + dx! < columns && y + dy! < rows && interior[(y + dy!) * columns + x + dx!])) sources.push(v);
  }
  // Exact nearest source, within the blend's reach (farther vertices are all generated anyway).
  const reach = BLEND + 1;
  const buckets = new Map<string, number[]>();
  for (const v of sources) {
    const key = `${Math.floor((v % columns) / reach)},${Math.floor(Math.floor(v / columns) / reach)}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(v);
  }
  for (let v = 0; v < interior.length; v++) {
    if (!interior[v]) continue;
    const x = v % columns;
    const y = Math.floor(v / columns);
    let best = Infinity;
    let at = -1;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const s of buckets.get(`${Math.floor(x / reach) + dx},${Math.floor(y / reach) + dy}`) ?? []) {
          const d = Math.hypot((s % columns) - x, Math.floor(s / columns) - y);
          if (d < best) [best, at] = [d, s];
        }
      }
    }
    distance[v] = best;
    seam[v] = at >= 0 ? base[at]! : base[v]!;
  }
  return { distance, seam };
}

/**
 * The sets new cliffs wear: each Zone's own choice (its `cliff`, else its `cliffSets` group's) when
 * the map has it (`byZone`, by the Zone's index among the generating ones), else (`fallback`) the one
 * most Kept cliffs near the Zones wear. A map with no cliff sets gets its tileset's first, as a cliff brush gives it.
 */
function cliffSetsFor(
  zones: readonly MissionBlueprint["zones"][number][],
  choices: readonly (string | undefined)[],
  cliffs: KeptCliffs,
  sets: string[],
  owned: Uint8Array,
  width: number,
  height: number,
  warnings: string[],
): { fallback: number | undefined; byZone: Map<number, number> } {
  if (sets.length === 0) {
    const natural = getTilesetCliffSets(cliffs.catalog, cliffs.tilesetId)[0];
    if (!natural) throw new Error(`The map has no cliff sets and none is known for its tileset ${cliffs.tilesetId}: add one in the Editor first. ${FOOT}`);
    sets.push(natural);
  }
  const byZone = new Map<number, number>();
  zones.forEach((zone, index) => {
    const cliff = choices[index];
    if (cliff === undefined) return;
    const set = sets.indexOf(cliff);
    if (set >= 0) byZone.set(index, set);
    else warnings.push(`Zone ${zone.id}'s ${zone.cliff !== undefined ? "cliff" : "cliffSets group's set"} ${cliff} isn't one of the map's cliff sets (${sets.join(", ")}), so its cliffs wear the Kept cliffs' set round it`);
  });
  const blocks = width / 2;
  const counts = new Map<number, number>();
  for (const [index, entry] of cliffs.cells) {
    if (!(entry.f & 1)) continue;
    const bx = index % blocks;
    const by = Math.floor(index / blocks);
    if (owned[2 * by * width + 2 * bx]) continue;
    let near = false;
    for (let dy = -NEAR; dy <= NEAR && !near; dy++) {
      for (let dx = -NEAR; dx <= NEAR && !near; dx++) {
        const x = 2 * (bx + dx);
        const y = 2 * (by + dy);
        near = x >= 0 && y >= 0 && x < width && y < height && owned[y * width + x] === 1;
      }
    }
    if (near) counts.set(entry.cid, (counts.get(entry.cid) ?? 0) + 1);
  }
  return { fallback: [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? (cliffs.cliffSets.length === 0 ? 0 : undefined), byZone };
}

function zoneSlot(textures: KeptTextures, id: string, texture: string): number {
  try {
    return findSlot(textures, texture);
  } catch (error) {
    throw new Error(`Zone ${id}'s texture: ${error instanceof Error ? error.message : String(error)}`.replace(/Nothing was written$/, FOOT), { cause: error });
  }
}

/**
 * What paints a Zone on a map with several texture sets: its texture by name, in every set holding
 * it. A Zone with none takes the texture most of the cells round it show that every set its cells'
 * blocks are on holds, else its set's first texture (or, with no set, the most shown).
 */
function zoneTarget(textures: KeptTextures, zone: { readonly id: string; readonly texture?: string | undefined }, set: number | undefined, cells: Uint8Array, pending: Uint8Array): PaintTarget {
  let name = zone.texture;
  if (name === undefined) {
    const sets = new Set<number>();
    for (let cell = 0; cell < cells.length; cell++) if (cells[cell]) sets.add(cellSet(textures, cell % textures.width, Math.floor(cell / textures.width)));
    const shown = surroundingTextures(textures, cells, pending);
    const held = shown.find((candidate) => [...sets].every((s) => setTextures(textures, s).includes(candidate)));
    name = held ?? (set !== undefined ? setTextures(textures, set)[0]! : (shown[0] ?? textures.slots[0]!));
  }
  try {
    return findTexture(textures, name);
  } catch (error) {
    throw new Error(`Zone ${zone.id}'s texture: ${error instanceof Error ? error.message : String(error)}`.replace(/Nothing was written$/, FOOT), { cause: error });
  }
}

/** The cells bordering `cells` on a side that are Kept, or a Zone painted already (not `pending`). */
function borderCells(cells: Uint8Array, pending: Uint8Array, width: number, height: number): number[] {
  const out: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = y * width + x;
      if (cells[cell] || pending[cell]) continue;
      const beside = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const nx = x + dx!;
        const ny = y + dy!;
        return nx >= 0 && nx < width && ny >= 0 && ny < height && cells[ny * width + nx] === 1;
      });
      if (beside) out.push(cell);
    }
  }
  return out;
}

/** The textures the cells bordering `cells` show (their dominant layer, in their block's set), most first. */
function surroundingTextures(textures: KeptTextures, cells: Uint8Array, pending: Uint8Array): string[] {
  const { width, height } = textures;
  const counts = new Map<string, number>();
  for (const cell of borderCells(cells, pending, width, height)) {
    const name = textures.slots[cellSet(textures, cell % width, Math.floor(cell / width)) * 8 + dominantLayer(textures.masks, width, cell)] ?? "";
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
}

/** The slot most of the cells bordering `cells` show (their dominant layer), so a Zone with no texture meets its neighbours' ground. */
function surroundingSlot(textures: KeptTextures, cells: Uint8Array, pending: Uint8Array, width: number, height: number): number {
  const counts = new Array<number>(8).fill(0);
  for (const cell of borderCells(cells, pending, width, height)) counts[dominantLayer(textures.masks, width, cell)]!++;
  return counts.indexOf(Math.max(...counts));
}

/** Several strokes made one after the other as one: the last masks, every texel and cell any changed, each changed cell's dominant layer at the end. */
function mergeStrokes(strokes: readonly PaintStroke[]): PaintStroke {
  const last = strokes[strokes.length - 1]!;
  const changedTexels = new Uint8Array(last.changedTexels.length);
  const changedCells = new Uint8Array(last.changedCells.length);
  const dominant = new Map<number, number>();
  for (const stroke of strokes) {
    for (let t = 0; t < changedTexels.length; t++) changedTexels[t] ||= stroke.changedTexels[t]!;
    for (let c = 0; c < changedCells.length; c++) changedCells[c] ||= stroke.changedCells[c]!;
    for (const [cell, layer] of stroke.dominant) dominant.set(cell, layer);
  }
  let texelCount = 0;
  for (const changed of changedTexels) texelCount += changed;
  return { ...last, changedTexels, changedCells, texelCount, dominant };
}

/** The cells as [x, y, width, height] rectangles: each row's runs, merged down while the next row has the same run. */
export function cellRects(cells: Uint8Array, width: number, height: number): [number, number, number, number][] {
  const open = new Map<string, [number, number, number, number]>();
  const out: [number, number, number, number][] = [];
  for (let y = 0; y <= height; y++) {
    const runs = new Set<string>();
    if (y < height) {
      for (let x = 0; x < width; ) {
        if (!cells[y * width + x]) {
          x++;
          continue;
        }
        const start = x;
        while (x < width && cells[y * width + x]) x++;
        runs.add(`${start},${x - start}`);
      }
    }
    for (const [key, rect] of open) {
      if (runs.has(key)) {
        rect[3]++;
        runs.delete(key);
      } else {
        out.push(rect);
        open.delete(key);
      }
    }
    for (const key of runs) {
      const [x, w] = key.split(",").map(Number) as [number, number];
      open.set(key, [x, y, w, 1]);
    }
  }
  return out.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** The cells the rectangles cover. */
export function cellsOfRects(rects: readonly (readonly [number, number, number, number])[], width: number, height: number): Uint8Array {
  const cells = new Uint8Array(width * height);
  for (const [x0, y0, w, h] of rects) for (let y = y0; y < Math.min(height, y0 + h); y++) for (let x = x0; x < Math.min(width, x0 + w); x++) cells[y * width + x] = 1;
  return cells;
}

/**
 * What a terrain file holds in the cells, per cell, as comparable parts: the vertices inside them
 * (height maps), the cells' own values (sync cliff level, cell flags, sync texture), their texels'
 * weights (masks) and their cliff cells (t3Terrain.xml). Heights are decoded with the map's own
 * quantization, so a save at another one isn't a change. Keyed by cell index.
 */
export function cellContents(file: ZoneTerrainFile, content: Buffer | string, cells: Uint8Array, width: number, height: number, terrainXml: string): Map<number, string> {
  const out = new Map<number, string[]>();
  const add = (cell: number, part: string) => (out.get(cell) ?? out.set(cell, []).get(cell)!).push(part);
  const columns = width + 1;
  const bytes = typeof content === "string" ? Buffer.from(content) : content;
  if (file === "t3HeightMap" || file === "t3SyncHeightMap") {
    const terrain = readT3TerrainXml(terrainXml);
    const interior = interiorVertices(cells, width, height);
    for (let v = 0; v < interior.length; v++) {
      if (!interior[v]) continue;
      // Each interior vertex is filed under the cell north-east of it.
      const cell = Math.floor(v / columns) * width + (v % columns);
      if (file === "t3HeightMap") {
        const [base, cliff, last] = vertexHeights(bytes, v, terrain);
        add(cell, `${base.toFixed(2)}/${cliff.toFixed(2)}/${last}`);
      } else add(cell, bytes.subarray(64 + v * 4, 68 + v * 4).toString("hex"));
    }
  } else if (file === "t3SyncCliffLevel" || file === "t3CellFlags") {
    const size = file === "t3SyncCliffLevel" ? 2 : 1;
    for (let cell = 0; cell < cells.length; cell++) if (cells[cell]) add(cell, bytes.subarray(32 + cell * size, 32 + (cell + 1) * size).toString("hex"));
  } else if (file === "t3SyncTextureInfo") {
    let start = 20;
    for (let name = 0; name < 8; name++) {
      const end = bytes.indexOf(0, start);
      if (end < 0) throw new Error("t3SyncTextureInfo's texture names don't end, so its cells can't be compared");
      start = end + 1;
    }
    for (let cell = 0; cell < cells.length; cell++) if (cells[cell]) add(cell, bytes.subarray(start + cell * 8, start + cell * 8 + 8).toString("hex"));
  } else if (file === "t3TextureMasks") {
    const masks = readT3TextureMasks(bytes);
    for (let cell = 0; cell < cells.length; cell++) {
      if (!cells[cell]) continue;
      const cx = cell % width;
      const cy = Math.floor(cell / width);
      const parts: number[] = [];
      for (let ty = 0; ty < 8; ty++) for (let tx = 0; tx < 8; tx++) for (const layer of masks.layers) parts.push(layer[(cy * 8 + ty) * masks.maskWidth + cx * 8 + tx]!);
      add(cell, parts.join(","));
    }
  } else {
    const terrain = readT3TerrainXml(bytes.toString("utf8"));
    const entries = new Map(terrain.cliffCells.map((cell) => [cell.index, `${cell.flags}:${cell.cliffSet}:${cell.variation}`]));
    for (let by = 0; by < height / 2; by++) {
      for (let bx = 0; bx < width / 2; bx++) {
        const cell = 2 * by * width + 2 * bx;
        if (cells[cell]) add(cell, entries.get(by * (width / 2) + bx) ?? "-");
      }
    }
  }
  return new Map([...out].map(([cell, parts]) => [cell, parts.join(";")]));
}

/** A fingerprint of what a terrain file holds in the cells (cellContents): what the compile record keeps for them. */
export function terrainCellsFingerprint(file: ZoneTerrainFile, content: Buffer | string, cells: Uint8Array, width: number, height: number, terrainXml: string): string {
  const parts = cellContents(file, content, cells, width, height, terrainXml);
  return fingerprint([...parts].sort((a, b) => a[0] - b[0]).map(([cell, part]) => `${cell}=${part}`).join("\n"));
}

/**
 * How far a t3HeightMap height may move and be the same: an Editor save quantizes the heights again
 * (on a 256×256 Kept map, quantizeBias 9.003069 → 9.003311), so every raw value changes, though no height
 * moves by more than 0.00024. Rounding them to 2 places then flips those near a boundary.
 */
export const HEIGHT_MAP_TOLERANCE = 0.01;

/** A t3HeightMap vertex's base and cliff heights, decoded with the map's quantization, and its third value as stored. */
function vertexHeights(bytes: Buffer, vertex: number, quantization: { readonly quantizeScale: number; readonly quantizeBias: number }): [number, number, number] {
  const at = 32 + vertex * 6;
  const decode = (raw: number) => raw * quantization.quantizeScale - quantization.quantizeBias;
  return [decode(bytes.readUInt16LE(at)), decode(bytes.readUInt16LE(at + 2)), bytes.readUInt16LE(at + 4)];
}

/** The cells of `cells` with a vertex inside whose heights differ by more than HEIGHT_MAP_TOLERANCE, or whose third value differs, between two height maps. */
function changedHeightCells(now: Buffer, next: Buffer, cells: Uint8Array, width: number, height: number, nowXml: string, nextXml: string): number[] {
  const mine = readT3TerrainXml(nowXml);
  const theirs = readT3TerrainXml(nextXml);
  const interior = interiorVertices(cells, width, height);
  const columns = width + 1;
  const out = new Set<number>();
  for (let v = 0; v < interior.length; v++) {
    if (!interior[v]) continue;
    const a = vertexHeights(now, v, mine);
    const b = vertexHeights(next, v, theirs);
    if (Math.abs(a[0] - b[0]) > HEIGHT_MAP_TOLERANCE || Math.abs(a[1] - b[1]) > HEIGHT_MAP_TOLERANCE || a[2] !== b[2]) out.add(Math.floor(v / columns) * width + (v % columns));
  }
  return [...out].sort((x, y) => x - y);
}

/**
 * The cells whose content differs between two copies of a terrain file (cellContents), in cell
 * order. Heights are compared within HEIGHT_MAP_TOLERANCE, so an Editor save that only quantized
 * them again isn't a change; everything else is compared exactly.
 */
export function changedCells(file: ZoneTerrainFile, now: Buffer | string, next: Buffer | string, cells: Uint8Array, width: number, height: number, nowXml: string, nextXml: string): number[] {
  if (file === "t3HeightMap") return changedHeightCells(Buffer.from(now), Buffer.from(next), cells, width, height, nowXml, nextXml);
  const a = cellContents(file, now, cells, width, height, nowXml);
  const b = cellContents(file, next, cells, width, height, nextXml);
  return [...new Set([...a.keys(), ...b.keys()])].filter((cell) => a.get(cell) !== b.get(cell)).sort((x, y) => x - y);
}

/**
 * The level-design check at a seam: each Connection between a generating Zone and a Kept one must
 * cross at one cliff level (a ramp, one apart, isn't generated there yet). The Kept level is read
 * from the package at the crossing: `at`, else the point of the generating Zone's edge nearest the
 * Kept Zone. Returns each problem with the Blueprint path it is at; one with no severity is an error.
 */
export function seamProblems(blueprint: MissionBlueprint, ground: KeptGround): { readonly path: string; readonly message: string; readonly severity?: "warning" }[] {
  const out: { path: string; message: string; severity?: "warning" }[] = [];
  const zones = generatingZones(blueprint);
  if (zones.length === 0) return out;
  const { owned } = ownedCells(blueprint, ground.width, ground.height);
  const interior = interiorVertices(owned, ground.width, ground.height);
  const byId = new Map(blueprint.zones.map((zone, index) => [zone.id, { zone, index }]));
  blueprint.zones.forEach((zone, index) => {
    zone.connections.forEach((connection, c) => {
      const other = byId.get(connection.toZoneId);
      if (!other || connection.type === "air-only") return;
      const pair = zone.terrain === "generate" && other.zone.terrain === "kept" ? { generating: zone, keptZone: other.zone } : zone.terrain === "kept" && other.zone.terrain === "generate" ? { generating: other.zone, keptZone: zone } : undefined;
      if (!pair) return;
      const crossing = connection.at ?? nearestEdgePoint(pair.generating.polygon, pair.keptZone.polygon);
      const level = keptLevelAt(ground, interior, crossing, Math.max(2, (connection.width ?? 4) / 2));
      if (level === undefined) return;
      const path = `zones.${index}.connections.${c}`;
      const where = `at (${fmtPoint(crossing)})`;
      const what = `The Connection from ${zone.id} to ${connection.toZoneId}`;
      if (connection.type === "ramp") {
        if (Math.abs(level - pair.generating.elevation) !== 1) out.push({ path, message: `${what} is a ramp into Kept ground at cliff level ${level} ${where}, so ${pair.generating.id} must be one level from it, not at ${pair.generating.elevation}` });
        else out.push({ path, severity: "warning", message: `${what} is a ramp into Kept ground ${where}, and ramps aren't generated beside Kept ground yet: add one with the add-ramp brush (edit-terrain) once ${pair.generating.id} is compiled` });
        return;
      }
      if (level !== pair.generating.elevation) {
        out.push({
          path,
          message: `${what} crosses into Kept ground at cliff level ${level} ${where}, but ${pair.generating.id} generates its ground at level ${pair.generating.elevation}: set its elevation to ${level}, or move the crossing where the Kept ground is at ${pair.generating.elevation}`,
        });
      }
    });
  });
  return out;
}

const fmtPoint = (point: { x: number; y: number }) => `${+point.x.toFixed(1)}, ${+point.y.toFixed(1)}`;

/** The cliff level most of the Kept corners of the cliff grid within `radius` of `point` are at (the Zone's own inside left out). */
function keptLevelAt(ground: KeptGround, interior: Uint8Array, point: { x: number; y: number }, radius: number): number | undefined {
  const counts = new Map<number, number>();
  for (let vy = Math.max(0, Math.floor((point.y - radius) / 2) * 2); vy <= Math.min(ground.height, point.y + radius); vy += 2) {
    for (let vx = Math.max(0, Math.floor((point.x - radius) / 2) * 2); vx <= Math.min(ground.width, point.x + radius); vx += 2) {
      const v = vy * ground.columns + vx;
      if (interior[v] || Math.hypot(vx - point.x, vy - point.y) > radius) continue;
      counts.set(ground.levels[v]!, (counts.get(ground.levels[v]!) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
}

/** The point on `polygon`'s edge nearest `other` (sampled every half cell). */
function nearestEdgePoint(polygon: readonly { x: number; y: number }[], other: readonly { x: number; y: number }[]): { x: number; y: number } {
  const samples = (shape: readonly { x: number; y: number }[]) =>
    shape.flatMap((a, i) => {
      const b = shape[(i + 1) % shape.length]!;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
      return Array.from({ length: steps }, (_, s) => ({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps }));
    });
  const theirs = samples(other);
  let best = { point: polygon[0]!, d: Infinity };
  for (const point of samples(polygon)) {
    const d = containsPoint(other, point) ? 0 : Math.min(...theirs.map((q) => Math.hypot(q.x - point.x, q.y - point.y)));
    if (d < best.d) best = { point, d };
  }
  return best.point;
}
