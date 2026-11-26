// Reading and driving the game's processes on the Mac, for the capture's game ownership (the
// logic, shared with the Windows adapter, is core's game-ownership.ts). Keys go to the game's own
// process through System Events, brought forward first.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { GameProcess, GameSystem } from "@team-antioch/sc2-adjutant/plugin-sdk";

const run = promisify(execFile);

/** The game processes in `ps -axww -o pid=,lstart=,command=` output: the start time is `lstart`'s, as printed, and only compared; the command is kept for the log. */
export function parseGames(output: string): GameProcess[] {
  const games: GameProcess[] = [];
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\w{3} \w{3}\s+\d+ \d\d:\d\d:\d\d \d{4})\s+(.*)$/.exec(line);
    // The same test pgrep made: the game's executable inside its bundle, followed by its arguments.
    if (match && match[3]!.includes("MacOS/SC2 ")) games.push({ pid: Number(match[1]), startedAt: match[2]!, command: match[3]!.trim() });
  }
  return games;
}

/** Brings the game's process forward and sends it one key (an AppleScript key spec in argv). */
export const KEY_TO_GAME = `
on run argv
  set p to (item 1 of argv) as integer
  set k to item 2 of argv
  tell application "System Events"
    set proc to first process whose unix id is p
    set frontmost of proc to true
    delay 0.3
    if not (frontmost of proc) then error "couldn't bring the game forward"
    if k is "quit" then
      keystroke "q" using {command down, option down}
    else
      keystroke k
    end if
  end tell
end run`;

/** The key that answers Yes in the game's Confirm Exit dialog. Needs a real run to confirm. */
export const YES_KEY = "y";

/** The real machine: `ps`, System Events keystrokes (Cmd+Option+Q, then Yes) to the game's process, and SIGKILL on its pid. */
export const macSystem: GameSystem = {
  async list() {
    const { stdout } = await run("ps", ["-axww", "-o", "pid=,lstart=,command="], { env: { ...process.env, LC_ALL: "C" }, maxBuffer: 16 * 1024 * 1024 });
    return parseGames(stdout);
  },
  requestQuit: async (pid) => void (await run("osascript", ["-e", KEY_TO_GAME, String(pid), "quit"])),
  confirmQuit: async (pid) => void (await run("osascript", ["-e", KEY_TO_GAME, String(pid), YES_KEY])),
  async kill(pid) {
    process.kill(pid, "SIGKILL");
  },
  sleep: (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
};
