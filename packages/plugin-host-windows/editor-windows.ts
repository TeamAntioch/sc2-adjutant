// Reading the StarCraft II Editor's windows on Windows, from what the editor helper prints
// (helpers/editor.cs). Pure, so it's tested without the Editor.
//
// What the 32-bit Editor (build 98310) shows, seen 2026-11-18 (docs/windows-host.md has more):
// - One main window, a top-level `#32770` with the native menu bar, holds every open document. Its
//   title names the active one by an elided path, `Terrain - [C:/.../output/Spike.SC2Map/] -
//   StarCraft II Editor` (the module first; `/*` after the path when it has unsaved changes), and
//   just `Terrain - StarCraft II Editor` with none open.
// - The Window menu lists every open document, `&1 C:/.../output/Spike.SC2Map/`, elided further;
//   choosing its item (posting its command id) makes that document the active one.
// - Menu command ids change between Editor sessions, so File > Test Document, Save and Close are
//   found by their labels (English) in the main window's menu each time.
// - While a map loads, an `Activity - StarCraft II Editor` window is open.
// - Prompts are `#32770` dialogs with no menu, such as "Warning", whose text names the whole path:
//   `Save changes to 'C:/Users/.../Spike.SC2Map/'?` with &Yes, &No and Cancel.

/** A top-level window, as `editor windows` prints it. */
export type TopWindow = {
  readonly hwnd: string;
  readonly owner: string;
  readonly pid: number;
  readonly process: string;
  readonly className: string;
  readonly visible: boolean;
  readonly hasMenu: boolean;
  readonly title: string;
};

/** An item of a window's menus, one level down, as `editor menu` prints it. */
export type MenuItem = { readonly menu: string; readonly id: number; readonly checked: boolean; readonly label: string; readonly shortcut: string };

/** A dialog's buttons and its static text, as `editor buttons` prints them. */
export type DialogContents = {
  readonly buttons: readonly { readonly hwnd: string; readonly enabled: boolean; readonly text: string }[];
  readonly text: readonly string[];
};

/** A document the Editor has open, by the elided path it shows. */
export type EditorDocument = {
  /** The main window holding it. */
  readonly window: string;
  /** Its path as the Editor shows it, elided, with forward slashes and no trailing slash. */
  readonly path: string;
  /** It is the main window's active document: its title names it. */
  readonly active: boolean;
  /** Its Window menu item, which makes it the active document. */
  readonly menuId?: number;
};

export type EditorState = {
  readonly running: boolean;
  /** A map is loading: Test Document and Save do nothing until it's done. */
  readonly loading: boolean;
  /** The Editor's main windows, the ones with File > Test Document, with their File menu's command ids. */
  readonly mainWindows: readonly { readonly hwnd: string; readonly commands: MenuCommands }[];
  /**
   * The Editor has a window with a menu bar, other than its Messages window, but none could be read
   * as its main window: its menu didn't read, or isn't in English. What it has open is then unknown,
   * not nothing. The Messages window can show before the main window during startup; it has a menu
   * bar too, and holds no documents.
   */
  readonly unreadable: boolean;
  /** Each main window's active document (from its title), then every document its Window menu lists. */
  readonly documents: readonly EditorDocument[];
  /** Visible dialogs other than the Editor's own progress windows. */
  readonly prompts: readonly TopWindow[];
};

/**
 * The File menu's commands the adapter posts to the main window as WM_COMMAND. Their ids aren't
 * fixed: in one Editor session Test Document, Save and Close were 23, 15 and 13, and after a restart
 * 28, 20 and 18 (Save's old id then was New). So they are looked up by label each time.
 */
export type MenuCommands = { readonly testDocument?: number; readonly save?: number; readonly close?: number };

const COMMAND_LABELS: Readonly<Record<keyof MenuCommands, string>> = { testDocument: "Test Document", save: "Save", close: "Close" };

/** A menu label without its access-key ampersands (`&Test Document` is "Test Document"). */
const plainLabel = (label: string): string => label.replace(/&(.)/g, "$1");

/** The ids of File > Test Document, Save and Close in a window's menus. */
export function menuCommands(items: readonly MenuItem[]): MenuCommands {
  const file = items.filter((item) => plainLabel(item.menu) === "File");
  const id = (label: string) => file.find((item) => plainLabel(item.label) === label)?.id;
  return Object.fromEntries(Object.entries(COMMAND_LABELS).flatMap(([command, label]) => {
    const found = id(label);
    return found === undefined ? [] : [[command, found]];
  })) as MenuCommands;
}

const lines = (stdout: string): string[] => stdout.split(/\r?\n/).filter((line) => line.length > 0);

export function parseWindows(stdout: string): TopWindow[] {
  return lines(stdout).flatMap((line) => {
    const [hwnd, owner, pid, process, className, visible, hasMenu, ...title] = line.split("\t");
    if (hwnd === undefined || hasMenu === undefined) return [];
    return [{ hwnd, owner: owner!, pid: Number(pid), process: process!, className: className!, visible: visible === "1", hasMenu: hasMenu === "1", title: title.join("\t") }];
  });
}

export function parseMenu(stdout: string): MenuItem[] {
  return lines(stdout).flatMap((line) => {
    const [menu, id, checked, label, shortcut] = line.split("\t");
    if (menu === undefined || label === undefined) return [];
    return [{ menu, id: Number(id), checked: checked === "1", label, shortcut: shortcut ?? "" }];
  });
}

export function parseButtons(stdout: string): DialogContents {
  const buttons: { hwnd: string; enabled: boolean; text: string }[] = [];
  const text: string[] = [];
  for (const line of lines(stdout)) {
    const [first, second, ...rest] = line.split("\t");
    if (first === "text") text.push([second, ...rest].join("\t"));
    else if (first !== undefined && second !== undefined) buttons.push({ hwnd: first, enabled: second === "1", text: rest.join("\t") });
  }
  return { buttons, text };
}

/** The game's process names, 32- and 64-bit (`Versions\Base<build>\SC2.exe`, `SC2_x64.exe`). */
export const GAME_PROCESSES = ["SC2", "SC2_x64"] as const;

/** The Editor's processes: `SC2Editor`, or `SC2Editor_x64` for the 64-bit build. */
export const isEditorProcess = (name: string): boolean => /^SC2Editor(_x64)?$/i.test(name);

/** An elided document path as the Editor shows it, without the unsaved mark or trailing slash. */
const cleanPath = (shown: string): string => shown.replace(/\*$/, "").replace(/\/$/, "");

/** The active document's elided path in a main window's title; undefined with none open. */
export function titleDocument(title: string): string | undefined {
  // The module's name comes first and has no bracket; the path may.
  const match = /^[^[]* - \[(.+)\] - StarCraft II Editor$/.exec(title);
  return match ? cleanPath(match[1]!) : undefined;
}

/**
 * A document a Window menu item names (`&1 C:/.../Spike.SC2Map/`); undefined for its other items.
 * A menu label writes a literal `&` as `&&`.
 */
function menuDocument(text: string): string | undefined {
  const match = /^&?\d+&?\d* (.+)$/.exec(text);
  return match && /[/\\]/.test(match[1]!) ? cleanPath(match[1]!.replaceAll("&&", "&")) : undefined;
}

/** A path as the Editor writes it, for comparing: forward slashes, no trailing slash, lower case. */
const comparable = (file: string): string => file.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();

/**
 * Whether the Editor's elided path (`C:/.../output/Spike.SC2Map`) can stand for this whole path.
 * Each `...` stands for one or more whole folders; the rest must match, ignoring case.
 */
export function elidedMatches(elided: string, mapPath: string): boolean {
  const parts = comparable(elided).split("/");
  const target = comparable(mapPath).split("/");
  const matchFrom = (part: number, at: number): boolean => {
    if (part === parts.length) return at === target.length;
    if (parts[part] === "...") {
      for (let next = at + 1; next <= target.length; next++) if (matchFrom(part + 1, next)) return true;
      return false;
    }
    return at < target.length && parts[part] === target[at] && matchFrom(part + 1, at + 1);
  };
  return matchFrom(0, 0);
}

/** The Editor's Messages window, which has a menu bar but holds no documents. */
const MESSAGES_WINDOW = /^Messages - StarCraft II Editor$/;

const PROGRESS_WINDOWS = /^(Activity - StarCraft II Editor|Welcome to the StarCraft II Editor|Downloading Data)$/;

/** What the Editor has open, from its windows and the menus of those with a menu bar (by hwnd). */
export function editorState(windows: readonly TopWindow[], menus: ReadonlyMap<string, readonly MenuItem[]>): EditorState {
  const editor = windows.filter((window) => isEditorProcess(window.process));
  const visible = editor.filter((window) => window.visible);
  const mainWindows = visible.filter((window) => window.hasMenu && menuCommands(menus.get(window.hwnd) ?? []).testDocument !== undefined);
  const documents = mainWindows.flatMap((window): EditorDocument[] => {
    const active = titleDocument(window.title);
    const listed = (menus.get(window.hwnd) ?? []).flatMap((item) => {
      const shown = plainLabel(item.menu) === "Window" ? menuDocument(item.label) : undefined;
      return shown ? [{ window: window.hwnd, path: shown, active: false, menuId: item.id }] : [];
    });
    return [...(active ? [{ window: window.hwnd, path: active, active: true }] : []), ...listed];
  });
  return {
    running: editor.length > 0,
    loading: visible.some((window) => window.title.startsWith("Activity - ")),
    mainWindows: mainWindows.map((window) => ({ hwnd: window.hwnd, commands: menuCommands(menus.get(window.hwnd) ?? []) })),
    unreadable: mainWindows.length === 0 && visible.some((window) => window.hasMenu && !MESSAGES_WINDOW.test(window.title)),
    documents,
    prompts: visible.filter((window) => window.className === "#32770" && !window.hasMenu && !PROGRESS_WINDOWS.test(window.title)),
  };
}

/** The open documents that may be this Map Package: each one whose elided path can stand for it. */
export const documentsOf = (state: EditorState, mapPath: string): EditorDocument[] => state.documents.filter((document) => elidedMatches(document.path, mapPath));

/** The Yes and No buttons of a prompt asking to save this map's changes, when it is one. */
export function savePromptFor(prompt: DialogContents, mapPath: string): { readonly yes: string; readonly no: string } | undefined {
  const asks = prompt.text.some((text) => {
    const match = /^Save changes to '(.+)'\?$/.exec(text);
    return match !== null && comparable(match[1]!) === comparable(mapPath);
  });
  const button = (label: string) => prompt.buttons.find((candidate) => plainLabel(candidate.text) === label)?.hwnd;
  const yes = button("Yes");
  const no = button("No");
  return asks && yes && no ? { yes, no } : undefined;
}
