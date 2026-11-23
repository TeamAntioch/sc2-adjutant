// Doodad ground outlines (src/catalog/doodad-outlines.ts) and the solid mesh they're cut from
// (src/catalog/m3-mesh.ts), on synthetic .m3 files and meshes.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { recordDoodadOutlines } from "../../src/catalog/record-doodad-outlines.js";
import { bareHost } from "../../src/host/host.js";

import { bundledDoodadOutlines, groundOutline, loadOutline, OUTLINE_STEP, outlineCovers, storeOutline } from "../../src/catalog/doodad-outlines.js";
import { readM3SolidMesh, type M3Mesh } from "../../src/catalog/m3-mesh.js";
import { m3 } from "../fixtures/m3.js";

type Vec3 = [number, number, number];

/** A closed box's 12 triangles, from (x0, y0, z0) to (x1, y1, z1). */
function box([x0, y0, z0]: Vec3, [x1, y1, z1]: Vec3, base = 0): { vertices: Vec3[]; faces: number[] } {
  const vertices: Vec3[] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const quads = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return { vertices, faces: quads.flatMap(([a, b, c, d]) => [a!, b!, c!, a!, c!, d!].map((index) => index + base)) };
}

/** Boxes as one mesh. */
function mesh(...boxes: [Vec3, Vec3][]): M3Mesh {
  const parts = boxes.map(([from, to], i) => box(from, to, 8 * i));
  return { positions: Float32Array.from(parts.flatMap((part) => part.vertices.flat())), triangles: Uint32Array.from(parts.flatMap((part) => part.faces)) };
}

const solid = (outline: NonNullable<ReturnType<typeof groundOutline>>): number => outline.bits.reduce((sum, bit) => sum + bit, 0) * OUTLINE_STEP * OUTLINE_STEP;

describe("reading a model's solid mesh", () => {
  const { vertices, faces } = box([-1, -0.5, 0], [1, 0.5, 2]);
  const bounds = { min: [-1, -0.5, 0] as const, max: [1, 0.5, 2] as const };

  it("reads the triangles a batch draws with an opaque material", () => {
    const read = readM3SolidMesh(m3([], { bounds, materials: [{ blendMode: 0 }], vertices, faces, batches: [0] }));
    expect(read.triangles.length).toBe(36);
    expect(Array.from(read.positions.slice(0, 3))).toEqual([-1, -0.5, 0]);
  });

  it("leaves out a region drawn only with a see-through material, or by no batch", () => {
    expect(readM3SolidMesh(m3([], { bounds, materials: [{ blendMode: 2 }], vertices, faces, batches: [0] })).triangles.length).toBe(0);
    expect(readM3SolidMesh(m3([], { bounds, materials: [{ blendMode: 0 }], vertices, faces, batches: [] })).triangles.length).toBe(0);
  });
});

describe("a doodad's ground outline", () => {
  it("fills a closed box's footprint at a unit's height", () => {
    const outline = groundOutline(mesh([[-1, -0.5, 0], [1, 0.5, 2]]))!;
    // 2 cells², and at most a pixel more each way, where a face is drawn.
    expect(solid(outline)).toBeGreaterThanOrEqual(2);
    expect(solid(outline)).toBeLessThanOrEqual((2 + OUTLINE_STEP) * (1 + OUTLINE_STEP));
    expect(outlineCovers(outline, 0, 0)).toBe(true);
    expect(outlineCovers(outline, 0.9, 0.4)).toBe(true);
    expect(outlineCovers(outline, 0, 0.7)).toBe(false);
    expect(outlineCovers(outline, -1.2, 0)).toBe(false);
  });

  it("takes an arch's legs but not its span above a unit's head, nor a flat inlay", () => {
    // Two legs to 3 high, a span from 2 to 3 over the gap between them.
    const arch = groundOutline(mesh([[-2, -0.5, 0], [-1, 0.5, 3]], [[1, -0.5, 0], [2, 0.5, 3]], [[-1, -0.5, 2], [1, 0.5, 3]]))!;
    expect(outlineCovers(arch, -1.5, 0)).toBe(true);
    expect(outlineCovers(arch, 1.5, 0)).toBe(true);
    expect(outlineCovers(arch, 0, 0)).toBe(false);
    expect(groundOutline(mesh([[-2, -2, -0.1], [2, 2, 0.1]]))).toBeNull();
  });

  it("keeps an open-backed wall (a single face) as a thin band", () => {
    const wall: M3Mesh = { positions: Float32Array.from([-2, 0, 0, 2, 0, 0, 2, 0, 2, -2, 0, 2]), triangles: Uint32Array.from([0, 1, 2, 0, 2, 3]) };
    const outline = groundOutline(wall)!;
    expect(outlineCovers(outline, 0, 0.01)).toBe(true);
    expect(outlineCovers(outline, 0, 0.4)).toBe(false);
    expect(outline.height).toBeLessThanOrEqual(2);
  });

  it("stores and loads an outline bit for bit", () => {
    const outline = groundOutline(mesh([[-1, -0.5, 0], [1, 0.5, 2]], [[1.5, 1, 0], [2, 3, 1]]))!;
    expect(loadOutline(storeOutline(outline))).toEqual(outline);
  });

  it("has every variation of each doodad in the data file", () => {
    for (const [id, { variations }] of bundledDoodadOutlines()) expect(variations.length, id).toBeGreaterThan(0);
  });
});

describe("a big model's outline", () => {
  it("is cut from more segments than a call takes arguments", () => {
    // 10,000 slivers of boxes: 320,000 cut segments, over a million ends.
    const boxes: [Vec3, Vec3][] = [];
    for (let i = 0; i < 10_000; i++) {
      const [x, y] = [(i % 100) / 100, Math.floor(i / 100) / 100];
      boxes.push([[x, y, 0], [x + 0.005, y + 0.005, 2]]);
    }
    const outline = groundOutline(mesh(...boxes));
    expect(outline).not.toBeNull();
    expect(outline!.width * OUTLINE_STEP).toBeGreaterThan(0.9);
  });
});

describe("recording outlines", () => {
  it("drops outlines made at another step, as the compile can't read them at this one", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-outlines-"));
    try {
      // A stock doodad's 4 variations as a mod's own files, read without the Host Adapter.
      const assets = path.join(folder, "Base.SC2Assets");
      const dir = path.join(assets, "Assets/Doodads/Aiur_Temple_Pillars");
      await mkdir(dir, { recursive: true });
      const { vertices, faces } = box([-0.5, -0.5, 0], [0.5, 0.5, 2]);
      const model = m3([], { bounds: { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 2] }, materials: [{ blendMode: 0 }], vertices, faces, batches: [0] });
      for (let variation = 0; variation < 4; variation++) await writeFile(path.join(dir, `Aiur_Temple_Pillars_0${variation}.m3`), model);
      const catalogPath = path.join(folder, "doodad-outlines.json");
      await writeFile(catalogPath, JSON.stringify({ about: "", step: 0.25, slices: [0.5], doodads: { Old_Rock: { model: "Old_Rock.m3", variations: [null] } } }));

      const result = await recordDoodadOutlines(bareHost(), ["Aiur_Temple_Pillars"], { modelData: [], assetRoots: [assets], catalogPath });
      expect(result.failed).toEqual([]);
      expect(result.dropped).toEqual(["Old_Rock"]);
      const written = JSON.parse(await readFile(catalogPath, "utf8")) as { step: number; doodads: Record<string, { variations: unknown[] }> };
      expect(written.step).toBe(OUTLINE_STEP);
      expect(Object.keys(written.doodads)).toEqual(["Aiur_Temple_Pillars"]);
      expect(written.doodads.Aiur_Temple_Pillars!.variations).toHaveLength(4);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
