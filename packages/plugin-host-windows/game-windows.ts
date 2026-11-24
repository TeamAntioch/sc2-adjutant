// Finding the StarCraft II game on Windows, from the editor helper's window list (helpers/editor.cs),
// and how game.launch starts it. Pure, so it's tested without the game.
//
// Seen on build 98310, 2026-11-18 (docs/windows-host.md has more):
// - `Support\SC2Switcher.exe -run "<absolute map path>" -displaymode 0` starts the game on a map
//   with no Editor and no Battle.net: the switcher starts `Versions\Base<build>\SC2.exe` (or
//   SC2_x64.exe) and exits. Windowed (0), since fullscreen loses its D3D device in a VM.
// - The game's main window is a visible top-level window of class "StarCraft II", titled
//   "StarCraft II".

import path from "node:path";

import type { GameProcess } from "@team-antioch/sc2-adjutant/plugin-sdk";

import { editorState, GAME_PROCESSES, isEditorProcess, type MenuItem, type TopWindow } from "./editor-windows.ts";

/**
 * The flags the Editor's Test Document starts the game with besides the map and window mode
 * (docs/reference/game-testing.md §1): preload on, cheats off, and the reload check.
 */
export const EDITOR_TEST_FLAGS = ["-preload", "1", "-NoUserCheats", "-reloadcheck"] as const;

/** How game.launch starts the game on a map: the install's SC2Switcher, windowed. */
export function switcherLaunch(sc2Path: string, mapPath: string): { readonly exe: string; readonly args: readonly string[] } {
  return { exe: path.join(sc2Path, "Support", "SC2Switcher.exe"), args: ["-run", mapPath, "-displaymode", "0", ...EDITOR_TEST_FLAGS] };
}

/** The running games from `editor games` output: a process id and its UTC start time a line, tab-separated. */
export function parseGames(stdout: string): GameProcess[] {
  return stdout.split(/\r?\n/).flatMap((line) => {
    const [pid, startedAt] = line.split("\t");
    return pid && startedAt && /^\d+$/.test(pid) ? [{ pid: Number(pid), startedAt: startedAt.trim() }] : [];
  });
}

const isGameProcess = (name: string): boolean => GAME_PROCESSES.some((game) => game.toLowerCase() === name.toLowerCase());

/** The game's visible top-level windows, 32- or 64-bit. */
export const gameWindows = (windows: readonly TopWindow[]): TopWindow[] =>
  windows.filter((window) => window.visible && window.owner === "0" && isGameProcess(window.process) && window.className === "StarCraft II");

/**
 * The windows whose menus captureTarget needs: with no game window, the Editor's visible windows
 * with a menu bar, among which is its main window. With a game window, none.
 */
export const editorMenuWindows = (windows: readonly TopWindow[]): string[] =>
  gameWindows(windows).length > 0 ? [] : windows.filter((window) => window.visible && window.hasMenu && isEditorProcess(window.process)).map((window) => window.hwnd);

/**
 * The window screen.capture captures: the game's, else the Editor's main window, found as
 * editor-windows.ts finds it, by File > Test Document in its menu (`menus`, by hwnd).
 */
export function captureTarget(windows: readonly TopWindow[], menus: ReadonlyMap<string, readonly MenuItem[]>): { readonly hwnd: string; readonly what: "the game" | "the Editor" } | undefined {
  const game = gameWindows(windows)[0];
  if (game) return { hwnd: game.hwnd, what: "the game" };
  const editor = editorState(windows, menus).mainWindows[0];
  return editor && { hwnd: editor.hwnd, what: "the Editor" };
}

/** The image format for a capture's output path: JPEG or PNG, by its extension. */
export function captureFormat(outputPath: string): "jpeg" | "png" {
  const extension = path.extname(outputPath).toLowerCase();
  if (extension === ".png") return "png";
  if (extension === ".jpg" || extension === ".jpeg") return "jpeg";
  throw new Error(`screen.capture writes JPEG (.jpg, .jpeg) or PNG (.png), not ${outputPath}`);
}
