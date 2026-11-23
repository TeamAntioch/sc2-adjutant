import { describe, expect, it } from "vitest";

import { cutHeight, keptMaterials, renderIndex } from "../../src/capture/set-views.js";

describe("a model's cached materials file", () => {
  const materials = { composites: [], speculars: [{ material: 0, texture: "/cache/plate_spec.dds", multiplier: 2 }], blends: [], kinds: ["standard"] };

  it("is kept when the current reading wrote it, and read again when an older one did or it lacks a field", () => {
    expect(keptMaterials({ version: 2, ...materials }, true)).toEqual(materials);
    expect(keptMaterials(materials, true)).toBeUndefined();
    expect(keptMaterials({ version: 2, ...materials, kinds: undefined }, true)).toBeUndefined();
    expect(keptMaterials(undefined, true)).toBeUndefined();
  });

  it("from an older reading is kept on a host that can't export the model file to read it again", () => {
    expect(keptMaterials(materials, false)).toEqual(materials);
    expect(keptMaterials({ ...materials, kinds: undefined }, false)).toBeUndefined();
  });
});

const mark = (z: number) => ({ guid: "", name: `Mark ${z}`, model: "M", at: [0, 0, z] as const, facing: 0 });
const camera = (eyeHeight: number) => ({ guid: "", name: "Cam", target: [0, 0, 0] as const, eye: [0, 0] as const, eyeHeight, fov: 27.8 });

describe("where the plan cuts a set", () => {
  it("cuts 3 over the median mark, else 1.5 over the median lens, else not at all", () => {
    expect(cutHeight({ marks: [mark(8), mark(8.2), mark(20)], cameras: [camera(1)] })).toBeCloseTo(11.2);
    expect(cutHeight({ marks: [], cameras: [camera(4), camera(6), camera(5)] })).toBeCloseTo(6.5);
    expect(cutHeight({ marks: [], cameras: [] })).toBeUndefined();
  });
});

describe("the reference page", () => {
  it("lists each set's plan, overview and cameras with its size, and says what wasn't drawn", () => {
    const page = renderIndex([{ id: "bar", name: "Bar <1>", size: [12.4, 11.6, 9.9], cameras: ["Tracking Camera"], missing: ["MicStand"], pieces: 4, files: 2, marks: ["Bartender"] }]);
    expect(page).toContain("Bar &lt;1&gt;");
    expect(page).toContain("12 × 12 × 10 cells");
    expect(page).toContain('src="bar/plan.jpg"');
    expect(page).toContain('src="bar/cam-01.jpg"');
    expect(page).toContain("Tracking Camera");
    expect(page).toContain("4 pieces · in 2 files");
    expect(page).toContain("Staged with: Bartender");
    expect(page).toContain("Not drawn (no model file): MicStand");
  });
});
