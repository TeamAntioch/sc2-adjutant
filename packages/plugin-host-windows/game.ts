// game.launch and screen.capture on Windows: starting the game on a map with no Editor, through the
// install's SC2Switcher, and capturing the game's window (else the Editor's) with
// Windows.Graphics.Capture (helpers/capture.cs). game-windows.ts finds the windows;
// docs/windows-host.md has the facts behind both.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import type { HostContext } from "@team-antioch/sc2-adjutant/plugin-sdk";

import { GAME_PROCESSES, type MenuItem, parseMenu, parseWindows, type TopWindow } from "./editor-windows.ts";
import { captureFormat, captureTarget, editorMenuWindows, gameWindows, switcherLaunch } from "./game-windows.ts";
import { deadline, helper, runHelper, sleep } from "./helpers.ts";

/** How long the game's window may take to appear once the switcher runs, in seconds. */
const GAME_WINDOW_SECONDS = 30;

/** The capture helper's exit status for a minimized window (helpers/capture.cs). */
export const MINIMIZED = 5;

/** Whether a helper run failed because the window was minimized. */
export const wasMinimized = (error: unknown): boolean => ((error as Error).cause as { code?: unknown } | undefined)?.code === MINIMIZED;

/** How long one capture may take: the helper waits up to 5 s for a frame and 10 s to copy it. */
const CAPTURE_SECONDS = 30;

export const topWindows = async (editor: string): Promise<TopWindow[]> => parseWindows(await runHelper(editor, ["windows"]));

/** These windows' menus, by hwnd; a window whose menu can't be read has none. */
export async function editorMenus(editor: string, hwnds: readonly string[]): Promise<Map<string, MenuItem[]>> {
  return new Map(await Promise.all(hwnds.map(async (hwnd) => [hwnd, parseMenu(await runHelper(editor, ["menu", hwnd]).catch(() => ""))] as const)));
}

/**
 * The ids of the running game processes, 32- or 64-bit, whether or not they have a window yet, in
 * one helper run. Rejects when the helper fails: that is no answer, not "no game".
 */
export async function gamePids(editor: string): Promise<string[]> {
  return (await runHelper(editor, ["pids", ...GAME_PROCESSES])).split(/\r?\n/).filter(Boolean);
}

/** How many checks in a row may fail in a poll before the poll gives up. */
export const MAX_FAILED_CHECKS = 3;

/**
 * A check for a poll that rides out isolated failures: a failed check reads as undefined (unknown),
 * and only `MAX_FAILED_CHECKS` failures in a row reject, with the last one's error.
 */
export function tolerantCheck<T>(check: () => Promise<T>, maxFailures = MAX_FAILED_CHECKS): () => Promise<T | undefined> {
  let failures = 0;
  return async () => {
    try {
      const result = await check();
      failures = 0;
      return result;
    } catch (error) {
      if (++failures >= maxFailures) throw error;
      return undefined;
    }
  };
}

/** The first answer a tolerant check gives, trying again at once after a failure. */
export async function firstAnswer<T>(check: () => Promise<T | undefined>): Promise<T> {
  for (;;) {
    const answer = await check();
    if (answer !== undefined) return answer;
  }
}

/** How long the game may take to go once stopped, in seconds. */
const QUIT_SECONDS = 10;

/** Stops every running game process, 32- or 64-bit, and waits for them to go. */
export async function quitGame(editor: string): Promise<void> {
  const late = deadline(QUIT_SECONDS);
  const check = tolerantCheck(() => gamePids(editor));
  for (let pids = await firstAnswer(check); pids.length > 0; pids = await firstAnswer(check)) {
    if (late()) throw new Error(`the game (pid ${pids.join(", ")}) was still running ${QUIT_SECONDS} s after it was stopped`);
    for (const pid of pids) {
      try {
        process.kill(Number(pid));
      } catch {
        // Gone already, or exiting.
      }
    }
    await sleep(0.5);
  }
}

/**
 * Starts the game on a Map Package with no Editor: `Support\SC2Switcher.exe -run "<map>"
 * -displaymode 0`, windowed. Resolves once the game's window is up; the map is still loading then.
 * Refuses while a game runs, even one with no window yet.
 */
export async function launchGame(request: { readonly mapPath: string }, context: HostContext): Promise<void> {
  const mapPath = path.resolve(request.mapPath);
  const { exe, args } = switcherLaunch(context.requirePath("sc2Path"), mapPath);
  if (!existsSync(exe)) throw new Error(`No SC2Switcher at ${exe}: set sc2Path to the StarCraft II install folder`);
  if (!existsSync(mapPath)) throw new Error(`No map at ${mapPath}`);
  const editor = await helper(context, "editor");
  if ((await gamePids(editor)).length > 0) throw new Error("a game is already running; quit it, then launch again");
  const child = spawn(exe, args, { cwd: path.dirname(exe), detached: true, stdio: "ignore" });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", (error) => reject(new Error(`couldn't start ${exe}: ${error.message}`, { cause: error })));
  });
  // The switcher exits once it has started the game; exiting with an error status means it didn't.
  let exited = false;
  let failed: number | undefined;
  child.once("exit", (code) => {
    exited = true;
    if (code !== 0 && code !== null) failed = code;
  });
  child.unref();
  let started = false;
  let gone = 0;
  const pids = tolerantCheck(() => gamePids(editor));
  const end = Date.now() + GAME_WINDOW_SECONDS * 1000;
  while (Date.now() < end) {
    await sleep(1);
    if (gameWindows(await topWindows(editor)).length > 0) return;
    // A check that failed tells nothing either way.
    const found = await pids();
    if (found === undefined) continue;
    const running = found.length > 0;
    if (failed !== undefined && !running) throw new Error(`SC2Switcher exited with status ${failed} and started no game on ${path.basename(mapPath)}`);
    // A game that started and is gone for two looks running (not one process handing over to
    // another) quit, or crashed, before showing a window.
    gone = exited && started && !running ? gone + 1 : 0;
    if (gone >= 2) throw new Error(`the game started on ${path.basename(mapPath)}, then exited before showing a window; its log is in Documents\\StarCraft II\\GameLogs`);
    started ||= running;
  }
  throw new Error(`ran SC2Switcher on ${path.basename(mapPath)}, but no game window appeared within ${GAME_WINDOW_SECONDS} s`);
}

/**
 * Captures the game's window, else the Editor's main window, as JPEG or PNG by the output path's
 * extension. The window may be covered by others, but not minimized: then it refuses.
 */
export async function captureScreen(request: { readonly outputPath: string }, context: HostContext): Promise<void> {
  const format = captureFormat(request.outputPath);
  const outputPath = path.resolve(request.outputPath);
  const editor = await helper(context, "editor");
  const windows = await topWindows(editor);
  const target = captureTarget(windows, await editorMenus(editor, editorMenuWindows(windows)));
  if (!target) throw new Error("neither the game nor the Editor has a window to capture");
  const capture = await helper(context, "capture");
  await mkdir(path.dirname(outputPath), { recursive: true });
  // Written beside the output and renamed into place, so a capture killed partway leaves no half image.
  const draft = `${outputPath}.${process.pid}.draft`;
  try {
    // Bounded: a wedged graphics device can block the helper outside its own frame wait.
    await runHelper(capture, ["capture", target.hwnd, draft, format], CAPTURE_SECONDS);
    await rename(draft, outputPath);
  } catch (error) {
    await rm(draft, { force: true });
    if (wasMinimized(error)) {
      throw new Error(`${target.what}'s window is minimized, and Windows can't capture a minimized window; restore it (other windows may cover it), then capture again`, { cause: error });
    }
    throw error;
  }
}
