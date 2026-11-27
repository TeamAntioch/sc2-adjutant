// How the Windows Host Adapter runs a capture tour once the game is up, without the game: reading
// the bank the map saves, naming frames, the stops.txt lines, when it presses Space and how a tour
// ends; and which of the Editor's documents are capture copies, for editor.closeCaptureCopies.
import path from "node:path";

import { describe, expect, it } from "vitest";

import { bankFile, bankValue, captureCopies, frameName, stopsLine, type TourWorld, watchTour } from "../capture-tour-windows.ts";
import { editorState, parseMenu, parseWindows } from "../editor-windows.ts";

const bank = (stop: number, x = "40.5", y = "-3") =>
  [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<Bank version="1">',
    '    <Section name="tour">',
    '        <Key name="stop">',
    `            <Value int="${stop}"/>`,
    "        </Key>",
    '        <Key name="x">',
    `            <Value fixed="${x}"/>`,
    "        </Key>",
    '        <Key name="y">',
    `            <Value fixed="${y}"/>`,
    "        </Key>",
    "    </Section>",
    "</Bank>",
  ].join("\r\n");

describe("a capture tour's bank and frames", () => {
  it("reads the stop and camera target the tour saved in its bank, with Windows line endings", () => {
    expect(bankValue(bank(12), "stop", "int")).toBe("12");
    expect(bankValue(bank(12), "x", "fixed")).toBe("40.5");
    expect(bankValue(bank(12), "y", "fixed")).toBe("-3");
    expect(bankValue(bank(-1), "stop", "int")).toBe("-1");
    expect(bankValue(bank(12), "z", "fixed")).toBeUndefined();
    expect(bankValue("", "stop", "int")).toBeUndefined();
  });

  it("finds the bank in Documents\\StarCraft II\\Banks, wherever Documents is", () => {
    expect(bankFile("C:\\Mac\\Home\\Documents", "SpikeBank")).toBe(path.join("C:\\Mac\\Home\\Documents", "StarCraft II", "Banks", "SpikeBank.SC2Bank"));
  });

  it("names a frame by its stop, zero-padded, and records the stop with its keys' values", () => {
    expect(frameName("7", 3)).toBe("007.jpg");
    expect(frameName("1234", 3)).toBe("1234.jpg");
    expect(stopsLine("7", bank(7), ["x", "y"])).toBe("7 40.5 -3\n");
    expect(stopsLine("7", bank(7), ["x", "missing"])).toBe("7 40.5 \n");
  });
});

/**
 * A game whose bank holds each of `banks` from its time (seconds after the watch starts), saved
 * then, and exits at `exitAt`. Each capture takes `captureSeconds` (0 by default) of the clock.
 */
function fakeGame(banks: readonly (readonly [number, string])[], options: { exitAt?: number; captureFails?: readonly string[]; captureSeconds?: number } = {}) {
  let now = 0;
  const frames: string[] = [];
  const discarded: string[] = [];
  const lines: string[] = [];
  const log: string[] = [];
  const spaces: number[] = [];
  const failing = new Set(options.captureFails ?? []);
  const world: TourWorld = {
    gameRunning: async () => options.exitAt === undefined || now < options.exitAt * 1000,
    readBank: async () => {
      const saved = banks.filter(([at]) => at * 1000 <= now).at(-1);
      return saved ? { text: saved[1], savedAt: saved[0] * 1000 } : { text: "" };
    },
    capture: async (frame) => {
      now += (options.captureSeconds ?? 0) * 1000;
      if (failing.delete(path.basename(frame))) return false;
      frames.push(frame);
      return true;
    },
    pressSpace: async () => {
      spaces.push(now / 1000);
    },
    record: async (line) => {
      lines.push(line);
    },
    wait: async (seconds) => {
      now += seconds * 1000;
    },
    discard: async (frame) => {
      discarded.push(frame);
    },
    now: () => now,
    log: (line) => log.push(line),
  };
  return { world, frames, discarded, lines, log, spaces };
}

const SETTINGS = { outputDir: "C:\\frames", frameDigits: 3, startSeconds: 60, pressSpaceAfterSeconds: 30 } as const;

describe("watching a capture tour", () => {
  it("captures each new stop once, records it when asked, and ends done at -1", async () => {
    const game = fakeGame([
      [1, bank(1, "10", "20")],
      [4, bank(2, "11", "21")],
      [7, bank(3, "12", "22")],
      [10, bank(-1)],
    ]);
    expect(await watchTour({ ...SETTINGS, recordKeys: ["x", "y"] }, game.world)).toEqual({ frames: 3, end: "done", late: [] });
    expect(game.frames).toEqual(["001.jpg", "002.jpg", "003.jpg"].map((frame) => path.join("C:\\frames", frame)));
    expect(game.lines).toEqual(["1 10 20\n", "2 11 21\n", "3 12 22\n"]);
    expect(game.spaces).toEqual([]);
  });

  it("writes no stops.txt lines without recordKeys", async () => {
    const game = fakeGame([
      [1, bank(1)],
      [2, bank(-1)],
    ]);
    expect(await watchTour(SETTINGS, game.world)).toEqual({ frames: 1, end: "done", late: [] });
    expect(game.lines).toEqual([]);
  });

  it("tries a stop again when its capture fails, and counts it once", async () => {
    const game = fakeGame(
      [
        [1, bank(1)],
        [5, bank(-1)],
      ],
      { captureFails: ["001.jpg"] },
    );
    expect(await watchTour(SETTINGS, game.world)).toEqual({ frames: 1, end: "done", late: [] });
    expect(game.frames).toEqual([path.join("C:\\frames", "001.jpg")]);
  });

  it("ends 'game exited' when the game quits before -1", async () => {
    const game = fakeGame([[1, bank(1)]], { exitAt: 5 });
    expect(await watchTour(SETTINGS, game.world)).toEqual({ frames: 1, end: "game exited", late: [] });
    expect(game.log).toContain("game exited at stop 1");
  });

  it("presses Space every 10 s after pressSpaceAfterSeconds with no stop, and gives up after startSeconds", async () => {
    const game = fakeGame([]);
    expect(await watchTour(SETTINGS, game.world)).toEqual({ frames: 0, end: "never started", late: [] });
    expect(game.spaces).toEqual([30, 40, 50, 60]);
    expect(game.log).toContain("the tour never started");
  });

  it("stops pressing Space once a stop comes", async () => {
    const game = fakeGame([
      [35, bank(1)],
      [80, bank(-1)],
    ]);
    expect(await watchTour(SETTINGS, game.world)).toEqual({ frames: 1, end: "done", late: [] });
    expect(game.spaces).toEqual([30]);
  });

  it("keeps watching through a bank it can't read once the tour has started, and presses no Space then", async () => {
    const game = fakeGame([
      [1, bank(1)],
      [62, ""],
      [75, bank(2)],
      [76, bank(-1)],
    ]);
    expect(await watchTour(SETTINGS, game.world)).toEqual({ frames: 2, end: "done", late: [] });
    expect(game.spaces).toEqual([]);
  });

  it("keeps a frame whose capture ends inside its stop's hold, timed from the bank's save", async () => {
    // Saved at 1 s and held 2.5 s: the poll at 1 s captures until 2.5 s, inside the hold (to 3.5 s).
    const game = fakeGame(
      [
        [1, bank(1)],
        [6, bank(-1)],
      ],
      { captureSeconds: 1.5 },
    );
    expect(await watchTour({ ...SETTINGS, holdSeconds: 2.5, recordKeys: ["x"] }, game.world)).toEqual({ frames: 1, end: "done", late: [] });
    expect(game.discarded).toEqual([]);
    expect(game.lines).toEqual(["1 40.5\n"]);
  });

  it("drops a frame whose capture ends after its stop's hold, lists the stop as late and doesn't take it again", async () => {
    // Saved at 1 s and held 2.5 s: the poll at 1 s captures until 4 s, after the camera moved on at 3.5 s.
    const game = fakeGame(
      [
        [1, bank(1)],
        [5, bank(2)],
        [12, bank(-1)],
      ],
      { captureSeconds: 3 },
    );
    expect(await watchTour({ ...SETTINGS, holdSeconds: 2.5, recordKeys: ["x"] }, game.world)).toEqual({ frames: 0, end: "done", late: [1, 2] });
    expect(game.frames).toEqual(["001.jpg", "002.jpg"].map((frame) => path.join("C:\\frames", frame)));
    expect(game.discarded).toEqual(game.frames);
    expect(game.lines).toEqual([]);
    expect(game.log).toContain("stop 1: captured 0.5 s after its hold ended, so the camera may have moved on: dropped as late");
  });

  it("drops a stop as late when its capture failed until after the hold", async () => {
    const game = fakeGame(
      [
        [1, bank(1)],
        [9, bank(-1)],
      ],
      { captureSeconds: 1.5, captureFails: ["001.jpg"] },
    );
    expect(await watchTour({ ...SETTINGS, holdSeconds: 2.5 }, game.world)).toEqual({ frames: 0, end: "done", late: [1] });
  });

  it("keeps every frame when the request gives no hold", async () => {
    const game = fakeGame(
      [
        [1, bank(1)],
        [9, bank(-1)],
      ],
      { captureSeconds: 5 },
    );
    expect(await watchTour(SETTINGS, game.world)).toEqual({ frames: 1, end: "done", late: [] });
    expect(game.discarded).toEqual([]);
  });

  it("ignores what an earlier run left in the bank until the game saves it again, when attached", async () => {
    const left = bank(-1);
    const game = fakeGame([
      [0, left],
      [3, bank(1)],
      [6, bank(-1)],
    ]);
    expect(await watchTour({ ...SETTINGS, leftover: left }, game.world)).toEqual({ frames: 1, end: "done", late: [] });
  });
});

const window = (hwnd: string, title: string) => `${hwnd}\t0\t11140\tSC2Editor\t#32770\t1\t1\t${title}`;
const FILE = "&File\t28\t0\t&Test Document\tCtrl+F9";

describe("the Editor's capture copies", () => {
  const maps = path.join("C:\\Users\\me\\AppData\\Local\\sc2-adjutant", "capture", "maps");

  it("takes each open document in this cache's capture folder, by the title's whole path or a copy on disk", () => {
    const whole = "C:/Users/me/AppData/Local/sc2-adjutant/capture/maps/Spike tour-1.SC2Map/";
    const windows = parseWindows([window("100", `Terrain - [${whole}] - StarCraft II Editor`)].join("\n"));
    const menus = new Map([
      [
        "100",
        parseMenu(
          [
            FILE,
            `&Window\t900\t1\t&1 C:/.../capture/maps/Spike tour-1.SC2Map/`,
            `&Window\t901\t0\t&2 C:/.../capture/maps/On Disk.SC2Map/`,
            `&Window\t902\t0\t&3 C:/.../capture/maps/Gone.SC2Map/`,
            `&Window\t903\t0\t&4 C:/.../output/Spike.SC2Map/`,
            `&Window\t904\t0\t&5 D:/other-cache/capture/maps/Other.SC2Map/`,
          ].join("\n"),
        ),
      ],
    ]);
    const onDisk = path.join(maps, "On Disk.SC2Map");
    expect(captureCopies(editorState(windows, menus), maps, (file) => file === onDisk)).toEqual([path.join(maps, "Spike tour-1.SC2Map"), onDisk]);
  });

  it("finds none with no Editor running", () => {
    expect(captureCopies(editorState([], new Map()), maps, () => true)).toEqual([]);
  });
});
