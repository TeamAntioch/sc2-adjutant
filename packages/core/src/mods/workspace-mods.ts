// A Workspace's mods (ADR-0011): each one the Workspace config names is mods/<id>/, holding its
// Mod Blueprint, its committed mod package (<Name>.SC2Mod, the name dependencies refer to it by)
// and its compile record. The Workspace config or its Campaign Pack names the Campaign Mod by
// package name, and the Workspace mod of that name is it.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { type ModBlueprint, ModBlueprintSchema, type ModKind } from "../domain/mod-blueprint.js";
import { BLUEPRINT_FILE, campaignModName, MODS_DIR, type Workspace } from "../plugins/workspace.js";
import { formatIssues } from "../util/format-issues.js";

export const MOD_PACKAGE_EXTENSION = ".SC2Mod";

/** Whether a folder name (not a path) is a mod package's: a name, then `.SC2Mod` in any case, as the game reads it. */
export const isModPackageName = (name: string): boolean => name.toLowerCase().endsWith(MOD_PACKAGE_EXTENSION.toLowerCase()) && name.length > MOD_PACKAGE_EXTENSION.length;

/** A mod package folder's name without its `.SC2Mod`: the name dependencies and the Campaign Pack know the mod by. */
export const modPackageName = (folderName: string): string => folderName.slice(0, -MOD_PACKAGE_EXTENSION.length);

/** Whether two mod names are one: the game matches them in any case. */
export const sameModName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The mod package folders in `dir`, by folder name, sorted; none when it isn't there. */
async function modPackageFolders(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && isModPackageName(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** Every mod folder's packages, by the folder's id and the package's name, whether or not the config names it or its Blueprint reads. */
export async function modFolderPackages(workspace: Pick<Workspace, "root">): Promise<{ readonly id: string; readonly name: string }[]> {
  const modsDir = path.join(workspace.root, MODS_DIR);
  if (!existsSync(modsDir)) return [];
  const found: { id: string; name: string }[] = [];
  for (const folder of await readdir(modsDir, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    for (const pkg of await modPackageFolders(path.join(modsDir, folder.name))) found.push({ id: folder.name, name: modPackageName(pkg) });
  }
  return found;
}

/** One of a Workspace's mods, as its folder holds it. */
export type WorkspaceMod = {
  readonly id: string;
  readonly kind: ModKind;
  /** Its package's name without `.SC2Mod`, as dependencies (`file:Mods\<name>.SC2Mod`) and the Campaign Pack name it. */
  readonly name: string;
  readonly blueprintPath: string;
  readonly modPackage: string;
  readonly dependencies: readonly string[];
};

/** The folder of the Workspace's mod `id`. */
export function modDir(workspace: Pick<Workspace, "root">, id: string): string {
  return path.join(workspace.root, MODS_DIR, id);
}

/** The mod package beside a Mod Blueprint: the one `.SC2Mod` folder there. */
export async function modPackage(blueprintPath: string): Promise<string> {
  const dir = path.dirname(blueprintPath);
  const packages = await modPackageFolders(dir);
  if (packages.length === 0) throw new Error(`${dir} holds no mod package (a ${MOD_PACKAGE_EXTENSION} folder): import one with import-mod`);
  if (packages.length > 1) throw new Error(`${dir} holds ${packages.length} mod packages (${packages.join(", ")}): a mod has one; move the others out`);
  return path.join(dir, packages[0]!);
}

/** Reads and validates a Mod Blueprint. */
export async function readModBlueprint(blueprintPath: string): Promise<ModBlueprint> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(blueprintPath, "utf8"));
  } catch (error) {
    throw new Error(`Can't read the Mod Blueprint ${blueprintPath}: ${(error as Error).message}`, { cause: error });
  }
  const parsed = ModBlueprintSchema.safeParse(raw);
  if (!parsed.success) throw new ModBlueprintError(blueprintPath, parsed.error);
  return parsed.data;
}

/**
 * Whether the Blueprint at `file` is a Mod Blueprint or a Mission Blueprint: a Mod Blueprint says
 * which kind of mod it is (`kind`), and a Mission Blueprint has no `kind`. One that doesn't validate
 * still counts by that, so its own reader names what's wrong with it; a file that isn't JSON is
 * refused, naming it.
 */
export async function blueprintKind(file: string): Promise<"mod" | "mission"> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Can't read the Blueprint ${file}: ${(error as Error).message}`, { cause: error });
  }
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) && "kind" in raw ? "mod" : "mission";
}

/** A Mod Blueprint that doesn't validate, with each issue's path, for the Workspace check. */
export class ModBlueprintError extends Error {
  readonly blueprintPath: string;
  readonly zodError: z.ZodError;
  // Fields assigned by hand, not as parameter properties: the plugin SDK's types reach this file, and Plugins load as erasable TypeScript.
  constructor(blueprintPath: string, zodError: z.ZodError) {
    super(`Invalid Mod Blueprint ${blueprintPath}: ${formatIssues(zodError, "(blueprint)")}`);
    this.blueprintPath = blueprintPath;
    this.zodError = zodError;
  }
}

/** The Workspace's mod `id`, read from its folder; refused when it's missing or its Blueprint isn't valid. */
export async function readWorkspaceMod(workspace: Pick<Workspace, "root">, id: string): Promise<WorkspaceMod> {
  return (await readWorkspaceModWithBlueprint(workspace, id)).mod;
}

/** As readWorkspaceMod, with the Blueprint it read, for a caller that needs both from one read. */
export async function readWorkspaceModWithBlueprint(workspace: Pick<Workspace, "root">, id: string): Promise<{ readonly mod: WorkspaceMod; readonly blueprint: ModBlueprint }> {
  const blueprintPath = path.join(modDir(workspace, id), BLUEPRINT_FILE);
  if (!existsSync(blueprintPath)) throw new Error(`The Workspace config names the mod ${id}, but ${path.dirname(blueprintPath)} isn't there (or has no ${BLUEPRINT_FILE})`);
  const blueprint = await readModBlueprint(blueprintPath);
  if (blueprint.id !== id) throw new Error(`The Mod Blueprint ${blueprintPath} has the id ${blueprint.id}, not its folder's ${id}`);
  const pkg = await modPackage(blueprintPath);
  return { mod: { id, kind: blueprint.kind, name: modPackageName(path.basename(pkg)), blueprintPath, modPackage: pkg, dependencies: blueprint.dependencies }, blueprint };
}

/**
 * The Campaign Mod: the Workspace mod its config or its Campaign Pack names (campaignModName).
 * Undefined when neither names one, or the Workspace has no mod of that name (it hasn't been imported yet). Mods that
 * can't be read are skipped; the Workspace check reports them.
 */
export async function campaignMod(workspace: Pick<Workspace, "root" | "mods" | "campaignMod" | "registry">): Promise<WorkspaceMod | undefined> {
  const name = campaignModName(workspace);
  if (!name) return undefined;
  for (const id of workspace.mods) {
    let mod: WorkspaceMod;
    try {
      mod = await readWorkspaceMod(workspace, id);
    } catch {
      continue;
    }
    if (sameModName(mod.name, name)) return mod;
  }
  return undefined;
}

/**
 * The Campaign Mod's Blueprint, for what Mission compiles read from it (its characters, its
 * library): found by its package's name, as campaignMod finds it, but keeping why it can't be
 * read. `shown` is its path in the Workspace. Read once per call: a call is a Mission compile or
 * check, and the Blueprint may change between them (an import, a pull).
 */
export type CampaignModBlueprint =
  /** Neither the Workspace config nor its Campaign Pack names a Campaign Mod (campaignModName). */
  | { readonly found: "none" }
  /** The Workspace hasn't imported it. */
  | { readonly found: "missing"; readonly name: string }
  | { readonly found: "unreadable"; readonly name: string; readonly shown: string; readonly reason: string }
  | { readonly found: "yes"; readonly name: string; readonly shown: string; readonly blueprint: ModBlueprint };

export async function campaignModBlueprint(workspace: Workspace): Promise<CampaignModBlueprint> {
  const name = campaignModName(workspace);
  if (!name) return { found: "none" };
  for (const id of workspace.mods) {
    const blueprintPath = path.join(modDir(workspace, id), BLUEPRINT_FILE);
    const shown = `mods/${id}/${BLUEPRINT_FILE}`;
    let pkg: string;
    try {
      pkg = await modPackage(blueprintPath);
    } catch {
      continue;
    }
    if (!sameModName(modPackageName(path.basename(pkg)), name)) continue;
    try {
      return { found: "yes", name, shown, blueprint: await readModBlueprint(blueprintPath) };
    } catch (error) {
      return { found: "unreadable", name, shown, reason: error instanceof Error ? error.message : String(error) };
    }
  }
  return { found: "missing", name };
}

/** The mod names a package's dependencies give as files (`file:Mods\<Name>.SC2Mod`), without `.SC2Mod`. */
export function fileDependencyNames(dependencies: readonly string[]): string[] {
  return fileDependencyPaths(dependencies).map((file) => modPackageName(file.split("/").pop()!));
}

/** The mod packages a package's dependencies give as files, by their paths under the game's data (`Mods/missionpacks/campaigncommon.sc2mod`), with forward slashes. */
export function fileDependencyPaths(dependencies: readonly string[]): string[] {
  return dependencies.flatMap((dependency) =>
    dependency
      .split(",")
      .filter((part) => part.startsWith("file:"))
      .map((part) => part.slice("file:".length).replace(/\\/g, "/"))
      .filter((file) => isModPackageName(file.split("/").pop()!)),
  );
}

/**
 * The Workspace's mod packages the game loads under its Campaign Mod, in load order: each Workspace
 * mod the Campaign Mod depends on (and theirs, dependencies first), then the Campaign Mod. A model or
 * texture is read from the last of them that holds it, else from the game (findPackageFile). Empty
 * without a Campaign Mod; a dependency the Workspace doesn't hold is the game's or Battle.net's.
 */
export async function campaignModPackages(workspace: Pick<Workspace, "root" | "mods" | "campaignMod" | "registry">): Promise<string[]> {
  const top = await campaignMod(workspace);
  return top ? modPackagesUnder(workspace, top) : [];
}

/** The Workspace's mod packages the game loads under the mod `top`, in load order, as campaignModPackages gives them for the Campaign Mod. */
export async function modPackagesUnder(workspace: Pick<Workspace, "root" | "mods">, top: WorkspaceMod): Promise<string[]> {
  return loadOrder(await modsByName(workspace), [top]).map((mod) => mod.modPackage);
}

/**
 * The Workspace's mod packages a map with the dependencies `dependencies` loads, in load order:
 * each Workspace mod a `file:` dependency names, after the Workspace mods it depends on. Empty when
 * it names none; a dependency the Workspace doesn't hold is the game's or Battle.net's.
 */
export async function mapModPackages(workspace: Pick<Workspace, "root" | "mods">, dependencies: readonly string[]): Promise<string[]> {
  return (await dependencyMods(workspace, dependencies)).map((mod) => mod.modPackage);
}

/**
 * The Workspace's mods a package with the dependencies `dependencies` loads (a map's, or a mod's),
 * in load order, as mapModPackages gives their packages.
 */
export async function dependencyMods(workspace: Pick<Workspace, "root" | "mods">, dependencies: readonly string[]): Promise<WorkspaceMod[]> {
  const byName = await modsByName(workspace);
  return loadOrder(byName, fileDependencyNames(dependencies).flatMap((name) => byName.get(name.toLowerCase()) ?? []));
}

/** The Workspace's readable mods by their lower-case name. */
async function modsByName(workspace: Pick<Workspace, "root" | "mods">): Promise<Map<string, WorkspaceMod>> {
  const byName = new Map<string, WorkspaceMod>();
  for (const id of workspace.mods) {
    try {
      const mod = await readWorkspaceMod(workspace, id);
      byName.set(mod.name.toLowerCase(), mod);
    } catch {
      // Unreadable mods are skipped, as campaignMod skips them; the Workspace check reports them.
    }
  }
  return byName;
}

/** `tops` and the Workspace mods they depend on, dependencies first, each once. */
function loadOrder(byName: ReadonlyMap<string, WorkspaceMod>, tops: readonly WorkspaceMod[]): WorkspaceMod[] {
  const order: WorkspaceMod[] = [];
  const seen = new Set<string>();
  const visit = (mod: WorkspaceMod): void => {
    if (seen.has(mod.name.toLowerCase())) return;
    seen.add(mod.name.toLowerCase());
    for (const name of fileDependencyNames(mod.dependencies)) {
      const dependency = byName.get(name.toLowerCase());
      if (dependency) visit(dependency);
    }
    order.push(mod);
  };
  for (const top of tops) visit(top);
  return order;
}
