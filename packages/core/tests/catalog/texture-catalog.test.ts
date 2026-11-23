import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readCoreDoodadCatalog, stockCliffs, stockTextures } from "../../src/catalog/stock-catalog.js";

const read = (name: string): unknown => JSON.parse(readFileSync(new URL(`../../data/${name}`, import.meta.url), "utf8"));

describe("doodad catalog", () => {
  const doodads = readCoreDoodadCatalog().catalog as Record<
    string,
    {
      image?: string;
      rendered?: boolean;
      description?: { look: string; kind: string; size: string; role: string; story: string[]; biome: string[]; uses?: unknown };
    }
  >;
  const known = read("doodads.json") as Record<string, unknown>;

  it("lists every doodad, and describes pictured or rendered ones in the dressing vocabulary", () => {
    expect(Object.keys(doodads).sort()).toEqual(Object.keys(known).sort());
    const described = Object.entries(doodads).filter(([, entry]) => entry.description);
    expect(described.length).toBeGreaterThan(2000);
    for (const [id, entry] of described) {
      const d = entry.description!;
      // From a gallery picture, or from a WhiteoutFlakes thumbnail (npm run thumbnails).
      expect(entry.image ?? entry.rendered, id).toBeDefined();
      expect(["natural", "built", "creature"], id).toContain(d.kind);
      expect(["tiny", "small", "medium", "large", "huge"], id).toContain(d.size);
      expect(["cliff", "structure", "prop", "clutter", "foliage", "decal", "effect"], id).toContain(d.role);
      expect(d.look.length, id).toBeGreaterThan(0);
      // Doodad Uses, when it has them, are short phrases (contribute_doodad_notes adds them).
      if (d.uses !== undefined) expect(Array.isArray(d.uses) && d.uses.every((use) => typeof use === "string" && use.length > 0), id).toBe(true);
    }
  });
});

describe("cliff catalog", () => {
  // The package checks its descriptions' vocabulary; this checks they fit core's extracted fields.
  const { entries, tilesets } = stockCliffs();
  const cliffs = new Map(entries.map((entry) => [entry.id, entry]));

  it("lists every cliff set the tilesets use, and describes every pictured one", () => {
    for (const [tileset, sets] of Object.entries(tilesets)) {
      for (const set of sets) expect(cliffs.get(set)?.tilesets, set).toContain(tileset);
    }
    for (const [id, entry] of cliffs) expect(entry.description !== undefined, id).toBe(entry.image !== undefined);
    expect(stockCliffs().unextracted).toEqual([]);
  });
});

describe("texture catalog", () => {
  // The package checks its descriptions' vocabulary; this checks they fit core's extracted fields.
  const { entries, tilesets } = stockTextures();
  const catalog = new Map(entries.map((entry) => [entry.id, entry]));

  it("lists every texture the tilesets use, with the tilesets that use it", () => {
    for (const [tileset, textures] of Object.entries(tilesets)) {
      for (const texture of textures) if (texture) expect(catalog.get(texture)?.tilesets, texture).toContain(tileset);
    }
  });

  it("describes every pictured texture, and only those without a picture from their name", () => {
    for (const [id, entry] of catalog) {
      if (entry.image) expect(entry.description, id).toBeDefined();
      if (entry.description) expect(entry.description.seen === false, id).toBe(entry.image === undefined);
    }
    expect(stockTextures().unextracted).toEqual([]);
  });
});
