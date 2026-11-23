// convert-files (ADR-0011): a mod's Kept whole files that the Blueprint owns as source files (its
// Galaxy scripts, UI layouts and font styles) go into the mod's folder and its `files`, so the next
// compile converts them under the Equivalence Check. Harbour-Story is synthetic.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileMod } from "../../src/mods/compile-mod.js";
import { convertFiles } from "../../src/mods/convert-files.js";
import { keptReport } from "../../src/mods/kept-report.js";
import { connect, text } from "../mcp/harness.js";
import { cleanupMods, declare, hashTree, put, setup } from "./mod-fixture.js";

afterEach(cleanupMods);

const GALAXY = "Base.SC2Data/scripts/harbour.galaxy";
const LAYOUT = "Base.SC2Data/UI/Layout/Harbour.SC2Layout";
const STYLE = "Base.SC2Data/UI/FontStyles.SC2Style";

describe("convertFiles", () => {
  it("writes the package's Kept Galaxy, layout and style files into the Blueprint as files it owns, and the compile converts them unchanged", async () => {
    const mod = await setup();
    await put(path.join(mod.modPackage, ...STYLE.split("/")), "<StyleFile/>\r\n");
    const before = await hashTree(mod.modPackage);

    const converted = await convertFiles(mod.blueprintPath);

    expect(converted.converted).toEqual([STYLE, LAYOUT, GALAXY]);
    const blueprint = JSON.parse(await readFile(mod.blueprintPath, "utf8"));
    expect(blueprint.files).toEqual([
      { path: STYLE, source: "UI/FontStyles.SC2Style" },
      { path: LAYOUT, source: "UI/Layout/Harbour.SC2Layout" },
      { path: GALAXY, source: "scripts/harbour.galaxy" },
    ]);
    expect(await readFile(path.join(mod.modDir, "scripts", "harbour.galaxy"), "utf8")).toBe("void Harbour_Init () {\r\n}\r\n");

    const compiled = await compileMod(mod.blueprintPath);

    expect(compiled.conversions.map((conversion) => conversion.item).sort()).toEqual([`file:${STYLE}`, `file:${LAYOUT}`, `file:${GALAXY}`]);
    const after = await hashTree(mod.modPackage);
    for (const file of [GALAXY, LAYOUT, STYLE]) expect(after[file]).toBe(before[file]);
    const kept = await keptReport(mod.blueprintPath);
    expect(kept.components.find((component) => component.component === "Scripts")!.count).toBe(0);
    expect(kept.components.find((component) => component.component === "UI")!.count).toBe(0);
  });

  it("leaves a file the Blueprint already writes", async () => {
    const mod = await setup();
    await declare(mod, { files: [{ path: GALAXY, source: "kept/harbour.galaxy" }] }, { "kept/harbour.galaxy": "void Harbour_Init () {\r\n}\r\n" });

    expect((await convertFiles(mod.blueprintPath)).converted).toEqual([LAYOUT]);
    expect(existsSync(path.join(mod.modDir, "scripts", "harbour.galaxy"))).toBe(false);
  });

  it("leaves the Galaxy the Editor generates for a library in Triggers, which the library interface owns once it converts", async () => {
    const mod = await setup();
    await put(path.join(mod.modPackage, "Base.SC2Data", "LibHbr1.galaxy"), "void libHbr1_InitLib () {\r\n}\r\n");
    await put(path.join(mod.modPackage, "Base.SC2Data", "LibHbr1_h.galaxy"), "void libHbr1_InitLib ();\r\n");

    expect((await convertFiles(mod.blueprintPath)).converted).toEqual([LAYOUT, GALAXY]);
  });

  it("refuses a file whose source path the mod's folder already has with other bytes, and takes one with the same", async () => {
    const mod = await setup();
    await put(path.join(mod.modDir, "scripts", "harbour.galaxy"), "void Other () {}\r\n");
    await put(path.join(mod.modDir, "UI", "Layout", "Harbour.SC2Layout"), "<Desc/>\r\n");

    const converted = await convertFiles(mod.blueprintPath);

    expect(converted.converted).toEqual([LAYOUT]);
    expect(converted.refused).toEqual([{ path: GALAXY, reason: expect.stringMatching(/already has scripts\/harbour\.galaxy, with other bytes/) }]);
  });

  it("converts a named file of any kind, and refuses one the package hasn't got or the Blueprint writes", async () => {
    const mod = await setup();

    expect((await convertFiles(mod.blueprintPath, { paths: ["Base.SC2Data/Cutscenes/Quay - Dawn.SC2Cutscene"] })).converted).toEqual(["Base.SC2Data/Cutscenes/Quay - Dawn.SC2Cutscene"]);
    await expect(convertFiles(mod.blueprintPath, { paths: ["Base.SC2Data/scripts/missing.galaxy"] })).rejects.toThrow(/The mod package has no Base\.SC2Data\/scripts\/missing\.galaxy/);
    expect((await convertFiles(mod.blueprintPath, { paths: ["Base.SC2Data/Cutscenes/Quay - Dawn.SC2Cutscene"] })).refused).toEqual([{ path: "Base.SC2Data/Cutscenes/Quay - Dawn.SC2Cutscene", reason: "the Blueprint already writes it" }]);
    await expect(convertFiles(mod.blueprintPath, { paths: ["DocumentInfo"] })).rejects.toThrow(/DocumentInfo is one the compile generates/);
  });
});

describe("the convert_files tool", () => {
  it("converts a Workspace mod's Kept Galaxy, layout and style files", async () => {
    const mod = await setup();
    const client = await connect(mod.workspaceRoot);

    const reply = await client.callTool({ name: "convert_files", arguments: { mod: "harbour-story" } });

    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toEqual({ converted: [LAYOUT, GALAXY], refused: [], strings: [] });
    expect(text(reply)).toContain("compile_mod");
  });
});
