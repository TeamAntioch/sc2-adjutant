// Texture swaps on a doodad (#834, docs/reference/texture-swaps.md): the CModel's TextureDeclares,
// a CTexture per swap and the actor's TextureSelectById events the compile writes, and the checks
// of a doodad's swaps against its model's textures. The models are synthetic.
import { describe, expect, it } from "vitest";

import { CustomDoodadSchema } from "../../src/domain/custom-doodad.js";
import { customDoodadEntries } from "../../src/mods/custom-doodads.js";
import { entryXml } from "../../src/mods/generic-entries.js";
import { checkDoodadSwaps } from "../../src/mods/texture-swaps.js";
import { m3 } from "../fixtures/m3.js";

const PYLON = "Assets/Buildings/Protoss/PylonEx2/PylonEx2.m3";
const EMISSIVE = "Assets/Textures/Pylon_Emissive.dds";
const ENVIRO = "Assets/Textures/EnviroTest2.dds";

describe("a doodad's swap entries", () => {
  it("declare a slot per swap on its CModel, file a CTexture in each, and send each on ActorCreation and ModelSwapped after the default removals", () => {
    const doodad = CustomDoodadSchema.parse({ id: "GreenPylon", model: PYLON, gameModel: true });
    const swaps = [
      { replace: EMISSIVE, with: "Assets/Textures/Green_Pylon_Emissive.dds", component: "emissive" as const },
      { replace: ENVIRO, with: "Assets/Textures/Green_EnviroTest2.dds" },
    ];

    expect(customDoodadEntries(doodad, swaps).map(entryXml)).toEqual([
      [
        `    <CModel id="GreenPylon" parent="Doodad">`,
        `        <Model value="Assets\\Buildings\\Protoss\\PylonEx2\\PylonEx2.m3"/>`,
        `        <TextureDeclares Prefix="Pylon_Emissive">`,
        `            <Adaptions Slot="swap1"/>`,
        `        </TextureDeclares>`,
        `        <TextureDeclares Prefix="EnviroTest2">`,
        `            <Adaptions Slot="swap2"/>`,
        `        </TextureDeclares>`,
        `    </CModel>`,
      ].join("\n"),
      [
        `    <CActorDoodad id="GreenPylon">`,
        `        <On index="0" removed="1"/>`,
        `        <On index="1" removed="1"/>`,
        `        <On Terms="ActorCreation" Send="TextureSelectById GreenPylon_Swap1"/>`,
        `        <On Terms="ModelSwapped" Send="TextureSelectById GreenPylon_Swap1"/>`,
        `        <On Terms="ActorCreation" Send="TextureSelectById GreenPylon_Swap2"/>`,
        `        <On Terms="ModelSwapped" Send="TextureSelectById GreenPylon_Swap2"/>`,
        `        <RandomScaleRange value="1.000000,1.000000"/>`,
        `    </CActorDoodad>`,
      ].join("\n"),
      [`    <CTexture id="GreenPylon_Swap1">`, `        <File value="Assets\\Textures\\Green_Pylon_Emissive.dds"/>`, `        <Slot value="swap1.emissive"/>`, `    </CTexture>`].join("\n"),
      [`    <CTexture id="GreenPylon_Swap2">`, `        <File value="Assets\\Textures\\Green_EnviroTest2.dds"/>`, `        <Slot value="swap2"/>`, `    </CTexture>`].join("\n"),
    ]);
  });

  it("go after the actor's own On list and the model's own TextureDeclares, when fields give them", () => {
    const doodad = CustomDoodadSchema.parse({
      id: "GreenPylon",
      model: PYLON,
      gameModel: true,
      animate: true,
      fields: {
        model: { TextureDeclares: { Prefix: "Glow_", Adaptions: { Slot: "glow" } } },
        actor: { On: [{ index: 0, removed: 1 }, { Terms: "ActorCreation", Send: "AnimPlay Stand Stand PlayForever" }] },
      },
    });
    const [model, actor] = customDoodadEntries(doodad, [{ replace: EMISSIVE, with: "Assets/Textures/Green_Pylon_Emissive.dds", component: "emissive" }]).map(entryXml);

    expect(model).toContain([`        <TextureDeclares Prefix="Glow_">`, `            <Adaptions Slot="glow"/>`, `        </TextureDeclares>`, `        <TextureDeclares Prefix="Pylon_Emissive">`].join("\n"));
    expect(actor).toContain(
      [
        `        <On index="0" removed="1"/>`,
        `        <On Terms="ActorCreation" Send="AnimPlay Stand Stand PlayForever"/>`,
        `        <On Terms="ActorCreation" Send="TextureSelectById GreenPylon_Swap1"/>`,
        `        <On Terms="ModelSwapped" Send="TextureSelectById GreenPylon_Swap1"/>`,
      ].join("\n"),
    );
  });

  it("are none without swaps", () => {
    const doodad = CustomDoodadSchema.parse({ id: "GreenPylon", model: PYLON, gameModel: true });
    expect(customDoodadEntries(doodad, []).map((entry) => entry.class)).toEqual(["CModel", "CActorDoodad"]);
  });
});

const DIFFUSE = "Assets/Textures/Pylon_Diffuse.dds";
const SPECULAR = "Assets/Textures/Pylon_Specular.dds";
const NORMAL = "Assets/Textures/Pylon_Normal.dds";
const GLOW = "Assets/Textures/Pylon_Emissive_Glow.dds";
/** A Pylon-like model: a body and a crystal sharing their diffuse and specular, the crystal with an environment map and the specular as its masks, and a glow. */
const MODEL = m3([], {
  bounds: { min: [-1, -1, 0], max: [1, 1, 2] },
  materials: [{ blendMode: 0 }, { blendMode: 0 }, { blendMode: 2 }],
  // MAT_ version 20's layers: 0 diffuse, 2 specular, 4 emissive, 6 environment, 7 its mask, 8 alpha mask, 10 normal.
  materialLayers: [
    { name: "pylon_te", layers: { 0: DIFFUSE, 2: SPECULAR, 10: NORMAL } },
    { name: "pylon_crystal_zeus", layers: { 0: DIFFUSE, 2: SPECULAR, 4: EMISSIVE, 6: ENVIRO, 7: SPECULAR, 8: SPECULAR } },
    { name: "07 - Default", layers: { 4: GLOW } },
  ],
});
const MODEL_FILE = { data: MODEL, where: "art/Pylon.m3" };
const GREEN = "Assets/Textures/Green.dds";
const loads = (storagePath: string) => storagePath.replace(/\\/g, "/").toLowerCase() === GREEN.toLowerCase();
const LOOKED_IN = "the doodad's own files";
const check = (swaps: readonly { replace: string; with: string }[], gameTextures: readonly string[] = []) =>
  checkDoodadSwaps({ model: PYLON, swaps, gameTextures }, "doodads.0 (GreenPylon)", MODEL_FILE, loads, LOOKED_IN);

describe("a doodad's swaps, checked against its model", () => {
  it("fill the component of the layer the model has each texture in, and the bare slot for any other layer", () => {
    const { slots, warnings } = check([
      { replace: "assets\\textures\\pylon_diffuse.DDS", with: GREEN },
      { replace: ENVIRO, with: GREEN },
      { replace: NORMAL, with: GREEN },
    ]);
    expect(slots).toEqual([
      { replace: "assets\\textures\\pylon_diffuse.DDS", with: GREEN, component: "diffuse" },
      { replace: ENVIRO, with: GREEN },
      { replace: NORMAL, with: GREEN, component: "normal" },
    ]);
    expect(warnings).toEqual([
      `doodads.0 (GreenPylon)'s swaps.0 replaces assets\\textures\\pylon_diffuse.DDS, which its model ${PYLON} has in more than one layer (pylon_te diffuse, pylon_crystal_zeus diffuse): the swap changes every one`,
    ]);
  });

  it("refuse a replace the model doesn't name, listing the textures it does", () => {
    expect(() => check([{ replace: "Assets/Textures/Pylon_Missing.dds", with: GREEN }])).toThrow(
      `doodads.0 (GreenPylon)'s swaps.0 replaces Assets/Textures/Pylon_Missing.dds, which its model ${PYLON} doesn't name. It names ${DIFFUSE}, ${SPECULAR}, ${NORMAL}, ${EMISSIVE}, ${ENVIRO}, ${GLOW}`,
    );
  });

  it("refuse a with the map won't load, and take one listed in gameTextures", () => {
    const dark = "Assets/Textures/Pylon_Diffuse_Dark.dds";
    expect(() => check([{ replace: ENVIRO, with: dark }])).toThrow(
      `doodads.0 (GreenPylon)'s swaps.0 draws ${dark}, which isn't in ${LOOKED_IN}: add the file there, or, when it is the game's own texture, list it in the doodad's gameTextures`,
    );
    expect(check([{ replace: ENVIRO, with: dark }], [dark]).slots).toEqual([{ replace: ENVIRO, with: dark }]);
  });

  it("refuse two swaps of one texture", () => {
    expect(() => check([{ replace: ENVIRO, with: GREEN }, { replace: "Assets\\Textures\\envirotest2.dds", with: GREEN }])).toThrow(
      `doodads.0 (GreenPylon)'s swaps.0 and swaps.1 both replace ${ENVIRO}: give each texture one swap`,
    );
  });

  it("warn when the replaced file's base name is the prefix of another texture the model names, which the declaration takes too", () => {
    expect(check([{ replace: EMISSIVE, with: GREEN }]).warnings).toEqual([
      `doodads.0 (GreenPylon)'s swaps.0 declares the prefix Pylon_Emissive, which also takes ${GLOW}, another texture its model ${PYLON} names: the swap may change that one too`,
    ]);
  });

  it("refuse two swaps of files of one base name, whose declarations would share a prefix", () => {
    expect(() => check([{ replace: ENVIRO, with: GREEN }, { replace: "Assets/Textures/Other/EnviroTest2.dds", with: GREEN }])).toThrow(
      `doodads.0 (GreenPylon)'s swaps.0 and swaps.1 replace files of one base name, EnviroTest2: one declaration's prefix takes both, so swap one of them`,
    );
  });

  it("warn when the texture is in layers of different components, of which its CTexture fills one", () => {
    const mixed = m3([], { bounds: { min: [-1, -1, 0], max: [1, 1, 2] }, materials: [{ blendMode: 0 }, { blendMode: 0 }], materialLayers: [{ name: "a", layers: { 0: GLOW } }, { name: "b", layers: { 4: GLOW } }] });
    const { slots, warnings } = checkDoodadSwaps({ model: PYLON, swaps: [{ replace: GLOW, with: GREEN }], gameTextures: [] }, "doodads.0 (GreenPylon)", { data: mixed, where: "art/Mixed.m3" }, loads, LOOKED_IN);
    expect(slots).toEqual([{ replace: GLOW, with: GREEN, component: "diffuse" }]);
    expect(warnings).toEqual([
      `doodads.0 (GreenPylon)'s swaps.0 replaces ${GLOW}, which its model ${PYLON} has in more than one layer (a diffuse, b emissive): its CTexture fills the diffuse alone, so the others may keep the model's texture`,
    ]);
  });

  it("warn when the bare slot goes to a layer other than an environment map, or to none, which the game wasn't seen to fill", () => {
    const masked = m3([], { bounds: { min: [-1, -1, 0], max: [1, 1, 2] }, materials: [{ blendMode: 0 }], materialLayers: [{ name: "a", layers: { 8: GLOW } }], strings: [DIFFUSE] });
    const swap = (replace: string) => checkDoodadSwaps({ model: PYLON, swaps: [{ replace, with: GREEN }], gameTextures: [] }, "doodads.0 (GreenPylon)", { data: masked, where: "art/Masked.m3" }, loads, LOOKED_IN);
    expect(swap(GLOW).warnings).toEqual([
      `doodads.0 (GreenPylon)'s swaps.0 replaces ${GLOW}, which its model ${PYLON} has in a's alphaMask layer: it goes in the bare slot swap1, which the game was seen to fill only for an environment map, so look at it in the game`,
    ]);
    expect(swap(DIFFUSE).warnings).toEqual([
      `doodads.0 (GreenPylon)'s swaps.0 replaces ${DIFFUSE}, which its model ${PYLON} has in no standard material's layer: it goes in the bare slot swap1, which the game was seen to fill only for an environment map, so look at it in the game`,
    ]);
  });

  it("warn when the replaced texture is in several layers or materials, listing them", () => {
    expect(check([{ replace: SPECULAR, with: GREEN }])).toEqual({
      slots: [{ replace: SPECULAR, with: GREEN, component: "specular" }],
      warnings: [
        `doodads.0 (GreenPylon)'s swaps.0 replaces ${SPECULAR}, which its model ${PYLON} has in more than one layer (pylon_te specular, pylon_crystal_zeus specular, pylon_crystal_zeus environmentMask, pylon_crystal_zeus alphaMask): the swap changes every one`,
      ],
    });
  });
});
