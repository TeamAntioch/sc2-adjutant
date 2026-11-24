// How the Windows Host Adapter finds the game: how it starts it with no Editor (SC2Switcher), which
// window is the game's once it runs, and what screen.capture captures (the game's window, else the
// Editor's) and in which format. Window samples are as the helper listed them on 2026-11-18.
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseMenu, parseWindows } from "../editor-windows.ts";
import { captureFormat, captureTarget, editorMenuWindows, gameWindows, parseGames, switcherLaunch } from "../game-windows.ts";

const EDITOR = "983180\t0\t11140\tSC2Editor\t#32770\t1\t1\tTerrain - [C:/.../output/Spike.SC2Map/] - StarCraft II Editor";
const MESSAGES = "328610\t0\t11140\tSC2Editor\t#32770\t1\t1\tMessages - StarCraft II Editor";
const GAME = "67388\t0\t7500\tSC2\tStarCraft II\t1\t0\tStarCraft II";
const GAME_IME = "67390\t67388\t7500\tSC2\tIME\t0\t0\tDefault IME";
const NOTEPAD = "4242\t0\t900\tnotepad\tNotepad\t1\t1\tStarCraft II";

describe("the game on Windows", () => {
  it("reads the running games with their start times, skipping lines that aren't one", () => {
    expect(parseGames("7500\t2026-11-24T10:00:00.1234567Z\r\n8800\t2026-11-24T09:00:00.0000000Z\r\nnot a game\r\n\r\n")).toEqual([
      { pid: 7500, startedAt: "2026-11-24T10:00:00.1234567Z" },
      { pid: 8800, startedAt: "2026-11-24T09:00:00.0000000Z" },
    ]);
  });

  it("starts the game through SC2Switcher, windowed, on the map's whole path, with the flags the Editor's Test Document adds", () => {
    const install = path.join("C:", "Program Files (x86)", "StarCraft II");
    expect(switcherLaunch(install, path.join("C:", "maps", "Spike.SC2Map"))).toEqual({
      exe: path.join(install, "Support", "SC2Switcher.exe"),
      args: ["-run", path.join("C:", "maps", "Spike.SC2Map"), "-displaymode", "0", "-preload", "1", "-NoUserCheats", "-reloadcheck"],
    });
  });

  it("takes the game's visible top-level windows, 32- or 64-bit, and nothing else titled StarCraft II", () => {
    const x64 = "77001\t0\t8800\tSC2_x64\tStarCraft II\t1\t0\tStarCraft II";
    const hidden = "77002\t0\t8800\tSC2_x64\tStarCraft II\t0\t0\tStarCraft II";
    const windows = parseWindows([EDITOR, GAME, GAME_IME, NOTEPAD, x64, hidden].join("\r\n"));
    expect(gameWindows(windows).map((window) => window.hwnd)).toEqual(["67388", "77001"]);
  });

  it("captures the game's window, else the Editor's main window (the one with File > Test Document), else nothing", () => {
    const menus = new Map([
      ["983180", parseMenu("&File\t23\t0\t&Test Document\tCtrl+F9")],
      ["328610", parseMenu("&Edit\t75\t0\t&Undo\tCtrl+Z")],
      ["555", parseMenu("&Edit\t75\t0\t&Undo\tCtrl+Z")],
    ]);
    const triggers = "555\t0\t11140\tSC2Editor\t#32770\t1\t1\tTriggers - [C:/.../output/Spike.SC2Map/] - StarCraft II Editor";
    expect(captureTarget(parseWindows([MESSAGES, EDITOR, GAME, GAME_IME].join("\n")), new Map())).toEqual({ hwnd: "67388", what: "the game" });
    expect(captureTarget(parseWindows([MESSAGES, triggers, EDITOR, NOTEPAD].join("\n")), menus)).toEqual({ hwnd: "983180", what: "the Editor" });
    expect(captureTarget(parseWindows([MESSAGES, triggers, NOTEPAD].join("\n")), menus)).toBeUndefined();
    expect(captureTarget([], new Map())).toBeUndefined();
  });

  it("reads menus only of the Editor's windows that have a menu bar, when there's no game window", () => {
    expect(editorMenuWindows(parseWindows([MESSAGES, EDITOR, NOTEPAD, "459778\t0\t11140\tSC2Editor\t#32770\t0\t0\tg_osGuiModalParent"].join("\n")))).toEqual(["328610", "983180"]);
    expect(editorMenuWindows(parseWindows([EDITOR, GAME].join("\n")))).toEqual([]);
  });

  it("writes JPEG or PNG by the output path's extension, and refuses any other", () => {
    expect(captureFormat("C:\\shots\\a.png")).toBe("png");
    expect(captureFormat("C:\\shots\\a.PNG")).toBe("png");
    expect(captureFormat("C:\\shots\\a.jpg")).toBe("jpeg");
    expect(captureFormat("C:\\shots\\a.jpeg")).toBe("jpeg");
    expect(() => captureFormat("C:\\shots\\a.bmp")).toThrow("screen.capture writes JPEG (.jpg, .jpeg) or PNG (.png), not C:\\shots\\a.bmp");
    expect(() => captureFormat("C:\\shots\\a")).toThrow("not C:\\shots\\a");
  });
});
