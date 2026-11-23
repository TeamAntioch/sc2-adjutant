// open_doodad_finder (ADR-0020, #666): core's MCP server loads this file beside it (core's
// src/mcp/open-doodad-finder.ts) and serves the tool only when that works. It checks what the
// Finder needs, then reuses a Finder already answering for the Workspace or starts one detached,
// so it outlives the Claude session, and opens its page.
//
// A Finder is told apart by its /status (server.ts), which says it is the Doodad Finder, for which
// Workspace, with its pid. The pid file alone can't tell a Finder still starting from a dead one
// whose pid was reused, nor see a Finder the author started by hand; a port that answers can't
// tell this Workspace's Finder from another's. So both: the pid file names the port to ask, and
// /status says whose it is.
//
// The pid file, finder.json, and the Finder's log, finder.log, go in the Workspace's
// output/doodad-finder/, else the cache folder's doodad-finder/process/: a folder that ignores itself
// either way. The cache folder doesn't depend on SC2_RESEARCH_DIR, so a Finder started with no
// Workspace is found again by any session with the same cache folder (SC2_ASSET_CATALOG_CACHE). The prerequisites are checked before a start; a reuse only opens the page.

import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { researchArchiveDirIfSet } from "@team-antioch/sc2-adjutant/dist/capture/research-archive.js";
import { catalogCacheDir } from "@team-antioch/sc2-asset-catalog/catalog/catalog-dirs.js";
import { allDoodadEntries, lookUpDoodads } from "@team-antioch/sc2-asset-catalog/catalog/doodad-search.js";
import type { FinderCheck, FinderRankers, FinderWindow, OpenDoodadFinderRequest, OpenDoodadFinderTool, OpenedDoodadFinder } from "@team-antioch/sc2-adjutant/dist/mcp/open-doodad-finder.js";
import { WORKSPACE_FILE } from "@team-antioch/sc2-adjutant/dist/plugins/workspace.js";

import { FINDER_MODEL, modelCacheDir } from "@team-antioch/sc2-doodad-finder/embedder.js";
import { FINDER_PORT } from "@team-antioch/sc2-doodad-finder/server.js";
import type { KeySource } from "@team-antioch/sc2-doodad-finder/credentials.js";

/** What a Finder says at /status. */
export type FinderStatus = { readonly finder: "doodad-finder"; readonly workspace: string | null; readonly pid: number; readonly url: string; readonly rankers: FinderRankers };

/** A process to start detached, its output to `logFile`. */
export type Launch = { readonly command: string; readonly args: readonly string[]; readonly cwd: string; readonly env: Readonly<Record<string, string | undefined>>; readonly logFile: string };

export type OpenDoodadFinderOptions = {
  /** Starts a process detached and gives its pid. */
  readonly launch?: (launch: Launch) => Promise<number>;
  /** Asks a port's /status: the Finder's answer, "other" when something else answers, undefined when nothing does. */
  readonly probe?: (port: number) => Promise<FinderStatus | "other" | undefined>;
  readonly processes?: { alive(pid: number): boolean; stop(pid: number): void };
  /** The preferred port when it is free, else another free one. */
  readonly freePort?: (preferred: number) => Promise<number>;
  /** Opens the page and says where: app falls back to browser without Chrome. */
  readonly openPage?: (url: string, window: "browser" | "app") => Promise<"browser" | "app">;
  readonly checks?: Partial<Checks>;
  /** The cache folder, for the pid file and log of a Finder with no Workspace. */
  readonly cacheDir?: string;
  readonly pollMs?: number;
  /** How long a start may take to answer: a first start downloads the model and embeds every card. */
  readonly timeoutMs?: number;
};

/** What the prerequisites are read from. */
export type Checks = {
  /** Whether core's dist is older than its src. Its dist is there: this file runs from it. An installed core has no src, so is never stale. */
  coreBuild(): { readonly stale: boolean };
  modelCached(): boolean;
  /** Whether the ranker has its credential. Never the credential itself. */
  /** Whether the Finder will have Jev's key, and where from; never the key. */
  credentials(): Promise<{ readonly jev: true; readonly source: KeySource } | { readonly jev: false; readonly off?: string }>;
  /** Catalog entries with neither a sheet nor a gallery picture here, and how many of those have their renders. */
  pictures(workspaceRoot: string | undefined): Promise<{ readonly missing: number; readonly withRenders: number }>;
};

const PACKAGE = fileURLToPath(new URL("../", import.meta.url));
const CLI = path.join(PACKAGE, "dist", "adjutant", "cli.js");
/** Core's folder, as Node resolves it from here: packages/core in a checkout, the installed package from npm. */
const CORE = path.dirname(createRequire(import.meta.url).resolve("@team-antioch/sc2-adjutant/package.json"));

/** The pid file's contents. */
type Recorded = { readonly pid: number; readonly port: number; readonly url: string; readonly workspace: string | null; readonly startedAt: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createOpenDoodadFinder(options: OpenDoodadFinderOptions = {}): OpenDoodadFinderTool {
  const launch = options.launch ?? launchDetached;
  const probe = options.probe ?? probeStatus;
  const processes = options.processes ?? finderProcesses;
  const freePort = options.freePort ?? freePortNear;
  const openPage = options.openPage ?? openInBrowser;
  const checks: Checks = { ...defaultChecks, ...options.checks };
  const pollMs = options.pollMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 120_000;

  /** The Finder's answer once it gives one for this pid, while the process lives, up to the timeout. */
  const answerOf = async (port: number, pid: number, logFile: string): Promise<FinderStatus> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const answer = await probe(port);
      if (typeof answer === "object" && answer.pid === pid) return answer;
      if (!processes.alive(pid)) throw new Error(`The Doodad Finder stopped before it answered. The end of its log, ${logFile}:\n${logTail(logFile)}`);
      if (Date.now() >= deadline)
        throw new Error(
          `The Doodad Finder didn't answer on port ${port} within ${Math.round(timeoutMs / 1000)} s. It is left running (pid ${pid}): a first start downloads the model and embeds every card, so call again to wait for it, or stop it with stop: true. Its log: ${logFile}`,
        );
      await sleep(pollMs);
    }
  };

  return {
    async open({ workspaceRoot, window = "browser", stop = false }: OpenDoodadFinderRequest): Promise<OpenedDoodadFinder> {
      const workspace = existsSync(path.join(workspaceRoot, WORKSPACE_FILE)) ? path.resolve(workspaceRoot) : undefined;
      const folder = workspace ? path.join(workspace, "output", "doodad-finder") : path.join(options.cacheDir ?? catalogCacheDir(), "doodad-finder", "process");
      const pidFile = path.join(folder, "finder.json");
      const logFile = path.join(folder, "finder.log");
      const recorded = readRecorded(pidFile);
      const notes: string[] = [];

      if (stop) {
        if (!recorded || !processes.alive(recorded.pid)) {
          rmSync(pidFile, { force: true });
          return { action: "notRunning", checks: [], notes, pidFile, logFile };
        }
        processes.stop(recorded.pid);
        const deadline = Date.now() + 5000;
        while (processes.alive(recorded.pid)) {
          if (Date.now() >= deadline) throw new Error(`The Doodad Finder (pid ${recorded.pid}) didn't stop within 5 s`);
          await sleep(pollMs);
        }
        rmSync(pidFile, { force: true });
        return { action: "stopped", url: recorded.url, ours: true, checks: [], notes, pidFile, logFile };
      }

      let checked: readonly FinderCheck[] = [];
      const finish = async (action: "started" | "reused", status: FinderStatus, ours: boolean): Promise<OpenedDoodadFinder> => {
        let opened: FinderWindow = "none";
        if (window !== "none") {
          try {
            opened = await openPage(status.url, window);
            if (window === "app" && opened !== "app") notes.push("An app window opens only in Google Chrome on macOS, so the page opened in the default browser.");
          } catch (error) {
            notes.push(`The page didn't open (${(error as Error).message}): open ${status.url} by hand.`);
          }
        }
        return { action, url: status.url, ours, checks: checked, rankers: status.rankers, opened, notes, pidFile, logFile };
      };
      const here = workspace ?? null;

      // This tool's own Finder: answering, or alive and still starting.
      if (recorded) {
        const answer = await probe(recorded.port);
        if (typeof answer === "object" && answer.workspace === here && answer.pid === recorded.pid) return finish("reused", answer, true);
        if (processes.alive(recorded.pid)) return finish("reused", await answerOf(recorded.port, recorded.pid, logFile), true);
        rmSync(pidFile, { force: true });
      }
      // One started some other way, such as by hand, on the usual port.
      const usual = await probe(FINDER_PORT);
      if (typeof usual === "object" && usual.workspace === here) return finish("reused", usual, false);
      if (usual !== undefined)
        notes.push(
          typeof usual === "object"
            ? `Port ${FINDER_PORT} has the Doodad Finder for ${usual.workspace ?? "no Workspace"}, so this one is on another port.`
            : `Something else answers on port ${FINDER_PORT} (another program, or a Finder too old to say its Workspace), so this one is on another port.`,
        );

      checked = await prerequisites(checks, workspace);
      const port = await freePort(FINDER_PORT);
      mkdirSync(folder, { recursive: true });
      // The folder ignores itself, so the Workspace's git status stays clean.
      writeFileSync(path.join(folder, ".gitignore"), "*\n");
      // INIT_CWD would make the CLI look for a Workspace above where npm ran the MCP server.
      const env = { ...process.env, INIT_CWD: undefined };
      // --no-workspace, since the checkout the CLI runs from is itself a Workspace.
      const args = [CLI, ...(workspace ? ["--workspace", workspace] : ["--no-workspace"]), "--port", String(port)];
      const pid = await launch({ command: process.execPath, args, cwd: PACKAGE, env, logFile });
      const record: Recorded = { pid, port, url: `http://127.0.0.1:${port}/`, workspace: workspace ?? null, startedAt: new Date().toISOString() };
      writeFileSync(pidFile, `${JSON.stringify(record, null, 2)}\n`);
      return finish("started", await answerOf(port, pid, logFile), true);
    },
  };
}

function readRecorded(file: string): Recorded | undefined {
  try {
    const recorded = JSON.parse(readFileSync(file, "utf8")) as Partial<Recorded>;
    return Number.isInteger(recorded.pid) && Number.isInteger(recorded.port) ? (recorded as Recorded) : undefined;
  } catch {
    return undefined;
  }
}

function logTail(file: string, lines = 12): string {
  try {
    return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "(no log)";
  }
}

/** Each prerequisite, said plainly. None stops a start. */
async function prerequisites(checks: Checks, workspace: string | undefined): Promise<FinderCheck[]> {
  const { stale } = checks.coreBuild();
  const modelCached = checks.modelCached();
  const [credentials, pictures] = await Promise.all([checks.credentials(), checks.pictures(workspace)]);
  return [
    {
      name: "package",
      ok: !stale,
      note: stale
        ? "the doodad-finder package is installed, but core's src changed since its last build, and the Finder runs core's dist: run `npm run build -w @team-antioch/sc2-adjutant` for the change to show"
        : "the doodad-finder package is installed, and core is built",
    },
    { name: "Workspace", ok: workspace !== undefined, note: workspace ?? `no Workspace: core's catalogs only, and ${researchArchiveDirIfSet() ? "Doodad Searches go to the research archive" : "no Doodad Searches, since SC2_RESEARCH_DIR isn't set"}` },
    {
      name: "embeddings model",
      ok: modelCached,
      note: modelCached ? `${FINDER_MODEL} is cached` : `${FINDER_MODEL} isn't cached: the first start downloads about 34 MB and embeds every card, around 20 s`,
    },
    {
      name: "Jev",
      ok: credentials.jev,
      note: credentials.jev
        ? credentials.source === "environment"
          ? "Jev's key is in TYPESAFE_API_KEY"
          : "Jev's key is the one `sc2-doodad-finder login` saved"
        : `${credentials.off ?? "no TypeSafe key: run `npx @team-antioch/sc2-doodad-finder login`, or set TYPESAFE_API_KEY"}. Jev will be off and the page shows the narrowing's order; TYPESAFE_API_KEY counts only where Claude Code is started, as the Finder this starts inherits its environment`,
    },
    {
      name: "pictures",
      ok: pictures.missing === 0,
      note: !pictures.missing
        ? "every catalog entry has a sheet or a gallery picture here"
        : `${pictures.missing} catalog entries have neither a sheet nor a gallery picture here${pictures.withRenders ? `; ${pictures.withRenders} of them have their renders, so \`npm run catalog-sheets\` builds their sheets` : ""}`,
    },
  ];
}

/** The newest modification time under a folder, in ms, for files ending in `ending`. */
function newest(folder: string, ending: string): number {
  let latest = 0;
  for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(ending)) latest = Math.max(latest, statSync(path.join(entry.parentPath, entry.name)).mtimeMs);
  }
  return latest;
}

const defaultChecks: Checks = {
  coreBuild() {
    const src = path.join(CORE, "src");
    return { stale: existsSync(src) && newest(src, ".ts") > newest(path.join(CORE, "dist"), ".js") };
  },
  modelCached: () => existsSync(path.join(modelCacheDir(), FINDER_MODEL, "onnx", "model_quantized.onnx")),
  async credentials() {
    // Loaded here, on a call, so loading the tool costs the server's start nothing.
    const { jevKey } = await import("@team-antioch/sc2-doodad-finder/credentials.js");
    try {
      const found = jevKey();
      return found ? { jev: true, source: found.source } : { jev: false };
    } catch (error) {
      return { jev: false, off: `can't read the saved Jev key (${(error as Error).message})` };
    }
  },
  async pictures(workspaceRoot) {
    const { finderSources } = await import("./adjutant/sources.ts");
    const sources = await (await finderSources(workspaceRoot)).load();
    const looked = lookUpDoodads(
      [...allDoodadEntries(sources)].map(({ id }) => id),
      sources,
    );
    const missing = [...looked.values()].filter(({ picture }) => picture.kind === "none");
    return { missing: missing.length, withRenders: missing.filter(({ hasRenders }) => hasRenders).length };
  },
};

/** Starts the process in its own process group, its output appended to the log, and lets it go. */
async function launchDetached({ command, args, cwd, env, logFile }: Launch): Promise<number> {
  mkdirSync(path.dirname(logFile), { recursive: true });
  const log = openSync(logFile, "a");
  try {
    // windowsHide: a detached process on Windows otherwise gets a console window of its own.
    const child = spawn(command, args, { cwd, env, detached: true, windowsHide: true, stdio: ["ignore", log, log] });
    const pid = await new Promise<number>((resolve, reject) => {
      child.once("spawn", () => resolve(child.pid!));
      child.once("error", reject);
    });
    child.unref();
    return pid;
  } finally {
    closeSync(log);
  }
}

async function probeStatus(port: number): Promise<FinderStatus | "other" | undefined> {
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(2000) });
  } catch {
    return undefined;
  }
  if (!response.ok) return "other";
  const body = (await response.json().catch(() => undefined)) as Partial<FinderStatus> | undefined;
  return body?.finder === "doodad-finder" && typeof body.pid === "number" ? (body as FinderStatus) : "other";
}

/** How long a pid's command line, once read as this CLI's, is trusted without reading it again. */
const CONFIRMED_MS = 30_000;
/** When each pid was last read as running this CLI: the polls in between ask only whether it lives. */
const confirmed = new Map<number, number>();

const finderProcesses = {
  /**
   * Alive and still running this package's CLI: a pid reused by another program counts as gone.
   * A command line that can't be read (PowerShell slow to start, a timeout) leaves the pid alive,
   * since process.kill found it; only one read as another program's counts it gone.
   */
  alive(pid: number): boolean {
    try {
      process.kill(pid, 0);
    } catch {
      confirmed.delete(pid);
      return false;
    }
    if (Date.now() - (confirmed.get(pid) ?? -Infinity) < CONFIRMED_MS) return true;
    const command = readCommand(pid);
    if (command === undefined) return true;
    if (!command.includes(CLI)) {
      confirmed.delete(pid);
      return false;
    }
    confirmed.set(pid, Date.now());
    return true;
  },
  stop(pid: number): void {
    process.kill(pid, "SIGTERM");
  },
};

/**
 * How to read a process's command line: ps on macOS and Linux, Windows having no ps, PowerShell's
 * process table there. PowerShell writes a pipe in the console's code page, so it is told to write
 * UTF-8, or a path outside ASCII (a user folder with an accent) wouldn't match.
 */
export function commandLineReader(pid: number, platform: NodeJS.Platform = process.platform): { readonly command: string; readonly args: readonly string[] } {
  if (platform === "win32")
    return {
      command: "powershell",
      args: ["-NoProfile", "-NonInteractive", "-Command", `[Console]::OutputEncoding = [Text.Encoding]::UTF8; (Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`],
    };
  return { command: "ps", args: ["-o", "command=", "-p", String(pid)] };
}

/** A process's command line, or undefined when it can't be read. */
const readCommand = (pid: number): string | undefined => {
  const { command, args } = commandLineReader(pid);
  const read = spawnSync(command, args, { encoding: "utf8", timeout: 10_000, windowsHide: true });
  return read.error || read.signal || !read.stdout?.trim() ? undefined : read.stdout;
};

const listens = (port: number) =>
  new Promise<number | undefined>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(undefined));
    server.listen(port, "127.0.0.1", () => {
      const { port: bound } = server.address() as { port: number };
      server.close(() => resolve(bound));
    });
  });

async function freePortNear(preferred: number): Promise<number> {
  return (await listens(preferred)) ?? (await listens(0))!;
}

/** Chrome, in /Applications or the user's own Applications. */
const CHROME = "Applications/Google Chrome.app";
const chromeInstalled = (): boolean => [path.join("/", CHROME), path.join(os.homedir(), CHROME)].some((app) => existsSync(app));

/**
 * How to open the page on a platform: a Chrome app window only on macOS with Chrome, else the
 * default browser, with open, explorer or xdg-open (as the Set Finder's CLI does). open exits
 * once the page is handed over, with a code that means it. explorer exits 1 even when it opened
 * the page, so on Windows the page counts as opened once explorer starts. xdg-open may run the
 * browser in the foreground (no desktop, or $BROWSER set) and not exit until it closes, so on
 * Linux the page counts as opened unless xdg-open fails within a moment.
 */
export function pageOpener(
  url: string,
  window: "browser" | "app",
  { platform = process.platform, chrome = chromeInstalled }: { readonly platform?: NodeJS.Platform; readonly chrome?: () => boolean } = {},
): { readonly command: string; readonly args: readonly string[]; readonly opened: "browser" | "app"; readonly settles: "exit" | "start" | "grace" } {
  if (platform === "darwin")
    return window === "app" && chrome()
      ? { command: "open", args: ["-na", "Google Chrome", "--args", `--app=${url}`], opened: "app", settles: "exit" }
      : { command: "open", args: [url], opened: "browser", settles: "exit" };
  if (platform === "win32") return { command: "explorer", args: [url], opened: "browser", settles: "start" };
  return { command: "xdg-open", args: [url], opened: "browser", settles: "grace" };
}

/** How long xdg-open has to fail before the page counts as opened. */
const OPENER_GRACE_MS = 1500;

async function openInBrowser(url: string, window: "browser" | "app"): Promise<"browser" | "app"> {
  const { command, args, opened, settles } = pageOpener(url, window);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true, detached: settles !== "exit" });
    child.once("error", reject);
    const exited = (code: number | null, signal: NodeJS.Signals | null) => (code === 0 ? resolve() : reject(new Error(`${command} ${signal ? `was stopped (${signal})` : `exited with ${code}`}`)));
    if (settles === "exit") return void child.once("exit", exited);
    child.once("spawn", () => {
      if (settles === "start") {
        child.unref();
        return resolve();
      }
      // A browser xdg-open runs in the foreground is left running: the page is open.
      const grace = setTimeout(() => {
        child.removeListener("exit", exited);
        child.unref();
        resolve();
      }, OPENER_GRACE_MS);
      child.once("exit", (code, signal) => {
        clearTimeout(grace);
        exited(code, signal);
      });
    });
  });
  return opened;
}
