// A Mission's catalog: its Workspace's (the game's entries and its Campaign Mod's layer) with the
// Kept game data of the Mission's own Map Package laid over it, as the game loads a map's data
// after its mods. A tileset, texture, unit … the map defines for itself (an imported map's own
// CTerrain, say) is then known to the Mission as the mod's are: its Blueprint validates against it
// and compiles against it (blueprintCatalog).
//
// The map's files are merged over the mod's catalog files, field by field (catalogLayerOf's
// `later`), so a map entry that sets one field of a mod's entry keeps the mod's other fields.
//
// Only Kept data counts: a catalog file the compile record lists whole (`file`, `uncommitted`) is
// the compile's own output, and so is an entry it lists (`catalog-entry`) in a Kept file; reading
// them back would check the Blueprint against what its last compile wrote.
//
// It never refuses: a Mission whose package can't be told (two in its folder), or whose compile
// record or game data can't be read, gets its Workspace's catalog, and the checks report the
// package where they check it. A package with no Kept catalog files, and a Mission with no
// model-anims.json of its own (ADR-0026), leave the Workspace's catalog as it is (the same object).

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { Catalog } from "../catalog/catalog-layer.js";
import { MODEL_ANIMS_FILE, readModelAnimsLayer } from "../catalog/model-anims.js";
import type { CompileRecord } from "../domain/compile-record.js";
import { catalogFilesOf, catalogLayerOf, type LaterCatalogFile, withModelAnimsLayer } from "../mods/campaign-catalog.js";
import { loadedCatalogFiles } from "../mods/game-data-files.js";
import type { Workspace } from "../plugins/workspace.js";
import { missionMapPackage, readCompileRecord } from "./mission-package.js";

/** `workspace` as the Mission whose Blueprint is at `blueprintPath` sees it: its `catalog` the Mission's (missionCatalogFor). */
export async function missionWorkspace<W extends Pick<Workspace, "catalog">>(workspace: W, blueprintPath: string): Promise<W> {
  const catalog = await missionCatalogFor(workspace.catalog, blueprintPath);
  return catalog === workspace.catalog ? workspace : { ...workspace, catalog };
}

/**
 * The catalog the Mission whose Blueprint is at `blueprintPath` is validated and compiled against:
 * `base` (its Workspace's) with its package's Kept game data, and the animations recorded for its
 * own models in model-anims.json beside its Blueprint (ADR-0026).
 */
export async function missionCatalogFor(base: Catalog, blueprintPath: string): Promise<Catalog> {
  return withMissionModelAnims(await keptCatalogFor(base, blueprintPath), blueprintPath);
}

/** `catalog` with the animations recorded in model-anims.json beside the Mission Blueprint at `blueprintPath`, when it has the file. */
export async function withMissionModelAnims(catalog: Catalog, blueprintPath: string): Promise<Catalog> {
  const file = path.join(path.dirname(blueprintPath), MODEL_ANIMS_FILE);
  const named = (catalog.workspaceRoot ? path.relative(catalog.workspaceRoot, file) : path.join(path.basename(path.dirname(blueprintPath)), MODEL_ANIMS_FILE)).split(path.sep).join("/");
  return withModelAnimsLayer(catalog, await readModelAnimsLayer(file, named, "mission"));
}

/** `base` with the Kept game data of the Mission's package. */
async function keptCatalogFor(base: Catalog, blueprintPath: string): Promise<Catalog> {
  let mapPackage: string;
  let record: CompileRecord | undefined;
  try {
    mapPackage = await missionMapPackage(blueprintPath);
    record = await readCompileRecord(blueprintPath);
  } catch {
    // Two packages, or a record that doesn't read: which data is Kept can't be told.
    return base;
  }
  return missionCatalog(base, mapPackage, record);
}

/** The Mission catalogs made, by Workspace catalog and package, each with the stamp of what it was read from. */
const MADE = new WeakMap<Catalog, Map<string, { readonly stamp: string; readonly catalog: Catalog }>>();

/** `base` with the Kept catalog data of the Map Package `mapPackage` laid over it; `record` names what a compile owns. */
export async function missionCatalog(base: Catalog, mapPackage: string, record?: CompileRecord): Promise<Catalog> {
  const compiled = new Set<string>();
  const compiledEntries = new Map<string, Set<string>>();
  for (const entry of record?.entries ?? []) {
    if (entry.kind === "file" || entry.kind === "uncommitted") compiled.add(entry.path.toLowerCase());
    else if (entry.kind === "catalog-entry") {
      const ids = compiledEntries.get(entry.file.toLowerCase()) ?? new Set<string>();
      ids.add(entry.id);
      compiledEntries.set(entry.file.toLowerCase(), ids);
    }
  }
  try {
    const kept = (await loadedCatalogFiles(mapPackage)).filter((file) => !compiled.has(file.toLowerCase()));
    if (kept.length === 0) return base;
    const full = (file: string) => path.join(mapPackage, ...file.split("/"));
    // Read again only when a file, or what the record says the compile owns of them, has changed.
    const stats = await Promise.all(kept.map(async (file) => ({ file, at: await stat(full(file)) })));
    const owns = kept.map((file) => [...(compiledEntries.get(file.toLowerCase()) ?? [])].sort().join(","));
    const stamp = JSON.stringify(stats.map(({ file, at }, index) => [file, at.mtimeMs, at.size, owns[index]]));
    const made = MADE.get(base) ?? new Map<string, { stamp: string; catalog: Catalog }>();
    MADE.set(base, made);
    const known = made.get(path.resolve(mapPackage));
    if (known?.stamp === stamp) return known.catalog;
    const later: LaterCatalogFile[] = await Promise.all(
      kept.map(async (file) => {
        const skip = compiledEntries.get(file.toLowerCase());
        return { xml: await readFile(full(file), "utf8"), ...(skip ? { skip } : {}) };
      }),
    );
    const catalog = layOver(base, later, `the Map Package ${path.basename(mapPackage)}`);
    made.set(path.resolve(mapPackage), { stamp, catalog });
    return catalog;
  } catch {
    // Data that doesn't read or parse defines nothing; the Kept checks report the package.
    return base;
  }
}

/** The map's files merged over `base`'s layer, as the game loads a map after its mods. */
function layOver(base: Catalog, later: readonly LaterCatalogFile[], source: string): Catalog {
  const { modelAnimsLayers, modelGuides, modelGuidesError, doodadIndex, doodadIndexError, modDir, workspaceRoot, error } = base;
  const kept = {
    modelAnimsLayers,
    modelGuides,
    doodadIndex,
    ...(modelGuidesError !== undefined ? { modelGuidesError } : {}),
    ...(doodadIndexError !== undefined ? { doodadIndexError } : {}),
    ...(modDir !== undefined ? { modDir } : {}),
    ...(workspaceRoot !== undefined ? { workspaceRoot } : {}),
    ...(error !== undefined ? { error } : {}),
  };
  const sourced = base.source ? `${base.source} or ${source}` : source;
  const files = catalogFilesOf(base);
  if (files) return { ...catalogLayerOf(files.kept, files.owned, later), ...kept, source: sourced };
  // A Catalog made in code has no files to merge over: an entry of an id both define is the map's whole.
  const top = catalogLayerOf([], [], later);
  const map = <V>(under: ReadonlyMap<string, V>, over: ReadonlyMap<string, V>): ReadonlyMap<string, V> => (over.size === 0 ? under : new Map([...under, ...over]));
  const set = (under: ReadonlySet<string>, over: ReadonlySet<string>): ReadonlySet<string> => (over.size === 0 ? under : new Set([...under, ...over]));
  return {
    ...kept,
    source: sourced,
    tilesets: map(base.tilesets, top.tilesets),
    textures: set(base.textures, top.textures),
    cliffSets: set(base.cliffSets, top.cliffSets),
    lights: set(base.lights, top.lights),
    units: map(base.units, top.units),
    behaviors: set(base.behaviors, top.behaviors),
    effects: set(base.effects, top.effects),
    doodads: map(base.doodads, top.doodads),
    models: set(base.models, top.models),
  };
}
