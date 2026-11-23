// Where a Plugin source a Workspace config names is found: a bundled Plugin package beside core,
// or a local folder. Kept apart from the registry, importing nothing of core's catalogs or
// schemas, so the Claude Code plugin's SessionStart hook can find the Workspace's Plugins fast.

import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { mainWorkingTree } from "../util/main-checkout.js";
import type { PluginRole } from "./plugin-api.js";

/** The manifest file at a Plugin folder's root. */
export const MANIFEST_FILE = "sc2-adjutant-plugin.json";

/** The Workspace config file at a Workspace's root. */
export const WORKSPACE_FILE = "sc2-adjutant.workspace.json";

/**
 * First-party Plugins that ship as packages beside core in the sc2-adjutant workspace, also named
 * `bundled:<name>`: found where core can resolve the package, and loaded from its folder as a
 * local folder Plugin is.
 */
export const BUNDLED_PACKAGES: Readonly<Record<string, string>> = {
  "host-macos": "@team-antioch/sc2-adjutant-host-macos",
  "host-windows": "@team-antioch/sc2-adjutant-host-windows",
  "style-antioch": "@team-antioch/sc2-adjutant-style-antioch",
};

/** A `bundled:<name>` Plugin whose package isn't installed where core can resolve it. */
export class MissingPluginPackageError extends Error {
  override readonly name = "MissingPluginPackageError";
}

/** The folder of a first-party Plugin package, as core resolves it (its real path, as for a local folder Plugin). */
export function bundledPackageFolder(source: string, packageName: string): string {
  try {
    return path.dirname(createRequire(import.meta.url).resolve(`${packageName}/${MANIFEST_FILE}`));
  } catch (error) {
    const reason = (error as Error).message.split("\n")[0];
    throw new MissingPluginPackageError(`Bundled Plugin ${source} is the package ${packageName}, which core can't find: install it beside sc2-adjutant (${reason})`, { cause: error });
  }
}

/** Why a source that is neither bundled nor a local folder can't be loaded. */
export const unloadableSource = (source: string): string =>
  `Plugin ${source}: only bundled Plugins (bundled:<name>) and local folders (a path starting with ./ or ../, or absolute) can be loaded so far; for a folder in the Workspace, write ./${source}`;

/** A local folder source: `./` or `../` relative to the Workspace root, or absolute. Anything else (`hazard`, `@scope/pkg`) reads as an npm package. */
export function isLocalPluginSource(source: string): boolean {
  return source === "." || source === ".." || /^\.\.?[\\/]/.test(source) || path.isAbsolute(source);
}

/**
 * The folder of a local source: relative to the Workspace root, or absolute. A relative source that
 * isn't there from a linked git worktree is looked for from the main working tree instead, since a
 * worktree can sit anywhere (a `../sibling` that works from the main checkout needn't from it).
 */
export function localPluginFolder(root: string, source: string): string {
  const folder = path.resolve(root, source);
  if (path.isAbsolute(source) || existsSync(folder)) return folder;
  const main = mainWorkingTree(root);
  const fromMain = main && path.resolve(main, source);
  return fromMain && existsSync(fromMain) ? fromMain : folder;
}

/** A Plugin to load: its source as the Workspace config names it, and the role slots it was named in. */
export type PluginRequest = {
  readonly source: string;
  readonly roles?: readonly PluginRole[];
};

/** The Plugin slots of a Workspace config. */
export type PluginSlots = {
  readonly campaignPack?: string | undefined;
  readonly stylePack?: string | undefined;
  readonly utilities?: readonly string[] | undefined;
  readonly plugins?: readonly string[] | undefined;
};

/**
 * The Plugins a Workspace config names, in load order (the Campaign Pack, the Style Pack, the
 * Utilities, then `plugins`). One Plugin can fill several roles: a source named in more than one
 * slot loads once, with each role.
 */
export function pluginRequests(config: PluginSlots): PluginRequest[] {
  const named: { readonly source: string; readonly role?: PluginRole }[] = [
    ...(config.campaignPack ? [{ source: config.campaignPack, role: "campaign-pack" as const }] : []),
    ...(config.stylePack ? [{ source: config.stylePack, role: "style-pack" as const }] : []),
    ...(config.utilities ?? []).map((source) => ({ source, role: "utility" as const })),
    ...(config.plugins ?? []).map((source) => ({ source })),
  ];
  const roles = new Map<string, PluginRole[]>();
  for (const { source, role } of named) {
    const sourceRoles = roles.get(source) ?? [];
    if (role) sourceRoles.push(role);
    roles.set(source, sourceRoles);
  }
  return [...roles].map(([source, sourceRoles]) => ({ source, roles: sourceRoles }));
}
