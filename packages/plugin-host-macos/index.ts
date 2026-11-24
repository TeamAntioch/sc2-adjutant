// The macOS Host Adapter, a first-party Plugin package (#96) that core loads as bundled:host-macos: what an author's Mac can
// do with StarCraft II. It opens Map Packages in the Galaxy Editor, runs Test Document through the
// Editor's menu, saves a copy of a map there (the MapScript drift test), speaks placeholder voice lines with `say`, captures camera tours and the screen
// (capture-tour.ts), and renders and exports game models with WhiteoutFlakes (whiteoutflakes.ts).
// Every path comes from the machine config (`editorPath`, `cacheDir`, `modelViewerPath`); nothing
// about the machine is built in. It has no game.launch: the game can't be started without the Editor.
//
// Editor facts it relies on (docs/macos-host.md and the repo's docs/reference/game-testing.md have the rest):
// - The game can't be launched directly on the Mac; only the Editor's Test Document starts it.
// - An unpacked Map Package opens through its ComponentList.SC2Components file, not the folder.
// - Opening a map that is already open only brings it forward, still as it was loaded.
// - Menus exist only while the Editor is frontmost, and macOS refuses to bring it forward from the
//   background while someone is using another app. Then Test Document fails here, and the tool
//   hands that click to the author.
// - Test Document does nothing while the map is still loading (an "Activity - " window is open).
// The automation needs Accessibility permission for the app that runs the MCP server.

import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { HostContext, PluginCode } from "@team-antioch/sc2-adjutant/plugin-sdk";

import { fragmentFor, refusalFor, windowState } from "./refresh.ts";
import { banksDir, captureScreen, captureTour, closeCaptureCopies, gameRunning, listGames, quitGame } from "./capture-tour.ts";
import { exportModel, exportModelGltf, rendererKey, renderModel } from "./whiteoutflakes.ts";

const run = promisify(execFile);

/** game.logsFolder: where the game on the Mac writes its logs, under the user's Library. */
async function gameLogsFolder(): Promise<string> {
  return path.join(os.homedir(), "Library", "Application Support", "Blizzard", "StarCraft II", "GameLogs");
}

/**
 * How long to wait for the Editor to show the map and for the game to start, in seconds, when the
 * caller gives no budget of its own. Together they stay under an MCP client's usual 60 s request
 * timeout; a slower load fails here, and the tool hands the click to the author while the Editor
 * keeps loading. A caller's budget (`seconds`) is split the same way.
 */
const EDITOR_LOAD_SECONDS = 35;
const GAME_START_SECONDS = 15;

async function openInEditor({ mapPath }: { readonly mapPath: string }, context: HostContext): Promise<void> {
  const editor = context.requirePath("editorPath");
  await run("open", ["-a", editor, path.join(mapPath, "ComponentList.SC2Components")]);
}

/**
 * Clicks <menu> > <item> in the Editor window showing a map whose title contains <fragment>,
 * waiting up to <tries> seconds for the map to finish loading. Never acts on another document.
 */
const CLICK_MENU = `
on run argv
  set fragment to item 1 of argv
  set m to item 2 of argv
  set i to item 3 of argv
  set tries to (item 4 of argv) as integer
  tell application "System Events" to tell process "StarCraft II Editor"
    repeat tries times
      set loading to false
      set target to missing value
      repeat with w in windows
        try
          set n to name of w
          if n starts with "Activity - " then set loading to true
          if n contains fragment and value of attribute "AXMinimized" of w is false then set target to w
        end try
      end repeat
      if not loading and target is not missing value then
        perform action "AXRaise" of target
        set value of attribute "AXFrontmost" to true
        delay 0.8
        if (name of window 1) contains fragment then
          click menu item i of menu 1 of menu bar item m of menu bar 1
          return "clicked"
        end if
      end if
      delay 1
    end repeat
  end tell
  error "the Editor never showed the map ready to test, or couldn't be brought forward (macOS refuses while another app is in use)"
end run
`;

/** The Editor's window titles, one per line; nothing when the Editor isn't running. */
const WINDOW_NAMES = `
tell application "System Events"
  if not (exists process "StarCraft II Editor") then return ""
  set AppleScript's text item delimiters to linefeed
  return (name of windows of process "StarCraft II Editor") as text
end tell
`;

/**
 * What a window title holds for this Map Package: its whole path, so another worktree's copy of
 * the same Mission (same folder name) isn't taken for it.
 */
const titleFragment = (mapPath: string): string => path.resolve(mapPath);

/** Whether the Editor has a window on this Map Package. */
async function editorHasOpen(mapPath: string): Promise<boolean> {
  // By windowState, so a long path the Editor shortened (`/.../tail`) still counts as open; a title naming only the map's name counts too, as it can't be ruled out.
  return windowState(await editorWindowTitles(), mapPath).state !== "none";
}

async function checkClosed({ mapPath }: { readonly mapPath: string }): Promise<void> {
  if (await editorHasOpen(mapPath)) {
    throw new Error(`the Editor has ${path.basename(mapPath)} open; close it there without saving first, since rewriting a map the Editor has open can crash it`);
  }
}

async function testDocument(request: { readonly mapPath: string; readonly seconds?: number }, context: HostContext): Promise<void> {
  const fragment = titleFragment(request.mapPath);
  if (await editorHasOpen(request.mapPath)) {
    // Opening it again would only bring forward the copy the Editor loaded before this compile.
    throw new Error(`the Editor already has ${path.basename(request.mapPath)} open, as it was before this compile; close it there without saving, then test again`);
  }
  const total = request.seconds ?? EDITOR_LOAD_SECONDS + GAME_START_SECONDS;
  const gameStart = Math.max(1, Math.round((total * GAME_START_SECONDS) / (EDITOR_LOAD_SECONDS + GAME_START_SECONDS)));
  const load = Math.max(1, Math.floor(total - gameStart));
  await openInEditor(request, context);
  const before = await gamePids();
  try {
    await run("osascript", ["-e", CLICK_MENU, fragment, "File", "Test Document", String(load)]);
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`couldn't click File > Test Document in the Editor: ${stderr || (error as Error).message}`, { cause: error });
  }
  for (let second = 0; second < gameStart; second++) {
    if ((await gamePids()).some((pid) => !before.includes(pid))) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`clicked File > Test Document, but no new game started within ${gameStart} s; the Editor may be showing script errors`);
}

/**
 * Opens the Map Package, clicks File > Save once it has loaded, waits for the Editor to rewrite
 * MapScript.galaxy, then clicks File > Close (nothing is left unsaved, so there is no prompt). Only
 * for a copy made for the purpose: the save rewrites the package.
 */
async function saveInEditor(request: { readonly mapPath: string; readonly seconds?: number }, context: HostContext): Promise<void> {
  const fragment = titleFragment(request.mapPath);
  if (await editorHasOpen(request.mapPath)) {
    throw new Error(`the Editor already has ${path.basename(request.mapPath)} open; close it there without saving, then run this again`);
  }
  const script = path.join(request.mapPath, "MapScript.galaxy");
  const before = await stat(script).then((info) => info.mtimeMs, () => 0);
  const total = request.seconds ?? EDITOR_LOAD_SECONDS + GAME_START_SECONDS;
  await openInEditor(request, context);
  let saved = false;
  try {
    try {
      await run("osascript", ["-e", CLICK_MENU, fragment, "File", "Save", String(Math.max(1, total - 10))]);
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr?.trim();
      throw new Error(`couldn't click File > Save in the Editor: ${stderr || (error as Error).message}`, { cause: error });
    }
    for (let second = 0; ; second++) {
      const now = await stat(script).then((info) => info.mtimeMs, () => 0);
      if (now > before) break;
      if (second >= 10) throw new Error(`clicked File > Save, but the Editor didn't rewrite ${script} within 10 s`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    saved = true;
  } finally {
    // Closed even when the save failed, so the next run doesn't find the copy open. A failed close
    // after a failed save leaves the save's error to report.
    await run("osascript", ["-e", CLICK_MENU, fragment, "File", "Close", "10"]).catch((error: unknown) => {
      if (saved) throw error;
    });
  }
}

/** The Editor's window titles, one string each. */
async function editorWindowTitles(): Promise<string[]> {
  const { stdout } = await run("osascript", ["-e", WINDOW_NAMES]);
  return stdout.split("\n").filter(Boolean);
}

/**
 * Closes the author's map from File > Close so a compile can rewrite its package and the caller
 * reopen it (#739). It reads the Editor's window titles first and refuses, closing nothing, when
 * the title shows unsaved changes (`*`) or it can't tell the map from another copy; and when the
 * Editor can't be brought forward for its menu (macOS refuses while the author uses another app),
 * CLICK_MENU fails and nothing is clicked. It never answers a save prompt: if one appears, the map
 * stays open and the author answers it. A map the Editor doesn't have open is left as it is.
 * Needs an Editor check: nothing here has been run against the real Editor.
 */
async function refreshEditor({ mapPath }: { readonly mapPath: string }): Promise<void> {
  const state = windowState(await editorWindowTitles(), mapPath);
  const refusal = refusalFor(state, mapPath);
  if (refusal) throw new Error(refusal);
  if (state.state === "none") return;
  try {
    const shown = state.state === "clean" ? state.titles[0]! : "";
    await run("osascript", ["-e", CLICK_MENU, fragmentFor(shown, mapPath), "File", "Close", "10"]);
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`couldn't click File > Close in the Editor, so ${path.basename(mapPath)} is still open: ${stderr || (error as Error).message}`, { cause: error });
  }
  for (let second = 0; second < 5; second++) {
    if (!(await editorHasOpen(mapPath))) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`clicked File > Close, but the Editor still has ${path.basename(mapPath)} open; a save prompt may be showing, so answer it yourself (Don't Save keeps what is on disk)`);
}

/** The ids of the running game processes. */
async function gamePids(): Promise<string[]> {
  try {
    return (await listGames()).map((game) => String(game.pid));
  } catch {
    return [];
  }
}

/** `say` into AIFF, then `afconvert` to 16-bit mono WAV at 22050 Hz, which SC2 plays. */
async function speak({ text, voice, outputPath }: { readonly text: string; readonly voice?: string; readonly outputPath: string }): Promise<void> {
  const work = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-tts-"));
  try {
    const textFile = path.join(work, "line.txt");
    const aiff = path.join(work, "line.aiff");
    await writeFile(textFile, text);
    await run("say", [...(voice ? ["-v", voice] : []), "-o", aiff, "-f", textFile]);
    await run("afconvert", ["-f", "WAVE", "-d", "LEI16@22050", "-c", "1", aiff, outputPath]);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const plugin: PluginCode = {
  capabilities: {
    "editor.open": openInEditor,
    "editor.checkClosed": checkClosed,
    "editor.refresh": refreshEditor,
    "editor.testDocument": testDocument,
    "editor.save": saveInEditor,
    "editor.captureTour": captureTour,
    "editor.closeCaptureCopies": closeCaptureCopies,
    "game.running": gameRunning,
    "game.banksDir": banksDir,
    "game.list": listGames,
    "game.quit": quitGame,
    "game.logsFolder": gameLogsFolder,
    "screen.capture": captureScreen,
    "tts.speak": speak,
    "model.render": renderModel,
    "model.rendererKey": rendererKey,
    "model.export": exportModel,
    "model.exportGltf": exportModelGltf,
  },
};
export default plugin;
