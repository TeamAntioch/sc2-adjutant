// The height layer of Map Study's renders: sculpted height within a cliff level, which the
// elevation layer (cliff levels as grey steps) can't show.
import { describe, expect, it } from "vitest";

import { editKeptTerrain } from "../../src/map/edit-kept-terrain.js";
import { loadMapPackage } from "../../src/study/load-map-package.js";
import { buildMapStudy } from "../../src/study/map-study.js";
import { renderElevation, renderHeight } from "../../src/study/render-layers.js";
import { buildTerrainGrid } from "../../src/study/terrain-grid.js";
import { keptGround, removeKeptGround } from "../support/kept-ground.js";

describe("the height layer", () => {
  it("shows a flatten of a quarter unit that the elevation layer can't", async () => {
    const fixture = await keptGround();
    try {
      // Flat ground at 8, then flattened a quarter unit higher.
      const area = { rect: { x: 18, y: 62, width: 4, height: 4 }, falloff: "sharp" as const };
      await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area, brush: { op: "flatten", to: 8 } }, { leaveDoodads: true });
      const before = loadMapPackage(fixture.mapPackage);
      const result = await editKeptTerrain(fixture.workspace, fixture.blueprintPath, { area, brush: { op: "flatten", to: 8.25 } }, { leaveDoodads: true });
      expect(result.change.max).toBeCloseTo(0.25, 3);
      const after = loadMapPackage(fixture.mapPackage);

      const range = [7, 9] as const;
      const grid = buildTerrainGrid(before);
      expect(Buffer.from(renderElevation(buildTerrainGrid(after)).rgb).equals(Buffer.from(renderElevation(grid).rgb))).toBe(true);
      const heightBefore = renderHeight(grid, before.heightMap.heights, range);
      const heightAfter = renderHeight(grid, after.heightMap.heights, range);
      // Pixels inside the area (cells 18..21, 62..65; north up, 4 px a cell) change, and far from it none do.
      const changedPixels = (x0: number, y0: number, x1: number, y1: number) => {
        let count = 0;
        for (let py = (128 - y1) * 4; py < (128 - y0) * 4; py++) {
          for (let px = x0 * 4; px < x1 * 4; px++) {
            const o = (py * heightBefore.width + px) * 3;
            if (heightBefore.rgb[o] !== heightAfter.rgb[o] || heightBefore.rgb[o + 1] !== heightAfter.rgb[o + 1] || heightBefore.rgb[o + 2] !== heightAfter.rgb[o + 2]) count++;
          }
        }
        return count;
      };
      expect(changedPixels(18, 62, 22, 66)).toBeGreaterThan(0.5 * 4 * 4 * 16);
      expect(changedPixels(60, 60, 128, 128)).toBe(0);
    } finally {
      await removeKeptGround(fixture);
    }
  }, 60_000);

  it("is one of Map Study's layer renders", async () => {
    const fixture = await keptGround();
    try {
      const { images, study } = buildMapStudy({ id: "quarry", provenance: "synthetic" }, loadMapPackage(fixture.mapPackage));
      expect(images["height.png"]).toMatchObject({ width: 512, height: 512 });
      expect(study.layers.note).toContain("height.png: shaded relief");
    } finally {
      await removeKeptGround(fixture);
    }
  }, 60_000);
});
