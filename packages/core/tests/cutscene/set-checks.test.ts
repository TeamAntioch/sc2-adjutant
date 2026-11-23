// A Set's pieces that flicker under a moving camera (#266; the cinematography skill's BUILT-SETS.md,
// "Give each overlapping flat piece its own height" and "Match overlapping decals exactly"), found
// from the models' recorded footprints.
import { describe, expect, it } from "vitest";

import type { ModelFootprints } from "../../src/catalog/model-footprints.js";
import { setPieceChecks } from "../../src/cutscene/set-checks.js";
import type { SetData, SetPiece } from "../../src/domain/cinematic-set.js";

const FOOTPRINTS: ModelFootprints = {
  // 10 x 10 x 1: flat, as a ground plate is.
  Slab: { file: "Assets/Slab.m3", min: [-5, -5, -0.5], max: [5, 5, 0.5], materials: ["opaque"] },
  // 2 x 2, 0.02 high.
  Tile: { file: "Assets/Tile.m3", min: [-1, -1, 0], max: [1, 1, 0.02], materials: ["opaque"] },
  Boulder: { file: "Assets/Boulder.m3", min: [-1, -1, 0], max: [1, 1, 2], materials: ["opaque"] },
  // A see-through mound on the ground, 6 x 6 x 1.
  Drift: { file: "Assets/Drift.m3", min: [-3, -3, 0], max: [3, 3, 1], materials: ["blend"] },
  // See-through, but as tall as it's wide: a volume, not a decal.
  Mist: { file: "Assets/Mist.m3", min: [-5, -5, -5], max: [5, 5, 5], materials: ["blend"] },
  // Particles only: no mesh, so no footprint.
  Embers: { file: "Assets/Embers.m3", min: [0, 0, 0], max: [0, 0, 0], materials: ["add", "blend"] },
  // Part see-through, part solid: a solid piece.
  Pit: { file: "Assets/Pit.m3", min: [-3, -3, 0], max: [3, 3, 0.2], materials: ["blend", "opaque"] },
};

const setOf = (pieces: readonly SetPiece[]): SetData => ({ name: "Plain", lights: [], pieces: [...pieces], marks: [], cameras: [], lamps: [] });
const checked = (...pieces: SetPiece[]) => setPieceChecks(setOf(pieces), FOOTPRINTS);

describe("flat pieces overlapping at one height", () => {
  it("warns on the later of two flat pieces that overlap with their tops at one height", () => {
    expect(checked({ model: "Slab", at: [0, 0, 0] }, { model: "Slab", at: [4, 0, 0] })).toEqual([
      {
        path: "pieces.1",
        message: "Slab overlaps pieces.0 (Slab) at one height (z 0.50): flat pieces that do z-fight and flicker under a moving camera, so set it a few hundredths of a cell higher or lower",
        severity: "warning",
      },
    ]);
  });

  it("warns once on a piece that overlaps several, naming each", () => {
    expect(checked({ model: "Slab", at: [0, 0, 0] }, { model: "Tile", at: [14.5, 0, 0.48] }, { model: "Slab", at: [9, 0, 0] })).toEqual([
      expect.objectContaining({ path: "pieces.2", message: expect.stringMatching(/^Slab overlaps pieces\.0 \(Slab\) and pieces\.1 \(Tile\) at one height \(z 0\.50\)/) }),
    ]);
    expect(checked({ model: "Drift", at: [0, 0, 0], tint: [1, 0, 0] }, { model: "Drift", at: [4, 0, 0], tint: [1, 0, 0], variation: 2 }, { model: "Drift", at: [2, 0, 0] })).toEqual([
      expect.objectContaining({ path: "pieces.1" }),
      expect.objectContaining({ path: "pieces.2", message: expect.stringContaining("overlaps pieces.0 and pieces.1 with a different tint and variation:") }),
    ]);
  });

  it("takes a piece's top from its scale, so a thicker slab lower down can lie at another's height", () => {
    expect(checked({ model: "Slab", at: [0, 0, 0], scale: 2 }, { model: "Slab", at: [4, 0, 0.5] })).toHaveLength(1);
    expect(checked({ model: "Slab", at: [0, 0, 0], scale: [2, 2, 1] }, { model: "Slab", at: [4, 0, 0.5] })).toEqual([]);
  });

  it("passes flat pieces a few hundredths of a cell apart, or apart on the ground", () => {
    expect(checked({ model: "Slab", at: [0, 0, 0] }, { model: "Slab", at: [4, 0, 0.02] })).toEqual([]);
    // 0.02 apart, however the sums round.
    expect(checked({ model: "Slab", at: [0, 0, -0.4], scale: 1.3 }, { model: "Slab", at: [4, 0, -0.42], scale: 1.3 })).toEqual([]);
    expect(checked({ model: "Slab", at: [0, 0, 0] }, { model: "Slab", at: [10.5, 0, 0] })).toEqual([]);
  });

  it("turns each footprint by its rotation", () => {
    // 2.2 apart, two 2-cell tiles miss each other; turned 45 degrees, the second's corner reaches the first.
    expect(checked({ model: "Tile", at: [0, 0, 0] }, { model: "Tile", at: [2.2, 0, 0] })).toEqual([]);
    expect(checked({ model: "Tile", at: [0, 0, 0] }, { model: "Tile", at: [2.2, 0, 0], rotation: 45 })).toHaveLength(1);
    expect(checked({ model: "Tile", at: [0, 0, 0] }, { model: "Tile", at: [2.2, 0, 0], rotation: [0, 0, 45] })).toHaveLength(1);
  });

  it("passes pieces that aren't flat, tilted differently, hidden, or never in a shot together", () => {
    expect(checked({ model: "Boulder", at: [0, 0, 0] }, { model: "Boulder", at: [1, 0, 0] })).toEqual([]);
    expect(checked({ model: "Slab", at: [0, 0, 0], rotation: [3, 0, 0] }, { model: "Slab", at: [4, 0, 0], rotation: [0, -2, 0] })).toEqual([]);
    expect(checked({ model: "Slab", at: [0, 0, 0], hidden: true }, { model: "Slab", at: [4, 0, 0] })).toEqual([]);
    expect(checked({ model: "Slab", at: [0, 0, 0], shots: ["Wide"] }, { model: "Slab", at: [4, 0, 0], shots: ["Close"] })).toEqual([]);
  });

  it("warns on flat pieces tilted alike in one plane, and passes them on parallel planes", () => {
    // Tilted 3 degrees about x, a plane rises 4 tan 3 = 0.21 cells over 4 cells along y.
    expect(checked({ model: "Slab", at: [0, 0, 0], rotation: [3, 0, 10] }, { model: "Slab", at: [4, 0, 0], rotation: [3, 0, 10] })).toHaveLength(1);
    expect(checked({ model: "Slab", at: [0, 0, 0], rotation: [3, 0, 0] }, { model: "Slab", at: [0, 4, 0.21], rotation: [3, 0, 0] })).toHaveLength(1);
    expect(checked({ model: "Slab", at: [0, 0, 0], rotation: [3, 0, 0] }, { model: "Slab", at: [0, 4, 0], rotation: [3, 0, 0] })).toEqual([]);
  });

  it("reads a rotation by the orientation it gives, however it's written", () => {
    // (180, 180, 0) turns a piece as 180 about z does.
    expect(checked({ model: "Slab", at: [0, 0, 0], rotation: [180, 180, 0] }, { model: "Slab", at: [4, 0, 0], rotation: 180 })).toHaveLength(1);
  });

  it("passes a model whose footprint isn't recorded", () => {
    expect(checked({ model: "Unknown", at: [0, 0, 0] }, { model: "Unknown", at: [0, 0, 0] })).toEqual([]);
  });
});

describe("overlapping see-through decals", () => {
  it("warns on the later of two overlapping decals whose tint, variation or rotation differ, at any height", () => {
    expect(checked({ model: "Drift", at: [0, 0, 0] }, { model: "Drift", at: [2, 0, 0.3], tint: [0.8, 0.6, 0.4] })).toEqual([
      {
        path: "pieces.1",
        message: "Drift, see-through, overlaps pieces.0 with a different tint: overlapping decals re-sort every frame and flicker as the camera moves, so give them the same tint, variation and rotation, and darken only solid pieces",
        severity: "warning",
      },
    ]);
    expect(checked({ model: "Drift", at: [0, 0, 0], variation: 1 }, { model: "Drift", at: [2, 0, 0], rotation: 30 })).toEqual([
      expect.objectContaining({ path: "pieces.1", message: expect.stringContaining("with a different variation and rotation") }),
    ]);
  });

  it("passes overlapping decals that match, however their rotation is written", () => {
    expect(checked({ model: "Drift", at: [0, 0, 0], tint: [1, 1, 1], rotation: 30 }, { model: "Drift", at: [2, 0, 0], variation: 0, rotation: [0, 0, 390] })).toEqual([]);
    expect(checked({ model: "Drift", at: [0, 0, 0], rotation: 180 }, { model: "Drift", at: [2, 0, 0], rotation: [180, 180, 0] })).toEqual([]);
  });

  it("takes a solid flat piece faded below full opacity as a see-through decal", () => {
    expect(checked({ model: "Slab", at: [0, 0, 0], opacity: 0.5 }, { model: "Slab", at: [4, 0, 0.3], opacity: 0.5, tint: [0.5, 0.5, 0.5] })).toEqual([
      expect.objectContaining({ path: "pieces.1", message: expect.stringMatching(/^Slab, see-through, overlaps pieces\.0 with a different tint:/) }),
    ]);
  });

  it("passes decals apart, and see-through pieces that aren't decals or aren't wholly see-through", () => {
    expect(checked({ model: "Drift", at: [0, 0, 0] }, { model: "Drift", at: [7, 0, 0], tint: [0.5, 0.5, 0.5] })).toEqual([]);
    expect(checked({ model: "Mist", at: [0, 0, 0] }, { model: "Mist", at: [1, 0, 0], tint: [0.5, 0.5, 0.5] })).toEqual([]);
    expect(checked({ model: "Pit", at: [0, 0, 0] }, { model: "Pit", at: [1, 0, 0.3], tint: [0.5, 0.5, 0.5] })).toEqual([]);
    expect(checked({ model: "Embers", at: [0, 0, 0] }, { model: "Embers", at: [0, 0, 0], tint: [0.5, 0.5, 0.5] })).toEqual([]);
  });
});
