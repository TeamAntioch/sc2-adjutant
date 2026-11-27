// open_doodad_finder (src/open-doodad-finder.ts, #666): the prerequisites reported, a Finder started
// detached with its pid and port written, reused when one already answers for the Workspace, stopped
// by its pid file, and a start that never answers reported as an error. A fake launcher, processes,
// probe and opener: nothing here starts a process or opens a window.
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadOpenDoodadFinder } from "@team-antioch/sc2-adjutant/dist/mcp/open-doodad-finder.js";
import { createServer } from "@team-antioch/sc2-adjutant/dist/mcp/server.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { commandLineReader, createOpenDoodadFinder, type FinderStatus, type Launch, type OpenDoodadFinderOptions, pageOpener } from "../src/open-doodad-finder.ts";

let dir: string;
let cache: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "open-doodad-finder-"));
  cache = path.join(dir, "cache");
  await writeFile(path.join(dir, "sc2-adjutant.workspace.json"), "{}");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const status = (port: number, pid: number, workspace: string | null = dir): FinderStatus => ({
  finder: "doodad-finder",
  workspace,
  pid,
  url: `http://127.0.0.1:${port}/`,
  rankers: { on: ["jev"], off: [] },
});

/**
 * A machine with fake processes. `running` is what already answers on each port. A launched Finder
 * answers on its port from its `answersAfter`-th probe while it is alive, or never.
 */
function machine({ answersAfter = 1, never = false, running = new Map<number, FinderStatus | "other">() } = {}) {
  const launches: Launch[] = [];
  const opened: { url: string; window: string }[] = [];
  const alive = new Set<number>();
  const stopped: number[] = [];
  const probes = new Map<number, number>();
  let nextPid = 5000;
  const options: OpenDoodadFinderOptions = {
    launch: async (launch) => {
      launches.push(launch);
      const pid = nextPid++;
      alive.add(pid);
      const port = Number(launch.args[launch.args.indexOf("--port") + 1]);
      const workspace = launch.args.includes("--workspace") ? launch.args[launch.args.indexOf("--workspace") + 1]! : null;
      probes.set(port, 0);
      if (!never) running.set(port, status(port, pid, workspace));
      return pid;
    },
    probe: async (port) => {
      const answer = running.get(port);
      if (typeof answer !== "object") return answer;
      if (probes.has(port)) {
        const seen = probes.get(port)! + 1;
        probes.set(port, seen);
        if (seen < answersAfter || !alive.has(answer.pid)) return undefined;
      }
      return answer;
    },
    processes: {
      alive: (pid) => alive.has(pid),
      stop: (pid) => {
        stopped.push(pid);
        alive.delete(pid);
      },
    },
    freePort: async (preferred) => (running.has(preferred) ? 4700 : preferred),
    openPage: async (url, window) => {
      opened.push({ url, window });
      return window;
    },
    checks: {
      coreBuild: () => ({ stale: false }),
      modelCached: () => true,
      credentials: async () => ({ jev: true, source: "environment" as const }),
      pictures: async () => ({ missing: 0, withRenders: 0 }),
    },
    cacheDir: cache,
    pollMs: 1,
    timeoutMs: 200,
  };
  return { options, launches, opened, alive, stopped, running };
}

describe("open_doodad_finder", () => {
  it("is served when the package is installed, and answers through the MCP server", async () => {
    expect(await loadOpenDoodadFinder()).toBeDefined();
    const fake = machine();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer({ workspaceRoot: dir, openDoodadFinder: createOpenDoodadFinder(fake.options) }).connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
    try {
      await client.listTools();
      const reply = await client.callTool({ name: "open_doodad_finder", arguments: { window: "none" } });
      expect(reply.isError, JSON.stringify(reply.content)).toBeFalsy();
      expect(reply.structuredContent).toMatchObject({ action: "started", url: "http://127.0.0.1:4634/", opened: "none" });
      expect(fake.opened).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("starts the Finder detached for the Workspace, writes its pid and port beside its log, waits for it and opens the page", async () => {
    const fake = machine();
    const result = await createOpenDoodadFinder(fake.options).open({ workspaceRoot: dir });

    expect(fake.launches).toHaveLength(1);
    expect(fake.launches[0]!.args.slice(1)).toEqual(["--workspace", dir, "--port", "4634"]);
    expect(fake.launches[0]!.args[0]).toMatch(/dist[\\/]adjutant[\\/]cli\.js$/);
    expect(existsSync(fake.launches[0]!.args[0]!)).toBe(true);
    const output = path.join(dir, "output", "doodad-finder");
    expect(fake.launches[0]!.logFile).toBe(path.join(output, "finder.log"));
    expect(JSON.parse(await readFile(path.join(output, "finder.json"), "utf8"))).toMatchObject({ pid: 5000, port: 4634, workspace: dir });
    // The folder ignores itself, so the Workspace's git status stays clean.
    expect(await readFile(path.join(output, ".gitignore"), "utf8")).toBe("*\n");

    expect(fake.opened).toEqual([{ url: "http://127.0.0.1:4634/", window: "browser" }]);
    expect(result).toMatchObject({ action: "started", url: "http://127.0.0.1:4634/", ours: true, opened: "browser", rankers: { on: ["jev"] } });
  });
});

describe("open_doodad_finder's prerequisites", () => {
  it("says plainly what is missing and how to fix it, and starts all the same", async () => {
    const fake = machine();
    const result = await createOpenDoodadFinder({
      ...fake.options,
      checks: {
        coreBuild: () => ({ stale: true }),
        modelCached: () => false,
        credentials: async () => ({ jev: false }),
        pictures: async () => ({ missing: 12, withRenders: 5 }),
      },
    }).open({ workspaceRoot: dir });

    expect(result.action).toBe("started");
    const note = (name: string) => result.checks.find((check) => check.name === name);
    expect(note("package")).toMatchObject({ ok: false, note: expect.stringContaining("pnpm --filter @team-antioch/sc2-adjutant run build") });
    expect(note("Workspace")).toEqual({ name: "Workspace", ok: true, note: dir });
    expect(note("embeddings model")).toMatchObject({ ok: false, note: expect.stringContaining("downloads about 34 MB and embeds every card, around 20 s") });
    expect(note("Jev")).toMatchObject({ ok: false, note: expect.stringContaining("no TypeSafe key: run `npx @team-antioch/sc2-doodad-finder login`, or set TYPESAFE_API_KEY") });
    expect(note("Jev")?.note).not.toMatch(/Keychain|security/);
    expect(note("pictures")?.note).toBe("12 catalog entries have neither a sheet nor a gallery picture here; 5 of them have their renders, so `npm run catalog-sheets` builds their sheets");
  });

  it("says where the Finder will find Jev's key, never the key: the environment or the key file login saved", async () => {
    const jev = async (source: "environment" | "key file") => {
      const { options } = machine();
      return (await createOpenDoodadFinder({ ...options, checks: { ...options.checks!, credentials: async () => ({ jev: true, source }) } }).open({ workspaceRoot: dir, window: "none" })).checks.find(
        (check) => check.name === "Jev",
      );
    };
    expect(await jev("environment")).toEqual({ name: "Jev", ok: true, note: "Jev's key is in TYPESAFE_API_KEY" });
    expect(await jev("key file")).toEqual({ name: "Jev", ok: true, note: "Jev's key is the one `sc2-doodad-finder login` saved" });
  });

  it("says every check passed when nothing is missing", async () => {
    const result = await createOpenDoodadFinder(machine().options).open({ workspaceRoot: dir, window: "none" });
    expect(result.checks.every(({ ok }) => ok)).toBe(true);
    expect(result.checks.map(({ name }) => name)).toEqual(["package", "Workspace", "embeddings model", "Jev", "pictures"]);
  });

  it("with no Workspace, starts the Finder on core's catalogs and keeps its pid file in the cache folder", async () => {
    const elsewhere = await mkdtemp(path.join(tmpdir(), "not-a-workspace-"));
    try {
      const fake = machine();
      const result = await createOpenDoodadFinder(fake.options).open({ workspaceRoot: elsewhere, window: "none" });
      // Said outright: the checkout the CLI runs from is itself a Workspace.
      expect(fake.launches[0]!.args.slice(1)).toEqual(["--no-workspace", "--port", "4634"]);
      expect(result.checks.find(({ name }) => name === "Workspace")).toMatchObject({ ok: false, note: expect.stringContaining("no Workspace") });
      expect(result.pidFile).toBe(path.join(cache, "doodad-finder", "process", "finder.json"));
      expect(existsSync(result.pidFile)).toBe(true);
      expect(await readFile(path.join(cache, "doodad-finder", "process", ".gitignore"), "utf8")).toBe("*\n");
      expect(await createOpenDoodadFinder(fake.options).open({ workspaceRoot: elsewhere, window: "none" })).toMatchObject({ action: "reused", ours: true });
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });
});

describe("open_doodad_finder with a Finder already running", () => {
  it("reuses the one it started, by its pid file, and just opens the page", async () => {
    const fake = machine();
    const tool = createOpenDoodadFinder(fake.options);
    await tool.open({ workspaceRoot: dir, window: "none" });
    const again = await tool.open({ workspaceRoot: dir, window: "app" });
    expect(fake.launches).toHaveLength(1);
    // A reuse only opens the page: the checks are for a start, and the rankers come from the Finder.
    expect(again).toMatchObject({ action: "reused", ours: true, url: "http://127.0.0.1:4634/", opened: "app", checks: [], rankers: { on: ["jev"] } });
    expect(fake.opened).toEqual([{ url: "http://127.0.0.1:4634/", window: "app" }]);
  });

  it("still gives the URL when the page won't open, with a note saying so", async () => {
    const fake = machine();
    const result = await createOpenDoodadFinder({
      ...fake.options,
      openPage: async () => {
        throw new Error("spawn xdg-open ENOENT");
      },
    }).open({ workspaceRoot: dir });
    expect(result).toMatchObject({ action: "started", url: "http://127.0.0.1:4634/", opened: "none" });
    expect(result.notes).toEqual(["The page didn't open (spawn xdg-open ENOENT): open http://127.0.0.1:4634/ by hand."]);
  });

  it("reuses one started by hand for this Workspace on the usual port, and says stop won't stop it", async () => {
    const fake = machine({ running: new Map([[4634, status(4634, 777)]]) });
    const result = await createOpenDoodadFinder(fake.options).open({ workspaceRoot: dir });
    expect(fake.launches).toEqual([]);
    expect(result).toMatchObject({ action: "reused", ours: false, opened: "browser" });
  });

  it("starts its own on another port when the usual one has another Workspace's Finder or something else", async () => {
    const another = path.join(tmpdir(), "another-workspace");
    for (const [answer, said] of [
      [status(4634, 777, another), `the Doodad Finder for ${another}`],
      ["other", "Something else answers on port 4634"],
    ] as const) {
      const fake = machine({ running: new Map([[4634, answer]]) });
      const result = await createOpenDoodadFinder(fake.options).open({ workspaceRoot: dir, window: "none" });
      expect(fake.launches[0]!.args).toContain("4700");
      expect(result).toMatchObject({ action: "started", url: "http://127.0.0.1:4700/" });
      expect(result.notes.join("\n")).toContain(said);
      await rm(result.pidFile);
    }
  });

  it("waits for its own Finder that is still starting rather than starting another", async () => {
    const fake = machine({ answersAfter: 4 });
    await expect(createOpenDoodadFinder({ ...fake.options, timeoutMs: 0 }).open({ workspaceRoot: dir, window: "none" })).rejects.toThrow(/didn't answer/);
    const again = await createOpenDoodadFinder(fake.options).open({ workspaceRoot: dir, window: "none" });
    expect(fake.launches).toHaveLength(1);
    expect(again).toMatchObject({ action: "reused", ours: true });
  });

  it("starts again when the Finder in its pid file has died", async () => {
    const fake = machine();
    const tool = createOpenDoodadFinder(fake.options);
    await tool.open({ workspaceRoot: dir, window: "none" });
    fake.alive.clear();
    const again = await tool.open({ workspaceRoot: dir, window: "none" });
    expect(fake.launches).toHaveLength(2);
    expect(again).toMatchObject({ action: "started" });
    expect(JSON.parse(await readFile(again.pidFile, "utf8"))).toMatchObject({ pid: 5001 });
  });
});

describe("open_doodad_finder stop", () => {
  it("stops the Finder it started by its pid file, and removes the file", async () => {
    const fake = machine();
    const tool = createOpenDoodadFinder(fake.options);
    const started = await tool.open({ workspaceRoot: dir, window: "none" });
    const stopped = await tool.open({ workspaceRoot: dir, stop: true });
    expect(fake.stopped).toEqual([5000]);
    expect(stopped).toMatchObject({ action: "stopped", url: "http://127.0.0.1:4634/" });
    expect(existsSync(started.pidFile)).toBe(false);
  });

  it("stops nothing it didn't start", async () => {
    const fake = machine({ running: new Map([[4634, status(4634, 777)]]) });
    const result = await createOpenDoodadFinder(fake.options).open({ workspaceRoot: dir, stop: true });
    expect(result.action).toBe("notRunning");
    expect(fake.stopped).toEqual([]);
  });
});

describe("open_doodad_finder's timeout", () => {
  it("reports a start that never answers as an error naming its log, and leaves it running", async () => {
    const fake = machine({ never: true });
    await expect(createOpenDoodadFinder({ ...fake.options, timeoutMs: 0 }).open({ workspaceRoot: dir })).rejects.toThrow(
      /didn't answer on port 4634 within 0 s\. It is left running \(pid 5000\).*finder\.log/,
    );
    expect(fake.opened).toEqual([]);
    expect(fake.alive.has(5000)).toBe(true);
  });

  it("reports a Finder that exits before it answers, with the end of its log", async () => {
    const fake = machine({ never: true });
    const result = createOpenDoodadFinder({
      ...fake.options,
      launch: async (launch) => {
        const pid = await fake.options.launch!(launch);
        await writeFile(launch.logFile, "Error: the catalogs didn't load\n");
        fake.alive.delete(pid);
        return pid;
      },
    }).open({ workspaceRoot: dir });
    await expect(result).rejects.toThrow(/stopped before it answered[\s\S]*the catalogs didn't load/);
  });
});

describe("open_doodad_finder on each platform", () => {
  const url = "http://127.0.0.1:4634/";
  const withChrome = { chrome: () => true };

  it("opens the page with open on macOS, in a Chrome app window when asked and Chrome is there", () => {
    expect(pageOpener(url, "browser", { platform: "darwin", ...withChrome })).toEqual({ command: "open", args: [url], opened: "browser", settles: "exit" });
    expect(pageOpener(url, "app", { platform: "darwin", ...withChrome })).toEqual({ command: "open", args: ["-na", "Google Chrome", "--args", `--app=${url}`], opened: "app", settles: "exit" });
    expect(pageOpener(url, "app", { platform: "darwin", chrome: () => false })).toMatchObject({ command: "open", args: [url], opened: "browser" });
  });

  it("opens the page with explorer on Windows, counted as opened once it starts, since explorer exits 1 when it worked", () => {
    expect(pageOpener(url, "browser", { platform: "win32" })).toEqual({ command: "explorer", args: [url], opened: "browser", settles: "start" });
    expect(pageOpener(url, "app", { platform: "win32", ...withChrome })).toMatchObject({ command: "explorer", opened: "browser" });
  });

  it("opens the page with xdg-open on Linux, counted as opened unless it fails within a moment, as it may run the browser in the foreground", () => {
    expect(pageOpener(url, "app", { platform: "linux", ...withChrome })).toEqual({ command: "xdg-open", args: [url], opened: "browser", settles: "grace" });
  });

  it("reads a process's command line with ps, and with PowerShell on Windows, which has no ps", () => {
    expect(commandLineReader(5000, "darwin")).toEqual({ command: "ps", args: ["-o", "command=", "-p", "5000"] });
    expect(commandLineReader(5000, "linux")).toEqual({ command: "ps", args: ["-o", "command=", "-p", "5000"] });
    const windows = commandLineReader(5000, "win32");
    expect(windows.command).toBe("powershell");
    // UTF-8 out, so a path outside ASCII still matches.
    expect(windows.args.at(-1)).toBe("[Console]::OutputEncoding = [Text.Encoding]::UTF8; (Get-CimInstance Win32_Process -Filter 'ProcessId=5000').CommandLine");
  });
});
