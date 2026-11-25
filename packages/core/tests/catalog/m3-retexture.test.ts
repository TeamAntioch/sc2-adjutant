// The retexture step (catalog/m3-retexture.ts): an .m3's layer image paths pointed at other files,
// of any length, the rest of the model left as it was.
import { describe, expect, it } from "vitest";

import { retextureM3 } from "../../src/catalog/m3-retexture.js";
import { m3Index, readM3Sequences } from "../../src/catalog/m3-sequences.js";
import { readM3MaterialTextures, readM3TexturePaths } from "../../src/catalog/m3-textures.js";
import { m3 } from "../fixtures/m3.js";

const bounds = { min: [-1, -1, 0], max: [1, 1, 2] } as const;
const storm = () =>
  m3([{ name: "Birth", start: 0, end: 500, speed: 0, flags: 0 }], {
    bounds,
    materials: [{ blendMode: 2 }, { blendMode: 2 }],
    materialLayers: [
      { name: "storm_core", layers: { 0: "Assets\\Textures\\PsiStorm_Diffuse.dds", 4: "Assets\\Textures\\PsiStorm_Glow.dds" } },
      { name: "storm_ring", layers: { 0: "Assets\\Textures\\PsiStorm_Diffuse.dds" } },
    ],
  });

describe("retextureM3", () => {
  it("points every layer naming a texture at its new path, longer than the old, and leaves the rest", () => {
    const data = storm();
    const out = retextureM3(data, { "assets/textures/psistorm_diffuse.dds": "Assets/Textures/RedPsiStorm_Diffuse_Recoloured.dds" });

    expect(readM3MaterialTextures(out)).toEqual([
      { material: 0, name: "storm_core", layers: [{ slot: "diffuse", texture: "Assets/Textures/RedPsiStorm_Diffuse_Recoloured.dds" }, { slot: "emissive", texture: "Assets\\Textures\\PsiStorm_Glow.dds" }] },
      { material: 1, name: "storm_ring", layers: [{ slot: "diffuse", texture: "Assets/Textures/RedPsiStorm_Diffuse_Recoloured.dds" }] },
    ]);
    expect(readM3TexturePaths(out)).not.toContain("Assets\\Textures\\PsiStorm_Diffuse.dds");
    expect(readM3Sequences(out)).toEqual(readM3Sequences(data));
    // The index is last, 16-byte aligned, and every other entry is as it was.
    const [before, after] = [m3Index(data), m3Index(out)];
    expect(after.indexOffset % 16).toBe(0);
    expect(after.indexOffset + 16 * after.entries.length).toBe(out.length);
    const changed = after.entries.flatMap((entry, i) => (JSON.stringify(entry) === JSON.stringify(before.entries[i]) ? [] : [i]));
    expect(changed.every((i) => after.entries[i]!.tag === "RAHC")).toBe(true);
  });

  it("takes a shorter path too", () => {
    const out = retextureM3(storm(), { "Assets\\Textures\\PsiStorm_Glow.dds": "Assets/Textures/G.dds" });
    expect(readM3MaterialTextures(out)[0]!.layers[1]).toEqual({ slot: "emissive", texture: "Assets/Textures/G.dds" });
  });

  it("refuses a texture no layer names, naming the ones they do", () => {
    expect(() => retextureM3(storm(), { "Assets/Textures/Nope.dds": "Assets/Textures/X.dds" })).toThrow(
      /the model's layers don't name Assets\/Textures\/Nope\.dds: they name Assets\\Textures\\PsiStorm_Diffuse\.dds, Assets\\Textures\\PsiStorm_Glow\.dds/,
    );
  });
});
