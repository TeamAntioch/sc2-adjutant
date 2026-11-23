// The machine config: each author's own settings for the machine they work on, never committed
// with a Workspace. It holds the StarCraft II and Editor paths, the cache folder, the Exemplar
// Maps' source-map folder and the Host Adapter Plugin. Each setting can be overridden by an environment variable, for CI and other
// unusual setups. No machine path is built into core or a Host Adapter: it comes from here.

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import type { HostContext, MachinePathSetting, MachineSettings } from "../plugins/plugin-api.js";

/** The environment variable that overrides each machine setting, and the one naming the config file. */
export const MACHINE_ENV = {
  config: "SC2_ADJUTANT_MACHINE_CONFIG",
  sc2Path: "SC2_ADJUTANT_SC2_PATH",
  editorPath: "SC2_ADJUTANT_EDITOR_PATH",
  cacheDir: "SC2_ADJUTANT_CACHE_DIR",
  modelViewerPath: "SC2_ADJUTANT_MODEL_VIEWER_PATH",
  exemplarMaps: "SC2_ADJUTANT_EXEMPLAR_MAPS",
  hostAdapter: "SC2_ADJUTANT_HOST_ADAPTER",
} as const;

const MachineConfigSchema = z
  .object({
    sc2Path: z.string().min(1).optional(),
    editorPath: z.string().min(1).optional(),
    cacheDir: z.string().min(1).optional(),
    modelViewerPath: z.string().min(1).optional(),
    /** The folder holding the source maps of the Style Pack's Exemplar Maps, for `npm run study` and the capture tools. */
    exemplarMaps: z.string().min(1).optional(),
    /** The Host Adapter Plugin: `bundled:<name>` or a local folder relative to this file. None loads when it's unset or `none`. */
    hostAdapter: z.string().min(1).optional(),
  })
  .strict();

export type MachineConfig = MachineSettings & {
  /** The config file the settings were read from, or would be read from when it doesn't exist. */
  readonly file: string;
  /** The Host Adapter Plugin's source, if the config or the environment names one. */
  readonly hostAdapter?: string;
  /** The folder a local Host Adapter source is relative to: the config file's, or the current folder's when it comes from the environment. */
  readonly hostAdapterRoot: string;
};

type Env = Readonly<Record<string, string | undefined>>;

export type LoadMachineConfigOptions = {
  /** The config file; by default $SC2_ADJUTANT_MACHINE_CONFIG, else `machine.json` in the user's sc2-adjutant config folder. */
  readonly file?: string;
  readonly env?: Env;
  readonly platform?: NodeJS.Platform;
};

/** `sc2-adjutant/machine.json` in the user's config folder: %APPDATA% on Windows, else $XDG_CONFIG_HOME or ~/.config. */
export function defaultMachineConfigFile(env: Env = process.env, platform: NodeJS.Platform = process.platform): string {
  const folder = platform === "win32" && env.APPDATA ? env.APPDATA : env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(folder, "sc2-adjutant", "machine.json");
}

/**
 * Reads the machine config and applies the environment's overrides. A missing file at the default
 * location is an empty config; a file named explicitly must exist. Paths may start with `~/`, and
 * relative paths are relative to the config file's folder.
 */
export async function loadMachineConfig({ file, env = process.env, platform = process.platform }: LoadMachineConfigOptions = {}): Promise<MachineConfig> {
  const named = file ?? (env[MACHINE_ENV.config] || undefined);
  const configFile = path.resolve(named ?? defaultMachineConfigFile(env, platform));
  const folder = path.dirname(configFile);

  let raw: unknown = {};
  try {
    raw = JSON.parse(await readFile(configFile, "utf8"));
  } catch (error) {
    if (named || (error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Can't read the machine config ${configFile}: ${(error as Error).message}`, { cause: error });
    }
  }
  const parsed = MachineConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(config)"}: ${issue.message}`);
    throw new Error(`Invalid machine config ${configFile}: ${issues.join("; ")}`);
  }
  const config = parsed.data;

  const setting = (key: MachinePathSetting): string | undefined => {
    const fromEnv = env[MACHINE_ENV[key]];
    if (fromEnv) return expandPath(fromEnv, process.cwd());
    const fromFile = config[key];
    return fromFile === undefined ? undefined : expandPath(fromFile, folder);
  };
  const adapterFromEnv = env[MACHINE_ENV.hostAdapter] || undefined;
  // A Host Adapter loads only when it's named, on every platform: core never picks one for the platform.
  const namedAdapter = adapterFromEnv ?? config.hostAdapter;
  const hostAdapter = namedAdapter === NO_HOST_ADAPTER ? undefined : namedAdapter;
  return {
    file: configFile,
    ...machineSettings(Object.fromEntries(PATH_SETTINGS.map((key) => [key, setting(key)]))),
    ...(hostAdapter ? { hostAdapter: hostAdapter.startsWith("~/") ? expandPath(hostAdapter, folder) : hostAdapter } : {}),
    hostAdapterRoot: adapterFromEnv ? process.cwd() : folder,
  };
}

/** No settings at all: core alone, with no Host Adapter. */
export function emptyMachineConfig(file = defaultMachineConfigFile()): MachineConfig {
  return { file, hostAdapterRoot: process.cwd() };
}

/** The `hostAdapter` value for no Host Adapter, the same as leaving it unset. */
export const NO_HOST_ADAPTER = "none";

const PATH_SETTINGS: readonly MachinePathSetting[] = ["sc2Path", "editorPath", "cacheDir", "modelViewerPath", "exemplarMaps"];

/** The machine path settings that are set, from anything that has them: the one place they are listed. */
function machineSettings(source: { readonly [Key in MachinePathSetting]?: string | undefined }): MachineSettings {
  return Object.fromEntries(PATH_SETTINGS.flatMap((key) => (source[key] ? [[key, source[key]]] : []))) as MachineSettings;
}

/** The context each Host Adapter capability receives. */
export function hostContext(machine: MachineConfig): HostContext {
  const settings = machineSettings(machine);
  return {
    machine: settings,
    requirePath(setting) {
      const value = settings[setting];
      if (!value) throw new Error(`No ${setting} is set: add "${setting}" to the machine config ${machine.file}, or set ${MACHINE_ENV[setting]}`);
      return value;
    },
  };
}

function expandPath(value: string, relativeTo: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return path.resolve(relativeTo, value);
}
