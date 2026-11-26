// The Editor Broker (spec #637): the one process that owns the Host Adapter's editor.captureTour,
// so the one Editor, menu bar and frontmost window run one capture at a time. Clients
// (editor-broker-client.ts) send jobs over a Unix socket, or a named pipe on Windows; jobs run first come first served, and
// waiting tour jobs with the same source map, lighting and settings run as one tour, their frames
// split back to each job. Each job's capture copy has its own name, the broker makes it, and it
// closes every capture copy the Editor still has open when it starts and after a failed job. A
// waiting job whose client hangs up is dropped; a running tour is cancelled once every client of
// it has hung up (one of a merged tour's clients going isn't enough). It exits after `idleMs`
// with nothing to do. The display is kept awake by editor.captureTour itself while a tour runs.
// It runs the other Editor actions that click menus (open, Test Document, save) as jobs too, in
// the same queue; after a Test Document it holds the queue until that game quits (game.list, else
// game.running). It records each game a job starts, by pid and start time: a capture's is the
// tool's, quit by pid and gracefully once the job ends or fails (game.quit); a Test Document's is the
// author's to play, never quit, and a capture refuses while any game it didn't start runs, unless
// its settings say quitOtherGames (effect-tour capture --quit-other-games, for unattended runs):
// then the host quits every game first, logging each, and a Test Document game the queue is held
// for is quit too (game.quit), so the hold ends. An editor job marked ifIdle is refused while anything
// runs or waits, with what that is, for test_mission, which can't wait out a capture.
// Its log has each job's start, end and progress lines, so one job's "running" always follows the
// last one's "done" or "failed": the record of what the Editor was doing when a capture went wrong.

import { existsSync } from "node:fs";
import { appendFile, copyFile, cp, mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

import type { Host } from "../host/host.js";
import { hostContext } from "../host/machine-config.js";
import { CAPTURE_MAPS_FOLDER, type CaptureTourRequest, type GameProcess } from "../plugins/plugin-api.js";
import { discardBankRun, finishBankRun, restoreBankRun, snapshotBanks, unrestoredFixtureRun, type BankRun } from "./bank-snapshots.js";
import { makeCaptureCopy, TOUR_BANK } from "./capture-copy.js";
import {
  BROKER_PROTOCOL,
  type BrokerGameSummary,
  type BrokerJobSummary,
  type BrokerMessage,
  type BrokerStatus,
  type CaptureJob,
  type CaptureJobResult,
  type ClientMessage,
  connect,
  isNamedPipe,
  readLines,
} from "./editor-broker-client.js";

/** How long a broker waits with nothing to do before it exits: 10 minutes. */
export const BROKER_IDLE_MS = 10 * 60 * 1000;
/** The most stops one tour holds (makeCaptureCopy's limit), so the most a merged tour takes. */
const MAX_TOUR_STOPS = 1024;

export type EditorBrokerOptions = {
  /** The host whose editor.captureTour the broker runs. */
  readonly host: Host;
  readonly socketPath: string;
  /** How long it waits idle before it exits; BROKER_IDLE_MS by default. */
  readonly idleMs?: number;
  /** The broker's own progress lines. */
  readonly log?: (line: string) => void;
  /** The script it runs from, which names the checkout it was built from: in its status, and told to a client from another. */
  readonly script?: string;
  /** How often it asks whether the game a Test Document started still runs; 5 seconds by default. */
  readonly holdPollMs?: number;
};

export type EditorBroker = {
  readonly socketPath: string;
  /** Resolves once the broker has stopped listening: after the idle timeout, or `close`. */
  readonly closed: Promise<void>;
  status(): BrokerStatus;
  close(): Promise<void>;
};

/** A game a job started: the tool's (a capture's, quit by the broker) or the author's (a Test Document's, never quit by it). */
type GameRecord = BrokerGameSummary & { readonly game: GameProcess };

const sameGame = (a: GameProcess, b: GameProcess): boolean => a.pid === b.pid && a.startedAt === b.startedAt;

type Entry = {
  readonly id: string;
  readonly job: CaptureJob;
  readonly send: (message: BrokerMessage) => void;
};

/**
 * Starts a broker on `socketPath`, or resolves null when another broker answers there: of two
 * started at once, one binds the socket and the other finds it answering. A socket file no broker
 * answers on (one that crashed) is taken over.
 */
export async function startEditorBroker(options: EditorBrokerOptions): Promise<EditorBroker | null> {
  const { host, socketPath } = options;
  const idleMs = options.idleMs ?? BROKER_IDLE_MS;
  const log = options.log ?? (() => undefined);
  const queue: Entry[] = [];
  const sockets = new Set<net.Socket>();
  let running: Entry[] | null = null;
  /** Aborted to cancel the running tour, once every one of its clients has hung up. */
  let cancel: AbortController | null = null;
  const hungUp = new Set<Entry>();
  /** Set while the queue waits for the game a Test Document job started to quit. */
  let holding = false;
  /** Every game a job started that may still run, by who owns it. Only a tool's is ever quit. */
  let games: GameRecord[] = [];
  const holdPollMs = options.holdPollMs ?? 5000;
  let lastError: BrokerStatus["lastError"] = null;
  let pumping = false;
  let idle: NodeJS.Timeout | undefined;
  let closing: Promise<void> | undefined;
  let seq = 0;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => (resolveClosed = resolve));

  const server = await claimSocket(socketPath, (socket) => {
    sockets.add(socket);
    // A client connected isn't idle: its job may be on its way.
    clearTimeout(idle);
    let entry: Entry | undefined;
    const send = (message: BrokerMessage) => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
    };
    socket.on("error", () => undefined);
    socket.on("close", () => {
      sockets.delete(socket);
      // A waiting job whose client hung up is dropped; a running tour no client is left for is cancelled.
      const waiting = entry ? queue.indexOf(entry) : -1;
      if (waiting >= 0) {
        queue.splice(waiting, 1);
        log(`job ${entry!.id} dropped: its client hung up`);
      } else if (entry && running?.includes(entry)) {
        hungUp.add(entry);
        if (running.every((each) => hungUp.has(each))) {
          log(`job ${entry.id} running; its client hung up, so it is cancelled`);
          cancel?.abort();
        } else log(`job ${entry.id} running; its client hung up, but the tour runs on for the jobs merged with it`);
      }
      armIdle();
    });
    readLines(socket, (message: ClientMessage) => {
      if (message.protocol !== BROKER_PROTOCOL) {
        send({ type: "failed", message: `The Editor Broker running (pid ${process.pid}) speaks protocol ${BROKER_PROTOCOL}, not ${message.protocol}: let it idle out, or stop it` });
        return;
      }
      if (message.type === "status") send({ type: "status", status: status() });
      else if (message.type === "job" && !entry) {
        if (message.job.kind === "editor" && message.job.ifIdle && (running || queue.length > 0)) {
          log(`refused ${message.job.action} on ${message.job.source}: busy`);
          send({ type: "failed", message: busyMessage(), busy: true });
          return;
        }
        entry = { id: `${Date.now().toString(36)}${(seq++).toString(36)}`, job: message.job, send };
        queue.push(entry);
        log(`job ${entry.id} queued: ${message.job.source}`);
        send({ type: "queued", id: entry.id, pid: process.pid, ...(options.script ? { script: options.script } : {}) });
        void pump();
      }
    });
  });
  if (!server) return null;
  log(`listening on ${socketPath} (pid ${process.pid}${options.script ? `, from ${options.script}` : ""})`);

  // Copies an earlier broker left open would be tested in place of new ones of the same name.
  const recovered = closeCopies("on start");
  armIdle();

  function summary(entry: Entry): BrokerJobSummary {
    const { job } = entry;
    if (job.kind === "editor") return { id: entry.id, kind: job.kind, source: job.source, action: job.action, ...(holding && running?.includes(entry) ? { holding: true as const } : {}) };
    const stops = job.kind === "tour" ? job.copy.stops?.length : undefined;
    return { id: entry.id, kind: job.kind, source: job.source, outputDir: job.outputDir, ...(stops !== undefined ? { stops } : {}) };
  }

  /** What an ifIdle job is told: what runs, or the test game held for, and how many wait. */
  function busyMessage(): string {
    const head = running?.[0];
    const what = !head
      ? "a job is starting"
      : head.job.kind === "editor"
        ? holding
          ? `the game ${path.basename(head.job.source)}'s Test Document started is still running; quit it first`
          : `${head.job.action} on ${path.basename(head.job.source)} is running`
        : `capture job ${head.id} of ${path.basename(head.job.source)} is running`;
    const waiting = queue.length ? `, ${queue.length} more waiting` : "";
    return `The Editor is busy (Editor Broker pid ${process.pid}): ${what}${waiting}. npm run capture-shots -- --status shows the queue; try again once it's done, or cancel a capture no one needs (capture_shots({ job, cancel: true })).`;
  }

  function status(): BrokerStatus {
    return {
      pid: process.pid,
      ...(options.script ? { script: options.script } : {}),
      running: running ? running.map(summary) : null,
      queue: queue.map(summary),
      games: games.map(({ pid, owner, job }) => ({ pid, owner, job })),
      lastError,
    };
  }

  /** The running games, or null when the host can't list them. Records of games that have gone are dropped. */
  async function listGames(): Promise<GameProcess[] | null> {
    if (!host.has("game.list")) return null;
    try {
      const list = await host.run("game.list", {});
      games = games.filter((record) => list.some((each) => sameGame(each, record.game)));
      return list;
    } catch (error) {
      log(`couldn't list the games: ${(error as Error).message}`);
      return null;
    }
  }

  /** Quits the games a capture started, by pid and start time, gracefully; an author's test game is never touched. */
  async function quitToolGames(): Promise<void> {
    for (const record of games.filter((each) => each.owner === "tool")) {
      try {
        const how = await host.run("game.quit", { game: record.game, log: (line) => log(`quitting game ${record.pid}: ${line}`) });
        log(`game ${record.pid} of job ${record.job}: ${how}`);
      } catch (error) {
        lastError = { job: record.job, message: `quitting game ${record.pid}: ${(error as Error).message}`, at: new Date().toISOString() };
        log(lastError.message);
      }
      games = games.filter((each) => each !== record);
    }
  }

  async function closeCopies(why: string): Promise<void> {
    if (!host.has("editor.closeCaptureCopies")) return;
    const own = games.filter((record) => record.owner === "tool").map((record) => record.game);
    try {
      await host.run("editor.closeCaptureCopies", { log: (line) => log(`closing copies ${why}: ${line}`), ...(own.length ? { games: own } : {}) });
      // Quit by it, or gone: the tool's records are done either way.
      games = games.filter((record) => record.owner !== "tool");
    } catch (error) {
      lastError = { message: `closing capture copies ${why}: ${(error as Error).message}`, at: new Date().toISOString() };
      log(lastError.message);
    }
  }

  function armIdle(): void {
    clearTimeout(idle);
    if (closing || running || queue.length > 0 || sockets.size > 0) return;
    idle = setTimeout(() => {
      log("idle; exiting");
      void close();
    }, idleMs);
    idle.unref();
  }

  async function pump(): Promise<void> {
    clearTimeout(idle);
    if (pumping) return;
    pumping = true;
    try {
      await recovered;
      for (let head = queue.shift(); head; head = queue.shift()) {
        const batch = [head, ...takeMerging(head, queue)];
        running = batch;
        cancel = new AbortController();
        const { signal } = cancel;
        const ids = batch.map((entry) => entry.id).join(" + ");
        log(`running ${ids}`);
        if (head.job.kind === "editor") {
          await runEditorJob(head, head.job);
          for (const entry of batch) hungUp.delete(entry);
          running = null;
          cancel = null;
          continue;
        }
        try {
          // A game an earlier job left running that was a capture's is quit first; any other game is left for the host to refuse.
          await listGames();
          await quitToolGames();
          const startedAt = new Date().toISOString();
          const started: GameProcess[] = [];
          const ran = await runBatch(host, batch, (line) => log(`${head.id}: ${line}`), signal, (game) => {
            started.push(game);
            games.push({ game, pid: game.pid, owner: "tool", job: head.id });
            log(`${head.id}: started game ${game.pid}, the tool's to quit`);
          });
          const results = ran.map((result) => ({ ...result, games: started, startedAt }));
          await quitToolGames();
          log(`done ${ids}: ${results.map((result) => result.frames).join(" + ")} frames, ${results[0]!.end}`);
          batch.forEach((entry, i) => entry.send({ type: "done", result: results[i]! }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (signal.aborted) log(`cancelled ${ids}: ${message}`);
          else {
            lastError = { job: ids, message, at: new Date().toISOString() };
            log(`failed ${ids}: ${message}`);
          }
          for (const entry of batch) entry.send({ type: "failed", message });
          // The copy is closed unsaved even when the tour failed before it could close it.
          await closeCopies(`after job ${head.id} ${signal.aborted ? "was cancelled" : "failed"}`);
          await quitToolGames();
        }
        for (const entry of batch) hungUp.delete(entry);
        running = null;
        cancel = null;
      }
    } finally {
      pumping = false;
      armIdle();
    }
  }

  /** Runs one Editor action; after a Test Document, holds the queue until its game quits. */
  async function runEditorJob(entry: Entry, job: Extract<CaptureJob, { kind: "editor" }>): Promise<void> {
    const record = (line: string) => log(`${entry.id}: ${line}`);
    let snapshot: { readonly cacheDir: string; readonly run: BankRun } | undefined;
    try {
      snapshot = job.action === "editor.testDocument" ? await snapshotBanksBefore(job.source, record, job.bankFixture) : undefined;
    } catch (error) {
      // A bank fixture that can't go in, or the author's banks not yet back from the last one: the game doesn't start.
      const message = error instanceof Error ? error.message : String(error);
      log(`failed ${entry.id}: ${message}`);
      entry.send({ type: "failed", message });
      return;
    }
    const before = job.action === "editor.testDocument" ? await listGames() : null;
    try {
      await host.run(job.action, { mapPath: job.source, ...(job.seconds !== undefined ? { seconds: job.seconds } : {}) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`failed ${entry.id}: ${message}`);
      // The game never started, so a fixture's banks must not stay in the folder; a run on the author's own banks changed nothing.
      if (snapshot?.run.fixture !== undefined) await restoreBankRun(snapshot.cacheDir, snapshot.run).catch((restoreError: unknown) => record(`couldn't put the author's banks back: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}; bank_changes will try again`));
      else if (snapshot) await discardBankRun(snapshot.cacheDir, snapshot.run.id).catch(() => undefined);
      entry.send({ type: "failed", message });
      return;
    }
    log(`done ${entry.id}: ${job.action}`);
    entry.send({ type: "done", result: null });
    if (job.action !== "editor.testDocument") return;
    // The games this Test Document started are the author's to play: recorded as theirs, never quit.
    const after = before ? await listGames() : null;
    const started = before && after ? after.filter((game) => !before.some((each) => sameGame(each, game))) : [];
    for (const game of started) {
      games.push({ game, pid: game.pid, owner: "author", job: entry.id });
      record(`game ${game.pid} started: the author's, never quit by the broker`);
    }
    if (!before && !host.has("game.running")) return;
    if (before && started.length === 0) {
      // No game of its own to wait for (it never started, or already quit): the banks are as the run left them.
      if (snapshot) await recordBankChanges(snapshot, record);
      return;
    }
    const stillPlaying = async (): Promise<boolean> => (before ? ((await listGames()) ?? []).some((game) => started.some((each) => sameGame(each, game))) : host.run("game.running", {}));
    holding = true;
    record("holding the queue until the test game quits");
    // Each held game is asked to quit once, for a waiting job that says quitOtherGames; one that outlives it is held for as before.
    const askedToQuit = new Set<GameProcess>();
    let toldUnlisted = false;
    try {
      while (!closing && (await stillPlaying())) {
        const asker = queue.find((each) => each.job.kind !== "editor" && each.job.settings.quitOtherGames);
        if (asker && !before && !toldUnlisted) {
          toldUnlisted = true;
          record(`job ${asker.id} asks to quit the test game (quitOtherGames), but the Host Adapter can't list games, so which one is unknown: still holding`);
        }
        if (asker) await quitHeldGames(started.filter((game) => !askedToQuit.has(game)), asker.id, askedToQuit, record);
        await new Promise((resolve) => setTimeout(resolve, holdPollMs));
      }
      record("the test game quit");
      // A closing broker leaves a fixture run `running`: bank_changes puts the author's banks back once the game has quit.
      if (snapshot && !closing) await recordBankChanges(snapshot, record);
    } catch (error) {
      // A host that can't tell any more doesn't hold the queue for ever.
      record(`stopped holding: ${(error as Error).message}`);
    } finally {
      holding = false;
      games = games.filter((record) => record.job !== entry.id);
    }
  }

  /**
   * Quits the test games the queue is held for, for job `asker`, which says quitOtherGames: an
   * unattended capture would otherwise wait as long as the author's game runs. Gracefully, then by
   * kill (game.quit), each game's pid logged. A host that can't quit one leaves the hold as it was.
   */
  async function quitHeldGames(held: readonly GameProcess[], asker: string, asked: Set<GameProcess>, record: (line: string) => void): Promise<void> {
    for (const game of held) {
      asked.add(game);
      if (!host.has("game.quit")) {
        record(`job ${asker} asks to quit game ${game.pid} (quitOtherGames), but the Host Adapter can't quit a game: still holding`);
        continue;
      }
      record(`quitting game ${game.pid}, the author's test game the queue is held for, for job ${asker} (quitOtherGames)`);
      try {
        const how = await host.run("game.quit", { game, log: (line) => record(`quitting game ${game.pid}: ${line}`) });
        record(`game ${game.pid}: ${how}`);
      } catch (error) {
        record(`couldn't quit game ${game.pid}: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Copies the game's Banks folder into the cache before a test game starts (#54), when the host
   * names it. A snapshot that fails never stops a test on the author's own banks: the run just goes
   * unreported. With a `fixture` (#55) it does, since the game would play on the wrong banks, and so
   * does a fixture run of an earlier test whose banks haven't been put back: its snapshot, not the
   * folder, holds the author's banks. The fixture's banks go in once the snapshot is taken.
   */
  async function snapshotBanksBefore(source: string, record: (line: string) => void, fixture?: { readonly name: string; readonly dir: string }): Promise<{ readonly cacheDir: string; readonly run: BankRun } | undefined> {
    if (!host.has("game.banksDir")) {
      if (fixture) throw new Error(`Not played: bank fixture ${fixture.name} needs the Host Adapter to name the game's Banks folder (game.banksDir)`);
      return undefined;
    }
    try {
      const cacheDir = hostContext(host.machine).requirePath("cacheDir");
      const earlier = await unrestoredFixtureRun(cacheDir);
      if (earlier) {
        // Put back now if its game is known to have quit; else the folder can't be trusted as the author's.
        const quit = host.has("game.running") && !(await host.run("game.running", {}).catch(() => true));
        if (quit) await finishBankRun(cacheDir, earlier);
        else throw new BankFixtureError(`Not played: the last test game ran on the bank fixture ${earlier.fixture}, and the author's own banks aren't back in the Banks folder yet. Quit that game, then call bank_changes${host.has("game.running") ? "" : " with rollbackAll"} to put them back.`);
      }
      const run = await snapshotBanks(cacheDir, await host.run("game.banksDir", {}), source, new Date(), fixture);
      record(`snapshot of the banks ${run.id}${fixture ? `, bank fixture ${fixture.name} copied in` : ""}`);
      return { cacheDir, run };
    } catch (error) {
      if (fixture || error instanceof BankFixtureError) throw error;
      record(`no banks snapshot: ${(error as Error).message}`);
      return undefined;
    }
  }

  /** Once the test game has quit, records which banks it changed; bank_changes reports them. */
  async function recordBankChanges(snapshot: { readonly cacheDir: string; readonly run: BankRun }, record: (line: string) => void): Promise<void> {
    try {
      const finished = await finishBankRun(snapshot.cacheDir, snapshot.run);
      record(finished.changes.length === 0 ? "the test game changed no banks" : `the test game changed ${finished.changes.length} bank${finished.changes.length === 1 ? "" : "s"}: ${finished.changes.map((change) => `${change.bank} (${change.status})`).join(", ")}`);
    } catch (error) {
      record(`couldn't record the banks the test game changed: ${(error as Error).message}`);
    }
  }

  function close(): Promise<void> {
    closing ??= (async () => {
      clearTimeout(idle);
      await new Promise<void>((resolve) => {
        server!.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      });
      resolveClosed();
    })();
    return closing;
  }

  return { socketPath, closed, status, close };
}

/** What two tour jobs must share to run as one tour: everything but their stops, cameras' values and frame names. Null for a job that runs alone. */
function mergeKey(job: CaptureJob): string | null {
  if (job.kind !== "tour" || !job.copy.stops) return null;
  const { stops: _, cameras, ...copy } = job.copy;
  const { frameDigits: __, ...settings } = job.settings;
  return canonical({ source: path.resolve(job.source), copy, cameras: cameras !== undefined, settings });
}

/** The waiting jobs that run with `head`, taken out of `queue`, up to a tour's most stops. */
function takeMerging(head: Entry, queue: Entry[]): Entry[] {
  const key = mergeKey(head.job);
  if (key === null) return [];
  let stops = stopCount(head.job);
  const taken: Entry[] = [];
  for (let i = 0; i < queue.length; ) {
    const entry = queue[i]!;
    if (mergeKey(entry.job) === key && stops + stopCount(entry.job) <= MAX_TOUR_STOPS) {
      stops += stopCount(entry.job);
      taken.push(entry);
      queue.splice(i, 1);
    } else i++;
  }
  return taken;
}

const stopCount = (job: CaptureJob): number => (job.kind === "tour" ? (job.copy.stops?.length ?? 0) : 0);

/** Runs one tour for the batch's jobs, all alike but their stops; each job's result. Its progress lines go to each job's client and to `record`, the broker's log. */
async function runBatch(host: Host, batch: readonly Entry[], record: (line: string) => void, signal: AbortSignal, onGameStarted: (game: GameProcess) => void): Promise<CaptureJobResult[]> {
  const head = batch[0]!;
  const { job } = head;
  if (job.kind === "editor") throw new Error("an editor job isn't a tour");
  const maps = path.join(hostContext(host.machine).requirePath("cacheDir"), CAPTURE_MAPS_FOLDER);
  const copyName = `${path.basename(job.source, ".SC2Map")} ${job.label}-${head.id}.SC2Map`;
  const merged = batch.length > 1;
  // A merged tour writes its frames to a scratch folder first, to be split back to each job.
  const scratch = path.join(path.dirname(maps), "broker", head.id);
  const outputDir = merged ? scratch : job.outputDir;
  const frameDigits = merged ? 4 : job.settings.frameDigits;
  const log = (line: string) => {
    record(line);
    for (const entry of batch) entry.send({ type: "log", line });
  };

  let mapPath: string;
  let copy: string | undefined;
  let writeMap: (() => Promise<unknown>) | undefined;
  let bank: string;
  if (job.kind === "tour") {
    copy = mapPath = path.join(maps, copyName);
    const jobs = batch.map((entry) => entry.job as Extract<CaptureJob, { kind: "tour" }>);
    const stops = job.copy.stops ? jobs.flatMap((each) => each.copy.stops ?? []) : undefined;
    const cameras = job.copy.cameras ? jobs.flatMap((each) => each.copy.cameras ?? []) : undefined;
    writeMap = () => makeCaptureCopy(job.source, maps, { ...job.copy, name: copyName, ...(stops ? { stops } : {}), ...(cameras ? { cameras } : {}) });
    bank = TOUR_BANK;
  } else {
    bank = job.bank;
    if (job.copy) {
      copy = mapPath = path.join(maps, copyName);
      const target = mapPath;
      writeMap = async () => {
        await rm(target, { recursive: true, force: true });
        await mkdir(maps, { recursive: true });
        await cp(job.source, target, { recursive: true });
      };
    } else mapPath = job.source;
  }

  // A merged tour's video would be one recording of every job's stops; only a tour of one job records.
  const { video, ...settings } = job.settings;
  const request: CaptureTourRequest = {
    mapPath,
    bank,
    outputDir,
    ...settings,
    ...(video && !merged ? { video } : {}),
    frameDigits,
    ...(writeMap ? { writeMap } : {}),
    ...(job.kind === "map" && job.attach ? { attach: true } : {}),
    log,
    signal,
    onGameStarted,
  };
  let results: CaptureJobResult[];
  let end: CaptureJobResult["end"];
  try {
    const result = await host.run("editor.captureTour", request);
    end = result.end;
    results = merged ? await splitFrames(scratch, batch, result.end) : [result];
  } finally {
    if (merged) await rm(scratch, { recursive: true, force: true });
  }
  // The Host Adapter closed the copy unsaved; a finished one isn't needed again. One that stopped
  // early stays, to open and debug.
  if (copy && end === "done") await rm(copy, { recursive: true, force: true });
  return results.map((each) => (copy ? { ...each, copy } : each));
}

/** A merged tour's job: tours only merge with tours. */
/** The banks aren't in a state to start a test game on. */
class BankFixtureError extends Error {}

const capture = (entry: Entry) => entry.job as Exclude<CaptureJob, { kind: "editor" }>;

/** Moves a merged tour's frames, and its stops.txt lines, to each job's folder, numbered from 1 for each job. */
async function splitFrames(scratch: string, batch: readonly Entry[], end: CaptureJobResult["end"]): Promise<CaptureJobResult[]> {
  const owners: { entry: Entry; stop: number }[] = [];
  for (const entry of batch) for (let stop = 1; stop <= stopCount(entry.job); stop++) owners.push({ entry, stop });
  const lines = existsSync(path.join(scratch, "stops.txt")) ? (await readFile(path.join(scratch, "stops.txt"), "utf8")).split("\n").filter(Boolean) : [];
  const files = existsSync(scratch) ? new Set(await readdir(scratch)) : new Set<string>();
  const frames = new Map<Entry, number>(batch.map((entry) => [entry, 0]));
  for (const [i, { entry, stop }] of owners.entries()) {
    const frame = `${String(i + 1).padStart(4, "0")}.jpg`;
    if (!files.has(frame)) continue;
    const job = capture(entry);
    await mkdir(job.outputDir, { recursive: true });
    await move(path.join(scratch, frame), path.join(job.outputDir, `${String(stop).padStart(job.settings.frameDigits, "0")}.jpg`));
    frames.set(entry, frames.get(entry)! + 1);
  }
  for (const line of lines) {
    const [global, ...rest] = line.split(" ");
    const owner = owners[Number(global) - 1];
    if (!owner) continue;
    await mkdir(capture(owner.entry).outputDir, { recursive: true });
    await appendFile(path.join(capture(owner.entry).outputDir, "stops.txt"), `${[owner.stop, ...rest].join(" ")}\n`);
  }
  return batch.map((entry) => ({ frames: frames.get(entry)!, end }));
}

/** Renames a file, copying it where the two folders are on different volumes. */
async function move(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}

/** JSON with each object's keys sorted, so two jobs alike compare equal however their fields were ordered. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_, each: unknown) =>
    each && typeof each === "object" && !Array.isArray(each) ? Object.fromEntries(Object.entries(each).sort(([a], [b]) => a.localeCompare(b))) : each,
  );
}

/** Whether a broker answers at `socketPath`. */
const answers = (socketPath: string): Promise<boolean> =>
  connect(socketPath).then(
    (socket) => {
      socket.destroy();
      return true;
    },
    () => false,
  );

const listen = (socketPath: string, onConnection: (socket: net.Socket) => void): Promise<net.Server> =>
  new Promise((resolve, reject) => {
    const server = net.createServer(onConnection);
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve(server);
    });
  });

/** How old a stale-socket lock may get before it is taken for one a crashed broker left. */
const STALE_LOCK_MS = 10_000;

/**
 * Binds `socketPath`, or resolves null when another broker answers there. A socket file nothing
 * answers on is removed and bound again, by one broker at a time (a lock folder beside it), so two
 * brokers taking it over at once can't each unlink the other's.
 */
async function claimSocket(socketPath: string, onConnection: (socket: net.Socket) => void): Promise<net.Server | null> {
  if (isNamedPipe(socketPath)) return claimPipe(socketPath, onConnection);
  await mkdir(path.dirname(socketPath), { recursive: true });
  const lock = `${socketPath}.lock`;
  // Long enough to outlast a lock a crashed broker left, which is taken over once it's stale.
  for (const deadline = Date.now() + STALE_LOCK_MS * 2; Date.now() < deadline; ) {
    try {
      return await listen(socketPath, onConnection);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
    if (await answers(socketPath)) return null;
    try {
      await mkdir(lock);
    } catch {
      const age = await stat(lock).then((info) => Date.now() - info.mtimeMs, () => 0);
      if (age > STALE_LOCK_MS) await rm(lock, { recursive: true, force: true });
      await new Promise((resolve) => setTimeout(resolve, 25));
      continue;
    }
    try {
      if (await answers(socketPath)) return null;
      await rm(socketPath, { force: true });
      try {
        return await listen(socketPath, onConnection);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
      }
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
  throw new Error(`Couldn't bind the Editor Broker's socket ${socketPath}`);
}

/**
 * Listens on the Windows named pipe `pipePath`, or resolves null when another broker answers
 * there. Windows removes a pipe when its server goes, even by a crash, so there is nothing to take
 * over: a pipe in use that doesn't answer is a broker on its way out, waited for.
 */
async function claimPipe(pipePath: string, onConnection: (socket: net.Socket) => void): Promise<net.Server | null> {
  for (const deadline = Date.now() + STALE_LOCK_MS; Date.now() < deadline; ) {
    try {
      return await listen(pipePath, onConnection);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
    if (await answers(pipePath)) return null;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Couldn't listen on the Editor Broker's pipe ${pipePath}`);
}
