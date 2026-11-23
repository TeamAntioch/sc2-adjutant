// The stretches of a boundary between texture sets that need cover (#539): where different
// textures meet in a hard cut, and where a texture meets itself in an artifact. The map is the
// Editor's two-set sample (tests/fixtures/editor-terrain/texture-sets/): CharDunes (set 1) on
// blocks 7-9 × 6-8, cells 56-79 × 48-71, BelShirEx1 (set 0) round it. Its masks are replaced here
// by ones painted for each case.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { readKeptTextures, type KeptTextures } from "../../src/kept-terrain/paint-brushes.js";
import { readCellFlagCells } from "../../src/kept-terrain/kept-cliffs.js";
import { describeStretches, setBoundaryStretches, setBoundaryWarnings } from "../../src/kept-terrain/set-boundaries.js";
import { writeT3CellFlags } from "../../src/terrain/write-t3-cell-flags.js";
import { describeBoundaries } from "../../src/kept-terrain/texture-usage.js";
import { renderBoundaries } from "../../src/map/texture-usage.js";
import { CELL_FLAG_CLIFF } from "../../src/terrain/cliffs.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/editor-terrain/texture-sets/", import.meta.url));
const SIZE = 128;
const SAMPLE = readKeptTextures(readFileSync(`${FIXTURES}t3Terrain.xml`, "utf8"), gunzipSync(readFileSync(`${FIXTURES}t3TextureMasks.gz`)), readFileSync(`${FIXTURES}t3SyncTextureInfo`));

/** The sample with every texel all 15 on `layer`, then `paint` cells all 15 on other layers. */
function painted(layer: number, paint: readonly { readonly x: number; readonly y: number; readonly layer: number }[] = [], slots = SAMPLE.slots): KeptTextures {
  const { maskWidth, maskHeight } = SAMPLE.masks;
  const layers = Array.from({ length: 8 }, (_, l) => new Uint8Array(maskWidth * maskHeight).fill(l === layer ? 15 : 0));
  for (const cell of paint) {
    for (let ty = cell.y * 8; ty < cell.y * 8 + 8; ty++) {
      for (let tx = cell.x * 8; tx < cell.x * 8 + 8; tx++) for (let l = 0; l < 8; l++) layers[l]![ty * maskWidth + tx] = l === cell.layer ? 15 : 0;
    }
  }
  return { ...SAMPLE, slots, masks: { maskWidth, maskHeight, layers } };
}

const column = (x: number, y0: number, y1: number, layer: number) => Array.from({ length: y1 - y0 + 1 }, (_, i) => ({ x, y: y0 + i, layer }));

describe("a boundary between texture sets", () => {
  it("is listed stretch by stretch where different textures meet: a hard cut along each block edge, with its cells and the texture on each side", () => {
    const { stretches } = setBoundaryStretches(painted(0));
    // Layer 0 is BelShirDirtLight in set 0 and CharDunes_1 in set 1: the square's four sides cut hard.
    const dirt = { set: 0, texture: "BelShirDirtLight" };
    const dunes = { set: 1, texture: "CharDunes_1" };
    expect(stretches).toEqual([
      { kind: "cut", line: "x", at: 56, from: 48, to: 71, sides: [dirt, dunes], shared: [] },
      { kind: "cut", line: "x", at: 80, from: 48, to: 71, sides: [dunes, dirt], shared: [] },
      { kind: "cut", line: "y", at: 48, from: 56, to: 79, sides: [dirt, dunes], shared: [] },
      { kind: "cut", line: "y", at: 72, from: 56, to: 79, sides: [dunes, dirt], shared: [] },
    ]);
    expect(describeStretches(stretches)[0]).toBe("Hard cut along x = 56, y 48-71 (24 cells): BelShirDirtLight (set 0, cells at x 55) | CharDunes_1 (set 1, cells at x 56)");
  });

  it("splits a stretch where the texture on one side changes", () => {
    // Grass (set 0's layer 1) on cells (55, 60-63), west of the square.
    const { stretches } = setBoundaryStretches(painted(0, column(55, 60, 63, 1)));
    const west = stretches.filter((stretch) => stretch.line === "x" && stretch.at === 56);
    expect(west.map(({ from, to, sides }) => [from, to, sides[0].texture])).toEqual([
      [48, 59, "BelShirDirtLight"],
      [60, 63, "BelShirGrassLight"],
      [64, 71, "BelShirDirtLight"],
    ]);
  });

  it("lists a texture meeting itself as an artifact, whatever slot it has on each side", () => {
    // BelShirDirtLight in set 1's slot 1 too, painted on the square's west column of cells.
    const slots = SAMPLE.slots.map((name, slot) => (slot === 9 ? "BelShirDirtLight" : name));
    const { stretches } = setBoundaryStretches(painted(0, column(56, 48, 71, 1), slots));
    const itself = [{ set: 0, texture: "BelShirDirtLight" }, { set: 1, texture: "BelShirDirtLight" }];
    // The column's corner cells sit on the south and north edges too.
    expect(stretches.filter((stretch) => stretch.kind === "artifact")).toEqual([
      { kind: "artifact", line: "x", at: 56, from: 48, to: 71, sides: itself, shared: ["BelShirDirtLight"] },
      { kind: "artifact", line: "y", at: 48, from: 56, to: 56, sides: itself, shared: ["BelShirDirtLight"] },
      { kind: "artifact", line: "y", at: 72, from: 56, to: 56, sides: [...itself].reverse(), shared: ["BelShirDirtLight"] },
    ]);
    expect(describeStretches(stretches.filter((stretch) => stretch.kind === "artifact"))[0]).toBe(
      "Artifact along x = 56, y 48-71 (24 cells), BelShirDirtLight meeting itself: BelShirDirtLight (set 0, cells at x 55) | BelShirDirtLight (set 1, cells at x 56)",
    );
    // The rest of the square's sides still cut hard.
    expect(stretches.filter((stretch) => stretch.kind === "cut").map(({ line, at, from, to }) => [line, at, from, to])).toEqual([
      ["x", 80, 48, 71],
      ["y", 48, 57, 79],
      ["y", 72, 57, 79],
    ]);
  });

  it("names no texture for a side with no weight, rather than the set's first", () => {
    const textures = painted(0);
    // Cell (55, 60), west of the square, with no weight on any layer.
    for (let ty = 60 * 8; ty < 61 * 8; ty++) for (let tx = 55 * 8; tx < 56 * 8; tx++) for (const layer of textures.masks.layers) layer[ty * textures.masks.maskWidth + tx] = 0;
    const lone = setBoundaryStretches(textures).stretches.find((stretch) => stretch.line === "x" && stretch.at === 56 && stretch.from === 60);
    expect(lone).toMatchObject({ kind: "cut", to: 60, sides: [{ set: 0, texture: "" }, { set: 1, texture: "CharDunes_1" }] });
    expect(describeStretches([lone!])[0]).toContain("(empty slot) (set 0, cells at x 55)");
  });

  it("leaves out the cells under a cliff, on either side, and counts them", () => {
    const cellFlags = new Uint8Array(SIZE * SIZE);
    // A cliff over cells (54-55, 48-55), on the set-0 side of the square's west edge, and (60-63, 72) on the set-0 side of its north edge.
    for (let y = 48; y <= 55; y++) for (const x of [54, 55]) cellFlags[y * SIZE + x] = CELL_FLAG_CLIFF;
    for (let x = 60; x <= 63; x++) cellFlags[72 * SIZE + x] = CELL_FLAG_CLIFF;
    const { stretches, underCliff } = setBoundaryStretches(painted(0), { cellFlags });
    expect(stretches.filter((stretch) => stretch.line === "x" && stretch.at === 56).map(({ from, to }) => [from, to])).toEqual([[56, 71]]);
    expect(stretches.filter((stretch) => stretch.line === "y" && stretch.at === 72).map(({ from, to }) => [from, to])).toEqual([[56, 59], [64, 79]]);
    expect(underCliff).toBe(12);
  });

  it("warns for a written set only of the stretches on its own boundary, and gives a stretch two written sets share to the first", () => {
    const square = { set: { id: "square" }, index: 1 };
    const [warning] = setBoundaryWarnings({ written: [square] }, painted(0), new Uint8Array(SIZE * SIZE));
    expect(warning).toMatch(/^Texture set square's boundary needs cover along 4 stretches of block edge/);
    expect(setBoundaryWarnings({ written: [{ set: { id: "far" }, index: 2 }] }, painted(0), new Uint8Array(SIZE * SIZE))).toEqual([]);
    const both = setBoundaryWarnings({ written: [{ set: { id: "rest" }, index: 0 }, square] }, painted(0), new Uint8Array(SIZE * SIZE));
    expect(both).toHaveLength(1);
    expect(both[0]).toMatch(/^Texture set rest's boundary needs cover along 4 stretches/);
  });

  it("starts texture_usage's section with a blank line, when every stretch is under a cliff too", () => {
    const stretches = setBoundaryStretches(painted(0)).stretches;
    expect(describeBoundaries({ stretches, underCliff: 0 })[0]).toBe("");
    expect(describeBoundaries({ stretches: [], underCliff: 3 })).toEqual(["", "Set boundaries: every stretch is under a cliff. 3 pairs of cells under a cliff left out."]);
    expect(describeBoundaries({ stretches: [], underCliff: 0 })).toEqual([]);
  });

  it("counts the pairs left out under a cliff in the compile's warning, as texture_usage does", () => {
    const cellFlags = new Uint8Array(SIZE * SIZE);
    for (let y = 48; y <= 55; y++) for (const x of [54, 55]) cellFlags[y * SIZE + x] = CELL_FLAG_CLIFF;
    for (let x = 60; x <= 63; x++) cellFlags[72 * SIZE + x] = CELL_FLAG_CLIFF;
    const [warning] = setBoundaryWarnings({ written: [{ set: { id: "square" }, index: 1 }] }, painted(0), cellFlags);
    expect(warning).toContain("12 pairs of cells under a cliff left out");
    expect(setBoundaryWarnings({ written: [{ set: { id: "square" }, index: 1 }] }, painted(0), new Uint8Array(SIZE * SIZE))[0]).not.toContain("under a cliff");
  });

  it("reads the cliff cells only from an LFCT file of the map's own width and height", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cell-flags-"));
    try {
      const flags = new Uint8Array(32 * 16).fill(2);
      flags[3] = CELL_FLAG_CLIFF;
      const file = writeT3CellFlags({ width: 32, height: 16, flags });
      writeFileSync(path.join(dir, "t3CellFlags"), file);
      expect((await readCellFlagCells(dir, 32, 16))?.[3]).toBe(CELL_FLAG_CLIFF);
      // The same bytes for a 16×32 map: transposed, so not this map's.
      expect(await readCellFlagCells(dir, 16, 32)).toBeUndefined();
      const corrupt = Buffer.from(file);
      corrupt.write("XXXX", 0, "ascii");
      writeFileSync(path.join(dir, "t3CellFlags"), corrupt);
      expect(await readCellFlagCells(dir, 32, 16)).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is rendered one view to each cluster of stretches, so sets far apart don't make a map-wide render", () => {
    // Two one-block sets, at opposite corners of the map.
    const blockSets = new Uint8Array(SAMPLE.blockSets.length);
    blockSets[1 * SAMPLE.blocksPerRow + 1] = 1;
    blockSets[13 * SAMPLE.blocksPerRow + 13] = 1;
    const textures = { ...painted(0), blockSets };
    const { views } = renderBoundaries(textures, setBoundaryStretches(textures).stretches);
    expect(views.map((view) => view.area)).toEqual([
      { x: 0, y: 0, width: 25, height: 25 },
      { x: 95, y: 95, width: 26, height: 26 },
    ]);
  });

  it("is rendered over the ground round it, each stretch one pixel either side of its block edge, north up", () => {
    const textures = painted(0);
    const { views, legend } = renderBoundaries(textures, setBoundaryStretches(textures).stretches);
    expect(views).toHaveLength(1);
    expect(views[0]!.area).toEqual({ x: 47, y: 39, width: 42, height: 42 });
    const { image } = views[0]!;
    // The stretches reach cells 55-80 × 47-72, so with 8 cells of margin the window is cells 47-88 × 39-80:
    // 42 cells at 4 pixels a cell, 168 pixels, scaled 3 times to 504.
    expect([image.width, image.height]).toEqual([504, 504]);
    const at = (px: number, py: number) => `rgb(${[...image.rgb.subarray((py * 3 * image.width + px * 3) * 3, (py * 3 * image.width + px * 3) * 3 + 3)].join(",")})`;
    // x = 56 lies between pixel columns 35 and 36; cell row 60 is pixel rows 80-83, counted from the top (north).
    expect([at(35, 81), at(36, 81)]).toEqual([legend["hard cut"], legend["hard cut"]]);
    expect(at(30, 81)).toBe(legend.BelShirDirtLight);
    // y = 72, the square's north edge, lies between pixel rows 35 and 36; cell column 60 is pixel columns 52-55.
    expect([at(53, 35), at(53, 36)]).toEqual([legend["hard cut"], legend["hard cut"]]);
    expect(at(53, 30)).toBe(legend.BelShirDirtLight);
    expect(at(53, 60)).toBe(legend.CharDunes_1);
  });
});
