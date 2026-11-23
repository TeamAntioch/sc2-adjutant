// Reading the Editor's window titles for editor.refresh (#739), short of the Editor. The `*` mark
// is what the author saw on a throwaway map (2026-11-21); these tests only pin how we read it.
import { describe, expect, it } from "vitest";

import { fragmentFor, refusalFor, showsUnsaved, windowState } from "../refresh.ts";

const MAP = "/Users/me/repos/campaign/missions/m1/output/Test.SC2Map";
const title = (shown: string, module = "Data") => `${module} - [${shown}] - StarCraft II Editor`;

describe("windowState", () => {
  it("calls a window on the map with no mark clean", () => {
    const titles = [title(`${MAP}/`)];
    expect(windowState(titles, MAP)).toEqual({ state: "clean", titles });
  });

  it("calls a window with * before the closing bracket dirty", () => {
    const dirty = title(`${MAP}/*`);
    expect(windowState([dirty], MAP)).toEqual({ state: "dirty", title: dirty });
    expect(refusalFor(windowState([dirty], MAP), MAP)).toMatch(/unsaved changes in Test\.SC2Map/);
  });

  it("is dirty when any of the map's windows is, however many there are", () => {
    const dirty = title(`${MAP}/*`, "Triggers");
    expect(windowState([title(`${MAP}/`), dirty], MAP)).toMatchObject({ state: "dirty", title: dirty });
  });

  it("reads two windows for different maps by path, so one map's mark is not the other's", () => {
    const other = "/Users/me/repos/campaign/missions/m2/output/Other.SC2Map";
    const titles = [title(`${MAP}/`), title(`${other}/*`)];
    expect(windowState(titles, MAP)).toEqual({ state: "clean", titles: [titles[0]] });
    expect(windowState(titles, other)).toMatchObject({ state: "dirty" });
  });

  it("does not take another map's * for this one when this one is closed", () => {
    expect(windowState([title("/elsewhere/Other.SC2Map/*")], MAP)).toEqual({ state: "none" });
  });

  it("does not take another worktree's copy of the same Mission for it", () => {
    const copy = title("/Users/me/other-worktree/missions/m1/output/Test.SC2Map/*");
    expect(windowState([copy], MAP)).toEqual({ state: "none" });
  });

  it("reads a shortened title by its tail, as the Editor shows a long path", () => {
    const tail = "/.../campaign/missions/m1/output/Test.SC2Map";
    expect(windowState([title(`${tail}/`)], MAP)).toMatchObject({ state: "clean" });
    expect(windowState([title(`${tail}/*`)], MAP)).toMatchObject({ state: "dirty" });
    expect(windowState([title(".../campaign/missions/m1/output/Test.SC2Map/*")], MAP)).toMatchObject({ state: "dirty" });
  });

  it("does not take a shortened title with another tail for this map, even with the same name", () => {
    expect(windowState([title("/.../other/missions/m1/output/Test.SC2Map/*")], MAP)).toEqual({ state: "none" });
  });

  it("is unclear for a shortened title that is only the map's name, whatever mark it has", () => {
    for (const shown of ["/.../Test.SC2Map/", ".../Test.SC2Map/*"]) {
      const result = windowState([title(shown)], MAP);
      expect(result).toMatchObject({ state: "unclear" });
      expect(refusalFor(result, MAP)).toMatch(/can't be told from another copy/);
    }
  });

  it("lets a shortened title naming another map leave this one clean", () => {
    expect(windowState([title("/.../maps/Other.SC2Map/*"), title(`${MAP}/`)], MAP)).toMatchObject({ state: "clean" });
  });

  it("is none with no window, and with a window that has no path", () => {
    expect(windowState([], MAP)).toEqual({ state: "none" });
    expect(windowState(["StarCraft II Editor", "Activity - Loading"], MAP)).toEqual({ state: "none" });
    expect(refusalFor({ state: "none" }, MAP)).toBeUndefined();
  });

  it("allows a clean document to be closed", () => {
    expect(refusalFor(windowState([title(`${MAP}/`)], MAP), MAP)).toBeUndefined();
  });
});

describe("showsUnsaved", () => {
  it("looks only at the bracketed path", () => {
    expect(showsUnsaved(title("/a/B.SC2Map/*"))).toBe(true);
    expect(showsUnsaved(title("/a/B.SC2Map/"))).toBe(false);
    expect(showsUnsaved("Notes* - StarCraft II Editor")).toBe(false);
  });
});

describe("fragmentFor", () => {
  it("is the shortened tail when the Editor shortened the path, else the whole path", () => {
    expect(fragmentFor(title("/.../campaign/missions/m1/output/Test.SC2Map/*"), MAP)).toBe("campaign/missions/m1/output/Test.SC2Map");
    expect(fragmentFor(title(`${MAP}/`), MAP)).toBe(MAP);
  });

  it("finds every window of the map: the tail ends the resolved path", () => {
    const tail = fragmentFor(title("/.../campaign/missions/m1/output/Test.SC2Map/"), MAP);
    expect(MAP.endsWith(tail)).toBe(true);
  });
});
