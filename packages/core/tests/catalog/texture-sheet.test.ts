// The game's terrain textures as core reads them (stock-catalog.ts: the published package's
// descriptions joined to core's data/texture-extracted.json), searched and drawn on a sheet
// (texture-sheet.ts). The package tests its own search, pictures and SVG; these check core's binding.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { lookUpTextures, searchTextures } from "@team-antioch/sc2-asset-catalog/catalog/texture-catalog.js";
import { afterEach, describe, expect, it } from "vitest";

import { getStockTexture, stockTextures } from "../../src/catalog/stock-catalog.js";
import { describeTexture, renderTextureSheet } from "../../src/catalog/texture-sheet.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("core's terrain textures", () => {
  it("joins the package's descriptions to core's extracted fields", () => {
    const panels = getStockTexture("MarSaraPanels");
    expect(panels?.tilesets).toContain("MarSara");
    expect(panels?.image).toBeDefined();
    expect(panels?.description?.suits).toContain("accent");
    expect(stockTextures().unextracted).toEqual([]);
  });

  it("are searched by their look, ranking the textures holding the most words first", () => {
    const found = searchTextures(stockTextures(), { words: ["mesh", "grating"], kind: "built", tones: ["dark"] });
    expect(found.length).toBeGreaterThan(5);
    // "BraxisAlphaMeshEx2" is "dark metal mesh grating": both words, so ahead of a mesh alone.
    const both = found.findIndex((texture) => texture.id === "BraxisAlphaMeshEx2");
    const one = found.findIndex((texture) => texture.id === "CastanarMeshEx2");
    expect(both).toBeGreaterThanOrEqual(0);
    expect(both).toBeLessThan(one);
    expect(describeTexture(found[both]!)).toMatch(/^BraxisAlphaMeshEx2 \(built, dark, [^)]+\): .*mesh grating/);
  });

  it("refuse an id the catalog doesn't have, naming near ones", () => {
    expect(() => lookUpTextures(stockTextures(), ["MarSaraPanel"])).toThrow(/MarSaraPanel isn't one of the game's terrain textures.*did you mean .*MarSaraPanels/);
  });
});

describe("the sheet", () => {
  it("keeps fetched pictures in the cache folder's texture-pictures, and lists the textures with none", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "texture-sheet-"));
    const [panels, mesh] = lookUpTextures(stockTextures(), ["MarSaraPanels", "BraxisAlphaMeshEx2"]);
    const fetcher = (async (url: string) => (url.includes(encodeURIComponent(panels!.image!)) ? new Response(JPEG) : new Response(null, { status: 404 }))) as typeof fetch;
    const { png, missing } = await renderTextureSheet([{ texture: panels!, label: "12 trim" }, { texture: mesh! }], { cacheDir: dir, fetch: fetcher });
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(missing).toEqual(["BraxisAlphaMeshEx2"]);
    expect(await readFile(path.join(dir, "texture-pictures", panels!.image!))).toEqual(JPEG);
  });
});
