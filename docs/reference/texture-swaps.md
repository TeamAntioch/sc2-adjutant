# Texture swaps on models

A model can draw other textures without being edited. The game swaps a texture on a live actor when the actor gets a message such as `TextureSelectById`. That's how Blizzard does Dark and Purifier Protoss buildings, Warcraft trees turning blighted, random civilian clothes. It's also how a community texture pack ([Nolanstar's Nerazim recolours](https://www.curseforge.com/sc2/assets/nolanstars-textures)) is meant to be used. It works with our own imported `.dds` files as well as the game's, and it costs a texture's bytes rather than a whole model's. [forum #32, #75]

It takes three pieces of data, and the swap fails silently if any of them doesn't match:

1. **The model declares a slot.** The `CModel`'s `TextureDeclares` maps the textures its `.m3` names to slot names.
2. **A texture is filed under that slot.** A `CTexture` names the new image and the slot it goes in.
3. **The actor sends the swap.** An actor event (or a trigger) sends `TextureSelectById <CTexture id>` to the actor drawing the model.

## With a Blueprint

A doodad in a Mission's or the Campaign Mod's Blueprint `doodads` declares its swaps with `swaps`, and the compile writes all three pieces and checks them against the model's `.m3` (the `custom-doodads` skill has the fields, refusals and warnings). The green Pylon crystal (below) is the game's own model with two swaps. Its compile warns that `Pylon_Emissive.dds` is in more than one material, the body's too; the hand-built copy's body still looked stock gold in the game.

```json
{
  "id": "GreenPylon",
  "model": "Assets/Buildings/Protoss/PylonEx2/PylonEx2.m3",
  "gameModel": true,
  "swaps": [
    { "replace": "Assets/Textures/Pylon_Emissive.dds", "with": "Assets/Textures/GreenPylon_Emissive.dds" },
    { "replace": "Assets/Textures/EnviroTest2.dds", "with": "Assets/Textures/GreenPylon_EnviroTest2.dds" }
  ],
  "textures": {
    "Assets/Textures/GreenPylon_Emissive.dds": "art/GreenPylon_Emissive.dds",
    "Assets/Textures/GreenPylon_EnviroTest2.dds": "art/GreenPylon_EnviroTest2.dds"
  }
}
```

Swap n declares `Prefix` = the replaced file's base name with slot `swap<n>`, a `CTexture` `<id>_Swap<n>` whose slot names the component of the layer the model has that texture in (`swap1.emissive`), or the bare slot for any other layer (`swap2`, the environment map), and `TextureSelectById` on `ActorCreation` and `ModelSwapped` (`packages/core/src/mods/texture-swaps.ts`). A Mission's new textures are in `textures` as above, Kept, a Workspace mod it depends on, or `gameTextures`; a Campaign Mod's are in its Asset Mod (or another mod package it loads) or `gameTextures`. A `gameModel`'s swaps read the game's `.m3` through the Host Adapter's `model.export`.

A swap reaches only a standard material's layers. For a model whose texture is anywhere else, such as many effects, the Asset Mod makes a recoloured copy of the model instead ([asset-sources.md](./asset-sources.md#recoloured-copies-of-stock-models)). Its `recolour` step can also make a swap's `with` texture from the game's own.

Write the XML below by hand for a map no Blueprint compiles, and for what `swaps` doesn't cover: random picks (`TextureSelectBySlot`), swaps a trigger or behaviour sends, and texture groups, through a doodad's `fields`.

## Sources

- **verified**: Blizzard's own data, as in the public [sc2-game-data](https://github.com/sc2-arcade-watcher/sc2-game-data) mirror, and the models and textures in the local 5.0 storage, read with a CASC extractor (`tools/README.md`).
- **forum #n**: SC2 Mapster's tutorial thread "[Data, Actor] [Events + Message] Texture Select By ID" (2011, posts #1-#100, pages 1-5 of 24). The live URL now redirects to CurseForge's front page; the author saved the five pages by hand. Post #1 is the tutorial; the rest are its corrections. They describe the 2011 Editor.
- **search excerpt**: a later post seen only as a search-result snippet, never read in full.
- **seen in game**: the test below, run with `capture_shots` on the Mac client (5.0.17) on 2026-11-20.

Nothing here has been checked in the Editor's viewport yet.

## Checked in the game

A throwaway copy of the Terrain Test Mission (`missions/terrain-test/output/texture-swap.SC2Map` in its Workspace, rebuilt by `build_texture_swap_maps.py` beside it) places five doodads, each its own `CModel` on the stock `PylonEx2.m3` and its own `CActorDoodad`. Each swapping model declares `<TextureDeclares Prefix="pylon_"><Adaptions TriggerOnSubstring="_Diffuse" Slot="campaign"/></TextureDeclares>`, and each `CTexture` has slot `campaign.diffuse`:

| Doodad | Its actor sends | In the game |
|---|---|---|
| `TSwapControl` | nothing (no declaration) | stock gold |
| `TSwapStock` | `TextureSelectById TSwapDarkDiffuse` (`pylon_diffuse_dark.dds`) on `ActorCreation` | dark Protoss |
| `TSwapOwn` | `TextureSelectById TSwapRedDiffuse`, our own `.dds` in the map, on `ActorCreation` | magenta |
| `TSwapTimer` | `TimerSet 0.100000 TSwap`, then the dark swap on `TimerExpired; TimerName TSwap` | dark Protoss |
| `TSwapShared` (second map only) | `TextureSelectById TSwapDarkDiffuse2`, a second `CTexture` on `pylon_diffuse_dark.dds` | dark Protoss, and `TSwapStock` and `TSwapTimer` stay dark |

What that settles:

- A placed doodad swaps its texture from its own actor's events, with a `CModel` of our own on a stock `.m3`.
- Matching ignores case: `pylon_` matched `Pylon_Diffuse.dds`.
- Our own texture (512×512 DXT5, 10 mips, like the original) works from the map's `Assets/Textures`.
- Two `CTexture`s naming one file both work, against forum #26.
- A diffuse swap barely shows on the crystal. Our magenta copy painted the crystal green and it stayed blue, though the crystal's material does use `Pylon_Diffuse.dds` (below).

### The Pylon's crystal

`readM3MaterialTextures` (`packages/core/src/catalog/m3-textures.ts`) lists each material's textures by layer. `PylonEx2.m3` has three materials: the body, `pylon_te`, and the crystal, `pylon_crystal_zeus`, share `Pylon_Diffuse.dds`, `Pylon_Specular.dds`, `Pylon_Emissive.dds` and `Pylon_Normal.dds`. The crystal adds `EnviroTest2.dds` as its environment (reflection) map, with `Pylon_Specular.dds` as its environment mask and alpha mask too. A third material, `07 - Default`, is the `Glow_Blue2.dds` glow.

A second copy (`texture-swap-crystal.SC2Map`, built by `texture-swap-src/build_crystal_map.py` beside it) gives five more Pylon doodads one declaration with `pylon_` mapping `_Diffuse`, `_Specular` and `_Emissive` to `campaign`, and `EnviroTest` mapping to `generic01`. Its textures are the stock ones with the hue turned, which makes the crystal's blue green and the body's gold and brown magenta:

| Doodad | Its actor swaps in | In the game |
|---|---|---|
| `TSwapCControl` | nothing | stock blue crystal |
| `TSwapCEmis` | green `Pylon_Emissive` (`campaign.emissive`) | blue crystal with green glowing veins |
| `TSwapCSpec` | `Pylon_Specular` turned from brown to magenta (`campaign.specular`) | no change seen, at this distance |
| `TSwapCEnvi` | green `EnviroTest2` (`generic01`) | cyan crystal: its blue reflection mixed with green |
| `TSwapCAll` | all four, the diffuse too | green crystal, and a magenta body from the diffuse |

So the crystal's colour is its emissive and its environment map together, and a green crystal takes both. Neither alone does it. Both are textures the body shares or other models name (`EnviroTest2.dds` is a common reflection map), so swap them through the doodad's own `CModel`, never by replacing the files.

Also settled here: a `CTexture` whose slot names the component (`campaign.emissive`) fills that component of a slot whose adaptions don't name it (`Slot="campaign"`), and a bare slot (`generic01`) on both sides fills the environment layer.

### A green crystal, and normal swaps

A third copy (`texture-swap-normal.SC2Map`, built by `texture-swap-src/build_normal_map.py`) checks the two swaps the crystal map left open. Its normal map, `TSwap_Ridges_pylon_normal.dds`, is 24 vertical sine ridges in SC2's normal swizzle (DXT5, R 1, G the y slope, B 0, A the x slope), so a working swap shows as stripes:

| Doodad | Its actor swaps in | In the game |
|---|---|---|
| `TSwapNControl` | nothing | stock blue crystal, smooth gold body |
| `TSwapNCrystal` | green `Pylon_Emissive` (`campaign.emissive`) and green `EnviroTest2` (`generic01`) | green crystal on the stock gold body |
| `TSwapNNormal` | the ridged normal (`campaign.normal`); the adaption maps `_Normal` to bare `campaign` | stripes across the gold ring and body |
| `TSwapNNormalNamed` | the same; the adaption maps `_Normal` to `campaign.normal` | the same stripes |

So a recoloured crystal needs only the emissive and the environment map, and the body keeps its own textures. Normal swaps work, and on the Pylon a bare adaption slot takes them as well as a named one. [seen in game, 2026-11-21, from 34 units away]

## 1. The model's slots: `TextureDeclares`

```xml
<CModel id="Pylon">          <!-- draws PylonEx2.m3 -->
    <TextureDeclares Prefix="pylon_">
        <Adaptions TriggerOnSubstring="_Diffuse" Slot="campaign"/>
        <Adaptions TriggerOnSubstring="_Specular" Slot="campaign"/>
        <Adaptions TriggerOnSubstring="_Emissive" Slot="campaign"/>
    </TextureDeclares>
</CModel>
```

- **`Prefix`** picks the model's textures whose **file name** (not path) starts with it. **`TriggerOnSubstring`** narrows that to file names that also contain it. An adaption with no substring takes every texture the prefix picks (`<TextureDeclares Prefix="grad_"><Adaptions Slot="generic02"/></TextureDeclares>`). [verified: liberty.sc2campaign and void.sc2campaign ModelData.xml]
- **Matching ignores case.** `PylonEx2.m3` names `Pylon_Diffuse.dds`, `Pylon_Specular.dds`, `Pylon_Emissive.dds` and `Pylon_Normal.dds` under `pylon_` and `_Diffuse`; `PhotonCannon.m3` names `PhotonCannon_Diffuse.dds`, `LazerBolt1_Blue.dds` and `Grad_Rays_Blue1.dds` under `photoncannon_`, `lazerbolt1_` and `grad_`. Blizzard ships these declarations beside the Dark Protoss swaps that need them. [verified: each m3's strings against the data; seen in game] The tutorial's "the Prefix (and possibly the Substring) seem to be case sensitive" was a guess from the Colossus, whose names are all lower case. [forum #1]
- **Keep the underscore** in the prefix and substring as the file name has it (`PrisonZealot_`, `_Diffuse`). The thread found it sometimes needed and sometimes not. [forum #1, #45, #84] It also stops `photoncannon_` from taking `PhotonCannonBase_…`.
- **Finding the names.** The Editor's Previewer (Ctrl+Shift+V, or Data > Preview Model) lists the model's materials and their textures when its materials button is pressed. [forum #1] We can read them without the Editor: `readM3TexturePaths` in `packages/core/src/catalog/m3-textures.ts` lists every texture an `.m3` names, and `readM3MaterialTextures` lists them by material and layer. Some models don't swap under the names the Previewer shows (the Mercenary Firebat's arms). [forum #26]
- **A slot has components.** A texture in a slot sits in one of its components: `diffuse`, `emissive`, `normal` or `specular` (the Galaxy constants `c_textureSlotComponentDiffuse` … `Specular`, with `Default` as 0). A bare slot name, `main`, takes its component from the material layer the matched texture is in. An adaption can name a component outright: the Zerg egg's declaration maps `_diffuse_` to `main`, `_emissive_` to `main.emissive`, `_normal_` to `main.normal`, `_specular_` to `main.specular`. [verified: liberty.sc2mod ModelData.xml `EggsplosionGeneric`; natives.galaxy] Some models only swap when the declaration names the component: the Xel'Naga obelisk took its emissive only with `main.emissive` in the adaption. [forum #85-#88] Naming the component in every adaption, as the egg does, is the safe default.
- **One declaration per prefix, several adaptions in it.** To swap a part's diffuse and emissive, give one `TextureDeclares` two adaptions, not two declarations: two "works sometimes, but tends to malfunction". [forum #84] When two adaptions map the same slot and substring, the higher index wins. [forum #4]
- **Slot names are free text, one per part.** Blizzard uses `main` (units), `campaign` (campaign-only recolours), `decal`, `reflection`, `video`, `background` and `generic01`-`generic05`. [verified] The tutorial lists `body`, `head`, `hair`, `terran`, `zerg`, `protoss` and `merc` too, and says any slot works for any texture. [forum #1, #91] A model with several parts declares one slot per part: the Photon Cannon declares `photoncannon_` as `main`, `photoncannonbase_` as `generic05`, `lazerbolt1_` as `generic01` and `grad_` as `generic02` [verified]; the Firebat's body and arms only both swapped once they were in different slots. [forum #35-#38] One forum report saw the head declared before the main needed for imported textures. [forum #36]
- **One texture name, every use.** If the model names one texture in several layers or materials, one swap replaces it everywhere. [forum #30]
- **A child model inherits the declarations** and removes ones it doesn't want by index: `<TextureDeclares index="2" removed="1"/>`. [verified: `DeathLaserBirth`] In the Editor's list, deleting any declaration or adaption but the last crashes the Editor: delete from the bottom up. [forum #1, #29]
- **What can't be swapped.** Team-colour areas, such as the Stone Zealot's glow lines. [forum #9] A texture the model names with no prefix-like part, such as Tassadar's `EnergyPlane3.dds` emissive, which one poster couldn't swap. [forum #62] That may just be a missing underscore: `grad_` works for Blizzard.

## 2. The new texture: `CTexture`

```xml
<CTexture id="PylonDarkDiffuse">
    <File value="Assets\Textures\pylon_diffuse_dark.dds"/>
    <Slot value="campaign.diffuse"/>
</CTexture>
```

- **`Slot`** is `<slot>.<component>`, the slot the model declares and the component it replaces: `main.diffuse`, `main.normal`, `generic05.emissive`, `hair.diffuse`. A bare `main` means the diffuse. [verified: 66 bare `main`, 55 `main.diffuse` in Blizzard's TextureData; forum #1]
- **Two `CTexture`s can name one file.** The thread says they both fail and that one file can't serve two slots [forum #1, #26, #29], but two `CTexture`s on `pylon_diffuse_dark.dds` both worked on doodads in today's game. [seen in game] One `CTexture` can also serve many models, as long as each declares its slot. [forum #1]
- **Different parts, different textures.** The same `CTexture` sent to the body and the arms in different slots won't take; each part needs its own. [forum #35]
- **`File`** defaults to `Assets\Textures\<id>.dds` (core's `CTexture` default), so Blizzard often gives no `File` and names the entry after its file. [verified: core.sc2mod TextureData.xml] For our own entries, give an explicit `File` and an id that isn't the file's name: "naming the texture ID the same as the texture file can cause some strange bugs". [search excerpt]
- **`PropsAdd`** tags a texture for the random and matched selections below: `<PropsAdd value="diffuse,location,00"/>`. [verified: warclassic.sc2mod] `Prefix` on a `CTexture` is only seen on decals. [verified]
- **Files are found by name too.** A texture in the storage whose file name matches a model's declaration is a candidate for that slot with no `CTexture` at all, its name's words becoming its props. The civilian's model declares only `<TextureDeclares Prefix="Colonist_Main"/>`, and the storage holds `colonist_main_male_backpack_diffuse_01.dds` … `_03.dds` with one shared `_normal` and `_specular`. Its actor picks among them at random. [verified: liberty.sc2campaign ModelData.xml, storage listing] Liberty and Swarm also turn on `UnifyWithInnateModelTextures` in the `CTexture` default, so a `CTexture` named after a texture the model already uses re-slots that texture. Blizzard's own comment calls that risky and has it off in Heroes. [verified: liberty.sc2mod TextureData.xml]
- **The image** is an ordinary `.dds` at the path `File` names, in a mod the map loads, the same as a model's own textures (`docs/reference/m3-models-in-blender.md`, "Into an Asset Mod"). A `.dds` saved in the wrong format just doesn't show. [forum #96]
- **Some textures don't suit some models.** Sludge water wouldn't go on one poster's Colossus while any `…diffuse…` file would, though it worked on another's; speculars on an Immortal glow in team colour; an emissive on a Lurker glows in team colour unless very dim. [forum #13, #28, #48-#51, #95] Look at the result in the game.

## 3. The swap: actor messages

```xml
<On Terms="ActorCreation" Send="TextureSelectById PylonDarkDiffuse"/>
<On Terms="Upgrade.DarkProtoss.Add" Send="TextureSelectById PylonDarkDiffuse"/>
<On Terms="Behavior.MitosaurusEgg.Off" Send="TextureSelectById TerrorzorDiffuse"/>
```

The messages Blizzard's SC2 data sends, by use count: [verified]

| Message | Count | What it does |
|---|---|---|
| `TextureSelectById <CTexture>` | 6,766 | Puts that texture in its slot. One component per message: send one for the diffuse, another for the emissive. |
| `TextureSelectBySlot <slot> [<expression>]` | 23 | Picks a texture for the slot at random, among those whose props satisfy the expression: `TextureSelectBySlot main {RequireAll diffuse}`. `TextureSelectBySlot decal Innate` restores the model's own texture. |
| `TextureSelectByMatch <slot.component> <slot>` | 37 | Picks the texture for one component that matches what another holds: after a random diffuse, `TextureSelectByMatch main.specular main` takes the specular with the same words. |
| `TextureGroupApply <props>` | 95 | Applies a texture group (`location,00`, `misc,ashenvale`) to the actor; `TextureAppliedGroups` on a `CModel` does it from the start. |
| `TextureSelectByFileAlias`, `TextureSelectByUpdateLink`, `TextureSelectDecalByPlayer` | 32, 4, 2 | Player logos, sprays and player decals. Not for our use. |

- **When to send it.** `ActorCreation` (310 uses) or `UnitBirth` (142) for a permanent look; an upgrade, behaviour or signal for a change in play. [verified]
- **Swapping back.** Send the original: `TextureSelectBySlot <slot> Innate` [verified], or a `CTexture` of the original file sent on the behaviour's `Off` [forum #78].
- **A model swap drops the textures.** After `ModelSwap`, send the swap again on `ModelSwapped`, which Blizzard does. [verified: 2 uses]
- **A texture that won't load is ignored**: the model keeps its own. [forum #20] The Editor may still log "Cannot load … Expression 1"; if the swap shows in the game, ignore it. [forum #1, #13]
- **In the Editor's viewport**, a swap sent on `ActorCreation` doesn't show; it only shows in the game. To preview it in the Editor, set a timer on creation and swap when it expires: `ActorCreation` → `TimerSet Timer 0.1`, then `TimerExpired` with `TimerName Timer` → `TextureSelectById <id>`. [forum #1] In data that's `<On Terms="ActorCreation" Send="TimerSet 0.100000 TSwap"/>` and `<On Terms="TimerExpired; TimerName TSwap" Send="TextureSelectById …"/>`; it swaps in the game too. [seen in game] Its Editor half is unchecked.
- **Per-variation looks**: `TextureSlotSatisfiesExpression main {RequireAll male,01}` is a term that tests what a slot holds, so the civilian's portrait follows its random clothes. [verified]
- **Doodads**: a `CActorDoodad` can send swaps too (`Logo_LeaguePrimary`). [verified; seen in game] So a recoloured stock doodad is a new doodad type: a `CModel` on the stock `.m3` with `TextureDeclares`, and a `CActorDoodad` whose `On ActorCreation` sends `TextureSelectById`.
- **Portraits** have their own actor (`CActorPortrait`), which needs its own swap. [verified: `ZerglingPrimalCollectionPortrait`]
- **Event macros**: SC2 has `CActorEventMacro`, so one macro can hold a look's whole set of messages, as Heroes of the Storm skins' tints do. [verified]

### From triggers

`ActorSend(actor, "TextureSelectById <id>")` sends the same message. The GUI trigger library has it as the actor message `TextureSelectByID` (one parameter, the texture), beside `TextureGroupApply` and `TextureGroupRemove`. [verified: `packages/core/data/trigger-libraries.json`] The natives `MakeMsgTextureSelectBySlot(slotName, slotComponent, textureExpression)` and `MakeMsgTextureSelectByMatch(slotName, slotComponent, sourceSlotName, sourceSlotComponent)` build the other two. `ActorTextureGroupApplyGlobal(textureProps)` applies a texture group to every actor. [verified: natives.galaxy] To swap for one player only, send it through an actor the other players can't see ("Renee's actor phasing method"). [search excerpt]

## When it fails

- **"No mapping for slot …"**: the `CTexture`'s slot isn't one the model declares, often a typo between the two. [search excerpt]
- **"Could not find texture with id … and expression 1"**, or "expression 1" in the game: the message names a `CTexture` that doesn't exist, one whose slot doesn't fit the model, or a texture that model won't take. [forum #13, #49; search excerpt]
- **Nothing changes, no error**: the declaration's `Prefix` or `TriggerOnSubstring` matches none of the model's texture file names, so the slot is empty. Read the names with `readM3TexturePaths` and match them. Or the swapped texture isn't the one that colours the part: the Pylon's crystal barely shows its diffuse, and its colour is in its emissive and environment textures. `readM3MaterialTextures` shows which layer of which material each texture is in. [seen in game]
- **Errors that persist after undoing a change**: a new `CTexture` given a slot can break another model's swaps even though nothing names it; redoing the setup sometimes clears it. [forum #25] That was the 2011 Editor; change one thing at a time.
- **Replacing the `.dds` at the model's own path** changes every model that names that file, in every map that loads the mod. A texture swap is the way to change one actor; replacing the file changes all of them, and that's a Campaign-wide decision.
- **Renaming a texture path inside the `.m3`** with a hex or text editor is fragile; one report says the model then failed to load. Re-point the material in Blender instead (`docs/reference/m3-models-in-blender.md`). [search excerpt]

## What's open

- The Editor's viewport: whether `TSwapStock` shows stock there and `TSwapTimer` dark, as the forum says.
- A swap declared in the Campaign Mod rather than the map. A Campaign Mod doodad's `swaps` compile, but none has been seen in the game yet.
- A swap on a unit or its portrait rather than a doodad.
- A specular swap that actually changes the texture's values, and a model that needs the component named in the adaption (forum #85-#88). Emissive, environment and normal swaps work (the Pylon, above).
- A close look at the normal swap. The capture's close shots framed the row from as far away as the wide one, so only the stripes are certain, not how the lighting reads up close.
- Whether a doodad's swap holds when the doodad is a Cinematic's set piece (`docs/reference/mod-cinematics.md`).
- Size and format limits for a replacement texture against the original's.
- Pages 6-24 of the tutorial thread, the Hive Workshop wiki's "Texture Swapping" page and the other SC2 Mapster threads aren't on the Wayback Machine (checked 2026-11-20), so the in-game check is the only source left for what they might have said.
