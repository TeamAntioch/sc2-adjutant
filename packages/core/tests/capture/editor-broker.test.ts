// The Editor Broker (#639): one process owns the Host and runs its editor.captureTour jobs one at a
// time, for clients on a Unix socket (a named pipe on Windows). Run against a fake host whose tour writes one frame per stop
// of the capture copy's Triggers, each frame holding its stop's x, so a job's frames can be told
// from another's. The broker runs in this process, on a socket in a temp folder.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { brokerPipePath, brokerSocketPath, brokerUnixSocketPath, EditorBusyError, editorBrokerStatus, runCaptureJob, runEditorJob, type CaptureJob } from "../../src/capture/editor-broker-client.js";
import { startEditorBroker, type EditorBroker } from "../../src/capture/editor-broker.js";
import { testInGame } from "../../src/mcp/tools/editor-handoff.js";
import type { Host } from "../../src/host/host.js";
import { emptyMachineConfig } from "../../src/host/machine-config.js";
import type { CaptureTourRequest, CaptureTourResult } from "../../src/plugins/plugin-api.js";
import { writeMapInfo } from "../../src/terrain/write-map-info.js";

const folders: string[] = [];
const brokers: EditorBroker[] = [];
afterEach(async () => {
  await Promise.all(brokers.splice(0).map((broker) => broker.close()));
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

type Tour = (request: CaptureTourRequest) => Promise<CaptureTourResult | void>;

/** A host whose tour runs `before` (to hold it or fail it), then writes a frame per stop; it records every call. */
async function setup({ before }: { before?: Tour } = {}) {
  const folder = await mkdtemp(path.join(tmpdir(), "broker-"));
  folders.push(folder);
  const cacheDir = path.join(folder, "cache");
  const calls: string[] = [];
  let running = 0;
  let overlapped = false;
  const tour = async (request: CaptureTourRequest): Promise<CaptureTourResult> => {
    running++;
    if (running > 1) overlapped = true;
    calls.push(`tour ${path.basename(request.mapPath)}`);
    try {
      const early = await before?.(request);
      if (early) return early;
      await request.writeMap?.();
      const triggers = (await readFile(path.join(request.mapPath, "Triggers"), "utf8")).replace(/&quot;/g, '"');
      const xs = [...triggers.matchAll(/exTourX\[(\d+)\] = ([\d.]+);/g)].map((match) => match[2]!);
      await mkdir(request.outputDir, { recursive: true });
      for (const [i, x] of xs.entries()) {
        const stop = String(i + 1).padStart(request.frameDigits, "0");
        await writeFile(path.join(request.outputDir, `${stop}.jpg`), `x=${x}`);
        await writeFile(path.join(request.outputDir, "stops.txt"), `${i + 1} ${x} 1.5\n`, { flag: "a" });
        request.log?.(`stop ${i + 1}`);
      }
      return { frames: xs.length, end: "done" };
    } finally {
      running--;
    }
  };
  // The game a Test Document started, until the test quits it.
  let game = false;
  const host: Host = {
    machine: { ...emptyMachineConfig(path.join(folder, "machine.json")), cacheDir },
    adapter: undefined,
    has: (name) => ["editor.captureTour", "editor.closeCaptureCopies", "editor.testDocument", "editor.save", "game.running"].includes(name),
    run: ((name: string, request: never) => {
      if (name === "editor.captureTour") return tour(request);
      if (name === "editor.testDocument" || name === "editor.save") {
        if (running > 0) overlapped = true;
        calls.push(`${name} ${path.basename((request as { mapPath: string }).mapPath)}`);
        if (name === "editor.testDocument") game = true;
        return Promise.resolve();
      }
      if (name === "game.running") return Promise.resolve(game);
      if (name === "editor.closeCaptureCopies") {
        calls.push("close copies");
        return Promise.resolve();
      }
      return Promise.reject(new Error(`no ${name}`));
    }) as Host["run"],
  };
  // Windows has no Unix sockets: a broker there listens on the named pipe production names for a cacheDir.
  const socketPath = process.platform === "win32" ? brokerPipePath(folder) : path.join(folder, "b.sock");
  // The broker's own log, without its timestamps.
  const brokerLog: string[] = [];
  const start = async (idleMs = 60_000, script?: string) => {
    const broker = await startEditorBroker({ host, socketPath, idleMs, holdPollMs: 10, log: (line) => brokerLog.push(line), ...(script ? { script } : {}) });
    if (broker) brokers.push(broker);
    return broker;
  };
  const maps: Record<string, string> = {};
  const map = async (name: string) => {
    const mapPath = path.join(folder, `${name}.SC2Map`);
    await mkdir(mapPath, { recursive: true });
    await writeFile(path.join(mapPath, "MapInfo"), writeMapInfo({ width: 96, height: 80, tilesetId: "Shakuras", fogType: "Dark", playableBounds: [20, 20, 76, 60], players: [] }));
    await writeFile(path.join(mapPath, "Triggers"), "<TriggerData/>");
    maps[name] = mapPath;
    return mapPath;
  };
  const job = (source: string, label: string, xs: readonly number[], extra: Partial<Extract<CaptureJob, { kind: "tour" }>> = {}): CaptureJob => ({
    kind: "tour",
    source,
    label,
    copy: { stops: xs.map((x) => [x, 30] as const) },
    settings: { frameDigits: 2, recordKeys: ["x", "y"], width: 1600, quality: 85, startSeconds: 300, pressSpaceAfterSeconds: 30 },
    outputDir: path.join(folder, "out", label),
    ...extra,
  });
  return { folder, cacheDir, host, socketPath, start, map, job, calls, brokerLog, overlapped: () => overlapped, quitGame: () => (game = false) };
}

/** A promise and the function that settles it. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

/** Waits for `opened`, or rejects as the macOS tour does once the request's signal aborts. */
const heldUntil = (opened: Promise<void>, request: CaptureTourRequest): Promise<void> =>
  Promise.race([
    opened,
    new Promise<void>((_, reject) => {
      const stop = () => reject(new Error("the capture was cancelled"));
      if (request.signal?.aborted) stop();
      request.signal?.addEventListener("abort", stop);
    }),
  ]);

async function until(check: () => Promise<boolean> | boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out");
}

const queued = (socketPath: string, n: number) => async () => ((await editorBrokerStatus(socketPath))?.queue.length ?? 0) === n;

describe("the Editor Broker", () => {
  it("runs two clients' jobs one at a time, in arrival order, each on its own copy, and closes copies left open on start", async () => {
    const hold = gate();
    const t = await setup({ before: async (request) => (request.mapPath.includes("Alpha") ? hold.opened : undefined) });
    await t.start();
    const [alpha, beta] = [await t.map("Alpha"), await t.map("Beta")];
    const lines: string[] = [];
    const first = runCaptureJob(t.job(alpha, "a", [40]), { socketPath: t.socketPath, log: (line) => lines.push(line) });
    await until(() => t.calls.some((call) => call.startsWith("tour Alpha")));
    const second = runCaptureJob(t.job(beta, "b", [50]), { socketPath: t.socketPath });
    await until(queued(t.socketPath, 1));
    const status = await editorBrokerStatus(t.socketPath);
    expect(status?.running?.map((job) => job.source)).toEqual([alpha]);
    expect(status?.queue.map((job) => job.source)).toEqual([beta]);
    hold.open();

    const [a, b] = await Promise.all([first, second]);
    expect(t.overlapped()).toBe(false);
    expect(t.calls[0]).toBe("close copies");
    expect(t.calls.slice(1).map((call) => call.replace(/-\w+\.SC2Map$/, ""))).toEqual(["tour Alpha a", "tour Beta b"]);
    expect([a.frames, a.end, b.frames, b.end]).toEqual([1, "done", 1, "done"]);
    expect(lines).toContain("stop 1");
    // Each copy has its own name, in the capture maps folder, and a finished one is gone.
    expect(path.dirname(a.copy!)).toBe(path.join(t.cacheDir, "capture", "maps"));
    expect(a.copy).not.toBe(b.copy);
    expect(existsSync(a.copy!)).toBe(false);
  });

  it("merges waiting jobs on the same map and lighting into one tour, and gives each job only its own frames", async () => {
    const hold = gate();
    const t = await setup({ before: async (request) => (request.mapPath.includes("Other") ? hold.opened : undefined) });
    await t.start();
    const [other, yard] = [await t.map("Other"), await t.map("Yard")];
    const blocker = runCaptureJob(t.job(other, "o", [40]), { socketPath: t.socketPath });
    await until(() => t.calls.some((call) => call.startsWith("tour Other")));
    const first = runCaptureJob(t.job(yard, "a", [41, 42]), { socketPath: t.socketPath });
    await until(queued(t.socketPath, 1));
    const lit = runCaptureJob(t.job(yard, "lit", [44], { copy: { stops: [[44, 30]], lighting: "Night" } }), { socketPath: t.socketPath });
    await until(queued(t.socketPath, 2));
    const second = runCaptureJob(t.job(yard, "b", [43]), { socketPath: t.socketPath });
    await until(queued(t.socketPath, 3));
    hold.open();
    const [, a, l, b] = await Promise.all([blocker, first, lit, second]);

    expect(t.calls.filter((call) => call.startsWith("tour Yard")).map((call) => call.replace(/-\w+\.SC2Map$/, ""))).toEqual(["tour Yard a", "tour Yard lit"]);
    expect([a.frames, b.frames, l.frames]).toEqual([2, 1, 1]);
    expect(a.copy).toBe(b.copy);
    const out = (label: string) => path.join(t.folder, "out", label);
    expect((await readdir(out("a"))).sort()).toEqual(["01.jpg", "02.jpg", "stops.txt"]);
    expect([await readFile(path.join(out("a"), "01.jpg"), "utf8"), await readFile(path.join(out("a"), "02.jpg"), "utf8")]).toEqual(["x=41.00", "x=42.00"]);
    expect((await readdir(out("b"))).sort()).toEqual(["01.jpg", "stops.txt"]);
    expect(await readFile(path.join(out("b"), "01.jpg"), "utf8")).toBe("x=43.00");
    expect(await readFile(path.join(out("b"), "stops.txt"), "utf8")).toBe("1 43.00 1.5\n");
    expect(await readFile(path.join(out("a"), "stops.txt"), "utf8")).toBe("1 41.00 1.5\n2 42.00 1.5\n");
  });

  it("closes the copies after a failing job, reports it in the status, and runs the next", async () => {
    const t = await setup({
      before: async (request) => {
        if (request.mapPath.includes("Broken")) throw new Error("the Editor never opened it");
      },
    });
    await t.start();
    const [broken, fine] = [await t.map("Broken"), await t.map("Fine")];
    const failing = runCaptureJob(t.job(broken, "x", [40]), { socketPath: t.socketPath });
    const next = runCaptureJob(t.job(fine, "y", [40]), { socketPath: t.socketPath });
    await expect(failing).rejects.toThrow("the Editor never opened it");
    expect((await next).end).toBe("done");
    expect(t.calls.map((call) => call.replace(/ \w+-\w+\.SC2Map$/, ""))).toEqual(["close copies", "tour Broken", "close copies", "tour Fine"]);
    expect((await editorBrokerStatus(t.socketPath))?.lastError?.message).toContain("the Editor never opened it");
  });

  it("drops a waiting job whose client went away, and cancels a running one, then closes its copies and runs the next", async () => {
    const hold = gate();
    const t = await setup({ before: async (request) => (request.mapPath.includes("Alpha") ? heldUntil(hold.opened, request) : undefined) });
    await t.start();
    const [alpha, beta] = [await t.map("Alpha"), await t.map("Beta")];
    const running = new AbortController();
    const first = runCaptureJob(t.job(alpha, "a", [40]), { socketPath: t.socketPath, signal: running.signal });
    await until(() => t.calls.some((call) => call.startsWith("tour Alpha")));
    const waiting = new AbortController();
    const dropped = runCaptureJob(t.job(beta, "b", [40]), { socketPath: t.socketPath, signal: waiting.signal });
    await until(queued(t.socketPath, 1));
    waiting.abort();
    await expect(dropped).rejects.toThrow();
    await until(queued(t.socketPath, 0));
    running.abort();
    await expect(first).rejects.toThrow();
    await until(async () => (await editorBrokerStatus(t.socketPath))?.running === null);
    expect(t.calls.filter((call) => call.startsWith("tour"))).toHaveLength(1);
    // Stopped before its frames, its copies closed as after a failure; and no error to report.
    expect(existsSync(path.join(t.folder, "out", "a", "01.jpg"))).toBe(false);
    expect(t.calls.at(-1)).toBe("close copies");
    expect((await editorBrokerStatus(t.socketPath))?.lastError).toBeNull();
    const next = await runCaptureJob(t.job(await t.map("Gamma"), "c", [40]), { socketPath: t.socketPath });
    expect(next.end).toBe("done");
  });

  it("runs a merged tour on while any of its clients is still there", async () => {
    const hold = gate();
    const t = await setup({ before: async (request) => (request.mapPath.includes("Other") || request.mapPath.includes("Yard") ? heldUntil(hold.opened, request) : undefined) });
    await t.start();
    const [other, yard] = [await t.map("Other"), await t.map("Yard")];
    const blocker = runCaptureJob(t.job(other, "o", [40]), { socketPath: t.socketPath });
    await until(() => t.calls.some((call) => call.startsWith("tour Other")));
    const leaving = new AbortController();
    const gone = runCaptureJob(t.job(yard, "a", [41]), { socketPath: t.socketPath, signal: leaving.signal });
    await until(queued(t.socketPath, 1));
    const staying = runCaptureJob(t.job(yard, "b", [42]), { socketPath: t.socketPath });
    await until(queued(t.socketPath, 2));
    hold.open();
    await blocker;
    await until(async () => (await editorBrokerStatus(t.socketPath))?.running?.length === 2);
    leaving.abort();
    await expect(gone).rejects.toThrow();
    expect((await staying).frames).toBe(1);
    expect(t.brokerLog.some((line) => line.includes("but the tour runs on"))).toBe(true);
  });

  // 2026-11-20: a log of "queued" then "running" in the same second read as two jobs running at
  // once, since nothing said the first had ended; and a job's failure had none of its progress.
  it("logs each job's end before the next one runs, its progress lines, and a running job cancelled when its client hangs up", async () => {
    const hold = gate();
    const t = await setup({
      before: async (request) => {
        if (request.mapPath.includes("Alpha")) await heldUntil(hold.opened, request);
        if (request.mapPath.includes("Broken")) {
          request.log?.("closing a stale copy");
          throw new Error("the Editor never opened it");
        }
      },
    });
    await t.start();
    const [alpha, beta, broken] = [await t.map("Alpha"), await t.map("Beta"), await t.map("Broken")];
    const hangUp = new AbortController();
    const first = runCaptureJob(t.job(alpha, "a", [40]), { socketPath: t.socketPath, signal: hangUp.signal });
    await until(() => t.calls.some((call) => call.startsWith("tour Alpha")));
    const second = runCaptureJob(t.job(beta, "b", [50, 51]), { socketPath: t.socketPath });
    // Its rejection is expected from the start: Beta isn't held, so it can fail before the hang-up is logged.
    const third = expect(runCaptureJob(t.job(broken, "x", [40]), { socketPath: t.socketPath })).rejects.toThrow("the Editor never opened it");
    await until(queued(t.socketPath, 2));
    hangUp.abort();
    await expect(first).rejects.toThrow();
    await until(() => t.brokerLog.some((line) => line.includes("hung up")));
    hold.open();
    await second;
    await third;

    const ids = t.brokerLog.flatMap((line) => /^job (\w+) queued/.exec(line)?.[1] ?? []);
    expect(ids).toHaveLength(3);
    const [a, b, x] = ids as [string, string, string];
    const at = (line: string) => t.brokerLog.indexOf(line);
    expect(t.brokerLog).toContain(`job ${a} running; its client hung up, so it is cancelled`);
    expect(at(`cancelled ${a}: the capture was cancelled`)).toBeGreaterThan(-1);
    expect(at(`cancelled ${a}: the capture was cancelled`)).toBeLessThan(at(`running ${b}`));
    expect(t.brokerLog).toContain(`${b}: stop 2`);
    expect(at(`done ${b}: 2 frames, done`)).toBeLessThan(at(`running ${x}`));
    expect(t.brokerLog).toContain(`${x}: closing a stale copy`);
    expect(t.brokerLog).toContain(`failed ${x}: the Editor never opened it`);
  });

  it("names the checkout it was built from in its status, and a client from another checkout hears so", async () => {
    const t = await setup();
    const elsewhere = "/repos/other-worktree/packages/core/dist/cli/editor-broker.js";
    await t.start(60_000, elsewhere);
    expect((await editorBrokerStatus(t.socketPath))?.script).toBe(elsewhere);
    expect(t.brokerLog[0]).toContain(`from ${elsewhere}`);
    const lines: string[] = [];
    const mine = "/repos/this-worktree/packages/core/dist/cli/editor-broker.js";
    await runCaptureJob(t.job(await t.map("Alpha"), "a", [40]), { socketPath: t.socketPath, script: mine, log: (line) => lines.push(line) });
    expect(lines[0]).toMatch(new RegExp(`^The Editor Broker running \\(pid \\d+\\) was built from ${elsewhere}, not ${mine}`));
    // The same checkout's broker says nothing.
    const quiet: string[] = [];
    await runCaptureJob(t.job(await t.map("Beta"), "b", [40]), { socketPath: t.socketPath, script: elsewhere, log: (line) => quiet.push(line) });
    expect(quiet.some((line) => line.includes("built from"))).toBe(false);
  });

  it("runs an Editor action in the queue, after the capture before it", async () => {
    const hold = gate();
    const t = await setup({ before: async (request) => (request.mapPath.includes("Alpha") ? heldUntil(hold.opened, request) : undefined) });
    await t.start();
    const [alpha, drift] = [await t.map("Alpha"), await t.map("Drift")];
    const tour = runCaptureJob(t.job(alpha, "a", [40]), { socketPath: t.socketPath });
    await until(() => t.calls.some((call) => call.startsWith("tour Alpha")));
    const save = runEditorJob({ kind: "editor", action: "editor.save", source: drift }, { socketPath: t.socketPath });
    await until(queued(t.socketPath, 1));
    expect((await editorBrokerStatus(t.socketPath))?.queue).toEqual([expect.objectContaining({ kind: "editor", action: "editor.save", source: drift })]);
    hold.open();
    await Promise.all([tour, save]);
    expect(t.overlapped()).toBe(false);
    expect(t.calls.filter((call) => call !== "close copies").map((call) => call.replace(/ a-\w+\.SC2Map$/, ""))).toEqual(["tour Alpha", "editor.save Drift.SC2Map"]);
  });

  it("refuses an ifIdle Editor action at once while a capture runs, saying which, and queues nothing", async () => {
    const hold = gate();
    const t = await setup({ before: async (request) => heldUntil(hold.opened, request) });
    await t.start();
    const [alpha, mission] = [await t.map("Alpha"), await t.map("Mission")];
    const tour = runCaptureJob(t.job(alpha, "a", [40]), { socketPath: t.socketPath });
    await until(() => t.calls.some((call) => call.startsWith("tour Alpha")));
    const refused = runEditorJob({ kind: "editor", action: "editor.testDocument", source: mission, ifIdle: true }, { socketPath: t.socketPath });
    await expect(refused).rejects.toBeInstanceOf(EditorBusyError);
    await expect(refused).rejects.toThrow(/capture job \w+ of Alpha\.SC2Map is running/);
    expect((await editorBrokerStatus(t.socketPath))?.queue).toEqual([]);
    hold.open();
    await tour;
    expect(t.calls.some((call) => call.startsWith("editor.testDocument"))).toBe(false);
  });

  it("has test_mission's Test Document wait for a running capture, not hand the click to the author", async () => {
    const hold = gate();
    const t = await setup({ before: async (request) => heldUntil(hold.opened, request) });
    // On the socket under the host's cacheDir, where runEditorAction and runBrokeredCapture look.
    const socketPath = brokerSocketPath(t.cacheDir);
    const broker = await startEditorBroker({ host: t.host, socketPath, holdPollMs: 10 });
    brokers.push(broker!);
    const tour = runCaptureJob(t.job(await t.map("Alpha"), "a", [40]), { socketPath });
    await until(() => t.calls.some((call) => call.startsWith("tour Alpha")));
    const handoff = await testInGame(t.host, await t.map("Mission"), 30);
    expect(handoff.automated).toEqual([]);
    expect(handoff.reason).toMatch(/^The Editor is busy .*capture job \w+ of Alpha\.SC2Map is running/);
    expect(handoff.steps).toEqual(["Wait for the Editor to be free, then ask for the test again."]);
    hold.open();
    await tour;
    // Free again, it runs Test Document through the broker.
    expect((await testInGame(t.host, await t.map("Mission"), 30)).automated[0]).toContain("ran Test Document");
    expect(t.calls).toContain("editor.testDocument Mission.SC2Map");
  });

  it("holds the queue after a Test Document until its game quits, and refuses another test meanwhile", async () => {
    const t = await setup();
    await t.start();
    const [mission, alpha] = [await t.map("Mission"), await t.map("Alpha")];
    await runEditorJob({ kind: "editor", action: "editor.testDocument", source: mission, ifIdle: true }, { socketPath: t.socketPath });
    const tour = runCaptureJob(t.job(alpha, "a", [40]), { socketPath: t.socketPath });
    await until(queued(t.socketPath, 1));
    const status = await editorBrokerStatus(t.socketPath);
    expect(status?.running).toEqual([expect.objectContaining({ action: "editor.testDocument", holding: true })]);
    await expect(runEditorJob({ kind: "editor", action: "editor.testDocument", source: mission, ifIdle: true }, { socketPath: t.socketPath })).rejects.toThrow(/still running; quit it first, 1 more waiting/);
    expect(t.calls.some((call) => call.startsWith("tour"))).toBe(false);
    t.quitGame();
    expect((await tour).end).toBe("done");
    expect(t.brokerLog.some((line) => line.endsWith("the test game quit"))).toBe(true);
  });

  it("is started by the first client when none answers, once for two clients at once, and exits after the idle timeout", async () => {
    const t = await setup();
    const [alpha, beta] = [await t.map("Alpha"), await t.map("Beta")];
    let started = 0;
    const start = async () => {
      if (await t.start(200)) started++;
    };
    const [a, b] = await Promise.all([runCaptureJob(t.job(alpha, "a", [40]), { socketPath: t.socketPath, start }), runCaptureJob(t.job(beta, "b", [40]), { socketPath: t.socketPath, start })]);
    expect([a.end, b.end]).toEqual(["done", "done"]);
    expect(started).toBe(1);
    expect(t.overlapped()).toBe(false);
    expect(t.calls.filter((call) => call === "close copies")).toHaveLength(1);
    expect(await editorBrokerStatus(t.socketPath)).not.toBeNull();
    await brokers[0]!.closed;
    expect(await editorBrokerStatus(t.socketPath)).toBeNull();
  });

  // A named pipe goes away with the process that listened on it, so Windows has no socket file to take over.
  it.skipIf(process.platform === "win32")("takes over a socket a dead broker left behind", async () => {
    const t = await setup();
    const first = await t.start();
    await first!.close();
    // A crashed broker leaves its socket file; stand one in for it.
    await writeFile(t.socketPath, "");
    expect(await t.start()).not.toBeNull();
    expect(await editorBrokerStatus(t.socketPath)).not.toBeNull();
  });

  it("puts the socket under cacheDir, or in the temp folder when that path is too long for a socket", () => {
    expect(brokerUnixSocketPath("/Users/me/Library/Caches/sc2-adjutant", "/tmp")).toBe("/Users/me/Library/Caches/sc2-adjutant/editor-broker.sock");
    const long = brokerUnixSocketPath(`/x/${"a".repeat(120)}`, "/tmp");
    expect(long).toMatch(/^\/tmp\/sc2-adjutant-broker-[0-9a-f]{16}\.sock$/);
    expect(long).toBe(brokerUnixSocketPath(`/x/${"a".repeat(120)}`, "/tmp"));
    expect(brokerSocketPath("/Users/me/Library/Caches/sc2-adjutant", "darwin")).toBe(brokerUnixSocketPath("/Users/me/Library/Caches/sc2-adjutant"));
  });

  it("listens on Windows on a named pipe named for cacheDir, the same however the folder is spelled", () => {
    const pipe = brokerPipePath("C:\\Users\\me\\AppData\\Local\\sc2-adjutant");
    expect(pipe).toMatch(/^\\\\\.\\pipe\\sc2-adjutant-editor-broker-[0-9a-f]{16}$/);
    expect(brokerPipePath("c:/users/ME/AppData/Local/sc2-adjutant/")).toBe(pipe);
    expect(brokerPipePath("C:\\Users\\me\\AppData\\Local\\other")).not.toBe(pipe);
    expect(brokerSocketPath("C:\\Users\\me\\AppData\\Local\\sc2-adjutant", "win32")).toBe(pipe);
  });
});
