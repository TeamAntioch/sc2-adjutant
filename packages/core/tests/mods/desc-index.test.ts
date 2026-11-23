// The generated DescIndex (ADR-0019): compile-mod writes Base.SC2Data/UI/Layout/DescIndex.SC2Layout
// itself, loading every layout in the Mod Blueprint's files in Blueprint order (after the UI
// Components' layouts, once there are any), so a hand-written file can override a generated default.
// The DescIndex and the layouts are written with CRLF, as the Editor saves them. Harbour-Story is
// synthetic.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compileMod } from "../../src/mods/compile-mod.js";
import { convertFiles } from "../../src/mods/convert-files.js";
import { EquivalenceError } from "../../src/mods/equivalence.js";
import { keptReport } from "../../src/mods/kept-report.js";
import { DESC_INDEX, packageFiles } from "../../src/mods/mod-package-files.js";
import { cleanupMods, declare, hashTree, inPackage, put, setup } from "./mod-fixture.js";

afterEach(cleanupMods);

const HARBOUR = "Base.SC2Data/UI/Layout/Harbour.SC2Layout";
const QUAY = "Base.SC2Data/UI/Layout/Quay.SC2Layout";

/** The fixture's Kept Harbour.SC2Layout, as its source, and a new layout, each with LF endings. */
const HARBOUR_SOURCE = "<Desc/>\n";
const QUAY_SOURCE = `<Desc>\n    <Frame type="Label" name="Quay"/>\n</Desc>\n`;

const UIUI_LINE = `<DataComponent Type="uiui">UI/Layout/DescIndex.SC2Layout</DataComponent>`;
const DESC_INDEX_VERSION = ["Base.SC2Data", "UI", "Layout", "DescIndex.version"];

const golden = (name: string) => readFile(new URL(`../ui/golden/${name}`, import.meta.url), "utf8");

/** Harbour-Story whose Blueprint writes Quay.SC2Layout, then the Kept Harbour.SC2Layout. */
async function harbour(files = [
  { path: QUAY, source: "UI/Layout/Quay.SC2Layout" },
  { path: HARBOUR, source: "UI/Layout/Harbour.SC2Layout" },
]) {
  const mod = await setup();
  await declare(mod, { files }, { "UI/Layout/Quay.SC2Layout": QUAY_SOURCE, "UI/Layout/Harbour.SC2Layout": HARBOUR_SOURCE });
  return mod;
}

describe("the generated DescIndex", () => {
  it("loads the Blueprint's layouts in Blueprint order, with CRLF endings, and the ComponentList gains its uiui line", async () => {
    const mod = await harbour();
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, DESC_INDEX)).toBe(await golden("harbour-DescIndex.SC2Layout"));
    expect(await inPackage(mod, "ComponentList.SC2Components")).toContain(`<DataComponent Type="uiui">UI/Layout/DescIndex.SC2Layout</DataComponent>`);
    expect(existsSync(path.join(mod.modPackage, "Base.SC2Data", "UI", "Layout", "DescIndex.version"))).toBe(true);
  });

  it("follows the Blueprint's order when it changes", async () => {
    const mod = await harbour([
      { path: HARBOUR, source: "UI/Layout/Harbour.SC2Layout" },
      { path: QUAY, source: "UI/Layout/Quay.SC2Layout" },
    ]);
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, DESC_INDEX)).toBe(
      `<?xml version="1.0" encoding="utf-8" standalone="yes"?>\r\n<Desc>\r\n    <Include path="UI/Layout/Harbour.SC2Layout"/>\r\n    <Include path="UI/Layout/Quay.SC2Layout"/>\r\n</Desc>\r\n`,
    );
  });

  it("writes the Blueprint's layouts with CRLF endings, and a recompile changes nothing", async () => {
    const mod = await harbour();
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, QUAY)).toBe(`<Desc>\r\n    <Frame type="Label" name="Quay"/>\r\n</Desc>\r\n`);
    expect(await inPackage(mod, HARBOUR)).toBe("<Desc/>\r\n");
    const before = await hashTree(mod.modPackage);
    await compileMod(mod.blueprintPath);
    expect(await hashTree(mod.modPackage)).toEqual(before);
  });

  it("refuses a hand-written DescIndex in files, which the compile generates now", async () => {
    const mod = await harbour();
    await declare(mod, { files: [{ path: DESC_INDEX, source: "UI/Layout/DescIndex.SC2Layout" }, { path: QUAY, source: "UI/Layout/Quay.SC2Layout" }] }, { "UI/Layout/DescIndex.SC2Layout": "<Desc/>\n" });
    await expect(compileMod(mod.blueprintPath)).rejects.toThrow(/files\.0 writes Base\.SC2Data\/UI\/Layout\/DescIndex\.SC2Layout.*generates now/);
  });

  it("warns of a Kept layout the DescIndex doesn't load", async () => {
    const mod = await harbour([{ path: QUAY, source: "UI/Layout/Quay.SC2Layout" }]);
    const { warnings } = await compileMod(mod.blueprintPath);
    expect(warnings).toContainEqual(expect.stringMatching(new RegExp(`^${HARBOUR.replace(/\./g, "\\.")} is Kept, so the generated DescIndex doesn't load it`)));
  });

  it("replaces a Kept DescIndex under the Equivalence Check: in the same order it converts, in another it needs an Accepted Difference", async () => {
    const include = (name: string) => `    <Include path="UI/Layout/${name}.SC2Layout"/>\n`;
    const same = await harbour();
    await put(path.join(same.modPackage, ...DESC_INDEX.split("/")), `<?xml version="1.0" encoding="utf-8"?>\n<Desc>\n${include("Quay")}    <!-- an old include -->\n${include("Harbour")}</Desc>\n`);
    expect((await compileMod(same.blueprintPath)).conversions).toContainEqual({ item: `file:${DESC_INDEX}` });
    await cleanupMods();

    const other = await harbour();
    await put(path.join(other.modPackage, ...DESC_INDEX.split("/")), `<Desc>\n${include("Harbour")}${include("Quay")}</Desc>\n`);
    await expect(compileMod(other.blueprintPath)).rejects.toThrow(EquivalenceError);
  });

  it("isn't written when the Blueprint has no layouts, leaving a Kept DescIndex as it is", async () => {
    const mod = await setup();
    const kept = `<?xml version="1.0" encoding="utf-8"?>\n<Desc>\n    <Include path="UI/Layout/Harbour.SC2Layout"/>\n</Desc>\n`;
    await put(path.join(mod.modPackage, ...DESC_INDEX.split("/")), kept);
    await declare(mod, { files: [{ path: "Base.SC2Data/scripts/harbour.galaxy", source: "scripts/harbour.galaxy" }] }, { "scripts/harbour.galaxy": "void Harbour_Init () {\r\n}\r\n" });
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, DESC_INDEX)).toBe(kept);
  });

  it("goes, with its ComponentList line and stamp, when the Blueprint drops its last layout", async () => {
    const mod = await harbour([{ path: QUAY, source: "UI/Layout/Quay.SC2Layout" }]);
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, "ComponentList.SC2Components")).toContain(UIUI_LINE);
    await declare(mod, { files: [{ path: "Base.SC2Data/scripts/harbour.galaxy", source: "scripts/harbour.galaxy" }] }, { "scripts/harbour.galaxy": "void Harbour_Init () {\r\n}\r\n" });
    await compileMod(mod.blueprintPath);
    expect(existsSync(path.join(mod.modPackage, ...DESC_INDEX.split("/")))).toBe(false);
    expect(await inPackage(mod, "ComponentList.SC2Components")).not.toContain(UIUI_LINE);
    expect(existsSync(path.join(mod.modPackage, ...DESC_INDEX_VERSION))).toBe(false);
  });

  it("keeps a Kept DescIndex's ComponentList line while the Blueprint has no layouts", async () => {
    const mod = await setup();
    await put(path.join(mod.modPackage, ...DESC_INDEX.split("/")), `<Desc/>\r\n`);
    const list = path.join(mod.modPackage, "ComponentList.SC2Components");
    await put(list, (await readFile(list, "utf8")).replace("</Components>", `    ${UIUI_LINE}\r\n</Components>`));
    await declare(mod, { files: [{ path: "Base.SC2Data/scripts/harbour.galaxy", source: "scripts/harbour.galaxy" }] }, { "scripts/harbour.galaxy": "void Harbour_Init () {\r\n}\r\n" });
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, "ComponentList.SC2Components")).toContain(UIUI_LINE);
  });

  it("loads only the layouts in Base.SC2Data, and copies a locale's layout as it is", async () => {
    const localized = "enUS.SC2Data/UI/Layout/Quay.SC2Layout";
    const mod = await harbour([
      { path: QUAY, source: "UI/Layout/Quay.SC2Layout" },
      { path: localized, source: "enUS/Quay.SC2Layout" },
    ]);
    await put(path.join(mod.modDir, "enUS", "Quay.SC2Layout"), QUAY_SOURCE);
    await compileMod(mod.blueprintPath);
    expect(await inPackage(mod, DESC_INDEX)).toBe(`<?xml version="1.0" encoding="utf-8" standalone="yes"?>\r\n<Desc>\r\n    <Include path="UI/Layout/Quay.SC2Layout"/>\r\n</Desc>\r\n`);
    expect(await inPackage(mod, localized)).toBe(`<Desc>\r\n    <Frame type="Label" name="Quay"/>\r\n</Desc>\r\n`);
  });

  it("replaces a Kept DescIndex in the package's own spelling", async () => {
    const spelling = "Base.SC2Data/UI/Layout/descindex.SC2Layout";
    const mod = await harbour();
    await put(path.join(mod.modPackage, ...spelling.split("/")), `<Desc>\n    <Include path="UI/Layout/Quay.SC2Layout"/>\n    <Include path="UI/Layout/Harbour.SC2Layout"/>\n</Desc>\n`);
    const { conversions, record } = await compileMod(mod.blueprintPath);
    expect(conversions).toContainEqual({ item: `file:${spelling}` });
    expect(record.entries).toContainEqual(expect.objectContaining({ kind: "file", path: spelling }));
    expect((await packageFiles(mod.modPackage)).filter((file) => file.toLowerCase() === DESC_INDEX.toLowerCase())).toEqual([spelling]);
  });

  it("copies a layout that isn't UTF-8 text as it is", async () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("<Desc/>\n", "utf16le")]);
    const invalid = Buffer.from([0x3c, 0x44, 0xff, 0x0a]);
    const mod = await harbour([
      { path: QUAY, source: "UI/Layout/Quay.SC2Layout" },
      { path: "Base.SC2Data/UI/Layout/Wide.SC2Layout", source: "UI/Layout/Wide.SC2Layout" },
      { path: "Base.SC2Data/UI/Layout/Odd.SC2Layout", source: "UI/Layout/Odd.SC2Layout" },
    ]);
    await put(path.join(mod.modDir, "UI", "Layout", "Wide.SC2Layout"), utf16);
    await put(path.join(mod.modDir, "UI", "Layout", "Odd.SC2Layout"), invalid);
    await compileMod(mod.blueprintPath);
    expect(await readFile(path.join(mod.modPackage, "Base.SC2Data", "UI", "Layout", "Wide.SC2Layout"))).toEqual(utf16);
    expect(await readFile(path.join(mod.modPackage, "Base.SC2Data", "UI", "Layout", "Odd.SC2Layout"))).toEqual(invalid);
  });
});

describe("the Kept report and the DescIndex", () => {
  const descIndexIn = async (mod: Awaited<ReturnType<typeof setup>>) =>
    (await keptReport(mod.blueprintPath)).components.find(({ items }) => items.some(({ file }) => file === DESC_INDEX))?.component;

  it("files a Kept DescIndex under UI while the Blueprint has no layout, and under Package files once the compile generates it", async () => {
    const mod = await setup();
    await put(path.join(mod.modPackage, ...DESC_INDEX.split("/")), `<Desc/>\r\n`);
    expect(await descIndexIn(mod)).toBe("UI");
    await declare(mod, { files: [{ path: QUAY, source: "UI/Layout/Quay.SC2Layout" }] }, { "UI/Layout/Quay.SC2Layout": QUAY_SOURCE });
    expect(await descIndexIn(mod)).toBe("Package files");
  });

  it("files it under Package files while the Blueprint turns a UI Component on, which has a layout", async () => {
    const mod = await setup();
    await put(path.join(mod.modPackage, ...DESC_INDEX.split("/")), `<Desc/>\r\n`);
    await declare(mod, { ui: { banner: {} } });
    expect(await descIndexIn(mod)).toBe("Package files");
  });
});

describe("convert-files and the DescIndex", () => {
  it("leaves a Kept DescIndex out when it takes every layout, since the compile generates it", async () => {
    const mod = await setup();
    await put(path.join(mod.modPackage, ...DESC_INDEX.split("/")), `<Desc>\r\n    <Include path="UI/Layout/Harbour.SC2Layout"/>\r\n</Desc>\r\n`);
    const { converted } = await convertFiles(mod.blueprintPath);
    expect(converted).toContain(HARBOUR);
    expect(converted).not.toContain(DESC_INDEX);
  });

  it("refuses a named DescIndex as one the compile generates, once the Blueprint has a layout", async () => {
    const mod = await setup();
    await put(path.join(mod.modPackage, ...DESC_INDEX.split("/")), `<Desc/>\r\n`);
    await declare(mod, { files: [{ path: QUAY, source: "UI/Layout/Quay.SC2Layout" }] }, { "UI/Layout/Quay.SC2Layout": QUAY_SOURCE });
    await expect(convertFiles(mod.blueprintPath, { paths: [DESC_INDEX] })).rejects.toThrow(/is one the compile generates/);
  });

  it("refuses a named DescIndex as Kept until the Blueprint has a layout", async () => {
    const mod = await setup();
    await put(path.join(mod.modPackage, ...DESC_INDEX.split("/")), `<Desc/>\r\n`);
    await expect(convertFiles(mod.blueprintPath, { paths: [DESC_INDEX] })).rejects.toThrow(/stays Kept while the Blueprint has no layout/);
  });
});
