// The files left to the Editor (docs/reference/mod-files-left-to-the-editor.md): Editor-only files
// that stay Kept Content for good, since no compile writes them, so the Kept report lists them
// apart, on their own line, out of its count. The rule names the files, not their folders: any
// other file there is counted.
// The mod is the synthetic Harbour-Story.
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileMod } from "../../src/mods/compile-mod.js";
import { convertFiles } from "../../src/mods/convert-files.js";
import { formatKeptReport, keptReport } from "../../src/mods/kept-report.js";
import { connect, text } from "../mcp/harness.js";
import { cleanupMods, declare, hashTree, type Mod, put, setup } from "./mod-fixture.js";

afterEach(cleanupMods);

const CATEGORIES = "Base.SC2Data/EditorDataASD/EditorCategories.xml";
const BASE_CATALOG_STRINGS = "Base.SC2Data/LocalizedData/EditorASD/EditorCatalogStringsSC2.txt";
const US_CATALOG_STRINGS = "enUS.SC2Data/LocalizedData/Editor/EditorCatalogStringsSC2.txt";
// Spelt in lower case, as the game reads a path in any case.
const FR_CATALOG_STRINGS = "frfr.sc2data/localizeddata/editor/editorcatalogstringssc2.txt";
/** The files left to the Editor, in the package's order. */
const LEFT = [CATEGORIES, BASE_CATALOG_STRINGS, US_CATALOG_STRINGS, FR_CATALOG_STRINGS].sort();
// Beside them, in the same folders, and not named by the rule; Base isn't a locale.
const OTHER_EDITOR_DATA = "Base.SC2Data/EditorDataASD/EditorLayouts.xml";
const OTHER_EDITOR_STRINGS = "enUS.SC2Data/LocalizedData/Editor/EditorCatalogStrings.txt";
const BASE_EDITOR_STRINGS = "Base.SC2Data/LocalizedData/Editor/EditorCatalogStringsSC2.txt";
const OTHERS = [OTHER_EDITOR_DATA, OTHER_EDITOR_STRINGS, BASE_EDITOR_STRINGS];

/** Harbour-Story with the Editor's files, and other files beside them. */
async function withEditorFiles(): Promise<Mod> {
  const mod = await setup();
  for (const file of [CATEGORIES, OTHER_EDITOR_DATA]) await put(path.join(mod.modPackage, ...file.split("/")), `<?xml version="1.0" encoding="utf-8"?>\r\n<Categories/>\r\n`);
  for (const file of [BASE_CATALOG_STRINGS, US_CATALOG_STRINGS, FR_CATALOG_STRINGS, OTHER_EDITOR_STRINGS, BASE_EDITOR_STRINGS]) await put(path.join(mod.modPackage, ...file.split("/")), "﻿Category/Name/Harbour=Harbour\r\n");
  return mod;
}

const keptItems = (report: Awaited<ReturnType<typeof keptReport>>) => report.components.flatMap((component) => component.items.map((item) => item.item));

describe("keptReport's files left to the Editor", () => {
  it("lists the Editor's category and catalog strings files apart, for any locale, out of the Kept count", async () => {
    const mod = await setup();
    const without = await keptReport(mod.blueprintPath);
    const editorMod = await withEditorFiles();

    const report = await keptReport(editorMod.blueprintPath);

    expect(report.leftToEditor).toEqual({ count: 4, items: LEFT.map((file) => ({ item: `file:${file}`, file })) });
    for (const file of LEFT) expect(keptItems(report)).not.toContain(`file:${file}`);
    // The others are counted, as any file beside them the rule doesn't name.
    expect(report.total).toBe(without.total + OTHERS.length);
    expect(keptItems(report)).toEqual(expect.arrayContaining(OTHERS.map((file) => `file:${file}`)));
  });

  it("prints them on their own line after the Kept components, each file with --items", async () => {
    const report = await keptReport((await withEditorFiles()).blueprintPath);

    const counts = formatKeptReport(report).split("\n");
    expect(counts.at(-1)).toBe("  Left to the Editor: 4 (Editor-only files the compile doesn't write)");
    const items = formatKeptReport(report, { items: true }).split("\n");
    expect(items.slice(items.indexOf("  Left to the Editor: 4 (Editor-only files the compile doesn't write)") + 1)).toEqual(
      LEFT.map((file) => `      ${file}`),
    );
  });

  it("leaves out the line when the mod has none", async () => {
    const report = await keptReport((await setup()).blueprintPath);

    expect(report.leftToEditor).toEqual({ count: 0, items: [] });
    expect(formatKeptReport(report)).not.toContain("Left to the Editor");
  });
});

describe("compileMod and the files left to the Editor", () => {
  it("leaves them as they are in the package, out of the compile record", async () => {
    const mod = await withEditorFiles();
    const before = await hashTree(mod.modPackage);

    const compiled = await compileMod(mod.blueprintPath);

    const after = await hashTree(mod.modPackage);
    for (const file of LEFT) expect(after[file]).toBe(before[file]);
    expect(compiled.record.entries.filter((entry) => entry.kind === "file").map((entry) => entry.path)).toEqual([]);
    expect((await keptReport(mod.blueprintPath)).leftToEditor.count).toBe(4);
  });
});

describe("convertFiles and the files left to the Editor", () => {
  it("refuses a named one, since the compile doesn't write it, and takes another file in its folder", async () => {
    const mod = await withEditorFiles();

    await expect(convertFiles(mod.blueprintPath, { paths: [CATEGORIES, OTHER_EDITOR_DATA] })).rejects.toThrow(`${CATEGORIES} is left to the Editor`);
    expect((await convertFiles(mod.blueprintPath, { paths: [OTHER_EDITOR_DATA] })).converted).toEqual([OTHER_EDITOR_DATA]);
  });

  it("refuses one the Blueprint writes all the same as already written, and the report counts it Compiled", async () => {
    const mod = await withEditorFiles();
    await declare(mod, { files: [{ path: CATEGORIES, source: "EditorDataASD/EditorCategories.xml" }] }, { "EditorDataASD/EditorCategories.xml": `<?xml version="1.0" encoding="utf-8"?>\r\n<Categories/>\r\n` });

    expect((await convertFiles(mod.blueprintPath, { paths: [CATEGORIES] })).refused).toEqual([{ path: CATEGORIES, reason: "the Blueprint already writes it" }]);
    await compileMod(mod.blueprintPath);
    expect((await keptReport(mod.blueprintPath)).leftToEditor.items.map((item) => item.file)).not.toContain(CATEGORIES);
  });
});

describe("the kept_report and compile_mod tools", () => {
  it("give the files left to the Editor apart from the Kept count", async () => {
    const mod = await withEditorFiles();
    const client = await connect(mod.workspaceRoot);

    const report = await client.callTool({ name: "kept_report", arguments: { mod: "harbour-story" } });
    expect(report.isError).toBeFalsy();
    expect(report.structuredContent).toMatchObject({ leftToEditor: { count: 4, items: LEFT.map((file) => ({ item: `file:${file}`, file })) } });
    expect(text(report)).toContain("Left to the Editor: 4");

    const compiled = await client.callTool({ name: "compile_mod", arguments: { mod: "harbour-story" } });
    expect(compiled.isError).toBeFalsy();
    expect(compiled.structuredContent).toMatchObject({ kept: { leftToEditor: 4 } });
  });
});
