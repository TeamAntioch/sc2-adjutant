// decal_variations through the MCP server: the published catalog's decals, filtered, with what
// the package's extract-decals put in its cache (SC2_ASSET_CATALOG_CACHE, a temporary folder here).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { connect, fixture, text } from "./harness.js";

type Match = { doodad: string; variation: number; glyphs: string; use: string; text?: string; size?: number[]; texture?: string };

describe("decal_variations", () => {
  let cache: string;
  const before = process.env.SC2_ASSET_CATALOG_CACHE;
  beforeEach(() => {
    cache = mkdtempSync(path.join(tmpdir(), "decal-cache-"));
    process.env.SC2_ASSET_CATALOG_CACHE = cache;
  });
  afterEach(() => {
    if (before === undefined) delete process.env.SC2_ASSET_CATALOG_CACHE;
    else process.env.SC2_ASSET_CATALOG_CACHE = before;
    rmSync(cache, { recursive: true, force: true });
  });

  it("lists plain floor markings with no glyphs", async () => {
    const client = await connect(fixture("crossing"));
    const reply = await client.callTool({ name: "decal_variations", arguments: { doodads: ["Decal"], glyphs: ["none"], use: ["marking"] } });
    expect(reply.isError).toBeFalsy();
    const matches = (reply.structuredContent as { matches: Match[] }).matches;
    expect(matches.map((match) => match.variation)).toEqual([0, 1, 2, 3, 17, 18, 19, 20, 21]);
    expect(text(reply)).toMatch(/^Decal 0: yellow-and-black hazard stripe, a quarter curve \(corner, tiles, marking\)/);
  });

  it("finds what a decal reads", async () => {
    const client = await connect(fixture("crossing"));
    const reply = await client.callTool({ name: "decal_variations", arguments: { words: ["research bay"] } });
    expect((reply.structuredContent as { matches: Match[] }).matches).toEqual([expect.objectContaining({ doodad: "DOM_Decals", variation: 12, glyphs: "words", text: "RESEARCH BAY", use: "label" })]);
  });

  it("adds each variation's texture, size and sheet once extract-decals has filled the cache", async () => {
    mkdirSync(path.join(cache, "extracted"));
    writeFileSync(path.join(cache, "extracted", "decal-extracted.json"), JSON.stringify({ Decal: [{ texture: "Assets/Textures/decal_00.dds", size: [2, 2] }] }));
    mkdirSync(path.join(cache, "catalog-sheets", "decals"), { recursive: true });
    const sheet = path.join(cache, "catalog-sheets", "decals", "Decal.jpg");
    writeFileSync(sheet, "");
    const client = await connect(fixture("crossing"));
    const reply = await client.callTool({ name: "decal_variations", arguments: { doodads: ["Decal"], glyphs: ["none"], use: ["marking"] } });
    const { matches, sheets } = reply.structuredContent as { matches: Match[]; sheets: Record<string, string> };
    expect(matches[0]).toEqual(expect.objectContaining({ variation: 0, texture: "Assets/Textures/decal_00.dds", size: [2, 2] }));
    expect(sheets).toEqual({ Decal: sheet });
    expect(text(reply)).toMatch(/^Decal 0: .*\(corner, tiles, marking, 2×2 cells\)/);
    expect(text(reply)).toContain(`Decal sheet: ${sheet}`);
  });
});
