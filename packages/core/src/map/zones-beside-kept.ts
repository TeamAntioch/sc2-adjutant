// A compile's generating Zones beside Kept ground (src/kept-terrain/generating-zones.ts), in a
// Mission's own Map Package: the package's terrain read, the cells the author kept from earlier
// compiles left out, and the Editor's hand edits to the cells the last compile wrote found and
// decided, cell by cell (ADR-0010, #242). A change is found in the files the author edits
// (t3HeightMap, t3TextureMasks, t3Terrain.xml's cliff cells); the sync files and cell flags the
// Editor works out from them go with them, as for whole files (DERIVED_TERRAIN_FILES). Kept, the
// changed cells leave the Zone in every terrain file and stay as the Editor left them; discarded,
// the Zone writes them again.

import { blueprintCatalog, type Catalog } from "../catalog/catalog-layer.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { type CompileRecord, type CompileRecordEntry, entryName } from "../domain/compile-record.js";
import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { cellRects, cellsOfRects, changedCells, generateBesideKept, type KeptTerrain, seamProblems, terrainCellsFingerprint, type ZoneGround, type ZoneTerrainFile } from "../kept-terrain/generating-zones.js";
import { readKeptCliffs } from "../kept-terrain/kept-cliffs.js";
import { readKeptGround } from "../kept-terrain/kept-ground.js";
import { readKeptTextures } from "../kept-terrain/paint-brushes.js";
import { blocksOfRects, type TextureSetEntry, textureSetFingerprint } from "../kept-terrain/texture-sets.js";
import { hasShadowBake, REBAKE_SENTENCE } from "../kept-terrain/shadow-bake.js";
import type { EditorChange, EditorDecisions } from "./editor-changes.js";
import { type HiddenCells, hiddenCells, type HiddenCellsEntry } from "./hidden-cells-changes.js";
import { hiddenCellMask } from "../terrain/hidden-cells.js";
import { catalogEntries } from "./catalog-entries.js";

/** The map-local catalog the texture sets' CTerrain overrides go in (ADR-0016). */
export const TERRAIN_DATA = "Base.SC2Data/GameData/TerrainData.xml";

/** The terrain files a hand edit is looked for in; the rest follow them. */
const EDITED = new Set<ZoneTerrainFile>(["t3HeightMap", "t3TextureMasks", "t3Terrain.xml"]);
/** Kept doodads named in a warning before the rest are counted. */
const LISTED = 5;

export type ZonesBesideKept = {
  readonly zones: ZoneGround;
  /** The Editor's changes to the cells the last compile wrote, each to be kept or discarded with the compile's other changes. */
  readonly changes: readonly EditorChange[];
  readonly warnings: readonly string[];
  /** The record's entry for the hidden bit on the Zones' cells (src/map/hidden-cells-changes.ts); undefined with none. */
  readonly hiddenCells: HiddenCellsEntry | undefined;
};

/** The objects the compile writes, not Kept ones for the Zones to move with the ground: those on the record, and the doodads the Blueprint adopted (an Anchor's editorId). */
export function compiledObjectIds(blueprint: Pick<MissionBlueprint, "anchors">, record: CompileRecord): Set<number> {
  return new Set([...record.entries.flatMap((entry) => (entry.kind === "object" ? [entry.id] : [])), ...blueprint.anchors.flatMap((anchor) => (anchor.editorId !== undefined ? [anchor.editorId] : []))]);
}

/** Reads the package's Kept terrain, as the brushes do. */
export async function readKeptTerrain(mapPackage: string, catalog: Catalog): Promise<KeptTerrain> {
  const objectsFile = path.join(mapPackage, "Objects");
  const cliffs = await readKeptCliffs(mapPackage, catalog);
  return {
    ground: await readKeptGround(mapPackage),
    cliffs,
    textures: readKeptTextures(cliffs.xml, await readFile(path.join(mapPackage, "t3TextureMasks")), await readFile(path.join(mapPackage, "t3SyncTextureInfo"))),
    objects: existsSync(objectsFile) ? await readFile(objectsFile, "utf8") : undefined,
  };
}

/**
 * What a compile generates the Zones from, before it looks for hand edits: the package's Kept
 * terrain, the cells and texture sets the author kept, and the texture sets the Editor changed,
 * each with `decisions` taken.
 */
async function prepareZones(mapPackage: string, blueprint: MissionBlueprint, record: CompileRecord, decisions: EditorDecisions) {
  const kept = await readKeptTerrain(mapPackage, blueprintCatalog(blueprint));
  const { width, height } = kept.ground;
  const decision = decide(decisions);
  // Cells kept from earlier compiles, unless the author now discards them by name (as PackageOutput re-owns a kept entry: never by "all").
  const keptCells = new Uint8Array(width * height);
  const discarded = Array.isArray(decisions.discard) ? decisions.discard : [];
  for (const entry of record.kept ?? []) {
    if (entry.kind !== "terrain-cells" || discarded.includes(entryName(entry))) continue;
    const cells = cellsOfRects(entry.cells, width, height);
    for (let cell = 0; cell < cells.length; cell++) keptCells[cell] ||= cells[cell]!;
  }
  // The Blueprint's texture sets the last compile wrote, and those the author kept (ADR-0016).
  const recordedSets = record.entries.filter((entry): entry is TextureSetEntry => entry.kind === "texture-set");
  const keptSets = new Set((record.kept ?? []).flatMap((entry) => (entry.kind === "texture-set" && !discarded.includes(entryName(entry)) ? [entry.id] : [])));
  // A kept set the author now discards by name is the Blueprint's again, at its own index and blocks;
  // one still kept keeps its index, which the compile leaves alone.
  const keptEntries = (record.kept ?? []).flatMap((entry) => (entry.kind === "texture-set" ? [{ ...entry, fingerprint: "" }] : []));
  const previousSets = [...recordedSets, ...keptEntries];

  // The Editor's changes to the texture sets the last compile wrote: their names, slots or blocks.
  // Found before the Zones are generated, so a changed set is left alone until the author decides,
  // rather than refused for the Kept ground it now shows differently.
  const changes: EditorChange[] = [];
  const undecided = new Set<string>();
  for (const entry of recordedSets) {
    const blocks = blocksOfRects(entry.blocks, kept.textures.blocksPerRow);
    if (textureSetFingerprint(kept.cliffs.xml, entry.set, blocks) === entry.fingerprint) continue;
    const name = entryName(entry);
    changes.push({ entry, name, change: "changed in the Editor", label: `texture set ${entry.set}, ${kept.textures.sets[entry.set] || "unnamed"}` });
    const decided = decision(name);
    if (decided === "keep") keptSets.add(entry.id);
    else if (decided === undefined) undecided.add(entry.id);
  }
  // An undecided change stops the compile (PackageOutput), so what is generated beside it is never written.
  // Tilesets the package's own TerrainData.xml overrides as Kept Content: a set's CTerrain override would write over one.
  const terrainDataFile = path.join(mapPackage, TERRAIN_DATA);
  const compiledTerrain = new Set(record.entries.flatMap((entry) => (entry.kind === "catalog-entry" && entry.file === TERRAIN_DATA ? [entry.id] : [])));
  const keptTilesets = new Set(
    existsSync(terrainDataFile) ? catalogEntries(await readFile(terrainDataFile, "utf8")).flatMap((entry) => (entry.className === "CTerrain" && entry.id !== undefined && !compiledTerrain.has(entry.key) ? [entry.id] : [])) : [],
  );
  return { kept, keptCells, keptSets: new Set([...keptSets, ...undecided]), previousSets, keptTilesets, changes, decision };
}

/**
 * What the next compile, deciding nothing, would make of a Blueprint's generating Zones beside the
 * package's Kept ground: the ground and dressing sync compares the Editor's objects with, for this
 * Blueprint and for the Blueprint as sync changes it.
 */
export async function zonesForSync(mapPackage: string, blueprint: MissionBlueprint, record: CompileRecord): Promise<(blueprint: MissionBlueprint) => ZoneGround> {
  const { kept, keptCells, keptSets, previousSets, keptTilesets } = await prepareZones(mapPackage, blueprint, record, {});
  return (next) => generateBesideKept(next, kept, { keptCells, compiledObjects: compiledObjectIds(next, record), previousSets, keptSets, keptTilesets });
}

/** The Blueprint's generating Zones written into the package's terrain at `mapPackage`, as above. */
export async function zonesBesideKept(mapPackage: string, blueprint: MissionBlueprint, record: CompileRecord, decisions: EditorDecisions = {}): Promise<ZonesBesideKept> {
  const { kept, keptCells, keptSets, previousSets, keptTilesets, changes, decision } = await prepareZones(mapPackage, blueprint, record, decisions);
  const { width, height } = kept.ground;
  const compiledObjects = compiledObjectIds(blueprint, record);
  // The hidden bit on the Zones' cells: the Blueprint's, but where the Editor changed it (src/map/hidden-cells-changes.ts).
  const field = hiddenCellMask(blueprint, width, height);
  let hidden: HiddenCells | undefined;
  const hide = (owned: Uint8Array) => (hidden = hiddenCells({ width, height, field, may: owned, packageFlags: kept.cliffs.cellFlags, record, decisions }));
  const generate = () => generateBesideKept(blueprint, kept, { keptCells, compiledObjects, previousSets, keptSets, keptTilesets, hidden: hide });
  let zones = generate();

  // The Editor's hand edits to the cells the last compile wrote.
  const keptNow = new Uint8Array(width * height);
  for (const entry of record.entries) {
    if (entry.kind !== "terrain-cells" || !EDITED.has(entry.file as ZoneTerrainFile)) continue;
    const file = entry.file as ZoneTerrainFile;
    const cells = cellsOfRects(entry.cells, width, height);
    const now = packageContent(kept, file);
    if (terrainCellsFingerprint(file, now, cells, width, height, kept.cliffs.xml) === entry.fingerprint) continue;
    const next = zones.files[file];
    const nextXml = zones.files["t3Terrain.xml"].toString();
    const changed = changedCells(file, now, next, cells, width, height, kept.cliffs.xml, nextXml).filter((cell) => !keptCells[cell]);
    if (changed.length === 0) continue;
    // A height map's vertex and a cliff cell are filed under one cell: the cells round them are the edit's.
    const mask = new Uint8Array(width * height);
    for (const cell of changed) mask[cell] = 1;
    const spread = file === "t3TextureMasks" ? mask : around(mask, cells, width, height, file === "t3Terrain.xml" ? 2 : 1);
    const rects = cellRects(spread, width, height);
    const count = spread.reduce((sum, value) => sum + value, 0);
    const changeEntry: CompileRecordEntry = { ...entry, cells: rects };
    const name = entryName(entry);
    changes.push({ entry: changeEntry, name, change: "changed in the Editor", label: `${count} cells of a generating Zone, the first at (${rects[0]![0]}, ${rects[0]![1]})` });
    if (decision(name) === "keep") for (let cell = 0; cell < spread.length; cell++) keptNow[cell] ||= spread[cell]!;
  }
  if (keptNow.includes(1)) {
    for (let cell = 0; cell < keptNow.length; cell++) keptCells[cell] ||= keptNow[cell]!;
    zones = generate();
  }

  changes.push(...hidden!.changes);
  const warnings = [...zones.warnings];
  // Cells the last compile's Zones wrote that no Zone owns now (a Zone moved, shrank or went Kept)
  // keep the generated ground on them and leave the record: they are Kept Content from here on.
  const left = new Uint8Array(width * height);
  for (const entry of record.entries) {
    if (entry.kind !== "terrain-cells") continue;
    const cells = cellsOfRects(entry.cells, width, height);
    for (let cell = 0; cell < cells.length; cell++) if (cells[cell] && !zones.owned[cell] && !keptCells[cell]) left[cell] = 1;
  }
  const leftCount = left.reduce((sum, value) => sum + value, 0);
  if (leftCount > 0) {
    const first = left.indexOf(1);
    warnings.push(
      `${leftCount} cell${leftCount === 1 ? "" : "s"} the last compile's generating Zones wrote, the first at (${first % width}, ${Math.floor(first / width)}), ${leftCount === 1 ? "is" : "are"} in no generating Zone now, so ${leftCount === 1 ? "it keeps" : "they keep"} the generated ground and ${leftCount === 1 ? "is" : "are"} Kept Content from here on: reshape ${leftCount === 1 ? "it" : "them"} with the brushes (edit-terrain), or bring ${leftCount === 1 ? "it" : "them"} back into a generating Zone`,
    );
  }
  const problems = seamProblems(blueprint, kept.ground);
  warnings.push(...problems.map((problem) => `${problem.path}: ${problem.message}`));
  if (zones.moved.length > 0) {
    const listed = zones.moved.slice(0, LISTED).map((doodad) => `${doodad.type} ${doodad.id} by ${+doodad.by.toFixed(3)}`);
    const more = zones.moved.length > LISTED ? ` and ${zones.moved.length - LISTED} more` : "";
    warnings.push(`${zones.moved.length} Kept doodad${zones.moved.length === 1 ? "" : "s"} on the generating Zones' ground moved with the ground: ${listed.join(", ")}${more}`);
  }
  const vertCol = path.join(mapPackage, "t3VertCol");
  if (zones.cliffsChanged && existsSync(vertCol) && hasShadowBake(await readFile(vertCol))) warnings.push(`${REBAKE_SENTENCE}: the generating Zones changed cliffs under the bake in t3VertCol`);
  return { zones, changes, warnings, hiddenCells: hidden!.entry };
}

function packageContent(kept: KeptTerrain, file: ZoneTerrainFile): Buffer | string {
  switch (file) {
    case "t3HeightMap":
      return kept.ground.heightMap;
    case "t3SyncHeightMap":
      return kept.ground.syncHeightMap;
    case "t3SyncCliffLevel":
      return kept.cliffs.syncCliffFile;
    case "t3CellFlags":
      return kept.cliffs.cellFlagsFile;
    case "t3Terrain.xml":
      return kept.cliffs.xml;
    case "t3TextureMasks":
      return kept.textures.masksFile;
    case "t3SyncTextureInfo":
      return kept.textures.syncFile;
  }
}

/** The cells within `by` cells north-east of each marked one (a vertex's or a cliff cell's own), inside `within`. */
function around(mask: Uint8Array, within: Uint8Array, width: number, height: number, by: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let cell = 0; cell < mask.length; cell++) {
    if (!mask[cell]) continue;
    const x = cell % width;
    const y = Math.floor(cell / width);
    // A vertex is a corner of the four cells round it; a cliff cell covers 2×2 from its own.
    const range = by === 1 ? [-1, 0] : [0, 1];
    for (const dy of range) {
      for (const dx of range) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && within[ny * width + nx]) out[ny * width + nx] = 1;
      }
    }
  }
  return out;
}

/** The author's decision for an entry name, as PackageOutput reads it: a name listed wins over the other choice's "all". */
function decide({ keep, discard }: EditorDecisions): (name: string) => "keep" | "discard" | undefined {
  const listed = (list: readonly string[] | "all" | undefined, name: string) => Array.isArray(list) && list.includes(name);
  return (name) => (listed(keep, name) ? "keep" : listed(discard, name) ? "discard" : keep === "all" ? "keep" : discard === "all" ? "discard" : undefined);
}
