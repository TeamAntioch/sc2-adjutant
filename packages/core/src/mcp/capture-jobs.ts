// The capture jobs capture_shots (#640) started, by job id, in the MCP server's own process. A call
// waits for its job up to a limit set below Claude Code's own wait on a tool call; past it, the
// call returns the job's id and the job runs on, its client (this process) still connected to the
// Editor Broker, so the broker keeps it. A later call with the id waits again, then collects the
// result or says where the job stands. A finished job's result is kept here for an hour, however
// often it's collected; its frames and shots.json stay in its folder after that. A job is
// cancelled by its id, or when the call waiting on it is (the author stopping the task): its run's
// signal aborts, which hangs up on the broker, so the job is dropped from the queue or stopped.

import { randomUUID } from "node:crypto";

import type { BrokerStatus } from "../capture/editor-broker-client.js";

/**
 * How long a capture_shots call waits for its job before it returns the job's id: 10 minutes.
 * Claude Code's limit on a tool call (MCP_TOOL_TIMEOUT) is about 28 hours by default, but it
 * aborts a call to a stdio server that answers nothing, no result and no progress, for 30 minutes
 * (CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT), so the wait stays well under that. A call in the main
 * conversation moves to the background after 2 minutes, so a long wait doesn't block the session.
 */
export const CAPTURE_WAIT_MS = 10 * 60 * 1000;

/** A wait limit in words, for a tool's description and its waiting reply. */
export const waitLength = (ms: number): string => (ms >= 60_000 ? `${Math.round(ms / 60_000)} minutes` : `${(ms / 1000).toFixed(1)} seconds`);

/** How long a finished job's result is kept to collect: an hour. */
export const FINISHED_KEEP_MS = 60 * 60 * 1000;

export type Settled<Result> = { readonly state: "done"; readonly result: Result } | { readonly state: "failed"; readonly message: string };

/** Where a job stands: settled, or still waiting, with the broker's id for it once queued and its last progress line. */
export type JobState<Result> = Settled<Result> | { readonly state: "waiting"; readonly brokerId?: string; readonly lastLine?: string };

/** What a job's run is given: report the broker's id for it, its progress lines, and the signal that cancels it. */
export type JobHooks = { readonly onQueued: (id: string) => void; readonly log: (line: string) => void; readonly signal: AbortSignal };

type Job<Result> = {
  readonly settled: Promise<Settled<Result>>;
  readonly cancel: AbortController;
  state: JobState<Result>;
  finishedAt?: number;
};

export type CaptureJobs<Result> = {
  /** Starts `run` as a job; its id. */
  start(run: (hooks: JobHooks) => Promise<Result>): string;
  /** Waits up to `ms` for the job, or until `signal` aborts, which cancels it; where it then stands, or undefined for a job this process doesn't have (or no longer keeps). */
  wait(id: string, ms: number, signal?: AbortSignal): Promise<JobState<Result> | undefined>;
  /** Cancels a job still waiting; false for one this process doesn't have. A settled job stays as it settled. */
  cancel(id: string): boolean;
};

export function captureJobs<Result>({ keepMs = FINISHED_KEEP_MS, now = () => Date.now() }: { readonly keepMs?: number; readonly now?: () => number } = {}): CaptureJobs<Result> {
  const jobs = new Map<string, Job<Result>>();

  const prune = () => {
    for (const [id, job] of jobs) if (job.finishedAt !== undefined && now() - job.finishedAt > keepMs) jobs.delete(id);
  };

  return {
    start(run) {
      prune();
      const id = randomUUID().slice(0, 8);
      let brokerId: string | undefined;
      let lastLine: string | undefined;
      const waiting = (): JobState<Result> => ({ state: "waiting", ...(brokerId ? { brokerId } : {}), ...(lastLine ? { lastLine } : {}) });
      const cancel = new AbortController();
      const hooks: JobHooks = {
        signal: cancel.signal,
        onQueued: (queued) => {
          brokerId = queued;
          if (job.state.state === "waiting") job.state = waiting();
        },
        log: (line) => {
          lastLine = line;
          if (job.state.state === "waiting") job.state = waiting();
        },
      };
      const settle = (settled: Settled<Result>): Settled<Result> => {
        job.state = settled;
        job.finishedAt = now();
        return settled;
      };
      const job: Job<Result> = {
        cancel,
        state: waiting(),
        // Started on the next turn, so `job` exists for the hooks however soon run calls them.
        settled: Promise.resolve().then(() =>
          run(hooks).then(
            (result) => settle({ state: "done", result }),
            (error: unknown) => settle({ state: "failed", message: error instanceof Error ? error.message : String(error) }),
          ),
        ),
      };
      jobs.set(id, job);
      return id;
    },

    async wait(id, ms, signal) {
      prune();
      const job = jobs.get(id);
      if (!job) return undefined;
      const abandon = () => job.cancel.abort();
      signal?.addEventListener("abort", abandon);
      if (signal?.aborted) abandon();
      let timer: NodeJS.Timeout | undefined;
      const timedOut = new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)));
      await Promise.race([job.settled, timedOut]);
      clearTimeout(timer);
      signal?.removeEventListener("abort", abandon);
      return job.state;
    },

    cancel(id) {
      const job = jobs.get(id);
      if (!job) return false;
      job.cancel.abort();
      return true;
    },
  };
}

/** Where a waiting job is, from the broker's status: running, its place in the queue, or starting (not queued yet). */
export function placeOf(status: BrokerStatus | null, brokerId: string | undefined): string {
  if (!brokerId) return "starting";
  // The broker went away under the job, which fails as soon as its connection closes.
  if (!status) return "the Editor Broker isn't answering";
  if (status.running?.some((job) => job.id === brokerId)) return "running";
  const place = status.queue.findIndex((job) => job.id === brokerId);
  if (place >= 0) return `${place + 1} of ${status.queue.length} in the queue`;
  // The tour is done and its frames are being named.
  return "finishing";
}
