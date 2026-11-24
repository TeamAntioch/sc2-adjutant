// Which games a capture may quit, and how: against a fake process table and a fake machine, so
// nothing real is quit. A pid is trusted only with its start time.
import { describe, expect, it } from "vitest";

import { type GameSystem, ownedGame, quitOwnedGame, refuseForeignGame } from "../../src/host/game-ownership.js";
import type { GameProcess } from "../../src/plugins/plugin-api.js";

/** A machine with a process table. `exitsOn` is what ends a game: the quit key, or Yes; never, for a game that hangs. */
function fake(games: GameProcess[], exitsOn: "quit" | "yes" | "never" = "yes") {
  const table = [...games];
  const presses: string[] = [];
  const killed: number[] = [];
  let slept = 0;
  const remove = (pid: number) => table.splice(0, table.length, ...table.filter((game) => game.pid !== pid));
  const system: GameSystem = {
    list: async () => table.map((game) => ({ ...game })),
    requestQuit: async (pid) => {
      presses.push(`quit ${pid}`);
      if (exitsOn === "quit") remove(pid);
    },
    confirmQuit: async (pid) => {
      presses.push(`yes ${pid}`);
      if (exitsOn === "yes") remove(pid);
    },
    kill: async (pid) => {
      killed.push(pid);
      remove(pid);
    },
    sleep: async (seconds) => void (slept += seconds),
  };
  return { system, table, presses, killed, slept: () => slept };
}

const mine: GameProcess = { pid: 501, startedAt: "Tue Nov 24 10:00:00 2026" };
const authors: GameProcess = { pid: 777, startedAt: "Tue Nov 24 09:00:00 2026" };

describe("refusing a game the capture didn't start", () => {
  it("refuses while any game runs, and passes with none", async () => {
    await expect(refuseForeignGame(fake([authors]).system)).rejects.toThrow("A game is running that this tool didn't start. Quit it, or capture with `attach`.");
    await expect(refuseForeignGame(fake([]).system)).resolves.toBeUndefined();
  });
});

describe("the game a capture started", () => {
  it("is the first game to appear, recorded once, and the only one it asks about", async () => {
    const machine = fake([]);
    const started: GameProcess[] = [];
    const own = ownedGame(machine.system, (game) => started.push(game));
    expect(await own.running()).toBe(false);
    machine.table.push(mine);
    expect(await own.running()).toBe(true);
    // Another game appearing, or this one's pid reused, changes nothing about which is its own.
    machine.table.push(authors);
    expect(await own.running()).toBe(true);
    expect(started).toEqual([mine]);
    machine.table.splice(0, 1, { pid: 501, startedAt: "Tue Nov 24 11:00:00 2026" });
    expect(await own.running()).toBe(false);
  });
});

describe("quitting a game", () => {
  it("asks it to quit, then presses Yes, and kills nothing when the game exits", async () => {
    const machine = fake([mine, authors]);
    const log: string[] = [];
    expect(await quitOwnedGame(mine, machine.system, (line) => log.push(line))).toBe("closed");
    expect(machine.presses).toEqual(["quit 501", "yes 501"]);
    expect(machine.killed).toEqual([]);
    expect(machine.table).toEqual([authors]);
    expect(log).toEqual(["game 501 quit gracefully (quit request, then Yes)"]);
  });

  it("skips Yes when the game exits at the quit key", async () => {
    const machine = fake([mine], "quit");
    expect(await quitOwnedGame(mine, machine.system, () => undefined)).toBe("closed");
    expect(machine.presses).toEqual(["quit 501"]);
  });

  it("kills only that pid after the timeout, and says so", async () => {
    const machine = fake([mine, authors], "never");
    const log: string[] = [];
    expect(await quitOwnedGame(mine, machine.system, (line) => log.push(line), 5)).toBe("killed");
    expect(machine.killed).toEqual([501]);
    expect(machine.table).toEqual([authors]);
    expect(log.at(-1)).toMatch(/still running 5 s after the quit request and Yes: killing it/);
    expect(machine.slept()).toBeGreaterThanOrEqual(5);
  });

  it("leaves a process alone whose pid was reused (another start time), pressing and killing nothing", async () => {
    const machine = fake([{ pid: 501, startedAt: "Tue Nov 24 12:00:00 2026" }], "never");
    expect(await quitOwnedGame(mine, machine.system, () => undefined)).toBe("gone");
    expect(machine.presses).toEqual([]);
    expect(machine.killed).toEqual([]);
    expect(machine.table).toHaveLength(1);
  });

  it("still waits and kills when the keys can't be sent", async () => {
    const machine = fake([mine], "never");
    machine.system.requestQuit = async () => {
      throw new Error("not allowed to send keystrokes");
    };
    const log: string[] = [];
    expect(await quitOwnedGame(mine, machine.system, (line) => log.push(line), 2)).toBe("killed");
    expect(log[0]).toBe("couldn't send the quit request to game 501: not allowed to send keystrokes");
  });

  it("doesn't kill a game whose pid was taken between the wait and the kill", async () => {
    const machine = fake([mine], "never");
    let looks = 0;
    const list = machine.system.list;
    machine.system.list = async () => (++looks > 4 ? [{ pid: 501, startedAt: "someone else" }] : list());
    expect(await quitOwnedGame(mine, machine.system, () => undefined, 1)).toBe("closed");
    expect(machine.killed).toEqual([]);
  });
});
