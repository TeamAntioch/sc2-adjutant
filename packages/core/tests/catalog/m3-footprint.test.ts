// A model's footprint from its .m3 (#266): the bounds its MODL record gives, and what its materials
// draw as, so `check` can tell a flat piece and a see-through decal.
import { describe, expect, it } from "vitest";

import { readM3Composites, readM3Footprint, readM3MeshExtent, readM3Speculars } from "../../src/catalog/m3-footprint.js";
import { m3 } from "../fixtures/m3.js";

const STAND = [{ name: "Stand", start: 0, end: 1000, speed: 0, flags: 0 }];

describe("readM3Footprint", () => {
  it("reads the model's bounds and each of its materials, a standard one by its blend mode", () => {
    const footprint = readM3Footprint(
      m3(STAND, {
        bounds: { min: [-2.5, -3, -0.25], max: [2.5, 3, 0.75] },
        materials: [{ blendMode: 0 }, { type: 4 }, { blendMode: 1 }, { blendMode: 2 }],
      }),
    );
    expect(footprint).toEqual({ min: [-2.5, -3, -0.25], max: [2.5, 3, 0.75], materials: ["opaque", "terrain", "blend", "add"] });
  });

  it("refuses a file that isn't an MD34", () => {
    expect(() => readM3Footprint(new Uint8Array(16))).toThrow(/MD34/);
  });
});

describe("readM3MeshExtent", () => {
  it("reads the box the mesh's vertices fill, which can reach past the model's bounds", () => {
    const data = m3(STAND, { bounds: { min: [-2, -2, -0.25], max: [2, 2, 2] }, vertices: [[-16.25, 3, 0], [16.25, -14.1, 2.2], [0, 14.1, 1]] });
    expect(readM3MeshExtent(data)).toEqual({ min: [-16.25, -14.1, 0], max: [16.25, 14.1, 2.2] });
  });

  it("gives nothing for a model with no mesh", () => {
    expect(readM3MeshExtent(m3(STAND, { bounds: { min: [0, 0, 0], max: [1, 1, 1] } }))).toBeUndefined();
  });
});

describe("readM3Composites", () => {
  const bounds = { min: [0, 0, 0], max: [1, 1, 1] } as const;

  it("reads each composite's sections, by their place in the material references", () => {
    const data = m3(STAND, {
      bounds,
      materials: [{ blendMode: 0 }, { blendMode: 1 }, { type: 3 }, { blendMode: 0 }, { type: 3 }],
      composites: [[{ material: 0, weight: 1 }, { material: 1, weight: 0.5 }], [{ material: 3, weight: 1 }]],
    });
    expect(readM3Composites(data)).toEqual([
      { material: 2, sections: [{ material: 0, weight: 1 }, { material: 1, weight: 0.5 }] },
      { material: 4, sections: [{ material: 3, weight: 1 }] },
    ]);
  });

  it("keeps a composite's standard sections only, and gives nothing for a model with none", () => {
    const mirrored = m3(STAND, { bounds, materials: [{ blendMode: 0 }, { type: 10 }, { type: 3 }, { type: 3 }], composites: [[{ material: 0, weight: 1 }, { material: 1, weight: 1 }], [{ material: 2, weight: 1 }]] });
    expect(readM3Composites(mirrored)).toEqual([{ material: 2, sections: [{ material: 0, weight: 1 }] }]);
    expect(readM3Composites(m3(STAND, { bounds, materials: [{ blendMode: 0 }] }))).toEqual([]);
  });
});

describe("readM3Speculars", () => {
  it("reads each standard material's specular map and multiplier, by its place in the material references", () => {
    const data = m3(STAND, {
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      materials: [{ blendMode: 0 }, { type: 4 }, { blendMode: 0 }, { blendMode: 1 }],
      specularMaps: ["Assets\\Textures\\Hull_Spec.dds", undefined, "Assets/Textures/Floor_Spec.dds"],
    });
    expect(readM3Speculars(data)).toEqual([
      { material: 0, texture: "Assets\\Textures\\Hull_Spec.dds", multiplier: 2 },
      { material: 3, texture: "Assets/Textures/Floor_Spec.dds", multiplier: 2 },
    ]);
  });

  it("finds the specular layer where each MAT_ version keeps it", () => {
    // Before version 20 the layers start 12 bytes earlier, so version 20's specular offset is the
    // next layer: the gloss from version 16, the emissive at 15.
    for (const matVersion of [15, 16, 19, 20] as const) {
      const data = m3(STAND, {
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
        materials: [{ blendMode: 0 }],
        materialLayers: [{ layers: { 0: "Assets/Textures/Hull_Diffuse.dds", 2: "Assets/Textures/Hull_Spec.dds", 3: "Assets/Textures/Hull_Next.dds" } }],
        matVersion,
      });
      expect(readM3Speculars(data), `MAT_ version ${matVersion}`).toEqual([{ material: 0, texture: "Assets/Textures/Hull_Spec.dds", multiplier: 0 }]);
    }
  });
});
