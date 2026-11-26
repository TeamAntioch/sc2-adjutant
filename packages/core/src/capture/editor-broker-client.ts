// A client of the Editor Broker (src/capture/editor-broker.ts, spec #637): every editor.captureTour
// run goes through here, so the Editor runs one capture at a time however many agents ask, and on
// a machine that captures, so does every other Editor action that clicks its menus (open, Test
// Document, save: runEditorAction), so none of them lands in the middle of a capture. A job
// is plain data, since it crosses a Unix socket (a named pipe on Windows): the broker makes the capture copy itself, under
// the job's own name, and runs the tour on it. The first client to find no broker starts one,
// detached; the broker exits after 10 minutes idle.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Host } from "../host/host.js";
import { hostContext } from "../host/machine-config.js";
import type { CaptureTourRequest, CaptureTourResult, GameProcess } from "../plugins/plugin-api.js";
import type { CaptureCopyOptions } from "./capture-copy.js";

/** The protocol both ends speak; a broker built from another version refuses the job. 2: editor jobs. 3: a Test Document's bank fixture. 4: the games it recorded, in its status. 5: a capture result's games and start time, for its logs. 6: quitOtherGames, which an older broker would drop. */
export const BROKER_PROTOCOL = 6;

/** The Editor actions the broker runs between captures: each clicks the Editor's menus or brings it forward. */
export const BROKERED_EDITOR_ACTIONS = ["editor.open", "editor.refresh", "editor.testDocument", "editor.save"] as const;
export type BrokeredEditorAction = (typeof BROKERED_EDITOR_ACTIONS)[number];

/** How a tour is captured: the frames' naming and size, how long to wait for the game, and whether a game already running is quit. */
export type TourSettings = Pick<CaptureTourRequest, "frameDigits" | "recordKeys" | "width" | "quality" | "startSeconds" | "pressSpaceAfterSeconds" | "video" | "quitOtherGames">;

/**
 * A capture job. `tour`: a capture copy of `source` whose Triggers are the camera tour of `copy`
 * (makeCaptureCopy's options); waiting tour jobs with the same source, copy options other than
 * the stops, and settings run as one tour. `map`: the map's own script announces the stops in
 * `bank`; with `copy` the broker copies it into the capture maps folder first, else it runs
 * `source` where it is (a capture map already, or a game the author started, with `attach`).
 * Frames go to `outputDir`. `label` names the copy, beside the source's name and the job's id.
 */
export type CaptureJob =
  | {
      readonly kind: "tour";
      readonly source: string;
      readonly label: string;
      readonly copy: Omit<CaptureCopyOptions, "name">;
      readonly settings: TourSettings;
      readonly outputDir: string;
    }
  | {
      readonly kind: "map";
      readonly source: string;
      readonly label: string;
      readonly copy: boolean;
      readonly bank: string;
      readonly attach?: boolean;
      readonly settings: TourSettings;
      readonly outputDir: string;
    }
  | {
      /**
       * One Editor action on `source`, a Map Package. With `ifIdle` it is refused at once while
       * the broker has anything running or waiting, for a caller whose own time is short.
       */
      readonly kind: "editor";
      readonly action: BrokeredEditorAction;
      readonly source: string;
      readonly seconds?: number;
      readonly ifIdle?: boolean;
      /** A Test Document's bank fixture (#55): its name, and its folder, absolute. The broker copies its banks in for the run and puts the author's back. */
      readonly bankFixture?: { readonly name: string; readonly dir: string };
    };

export type CaptureJobResult = CaptureTourResult & {
  /** The capture copy the tour ran on, if the broker made one: removed when the tour finished, kept to debug when it ended early. */
  readonly copy?: string;
  /** The games this job's tour started, as the broker recorded them: the process a crash folder's `P<pid>` names. */
  readonly games?: readonly GameProcess[];
  /** When the broker began the tour (ISO), before any game of it: the earliest a game's log file of this run can be. */
  readonly startedAt?: string;
};

/** A job as the status lists it: an editor job by its action, and `holding` once its Test Document's game runs, which no capture starts under. */
export type BrokerJobSummary = {
  readonly id: string;
  readonly kind: CaptureJob["kind"];
  readonly source: string;
  readonly outputDir?: string;
  readonly stops?: number;
  readonly action?: BrokeredEditorAction;
  readonly holding?: true;
};

/** A game the broker recorded: whose it is decides whether anything may quit it. */
export type BrokerGameSummary = {
  readonly pid: number;
  /** `tool`: started by a capture, which quits it; `author`: a Test Document's, for the author to play, which the broker holds the queue for and never quits. */
  readonly owner: "tool" | "author";
  /** The job that started it. */
  readonly job: string;
};

export type BrokerStatus = {
  readonly pid: number;
  /** The script the broker runs from, naming the checkout it was built from; absent from a broker built before it was sent. */
  readonly script?: string;
  /** The jobs of the tour running now, or null. */
  readonly running: readonly BrokerJobSummary[] | null;
  readonly queue: readonly BrokerJobSummary[];
  /** The games the broker started a job for and that still run. */
  readonly games: readonly BrokerGameSummary[];
  /** The last failure: a job's (by its id), or closing capture copies' (no job). */
  readonly lastError: { readonly job?: string; readonly message: string; readonly at: string } | null;
};

/** What the broker sends a client, one JSON object a line. */
export type BrokerMessage =
  | { readonly type: "queued"; readonly id: string; readonly pid?: number; readonly script?: string }
  | { readonly type: "log"; readonly line: string }
  | { readonly type: "done"; readonly result: CaptureJobResult | null }
  /** `busy`: an ifIdle editor job refused because the broker has something running or waiting. */
  | { readonly type: "failed"; readonly message: string; readonly busy?: true }
  | { readonly type: "status"; readonly status: BrokerStatus };

/** What a client sends: a job, or a status request. */
export type ClientMessage = { readonly protocol: number } & ({ readonly type: "job"; readonly job: CaptureJob } | { readonly type: "status" });

/** The longest path macOS takes for a Unix socket is 103 bytes. */
const MAX_SOCKET_PATH = 103;

/** Where the broker for `cacheDir` listens on `platform`: a named pipe on Windows, else a Unix socket. */
export function brokerSocketPath(cacheDir: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? brokerPipePath(cacheDir) : brokerUnixSocketPath(cacheDir);
}

/** The broker's Unix socket: `editor-broker.sock` in `cacheDir`, or in `tmp`, named for `cacheDir`, when that path is too long for a socket. */
export function brokerUnixSocketPath(cacheDir: string, tmp: string = os.tmpdir()): string {
  const inCache = path.posix.join(cacheDir, "editor-broker.sock");
  if (Buffer.byteLength(inCache) <= MAX_SOCKET_PATH) return inCache;
  const hash = createHash("sha256").update(path.posix.resolve(cacheDir)).digest("hex").slice(0, 16);
  return path.posix.join(tmp, `sc2-adjutant-broker-${hash}.sock`);
}

/**
 * The broker's named pipe on Windows, named for `cacheDir`: its full path, with `/` as `\` and in
 * lower case, as Windows paths are case-insensitive, so each spelling of one folder finds one broker.
 */
export function brokerPipePath(cacheDir: string): string {
  const folder = path.win32.resolve(cacheDir).toLowerCase();
  const hash = createHash("sha256").update(folder).digest("hex").slice(0, 16);
  return `\\\\.\\pipe\\sc2-adjutant-editor-broker-${hash}`;
}

/** Whether `socketPath` is a Windows named pipe, which the OS removes when its server goes. */
export const isNamedPipe = (socketPath: string): boolean => /^[\\/]{2}[.?][\\/]pipe[\\/]/i.test(socketPath);

export type RunCaptureJobOptions = {
  readonly socketPath: string;
  /** Starts a broker when none answers; resolves once it may be listening. */
  readonly start?: () => Promise<unknown>;
  readonly log?: (line: string) => void;
  /** Called with the job's id once the broker has queued it: its status lists the job by that id. */
  readonly onQueued?: (id: string) => void;
  /** Aborting hangs up: a waiting job is dropped, and a running one cancelled once none of its clients is left. */
  readonly signal?: AbortSignal;
  /** The broker script this client would start: a broker running from another tells the client, in a log line. */
  readonly script?: string;
};

/** How long a client waits for a broker it started to answer. */
const START_SECONDS = 20;

/** Runs `job` on the broker at `socketPath`, starting one with `start` when none answers; resolves when the job is done. */
export async function runCaptureJob(job: Exclude<CaptureJob, { kind: "editor" }>, options: RunCaptureJobOptions): Promise<CaptureJobResult> {
  return (await submit(job, options)) as CaptureJobResult;
}

/** Runs an editor job on the broker at `socketPath`; runEditorAction for a host's own broker. */
export async function runEditorJob(job: Extract<CaptureJob, { kind: "editor" }>, options: RunCaptureJobOptions): Promise<void> {
  await submit(job, options);
}

/** Sends `job` and resolves with what its "done" carries: a capture's result, or null for an editor job. */
async function submit(job: CaptureJob, options: RunCaptureJobOptions): Promise<CaptureJobResult | null> {
  const socket = await connectOrStart(options.socketPath, options.start);
  return new Promise<CaptureJobResult | null>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", hangUp);
      socket.destroy();
      fn();
    };
    const hangUp = () => settle(() => reject(new Error("the capture job was cancelled")));
    if (options.signal?.aborted) return hangUp();
    options.signal?.addEventListener("abort", hangUp);
    readLines(socket, (message: BrokerMessage) => {
      if (message.type === "queued") {
        // Every checkout shares the one broker, as they share the one Editor; one built elsewhere runs the job all the same.
        if (options.script && message.script && message.script !== options.script) {
          options.log?.(`The Editor Broker running (pid ${message.pid}) was built from ${message.script}, not ${options.script}: it runs this job with that checkout's capture code`);
        }
        options.onQueued?.(message.id);
      }
      else if (message.type === "log") options.log?.(message.line);
      else if (message.type === "done") settle(() => resolve(message.result));
      else if (message.type === "failed") settle(() => reject(message.busy ? new EditorBusyError(message.message) : new Error(message.message)));
    });
    socket.on("error", (error) => settle(() => reject(error)));
    socket.on("close", () => settle(() => reject(new Error("the Editor Broker went away before the capture finished"))));
    socket.write(`${JSON.stringify({ protocol: BROKER_PROTOCOL, type: "job", job } satisfies ClientMessage)}\n`);
  });
}

/** The broker's status, or null when none answers at `socketPath`. Never starts one. */
export async function editorBrokerStatus(socketPath: string): Promise<BrokerStatus | null> {
  const socket = await connect(socketPath).catch(() => null);
  if (!socket) return null;
  return new Promise<BrokerStatus | null>((resolve) => {
    readLines(socket, (message: BrokerMessage) => {
      if (message.type === "status") {
        socket.destroy();
        resolve(message.status);
      }
    });
    socket.on("error", () => resolve(null));
    socket.on("close", () => resolve(null));
    socket.write(`${JSON.stringify({ protocol: BROKER_PROTOCOL, type: "status" } satisfies ClientMessage)}\n`);
  });
}

/**
 * Runs `job` through the broker for `host`'s machine: the one on the socket under its cacheDir,
 * started detached when none answers. The broker loads the machine's Host Adapter itself, from
 * the same machine config.
 */
export function runBrokeredCapture(host: Host, job: Exclude<CaptureJob, { kind: "editor" }>, options: Pick<RunCaptureJobOptions, "log" | "onQueued" | "signal"> = {}): Promise<CaptureJobResult> {
  const cacheDir = hostContext(host.machine).requirePath("cacheDir");
  return runCaptureJob(job, { ...options, socketPath: brokerSocketPath(cacheDir), start: () => spawnBroker(host, cacheDir), script: brokerScript() });
}

/** An ifIdle Editor action refused because a capture runs or waits: the author should wait, not do it by hand. */
export class EditorBusyError extends Error {
  override readonly name = "EditorBusyError";
}

/**
 * Runs an Editor action on `mapPath` through the broker for `host`'s machine, between captures,
 * when the host can capture; else straight on the host, where no capture can be running. With
 * `ifIdle` it fails at once, saying what the broker is doing, rather than wait its turn.
 */
export async function runEditorAction(
  host: Host,
  action: BrokeredEditorAction,
  request: { readonly mapPath: string; readonly seconds?: number; readonly bankFixture?: { readonly name: string; readonly dir: string } },
  options: { readonly ifIdle?: boolean; readonly log?: (line: string) => void } = {},
): Promise<void> {
  if (!host.has("editor.captureTour")) {
    await host.run(action, request);
    return;
  }
  const cacheDir = hostContext(host.machine).requirePath("cacheDir");
  const job: Extract<CaptureJob, { kind: "editor" }> = { kind: "editor", action, source: request.mapPath, ...(request.seconds !== undefined ? { seconds: request.seconds } : {}), ...(request.bankFixture ? { bankFixture: request.bankFixture } : {}), ...(options.ifIdle ? { ifIdle: true } : {}) };
  await runEditorJob(job, { socketPath: brokerSocketPath(cacheDir), start: () => spawnBroker(host, cacheDir), script: brokerScript(), ...(options.log ? { log: options.log } : {}) });
}

/** The broker's script in this checkout's build: what a client starts, and what a broker reports it runs from. */
export const brokerScript = (): string => fileURLToPath(new URL("../cli/editor-broker.js", import.meta.url));

/** Starts the broker as a detached process, its output in `<cacheDir>/editor-broker.log`. */
async function spawnBroker(host: Host, cacheDir: string): Promise<void> {
  mkdirSync(cacheDir, { recursive: true });
  const out = openSync(path.join(cacheDir, "editor-broker.log"), "a");
  const child = spawn(process.execPath, [brokerScript()], {
    detached: true,
    // Detached on Windows, it would otherwise get a console window of its own.
    windowsHide: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, SC2_ADJUTANT_MACHINE_CONFIG: host.machine.file },
  });
  child.unref();
  // The child has its own copy of the log's descriptor.
  closeSync(out);
}

async function connectOrStart(socketPath: string, start: (() => Promise<unknown>) | undefined): Promise<net.Socket> {
  const first = await connect(socketPath).catch((error: unknown) => error as Error);
  if (first instanceof net.Socket) return first;
  if (!start) throw new Error(`No Editor Broker answers at ${socketPath}: ${first.message}`);
  await start();
  for (let waited = 0; ; waited += 0.1) {
    const socket = await connect(socketPath).catch(() => null);
    if (socket) return socket;
    if (waited >= START_SECONDS) throw new Error(`The Editor Broker never answered at ${socketPath}: see editor-broker.log in the machine's cacheDir`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export function connect(socketPath: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once("connect", () => {
      socket.off("error", reject);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

/** Calls `onMessage` with each JSON line `socket` sends; a line that isn't JSON is skipped. */
export function readLines<Message>(socket: net.Socket, onMessage: (message: Message) => void): void {
  let buffered = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffered += chunk;
    for (let end = buffered.indexOf("\n"); end >= 0; end = buffered.indexOf("\n")) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 1);
      let message: Message;
      try {
        message = JSON.parse(line) as Message;
      } catch {
        continue;
      }
      onMessage(message);
    }
  });
}
