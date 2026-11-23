// The catalog layer (ADR-0011): what a Workspace's Campaign Mod defines (tilesets, terrain
// textures, cliff sets, Lights, units, behaviours, doodads and models, and the animations recorded for its
// models), laid over core's catalogs of the game's own entries. Core's data files hold only the
// game's; every lookup in src/catalog reads the layer after them, so Mission compiles, the
// checkers and the Asset Catalog see a mod's entries as they see the game's. A mod's entry with a
// game entry's id overrides it, field by field, as the game loads a mod after its dependencies.
//
// Every lookup is given the Catalog it reads: a Workspace's (`workspace.catalog`, read from its
// Campaign Mod when it loads), a Mission's (missionCatalogFor), or EMPTY_CATALOG for the game's
// entries alone. A Mission Blueprint is validated against one and bound to it, as to its Plugins,
// so it is compiled and checked against the same one (blueprintCatalog). Nothing is kept
// process-wide, so Workspaces compiled at once each read their own mod.
// src/mods/campaign-catalog.ts reads the layer from the mod, and src/map/mission-catalog.ts lays a
// Mission's own Kept game data over it for that Mission.

import type { ModelAnims } from "./model-anims.js";
import type { ModDoodadEntry } from "./mod-doodad-index.js";
import type { ModelGuide } from "./model-guides.js";

/**
 * A list field the mod sets: the whole list, or, when the entry sets only some of its indices
 * (`<CliffSets index="1" value="…"/>`), those indices laid over the list it inherits (its parent's,
 * or the game's entry of its id), an index it removes as null.
 */
export type LayerList = readonly string[] | { readonly over: ReadonlyMap<number, string | null> };

/** A CTerrain the mod defines: only the fields it sets, the rest from its parent or the game's entry of its id. */
export type LayerTileset = {
  readonly parent?: string;
  readonly template?: true;
  readonly textures?: LayerList;
  readonly cliffSets?: LayerList;
  readonly lighting?: string;
  /** Sky fields, named as data/tileset-sky.json names them, values as the XML writes them. */
  readonly sky: Readonly<Record<string, string>>;
};

/** A CUnit the mod defines: only the fields the tech checks read, the rest from its parent or the game's entry of its id. */
export type LayerUnit = {
  readonly parent?: string;
  readonly template?: true;
  readonly mover?: string;
  readonly structure?: boolean;
};

/**
 * One Workspace file of recorded model animations (ADR-0026), by who owns its models: the game's,
 * at the Workspace root; the Campaign Mod's, beside its Blueprint; a Mission's, beside its own.
 */
export type ModelAnimsLayer = {
  readonly owner: "workspace" | "mod" | "mission";
  /** Its path from the Workspace's root, for messages: `model-anims.json`, `mods/<id>/model-anims.json`, `missions/<id>/model-anims.json`. */
  readonly file: string;
  readonly anims: ModelAnims;
  /** Why the file couldn't be read, when it couldn't; it then records nothing, and the Workspace check reports it. */
  readonly error?: string;
};

/** The catalog a lookup reads: the game's entries (core's data files) with a Campaign Mod's layered over them. */
export type Catalog = {
  /** Where the entries come from, for messages: such as `the Campaign Mod Lantern-Story in mods/lantern-story`. */
  readonly source?: string;
  /** Why the Campaign Mod's entries couldn't be read, when they couldn't; the layer is then empty and the Workspace check reports it. */
  readonly error?: string;
  readonly tilesets: ReadonlyMap<string, LayerTileset>;
  readonly textures: ReadonlySet<string>;
  readonly cliffSets: ReadonlySet<string>;
  readonly lights: ReadonlySet<string>;
  readonly units: ReadonlyMap<string, LayerUnit>;
  /** Behaviour ids (CBehavior* of any class, such as CBehaviorBuff), for a trigger scene's unit changes. */
  readonly behaviors: ReadonlySet<string>;
  /** Effect ids (CEffect* of any class, such as CEffectDamage), for an effectStarts cue's effect. */
  readonly effects: ReadonlySet<string>;
  /**
   * Doodad types (CActorDoodad ids), each with its model's variation count when the mod's CModel
   * gives one, and its model's storage path (`Assets/Doodads(Custom)/Fan/Fan.m3`): its actor's
   * Model, else its parent actor's, else the model of its id, through the CModel and its parents;
   * and its Editor categories (`DoodadType:Environment`), its own or its parent actor's.
   */
  readonly doodads: ReadonlyMap<string, { readonly variations?: number; readonly model?: string; readonly categories?: string }>;
  readonly models: ReadonlySet<string>;
  /** The Workspace's recorded model animations, lowest first (the root's, the mod's, the Mission's), laid over data/model-anims.json per model. */
  readonly modelAnimsLayers: readonly ModelAnimsLayer[];
  /** The Model Guides for the mod's models (mods/<id>/model-guide.json), as data/model-guide.json keeps the game's; in the file's order, for the check's paths. */
  readonly modelGuides: readonly ModelGuide[];
  /** Why the mod's model-guide.json couldn't be read, when it couldn't; its guides are then empty, the rest of the layer read, and the Workspace check reports it. */
  readonly modelGuidesError?: string;
  /** The mod's doodad index (mods/<id>/doodad-catalog.json, src/catalog/mod-doodad-index.ts): its doodads described and pictured as core's catalog describes the game's. */
  readonly doodadIndex: ReadonlyMap<string, ModDoodadEntry>;
  /** Why the mod's doodad-catalog.json couldn't be read, when it couldn't; the index is then empty, the rest of the layer read, and the Workspace check reports it. */
  readonly doodadIndexError?: string;
  /** The Campaign Mod's folder (mods/<id>), which the index's sheet paths are relative to. */
  readonly modDir?: string;
  /** The Workspace's folder, when the catalog is a Workspace's: what a Mission's model-anims.json is named from. */
  readonly workspaceRoot?: string;
};

/** The game's entries alone: a Workspace with no Campaign Mod, or code that has none. */
export const EMPTY_CATALOG: Catalog = {
  tilesets: new Map(),
  textures: new Set(),
  cliffSets: new Set(),
  lights: new Set(),
  units: new Map(),
  behaviors: new Set(),
  effects: new Set(),
  doodads: new Map(),
  models: new Set(),
  modelAnimsLayers: [],
  modelGuides: [],
  doodadIndex: new Map(),
};

/** The Catalog each parsed Blueprint was validated against (see `bindCatalog`). */
const BOUND = new WeakMap<object, Catalog>();

/** Records the Catalog a Blueprint was validated against; the Mission Blueprint schema calls it on every parse. A copy doesn't keep it: bind one with bindLikeOriginal (plugin-api.ts). */
export function bindCatalog<Blueprint extends object>(blueprint: Blueprint, catalog: Catalog): Blueprint {
  BOUND.set(blueprint, catalog);
  return blueprint;
}

/** The Catalog a Blueprint was validated against, so it is compiled and checked against the same one; the game's alone for a Blueprint made in code rather than parsed, as for a copy not bound with bindLikeOriginal. */
export function blueprintCatalog(blueprint: object): Catalog {
  return BOUND.get(blueprint) ?? EMPTY_CATALOG;
}

/**
 * A field of the mod's entry `id`, resolved as the game resolves it: the entry's own value, else
 * the game's entry of that id (`stock`), else its parent's, the parent being the mod's or the
 * game's. For an id the mod doesn't define, the game's value.
 */
export function resolveLayered<Entry extends { readonly parent?: string }, T>(
  entries: ReadonlyMap<string, Entry>,
  id: string,
  pick: (entry: Entry) => T | undefined,
  stock: (id: string) => T | undefined,
  seen: Set<string> = new Set(),
): T | undefined {
  const own = entries.get(id);
  if (!own || seen.has(id)) return stock(id);
  seen.add(id);
  return pick(own) ?? stock(id) ?? (own.parent !== undefined ? resolveLayered(entries, own.parent, pick, stock, seen) : undefined);
}

/** A list field of the mod's entry `id`, resolved as resolveLayered resolves a field, an entry setting only some indices laid over the list it inherits. */
export function resolveLayeredList<Entry extends { readonly parent?: string }>(
  entries: ReadonlyMap<string, Entry>,
  id: string,
  pick: (entry: Entry) => LayerList | undefined,
  stock: (id: string) => readonly string[] | undefined,
  seen: Set<string> = new Set(),
): readonly string[] | undefined {
  const own = entries.get(id);
  if (!own || seen.has(id)) return stock(id);
  seen.add(id);
  const list = pick(own);
  if (list !== undefined && !("over" in list)) return list;
  const inherited = stock(id) ?? (own.parent !== undefined ? resolveLayeredList(entries, own.parent, pick, stock, seen) : undefined);
  if (list === undefined) return inherited;
  const out: (string | null | undefined)[] = [...(inherited ?? [])];
  for (const [index, value] of list.over) out[index] = value;
  return out.filter((value): value is string => typeof value === "string");
}

/** Where the catalog's mod entries come from, for a lookup's message: ` or the Campaign Mod …`, or nothing without one. */
export const layerSource = ({ source }: Catalog): string => (source ? ` or ${source}` : "");

/**
 * `catalog` with a Mission's own custom doodads (domain/custom-doodad.ts) laid over it, as its Map
 * Package's data is over its mods': each a doodad of its model's file and Editor category, and a
 * model of its id. `catalog` itself when there are none.
 */
export function withDoodads(catalog: Catalog, doodads: readonly { readonly id: string; readonly model: string; readonly group?: string | undefined }[]): Catalog {
  if (doodads.length === 0) return catalog;
  const own = new Map(catalog.doodads);
  for (const { id, model, group } of doodads) own.set(id, { model: model.replace(/\\/g, "/"), ...(group ? { categories: `DoodadType:${group}` } : {}) });
  return { ...catalog, doodads: own, models: new Set([...catalog.models, ...doodads.map(({ id }) => id)]) };
}
