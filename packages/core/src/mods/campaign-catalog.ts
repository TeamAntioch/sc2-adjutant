// The Campaign Mod's catalog layer (src/catalog/catalog-layer.ts), read from the mod: its
// tilesets (CTerrain), terrain textures (CTerrainTex), cliff sets (CCliff), Lights (CLight), units
// (CUnit), behaviours (CBehavior*), effects (CEffect*), doodads (CActorDoodad) and models (CModel). Entries still Kept are read from its
// package's GameData; those its Mod Blueprint owns from its catalog sources (`gameData`) and its
// generic entries (`entries`), which override the package's, since the next compile writes them
// over it. The animations recorded for its own models are in mods/<id>/model-anims.json, beside its
// Blueprint (ADR-0026), and their Model Guides in
// mods/<id>/model-guide.json, as data/model-guide.json keeps the game's, and its doodads'
// descriptions and pictures in mods/<id>/doodad-catalog.json (src/catalog/mod-doodad-index.ts), as
// data/doodad-catalog.json keeps the game's.
//
//   <CTerrain id="Coast"><BlendTextures value="Shingle"/>…</CTerrain>    tilesets: Coast, with its textures
//   { "class": "CUnit", "id": "Beacon", "parent": "DESTRUCTIBLE" }      units: Beacon
//
// The package's catalog files are those the game loads: each in GameData named by its catalog
// (UnitData.xml …), and those its includes list (Base.SC2Data/GameData.xml) names. An entry the
// package gives twice takes the later one's fields, field by field, as the game merges a catalog;
// an entry the Blueprint owns replaces the package's copy outright, since the compile writes it
// over that copy whole.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { getDoodad, getDoodadModel } from "../catalog/stock-catalog.js";
import { type Catalog, EMPTY_CATALOG, type LayerList, type LayerTileset, type LayerUnit, type ModelAnimsLayer } from "../catalog/catalog-layer.js";
import { MODEL_ANIMS_FILE, readModelAnimsLayer } from "../catalog/model-anims.js";
import { isPending, type ModDoodadEntry, modDoodadEntry, modDoodadSheet, readModDoodadIndex, storagePath } from "../catalog/mod-doodad-index.js";
import { MODEL_GUIDE_FILE, parseModelGuides } from "../catalog/model-guides.js";
import { techUnit, type TechUnit } from "../catalog/tech-catalog.js";
import { getTilesetCliffSets } from "../catalog/tileset-cliff-sets.js";
import { getTilesetLight } from "../catalog/tileset-lights.js";
import { getTilesetSky, SKY_TAGS, type TilesetSky } from "../catalog/tileset-sky.js";
import { getTilesetTextures } from "../catalog/tileset-textures.js";
import type { Workspace } from "../plugins/workspace.js";
import { type XmlNode, xmlAttribute, xmlTree } from "../util/xml.js";
import { shapeEntries } from "./characters.js";
import { entryXml, readGenericEntries } from "./generic-entries.js";
import { loadedCatalogFiles } from "./game-data-files.js";
import type { ModBlueprint } from "../domain/mod-blueprint.js";
import { campaignMod, readModBlueprint, type WorkspaceMod } from "./workspace-mods.js";


/** One element of a field: its index (its `index` attribute, else its place in the list), the element, and whether it's removed. */
type FieldElement = { readonly index: string; readonly node: XmlNode; readonly removed: boolean };
/** A field as the catalogs merge it: its elements, and whether it's only indices laid over the list the entry inherits (no whole list given). */
type MergedField = { readonly elements: FieldElement[]; readonly over: boolean };
/** A catalog entry as the catalogs merge it: its parent, whether it's a template, its fields by name. */
type MergedEntry = { readonly id: string; parent?: string; template?: true; readonly fields: Map<string, MergedField> };

/** The catalog files each Campaign Mod layer was read from, so data loaded after it can be merged over them as the game does (catalogFilesOf). */
const LAYER_FILES = new WeakMap<Catalog, { readonly kept: readonly string[]; readonly owned: readonly string[] }>();

/**
 * The catalog files `catalog`'s layer was read from (`kept`, then `owned`, as catalogLayerOf takes
 * them): none for the game's entries alone; undefined for a Catalog not read from a mod (one made
 * in code), whose files aren't known.
 */
export function catalogFilesOf(catalog: Catalog): { readonly kept: readonly string[]; readonly owned: readonly string[] } | undefined {
  if (catalog === EMPTY_CATALOG) return { kept: [], owned: [] };
  return LAYER_FILES.get(catalog);
}

/**
 * The catalog files a mod defines, each as XML text in load order: `kept`, its package's (those the
 * game loads), and `owned`, its Blueprint's (its catalog sources, generic entries and the
 * purpose-level shapes' entries, as the compile writes them).
 */
export async function modCatalogFiles(mod: Pick<WorkspaceMod, "blueprintPath" | "modPackage">, blueprint: ModBlueprint): Promise<{ readonly kept: string[]; readonly owned: string[] }> {
  const dir = path.dirname(mod.blueprintPath);
  const read = (file: string): Promise<string> => readFile(file, "utf8");
  const kept = await Promise.all((await loadedCatalogFiles(mod.modPackage)).map((file) => read(path.join(mod.modPackage, ...file.split("/")))));
  const owned = [
    ...(await Promise.all(blueprint.gameData.map(({ source: from }) => read(path.join(dir, from))))),
    ...(await Promise.all(
      blueprint.entries.map(async ({ source: from }) => `<Catalog>\n${readGenericEntries(await read(path.join(dir, from)), from).map(entryXml).join("\n")}\n</Catalog>`),
    )),
  ];
  // The purpose-level shapes' entries (characters, custom doodads), as the compile writes them, but
  // for a swap's CTexture, in its bare slot: its layer's component is the compile's, read from the model.
  const shaped = shapeEntries(blueprint).flatMap(({ entries }) => entries);
  if (shaped.length > 0) owned.push(`<Catalog>\n${shaped.map(entryXml).join("\n")}\n</Catalog>`);
  return { kept, owned };
}

/** `catalog` with `changes`, still knowing the catalog files it was read from (catalogFilesOf). */
export function changedCatalog(catalog: Catalog, changes: Partial<Catalog>): Catalog {
  const next = { ...catalog, ...changes };
  const files = catalogFilesOf(catalog);
  if (files) LAYER_FILES.set(next, files);
  return next;
}

/** `catalog` with `layer` laid over its others in owner order (the root's, the mod's, the Mission's), replacing one of its owner; the same catalog with none (ADR-0026). */
export function withModelAnimsLayer(catalog: Catalog, layer: ModelAnimsLayer | undefined): Catalog {
  if (!layer) return catalog;
  const rank = (owner: ModelAnimsLayer["owner"]) => ["workspace", "mod", "mission"].indexOf(owner);
  const layers = [...catalog.modelAnimsLayers.filter((other) => other.owner !== layer.owner), layer].sort((a, b) => rank(a.owner) - rank(b.owner));
  return changedCatalog(catalog, { modelAnimsLayers: layers });
}

/**
 * The Workspace's Campaign Mod's catalog layer: empty when the Workspace names no Campaign Mod or
 * hasn't imported it. When the mod can't be read, the layer is empty and says why.
 */
export async function readCampaignCatalog(workspace: Omit<Workspace, "catalog">): Promise<Catalog> {
  const mod = await campaignMod(workspace);
  if (!mod) return EMPTY_CATALOG;
  const source = `the Campaign Mod ${mod.name} in mods/${mod.id}`;
  try {
    const blueprint = await readModBlueprint(mod.blueprintPath);
    const dir = path.dirname(mod.blueprintPath);
    const read = (file: string): Promise<string> => readFile(file, "utf8");
    const { kept, owned } = await modCatalogFiles(mod, blueprint);
    const anims = await readModelAnimsLayer(path.join(dir, MODEL_ANIMS_FILE), `mods/${mod.id}/${MODEL_ANIMS_FILE}`, "mod");
    const guideFile = path.join(dir, MODEL_GUIDE_FILE);
    // The guides are advisory: a guide file that doesn't read leaves the rest of the layer.
    let guides: Pick<Catalog, "modelGuides" | "modelGuidesError"> = { modelGuides: [] };
    try {
      if (existsSync(guideFile)) guides = { modelGuides: parseModelGuides(await read(guideFile), `mods/${mod.id}/${MODEL_GUIDE_FILE}`) };
    } catch (error) {
      guides = { modelGuides: [], modelGuidesError: (error as Error).message };
    }
    // The index is advisory too: one that doesn't read leaves the rest of the layer.
    let index: Pick<Catalog, "doodadIndex" | "doodadIndexError"> = { doodadIndex: new Map() };
    try {
      index = { doodadIndex: new Map(Object.entries(await readModDoodadIndex(dir))) };
    } catch (error) {
      index = { doodadIndex: new Map(), doodadIndexError: (error as Error).message };
    }
    const catalog: Catalog = { ...catalogLayerOf(kept, owned), modelAnimsLayers: anims ? [anims] : [], ...guides, ...index, modDir: dir, source };
    LAYER_FILES.set(catalog, { kept, owned });
    return catalog;
  } catch (error) {
    return { ...EMPTY_CATALOG, source, error: `Can't read ${source}'s catalog entries: ${(error as Error).message}` };
  }
}

/**
 * `children`, an entry's field elements, merged into `fields` as the game merges a later
 * definition: a field given only by index (`<Attributes index="Structure" …/>`, `<CliffSets
 * index="1" …/>`) replaces just those indices, in place, or removes one with `removed="1"`; any
 * other field replaces every earlier element of its name, a list's elements indexed by place.
 */
function mergeFields(fields: Map<string, MergedField>, children: readonly XmlNode[]): void {
  const byName = new Map<string, XmlNode[]>();
  for (const child of children) byName.set(child.name, [...(byName.get(child.name) ?? []), child]);
  const element = (node: XmlNode, place: number): FieldElement => ({ index: xmlAttribute(node, "index") ?? String(place), node, removed: xmlAttribute(node, "removed") === "1" });
  for (const [name, nodes] of byName) {
    if (!nodes.every((node) => xmlAttribute(node, "index") !== undefined)) {
      fields.set(name, { elements: nodes.map(element), over: false });
      continue;
    }
    const field = fields.get(name) ?? { elements: [], over: true };
    const elements = [...field.elements];
    for (const node of nodes) {
      const next = element(node, elements.length);
      const at = elements.findIndex((known) => known.index === next.index);
      if (at >= 0) elements[at] = next;
      else elements.push(next);
    }
    fields.set(name, { elements, over: field.over });
  }
}

/** A catalog file loaded after a layer's own (a Map Package's over its Campaign Mod's), and the ids of the entries in it not to read. */
export type LaterCatalogFile = { readonly xml: string; readonly skip?: ReadonlySet<string> };

/**
 * The layer the catalog files define, each list in load order: `kept`, the package's, then
 * `owned`, the Blueprint's, whose first definition of an entry replaces the package's copy of it,
 * then `later`, data the game loads after (a Map Package's own), merged field by field over all of
 * it as the game merges a map's data over its mods'.
 */
export function catalogLayerOf(
  kept: readonly string[],
  owned: readonly string[] = [],
  later: readonly LaterCatalogFile[] = [],
): Omit<Catalog, "modelAnimsLayers" | "modelGuides" | "modelGuidesError" | "doodadIndex" | "doodadIndexError" | "modDir" | "source"> {
  const byClass = new Map<string, Map<string, MergedEntry>>();
  /** The entries an owned file has defined, by class and id. */
  const ownedIds = new Set<string>();
  const files: LaterCatalogFile[] = [...kept.map((xml) => ({ xml })), ...owned.map((xml) => ({ xml })), ...later];
  const laterFrom = kept.length + owned.length;
  for (const [at, { xml, skip }] of files.entries()) {
    const root = xmlTree(xml).find((node) => node.name === "Catalog");
    for (const node of root?.children ?? []) {
      const id = xmlAttribute(node, "id");
      if (!id || skip?.has(id)) continue;
      const entries = byClass.get(node.name) ?? new Map<string, MergedEntry>();
      byClass.set(node.name, entries);
      const key = `${node.name}\u0000${id}`;
      const owning = at >= kept.length && at < laterFrom;
      const replaces = owning && !ownedIds.has(key);
      if (owning) ownedIds.add(key);
      const entry: MergedEntry = (!replaces && entries.get(id)) || { id, fields: new Map() };
      const parent = xmlAttribute(node, "parent");
      if (parent !== undefined) entry.parent = parent;
      const template = xmlAttribute(node, "default");
      if (template === "1") entry.template = true;
      else if (template !== undefined) delete entry.template;
      mergeFields(entry.fields, node.children);
      entries.set(id, entry);
    }
  }
  const of = (cls: string): MergedEntry[] => [...(byClass.get(cls)?.values() ?? [])];
  const present = (entry: MergedEntry, field: string): FieldElement[] => entry.fields.get(field)?.elements.filter((element) => !element.removed) ?? [];
  const value = (entry: MergedEntry, field: string): string | undefined => {
    const node = present(entry, field)[0]?.node;
    return node ? xmlAttribute(node, "value") : undefined;
  };
  const values = (entry: MergedEntry, field: string): LayerList | undefined => {
    const merged = entry.fields.get(field);
    if (!merged) return undefined;
    if (merged.over && merged.elements.every((element) => /^\d+$/.test(element.index))) {
      return { over: new Map(merged.elements.map((element) => [Number(element.index), element.removed ? null : (xmlAttribute(element.node, "value") ?? null)])) };
    }
    return present(entry, field).flatMap((element) => xmlAttribute(element.node, "value") ?? []);
  };
  const head = (entry: MergedEntry) => ({ ...(entry.parent !== undefined ? { parent: entry.parent } : {}), ...(entry.template ? { template: true as const } : {}) });

  const tilesets = new Map<string, LayerTileset>(
    of("CTerrain").map((entry) => {
      const textures = values(entry, "BlendTextures");
      const cliffSets = values(entry, "CliffSets");
      const lighting = value(entry, "Lighting");
      const sky = Object.fromEntries(SKY_TAGS.flatMap(([tag, field]) => (value(entry, tag) !== undefined ? [[field, value(entry, tag)!]] : [])));
      return [entry.id, { ...head(entry), ...(textures ? { textures } : {}), ...(cliffSets ? { cliffSets } : {}), ...(lighting !== undefined ? { lighting } : {}), sky }];
    }),
  );
  const units = new Map<string, LayerUnit>(
    of("CUnit").map((entry) => {
      const mover = value(entry, "Mover");
      const structure = present(entry, "Attributes").find((element) => element.index === "Structure")?.node;
      return [entry.id, { ...head(entry), ...(mover !== undefined ? { mover } : {}), ...(structure ? { structure: xmlAttribute(structure, "value") === "1" } : {}) }];
    }),
  );
  const models = new Map(of("CModel").map((entry) => [entry.id, entry]));
  const variations = (model: string, seen = new Set<string>()): number | undefined => {
    const entry = models.get(model);
    if (!entry || seen.has(model)) return undefined;
    seen.add(model);
    // A count that isn't a whole number is no count: the parent's, else the doodad has one variation.
    const count = Number(value(entry, "VariationCount"));
    return Number.isInteger(count) ? count : entry.parent !== undefined ? variations(entry.parent, seen) : undefined;
  };
  // A doodad's model is its own Model, else its parent actor's, else the model of its id.
  const actors = new Map(of("CActorDoodad").map((entry) => [entry.id, entry]));
  const actorModel = (id: string, seen = new Set<string>()): string | undefined => {
    const entry = actors.get(id);
    if (!entry || seen.has(id)) return undefined;
    seen.add(id);
    return value(entry, "Model") ?? (entry.parent !== undefined ? actorModel(entry.parent, seen) : undefined);
  };
  // A model's file is its own Model (`##id##` its id), else its parent's; a model the mod doesn't
  // define, or whose chain gives none (the game's Doodad template names `Assets\Doodads\##id##\…`),
  // is the game's file of that id.
  const modelFile = (model: string, id: string = model, seen = new Set<string>()): string => {
    const entry = models.get(model);
    if (entry && !seen.has(model)) {
      seen.add(model);
      const file = value(entry, "Model");
      if (file !== undefined) return storagePath(file.replace(/##id##/g, id));
      if (entry.parent !== undefined) return modelFile(entry.parent, id, seen);
    }
    // A game model the chain reaches (a parent such as RockA) gives its own file; a template such as Doodad gives none.
    return (model !== id ? getDoodadModel(model) : undefined) ?? getDoodadModel(id) ?? `Assets/Doodads/${id}/${id}.m3`;
  };
  const actorField = (id: string, field: string, seen = new Set<string>()): string | undefined => {
    const entry = actors.get(id);
    if (!entry || seen.has(id)) return undefined;
    seen.add(id);
    return value(entry, field) ?? (entry.parent !== undefined ? actorField(entry.parent, field, seen) : undefined);
  };
  const doodads = new Map(
    [...actors.values()]
      .filter((entry) => !entry.template)
      .map((entry) => {
        // An actor template's Model may be `##id##`: the actor's own id.
        const model = (actorModel(entry.id) ?? entry.id).replace(/##id##/g, entry.id);
        const count = variations(model);
        const categories = actorField(entry.id, "EditorCategories");
        return [entry.id, { ...(count !== undefined ? { variations: Math.max(1, count) } : {}), model: modelFile(model), ...(categories ? { categories } : {}) }];
      }),
  );
  const ids = (cls: string): Set<string> => new Set(of(cls).filter((entry) => !entry.template).map((entry) => entry.id));
  // A behaviour is any CBehavior class's (CBehaviorBuff, CBehaviorPowerSource …).
  const ofClasses = (prefix: string): Set<string> => new Set([...byClass.keys()].filter((cls) => cls.startsWith(prefix)).flatMap((cls) => [...ids(cls)]));
  const behaviors = ofClasses("CBehavior");
  // An effect is any CEffect class's (CEffectDamage, CEffectSet …).
  const effects = ofClasses("CEffect");
  return { tilesets, textures: ids("CTerrainTex"), cliffSets: ids("CCliff"), lights: ids("CLight"), units, behaviors, effects, doodads, models: ids("CModel") };
}

/** One of the Campaign Mod's tilesets, resolved as a Mission compile reads it. */
export type CatalogTileset = {
  readonly id: string;
  readonly textures: readonly string[];
  readonly cliffSets: readonly string[];
  readonly light: string;
  readonly sky: TilesetSky;
};

/**
 * One of the Campaign Mod's doodads, with what its doodad index says of it when the index covers
 * it: its model, its description and who wrote it, or that it's pending; its sheet's absolute path
 * when the file is on this machine, or why it has no picture.
 */
export type CatalogDoodad = {
  readonly id: string;
  readonly variations: number;
  readonly model?: string;
  readonly indexed?: Pick<ModDoodadEntry, "name" | "description" | "described" | "unpictured" | "renderError"> & { readonly pending?: true; readonly sheet?: string };
};

/** What a Workspace's Campaign Mod defines, for the Asset Catalog: each tileset and unit resolved through its parents, the rest by id, all sorted. */
export type CampaignCatalogEntries = {
  readonly source?: string;
  readonly tilesets: readonly CatalogTileset[];
  readonly textures: readonly string[];
  readonly cliffSets: readonly string[];
  readonly lights: readonly string[];
  readonly units: readonly ({ readonly id: string } & TechUnit)[];
  readonly doodads: readonly CatalogDoodad[];
  readonly models: readonly string[];
};

/** A Workspace's Campaign Mod's entries (its catalog layer), for the Asset Catalog. */
export function campaignCatalogEntries(workspace: Pick<Workspace, "catalog">): CampaignCatalogEntries {
  const layer = workspace.catalog;
  const sorted = (ids: Iterable<string>): string[] => [...ids].sort();
  const usable = <T extends { readonly template?: true }>(entries: ReadonlyMap<string, T>): string[] => sorted([...entries].filter(([, entry]) => !entry.template).map(([id]) => id));
  return {
    ...(layer.source ? { source: layer.source } : {}),
    tilesets: usable(layer.tilesets).map((id) => ({ id, textures: getTilesetTextures(layer, id), cliffSets: getTilesetCliffSets(layer, id), light: getTilesetLight(layer, id), sky: getTilesetSky(layer, id) ?? {} })),
    textures: sorted(layer.textures),
    cliffSets: sorted(layer.cliffSets),
    lights: sorted(layer.lights),
    units: usable(layer.units).map((id) => ({ id, ...techUnit(layer, id) })),
    doodads: sorted(layer.doodads.keys()).map((id) => {
      const model = layer.doodads.get(id)?.model;
      const entry = modDoodadEntry(layer, id);
      const sheet = modDoodadSheet(layer, id);
      const indexed = entry && {
        ...(entry.name !== undefined ? { name: entry.name } : {}),
        ...(entry.description ? { description: entry.description } : {}),
        ...(isPending(entry) ? { pending: true as const } : { described: entry.described! }),
        ...(sheet !== undefined ? { sheet } : {}),
        ...(entry.unpictured !== undefined ? { unpictured: entry.unpictured } : {}),
        ...(entry.renderError !== undefined ? { renderError: entry.renderError } : {}),
      };
      return { id, variations: getDoodad(layer, id)?.variations ?? 1, ...(model !== undefined ? { model } : {}), ...(indexed ? { indexed } : {}) };
    }),
    models: sorted(layer.models),
  };
}
