import { describe, expect, it } from "vitest";

import { readM3MaterialTextures, readM3TexturePaths } from "../../src/catalog/m3-textures.js";
import { m3 } from "../fixtures/m3.js";

describe("readM3TexturePaths", () => {
  it("reads each image path the model names, once, and nothing else", () => {
    const data = m3([{ name: "Stand", start: 0, end: 1000, speed: 0, flags: 0 }], {
      strings: ["Assets\\Textures\\Gate_Diffuse.dds", "Assets/Textures/Gate_Spec.DDS", "Assets\\Textures\\Gate_Diffuse.dds", "Ref_Center", "Assets/Textures/Screen.ogv"],
    });
    expect(readM3TexturePaths(data)).toEqual(["Assets\\Textures\\Gate_Diffuse.dds", "Assets/Textures/Gate_Spec.DDS", "Assets/Textures/Screen.ogv"]);
  });

  it("refuses a file that isn't an MD34", () => {
    expect(() => readM3TexturePaths(new Uint8Array(16))).toThrow(/MD34/);
  });
});

describe("readM3MaterialTextures", () => {
  const bounds = { min: [-1, -1, 0], max: [1, 1, 2] } as const;

  it("names each standard material's textures by layer, as the Pylon's body and crystal share theirs", () => {
    // MAT_ version 20's layers: 0 diffuse, 2 specular, 4 emissive, 6 environment, 7 its mask, 8 alpha mask.
    const data = m3([], {
      bounds,
      materials: [{ blendMode: 0 }, { type: 3 }, { blendMode: 0 }],
      composites: [[{ material: 0, weight: 1 }]],
      materialLayers: [
        { name: "pylon_te", layers: { 0: "Assets/Textures/Pylon_Diffuse.dds", 2: "Assets/Textures/Pylon_Specular.dds" } },
        {
          name: "pylon_crystal_zeus",
          layers: { 0: "Assets/Textures/Pylon_Diffuse.dds", 4: "Assets/Textures/Pylon_Emissive.dds", 6: "Assets/Textures/EnviroTest2.dds", 7: "Assets/Textures/Pylon_Specular.dds", 8: "Assets/Textures/Pylon_Specular.dds" },
        },
      ],
    });
    expect(readM3MaterialTextures(data)).toEqual([
      {
        material: 0,
        name: "pylon_te",
        layers: [
          { slot: "diffuse", texture: "Assets/Textures/Pylon_Diffuse.dds" },
          { slot: "specular", texture: "Assets/Textures/Pylon_Specular.dds" },
        ],
      },
      {
        material: 2,
        name: "pylon_crystal_zeus",
        layers: [
          { slot: "diffuse", texture: "Assets/Textures/Pylon_Diffuse.dds" },
          { slot: "emissive", texture: "Assets/Textures/Pylon_Emissive.dds" },
          { slot: "environment", texture: "Assets/Textures/EnviroTest2.dds" },
          { slot: "environmentMask", texture: "Assets/Textures/Pylon_Specular.dds" },
          { slot: "alphaMask", texture: "Assets/Textures/Pylon_Specular.dds" },
        ],
      },
    ]);
  });

  it("reads an older MAT_ by its own layout: no environment HDR floats, and no gloss layer before version 16", () => {
    // MAT_ version 15's layers: 0 diffuse, 1 decal, 2 specular, 3 emissive (no gloss), ... 9 normal.
    const data = m3([], { bounds, matVersion: 15, materials: [{ blendMode: 0 }], materialLayers: [{ name: "old", layers: { 3: "Assets/Textures/Old_Emissive.dds", 9: "Assets/Textures/Old_Normal.dds" } }] });
    expect(readM3MaterialTextures(data)).toEqual([
      {
        material: 0,
        name: "old",
        layers: [
          { slot: "emissive", texture: "Assets/Textures/Old_Emissive.dds" },
          { slot: "normal", texture: "Assets/Textures/Old_Normal.dds" },
        ],
      },
    ]);
  });

  it("gives a model with no materials none", () => {
    expect(readM3MaterialTextures(m3([], { bounds }))).toEqual([]);
  });
});
