// editor.captureTour and editor.closeCaptureCopies on Windows: camera-tour captures driven through
// the Galaxy Editor, as on the Mac (plugin-host-macos/capture-tour.ts). Opens the capture map in the
// Editor, runs File > Test Document, captures the game's window each time the map announces a new
// stop in its bank, then quits the game and closes the map without saving. Only documents under
// <cacheDir>/capture/maps/ are ever closed or discarded. The watch itself is capture-tour-windows.ts.
//
// Windows facts it relies on (docs/windows-host.md has more):
// - The Editor's menu commands are posted to its main window (editor.ts), so nothing comes forward
//   and nobody's typing gets in the way, unlike on the Mac.
// - The game saves banks to <Documents>\StarCraft II\Banks\, and Documents may be redirected, so
//   the shell says where it is.
// - Windows.Graphics.Capture gets the game's frames while other windows cover it, but not while it's
//   minimized, so a minimized game is restored (behind whatever covers it). The display is kept awake
//   for the tour, since a sleeping display stops the game drawing.
// - A loading screen may wait for Space; pressing it brings the game forward, so only after a long wait.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { CAPTURE_MAPS_FOLDER, type CaptureTourRequest, type CaptureTourResult, type GameProcess, type HostContext, ownedGame, quitOwnedGame, refuseForeignGame } from "@team-antioch/sc2-adjutant/plugin-sdk";

import { bankFile, captureCopies, type TourWorld, watchTour } from "./capture-tour-windows.ts";
import { documentsOf } from "./editor-windows.ts";
import { activate, choose, closeDocument, type Editor, editorExe, editorHelper, launch, promptText, readEditor } from "./editor.ts";
import { firstAnswer, gamePids, tolerantCheck, topWindows, wasMinimized, windowsSystem } from "./game.ts";
import { gameWindows } from "./game-windows.ts";
import { deadline, helper, runHelper, sleep } from "./helpers.ts";

/** How long the Editor may take to open and load the capture map, in seconds: a cold Editor took a minute. */
const MAP_LOAD_SECONDS = 300;
/** How long the game may take to start once Test Document runs, in seconds. */
const GAME_START_SECONDS = 60;

const documentsFolders = new Map<string, Promise<string>>();

/** The Documents folder, as the shell has it, once a process. */
function documentsFolder(editor: Editor): Promise<string> {
  let folder = documentsFolders.get(editor.exe);
  if (!folder) {
    folder = runHelper(editor.exe, ["documents"]).then((stdout) => {
      const found = stdout.trim();
      if (!found) throw new Error("the shell has no Documents folder, where the game saves its banks");
      return found;
    });
    documentsFolders.set(editor.exe, folder);
    folder.catch(() => documentsFolders.delete(editor.exe));
  }
  return folder;
}

/** The folder the game saves its banks in (`game.banksDir`): `<Documents>\StarCraft II\Banks`. */
export async function banksDir(_request: Record<string, never>, context: HostContext): Promise<string> {
  return path.join(await documentsFolder(await editorHelper(context)), "StarCraft II", "Banks");
}

/** game.logsFolder: `<Documents>\StarCraft II\GameLogs`, Documents as the shell has it (it may be redirected). */
export async function gameLogsFolder(_request: Record<string, never>, context: HostContext): Promise<string> {
  return path.join(await documentsFolder(await editorHelper(context)), "StarCraft II", "GameLogs");
}

const isOpen = async (editor: Editor, mapPath: string): Promise<boolean> => documentsOf(await readEditor(editor), mapPath).length > 0;

/**
 * Opens the map, makes it the active document and runs File > Test Document, then waits for a new
 * game. Fails with the Editor's prompt when one comes up instead, such as script errors.
 */
async function startTest(mapPath: string, context: HostContext, editor: Editor, log: (line: string) => void): Promise<void> {
  await launch(mapPath, MAP_LOAD_SECONDS, context, editor);
  const window = await activate(mapPath, editor);
  const state = await readEditor(editor);
  const earlier = new Set(state.prompts.map((prompt) => prompt.hwnd));
  const pids = tolerantCheck(() => gamePids(editor.exe));
  const before = await firstAnswer(pids);
  await choose(editor, window, "testDocument");
  log("Test Document run");
  const late = deadline(GAME_START_SECONDS);
  for (;;) {
    await sleep(1);
    if ((await pids())?.some((pid) => !before.includes(pid))) return;
    const prompts = (await readEditor(editor)).prompts.filter((prompt) => !earlier.has(prompt.hwnd));
    if (prompts.length > 0) throw new Error(`ran File > Test Document on ${path.basename(mapPath)}, but the Editor is asking: ${await promptText(editor, prompts)}`);
    if (late()) throw new Error("the game never started");
  }
}

/**
 * Closes the map without saving, if the Editor has it open; says so when it couldn't. Leaves it
 * open while the Editor is asking something (script errors, say): a Close posted under the prompt
 * could stack a save prompt behind it.
 */
async function closeMap(mapPath: string, editor: Editor, log: (line: string) => void, earlier: ReadonlySet<string> = new Set()): Promise<void> {
  try {
    const state = await readEditor(editor);
    if (documentsOf(state, mapPath).length === 0) return;
    // Dialogs the author had open before the run aren't the map's, and don't keep it open.
    const prompts = state.prompts.filter((prompt) => !earlier.has(prompt.hwnd));
    if (prompts.length > 0) {
      log(`couldn't close ${path.basename(mapPath)}: the Editor is asking: ${await promptText(editor, prompts)}; answer it there, then close the map without saving`);
      return;
    }
    await closeDocument(mapPath, editor);
  } catch (error) {
    log(`couldn't close ${path.basename(mapPath)}: ${(error as Error).message}`);
  }
}

/** Reads the bank as it is when a watch attaches, trying again for a moment while the game writes it; undefined when there's none. */
async function bankNow(bank: string): Promise<string | undefined> {
  for (let attempt = 0; ; attempt++) {
    if (!existsSync(bank)) return undefined;
    try {
      return await readFile(bank, "utf8");
    } catch (error) {
      if (attempt >= 5) throw error;
      await sleep(0.2);
    }
  }
}

/**
 * How many game checks in a row may fail during a watch before the tour gives up: at its poll of
 * twice a second, a few seconds of a helper that won't run.
 */
export const WATCH_FAILED_CHECKS = 10;

/** The watch's world: the game's processes, the bank on disk, and the capture helper on the game's window. */
export function gameWorld(
  request: CaptureTourRequest,
  editor: Editor,
  capture: string,
  bank: string,
  leftover: string | undefined,
  log: (line: string) => void,
  /** Whether the game this capture started runs; without it, whether any game does (attaching). */
  gameUp?: () => Promise<boolean>,
): TourWorld {
  let warned = "";
  /** A capture problem, logged once until another comes up. */
  const warn = (line: string) => {
    if (line !== warned) log(line);
    warned = line;
  };
  // The game's window, found once and again only after a capture fails, so a capture costs one
  // helper run: a stop the bank moves past during a slow capture is missed.
  let window: string | undefined;
  let running = true;
  let failedChecks = 0;
  let lastBank = leftover ?? "";
  const gameWindow = async (): Promise<string | undefined> => (window ??= gameWindows(await topWindows(editor.exe))[0]?.hwnd);
  return {
    // A helper run or a read that fails says nothing: the game is taken as still running, and the
    // bank as it was last read, so a moment's failure neither ends the tour nor clears the leftover.
    // Checks that keep failing end the tour, rather than watch a game that may be gone.
    gameRunning: async () => {
      try {
        running = gameUp ? await gameUp() : (await gamePids(editor.exe)).length > 0;
        failedChecks = 0;
      } catch (error) {
        const message = `couldn't tell whether the game is still running: ${(error as Error).message}`;
        if (++failedChecks >= WATCH_FAILED_CHECKS) throw new Error(`${message} (${failedChecks} checks in a row)`, { cause: error });
        warn(message);
      }
      return running;
    },
    readBank: async () => {
      if (!existsSync(bank)) return (lastBank = "");
      try {
        lastBank = await readFile(bank, "utf8");
      } catch (error) {
        warn(`couldn't read the bank: ${(error as Error).message}`);
      }
      return lastBank;
    },
    capture: async (frame) => {
      const game = await gameWindow();
      if (!game) {
        warn(`${path.basename(frame)}: no game window to capture`);
        return false;
      }
      const shoot = () => runHelper(capture, ["frame", game, frame, String(request.quality), String(request.width)]);
      try {
        await shoot().catch(async (error: unknown) => {
          if (!wasMinimized(error)) throw error;
          // A minimized window gives no frames: shown again, behind whatever covers it.
          await runHelper(editor.exe, ["restore", game]);
          log("restored the minimized game window to capture it (it can sit behind other windows, but not minimized)");
          await sleep(0.5);
          await shoot();
        });
        return true;
      } catch (error) {
        window = undefined;
        warn(`${path.basename(frame)}: ${(error as Error).message}`);
        return false;
      }
    },
    pressSpace: async () => {
      const game = await gameWindow();
      if (game) await runHelper(editor.exe, ["space", game]).catch((error: unknown) => log(`couldn't press Space: ${(error as Error).message}`));
    },
    record: (line) => appendFile(path.join(request.outputDir, "stops.txt"), line),
    wait: async (seconds) => {
      await sleep(seconds);
    },
    now: Date.now,
    log,
  };
}

export async function captureTour(request: CaptureTourRequest, context: HostContext): Promise<CaptureTourResult> {
  const log = request.log ?? (() => undefined);
  const maps = path.join(context.requirePath("cacheDir"), CAPTURE_MAPS_FOLDER);
  const mapPath = path.resolve(request.mapPath);
  if (!request.attach && path.dirname(mapPath).toLowerCase() !== maps.toLowerCase()) {
    throw new Error(`editor.captureTour closes its map without saving, so it only takes maps in ${maps}; ${mapPath} isn't there`);
  }
  if (!request.attach) editorExe(context);
  const editor = await editorHelper(context);
  const capture = await helper(context, "capture");
  const bank = bankFile(await documentsFolder(editor), request.bank);
  await mkdir(request.outputDir, { recursive: true });
  // Keep the display awake for the whole run, as caffeinate does on the Mac: a sleeping display
  // stops the game drawing. The helper ends with this process if it isn't stopped first.
  const awake = spawn(editor.exe, ["awake", String(process.pid)], { stdio: "ignore", windowsHide: true });
  awake.on("error", (error) => log(`couldn't keep the display awake: ${error.message}`));
  // Set once this run may have opened the map or started the game; whatever ends the run then
  // quits the game and closes the map.
  let touchedEditor = false;
  // The game this capture starts, once it appears: the only one it watches or quits. Attaching, the author's game is watched and left alone.
  const system = windowsSystem(editor.exe);
  const own = ownedGame(system, request.onGameStarted);
  // Attached to a game already running, the bank may still hold an earlier run's last stop (-1);
  // that content is ignored until the game saves the bank again.
  let leftover: string | undefined;
  // The Editor's dialogs open before the run, which closing the map at its end ignores.
  let earlier: ReadonlySet<string> = new Set();
  try {
    if (request.attach) {
      if ((await firstAnswer(tolerantCheck(() => gamePids(editor.exe)))).length === 0) throw new Error("no game is running to watch");
      leftover = await bankNow(bank);
    } else {
      await rm(bank, { force: true });
      // Nothing is quit here: a game already running isn't this capture's.
      await refuseForeignGame(system);
      // A copy left open by an earlier run would be tested as it was: opening only brings it forward.
      if (await isOpen(editor, mapPath)) {
        log("closing a stale copy");
        await closeMap(mapPath, editor, log);
        if (await isOpen(editor, mapPath)) throw new Error(`a stale copy of ${path.basename(mapPath)} is still open in the Editor`);
      }
      await request.writeMap?.();
      earlier = new Set((await readEditor(editor)).prompts.map((prompt) => prompt.hwnd));
      touchedEditor = true;
      await startTest(mapPath, context, editor, log);
    }
    log("game started; it can sit behind other windows now (don't minimize it)");
    return await watchTour({ ...request, ...(leftover !== undefined ? { leftover } : {}) }, gameWorld(request, editor, capture, bank, leftover, log, request.attach ? undefined : () => own.running()));
  } finally {
    try {
      if (touchedEditor) {
        // A game that appeared since the last look is this capture's too.
        await own.running().catch(() => false);
        const game = own.game();
        if (game) await quitOwnedGame(game, system, log).catch((error: unknown) => log(`couldn't quit the game: ${(error as Error).message}`));
        await closeMap(mapPath, editor, log, earlier);
      }
    } finally {
      awake.kill();
    }
  }
}

/**
 * Closes, without saving, every capture copy the Editor has open (any document under
 * <cacheDir>/capture/maps/), after quitting the games it is given: the capture's own, which the
 * broker recorded. Another game is left running. The Editor Broker runs this as it starts and after a failed tour.
 */
export async function closeCaptureCopies(request: { readonly log?: (line: string) => void; readonly games?: readonly GameProcess[] }, context: HostContext): Promise<void> {
  const log = request.log ?? (() => undefined);
  const maps = path.join(context.requirePath("cacheDir"), CAPTURE_MAPS_FOLDER);
  const editor = await editorHelper(context);
  // Only the games the broker recorded as a capture's; one it didn't is the author's to quit.
  const system = windowsSystem(editor.exe);
  for (const game of request.games ?? []) await quitOwnedGame(game, system, log).catch((error: unknown) => log(`couldn't quit game ${game.pid}: ${(error as Error).message}`));
  const copies = captureCopies(await readEditor(editor), maps, existsSync);
  if (copies.length === 0) return;
  for (const copy of copies) {
    log(`closing ${path.basename(copy)}`);
    await closeMap(copy, editor, log);
  }
  const left = captureCopies(await readEditor(editor), maps, existsSync);
  if (left.length > 0) log(`WARNING: ${left.map((copy) => path.basename(copy)).join(", ")} still open in the Editor`);
}
