// Brush edits on a Mission's Kept ground (ADR-0010, spec #247), in its own Map Package. Each edit is
// an area (src/kept-terrain/area.ts) and a brush. Three families so far: height (raise, lower,
// flatten and smooth, src/kept-terrain/height-brushes.ts); cliffs and ramps (raise or lower a
// cliff level, add or remove a ramp, src/kept-terrain/cliff-brushes.ts), whose area is the ramp's
// own footprint for a ramp; and paint (paint with one of the map's 8 textures, or swap a texture
// slot map-wide, src/kept-terrain/paint-brushes.ts; see editKeptTextures below); and pathing
// (block an area's pathing or clear it, src/kept-terrain/pathing-brush.ts; see editKeptPathing).
// The edit:
//
//   1. resolves the area against the package's Kept regions and points, and renders it outlined
//      (area.png) for the author to confirm;
//   2. refuses cells the compile record lists (naming the Blueprint field) and, just before it
//      writes, a map the Editor has open;
//   3. writes back only the files it changes: t3HeightMap and t3SyncHeightMap, vertex by vertex,
//      and Objects when Kept doodads move with the ground; for a cliff or ramp also
//      t3SyncCliffLevel and t3CellFlags cell by cell, t3Terrain.xml's cliff cells and ramps, and
//      t3VertCol with its static shadow bake reset, as an Editor cliff edit leaves it (the report
//      asks for a rebake). Every other file stays byte-identical, including the ones we don't
//      decode (t3HardTile, t3FluffDoodad, t3Water);
//   4. reports cells changed, the range of change and doodads moved, with before, after and
//      difference renders cropped to the area plus a margin, in the Mission's git-ignored
//      renders/<edit>/.
//
// A dry run does 1 and 4 and writes nothing to the package. The `edit_kept_terrain` MCP tool and
// the `edit-terrain` CLI run it.

import { blueprintCatalog } from "../catalog/catalog-layer.js";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { CompileRecord } from "../domain/compile-record.js";
import { generatingZones, type MissionBlueprint, textureSetOfZone } from "../domain/mission-blueprint.js";
import type { Host } from "../host/host.js";
import { type Area, type AreaContext, type AreaMask, AreaSchema, type CellRect, findPoint, resolveArea } from "../kept-terrain/area.js";
import { applyCliffBrush, type CliffBrush, CliffBrushSchema, type CliffEdit, isCliffBrush, isRampBrush, type ParsedCliffBrush, rampArea } from "../kept-terrain/cliff-brushes.js";
import { applyHeightBrush, fmt, type HeightBrush, HeightBrushSchema } from "../kept-terrain/height-brushes.js";
import {
  cellSet,
  checkClearSlot,
  checkSwap,
  findSeams,
  findSet,
  findSlot,
  findTexture,
  isPaintBrush,
  isSlotEdit,
  isSlotSwap,
  type KeptTextures,
  MAX_TEXTURES,
  moveBlocks,
  PAINT_FILES,
  type PaintBrush,
  PaintBrushSchema,
  type ParsedPaintBrush,
  paintSlot,
  REACH_SHARE,
  readKeptTextures,
  SET_BLOCK_FILES,
  seamWarning,
  setTextures,
  slotLabel,
  slotReach,
  SWAP_FILES,
  texturesAfter,
  targetLabel,
  usesSets,
  withBlockSets,
  writeBlockMove,
  writePaint,
  writeSwap,
} from "../kept-terrain/paint-brushes.js";
import { ownedCells } from "../kept-terrain/generating-zones.js";
import { blocksOfRects } from "../kept-terrain/texture-sets.js";
import { CLIFF_FILES, type KeptCliffs, readCellFlagCells, readKeptCliffs, writeKeptCliffs } from "../kept-terrain/kept-cliffs.js";
import { applyPathingBrush, isPathingBrush, PATHING_FILE, type PathingBrush, PathingBrushSchema, readKeptPathing, writeKeptPathing } from "../kept-terrain/pathing-brush.js";
import { type KeptGround, readKeptGround, setQuantization, writeKeptGround } from "../kept-terrain/kept-ground.js";
import { REBAKE_SENTENCE, resetShadowBake } from "../kept-terrain/shadow-bake.js";
import { vertexHeightAt } from "../study/terrain-grid.js";
import { parseMissionBlueprint, type Workspace } from "../plugins/workspace.js";
import { writePng } from "../preview/write-png.js";
import {
  darkenCells,
  enlarge,
  markPositions,
  outlineCells,
  renderHeight,
  renderHeightChange,
  renderPathing,
  renderPathingChange,
  renderSlotShare,
  renderTexelChange,
  renderTextureBlend,
  textureColours,
} from "../study/render-layers.js";
import { cliffMask, cropAround, windowCells } from "../study/render-crop.js";
import { LAYERS } from "../terrain/texture-grid.js";
import { containsPoint } from "../terrain/rasterize.js";
import { setDoodadHeights } from "./edit-kept-objects.js";
import { layerColours } from "./layer-colours.js";
import { readObjectsXml } from "./read-objects-xml.js";
import { readRegionsXml } from "./read-regions-xml.js";
import { type KeptSession, openKeptSession, withMissionPackageLock } from "./kept-session.js";
import { bundledModelFootprints } from "../catalog/model-footprints.js";
import { getDoodadModel } from "../catalog/stock-catalog.js";
import type { RgbImage } from "./read-tga.js";

export type { HeightBrush } from "../kept-terrain/height-brushes.js";
export type { CliffBrush } from "../kept-terrain/cliff-brushes.js";
export type { PaintBrush } from "../kept-terrain/paint-brushes.js";
export type { PathingBrush } from "../kept-terrain/pathing-brush.js";

/** Every brush: height, cliffs and ramps, paint, then pathing. */
export const BrushSchema = z.discriminatedUnion("op", [...HeightBrushSchema.options, ...CliffBrushSchema.options, ...PaintBrushSchema.options, ...PathingBrushSchema.options]);
/** Brushes whose reach is their own: a ramp's footprint, or every cell a texture slot covers. */
const takesNoArea = (brush: { readonly op: string }) => isRampBrush(brush) || isSlotEdit(brush);
export const KeptTerrainEditSchema = z
  .object({ area: AreaSchema.optional(), brush: BrushSchema })
  .strict()
  .superRefine((edit, context) => {
    if (isRampBrush(edit.brush) && edit.area) context.addIssue({ code: z.ZodIssueCode.custom, path: ["area"], message: `${edit.brush.op} takes no area: the ramp's own footprint is its area` });
    if (isSlotSwap(edit.brush) && edit.area) context.addIssue({ code: z.ZodIssueCode.custom, path: ["area"], message: "swap-slot takes no area: it changes every cell the slot covers, map-wide" });
    if (edit.brush.op === "clear-slot" && edit.area) context.addIssue({ code: z.ZodIssueCode.custom, path: ["area"], message: "clear-slot takes no area: it empties the slot map-wide" });
    if (!takesNoArea(edit.brush) && !edit.area) context.addIssue({ code: z.ZodIssueCode.custom, path: ["area"], message: `${edit.brush.op} needs an area` });
  });
/**
 * The area an edit works on, as its brush takes it: a ramp's own footprint (`ramp` gives it), cliffs
 * and pathing snapped sharp to whole cells, the rest as given. The brushes and capture-edit share it.
 */
export function editArea(edit: { readonly area?: Area | undefined; readonly brush: z.output<typeof BrushSchema> }, ramp: (brush: ParsedCliffBrush) => Area): Area {
  const { brush } = edit;
  if (isSlotEdit(brush)) throw new Error(`${isSlotSwap(brush) ? "A slot swap" : "Emptying a slot"} changes the whole map: give the area to look at instead`);
  if (isCliffBrush(brush) && isRampBrush(brush)) return { ...ramp(brush), falloff: "sharp" };
  const area = edit.area!;
  return isCliffBrush(brush) || isPathingBrush(brush) ? { ...area, falloff: "sharp" } : area;
}

export type KeptTerrainEdit = { readonly area?: z.input<typeof AreaSchema>; readonly brush: HeightBrush | CliffBrush | PaintBrush | PathingBrush };

/** The files a height brush writes; the compile record listing any of them makes those cells Compiled. */
const HEIGHT_FILES = ["t3HeightMap", "t3SyncHeightMap"] as const;
/** The files a cliff or ramp brush writes. */
const CLIFF_EDIT_FILES = [...HEIGHT_FILES, ...CLIFF_FILES, "t3VertCol"] as const;
/** A doodad whose ground moves less than this stays where it is. */
const MOVE_EPSILON = 1e-4;
/** Doodads named one by one in a warning before the rest are counted. */
const LISTED = 10;

export type KeptTerrainEditOptions = {
  /** Asked whether the Editor has the map open (`editor.checkClosed`); a host that can't tell lets the edit go ahead. */
  readonly host?: Host;
  /** Leave Kept doodads at their heights (to bury one on purpose). */
  readonly leaveDoodads?: boolean;
  /** Render and report, writing nothing to the package. */
  readonly dryRun?: boolean;
  /** The renders' folder under renders/; by default the brush and the time. */
  readonly name?: string;
  /** The author's yes to a slot swap, given after seeing its reach: without it a swap only renders. */
  readonly confirm?: boolean;
};

export type MovedDoodad = { readonly id: number; readonly type: string; readonly by: number };

export type KeptTerrainEditResult = {
  /** The edit in a few words: what it did, the cells changed and by how much, doodads moved. */
  readonly summary: string;
  /** Cells with a corner whose height or cliff level changed, or (a cliff or ramp edit) whose own sync cliff level or flags did. */
  readonly cells: number;
  /** A cliff or ramp edit's changed cliff cells (2×2 cells). */
  readonly cliffCells?: number;
  /** A paint stroke's changed mask texels (8×8 per cell). */
  readonly texels?: number;
  /** A paint or swap's render colours: texture name -> "rgb(r,g,b)". */
  readonly legend?: Readonly<Record<string, string>>;
  /** The smallest and largest change in height at a changed vertex. */
  readonly change: { readonly min: number; readonly max: number };
  readonly doodads: readonly MovedDoodad[];
  readonly warnings: readonly string[];
  /** The files written, relative to the Map Package; none on a dry run. */
  readonly files: readonly string[];
  /** The files removed: CellAttribute_Pnp once clearing has left nothing painted. */
  readonly removed?: readonly string[];
  /** Absolute paths of the renders; none for emptying a slot, which changes no cell's look. */
  readonly renders?: { readonly area: string; readonly before: string; readonly after: string; readonly difference: string };
  readonly mapPackage: string;
};

/** Applies one brush edit to the Mission's Kept ground, as above. */
export function editKeptTerrain(workspace: Workspace, blueprintPath: string, edit: KeptTerrainEdit, options: KeptTerrainEditOptions = {}): Promise<KeptTerrainEditResult> {
  return withMissionPackageLock(blueprintPath, () => editKeptTerrainLocked(workspace, blueprintPath, edit, options));
}

async function editKeptTerrainLocked(workspace: Workspace, blueprintPath: string, edit: KeptTerrainEdit, options: KeptTerrainEditOptions): Promise<KeptTerrainEditResult> {
  const parsed = KeptTerrainEditSchema.safeParse(edit);
  if (!parsed.success) throw new Error(`The edit: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "edit"}: ${issue.message}`).join("; ")}`);
  const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
  const session = await openKeptSession(blueprintPath, { verb: "edited", host: options.host });
  const { record, mapPackage } = session;
  const brushIn = parsed.data.brush;
  if (isPaintBrush(brushIn)) return editKeptTextures(blueprint, session, blueprintPath, brushIn, parsed.data.area, options);
  if (isPathingBrush(brushIn)) return editKeptPathing(blueprint, session, blueprintPath, brushIn, parsed.data.area!, options);
  const cliffBrush = isCliffBrush(brushIn) ? brushIn : undefined;
  const editFiles: readonly string[] = cliffBrush ? CLIFF_EDIT_FILES : HEIGHT_FILES;
  for (const file of ["MapInfo", "t3Terrain.xml", ...HEIGHT_FILES, ...(cliffBrush ? CLIFF_FILES : [])]) {
    if (!existsSync(path.join(mapPackage, file))) throw new Error(`${mapPackage} has no ${file}: compile the Mission, or import a map for it, first`);
  }

  const ground = await readKeptGround(mapPackage);
  const cliffs: KeptCliffs | undefined = cliffBrush ? await readKeptCliffs(mapPackage, blueprintCatalog(blueprint)) : undefined;
  const objectsText = existsSync(path.join(mapPackage, "Objects")) ? await readFile(path.join(mapPackage, "Objects"), "utf8") : undefined;
  const objects = objectsText === undefined ? undefined : readObjectsXml(objectsText);
  const context = await areaContext(mapPackage, ground, blueprint, objects?.points ?? []);
  const mask = resolveArea(editArea(parsed.data, (ramp) => rampArea(ramp, cliffs!)), context);
  refuseCompiledFiles(blueprint, record, editFiles, mask);

  let brush: { readonly done: string; readonly would: string };
  let cliffEdit: CliffEdit | undefined;
  let written;
  if (cliffBrush) {
    cliffEdit = applyCliffBrush(ground, cliffs!, cliffBrush, mask);
    refuseCompiledCells(blueprint, record, editFiles, mask, cliffEdit.touched);
    brush = cliffEdit;
    written = writeKeptGround(ground, cliffEdit.ground);
  } else {
    refuseCompiledCells(blueprint, record, editFiles, mask, touchedCells(mask));
    const height = applyHeightBrush(ground, mask, brushIn as HeightBrush, (target) => {
      const point = findPoint(target, context);
      return { ...point.centre, name: point.name };
    });
    brush = height;
    written = writeKeptGround(ground, height.base);
  }
  const cells = changedCells(ground, written.changed, cliffEdit?.touched);
  let min = Infinity;
  let max = -Infinity;
  for (let v = 0; v < written.changed.length; v++) {
    if (!written.changed[v]) continue;
    const d = written.heights[v]! - ground.heights[v]!;
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  const change = cells.count ? { min, max } : { min: 0, max: 0 };

  const writing = !options.dryRun && cells.count > 0;
  const warnings: string[] = [];
  const terrainXml = path.join(mapPackage, "t3Terrain.xml");
  const cliffFiles = cliffs && cliffEdit ? writeKeptCliffs(cliffs, cliffEdit.cliffs) : {};
  const edited = cliffFiles["t3Terrain.xml"];
  const terrainText = written.requantized ? setQuantization(edited ?? (await readFile(terrainXml, "utf8")), written.requantized) : edited;
  if (written.requantized) {
    // Widening rewrites every vertex, so it would touch any cells the compile record lists too.
    const listed = record.entries.find((entry) => entry.kind === "terrain-cells" && (HEIGHT_FILES as readonly string[]).includes(entry.file));
    if (listed && listed.kind === "terrain-cells") {
      throw new Error(
        `The new heights need more range than t3HeightMap's quantization gives, and widening it rewrites every vertex, including cells the compile record lists in ${listed.file} (Compiled Content): ask for a smaller change. Nothing was written`,
      );
    }
    const [was, is] = writing ? ["was", "is"] : ["would be", "would be"];
    warnings.push(
      `The new heights need more range than t3HeightMap's quantization gives (bias ${fmt(ground.quantizeBias)}, scale ${ground.quantizeScale.toExponential(6)}), so it ${was} widened to bias ${fmt(written.requantized.quantizeBias)}, scale ${written.requantized.quantizeScale.toExponential(6)}, as the Editor does: every vertex of t3HeightMap ${is} rewritten, unedited ones within ${fmt(written.requantized.quantizeScale)} of their height, with t3Terrain.xml's <vertData> to match`,
    );
  }
  // Kept doodads on changed cells move with the ground under them.
  const compiledObjects = new Set(record.entries.flatMap((entry) => (entry.kind === "object" ? [entry.id] : [])));
  const moved: MovedDoodad[] = [];
  const heights = new Map<number, number>();
  const left: string[] = [];
  for (const doodad of objects?.doodads ?? []) {
    const { x, y, z } = doodad.position;
    if (x < 0 || y < 0 || x >= ground.width || y >= ground.height || !cells.mask[Math.floor(y) * ground.width + Math.floor(x)]) continue;
    const by = vertexHeightAt(written.heights, ground.columns, x, y) - vertexHeightAt(ground.heights, ground.columns, x, y);
    if (Math.abs(by) < MOVE_EPSILON) continue;
    // HeightOffset alone makes z a height above the ground, which follows without a change. With
    // HeightAbsolute as well z is absolute (on a 256×256 Kept map, 852 doodads have both, some sunk below the ground).
    if (doodad.flags.includes("HeightOffset") && !doodad.flags.includes("HeightAbsolute")) continue;
    const label = `doodad ${doodad.id} (${doodad.type})`;
    if (compiledObjects.has(doodad.id)) left.push(`${label} is Compiled Content and stays at ${fmt(z)}: its ground moved by ${fmt(by)}, so change its height in the Blueprint`);
    else if (options.leaveDoodads) left.push(`${label} left at its height, ${fmt(z)} (--leave-doodads): the ground under it moved by ${fmt(by)}`);
    else {
      heights.set(doodad.id, z + by);
      moved.push({ id: doodad.id, type: doodad.type, by });
    }
  }
  warnings.push(...left.slice(0, LISTED));
  if (left.length > LISTED) warnings.push(`and ${left.length - LISTED} more doodads left at their heights`);

  // A cliff or ramp edit resets the static shadow bake, as the Editor's own cliff edits do.
  const vertColFile = path.join(mapPackage, "t3VertCol");
  const vertCol = cliffEdit && cells.count > 0 && existsSync(vertColFile) ? resetShadowBake(await readFile(vertColFile)) : undefined;
  if (cliffEdit && cells.count > 0) warnings.push(`${REBAKE_SENTENCE}${vertCol ? (writing ? " (the bake in t3VertCol was reset)" : " (the bake in t3VertCol would be reset)") : ""}`);

  // Asked before the renders, so a refused edit leaves no renders of a change it didn't make.
  if (writing) await session.checkClosed();
  // Every file is staged beside its old one before the renders, so a failed write leaves no
  // renders of an edit that never happened; then all are renamed in, or none (write-files-together.ts).
  const out: (readonly [string, Buffer | string])[] = [
    ["t3HeightMap", written.heightMap],
    ["t3SyncHeightMap", written.syncHeightMap],
  ];
  if (cliffFiles["t3SyncCliffLevel"]) out.push(["t3SyncCliffLevel", cliffFiles["t3SyncCliffLevel"]]);
  if (cliffFiles["t3CellFlags"]) out.push(["t3CellFlags", cliffFiles["t3CellFlags"]]);
  if (terrainText !== undefined) out.push(["t3Terrain.xml", terrainText]);
  if (vertCol) out.push(["t3VertCol", vertCol]);
  if (heights.size > 0 && objectsText !== undefined) out.push(["Objects", setDoodadHeights(objectsText, heights)]);
  const staged = writing ? await session.stage(out) : undefined;
  let renders: Awaited<ReturnType<typeof writeRenders>>;
  try {
    renders = await writeRenders(
      path.dirname(blueprintPath),
      mapPackage,
      ground,
      written.heights,
      mask,
      cells.mask,
      (objects?.doodads ?? []).map((doodad) => doodad.position),
      options.name ?? defaultName(parsed.data.brush.op),
    );
  } catch (error) {
    await staged?.discard();
    throw error;
  }
  const files = staged ? await staged.commit() : [];

  const range = cells.count ? (fmt(change.min) === fmt(change.max) ? `by ${fmt(change.max)}` : `by ${fmt(change.min)} to ${fmt(change.max)}`) : "";
  const doodadPart = options.leaveDoodads ? "" : `, ${moved.length} doodad${moved.length === 1 ? "" : "s"} ${options.dryRun ? "would move" : "moved"} with the ground`;
  const summary = cells.count === 0 ? `${options.dryRun ? brush.would : brush.done}: no cell changed` : `${options.dryRun ? brush.would : brush.done}: ${cells.count} cells changed, ${range}${doodadPart}`;
  return { summary, cells: cells.count, ...(cliffEdit ? { cliffCells: cliffEdit.cliffCells } : {}), change, doodads: moved, warnings, files, renders, mapPackage };
}

/** Whether a slot swap or a block move writes: only with the author's yes, and not on a dry run. Without it, it only renders. */
export const swapWrites = (options: { readonly dryRun?: boolean | undefined; readonly confirm?: boolean | undefined }): boolean => !options.dryRun && options.confirm === true;
/** The brushes that write only with the author's yes: a slot swap and a block move. */
export const needsConfirm = (brush: { readonly op: string }): boolean => brush.op === "swap-slot" || brush.op === "set-blocks";

/** What an area is resolved against: the map's size, its Kept regions and points, and the Blueprint's Kept References. */
export async function areaContext(mapPackage: string, size: { readonly width: number; readonly height: number }, blueprint: MissionBlueprint, points: AreaContext["points"]): Promise<AreaContext> {
  const regionsFile = path.join(mapPackage, "Regions");
  const regions = existsSync(regionsFile) ? readRegionsXml(await readFile(regionsFile, "utf8")) : [];
  return { width: size.width, height: size.height, regions, points, kept: blueprint.kept };
}

/**
 * A paint stroke, a slot swap, emptying a slot or a block move (src/kept-terrain/paint-brushes.ts).
 * A stroke writes t3TextureMasks and t3SyncTextureInfo, with renders of the texture blend cropped to
 * the area. A swap renders the cells its slot covers, map-wide, and writes t3Terrain.xml's texture list and the
 * sync file's names only once the author has said yes (`confirm`). A block move renders the blocks
 * it moves, before and after, and writes their tileSet and their cells' sync set only with a yes.
 * Emptying a slot writes its name as "" in the swap's two places, refused while anything paints it,
 * and renders nothing, as it changes no cell's look.
 */
async function editKeptTextures(
  blueprint: MissionBlueprint,
  session: KeptSession,
  blueprintPath: string,
  brush: ParsedPaintBrush,
  areaIn: z.output<typeof AreaSchema> | undefined,
  options: KeptTerrainEditOptions,
): Promise<KeptTerrainEditResult> {
  const { record, mapPackage } = session;
  for (const file of ["t3Terrain.xml", "t3TextureMasks", "t3SyncTextureInfo"]) {
    if (!existsSync(path.join(mapPackage, file))) throw new Error(`${mapPackage} has no ${file}: compile the Mission, or import a map for it, first`);
  }
  const terrainXml = await readFile(path.join(mapPackage, "t3Terrain.xml"), "utf8");
  const textures = readKeptTextures(terrainXml, await readFile(path.join(mapPackage, "t3TextureMasks")), await readFile(path.join(mapPackage, "t3SyncTextureInfo")));
  const missionDir = path.dirname(blueprintPath);
  const name = options.name ?? defaultName(brush.op);
  const none = { change: { min: 0, max: 0 }, doodads: [], mapPackage };
  const used = textures.slots.slice(0, textures.setCount * LAYERS);

  if (brush.op === "swap-slot") {
    const slot = findSlot(textures, brush.slot, { emptyOk: true });
    const was = textures.slots[slot] || "(empty)";
    refuseCompiledSlot(blueprint, record, slot, "swap");
    checkSwap(textures, slot, brush.texture, blueprintCatalog(blueprint));
    const reach = slotReach(textures, slot);
    refuseCompiledCells(blueprint, record, PAINT_FILES, { width: textures.width, height: textures.height, inside: reach.anyCells }, reach.anyCells, "texture");
    const writing = swapWrites(options);
    if (writing) await session.checkClosed();
    const swapped: KeptTextures = { ...textures, slots: textures.slots.map((texture, s) => (s === slot ? brush.texture : texture)) };
    const colours = textureColours([...used, brush.texture]);
    const full = { x: 0, y: 0, width: textures.width, height: textures.height };
    const paths = renderPaths(await rendersFolder(missionDir, name));
    const blendBefore = renderTextureBlend(full, textures.masks, full, layerColours(textures, colours));
    const set = Math.floor(slot / 8);
    const inSet = (x: number, y: number) => cellSet(textures, x, y) === set;
    await save(paths.area, renderSlotShare(blendBefore, full, textures.masks, full, slot % 8, REACH_COLOUR, inSet));
    await save(paths.before, blendBefore);
    await save(paths.after, renderTextureBlend(full, textures.masks, full, layerColours(swapped, colours)));
    await save(paths.difference, outlineCells(renderSlotShare(undefined, full, textures.masks, full, slot % 8, REACH_COLOUR, inSet), full, reach.cells, [120, 120, 120]));
    const files = writing ? await session.commit((({ terrainXml: xml, sync }) => [["t3Terrain.xml", xml], ["t3SyncTextureInfo", sync]] as const)(writeSwap(textures, terrainXml, slot, brush.texture))) : [];
    const covers = `${reach.count} cells (at least ${REACH_SHARE * 100}% of their weight; ${reach.any} with any), ${reach.dominant} of them mostly ${textures.slots[slot]}`;
    const summary = writing
      ? `Swapped slot ${slot}, ${was}, for ${brush.texture}: the ${covers}, now show ${brush.texture}`
      : `Would swap slot ${slot}, ${was}, for ${brush.texture}. It covers ${covers}: area.png shows them in magenta, map-wide`;
    const seam = findSeams(swapped, brush.texture, reach.anyCells);
    const warnings = [
      ...(writing ? [] : [options.dryRun ? "A dry run: nothing was written" : "Nothing was written: a slot swap changes every cell the slot covers, so it needs your yes. Look at area.png, then run it again with --confirm (confirm: true)"]),
      ...(seam ? [seamWarning(seam)] : []),
    ];
    return { summary, cells: reach.count, ...none, warnings, files, renders: paths, legend: legendOf(colours, [...used, brush.texture]) };
  }

  if (brush.op === "clear-slot") {
    const slot = findSlot(textures, brush.slot, { emptyOk: true });
    refuseCompiledSlot(blueprint, record, slot, "clear");
    refuseZoneTexture(blueprint, textures, slot);
    checkClearSlot(textures, slot, returningCells(textures, record, slot));
    const writing = !options.dryRun;
    if (writing) await session.checkClosed();
    const files = writing ? await session.commit((({ terrainXml: xml, sync }) => [["t3Terrain.xml", xml], ["t3SyncTextureInfo", sync]] as const)(writeSwap(textures, terrainXml, slot, ""))) : [];
    const count = texturesAfter(textures, slot, "");
    const summary = writing
      ? `Emptied slot ${slot}, ${textures.slots[slot]}, painted nowhere: the map now uses ${count} different textures, of the Editor's ${MAX_TEXTURES}`
      : `Would empty slot ${slot}, ${textures.slots[slot]}, painted nowhere: the map would then use ${count} different textures, of the Editor's ${MAX_TEXTURES}`;
    // Nothing paints the slot, so the ground looks the same before and after: no renders.
    return { summary, cells: 0, ...none, warnings: options.dryRun ? ["A dry run: nothing was written"] : [], files };
  }

  const objects = await keptObjects(mapPackage);
  const area = resolveArea(areaIn!, await areaContext(mapPackage, textures, blueprint, objects.points));

  if (brush.op === "set-blocks") {
    const set = findSet(textures, brush.set);
    const move = moveBlocks(textures, area, set);
    refuseCompiledFiles(blueprint, record, SET_BLOCK_FILES, area, "texture");
    refuseCompiledCells(blueprint, record, PAINT_FILES, { width: textures.width, height: textures.height, inside: move.cells }, move.cells, "texture");
    const writing = swapWrites(options) && move.blocks.length > 0;
    if (writing) await session.checkClosed();
    const moved = withBlockSets(textures, move.blockSets);
    const colours = textureColours(used);
    const crop = cropAround(boundsOf(move.blocks.length ? move.cells : area.inside, textures.width), textures);
    const size = { width: crop.width, height: crop.height };
    const window = (all: Uint8Array) => windowCells(all, crop, textures.width);
    const blocks = (image: RgbImage) => outlineCells(image, size, window(move.cells), [255, 140, 0]);
    const paths = renderPaths(await rendersFolder(missionDir, name));
    const before = renderTextureBlend(size, textures.masks, crop, layerColours(textures, colours));
    const after = renderTextureBlend(size, textures.masks, crop, layerColours(moved, colours));
    await save(paths.area, blocks(outlineCells(before, size, window(area.inside), [255, 220, 0])));
    await save(paths.before, blocks(before));
    await save(paths.after, blocks(after));
    await save(paths.difference, blocks(renderBlendChange(before, after)));
    const files = writing ? await session.commit((({ terrainXml: xml, sync }) => [["t3Terrain.xml", xml], ["t3SyncTextureInfo", sync]] as const)(writeBlockMove(textures, terrainXml, move))) : [];
    const setName = `set ${set}${textures.sets[set] ? ` (${textures.sets[set]})` : ""}`;
    const cells = move.blocks.length * 64;
    const what = `${move.blocks.length} block${move.blocks.length === 1 ? "" : "s"} (${cells} cells) onto ${setName}`;
    const summary =
      move.blocks.length === 0
        ? `The area's blocks are all on ${setName} already: nothing to move`
        : writing
          ? `Moved ${what}: each texel kept its weights, so its textures now come from ${setName}, slot for slot`
          : `Would move ${what}. Each texel keeps its weights, so its textures swap slot for slot (${slotPairs(textures, move)}): after.png shows the result`;
    const seams = [...new Set(used.filter((texture) => texture !== ""))].flatMap((texture) => findSeams(moved, texture, move.cells) ?? []);
    const warnings = [
      ...(writing || move.blocks.length === 0 ? [] : [options.dryRun ? "A dry run: nothing was written" : "Nothing was written: moving blocks onto another set changes the look of every texel in them, so it needs your yes. Look at before.png and after.png, then run it again with --confirm (confirm: true)"]),
      ...seams.map(seamWarning),
    ];
    return { summary, cells: writing ? cells : 0, ...none, warnings, files, renders: paths, legend: legendOf(colours, used) };
  }

  const target = findTexture(textures, brush.texture);
  refuseCompiledFiles(blueprint, record, PAINT_FILES, area, "texture");
  const stroke = paintSlot(textures, area, target);
  refuseCompiledCells(blueprint, record, PAINT_FILES, area, stroke.touchedCells, "texture");
  const cells = stroke.changedCells.reduce((sum, value) => sum + value, 0);
  const writing = !options.dryRun && cells > 0;
  if (writing) await session.checkClosed();

  const colours = textureColours(used);
  const crop = cropAround(boundsOf(stroke.touchedCells, textures.width), textures);
  const size = { width: crop.width, height: crop.height };
  const window = (all: Uint8Array) => windowCells(all, crop, textures.width);
  const inside = window(area.inside);
  const outline = (image: RgbImage) => outlineCells(image, size, inside, [255, 220, 0]);
  const before = renderTextureBlend(size, textures.masks, crop, layerColours(textures, colours));
  const paths = renderPaths(await rendersFolder(missionDir, name));
  const doodads = objects.doodads.map(({ position }) => ({ x: position.x - crop.x, y: position.y - crop.y }));
  const neighbourhood = markPositions(darkenCells(before, size, window(await cliffCells(mapPackage, textures))), size, doodads, [230, 30, 30]);
  await save(paths.area, outline(outlineCells(neighbourhood, size, window(stroke.touchedCells), [255, 140, 0])));
  await save(paths.before, outline(before));
  await save(paths.after, outline(renderTextureBlend(size, stroke.masks, crop, layerColours(textures, colours))));
  await save(paths.difference, outlineCells(outline(renderTexelChange(size, textures.masks, stroke.masks, crop)), size, window(stroke.changedCells), [120, 120, 120]));

  const files = writing ? await session.commit((({ masks, sync }) => [["t3TextureMasks", masks], ["t3SyncTextureInfo", sync]] as const)(writePaint(textures, stroke))) : [];
  const edge = area.falloff === 0 ? "with a sharp edge" : `feathered over ${fmt(area.falloff)} cells`;
  const label = usesSets(textures) ? targetLabel(target) : slotLabel(textures, target.slots[0]!);
  const did = `${options.dryRun ? "Would paint" : "Painted"} ${area.label} with ${label}, ${edge}`;
  const summary = cells === 0 ? `${did}: no cell changed` : `${did}: ${cells} cells changed (${stroke.texelCount} texels), ${stroke.nowDominant} ${options.dryRun ? "would become" : "now"} mostly ${target.texture}`;
  const seam = usesSets(textures) ? findSeams(textures, target.texture, stroke.touchedCells, stroke.masks) : undefined;
  const left = stroke.offSetBlocks;
  // Painting by slot leaves blocks whose set holds the texture in another slot: a paint by name reaches them.
  const byName = left.some((block) => setTextures(textures, textures.blockSets[block]!).includes(target.texture));
  const warnings = [
    ...(left.length
      ? [
          `${left.length} block${left.length === 1 ? "" : "s"} the stroke reached (${left.join(", ")}) draw on a texture set without ${byName ? `slot ${target.slots[0]}` : target.texture}, so it left them as they were, as the Editor does. ${
            byName ? `Their set holds ${target.texture} in another slot: paint it by name ({ "op": "paint", "texture": "${target.texture}" }) to reach them` : `To paint there, move them onto a set that has it first: { "op": "set-blocks", "set" }`
          }`,
        ]
      : []),
    ...(seam ? [seamWarning(seam)] : []),
  ];
  return { summary, cells, texels: stroke.texelCount, ...none, warnings, files, renders: paths, legend: legendOf(colours, used) };
}

/** What each layer shows in the moved blocks, before → after, for the layers painted there. */
function slotPairs(textures: KeptTextures, move: { readonly set: number; readonly blocks: readonly number[] }): string {
  const { masks, blocksPerRow } = textures;
  const pairs = new Set<string>();
  for (const block of move.blocks) {
    const from = textures.blockSets[block]!;
    const x0 = (block % blocksPerRow) * 64;
    const y0 = Math.floor(block / blocksPerRow) * 64;
    for (let layer = 0; layer < 8; layer++) {
      let painted = false;
      for (let y = y0; y < y0 + 64 && !painted; y++) for (let x = x0; x < x0 + 64 && !painted; x++) painted = masks.layers[layer]![y * masks.maskWidth + x]! > 0;
      if (painted) pairs.add(`layer ${layer}: ${textures.slots[from * 8 + layer] || "(empty)"} → ${textures.slots[move.set * 8 + layer] || "(empty)"}`);
    }
  }
  return [...pairs].join(", ");
}

/** Where two renders differ: white where they agree, red as far as the colour moved. */
function renderBlendChange(before: RgbImage, after: RgbImage): RgbImage {
  const rgb = new Uint8Array(before.rgb.length);
  for (let o = 0; o < rgb.length; o += 3) {
    const moved = Math.min(1, (Math.abs(after.rgb[o]! - before.rgb[o]!) + Math.abs(after.rgb[o + 1]! - before.rgb[o + 1]!) + Math.abs(after.rgb[o + 2]! - before.rgb[o + 2]!)) / 255);
    rgb[o] = 255;
    rgb[o + 1] = Math.round(255 - 215 * moved);
    rgb[o + 2] = Math.round(255 - 215 * moved);
  }
  return { ...before, rgb };
}

/**
 * A pathing stroke (src/kept-terrain/pathing-brush.ts): blocks or clears the area's cells in
 * CellAttribute_Pnp, with renders of the paint over the ground's relief, cropped to the area.
 */
async function editKeptPathing(
  blueprint: MissionBlueprint,
  session: KeptSession,
  blueprintPath: string,
  brush: PathingBrush,
  areaIn: z.output<typeof AreaSchema>,
  options: KeptTerrainEditOptions,
): Promise<KeptTerrainEditResult> {
  const { record, mapPackage } = session;
  // The height maps are read for the renders' relief.
  for (const file of ["t3Terrain.xml", ...HEIGHT_FILES]) {
    if (!existsSync(path.join(mapPackage, file))) throw new Error(`${mapPackage} has no ${file}: compile the Mission, or import a map for it, first`);
  }
  if (areaIn.falloff !== undefined && areaIn.falloff !== "sharp" && areaIn.falloff !== 0) {
    throw new Error(`Pathing is painted on whole cells, with no falloff: leave the area's falloff out, or make it "sharp". Nothing was written`);
  }
  // Generated terrain's compile owns CellAttribute_Pnp: it writes the file whole, under dug pools and solid doodads, with the Blueprint's pathingPaint.
  const compiled = record.entries.find((entry) => entry.kind === "file" && ["t3Terrain.xml", PATHING_FILE].includes(entry.path));
  if (compiled && compiled.kind === "file") {
    throw new Error(
      `The terrain is Compiled Content (${compiled.path} is on the compile record), and its compile owns ${PATHING_FILE}, writing it whole under dug pools and solid doodads with the Blueprint's pathingPaint: paint pathing in the Editor and sync it back (or give pathingPaint in the Blueprint), or paint pathing on Kept ground. Nothing was written`,
    );
  }
  const ground = await readKeptGround(mapPackage);
  const objects = await keptObjects(mapPackage);
  const area = resolveArea(editArea({ area: areaIn, brush }, () => areaIn), await areaContext(mapPackage, ground, blueprint, objects.points));
  const file = path.join(mapPackage, PATHING_FILE);
  const before = readKeptPathing(existsSync(file) ? await readFile(file) : undefined, ground.width, ground.height);
  const stroke = applyPathingBrush(before, area, brush);
  const writing = !options.dryRun && stroke.count > 0;
  if (writing) await session.checkClosed();

  const crop = cropAround(boundsOf(area.inside, ground.width), ground);
  const size = { width: crop.width, height: crop.height };
  const window = (all: Uint8Array) => windowCells(all, crop, ground.width);
  const inside = window(area.inside);
  const outline = (image: RgbImage) => outlineCells(image, size, inside, [255, 220, 0]);
  const relief = darkenCells(renderHeight(size, windowVertices(ground.heights, crop, ground.columns)), size, window(await cliffCells(mapPackage, ground)));
  const doodads = objects.doodads.map(({ position }) => ({ x: position.x - crop.x, y: position.y - crop.y }));
  const [was, is] = [window(before), window(stroke.cells)];
  const paths = renderPaths(await rendersFolder(path.dirname(blueprintPath), options.name ?? defaultName(brush.op)));
  // The doodads are dotted over the paint's tint, so they stay white.
  await save(paths.area, outline(markPositions(renderPathing(size, was, relief), size, doodads, [255, 255, 255])));
  await save(paths.before, outline(renderPathing(size, was, relief)));
  await save(paths.after, outline(renderPathing(size, is, relief)));
  await save(paths.difference, outlineCells(outline(renderPathingChange(size, was, is)), size, window(stroke.changed), [120, 120, 120]));

  const content = writing ? writeKeptPathing(stroke.cells) : undefined;
  // Clearing the last paint takes the file away, as the Editor leaves a map with none: one write either way.
  const written = writing ? await session.commit([[PATHING_FILE, content]]) : [];
  // `files` lists what was written; a removed file is reported in `removed`.
  const files = content ? written : [];
  const removed = writing && !content ? [PATHING_FILE] : [];
  const warnings: string[] = [];
  const reach = await doodadReach();
  const standing = objects.doodads.filter((doodad) => standsIn(doodad, reach(doodad), area.inside, ground.width, ground.height));
  if (brush.op === "clear-pathing" && standing.length > 0) {
    warnings.push(`${standing.length} doodad${standing.length === 1 ? " stands" : "s stand"} in the area: a doodad with a footprint blocks pathing whatever is painted, so clearing the paint doesn't open the ground under one`);
  }
  const verb = brush.op === "block-pathing" ? ["Block", "Blocked"] : ["Clear", "Cleared"];
  const did = `${options.dryRun ? `Would ${verb[0]!.toLowerCase()}` : verb[1]} pathing on ${area.label}`;
  const partial = stroke.partial > 0 ? `, ${stroke.partial} of them painted in part before` : "";
  const now = brush.op === "block-pathing" ? "unpathable" : "pathable";
  const summary = stroke.count === 0 ? `${did}: no cell changed` : `${did}: ${stroke.count} cells changed${partial}, ${area.insideCount} cells ${options.dryRun ? "would be" : "now"} ${now} as painted`;
  return { summary, cells: stroke.count, change: { min: 0, max: 0 }, doodads: [], warnings, files, ...(removed.length > 0 ? { removed } : {}), renders: paths, mapPackage };
}

/** The vertex heights of `crop`'s cells. */
function windowVertices(heights: Float32Array, crop: CellRect, columns: number): Float32Array {
  const out = new Float32Array((crop.width + 1) * (crop.height + 1));
  for (let y = 0; y <= crop.height; y++) for (let x = 0; x <= crop.width; x++) out[y * (crop.width + 1) + x] = heights[(crop.y + y) * columns + crop.x + x]!;
  return out;
}

/** The colour of the cells a slot covers, in a swap's renders. */
const REACH_COLOUR = [230, 0, 200] as const;

/** The package's points, which an area may name, and its doodads, which the area render shows. */
async function keptObjects(mapPackage: string): Promise<Pick<ReturnType<typeof readObjectsXml>, "points" | "doodads">> {
  const file = path.join(mapPackage, "Objects");
  return existsSync(file) ? readObjectsXml(await readFile(file, "utf8")) : { points: [], doodads: [] };
}

/** The cells under a cliff mesh (t3CellFlags bit 0x01), when the package has t3CellFlags: the cliff edges in an area render. */
async function cliffCells(mapPackage: string, map: { readonly width: number; readonly height: number }): Promise<Uint8Array> {
  return cliffMask(await readCellFlagCells(mapPackage, map.width, map.height), map);
}

function legendOf(colours: ReadonlyMap<string, readonly number[]>, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.filter((texture) => texture !== "").map((texture) => [texture, `rgb(${colours.get(texture)!.join(",")})`]));
}

/** The smallest rectangle round the cells `mask` marks. */
function boundsOf(mask: Uint8Array, width: number): CellRect {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let cell = 0; cell < mask.length; cell++) {
    if (!mask[cell]) continue;
    const x = cell % width;
    const y = Math.floor(cell / width);
    [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
  }
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

const save = (file: string, image: RgbImage) => writeFile(file, writePng(enlarge(image)));

/** The cells an edit is about: enough of an {@link AreaMask} to name the Zone there. */
type Cells = Pick<AreaMask, "width" | "height" | "inside">;
/** The ground a Zone's Blueprint fields give: what a height or cliff edit changes. */
const GROUND = "elevation or ground";

/** Refuses an edit when a file it writes is on the compile record whole: that terrain is Compiled. */
function refuseCompiledFiles(blueprint: MissionBlueprint, record: CompileRecord, files: readonly string[], mask: Cells, what = GROUND): void {
  const whole = record.entries.find((entry) => entry.kind === "file" && files.includes(entry.path));
  if (whole && whole.kind === "file") {
    const field = zoneField(blueprint, mask, undefined, what) ?? "change the Blueprint, whose compile writes it,";
    throw new Error(`The terrain there is Compiled Content (${whole.path} is on the compile record): ${field} instead. Nothing was written`);
  }
}

/** Refuses a slot edit on a generated map, whose texture list the compile writes from the Blueprint's textures field (not a Zone's). */
function refuseCompiledTextureList(record: CompileRecord, slot: number): void {
  const listed = record.entries.find((entry) => entry.kind === "file" && (SWAP_FILES as readonly string[]).includes(entry.path));
  if (listed && listed.kind === "file") throw new Error(`The texture list is Compiled Content (${listed.path} is on the compile record): change the Blueprint's textures (slot ${slot}) instead. Nothing was written`);
}

/**
 * The Kept cells (none a Zone's, by the record's t3TextureMasks cells) a compile could send back
 * onto set 0 showing set-0 slot `slot`'s texture as they do now (ADR-0016): those in blocks a
 * recorded texture set took that are still on it, which a compile returns to set 0 once no Zone of
 * the set holds a cell there, and only where the set has the slot's texture on the same layer.
 * Where it has another, a return would change the cells' look whatever the slot holds, and the
 * compile refuses it already.
 */
function returningCells(textures: KeptTextures, record: CompileRecord, slot: number): Uint8Array {
  const { width, blocksPerRow } = textures;
  const cells = new Uint8Array(width * textures.height);
  if (slot >= 8) return cells;
  for (const entry of record.entries) {
    if (entry.kind !== "texture-set" || textures.slots[entry.set * 8 + slot] !== textures.slots[slot]) continue;
    for (const block of blocksOfRects(entry.blocks, blocksPerRow)) {
      if (textures.blockSets[block] !== entry.set) continue;
      const bx = (block % blocksPerRow) * 8;
      const by = Math.floor(block / blocksPerRow) * 8;
      for (let y = by; y < by + 8; y++) for (let x = bx; x < bx + 8; x++) cells[y * width + x] = 1;
    }
  }
  for (const entry of record.entries) {
    if (entry.kind !== "terrain-cells" || entry.file !== "t3TextureMasks") continue;
    for (const [x0, y0, w, h] of entry.cells) for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x < width && y < textures.height) cells[y * width + x] = 0;
  }
  return cells;
}

/**
 * Refuses a slot edit the compile writes: the whole texture list (a generated map's t3Terrain.xml
 * on the record), or a slot of a texture set of the Blueprint's (ADR-0016).
 */
function refuseCompiledSlot(blueprint: MissionBlueprint, record: CompileRecord, slot: number, edit: "swap" | "clear"): void {
  refuseCompiledTextureList(record, slot);
  const set = Math.floor(slot / 8);
  const owner = record.entries.find((entry) => entry.kind === "texture-set" && entry.set === set);
  if (owner && owner.kind === "texture-set") {
    const index = (blueprint.textureSets ?? []).findIndex((entry) => entry.id === owner.id);
    const field = index >= 0 ? `textureSets[${index}] (${owner.id})` : `texture set ${owner.id}`;
    const position = (slot % 8) + 1;
    const instead = edit === "swap" ? `put the texture at position ${position} of its textures in the Blueprint instead` : `leave position ${position} of its textures empty ("") in the Blueprint instead`;
    throw new Error(`Slot ${slot} is in texture set ${set}, the Blueprint's ${field}, which is Compiled Content: ${instead}. Nothing was written`);
  }
}

/**
 * Refuses emptying a slot whose texture a generating Zone names and the next compile paints from
 * the slot's set: a Zone of none of the Blueprint's texture sets (those paint from their own, whose
 * slots are the Blueprint's) with a cell in a block on that set.
 */
function refuseZoneTexture(blueprint: MissionBlueprint, textures: KeptTextures, slot: number): void {
  const texture = textures.slots[slot];
  const set = Math.floor(slot / 8);
  const inSets = textureSetOfZone(blueprint.textureSets ?? [], blueprint.zones);
  const zones = generatingZones(blueprint);
  if (!zones.some((zone) => zone.texture === texture && !inSets.has(zone.id))) return;
  const { width, height, blocksPerRow } = textures;
  const { owner } = ownedCells(blueprint, width, height);
  const needing = new Set<string>();
  for (let cell = 0; cell < owner.length; cell++) {
    const zone = zones[owner[cell]!];
    if (!zone || zone.texture !== texture || inSets.has(zone.id) || needing.has(zone.id)) continue;
    const [x, y] = [cell % width, Math.floor(cell / width)];
    if (textures.blockSets[Math.floor(y / 8) * blocksPerRow + Math.floor(x / 8)] === set) needing.add(zone.id);
  }
  if (needing.size === 0) return;
  const ids = [...needing];
  throw new Error(
    `${slotLabel(textures, slot)} is the texture of generating Zone${ids.length === 1 ? "" : "s"} ${ids.join(", ")}, which the next compile paints from texture set ${set}'s slots, so it isn't emptied: give ${ids.length === 1 ? "the Zone" : "them"} another texture in the Blueprint first. Nothing was written`,
  );
}

/** Refuses an edit that reaches cells the compile record lists in a file it writes. */
function refuseCompiledCells(blueprint: MissionBlueprint, record: CompileRecord, files: readonly string[], mask: Cells, reach: Uint8Array, what = GROUND): void {
  for (const entry of record.entries) {
    if (entry.kind !== "terrain-cells" || !files.includes(entry.file)) continue;
    const hits: [number, number][] = [];
    for (const [x0, y0, w, h] of entry.cells) {
      for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x < mask.width && y < mask.height && reach[y * mask.width + x]) hits.push([x, y]);
    }
    if (hits.length === 0) continue;
    hits.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const [x, y] = hits[0]!;
    const field = zoneField(blueprint, mask, { x: x + 0.5, y: y + 0.5 }, what) ?? "change the Blueprint, whose compile writes them,";
    throw new Error(`${hits.length} cells in the area are Compiled Content (${entry.file}, on the compile record), the first at (${x}, ${y}): ${field} instead. Nothing was written`);
  }
}

/** The Zone that generates the ground at `at` (by default the area's first cell), as the change to make. */
function zoneField(blueprint: MissionBlueprint, mask: Cells, at?: { x: number; y: number }, what = GROUND): string | undefined {
  let point = at;
  if (!point) {
    const first = mask.inside.indexOf(1);
    point = { x: (first % mask.width) + 0.5, y: Math.floor(first / mask.width) + 0.5 };
  }
  for (let index = blueprint.zones.length - 1; index >= 0; index--) {
    if (containsPoint(blueprint.zones[index]!.polygon, point)) return `change zones.${index} (${blueprint.zones[index]!.id})'s ${what} in the Blueprint`;
  }
  return undefined;
}

/** Cells with a corner of weight above 0: those the area may change. */
function touchedCells(mask: AreaMask): Uint8Array {
  const cells = new Uint8Array(mask.width * mask.height);
  const columns = mask.width + 1;
  const { x, y, width, height } = mask.reach;
  for (let cy = y; cy < y + height; cy++) {
    for (let cx = x; cx < x + width; cx++) {
      const w = mask.vertexWeight;
      if (w[cy * columns + cx]! > 0 || w[cy * columns + cx + 1]! > 0 || w[(cy + 1) * columns + cx]! > 0 || w[(cy + 1) * columns + cx + 1]! > 0) cells[cy * mask.width + cx] = 1;
    }
  }
  return cells;
}

/** Cells with a changed corner, and any `also` marks. */
function changedCells(ground: KeptGround, changed: Uint8Array, also?: Uint8Array): { mask: Uint8Array; count: number } {
  const mask = new Uint8Array(ground.width * ground.height);
  const columns = ground.columns;
  let count = 0;
  for (let y = 0; y < ground.height; y++) {
    for (let x = 0; x < ground.width; x++) {
      if (also?.[y * ground.width + x] || changed[y * columns + x] || changed[y * columns + x + 1] || changed[(y + 1) * columns + x] || changed[(y + 1) * columns + x + 1]) {
        mask[y * ground.width + x] = 1;
        count++;
      }
    }
  }
  return { mask, count };
}

/** A doodad's reach on the ground, in its own frame (cells, unscaled), where its model's bounds are recorded (data/model-footprints.json). */
type Reach = { readonly min: readonly number[]; readonly max: readonly number[] };

/** Each doodad type's reach: its model's recorded bounds, looked up by the type or its model's file; undefined where none is recorded. */
async function doodadReach(): Promise<(doodad: { readonly type: string }) => Reach | undefined> {
  const footprints = await bundledModelFootprints();
  const byFile = new Map(Object.values(footprints).map((footprint) => [footprint.file.toLowerCase(), footprint]));
  return ({ type }) => {
    const model = getDoodadModel(type);
    return footprints[type] ?? (model ? (byFile.get(model.toLowerCase()) ?? byFile.get(model.replace(/\.m3$/i, "_00.m3").toLowerCase())) : undefined);
  };
}

/**
 * Whether a doodad stands in the area: one with NoDoodadFootprint never does; one whose reach is
 * recorded does when it overlaps a cell of the area (its bounds scaled and turned by its yaw), and
 * any other when the cell under its centre is in the area.
 */
function standsIn(
  doodad: { readonly position: { readonly x: number; readonly y: number }; readonly yaw: number; readonly scale: { readonly x: number; readonly y: number }; readonly flags: readonly string[] },
  reach: Reach | undefined,
  inside: Uint8Array,
  width: number,
  height: number,
): boolean {
  if (doodad.flags.includes("NoDoodadFootprint")) return false;
  const { x, y } = doodad.position;
  if (!reach) return x >= 0 && y >= 0 && x < width && y < height && inside[Math.floor(y) * width + Math.floor(x)] === 1;
  const [x0, x1, y0, y1] = [reach.min[0]! * doodad.scale.x, reach.max[0]! * doodad.scale.x, reach.min[1]! * doodad.scale.y, reach.max[1]! * doodad.scale.y];
  const radius = Math.hypot(Math.max(-x0, x1), Math.max(-y0, y1)) + 1;
  const [cos, sin] = [Math.cos(doodad.yaw), Math.sin(doodad.yaw)];
  for (let cy = Math.max(0, Math.floor(y - radius)); cy <= Math.min(height - 1, Math.floor(y + radius)); cy++) {
    for (let cx = Math.max(0, Math.floor(x - radius)); cx <= Math.min(width - 1, Math.floor(x + radius)); cx++) {
      if (!inside[cy * width + cx]) continue;
      // The cell's centre in the doodad's frame; a cell overlaps the bounds when its centre is within half a cell of them.
      const dx = cx + 0.5 - x;
      const dy = cy + 0.5 - y;
      const u = dx * cos + dy * sin;
      const v = -dx * sin + dy * cos;
      if (u >= x0 - 0.5 && u <= x1 + 0.5 && v >= y0 - 0.5 && v <= y1 + 0.5) return true;
    }
  }
  return false;
}

/** The renders' folder, renders/<name>/ beside the Blueprint, made with the git-ignore that keeps it out of the Workspace's history. */
async function rendersFolder(missionDir: string, name: string): Promise<string> {
  if (!/^[\w.-]+$/.test(name) || name.startsWith(".")) throw new Error(`A render name is letters, digits, dots, dashes and underscores, not ${JSON.stringify(name)}`);
  const rendersDir = path.join(missionDir, "renders");
  const dir = path.join(rendersDir, name);
  await mkdir(dir, { recursive: true });
  const ignore = path.join(rendersDir, ".gitignore");
  if (!existsSync(ignore)) await writeFile(ignore, "*\n");
  return dir;
}

const renderPaths = (dir: string) => ({ area: path.join(dir, "area.png"), before: path.join(dir, "before.png"), after: path.join(dir, "after.png"), difference: path.join(dir, "difference.png") });

function defaultName(op: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  return `${op}-${stamp}`;
}

/**
 * The area render (the neighbourhood as height relief, cliff edges dark, doodads dotted, the area
 * outlined in yellow and the cells it may change in orange) and the before, after and difference
 * renders, cropped to the area plus a margin.
 */
async function writeRenders(
  missionDir: string,
  mapPackage: string,
  ground: KeptGround,
  after: Float32Array,
  mask: AreaMask,
  changed: Uint8Array,
  doodadPositions: readonly { readonly x: number; readonly y: number }[],
  name: string,
) {
  const dir = await rendersFolder(missionDir, name);

  const crop = cropAround(mask.reach, ground);
  // Everything is drawn on the window alone: its heights, its cells, its doodads.
  const size = { width: crop.width, height: crop.height };
  const vertices = (heights: Float32Array) => windowVertices(heights, crop, ground.columns);
  const cellsOf = (all: Uint8Array) => windowCells(all, crop, ground.width);
  const before = vertices(ground.heights);
  const afterHere = vertices(after);
  let low = Infinity;
  let high = -Infinity;
  for (let v = 0; v < before.length; v++) [low, high] = [Math.min(low, before[v]!, afterHere[v]!), Math.max(high, before[v]!, afterHere[v]!)];
  const range = [low, high] as const;
  const inside = cellsOf(mask.inside);
  const outline = (image: RgbImage) => outlineCells(image, size, inside, [255, 220, 0]);
  const relief = renderHeight(size, before, range);
  const cliffs = await cliffCells(mapPackage, ground);
  const doodads = doodadPositions.map((position) => ({ x: position.x - crop.x, y: position.y - crop.y }));
  const area = outline(outlineCells(markPositions(darkenCells(relief, size, cellsOf(cliffs)), size, doodads, [230, 30, 30]), size, cellsOf(touchedCells(mask)), [255, 140, 0]));
  const paths = renderPaths(dir);
  await save(paths.area, area);
  await save(paths.before, outline(relief));
  await save(paths.after, outline(renderHeight(size, afterHere, range)));
  await save(paths.difference, outlineCells(outline(renderHeightChange(size, before, afterHere)), size, cellsOf(changed), [120, 120, 120]));
  return paths;
}

