// `sc2-adjutant init <folder>` (#849): a new Workspace from the example Campaign, with core and this
// platform's Host Adapter installed, so `/sc2-adjutant:co-design` works in it straight away. It
// copies core's examples/example-campaign, writes the Workspace's package.json and .gitignore, runs
// `npm install`, copies the Workspace's Plugins' skills (ADR-0023) with the core it just installed,
// and names this platform's Host Adapter in the machine config when there is no machine config yet.
//
// It runs from wherever core is: an npx cache, a global install or a checkout. So everything it
// copies comes from core's own package folder, and the skill copy is made by the Workspace's own
// core, whose Plugin folders the copies name.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { defaultMachineConfigFile, MACHINE_ENV } from "../host/machine-config.js";
import { BUNDLED_PACKAGES, WORKSPACE_FILE } from "../plugins/plugin-sources.js";
import type { SkillCopyReport } from "../plugins/plugin-skills.js";

/** Core's package name, as a Workspace depends on it. */
export const CORE_PACKAGE = "@team-antioch/sc2-adjutant";

/** Core's package folder: two above this file, in `dist/init/` or `src/init/`. */
export const CORE_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The example Workspace a new one is copied from. */
export const EXAMPLE_WORKSPACE = path.join(CORE_FOLDER, "examples", "example-campaign");

/**
 * The new Workspace's .gitignore. npm leaves every .gitignore out of a package, so the example's
 * own never reaches an npm install; and the example's keeps Map Packages out, where a Workspace
 * commits each Mission's package and its compile record (ADR-0010).
 */
export const WORKSPACE_GITIGNORE = [
  "node_modules/",
  "",
  "# What `npm run tts` records about the voice files it wrote; regenerated with them.",
  "missions/*/audio/manifest.json",
  "",
  "# Throwaway compiles and Editor demos. Each Mission's own Map Package and its compile-record.json",
  "# are committed beside its Blueprint.",
  "missions/*/output/",
  "",
].join("\n");

/** What the example holds that a new Workspace doesn't get: its own .gitignore, and what trying it out wrote. */
const LEFT_OUT = [/^\.gitignore$/, /^missions\/[^/]+\/output(\/|$)/, /^missions\/[^/]+\/[^/]+\.SC2Map(\/|$)/, /^missions\/[^/]+\/compile-record\.json$/, /^missions\/[^/]+\/audio\/manifest\.json$/];

/** The core CLIs a Workspace runs, as its package.json's scripts: `npm run <name> -- …` from the Workspace's folder. */
export const WORKSPACE_SCRIPTS: Readonly<Record<string, string>> = {
  check: "check-workspace",
  "compile-map": "compile-map",
  "compile-mod": "compile-mod",
  "compile-cutscene": "compile-cutscene",
  "check-layout": "check-layout",
  "generate-terrain": "generate-terrain",
  preview: "preview",
  sync: "sync",
  tts: "tts-placeholders",
  "pull-screenplay": "pull-screenplay",
  "edit-screenplay": "edit-screenplay",
  "refresh-screenplay": "refresh-screenplay",
  "import-map": "import-map",
  "import-mod": "import-mod",
  "model-anims": "record-model-anims",
};

/** The Host Adapter for a platform, as `bundled:<name>`: none on Linux, which has no Editor. */
export function platformHostAdapter(platform: NodeJS.Platform): string | undefined {
  if (platform === "darwin") return "bundled:host-macos";
  if (platform === "win32") return "bundled:host-windows";
  return undefined;
}

/** A Workspace's package name, from its folder's: lowercase, with a hyphen for each run of anything npm's names can't hold. */
export function workspacePackageName(folder: string): string {
  const name = path
    .basename(path.resolve(folder))
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[-]+$/g, "");
  return name || "sc2-adjutant-workspace";
}

/** The new Workspace's package.json: core and the Host Adapter package at core's version, and core's CLIs as scripts. */
export function workspacePackageJson(name: string, coreVersion: string, hostAdapter: string | undefined): Record<string, unknown> {
  const range = `^${coreVersion}`;
  const adapterPackage = hostAdapter ? BUNDLED_PACKAGES[hostAdapter.slice("bundled:".length)] : undefined;
  const cli = (file: string) => `node node_modules/${CORE_PACKAGE}/dist/cli/${file}.js`;
  return {
    name,
    private: true,
    description: "A StarCraft II campaign: an sc2-adjutant Workspace.",
    type: "module",
    scripts: {
      ...Object.fromEntries(Object.entries(WORKSPACE_SCRIPTS).map(([script, file]) => [script, cli(file)])),
      mcp: `node node_modules/${CORE_PACKAGE}/dist/mcp/main.js .`,
    },
    engines: { node: ">=22.18" },
    dependencies: {
      [CORE_PACKAGE]: range,
      ...(adapterPackage ? { [adapterPackage]: range } : {}),
    },
  };
}

/** What happened to the machine config. */
export type MachineConfigResult =
  /** It didn't exist, and init wrote it naming `hostAdapter`. */
  | { readonly kind: "written"; readonly file: string; readonly hostAdapter: string }
  /** It exists, and is left as it is; `hostAdapter` is what it names, if anything. */
  | { readonly kind: "existing"; readonly file: string; readonly hostAdapter?: string; readonly unreadable?: string }
  /** This platform has no Host Adapter, so nothing was written. */
  | { readonly kind: "no-host"; readonly file: string; readonly platform: NodeJS.Platform };

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Names this platform's Host Adapter in the machine config, $SC2_ADJUTANT_MACHINE_CONFIG or the
 * default file, when that file doesn't exist. An existing machine config is never changed: what it
 * names is reported instead.
 */
export async function writeMachineConfig(env: Env, platform: NodeJS.Platform): Promise<MachineConfigResult> {
  const file = path.resolve(env[MACHINE_ENV.config] || defaultMachineConfigFile(env, platform));
  if (existsSync(file)) {
    try {
      const config = JSON.parse(await readFile(file, "utf8")) as { hostAdapter?: unknown };
      return { kind: "existing", file, ...(typeof config.hostAdapter === "string" ? { hostAdapter: config.hostAdapter } : {}) };
    } catch (error) {
      return { kind: "existing", file, unreadable: (error as Error).message };
    }
  }
  const hostAdapter = platformHostAdapter(platform);
  if (!hostAdapter) return { kind: "no-host", file, platform };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ hostAdapter }, null, 2)}\n`);
  return { kind: "written", file, hostAdapter };
}

/** Runs `npm install` in a folder, or rejects with why it failed. */
export function npmInstall(folder: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // npm is npm.cmd on Windows, which Node runs only through a shell.
    const child = spawn("npm", ["install"], { cwd: folder, stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", reject);
    child.on("exit", (code, signal) => (code === 0 ? resolve() : reject(new Error(`npm install ${signal ? `was stopped by ${signal}` : `exited with ${code}`}`))));
  });
}

/**
 * Copies the Workspace's Plugins' skills with the core installed in it, so each copy names a Plugin
 * folder in the Workspace's own node_modules, not in wherever init ran from. Undefined when the
 * Workspace has no core installed yet.
 */
export async function copySkillsWithInstalledCore(root: string): Promise<{ report: SkillCopyReport; lines: string[] } | undefined> {
  let folder: string;
  try {
    folder = path.dirname(createRequire(path.join(root, "package.json")).resolve(`${CORE_PACKAGE}/package.json`));
  } catch {
    return undefined;
  }
  const skills = (await import(pathToFileURL(path.join(folder, "dist", "plugins", "plugin-skills.js")).href)) as typeof import("../plugins/plugin-skills.js");
  const report = await skills.copyWorkspaceSkills(root);
  return { report, lines: skills.formatSkillCopy(report) };
}

export type InitOptions = {
  /** The new Workspace's folder; made if it doesn't exist. */
  readonly folder: string;
  /** Leave `npm install` (and so the skill copy) for later. */
  readonly install?: boolean;
  /** Runs `npm install` in the folder; `npmInstall` by default. */
  readonly runInstall?: (folder: string) => Promise<void>;
  readonly env?: Env;
  readonly platform?: NodeJS.Platform;
  /** The example to copy; core's by default. */
  readonly example?: string;
  /** Core's version, which the Workspace depends on; core's package.json's by default. */
  readonly coreVersion?: string;
};

export type InitResult = {
  readonly root: string;
  readonly hostAdapter?: string;
  readonly installed: boolean;
  readonly skills?: readonly string[];
  readonly skillsNote?: string;
  readonly machineConfig: MachineConfigResult;
};

/** Why init won't use a folder, before it writes anything: undefined when it can. */
export async function refusal(root: string, example: string): Promise<string | undefined> {
  if (!existsSync(root)) return undefined;
  if (!(await stat(root)).isDirectory()) return `${root} is a file, not a folder`;
  if (existsSync(path.join(root, WORKSPACE_FILE))) return `${root} already has a Workspace config (${WORKSPACE_FILE}); init starts a new Workspace and never changes one`;
  const clashes = [...(await examplePaths(example)), ".gitignore", "package.json"].filter((file) => existsSync(path.join(root, file)));
  if (clashes.length) return `${root} already has ${clashes.join(", ")}, which init would overwrite: start the Workspace in an empty folder`;
  return undefined;
}

/** The example's top-level entries a new Workspace gets. */
async function examplePaths(example: string): Promise<string[]> {
  return (await readdir(example)).filter((entry) => !LEFT_OUT.some((pattern) => pattern.test(entry)));
}

const leftOut = (example: string) => (source: string) => {
  const relative = path.relative(example, source).split(path.sep).join("/");
  return relative === "" || !LEFT_OUT.some((pattern) => pattern.test(relative));
};

/** Makes a Workspace in `folder`: see the file's header. Throws, having written nothing, when `refusal` refuses the folder. */
export async function initWorkspace({ folder, install = true, runInstall = npmInstall, env = process.env, platform = process.platform, example = EXAMPLE_WORKSPACE, coreVersion }: InitOptions): Promise<InitResult> {
  const root = path.resolve(folder);
  const refused = await refusal(root, example);
  if (refused) throw new InitRefusedError(refused);
  const version = coreVersion ?? (JSON.parse(await readFile(path.join(CORE_FOLDER, "package.json"), "utf8")) as { version: string }).version;
  const hostAdapter = platformHostAdapter(platform);

  await mkdir(root, { recursive: true });
  await cp(example, root, { recursive: true, filter: leftOut(example), force: false });
  await writeFile(path.join(root, ".gitignore"), WORKSPACE_GITIGNORE);
  await writeFile(path.join(root, "package.json"), `${JSON.stringify(workspacePackageJson(workspacePackageName(root), version, hostAdapter), null, 2)}\n`);

  const machineConfig = await writeMachineConfig(env, platform);
  if (!install) return { root, ...(hostAdapter ? { hostAdapter } : {}), installed: false, machineConfig, skillsNote: "not copied: npm install wasn't run" };

  try {
    await runInstall(root);
  } catch (error) {
    throw new Error(`Made the Workspace in ${root}, but ${(error as Error).message}: run npm install there once that's fixed`, { cause: error });
  }
  const skills = await copySkillsWithInstalledCore(root).catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
  const skillsResult = !skills
    ? { skillsNote: `not copied: ${CORE_PACKAGE} isn't installed in the Workspace` }
    : "error" in skills
      ? { skillsNote: `not copied: ${skills.error}` }
      : { skills: skills.lines };
  return { root, ...(hostAdapter ? { hostAdapter } : {}), installed: true, machineConfig, ...skillsResult };
}

/** A folder init won't use. */
export class InitRefusedError extends Error {
  override readonly name = "InitRefusedError";
}

/** What init did, and what to do next, as lines to print. */
export function formatInit(result: InitResult, typedFolder: string): string[] {
  const lines = [`Made a Workspace in ${result.root} from the example Campaign.`];
  if (result.installed) lines.push(`Installed ${CORE_PACKAGE}${result.hostAdapter ? ` and the ${result.hostAdapter} Host Adapter` : ""}.`);
  else lines.push(`Run npm install in ${result.root} to install ${CORE_PACKAGE}${result.hostAdapter ? ` and the ${result.hostAdapter} Host Adapter` : ""}.`);
  const config = result.machineConfig;
  if (config.kind === "written") lines.push(`Wrote the machine config ${config.file}, naming the Host Adapter ${config.hostAdapter}.`);
  else if (config.kind === "existing") {
    if (config.unreadable) lines.push(`Left the machine config ${config.file} as it is, but can't read it: ${config.unreadable}`);
    else if (config.hostAdapter) lines.push(`Left the machine config ${config.file} as it is: it names the Host Adapter ${config.hostAdapter}.`);
    else {
      const hint = result.hostAdapter ? ` Add "hostAdapter": "${result.hostAdapter}" to it for the tools that need one.` : "";
      lines.push(`Left the machine config ${config.file} as it is: it names no Host Adapter, so the tools that need one (placeholder voices, playing a Mission in the game, in-game captures) aren't available.${hint}`);
    }
  } else lines.push(`No Host Adapter runs on ${config.platform}, so the tools that need one (placeholder voices, playing a Mission in the game, in-game captures) aren't available here. Compiling and checking work.`);
  if (result.skills?.length) lines.push(...result.skills.map((line) => `${line}.`));
  else if (result.skillsNote) lines.push(`The Plugins' skills were ${result.skillsNote}; the first Claude Code session in the Workspace copies them.`);
  lines.push("", "Next:", `  cd ${/\s/.test(typedFolder) ? JSON.stringify(typedFolder) : typedFolder}`, "  claude", "  /sc2-adjutant:co-design ashfall-relay");
  return lines;
}
