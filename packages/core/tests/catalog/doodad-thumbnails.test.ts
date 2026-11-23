import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { jobSheet, modelJob, modelPathCandidates, thumbnailFileName } from "@team-antioch/sc2-asset-catalog/catalog/doodad-thumbnails.js";
import { getDoodadModel, listDoodads } from "../../src/catalog/stock-catalog.js";
import { readPng } from "../../src/preview/read-png.js";
import { writeRgbaPng } from "../../src/preview/write-png.js";

/** A width×height RGBA image from rows of pixels. */
const image = (rows: number[][][]) => ({
  width: rows[0]!.length,
  height: rows.length,
  rgba: Uint8Array.from(rows.flat(2)),
});

describe("doodad thumbnails", () => {
  it("asks for numbered variation files, and either form for single-variation models", () => {
    // Seen in the WhiteoutFlakes spike: ShakurasRockColumn.m3 doesn't exist, _00 and _01 do.
    expect(modelPathCandidates("Assets/Doodads/ShakurasRockColumn/ShakurasRockColumn.m3", 1, 8)).toEqual([
      "Assets/Doodads/ShakurasRockColumn/ShakurasRockColumn_01.m3",
    ]);
    expect(modelPathCandidates("Assets/Doodads/ShakurasRockColumn/ShakurasRockColumn.m3", 0, 8)).toEqual([
      "Assets/Doodads/ShakurasRockColumn/ShakurasRockColumn_00.m3",
      "Assets/Doodads/ShakurasRockColumn/ShakurasRockColumn.m3",
    ]);
    expect(modelPathCandidates("Assets/Doodads/RockArch/RockArch.m3", 0, 1)).toEqual([
      "Assets/Doodads/RockArch/RockArch.m3",
      "Assets/Doodads/RockArch/RockArch_00.m3",
    ]);
  });

  it("finds models whose id differs from the doodad's", () => {
    // The actor names another CModel; the CModel's own file can live outside Assets/Doodads.
    expect(getDoodadModel("AiurTempleAdunGeneratorDoodad")).toBe(
      "Assets/Doodads/Aiur_Temple_AdunGenerator/Aiur_Temple_AdunGenerator.m3",
    );
    expect(getDoodadModel("Amon")).toBe("Assets/Units/Protoss/Amon/Amon.m3");
  });

  it("round-trips an RGBA PNG", () => {
    const original = image([
      [
        [1, 2, 3, 4],
        [250, 0, 250, 255],
      ],
      [
        [9, 8, 7, 0],
        [100, 150, 200, 128],
      ],
    ]);
    expect(readPng(writeRgbaPng(original))).toEqual(original);
  });

  it("names outputs by doodad, variation and angle", () => {
    expect(thumbnailFileName("ShakurasTree", 3, 2)).toBe("ShakurasTree_03_a2.png");
  });

  it("lists the whole catalog", () => {
    expect(listDoodads().length).toBeGreaterThan(2000);
  });

  it("puts each rendered variation's sheet beside its four renders", () => {
    expect(jobSheet({ type: "PortCityCrane", variation: 3 }, "/search/renders")).toEqual({
      renders: [0, 1, 2, 3].map((angle) => path.join("/search/renders", `PortCityCrane_03_a${angle}.png`)),
      sheet: path.join("/search/renders", "PortCityCrane_03.jpg"),
    });
  });

  it("renders a model no catalog lists, such as a Campaign Mod doodad's, from its file where the author typed it, else as a storage path", async () => {
    const ran = await mkdtemp(path.join(tmpdir(), "model-job-"));
    try {
      await mkdir(path.join(ran, "mods/story/Assets"), { recursive: true });
      await writeFile(path.join(ran, "mods/story/Assets/LiftCage.m3"), "m3");
      expect(modelJob("StoryLiftCage", "mods/story/Assets/LiftCage.m3", ran)).toEqual({ type: "StoryLiftCage", model: path.join(ran, "mods/story/Assets/LiftCage.m3"), variation: 0, variations: 1 });
      // The same file written the Editor's way is found on disk too.
      expect(modelJob("StoryLiftCage", "mods\\story\\Assets\\LiftCage.m3", ran)).toMatchObject({ model: path.join(ran, "mods/story/Assets/LiftCage.m3") });
      // A ModelData path the game holds, with the Editor's backslashes.
      expect(modelJob("Crusher", "Assets\\Doodads\\PortZionCrusher\\PortZionCrusher.m3", ran)).toMatchObject({ model: "Assets/Doodads/PortZionCrusher/PortZionCrusher.m3" });
    } finally {
      await rm(ran, { recursive: true, force: true });
    }
  });
});
