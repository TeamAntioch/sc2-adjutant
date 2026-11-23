// How the Windows Host Adapter reads the Editor's windows, from what its helper prints: which
// documents are open (the main window's title and its Window menu name them by an elided path),
// whether a map is still loading, and which prompt asks to save which map. Samples are as the
// 32-bit Editor (build 98310) showed them on 2026-11-18.
import { describe, expect, it } from "vitest";

import {
  documentsOf,
  editorState,
  elidedMatches,
  menuCommands,
  parseButtons,
  parseMenu,
  parseWindows,
  savePromptFor,
  titleDocument,
} from "../editor-windows.ts";

const MAP = "C:\\Users\\me\\repos\\sc2-adjutant\\packages\\core\\examples\\test-fields\\missions\\terrain-objects\\output\\Spike.SC2Map";

const WINDOWS = [
  "328610\t0\t11140\tSC2Editor\t#32770\t1\t1\tMessages - StarCraft II Editor",
  "459778\t0\t11140\tSC2Editor\t#32770\t0\t0\tg_osGuiModalParent",
  "983180\t0\t11140\tSC2Editor\t#32770\t1\t1\tTerrain - [C:/.../examples/test-fields/missions/terrain-objects/output/Spike.SC2Map/] - StarCraft II Editor",
  "1442762\t328610\t11140\tSC2Editor\tIME\t0\t0\tDefault IME",
  "67388\t0\t7500\tSC2\tStarCraft II\t1\t0\tStarCraft II",
  "4242\t0\t900\tnotepad\tNotepad\t1\t1\tTerrain - [C:/.../output/Spike.SC2Map/] - StarCraft II Editor",
].join("\r\n");

const MENU = [
  "&File\t10\t0\t&New...\tCtrl+N",
  "&File\t13\t0\t&Close\t",
  "&File\t15\t0\t&Save\tCtrl+S",
  "&File\t16\t0\tSave &As...\t",
  "&File\t23\t0\t&Test Document\tCtrl+F9",
  "&File\t26\t0\t&1 C:/.../output/Other.SC2Map/\t",
  "&File\t414\t0\tClose &Window\t",
  "&Window\t316\t0\t&Messages\tCtrl+Shift+M",
  "&Window\t387\t0\t&1 C:/.../output/Spike.SC2Map/\t",
  "&Window\t415\t1\t&2 C:/.../output/SaveCopy.SC2Map/*\t",
].join("\r\n");

describe("reading the Editor's windows", () => {
  it("parses the helper's window list, menus and buttons", () => {
    expect(parseWindows(WINDOWS)[2]).toEqual({
      hwnd: "983180",
      owner: "0",
      pid: 11140,
      process: "SC2Editor",
      className: "#32770",
      visible: true,
      hasMenu: true,
      title: "Terrain - [C:/.../examples/test-fields/missions/terrain-objects/output/Spike.SC2Map/] - StarCraft II Editor",
    });
    expect(parseMenu(MENU)[4]).toEqual({ menu: "&File", id: 23, checked: false, label: "&Test Document", shortcut: "Ctrl+F9" });
    expect(parseButtons("67440\t1\t&Yes\r\n67442\t1\t&No\r\n67444\t1\tCancel\r\ntext\tSave changes to 'C:/x/Spike.SC2Map/'?\r\n")).toEqual({
      buttons: [
        { hwnd: "67440", enabled: true, text: "&Yes" },
        { hwnd: "67442", enabled: true, text: "&No" },
        { hwnd: "67444", enabled: true, text: "Cancel" },
      ],
      text: ["Save changes to 'C:/x/Spike.SC2Map/'?"],
    });
  });

  it("reads the active document's elided path from the main window's title, dropping the unsaved mark", () => {
    expect(titleDocument("Terrain - [C:/.../output/Spike.SC2Map/] - StarCraft II Editor")).toBe("C:/.../output/Spike.SC2Map");
    expect(titleDocument("Triggers - [C:/.../output/Spike.SC2Map/*] - StarCraft II Editor")).toBe("C:/.../output/Spike.SC2Map");
    expect(titleDocument("Terrain - StarCraft II Editor")).toBeUndefined();
    expect(titleDocument("Terrain - [C:/maps/[wip]/Spike.SC2Map/] - StarCraft II Editor")).toBe("C:/maps/[wip]/Spike.SC2Map");
  });

  it("matches an elided path against a map's whole path, any spelling of its slashes and case", () => {
    expect(elidedMatches("C:/.../examples/test-fields/missions/terrain-objects/output/Spike.SC2Map", MAP)).toBe(true);
    expect(elidedMatches("c:/.../OUTPUT/spike.sc2map", `${MAP}\\`)).toBe(true);
    expect(elidedMatches("C:/.../output/Spike.SC2Map", MAP.replace("Spike", "SpikeTwo"))).toBe(false);
    expect(elidedMatches("C:/.../other/output/Spike.SC2Map", MAP)).toBe(false);
    expect(elidedMatches("D:/.../output/Spike.SC2Map", MAP)).toBe(false);
    expect(elidedMatches("C:/Maps/Spike.SC2Map", "C:\\Maps\\Spike.SC2Map")).toBe(true);
    // An elision stands for whole folders, so a name that only ends the same isn't taken for it.
    expect(elidedMatches("C:/.../output/Spike.SC2Map", "C:\\x\\my-output\\Spike.SC2Map")).toBe(false);
  });

  it("finds File > Test Document, Save and Close by label, since their ids change between Editor sessions", () => {
    expect(menuCommands(parseMenu(MENU))).toEqual({ testDocument: 23, save: 15, close: 13 });
    const restarted = ["&File\t15\t0\t&New...\tCtrl+N", "&File\t18\t0\t&Close\t", "&File\t20\t0\t&Save\tCtrl+S", "&File\t28\t0\t&Test Document\tCtrl+F9"].join("\n");
    expect(menuCommands(parseMenu(restarted))).toEqual({ testDocument: 28, save: 20, close: 18 });
    expect(menuCommands(parseMenu("&Edit\t75\t0\t&Undo\tCtrl+Z"))).toEqual({});
  });

  it("finds the Editor's main window, its documents and whether a map is still loading", () => {
    const windows = parseWindows(WINDOWS);
    const menus = new Map([["983180", parseMenu(MENU)], ["328610", parseMenu("&Edit\t75\t0\t&Undo\tCtrl+Z")]]);
    const state = editorState(windows, menus);
    expect(state.running).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.mainWindows).toEqual([{ hwnd: "983180", commands: { testDocument: 23, save: 15, close: 13 } }]);
    expect(state.documents).toEqual([
      { window: "983180", path: "C:/.../examples/test-fields/missions/terrain-objects/output/Spike.SC2Map", active: true },
      { window: "983180", path: "C:/.../output/Spike.SC2Map", active: false, menuId: 387 },
      { window: "983180", path: "C:/.../output/SaveCopy.SC2Map", active: false, menuId: 415 },
    ]);
    expect(documentsOf(state, MAP).map((document) => document.menuId)).toEqual([undefined, 387]);
    expect(documentsOf(state, MAP.replace("Spike", "SaveCopy")).map((document) => document.menuId)).toEqual([415]);

    const loading = parseWindows("525192\t459778\t11140\tSC2Editor\t#32770\t1\t0\tActivity - StarCraft II Editor");
    expect(editorState(loading, new Map())).toMatchObject({ running: true, loading: true, documents: [] });
    expect(editorState(parseWindows(""), new Map())).toMatchObject({ running: false, loading: false, unreadable: false });
    expect(state.unreadable).toBe(false);
  });

  it("knows it can't tell what's open when no window with a menu reads as the main window", () => {
    // The main window's menu failed to read (or isn't in English): its documents are unknown, not none.
    const state = editorState(parseWindows(WINDOWS), new Map([["328610", parseMenu("&Edit\t75\t0\t&Undo\tCtrl+Z")]]));
    expect(state).toMatchObject({ running: true, mainWindows: [], documents: [], unreadable: true });
  });

  it("reads an Editor still starting, with only its Messages window up, as having nothing open", () => {
    // The Messages window has a menu bar too, and can show before the main window does.
    const starting = parseWindows([WINDOWS.split("\r\n")[0], "525192\t459778\t11140\tSC2Editor\t#32770\t1\t0\tWelcome to the StarCraft II Editor"].join("\n"));
    expect(editorState(starting, new Map([["328610", parseMenu("&Edit\t75\t0\t&Undo\tCtrl+Z")]]))).toMatchObject({ running: true, documents: [], unreadable: false, prompts: [] });
  });

  it("reads a literal & in a Window menu document's path, which a menu label doubles", () => {
    const menu = parseMenu("&File\t23\t0\t&Test Document\tCtrl+F9\n&Window\t388\t0\t&3 C:/Maps/R&&D/Spike.SC2Map/\t");
    const state = editorState(parseWindows(WINDOWS), new Map([["983180", menu]]));
    expect(documentsOf(state, "C:\\Maps\\R&D\\Spike.SC2Map").map((document) => document.menuId)).toEqual([388]);
  });

  it("lists the Editor's other dialogs as prompts", () => {
    const windows = parseWindows([WINDOWS, "198508\t0\t11140\tSC2Editor\t#32770\t1\t0\tWarning", "525192\t459778\t11140\tSC2Editor\t#32770\t1\t0\tActivity - StarCraft II Editor"].join("\n"));
    expect(editorState(windows, new Map()).prompts.map((prompt) => prompt.title)).toEqual(["Warning"]);
  });

  it("recognizes the prompt to save this map's changes by its whole path", () => {
    const prompt = parseButtons(`67440\t1\t&Yes\n67442\t1\t&No\n67444\t1\tCancel\ntext\tSave changes to '${MAP.replaceAll("\\", "/")}/'?`);
    expect(savePromptFor(prompt, MAP)).toEqual({ yes: "67440", no: "67442" });
    expect(savePromptFor(prompt, MAP.replace("Spike", "Other"))).toBeUndefined();
    expect(savePromptFor(parseButtons("1\t1\tOK\ntext\tSomething else"), MAP)).toBeUndefined();
  });
});
