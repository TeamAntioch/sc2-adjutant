// The Workspace config: the committed file at a Workspace's root that names its Campaign, where
// its Missions live and the Plugins that fill its roles. Only the Plugins it names are loaded.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import type { Catalog } from "../catalog/catalog-layer.js";
import { type MissionBlueprint, missionBlueprintSchema, slugId } from "../domain/mission-blueprint.js";
import { loadMachineConfig, MACHINE_ENV, type MachineConfig } from "../host/machine-config.js";
import { missionCatalogFor } from "../map/mission-catalog.js";
import { changedCatalog, readCampaignCatalog, withModelAnimsLayer } from "../mods/campaign-catalog.js";
import { MODEL_ANIMS_FILE, readModelAnimsLayer } from "../catalog/model-anims.js";
import { formatIssues } from "../util/format-issues.js";
import { type ExemplarMap, mechanicLabel, type PluginRegistry, runHook } from "./plugin-api.js";
import { pluginRequests, WORKSPACE_FILE } from "./plugin-sources.js";
import { loadPlugins } from "./registry.js";

export { WORKSPACE_FILE };

/** A Plugin source: `bundled:<name>` for one shipped with core, or a local folder (`./path` relative to the Workspace root, or absolute). */
const PluginSourceSchema = z.string().min(1);

const WorkspaceConfigSchema = z
  .object({
    campaign: z
      .object({
        id: slugId,
        name: z.string().min(1),
      })
      .strict(),
    /** The folder of Mission folders, relative to the Workspace root. */
    missions: z.string().min(1).default("missions"),
    campaignPack: PluginSourceSchema.optional(),
    stylePack: PluginSourceSchema.optional(),
    /** The Utilities (ADR-0023): optional tools the Workspace chooses to add, loaded after the packs in this order. */
    utilities: z.array(PluginSourceSchema).default([]),
    /** Further Plugins, such as single Mechanics, loaded after the Utilities in this order. */
    plugins: z.array(PluginSourceSchema).default([]),
    /**
     * The folder holding the source maps of the Style Pack's Exemplar Maps, for `npm run study`,
     * when it travels with the Workspace: relative to the Workspace root. A folder on the author's
     * own machine belongs in the machine config's `exemplarMaps`, which overrides this.
     */
    exemplarMaps: z.string().min(1).optional(),
    /** The Workspace's mods (ADR-0011), by id, each in mods/<id>/ beside its Mod Blueprint; Import adds them. */
    mods: z
      .array(slugId)
      .default([])
      .superRefine((mods, context) => {
        mods.forEach((mod, index) => {
          if (mods.indexOf(mod) < index) context.addIssue({ code: "custom", path: [index], message: `names the mod ${mod} twice` });
        });
      }),
    /**
     * The name of the Campaign's Campaign Mod, its package name without `.SC2Mod`, for a Workspace
     * whose Campaign Pack doesn't name one (or that has no Campaign Pack): a Campaign needs no Plugin
     * to have a mod. When both name one, they name the same.
     */
    campaignMod: z
      .string()
      .regex(/^[^\\/:*?"<>|]+$/, "A Campaign Mod name is a package name, without a folder or .SC2Mod")
      .refine((name) => !/\.sc2mod$/i.test(name), "A Campaign Mod name is without .SC2Mod")
      .optional(),
  })
  .strict();

/** The folder of mod folders, at the Workspace root (ADR-0011). */
export const MODS_DIR = "mods";

export type Workspace = {
  readonly root: string;
  readonly campaign: { readonly id: string; readonly name: string };
  /** Absolute. */
  readonly missionsDir: string;
  /** The mods the config names, by id, in its order; each is in `<root>/mods/<id>/`. */
  readonly mods: readonly string[];
  readonly registry: PluginRegistry;
  /** The name of the Plugin the config names as its `stylePack`, if it names one. */
  readonly stylePack?: string;
  /** As the config names it (not yet resolved), if it does; see `exemplarMapSources`. */
  readonly exemplarMaps?: string;
  /** The name of its Campaign Mod (ADR-0011), as its config or its Campaign Pack names it; see `campaignModName`. */
  readonly campaignMod?: string;
  /**
   * Its Campaign Mod's catalog entries (src/catalog/catalog-layer.ts), read when it loads: what its
   * Mission Blueprints are validated, compiled and checked against.
   */
  readonly catalog: Catalog;
};

/** The name of the Workspace's Campaign Mod: as its config names it, else its Campaign Pack; undefined when neither does. */
export const campaignModName = (workspace: Pick<Workspace, "campaignMod"> & { readonly registry: Pick<Workspace["registry"], "campaignMod"> }): string | undefined => workspace.campaignMod ?? workspace.registry.campaignMod();

/** The Workspace config at `root`, validated; refused, naming the file, where it can't be read or isn't valid. */
async function readWorkspaceConfig(root: string): Promise<z.infer<typeof WorkspaceConfigSchema>> {
  const configPath = path.join(root, WORKSPACE_FILE);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Can't read the Workspace config ${configPath}: ${(error as Error).message}`, { cause: error });
  }
  const parsed = WorkspaceConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid Workspace config ${configPath}: ${formatIssues(parsed.error, "(config)")}`);
  }
  return parsed.data;
}

/** Reads the Workspace config at `root` and loads the Plugins it names. */
export async function loadWorkspace(root: string): Promise<Workspace> {
  const configPath = path.join(root, WORKSPACE_FILE);
  const config = await readWorkspaceConfig(root);
  const requests = pluginRequests(config);
  const registry = await loadPlugins(root, requests);
  const stylePack = registry.plugins.find((plugin) => plugin.source === config.stylePack)?.name;
  const packMod = registry.campaignMod();
  if (config.campaignMod && packMod && config.campaignMod.toLowerCase() !== packMod.toLowerCase()) {
    throw new Error(`Invalid Workspace config ${configPath}: campaignMod: it names the Campaign Mod ${config.campaignMod}, but the Campaign Pack names ${packMod}; name the one mod, or leave campaignMod out`);
  }
  const workspace: Omit<Workspace, "catalog"> = {
    root,
    campaign: config.campaign,
    missionsDir: path.resolve(root, config.missions),
    mods: config.mods,
    registry,
    ...(stylePack ? { stylePack } : {}),
    ...(config.exemplarMaps ? { exemplarMaps: config.exemplarMaps } : {}),
    ...(config.campaignMod ? { campaignMod: config.campaignMod } : {}),
  };
  // Its game models' recorded animations (ADR-0026), under the Campaign Mod's own.
  const anims = await readModelAnimsLayer(path.join(root, MODEL_ANIMS_FILE), MODEL_ANIMS_FILE, "workspace");
  return { ...workspace, catalog: changedCatalog(withModelAnimsLayer(await readCampaignCatalog(workspace), anims), { workspaceRoot: root }) };
}

/** An Exemplar Map of the active Style Pack, with its source map's absolute path. */
export type ExemplarMapSource = ExemplarMap & { readonly source: string };

/**
 * The Style Pack's Exemplar Maps, each with the absolute path of its source map: its `map` inside
 * the folder the machine config's `exemplarMaps` (or `SC2_ADJUTANT_EXEMPLAR_MAPS`) names, else the
 * Workspace config's, which is relative to the Workspace root and suits only a folder that travels
 * with the Workspace. `machine` is read from the machine config file when not given. Refused when
 * the Workspace has no Style Pack, or no folder is set.
 */
export async function exemplarMapSources(
  workspace: Workspace,
  machine?: Pick<MachineConfig, "file" | "exemplarMaps">,
): Promise<ExemplarMapSource[]> {
  const configPath = path.join(workspace.root, WORKSPACE_FILE);
  const pack = workspace.stylePack;
  if (!pack) throw new Error(`The Workspace names no Style Pack (stylePack in ${configPath}), so it has no Exemplar Maps`);
  const exemplars = workspace.registry.contributions("exemplarMaps").filter((exemplar) => exemplar.plugin === pack);
  const root = await exemplarSourceFolder(workspace, machine);
  return exemplars.map((exemplar) => ({ ...exemplar, source: path.resolve(root, exemplar.map) }));
}

/**
 * The folder an Exemplar Map's `map` is found in, as `exemplarMapSources` resolves it: the machine
 * config's `exemplarMaps`, else the Workspace config's. Refused when neither is set.
 */
export async function exemplarSourceFolder(workspace: Pick<Workspace, "root" | "exemplarMaps">, machine?: Pick<MachineConfig, "file" | "exemplarMaps">): Promise<string> {
  const settings = machine ?? (await loadMachineConfig());
  const fromWorkspace = workspace.exemplarMaps && path.resolve(workspace.root, workspace.exemplarMaps.replace(/^~(?=$|[\\/])/, os.homedir()));
  const root = settings.exemplarMaps ?? fromWorkspace;
  if (!root) {
    throw new Error(`No folder for the Exemplar Maps' source maps: set exemplarMaps in the machine config ${settings.file}, or ${MACHINE_ENV.exemplarMaps}, or exemplarMaps in the Workspace config ${path.join(workspace.root, WORKSPACE_FILE)} for a folder that travels with the Workspace`);
  }
  return root;
}

/**
 * Where the active Style Pack keeps the data the exemplar scripts regenerate: the folder of its
 * Exemplar Maps list (each map's study and layer images, and the mixtures, sit there; their frames are in the research archive) and its Doodad Composites
 * file, as its manifest names them. Refused when the Workspace has no Style Pack.
 */
export function stylePackFiles(workspace: Workspace): { readonly exemplarDir?: string; readonly compositesFile?: string } {
  const pack = workspace.stylePack;
  if (!pack) throw new Error(`The Workspace names no Style Pack (stylePack in ${path.join(workspace.root, WORKSPACE_FILE)})`);
  const documents = workspace.registry.contributions("knowledge").filter((document) => document.plugin === pack);
  const list = documents.find((document) => document.id === "exemplar-maps")?.file;
  const composites = documents.find((document) => document.id === "composites")?.file;
  return { ...(list ? { exemplarDir: path.dirname(list) } : {}), ...(composites ? { compositesFile: composites } : {}) };
}

/** The Workspace holding `filePath`: the nearest folder above it with a Workspace config. */
export async function workspaceFor(filePath: string): Promise<Workspace> {
  const root = workspaceRootFor(filePath);
  if (!root) throw new Error(`${path.resolve(filePath)} isn't in a Workspace: no ${WORKSPACE_FILE} in any folder above it`);
  return loadWorkspace(root);
}

/**
 * The Workspace holding `filePath`, as far as its mods: its root and the mods its config names,
 * read without loading its Plugins; undefined when it isn't in a Workspace.
 */
export async function workspaceModsFor(filePath: string): Promise<Pick<Workspace, "root" | "mods"> | undefined> {
  const root = workspaceRootFor(filePath);
  if (!root) return undefined;
  return { root, mods: (await readWorkspaceConfig(root)).mods };
}

/** The nearest folder above `filePath` with a Workspace config, if there is one. */
export function workspaceRootFor(filePath: string): string | undefined {
  for (let dir = path.dirname(path.resolve(filePath)); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, WORKSPACE_FILE))) return dir;
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** Reads a Mission Blueprint and validates it against core and every Plugin its Workspace loads. */
export async function readMissionBlueprint(blueprintPath: string): Promise<{ blueprint: MissionBlueprint; workspace: Workspace }> {
  const workspace = await workspaceFor(blueprintPath);
  return { blueprint: await parseMissionBlueprint(workspace, blueprintPath), workspace };
}

/**
 * Reads a Mission Blueprint and validates it against core and every Plugin `workspace` loads, and
 * against the Mission's catalog: the Workspace's with its own package's Kept game data over it.
 */
export async function parseMissionBlueprint(workspace: Workspace, blueprintPath: string): Promise<MissionBlueprint> {
  const raw = await readRawBlueprint(blueprintPath);
  const result = validateMissionBlueprint(workspace, raw, await missionCatalogFor(workspace.catalog, blueprintPath));
  if (!result.success) throw new Error(`Invalid Mission Blueprint ${blueprintPath}: ${result.issues.map(formatIssue).join("; ")}`);
  return result.blueprint;
}

/** The Blueprint file as stored: parsed as JSON, not validated, before defaults are filled in. */
export async function readRawBlueprint(blueprintPath: string): Promise<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(blueprintPath, "utf8"));
  } catch (error) {
    throw new Error(`Can't read the Mission Blueprint ${blueprintPath}: ${(error as Error).message}`, { cause: error });
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`Invalid Mission Blueprint ${blueprintPath}: (blueprint): not a JSON object`);
  return raw as Record<string, unknown>;
}

/** One reason a Blueprint is invalid: where (a dotted path, such as `mechanics.0.params`) and why. */
export type BlueprintIssue = { readonly path: string; readonly message: string };

/**
 * Validates a raw Blueprint against core and every Plugin `workspace` loads. A Plugin hook that
 * throws is reported as an issue naming its Mechanic, not thrown. When core's checks fail, Plugin
 * Mechanics' params are still checked against their schemas, so their issues show at once rather
 * than only after the core ones are fixed. `catalog` is the one its tileset and units are checked
 * against, and that it is bound to: a Mission's is missionCatalogFor's (its Workspace's with its
 * own package's Kept game data); `workspace.catalog` only for a Blueprint with no package yet.
 */
export function validateMissionBlueprint(
  workspace: Workspace,
  raw: unknown,
  catalog: Catalog,
): { readonly success: true; readonly blueprint: MissionBlueprint } | { readonly success: false; readonly issues: readonly BlueprintIssue[] } {
  let parsed: ReturnType<ReturnType<typeof missionBlueprintSchema>["safeParse"]>;
  // Checked against `catalog`, and compiled against it.
  try {
    parsed = missionBlueprintSchema(workspace.registry, catalog).safeParse(raw);
  } catch (error) {
    return { success: false, issues: [{ path: "(blueprint)", message: error instanceof Error ? error.message : String(error) }] };
  }
  if (parsed.success) return { success: true, blueprint: parsed.data };
  const issues = parsed.error.issues.map((issue) => ({ path: issue.path.join(".") || "(blueprint)", message: issue.message }));
  const reported = new Set(issues.map(formatIssue));
  return { success: false, issues: [...issues, ...pluginParamsIssues(workspace.registry, raw).filter((issue) => !reported.has(formatIssue(issue)))] };
}

/**
 * The issues in a raw Blueprint's Plugin Mechanic params, checked against each Mechanic's params
 * schema alone (its validate hook needs a Blueprint that passed core's checks).
 */
function pluginParamsIssues(plugins: PluginRegistry, raw: unknown): BlueprintIssue[] {
  const mechanics = (raw as { mechanics?: unknown } | null)?.mechanics;
  if (!Array.isArray(mechanics)) return [];
  return mechanics.flatMap((entry: unknown, index): BlueprintIssue[] => {
    const { id, type, params } = (typeof entry === "object" && entry !== null ? entry : {}) as { id?: unknown; type?: unknown; params?: unknown };
    if (typeof type !== "string") return [];
    const mechanic = plugins.mechanic(type);
    if (!mechanic) return [];
    const label = mechanicLabel(plugins, { id: String(id), type }, index);
    try {
      const result = runHook(label, "paramsSchema", () => mechanic.paramsSchema.safeParse(params));
      if (result.success) return [];
      return result.error.issues.map((issue) => ({ path: ["mechanics", index, "params", ...issue.path].join("."), message: issue.message }));
    } catch (error) {
      return [{ path: `mechanics.${index}`, message: (error as Error).message }];
    }
  });
}

export const formatIssue = (issue: BlueprintIssue): string => `${issue.path}: ${issue.message}`;

/** Each Mission folder holds its Blueprint in this file. */
export const BLUEPRINT_FILE = "blueprint.json";

/** The Blueprint of the Mission whose folder in the Workspace's missions folder is named `mission`. */
export async function missionBlueprintPath(workspace: Workspace, mission: string): Promise<string> {
  const isFolderName = mission !== "." && mission !== ".." && !/[/\\]/.test(mission);
  const blueprintPath = path.join(workspace.missionsDir, mission, BLUEPRINT_FILE);
  if (isFolderName && existsSync(blueprintPath)) return blueprintPath;
  const missions = await missionIds(workspace);
  throw new Error(`No Mission ${mission} in the Workspace's missions folder ${workspace.missionsDir} (its Missions: ${missions.join(", ") || "none"})`);
}

/** The folders in the Workspace's missions folder that hold a Blueprint, by name. */
export async function missionIds(workspace: Workspace): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(workspace.missionsDir);
  } catch (error) {
    throw new Error(`Can't read the Workspace's missions folder ${workspace.missionsDir}: ${(error as Error).message}`, { cause: error });
  }
  return names.filter((name) => existsSync(path.join(workspace.missionsDir, name, BLUEPRINT_FILE))).sort();
}
