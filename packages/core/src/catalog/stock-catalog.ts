// Core's stock doodad catalog: the published @team-antioch/sc2-asset-catalog (ADR-0022) bound to
// the files core commits in data/. The package's code reads whatever folder it's given; a mapper's
// copy reads the fields it extracted into their cache. Core keeps its own committed copies, so a
// compile reads the same doodads on every machine with no extract step:
//
//   data/doodads.json, doodad-models.json, doodad-extracted.json   extracted from SC2GameData
//   data/texture-extracted.json, cliff-extracted.json              (`npm run extract-catalog`)
//   data/doodad-facings.json, doodad-sheet-readings.json           sc2-adjutant's measured fronts
//   data/terrain-object-catalog.json                               sc2-adjutant's terrain objects
//
// A compile reads the textures' and cliff sets' ids and each tileset's blend textures and cliff
// sets, so core commits those too. The descriptions and Doodad Uses are the package's own (its data/), as published: core keeps no
// copy, and contribute_doodad_notes adds to them by pull request on sc2-asset-catalog. Until a
// release carries a contribution, the Workspace's doodad notes lay its uses over the package's.
//
// Renders and sheets are under data/ too (data/thumbnails/, data/catalog-sheets/, git-ignored), so
// data/ is the sources' root; a linked worktree, which has none of its own, finds them in the main
// checkout. Everything here is a binding: the logic is the package's. unknownPlacedDoodads gives
// the package's warnings with sc2-adjutant's own fix (a Blueprint's doodads).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type DoodadCatalogEntry, type DoodadDescription, readDoodadCatalog } from "@team-antioch/sc2-asset-catalog/catalog/doodad-catalog.js";
import { missingDoodadDependencies as missingFor } from "@team-antioch/sc2-asset-catalog/catalog/doodad-dependencies.js";
import {
  compositeFrontFrom as compositeFrontFromOf,
  type CompositeFronts,
  type DoodadFacing,
  type DoodadFacings,
  type DoodadSheetReadings,
  type FrontSource,
  getDoodadFacing as getDoodadFacingOf,
  getDoodadFront as getDoodadFrontOf,
  readDoodadFacings,
  readSheetReadings,
  rotationToFace as rotationToFaceOf,
} from "@team-antioch/sc2-asset-catalog/catalog/doodad-facings.js";
import { type CliffCatalog, type CliffSetEntry, readCliffCatalog } from "@team-antioch/sc2-asset-catalog/catalog/cliff-catalog.js";
import { DECAL_DESCRIPTIONS_PATH } from "@team-antioch/sc2-asset-catalog/catalog/catalog-dirs.js";
import { type DecalCatalog, joinDecalCatalog, parseDecalDescriptions } from "@team-antioch/sc2-asset-catalog/catalog/decal-catalog.js";
import { readTextureCatalog, type TextureCatalog, type TextureEntry } from "@team-antioch/sc2-asset-catalog/catalog/texture-catalog.js";
import { type ReadStockSources, readStockDoodadSources, type SearchableTerrainObject, stockDoodadSourceFiles, type StockSourcesOptions } from "@team-antioch/sc2-asset-catalog/catalog/doodad-search.js";
import {
  checkDoodad as checkStockDoodad,
  type DoodadInfo,
  type DoodadLayer,
  getDoodad as getStockDoodad,
  readDoodadModels,
  readDoodads,
  unknownPlacedDoodads as unknownStockDoodads,
} from "@team-antioch/sc2-asset-catalog/catalog/doodads.js";

import { inMainCheckout } from "../util/main-checkout.js";

/** Core's package folder. */
export const CORE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** Core's data folder: its catalogs, and the root its renders and sheets are found under. */
export const CORE_DATA_DIR = path.join(CORE_ROOT, "data");
export const CORE_TERRAIN_OBJECT_CATALOG = path.join(CORE_DATA_DIR, "terrain-object-catalog.json");
export const DOODAD_FACINGS_PATH = path.join(CORE_DATA_DIR, "doodad-facings.json");
export const DOODAD_SHEET_READINGS_PATH = path.join(CORE_DATA_DIR, "doodad-sheet-readings.json");

/** Reads one of core's extracted files, saying how core regenerates it when it isn't there (the package's advice is for a cache). */
function extracted<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !/run the extract(-\w+)? command/.test((error as Error).message)) throw error;
    throw new Error(`Core's extracted catalog in ${CORE_DATA_DIR} won't read (${(error as Error).message}): restore it from git, or regenerate it with npm run extract-catalog`, { cause: error });
  }
}

// --- The game's doodads (data/doodads.json, data/doodad-models.json) ---

let doodads: Record<string, DoodadInfo> | undefined;
let models: Record<string, string> | undefined;

/** Every game doodad, by id, read once. */
export const stockDoodads = (): Readonly<Record<string, DoodadInfo>> => (doodads ??= extracted(() => readDoodads(CORE_DATA_DIR)));

/** A doodad type, the game's or the Campaign Mod's (whose kind is `campaign-mod`), with the mod's variations. */
export const getDoodad = (layer: Pick<DoodadLayer, "doodads">, type: string): DoodadInfo | undefined => getStockDoodad(stockDoodads(), layer, type);

/** Every game doodad type, in id order. */
export const listDoodads = (): Array<[type: string, info: DoodadInfo]> => Object.entries(stockDoodads());

const doodadModels = (): Readonly<Record<string, string>> => (models ??= extracted(() => readDoodadModels(CORE_DATA_DIR)));

/** The doodad's model file in the game's storage, e.g. Assets/Doodads/RockArch/RockArch.m3. */
export const getDoodadModel = (type: string): string | undefined => (Object.hasOwn(doodadModels(), type) ? doodadModels()[type] : undefined);

/** Every game doodad's model file, as getDoodadModel gives them. */
export const gameDoodadModels = (): Iterable<string> => Object.values(doodadModels());

// --- The game's model files (data/game-models.json, the doodads' above and the story sets' parts) ---

export const GAME_MODELS_PATH = path.join(CORE_DATA_DIR, "game-models.json");
/** The set catalogue (data/cinematic-sets): its Blizzard pieces named by file are game model files no CModel names. */
const SET_CATALOG_PATH = path.join(CORE_DATA_DIR, "cinematic-sets", "catalog.json");
let gameModels: ReadonlySet<string> | undefined;
const comparable = (storagePath: string): string => storagePath.replace(/\\/g, "/").toLowerCase();

/** The model paths in a game-models.json; a missing or damaged one is refused, naming it and how to make it again. */
export function readGameModelPaths(file: string = GAME_MODELS_PATH): string[] {
  const again = "make it again with `npm run build -w packages/core && node packages/core/scripts/build-game-models.mjs`";
  let paths: unknown;
  try {
    paths = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file} can't be read (${error instanceof Error ? error.message : String(error)}): ${again}`);
  }
  if (!Array.isArray(paths) || !paths.every((each) => typeof each === "string")) throw new Error(`${file} can't be read (it isn't a list of model paths): ${again}`);
  return paths;
}

/** The CModel ids of every model in the set catalogue's sets (data/cinematic-sets/catalog.json), once each, sorted: a piece named by file alone has none. */
export function setCatalogModelIds(): string[] {
  type Catalog = { sets: { models: { model: string }[]; occurrences: { pieces: { model: string; modelPath?: string }[] }[] }[] };
  const { sets } = JSON.parse(readFileSync(SET_CATALOG_PATH, "utf8")) as Catalog;
  const pieces = sets.flatMap((set) => set.occurrences.flatMap((occurrence) => occurrence.pieces));
  // A name some piece gives by file alone is no CModel, unless another piece names it as one.
  const asCModel = new Set(pieces.flatMap((piece) => (piece.modelPath ? [] : [piece.model])));
  const byFile = new Set(pieces.flatMap((piece) => (piece.modelPath && !asCModel.has(piece.model) ? [piece.model] : [])));
  return [...new Set(sets.flatMap((set) => set.models.map((entry) => entry.model)))].filter((model) => !byFile.has(model)).sort();
}

/** The model files the set catalogue's Blizzard pieces name by file (actors' `modelPath`: story sets' parts, which no CModel names). */
function setPieceModelPaths(): string[] {
  type Catalog = { sets: { occurrences: { origin: string; pieces: { modelPath?: string }[] }[] }[] };
  const { sets } = JSON.parse(readFileSync(SET_CATALOG_PATH, "utf8")) as Catalog;
  return sets.flatMap((set) =>
    set.occurrences.filter((occurrence) => occurrence.origin === "blizzard").flatMap((occurrence) => occurrence.pieces.flatMap((piece) => (piece.modelPath ? [piece.modelPath] : []))),
  );
}

/**
 * Whether core knows of a game model file at `storagePath` (either slash, any case): one its CModels
 * name (data/game-models.json, `node scripts/build-game-models.mjs`), a game doodad's model, or a
 * part of Blizzard's story sets that an actor names by file (the set catalogue's pieces). A model
 * with variations is only its numbered files (`_00.m3` and on), as the game names them. The game
 * may still have a file none of these name.
 */
export function isGameModel(storagePath: string): boolean {
  gameModels ??= (() => {
    const paths = new Set([...readGameModelPaths(), ...setPieceModelPaths()].map(comparable));
    for (const [type, info] of listDoodads()) {
      const model = getDoodadModel(type);
      if (!model) continue;
      if (info.variations <= 1) paths.add(comparable(model));
      else for (let variation = 0; variation < info.variations; variation++) paths.add(comparable(model.replace(/\.m3$/i, `_${String(variation).padStart(2, "0")}.m3`)));
    }
    return paths;
  })();
  return gameModels.has(comparable(storagePath));
}

/** Throws if a doodad type doesn't exist or its variation is out of range (the Editor would show nothing). */
export const checkDoodad = (layer: Pick<DoodadLayer, "doodads">, anchorId: string, type: string | undefined, variation: number | undefined): void =>
  checkStockDoodad(stockDoodads(), layer, anchorId, type, variation);

/** The package's fixes for an unknown placed doodad, and sc2-adjutant's: a Blueprint declares doodads. */
const PLACED_FIXES: readonly (readonly [string, string])[] = [
  ["Give it a CActorDoodad of that id", "Declare it in the Blueprint's doodads (or the Campaign Mod's), which write its CModel and CActorDoodad"],
  [
    "a doodad type that isn't among the game's doodads, the mod's or the map's data.",
    "a doodad type that isn't in core's catalog of the game's doodads, the Campaign Mod or the map's data.",
  ],
  ["give it a CActorDoodad in the map's or the mod's data", "declare it in the Blueprint's doodads (or the Campaign Mod's)"],
];

/**
 * The package's warning for each type an Objects file places as a doodad that isn't a doodad type
 * of `layer` (the game's, the Workspace's Campaign Mod's and the Mission's own), which the Editor
 * shows as a placeholder, with sc2-adjutant's fix: declaring it in a Blueprint's doodads. Objects
 * whose Id is in `skip` (the compile's own) are left out.
 */
export const unknownPlacedDoodads = (objectsXml: string, layer: DoodadLayer, skip?: ReadonlySet<number>): string[] =>
  unknownStockDoodads(objectsXml, stockDoodads(), layer, skip).map((warning) => PLACED_FIXES.reduce((text, [theirs, ours]) => text.replace(theirs, ours), warning));

// --- The doodad catalog (descriptions joined to the extracted fields) ---

let catalog: Record<string, DoodadCatalogEntry> | undefined;
const coreCatalog = (): Readonly<Record<string, DoodadCatalogEntry>> => (catalog ??= readCoreDoodadCatalog().catalog);

/** The doodad catalog read afresh: the package's descriptions, core's extracted fields and the two joined. */
export const readCoreDoodadCatalog = () => extracted(() => readDoodadCatalog(CORE_DATA_DIR));

/** A game doodad's description from its picture, if core's catalog has one; sc2-adjutant lays a Campaign Mod's doodad index over it. */
export const getGameDoodadDescription = (type: string): DoodadDescription | undefined => (Object.hasOwn(coreCatalog(), type) ? coreCatalog()[type]!.description : undefined);

/** The SC2GameData package that defines a doodad (e.g. "campaigns/liberty.sc2campaign"). */
export const getDoodadPackage = (type: string): string | undefined => (Object.hasOwn(coreCatalog(), type) ? coreCatalog()[type]!.package : undefined);

/** The map dependencies `have` lacks for these doodad types, each with the types that need it. */
export const missingDoodadDependencies = (types: Iterable<string>, have: readonly string[]): Map<string, string[]> => missingFor(types, have, getDoodadPackage);

// --- The game's terrain textures (data/texture-extracted.json, with the package's descriptions) ---

let textures: TextureCatalog | undefined;
let texturesById: ReadonlyMap<string, TextureEntry> | undefined;

/** The game's terrain textures and each tileset's blend textures, read once: the package's descriptions joined to core's extracted fields. */
export const stockTextures = (): TextureCatalog => (textures ??= extracted(() => readTextureCatalog({ extractedDir: CORE_DATA_DIR })));

/** One of the game's terrain textures, by CTerrainTex id. */
export const getStockTexture = (id: string): TextureEntry | undefined => (texturesById ??= new Map(stockTextures().entries.map((entry) => [entry.id, entry]))).get(id);

// --- The game's cliff sets (data/cliff-extracted.json, with the package's descriptions) ---

let cliffs: CliffCatalog | undefined;
let cliffsById: ReadonlyMap<string, CliffSetEntry> | undefined;

/** The game's cliff sets and each tileset's cliff sets, read once: the package's descriptions joined to core's extracted fields. */
export const stockCliffs = (): CliffCatalog => (cliffs ??= extracted(() => readCliffCatalog({ extractedDir: CORE_DATA_DIR })));

/** One of the game's cliff sets, by id. */
export const getStockCliffSet = (id: string): CliffSetEntry | undefined => (cliffsById ??= new Map(stockCliffs().entries.map((entry) => [entry.id, entry]))).get(id);

// --- The decal catalog (the package's descriptions) ---

let decals: DecalCatalog | undefined;

/**
 * Each decal doodad's variations as a compile reads them: the package's descriptions alone, so every
 * machine picks the same ones. Each variation's texture and box in cells are read from the user's
 * install by the package's `extract-decals`, into the cache: `decal_variations` adds them when
 * they're there (readDecalCatalog), and no compile reads them.
 */
export const stockDecals = (): DecalCatalog => (decals ??= joinDecalCatalog(parseDecalDescriptions(readFileSync(DECAL_DESCRIPTIONS_PATH, "utf8"), DECAL_DESCRIPTIONS_PATH)));

// --- Facings (data/doodad-facings.json, data/doodad-sheet-readings.json) ---

let facings: DoodadFacings | undefined;
let readings: DoodadSheetReadings | undefined;

/** Core's measured facings, read once. */
export const bundledDoodadFacings = (): DoodadFacings => (facings ??= readDoodadFacings(DOODAD_FACINGS_PATH));
/** Core's sheet readings, read once. */
export const bundledSheetReadings = (): DoodadSheetReadings => (readings ??= readSheetReadings(DOODAD_SHEET_READINGS_PATH));

/** The package's getDoodadFront, over core's facings and readings unless given others. */
export const getDoodadFront = (type: string, own: DoodadFacings = bundledDoodadFacings(), read: DoodadSheetReadings = bundledSheetReadings()): { readonly front: number; readonly source: FrontSource } | undefined =>
  getDoodadFrontOf(type, own, read);
/** The package's getDoodadFacing, over core's facings unless given others. */
export const getDoodadFacing = (type: string, own: DoodadFacings = bundledDoodadFacings()): DoodadFacing | undefined => getDoodadFacingOf(type, own);
/** The package's rotationToFace, over core's facings and readings unless given others. */
export const rotationToFace = (type: string, facing: number, own: DoodadFacings = bundledDoodadFacings(), read: DoodadSheetReadings = bundledSheetReadings()) =>
  rotationToFaceOf(type, facing, own, read);
/** The package's compositeFrontFrom, over core's facings and readings unless given others. */
export const compositeFrontFrom = (recipe: CompositeFronts, own: DoodadFacings = bundledDoodadFacings(), read: DoodadSheetReadings = bundledSheetReadings()) => compositeFrontFromOf(recipe, own, read);
/** The package's compositeFront, over core's facings and readings unless given others. */
export const compositeFront = (recipe: CompositeFronts, own?: DoodadFacings, read?: DoodadSheetReadings): number | undefined => compositeFrontFrom(recipe, own, read).front;

// --- The search's stock sources ---

/** Where the package's stock sources are core's files: its extracted fields, with the package's own descriptions and Doodad Uses. */
const CORE_FILES: StockSourcesOptions = { cacheDir: CORE_DATA_DIR, extractedDir: CORE_DATA_DIR };

/** The files core's search sources are read from: the doodad catalog's, the terrain-object catalog and the Doodad Uses folder. */
export const CORE_DOODAD_SOURCE_FILES: readonly string[] = [...stockDoodadSourceFiles(CORE_FILES), CORE_TERRAIN_OBJECT_CATALOG];

/** Core's catalogs read afresh, for a process that keeps running while they change (the Doodad Finder's). */
export function readCoreDoodadSources(): ReadStockSources {
  const terrainObjects = JSON.parse(readFileSync(CORE_TERRAIN_OBJECT_CATALOG, "utf8")) as Record<string, SearchableTerrainObject>;
  return extracted(() =>
    readStockDoodadSources({ ...CORE_FILES, terrainObjects, facings: bundledDoodadFacings(), readings: bundledSheetReadings(), pictureFallback: inMainCheckout }),
  );
}

let sources: ReadStockSources | undefined;

/** Core's catalogs of the game's doodads and terrain objects, with their Doodad Uses, read once, to search alone or with mod doodads and notes laid over them. */
export const coreDoodadSources = (): ReadStockSources => (sources ??= readCoreDoodadSources());
