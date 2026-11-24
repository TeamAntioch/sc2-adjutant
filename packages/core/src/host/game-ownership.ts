// Which games a capture may quit, and how, for both Host Adapters. The Editor Broker records each
// game a job starts as its pid and start time (a pid is reused once its process exits); a capture
// quits only a game it recorded, by pid, never every game process, since the author may be playing
// one. The quit is the game's own, so it writes its logs on the way out: a quit request (Mac:
// Cmd+Option+Q; Windows: close the window), then Yes in its Confirm Exit dialog; the process is
// killed only if it hasn't exited by a timeout. All of it runs against a `GameSystem`, which the
// adapters give their machine's and the tests a fake process table.

import { FOREIGN_GAME_REFUSAL, type GameProcess } from "../plugins/plugin-api.js";

/** What quitting a game does to the machine. */
export type GameSystem = {
  /** Every running game, with the start time the machine reports. */
  readonly list: () => Promise<GameProcess[]>;
  /** Asks this game to quit: the key or the window close that brings up its Confirm Exit dialog. */
  readonly requestQuit: (pid: number) => Promise<void>;
  /** Presses Yes in this game's Confirm Exit dialog. */
  readonly confirmQuit: (pid: number) => Promise<void>;
  /** Ends this process at once. */
  readonly kill: (pid: number) => Promise<void>;
  readonly sleep: (seconds: number) => Promise<void>;
};

/** How long the game may take to go after Yes, in seconds, before its process is killed. */
export const QUIT_GRACE_SECONDS = 20;
/** How long the dialog may take to show after the quit request, in seconds. */
const DIALOG_SECONDS = 1.5;
const POLL_SECONDS = 0.5;

export const sameGame = (a: GameProcess, b: GameProcess): boolean => a.pid === b.pid && a.startedAt === b.startedAt;

/** Whether this exact process (the pid and its start time) still runs: a reused pid isn't it. */
export async function stillRuns(game: GameProcess, system: GameSystem): Promise<boolean> {
  return (await system.list()).some((each) => sameGame(each, game));
}

/** Rejects with the refusal when any game runs: a capture that isn't attaching never quits one it didn't start. */
export async function refuseForeignGame(system: GameSystem): Promise<void> {
  if ((await system.list()).length > 0) throw new Error(FOREIGN_GAME_REFUSAL);
}

/**
 * The game a capture started, once there is one. Before the capture starts any, none ran
 * (refuseForeignGame), so the first game that appears is its own: recorded through `onStarted`, and
 * from then on the only one `running` asks about.
 */
export function ownedGame(system: GameSystem, onStarted?: (game: GameProcess) => void) {
  let own: GameProcess | undefined;
  return {
    /** The game, once found. */
    game: (): GameProcess | undefined => own,
    /** Whether the game this capture started runs; false while it hasn't started one. */
    async running(): Promise<boolean> {
      const games = await system.list();
      if (!own) {
        own = games[0];
        if (own) onStarted?.(own);
      }
      return own !== undefined && games.some((each) => sameGame(each, own!));
    },
  };
}

/**
 * Quits this game and no other, gracefully: the quit request, then Yes, then up to `graceSeconds` for it
 * to exit, then SIGKILL on its pid if it is still the same process. "gone" when no process matches
 * the pid and start time; "closed" when it exited on its own; "killed" after the timeout. Logs which.
 */
export async function quitOwnedGame(game: GameProcess, system: GameSystem, log: (line: string) => void, graceSeconds = QUIT_GRACE_SECONDS): Promise<"closed" | "killed" | "gone"> {
  if (!(await stillRuns(game, system))) {
    log(`game ${game.pid} isn't running (or its pid was reused): left alone`);
    return "gone";
  }
  const attempt = async (what: string, press: (pid: number) => Promise<void>) => {
    try {
      await press(game.pid);
    } catch (error) {
      log(`couldn't send ${what} to game ${game.pid}: ${(error as Error).message}`);
    }
  };
  await attempt("the quit request", system.requestQuit);
  await system.sleep(DIALOG_SECONDS);
  if (await stillRuns(game, system)) await attempt("Yes", system.confirmQuit);
  for (let waited = 0; waited < graceSeconds; waited += POLL_SECONDS) {
    if (!(await stillRuns(game, system))) {
      log(`game ${game.pid} quit gracefully (quit request, then Yes)`);
      return "closed";
    }
    await system.sleep(POLL_SECONDS);
  }
  // Checked again at the last moment: a process that exited and whose pid was reused isn't ours to kill.
  if (!(await stillRuns(game, system))) {
    log(`game ${game.pid} quit gracefully (quit request, then Yes)`);
    return "closed";
  }
  log(`game ${game.pid} still running ${graceSeconds} s after the quit request and Yes: killing it`);
  await system.kill(game.pid).catch((error: unknown) => log(`couldn't kill game ${game.pid}: ${(error as Error).message}`));
  await system.sleep(1);
  return "killed";
}

