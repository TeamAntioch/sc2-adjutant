// The game's packages a map loads (#1019): each of its dependencies expanded as the engine expands
// it, through the Workspace's own mods' dependencies and the built-in chains of the game's packages
// (docs/reference/data-loading-and-dependencies.md, "Built-in chains"), and which of those packages
// define each of the game's models and Lights (data/package-entries.json,
// scripts/build-package-entries.mjs). The compile warns from them when a Cinematic's cast, Set or
// Light is a package's the map doesn't load (cutscene/cinematic-dependencies.ts).

import { readFileSync } from "node:fs";
import path from "node:path";

import { CORE_DATA_DIR } from "../catalog/stock-catalog.js";
import type { Workspace } from "../plugins/workspace.js";
import { dependencyMods, isModPackageName, modPackageName } from "../mods/workspace-mods.js";
import { DEFAULT_DEPENDENCIES, VOID_MOD } from "./write-document-info-xml.js";

/**
 * One of the game's packages the engine knows by its path (lower case, as `mods/void.sc2mod`): the
 * packages it loads first, and the dependency the Editor writes for it, where one has been seen in
 * an Editor-saved package (absent where it hasn't, so none is guessed).
 */
type GamePackage = {
  readonly parents: readonly string[];
  readonly dependency?: string;
  /** Its parents are taken to be these, not seen: it is suggested only for what it holds itself. */
  readonly assumed?: true;
};

/**
 * The game's packages whose parents are known: the engine's built-in table (Core is mounted at
 * start, before everything), and the Void prologue's own DocumentInfo in the game data's mirror.
 * The Liberty and Swarm story campaigns come in with Void Story, as the doodad catalog's
 * dependencies found (a Liberty or Swarm story doodad shows once a map depends on Void Story) and as
 * model-anims reads Void Story's models; their own parents are taken to be their campaigns'.
 */
const GAME_PACKAGES: Readonly<Record<string, GamePackage>> = {
  "mods/core.sc2mod": { parents: [] },
  "mods/liberty.sc2mod": { parents: [], dependency: "bnet:Liberty (Mod)/0.0/999,file:Mods/Liberty.SC2Mod" },
  "mods/swarm.sc2mod": { parents: ["mods/liberty.sc2mod"] },
  "mods/void.sc2mod": { parents: ["mods/swarm.sc2mod"], dependency: VOID_MOD },
  "campaigns/liberty.sc2campaign": { parents: ["mods/liberty.sc2mod"] },
  "campaigns/swarm.sc2campaign": { parents: ["campaigns/liberty.sc2campaign", "mods/swarm.sc2mod"], dependency: "bnet:Swarm (Campaign)/0.0/999,file:Campaigns/Swarm.SC2Campaign" },
  "campaigns/void.sc2campaign": { parents: ["campaigns/swarm.sc2campaign", "mods/void.sc2mod"], dependency: "bnet:Void (Campaign)/0.0/999,file:Campaigns/Void.SC2Campaign" },
  "campaigns/libertystory.sc2campaign": { parents: ["campaigns/liberty.sc2campaign"], dependency: "bnet:Liberty Story (Campaign)/0.0/999,file:Campaigns/LibertyStory.SC2Campaign", assumed: true },
  "campaigns/swarmstory.sc2campaign": { parents: ["campaigns/swarm.sc2campaign"], dependency: "bnet:Swarm Story (Campaign)/0.0/999,file:Campaigns/SwarmStory.SC2Campaign", assumed: true },
  "campaigns/voidstory.sc2campaign": { parents: ["campaigns/void.sc2campaign", "campaigns/libertystory.sc2campaign", "campaigns/swarmstory.sc2campaign"], dependency: "bnet:Void Story (Campaign)/0.0/999,file:Campaigns/VoidStory.SC2Campaign" },
  "mods/novastoryassets.sc2mod": { parents: ["campaigns/void.sc2campaign"], dependency: "bnet:Nova Covert Ops (Art Mod)/0.0/999,file:Mods/NovaStoryAssets.SC2Mod" },
  "mods/voidprologue.sc2mod": { parents: ["campaigns/swarm.sc2campaign"] },
};

const CORE = "mods/core.sc2mod";

/** Whether `pkg` (a path, lower case) is one of the game's packages whose chain is known. */
export const isGamePackage = (pkg: string): boolean => Object.hasOwn(GAME_PACKAGES, pkg);

/** A game package and every package it loads, by path. */
function closure(pkg: string): Set<string> {
  const out = new Set<string>();
  const visit = (at: string): void => {
    if (out.has(at)) return;
    out.add(at);
    for (const parent of GAME_PACKAGES[at]?.parents ?? []) visit(parent);
  };
  visit(pkg);
  return out;
}

/** The package path a dependency names by its `file:` part, lower case with forward slashes (`mods/novastoryassets.sc2mod`); undefined without one. */
export function dependencyPackage(dependency: string): string | undefined {
  const file = dependency
    .split(",")
    .find((part) => part.trim().startsWith("file:"))
    ?.trim()
    .slice("file:".length);
  return file?.replace(/\\/g, "/").toLowerCase();
}

/**
 * What a map's dependencies load: the game's packages, by path (Core always), and each dependency
 * that couldn't be followed (neither one of the game's packages whose parents are known nor a
 * Workspace mod), which may load more.
 */
export type PackageReach = { readonly loaded: ReadonlySet<string>; readonly unresolved: readonly string[] };

/** The game's packages `dependencies` load, through `mods` (the Workspace's, each by its package's name and with its own dependencies). */
export function packageReachOf(dependencies: readonly string[], mods: readonly { readonly name: string; readonly dependencies: readonly string[] }[]): PackageReach {
  const byName = new Map(mods.map((mod) => [mod.name.toLowerCase(), mod]));
  const loaded = new Set([CORE]);
  const unresolved: string[] = [];
  const visited = new Set<string>();
  const visit = (list: readonly string[]): void => {
    for (const dependency of list) {
      const pkg = dependencyPackage(dependency);
      if (pkg !== undefined && visited.has(pkg)) continue;
      if (pkg !== undefined) visited.add(pkg);
      const last = pkg?.split("/").pop();
      const mod = last && isModPackageName(last) ? byName.get(modPackageName(last)) : undefined;
      if (mod) visit(mod.dependencies);
      else if (pkg !== undefined && isGamePackage(pkg)) for (const each of closure(pkg)) loaded.add(each);
      else if (!unresolved.includes(dependency)) unresolved.push(dependency);
    }
  };
  visit(dependencies);
  return { loaded, unresolved };
}

/** The game's packages a map with `dependencies` loads, through the Workspace's mods. */
export async function packageReach(workspace: Pick<Workspace, "root" | "mods">, dependencies: readonly string[]): Promise<PackageReach> {
  return packageReachOf(dependencies, await dependencyMods(workspace, dependencies));
}

/**
 * The dependency to add for a map to load one of `packages` (the packages that hold something it
 * needs): the one with a known dependency whose chain brings in one of them and loads least. A
 * package with none (the Void prologue) is named by its path, for the author to add in the Editor.
 */
export function dependencyToAdd(packages: readonly string[]): string {
  const candidates = Object.entries(GAME_PACKAGES)
    .flatMap(([pkg, { dependency, assumed }]) => {
      const loads = assumed ? new Set([pkg]) : closure(pkg);
      return dependency && packages.some((needed) => loads.has(needed)) ? [{ dependency, size: closure(pkg).size }] : [];
    })
    .sort((a, b) => a.size - b.size);
  return candidates[0]?.dependency ?? `a dependency on ${packages[0]}`;
}

/** A game package's name as a mapper knows it: `NovaStoryAssets.SC2Mod`, as its dependency's file names it, else its path. */
export function packageName(pkg: string): string {
  const file = GAME_PACKAGES[pkg]?.dependency?.split("file:")[1];
  return file ? path.posix.basename(file.replace(/\\/g, "/")) : pkg;
}

/** Which of the game's packages define each CModel and CLight id (data/package-entries.json), by id: each id's packages, in the file's order. */
export type PackageEntries = { readonly models: ReadonlyMap<string, readonly string[]>; readonly lights: ReadonlyMap<string, readonly string[]> };

export const PACKAGE_ENTRIES_PATH = path.join(CORE_DATA_DIR, "package-entries.json");
let entries: PackageEntries | undefined;

/** The game's packages' models and Lights, read once; a missing or damaged file is refused, naming how to make it again. */
export function packageEntries(): PackageEntries {
  entries ??= (() => {
    type Stored = { readonly packages: Readonly<Record<string, { readonly models: readonly string[]; readonly lights: readonly string[] }>> };
    let stored: Stored;
    try {
      stored = JSON.parse(readFileSync(PACKAGE_ENTRIES_PATH, "utf8")) as Stored;
    } catch (error) {
      throw new Error(`${PACKAGE_ENTRIES_PATH} can't be read (${error instanceof Error ? error.message : String(error)}): make it again with node packages/core/scripts/build-package-entries.mjs`);
    }
    const models = new Map<string, string[]>();
    const lights = new Map<string, string[]>();
    for (const [pkg, held] of Object.entries(stored.packages)) {
      for (const id of held.models) models.set(id, [...(models.get(id) ?? []), pkg]);
      for (const id of held.lights) lights.set(id, [...(lights.get(id) ?? []), pkg]);
    }
    return { models, lights };
  })();
  return entries;
}

/** The package one of the game's files is in, by its path in the game's data (`mods/novastoryassets.sc2mod/base.sc2data/…`): `mods/novastoryassets.sc2mod`. */
export function filePackage(file: string): string | undefined {
  const [kind, pkg] = file.replace(/\\/g, "/").toLowerCase().split("/");
  return (kind === "mods" || kind === "campaigns") && pkg ? `${kind}/${pkg}` : undefined;
}

/**
 * The package a Set imported from the Blizzard cutscene `file` needs, by its name
 * (`NovaStoryAssets.SC2Mod`), and the dependency that brings it in; undefined for one the default
 * Void (Mod) loads, or whose package's chain isn't known.
 */
export function setSourceDependency(file: string): { readonly name: string; readonly dependency: string } | undefined {
  const pkg = filePackage(file);
  if (!pkg || !isGamePackage(pkg) || packageReachOf(DEFAULT_DEPENDENCIES, []).loaded.has(pkg)) return undefined;
  return { name: packageName(pkg), dependency: dependencyToAdd([pkg]) };
}
