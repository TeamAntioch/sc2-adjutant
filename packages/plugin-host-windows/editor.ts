// The Editor capabilities on Windows: opening Map Packages in the Galaxy Editor, telling whether the
// Editor has one open, running Test Document through the Editor's menu, and saving a copy of a map
// there (the MapScript drift test). The capture tour (capture-tour.ts) drives the Editor with the
// same operations, exported here.
//
// Editor facts it relies on (docs/windows-host.md has the rest):
// - Use the 32-bit Support\SC2Editor.exe: Support64\SC2Editor_x64.exe hangs at startup under ARM
//   emulation. Launching it with a map while the Editor runs hands the map to the running Editor.
// - An unpacked Map Package opens through its ComponentList.SC2Components file. Opened by its
//   folder, the Editor saves it as an MPQ archive in the folder's place.
// - The Editor's menu is a native Win32 menu, so its commands are posted to its main window as
//   WM_COMMAND, with no need to bring it forward. Their ids change between sessions, so they are
//   found by label (editor-windows.ts, which also reads the window titles).
// - A save writes only what the Editor holds as changed: MapScript.galaxy only when the triggers
//   changed, or when it is missing.
// - Test Document and Save do nothing while a map loads (an "Activity - " window is open).

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import path from "node:path";

import type { HostContext } from "@team-antioch/sc2-adjutant/plugin-sdk";

import {
  documentsOf,
  editorState,
  type EditorDocument,
  type EditorState,
  isEditorProcess,
  type MenuCommands,
  parseButtons,
  parseWindows,
  savePromptFor,
} from "./editor-windows.ts";
import { editorMenus, firstAnswer, gamePids, tolerantCheck } from "./game.ts";
import { deadline, helper, runHelper, sleep } from "./helpers.ts";

/**
 * How long to wait for the Editor to show the map and for the game to start, in seconds, when the
 * caller gives no budget of its own: as on the Mac, under an MCP client's usual 60 s request
 * timeout together. A caller's budget (`seconds`) is split the same way.
 */
const EDITOR_LOAD_SECONDS = 35;
const GAME_START_SECONDS = 15;
/** How long a save and a close may take once the map is open, in seconds. */
const SAVE_SECONDS = 10;
const CLOSE_SECONDS = 10;

/** The Editor helper, for this machine's cache folder. */
export type Editor = { readonly exe: string };

export const editorHelper = async (context: HostContext): Promise<Editor> => ({ exe: await helper(context, "editor") });

/** What the Editor has open now. */
export async function readEditor(editor: Editor): Promise<EditorState> {
  const windows = parseWindows(await runHelper(editor.exe, ["windows"]));
  const withMenus = windows.filter((window) => window.visible && window.hasMenu && isEditorProcess(window.process));
  return editorState(windows, await editorMenus(editor.exe, withMenus.map((window) => window.hwnd)));
}

const post = (editor: Editor, window: string, id: number) => runHelper(editor.exe, ["post", window, String(id)]);

/** The Editor's main window, with its File menu's command ids. */
export type MainWindow = EditorState["mainWindows"][number];

const COMMAND_NAMES: Readonly<Record<keyof MenuCommands, string>> = { testDocument: "File > Test Document", save: "File > Save", close: "File > Close" };

/** Runs a File menu command on the main window's active document, as choosing it does. */
export async function choose(editor: Editor, window: MainWindow, command: keyof MenuCommands): Promise<void> {
  const id = window.commands[command];
  if (id === undefined) throw new Error(`the Editor's menu has no ${COMMAND_NAMES[command]} (the adapter reads its labels in English)`);
  await post(editor, window.hwnd, id);
}

/** The text of each of these prompts, else its title. */
export async function promptText(editor: Editor, prompts: EditorState["prompts"]): Promise<string> {
  const texts = await Promise.all(prompts.map(async (prompt) => parseButtons(await runHelper(editor.exe, ["buttons", prompt.hwnd]).catch(() => "")).text.join(" ") || prompt.title));
  return texts.join("; ");
}

/** The machine config's Editor, which must exist. */
export function editorExe(context: HostContext): string {
  const exe = context.requirePath("editorPath");
  if (!existsSync(exe)) throw new Error(`No StarCraft II Editor at ${exe} (editorPath); set it to the install's Support\\SC2Editor.exe`);
  return exe;
}

/** The fullest of the elided paths the Editor shows for these documents. */
const describeDocuments = (documents: readonly EditorDocument[]): string =>
  `as ${documents.map((document) => document.path).reduce((longest, shown) => (shown.length > longest.length ? shown : longest))}/`;

/**
 * Launches the Editor on the Map Package (through its component list) and waits up to `seconds`
 * for a loaded document that may be it. The Editor hands the map to a running Editor if there is one.
 */
export async function launch(mapPath: string, seconds: number, context: HostContext, editor: Editor): Promise<void> {
  const exe = editorExe(context);
  const components = path.join(mapPath, "ComponentList.SC2Components");
  if (!existsSync(components)) throw new Error(`${mapPath} isn't an unpacked Map Package: it has no ComponentList.SC2Components`);
  const child = spawn(exe, [components], { detached: true, stdio: "ignore" });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", (error) => reject(new Error(`couldn't start the Editor at ${exe}: ${error.message}`, { cause: error })));
  });
  child.unref();
  const late = deadline(seconds);
  for (;;) {
    const state = await readEditor(editor);
    if (!state.loading && documentsOf(state, mapPath).length > 0) return;
    if (late()) throw new Error(`the Editor didn't show ${path.basename(mapPath)} loaded within ${seconds} s${state.running ? "; it may still be loading" : ""}`);
    await sleep(1);
  }
}

/** How long the main window's title may take to name a document once the Window menu lists it, in seconds. */
const ACTIVATE_SECONDS = 10;

/**
 * Makes this map the active document of its main window, so a posted command acts on it, and
 * resolves to that window. A map that just loaded is listed in the Window menu a moment before the
 * title names it, so it waits for the title, and chooses the map from the Window menu only while
 * another document is in front.
 */
export async function activate(mapPath: string, editor: Editor): Promise<MainWindow> {
  const late = deadline(ACTIVATE_SECONDS);
  let chosen = false;
  for (;;) {
    const state = await readEditor(editor);
    const documents = documentsOf(state, mapPath);
    const active = documents.find((document) => document.active);
    const window = active && state.mainWindows.find((main) => main.hwnd === active.window);
    if (window) return window;
    const listed = documents.find((document) => document.menuId !== undefined);
    if (!listed || late()) break;
    const another = state.documents.some((document) => document.window === listed.window && document.active);
    if (another && !chosen) {
      await post(editor, listed.window, listed.menuId!);
      chosen = true;
    }
    await sleep(0.5);
  }
  throw new Error(`couldn't make ${path.basename(mapPath)} the Editor's active document, to run its menu on it`);
}

export async function openInEditor(request: { readonly mapPath: string }, context: HostContext): Promise<void> {
  editorExe(context);
  // With no game to wait for, the whole budget goes to loading: a cold start alone took 36 s.
  await launch(path.resolve(request.mapPath), EDITOR_LOAD_SECONDS + GAME_START_SECONDS, context, await editorHelper(context));
}

export async function checkClosed(request: { readonly mapPath: string }, context: HostContext): Promise<void> {
  const mapPath = path.resolve(request.mapPath);
  const state = await readEditor(await editorHelper(context));
  refuseUnreadable(state, mapPath);
  const open = documentsOf(state, mapPath);
  if (open.length > 0) {
    throw new Error(
      `the Editor has ${path.basename(mapPath)} open (${describeDocuments(open)}); close it there without saving first, since rewriting a map the Editor has open can crash it`,
    );
  }
}

/** Errs the safe way: an Editor whose documents can't be read may have the map open. */
function refuseUnreadable(state: EditorState, mapPath: string): void {
  if (state.unreadable) {
    throw new Error(`the Editor is running, but its main window's menus couldn't be read (the adapter reads them in English), so it may have ${path.basename(mapPath)} open; close the map there without saving first, or quit the Editor`);
  }
}

/**
 * Refuses a map the Editor already has open, or may have: opening it again would only bring forward
 * the copy it loaded.
 */
async function refuseOpen(mapPath: string, editor: Editor, then: string): Promise<void> {
  const state = await readEditor(editor);
  refuseUnreadable(state, mapPath);
  const open = documentsOf(state, mapPath);
  if (open.length > 0) throw new Error(`the Editor already has ${path.basename(mapPath)} open (${describeDocuments(open)}); close it there without saving, then ${then}`);
}

export async function testDocument(request: { readonly mapPath: string; readonly seconds?: number }, context: HostContext): Promise<void> {
  editorExe(context);
  const mapPath = path.resolve(request.mapPath);
  const editor = await editorHelper(context);
  await refuseOpen(mapPath, editor, "test again");
  const total = request.seconds ?? EDITOR_LOAD_SECONDS + GAME_START_SECONDS;
  const gameStart = Math.max(1, Math.round((total * GAME_START_SECONDS) / (EDITOR_LOAD_SECONDS + GAME_START_SECONDS)));
  const load = Math.max(1, Math.floor(total - gameStart));
  await launch(mapPath, load, context, editor);
  const window = await activate(mapPath, editor);
  const pids = tolerantCheck(() => gamePids(editor.exe));
  const before = await firstAnswer(pids);
  await choose(editor, window, "testDocument");
  const late = deadline(gameStart);
  while (!late()) {
    if ((await pids())?.some((pid) => !before.includes(pid))) return;
    await sleep(1);
  }
  if (before.length > 0) {
    throw new Error(`ran File > Test Document, but a game was already running, and the Editor may have loaded the map in it rather than start another; quit the game, then test again`);
  }
  throw new Error(`ran File > Test Document, but no new game started within ${gameStart} s; the Editor may be showing script errors`);
}

const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);

/**
 * Opens the Map Package, runs File > Save once it has loaded, waits for the Editor to write
 * MapScript.galaxy, then File > Close. Only for a copy made for the purpose: the save rewrites the
 * package. The Editor writes MapScript.galaxy only when the triggers changed or the file is missing,
 * so the copy's is removed first, and the save writes the Editor's own script from Triggers.
 */
export async function saveInEditor(request: { readonly mapPath: string; readonly seconds?: number }, context: HostContext): Promise<void> {
  editorExe(context);
  const mapPath = path.resolve(request.mapPath);
  const editor = await editorHelper(context);
  await refuseOpen(mapPath, editor, "run this again");
  const script = path.join(mapPath, "MapScript.galaxy");
  const total = request.seconds ?? EDITOR_LOAD_SECONDS + GAME_START_SECONDS;
  await rm(script, { force: true });
  let saved = false;
  let asking = false;
  try {
    await launch(mapPath, Math.max(1, total - SAVE_SECONDS), context, editor);
    const window = await activate(mapPath, editor);
    // Only a prompt that the save brings up is the save's: the author may have other dialogs open.
    const earlier = new Set((await readEditor(editor)).prompts.map((prompt) => prompt.hwnd));
    await choose(editor, window, "save");
    const late = deadline(SAVE_SECONDS);
    const ask = async (): Promise<void> => {
      const prompts = (await readEditor(editor)).prompts.filter((prompt) => !earlier.has(prompt.hwnd));
      if (prompts.length > 0) {
        asking = true;
        throw new Error(`ran File > Save, but the Editor is asking: ${await promptText(editor, prompts)}; answer it there, then close the map`);
      }
    };
    while (!(await exists(script))) {
      await ask();
      if (late()) throw new Error(`ran File > Save, but the Editor didn't write ${script} within ${SAVE_SECONDS} s`);
      await sleep(1);
    }
    // A prompt the save raises after writing the script (a warning) is still the save's, and a
    // Close posted under it could stack another.
    await sleep(1);
    await ask();
    saved = true;
  } finally {
    // Closed even when the save failed, so the next run doesn't find the copy open, unless the
    // Editor is asking something: a Close posted under its prompt could stack another. A failed
    // close after a failed save leaves the save's error to report.
    if (!asking) {
      await closeDocument(mapPath, editor).catch((error: unknown) => {
        if (saved) throw error;
      });
    }
  }
}

/**
 * File > Close on this map, answering No if the Editor asks to save its changes (the prompt names
 * the map's whole path), and waits for it to go.
 */
export async function closeDocument(mapPath: string, editor: Editor): Promise<void> {
  const window = await activate(mapPath, editor);
  await choose(editor, window, "close");
  const late = deadline(CLOSE_SECONDS);
  while (!late()) {
    await sleep(1);
    const state = await readEditor(editor);
    if (documentsOf(state, mapPath).length === 0) return;
    for (const prompt of state.prompts) {
      const answer = savePromptFor(parseButtons(await runHelper(editor.exe, ["buttons", prompt.hwnd]).catch(() => "")), mapPath);
      if (answer) await runHelper(editor.exe, ["click", answer.no]);
    }
  }
  throw new Error(`ran File > Close, but the Editor still has ${path.basename(mapPath)} open after ${CLOSE_SECONDS} s`);
}
