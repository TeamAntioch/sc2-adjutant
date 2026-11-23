// A recorder for the game's ClientAPI during a Test Document run (issue #741, the combat half).
//
// The ClientAPI on 127.0.0.1:6119 answers `GET /game` with the game time and each player's
// result. What is known on the Mac is that it answers and that the time rises; whether a player's
// `result` ever leaves "Undecided" at victory or defeat is not (docs/reference/game-testing.md).
// This polls the endpoint and keeps only the moments something changed, so one run on a throwaway
// map that ends in a win and then a loss answers that question from a file.

/** One player as `/game` reports it. */
export type ProbePlayer = { readonly id: number; readonly name: string; readonly type: string; readonly result: string };

/** What a `/game` reply holds that the probe keeps. */
export type GameSnapshot = { readonly displayTime: number; readonly players: readonly ProbePlayer[]; readonly isReplay: boolean };

/** One line of the record: a change from the previous reply, or the first reply, or the end. */
export type ProbeEvent = {
  /** Seconds of wall time since the probe started. */
  readonly at: number;
  readonly kind: "first" | "players" | "result" | "stopped" | "unreachable" | "status" | "unreadable" | "unparseable";
  readonly displayTime?: number;
  /** What changed, in words: "player 1 Local Player: Undecided -> Victory". */
  readonly changes: readonly string[];
  readonly players?: readonly ProbePlayer[];
  /** For "status", "unreadable" and "unparseable": the body as received (cut at 2,000 characters). */
  readonly raw?: string;
};

/** An answer that came back but is not a usable `/game` reply: a non-OK status, or a body that is not JSON. */
export class ProbeReplyError extends Error {
  constructor(
    readonly kind: "status" | "unreadable",
    message: string,
    readonly raw?: string,
  ) {
    super(message);
  }
}

/** Reads a `/game` reply's body; refuses what is not the shape seen on the Mac (an object with a time and a player list). */
export function parseGameSnapshot(body: unknown): GameSnapshot {
  if (typeof body !== "object" || body === null) throw new Error("/game did not return an object");
  const record = body as Record<string, unknown>;
  if (typeof record.displayTime !== "number") throw new Error("/game has no numeric displayTime");
  if (!Array.isArray(record.players)) throw new Error("/game has no players list");
  const players = record.players.map((entry, index): ProbePlayer => {
    const player = (entry ?? {}) as Record<string, unknown>;
    return {
      id: typeof player.id === "number" ? player.id : index,
      name: typeof player.name === "string" ? player.name : "",
      type: typeof player.type === "string" ? player.type : "",
      result: typeof player.result === "string" ? player.result : "",
    };
  });
  return { displayTime: record.displayTime, players, isReplay: record.isReplay === true };
}

/** The differences between two replies that the record keeps: players appearing or going, and results changing. */
export function snapshotChanges(before: GameSnapshot | undefined, after: GameSnapshot): { readonly kind: "players" | "result"; readonly changes: string[] } | undefined {
  const previous = new Map((before?.players ?? []).map((player) => [player.id, player]));
  const changes: string[] = [];
  let kind: "players" | "result" = "result";
  for (const player of after.players) {
    const was = previous.get(player.id);
    if (!was) {
      kind = "players";
      changes.push(`player ${player.id} ${player.name} joined as ${player.type}, ${player.result}`);
    } else if (was.result !== player.result) changes.push(`player ${player.id} ${player.name}: ${was.result} -> ${player.result}`);
  }
  for (const gone of previous.values()) {
    if (after.players.some((player) => player.id === gone.id)) continue;
    kind = "players";
    changes.push(`player ${gone.id} ${gone.name} left`);
  }
  return changes.length ? { kind, changes } : undefined;
}

export type ProbeOptions = {
  /** The page to poll, `http://127.0.0.1:6119/game` by default. */
  readonly url?: string;
  readonly intervalMs?: number;
  /** Stop after this long, in ms. */
  readonly durationMs: number;
  /** Stop once every player has a result other than "Undecided" (and there is at least one). */
  readonly stopWhenDecided?: boolean;
  /** Called with each event as it happens, so a long run can be followed. */
  readonly onEvent?: (event: ProbeEvent) => void;
  /** Injected for tests. */
  readonly fetchJson?: (url: string) => Promise<unknown>;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
};

async function defaultFetchJson(url: string): Promise<unknown> {
  // A network failure throws out of fetch and reads as "unreachable"; anything that answered is a reply error.
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
  const text = await response.text();
  if (!response.ok) throw new ProbeReplyError("status", `HTTP ${response.status}`, text.slice(0, 2000));
  try {
    return JSON.parse(text);
  } catch {
    throw new ProbeReplyError("unreadable", "the body is not JSON", text.slice(0, 2000));
  }
}

/**
 * Polls `/game` and returns the events: the first reply, each change in who is playing or in a
 * result, one "unreachable" when the endpoint stops answering after it had (the game closed), and a
 * final "stopped". A reply it cannot use (a non-OK status, a body that is not JSON, or JSON of the wrong shape) is recorded as an event, once while it lasts, and the run goes on.
 */
export async function probeGame(options: ProbeOptions): Promise<ProbeEvent[]> {
  const url = options.url ?? "http://127.0.0.1:6119/game";
  const intervalMs = options.intervalMs ?? 1000;
  const fetchJson = options.fetchJson ?? defaultFetchJson;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const started = now();
  const events: ProbeEvent[] = [];
  const emit = (event: ProbeEvent): void => {
    events.push(event);
    options.onEvent?.(event);
  };
  const seconds = (): number => Math.round(((now() - started) / 1000) * 10) / 10;

  let last: GameSnapshot | undefined;
  let answering = false;
  let lastProblem: string | undefined;
  /** A problem is recorded once while it lasts, not once a poll. */
  const problem = (kind: "status" | "unreadable" | "unparseable", message: string, raw?: string): void => {
    const key = `${kind}:${message}:${raw ?? ""}`;
    if (key === lastProblem) return;
    lastProblem = key;
    emit({ at: seconds(), kind, changes: [message], ...(raw !== undefined ? { raw: raw.slice(0, 2000) } : {}) });
  };
  while (now() - started < options.durationMs) {
    let snapshot: GameSnapshot | undefined;
    try {
      const body = await fetchJson(url);
      answering = true;
      try {
        snapshot = parseGameSnapshot(body);
        lastProblem = undefined;
      } catch (error) {
        problem("unparseable", error instanceof Error ? error.message : String(error), JSON.stringify(body) ?? String(body));
      }
    } catch (error) {
      if (error instanceof ProbeReplyError) {
        answering = true;
        problem(error.kind, error.message, error.raw);
      } else if (answering) {
        answering = false;
        lastProblem = undefined;
        emit({ at: seconds(), kind: "unreachable", changes: ["the endpoint stopped answering"] });
        last = undefined;
      }
    }
    if (snapshot) {
      if (!last) emit({ at: seconds(), kind: "first", displayTime: snapshot.displayTime, changes: [], players: snapshot.players });
      else {
        const diff = snapshotChanges(last, snapshot);
        if (diff) emit({ at: seconds(), kind: diff.kind, displayTime: snapshot.displayTime, changes: diff.changes, players: snapshot.players });
      }
      last = snapshot;
      if (options.stopWhenDecided && snapshot.players.length > 0 && snapshot.players.every((player) => player.result !== "Undecided")) break;
    }
    await sleep(intervalMs);
  }
  emit({ at: seconds(), kind: "stopped", ...(last ? { displayTime: last.displayTime } : {}), changes: [] });
  return events;
}

/** The record as the answer to the open question: did any result leave "Undecided", and what did it become. */
export function summariseProbe(events: readonly ProbeEvent[]): string {
  const results = events.filter((event) => event.kind === "result").flatMap((event) => event.changes);
  if (!events.some((event) => event.kind === "first")) {
    const odd = events.filter((event) => event.kind === "status" || event.kind === "unreadable" || event.kind === "unparseable");
    return odd.length ? `The ClientAPI answered but never with a usable /game reply (${odd.map((event) => `${event.kind}: ${event.changes[0]}`).join("; ")}).` : "The ClientAPI never answered: no game was running, or Test Document had not started it.";
  }
  if (results.length === 0) return "The ClientAPI answered but no player's result changed: it showed liveness only, so it cannot report an outcome on this run.";
  return `Results changed: ${results.join("; ")}.`;
}
