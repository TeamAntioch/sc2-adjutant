import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findDecalVariations } from "@team-antioch/sc2-asset-catalog/catalog/decal-catalog.js";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { listDoodads, stockDecals } from "../../src/catalog/stock-catalog.js";
import { getDecalVariations, randomVariations } from "../../src/dressing/decal-variations.js";

// The package checks its descriptions' vocabulary; these check they fit core's doodads, as dressing reads them.
describe("the decal catalog", () => {
  // A cache holding an extract-decals run, which a compile must not read.
  let cache: string;
  const before = process.env.SC2_ASSET_CATALOG_CACHE;
  beforeAll(() => {
    cache = mkdtempSync(path.join(tmpdir(), "decal-cache-"));
    mkdirSync(path.join(cache, "extracted"));
    writeFileSync(path.join(cache, "extracted", "decal-extracted.json"), JSON.stringify({ Decal: [{ texture: "Assets/Textures/decal_00.dds", size: [2, 2] }] }));
    process.env.SC2_ASSET_CATALOG_CACHE = cache;
  });
  afterAll(() => {
    if (before === undefined) delete process.env.SC2_ASSET_CATALOG_CACHE;
    else process.env.SC2_ASSET_CATALOG_CACHE = before;
    rmSync(cache, { recursive: true, force: true });
  });

  it("describes every variation of every decal doodad core knows", () => {
    const decals = listDoodads().filter(([, info]) => info.kind === "decal");
    expect(Object.keys(stockDecals()).sort()).toEqual(decals.map(([type]) => type).sort());
    for (const [type, info] of decals) expect(getDecalVariations(EMPTY_CATALOG, type), type).toHaveLength(info.variations);
  });

  it("is the descriptions alone in a compile, whatever this machine has extracted", () => {
    for (const variations of Object.values(stockDecals())) for (const variation of variations) expect(variation.size ?? variation.texture ?? variation.drawn).toBeUndefined();
  });

  it("finds plain floor markings with no glyphs", () => {
    const plain = findDecalVariations({ glyphs: ["none"], use: ["marking"], shows: ["stripe"], tiles: true }, stockDecals());
    expect(plain.length).toBeGreaterThan(40);
    expect(plain.every((v) => v.glyphs === "none" && v.shows.includes("stripe"))).toBe(true);
    expect(plain).toContainEqual(expect.objectContaining({ doodad: "Decal", variation: 1 }));
  });

  it("finds a decal by its words", () => {
    expect(findDecalVariations({ words: ["do not enter"] }, stockDecals()).map((v) => `${v.doodad} ${v.variation}`)).toEqual(["Decal 27", "Decal_Baked 27"]);
  });

  it("picks at random only what can go anywhere, else everything", () => {
    const catalog = EMPTY_CATALOG;
    expect(randomVariations(catalog, "BattleStation_Number_Decals")).toHaveLength(10);
    expect(randomVariations(catalog, "Decal")).toEqual([0, 1, 2, 3, 17, 18, 19, 20, 21]);
    expect(randomVariations(catalog, "DOM_Decals")).not.toContain(13);
  });
});
