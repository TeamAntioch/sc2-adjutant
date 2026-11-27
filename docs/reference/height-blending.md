# Height-blended terrain textures

> **Proposed list, awaiting the author's confirmation.** The list of textures that height-blend (section 2) comes from the game's data and shader source, not from looking at the textures in game. The author has not confirmed it yet. Until they do, treat it as a strong guide, not a rule, and look at a texture in game before relying on how a low weight shows on it.

Some LotV terrain textures carry a height map, and on a tileset that turns height blending on, a texture's blend weight is cut by the heights: a low weight shows as patches in the other textures' crevices, not as a tint over them. This matters for a Paint Region's **blend weight** (ADR-0028, decision 2): on such ground, how much of a texture shows is not linear in its weight. The `texture-sets` skill says when to give a texture a blend weight and when an area share.

The research behind this note is on issue #137, read from the game data mirror (SC2 5.0.16.97364) and the install's texture files. Each claim is marked **[verified]** (read in a primary file, named) or **[inferred]** (a reading, with its reason). The scripts that decoded the normal maps are not in this repo.

## Short answer

- Height blending is a **tileset (CTerrain) switch**, `HeightMapEnabled`, plus a per-texture height channel and tuning (`CTerrainTex` `Heightmap`, `HeightMapScale`, `HeightMapOffset`). All of these fields are set only in `void.sc2mod` (LotV) data. Liberty and Swarm set none of them. **[verified]**
- The height is the **red channel of the texture's normal map** (`…Normal.dds`). Liberty and Swarm normal maps usually have R = 255 everywhere (no height). LotV normal maps carry a real height map there. **[verified]** for the shader and the files sampled.
- The blend is **symmetric across all 8 layers**. No layer is "under" another. Each texel's paint weight is multiplied by that layer's height, and any layer more than 1.0 below the strongest is cut out. So a low-weight texture shows only where **its own height is high and the others' are low**: in their crevices. **[verified]** from the shader source.
- At a low weight (2/15 ≈ 13%) a texture gets **less** than its paint share, in patches, not a tint. Over a texture with no height it can vanish. **[verified]** from the shader maths (simulated in section 3). How it looks in game is **not checked**.
- 27 stock tilesets turn it on, all LotV ones. About 158 catalog textures sit in such a tileset and have a height channel. The `Ex2` suffix is a good but imperfect guide (section 2). For example, `BelShirDirtDarkEx2` height-blends; `Zerus3` and `AiurRock` don't (Swarm and Liberty textures, flat R channel).

## 1. Mechanism

### Data fields

**[verified]** Field names, from `mods/core.sc2mod/enus.sc2data/LocalizedData/Editor/EditorCatalogStrings.txt`:

| Catalog field | Editor label |
|---|---|
| `CTerrain.HeightMapEnabled` | Height Map Enabled |
| `CTerrainTex.Heightmap` | Height Map |
| `CTerrainTex.HeightMapOffset` | Height Map Offset |
| `CTerrainTex.HeightMapScale` | Height Map Scale |

None of the four has a field hint string.

**[verified]** Where they're set (`mods/void.sc2mod/base.sc2data/GameData/`):

- `TerrainData.xml`: `GenericTerrainEx3` (the parent of the LotV and Nova "Ex3" tilesets) sets `<HeightMapEnabled value="1"/>`. Other LotV tilesets set it themselves. Several set it to `0` explicitly: `CompoundSewer`, `CompoundMansion`, `MeinhoffEx3`, `UmojaEx3`, `KorhalCityEx2`, `CastanarEx2`, `IceWorldEx2`, `SpearOfAdun`, `Endion`, `PortCity`, `DefendersCity`, `TarsonisCity`, `BlackopsLab_A/B` and the LotV `…Ex1` copies of WoL tilesets, among others. No Liberty or Swarm tileset sets it, so they take the default (presumed 0; see "What remains uncertain").
- `TerrainTexData.xml`: 108 `CTerrainTex` entries set `Heightmap`; 55 set `HeightMapScale` (1.5 to 35), 40 set `HeightMapOffset` (0.2 or 0.3). In every stock entry `Heightmap` names a normal map, nearly always the texture's own `…Normal.dds`. The one exception: `ShakurasTemple4` points `Heightmap` at `shakurastemple_2normal.dds`, and its own normal map has a flat R channel.
- No Liberty, Swarm, campaign or Co-op `TerrainTexData.xml` sets any of the three texture fields.

A map can switch it on itself, with a map-local `CTerrain` override holding `<HeightMapEnabled value="1"/>` in its `TerrainData.xml`. **[verified]** that such an override exists in a map; **[inferred]** that it works in game (not tested).

Editor brush strings `EDSTR_PALETTE_TEXTUREPARAM_HEIGHTBLENDSCALE=Height Blend Scale` and `…HEIGHTBLENDCUTOFF=Height Blend Cutoff` exist in `EditorStrings.txt`. Whether the SC2 Editor's texture brush shows them, and what they write, is **not known**.

### The shader

**[verified]** `mods/core.sc2mod/base.sc2data/Shaders/TerrainBlend.fx` has two height modes beside the old ones: `BLEND_TERRAIN_DIFFUSEHEIGHT` (7) and `BLEND_TERRAIN_NORMALHEIGHT` (8). The height step, `TerrainBlend_BlendTerrainNormalHeight`:

```hlsl
float4 heights0 = float4(col1.r, col2.r, col3.r, col0.r);   // R channel of the 8 bound textures
float4 heights1 = float4(col5.r, col6.r, col7.r, col4.r);
masks0 *= heights0 * p_vHeightScale0 + p_vHeightOffset0;      // weight × (height·scale + offset)
masks1 *= heights1 * p_vHeightScale1 + p_vHeightOffset1;
float4 weightMax = max(...all 8...);
masks0 *= 1 - saturate(weightMax - masks0);                   // cut layers > 1.0 below the strongest
masks1 *= 1 - saturate(weightMax - masks1);
// normalise so the 8 sum to 1, then blend; the new masks are also written to two render targets
```

The bound textures' `.wy` channels are unpacked as the normal, so they are DXT5 normal maps with the normal in G and A and the **height in R**. The adjusted masks go out as `vHeight0/vHeight1`, and `BlendTerrainDiffuseHeight` then does a plain 8-way blend with two mask textures. **[inferred]** The diffuse pass is fed the height-adjusted masks, so the colour follows the same cut as the normals.

So, per texel and per layer *i*, with paint weight *wᵢ* (the 0-15 nibble from `t3TextureMasks`, as 0-1), height *hᵢ* (0-1) and the texture's scale *Sᵢ* and offset *Oᵢ*:

1. *mᵢ = wᵢ · (hᵢ·Sᵢ + Oᵢ)*
2. *mᵢ ← mᵢ · (1 − clamp(max(m) − mᵢ, 0, 1))*
3. normalise to sum 1.

A large scale (Slayn's 25-35, `AiurCity6`'s 30) makes the cut nearly binary: a hard-edged mosaic. Scale 1-3 gives a softer, height-shaped blend. The offset keeps a texture's flat parts from dropping to zero. The mask layout (layer 0 in the top nibble) matches `t3texturemasks.md` in [sc2-arcade-watcher/sc2-file-format-docs](https://github.com/sc2-arcade-watcher/sc2-file-format-docs), and [terrain-file-formats.md](./terrain-file-formats.md).

### What each texture's normal map holds

**[verified]** The top mip of each catalog texture's normal map was decoded (632 files, all 1024² DXT5, every 4th block). R counts as "flat" when its standard deviation is at most 3/255, and "varies" otherwise.

- WoL and HotS: `aiur_rocknormal` and `zerus_3normal` have R = 255 everywhere. 89 of 192 Liberty textures and 89 of 128 Swarm textures are flat.
- LotV: `belshirex2_2normal` has R 100 ± 45 (range 0-255), `korhalwastes_1normal` 132 ± 19, `slayn_2normal` 83 ± 30. 296 of 338 Void textures vary.
- R doesn't correlate with the normal's X (A): r ≈ 0.00 across the samples. It is a separate map, not a copy of the normal.
- **[inferred]** Some Liberty and Swarm textures have a varying R too (`BelShirBrush`, `AgriaConcrete`, `MarSaraDirt`, `Korhal1` …, 142 in all). Whether that is a usable height or other packed data can't be told from statistics. It would matter only if such a texture sits in a height-enabled tileset.

## 2. Which stock textures height-blend (proposed)

Two things must both hold. **[verified]** that they're necessary, from the data and the shader; **[inferred]** that they're sufficient (see "What remains uncertain"):

1. The map's terrain type (its tileset's `CTerrain`) has `HeightMapEnabled = 1`, from stock data or a map override.
2. The texture's height channel varies. With R = 255 everywhere, every texel's *mᵢ* is just *wᵢ·(S+O)*: no crevice pattern, only the sharpening cut.

**Tilesets with `HeightMapEnabled = 1`** (27, all in `void.sc2mod`): Aiur4City, Aiur4Temple, AiurCity, AiurCityNight, AiurTemple, AiurTempleJungle, BattleStation, BelShirEx2, BraxisAlphaEx2, CharEx2, Elsecaro, ElsecaroCity, JarbanMinor_Jungle, KorhalPlatformEx2, KorhalWastes, MarSaraEx2, ProtossBase, PurificationDesert, Redstorm, ShakurasTemple, Slayn, SlaynGrass, SlaynTemple, SnowRefinery, TarsonisInterior, TheVoid, VolcanoIsle.

By strength of evidence:

- **Height map set, measured R varies, tileset enabled** (87 textures; the strongest evidence): all 8 of BelShirEx2, BraxisAlphaEx2, CharEx2, MarSaraEx2, KorhalPlatformEx2, PurificationDesert (`Purification_Desert_1-8`), ShakurasTemple (except `ShakurasTemple4`, which borrows texture 2's height), AiurCity, AiurTemple, Slayn and SlaynGrass.
- **No `Heightmap` field, but measured R varies in an enabled tileset** (that the engine then falls back to the normal map is **[inferred]**): KorhalWastes_*, VolcanoIsle_*, Redstorm_*, BattleStation_1-7 (`_8` is flat), Aiur4City1-8, Aiur4Temple1-8, AiurTempleJungle1-8, ProtossBase1-8 and Void1-8 (TheVoid). Elsecaro, ElsecaroCity, JarbanMinor_Jungle, SnowRefinery and TarsonisInterior are the same case, but their R wasn't measured.
- **Height map set, tileset off** (probably no effect unless the map turns its terrain type on): CastanarEx2's 8 (most have a flat R anyway), Endion1-8, EndionAiurProtoss1-2, SpearOfAdun8.
- **Not height-blended in any stock tileset:** every Liberty and Swarm texture (`AiurRock`, `Zerus3` …), and the textures of the LotV-era tilesets that are off, explicitly or by default: KorhalCityEx2_*, IceWorldEx2_*, CompoundSewer and CompoundMansion, UmojaEx3, MeinhoffEx3, DefendersCity, PortCity, TarsonisCity, BlackOpsLab, ShadowCorps, Ulnar*, Cybros, Typhon and Valhalla.

**The `Ex2` suffix as a guide [verified counts].** 48 of the 64 catalog textures with `Ex2` in the id set `Heightmap`. The 16 that don't are `IceWorldEx2_1-8` and `KorhalCityEx2_1-8`, and the 8 `CastanarEx2` textures set it but sit in a tileset that's off. So `Ex2` is right for about 40 of 64 once the tileset flag counts, and 59 of the 107 textures with the field have no `Ex2` at all. No texture id ends in `Ex3`: the `…Ex3` names are tilesets (`MeinhoffEx3`, `UmojaEx3`), both off. Go by the data, in this order: the texture's tileset has `HeightMapEnabled = 1`, then its normal map's R varies, then it sets `Heightmap`.

**A map on a switched-off tileset.** A map whose tileset is `KorhalCityEx2` (the default for a Mission Blueprint without `tilesetId`) has `HeightMapEnabled = 0`, so no texture on it height-blends, even a `BelShirDirtDarkEx2` swapped in, unless the map's `TerrainData.xml` override adds `<HeightMapEnabled value="1"/>`. **[inferred]** from the data. Which `CTerrain` the flag is read from on a map with several texture sets is **unknown** (see below).

### Per tileset

"field" means the texture sets `Heightmap` (s = `HeightMapScale`, o = `HeightMapOffset`, blank = default). R is the measured red channel of its normal map.

| Tileset | Textures |
|---|---|
| Aiur4City | `Aiur4City1-8`: no field; R varies |
| Aiur4Temple | `Aiur4Temple1-8`: no field; R varies |
| AiurCity | `AiurCity1-5`, `AiurCity7-8`: field o=0.3; `AiurCity6`: field s=30 o=0.3. All R varies |
| AiurCityNight | `AiurTemple1` (s=3 o=0.3), `AiurCity2` (o=0.3), `AiurTemple4` (s=20), `AiurCity4-5` (o=0.3), `AiurCity6` (s=30 o=0.3), `AiurCity7-8` (o=0.3). All field; R varies |
| AiurTemple | `AiurTemple1` (s=3 o=0.3), `2` (s=5), `3`, `4` (s=20), `5` (o=0.3), `6`, `7` (o=0.3), `8` (s=3). All field; R varies |
| AiurTempleJungle | `AiurTempleJungle1-8`: no field; R varies |
| BattleStation | `BattleStation_1-7`: no field; R varies. `BattleStation_8`: no field; R flat |
| BelShirEx2 | `BelShirDirtLightEx2`, `BelShirDirtDarkEx2`, `BelShirBrushEx2`, `BelShirGrassLightEx2`, `BelShirGrassDarkEx2`, `BelShirSmallTilesEx2`, `BelShirBricksSmallEx2`, `BelShirBricksLargeEx2`: field s=3; R varies |
| BraxisAlphaEx2 | `BraxisAlphaMetalEx2`, `BraxisAlphaMetalDetailEx2`, `BraxisAlphaPlatesEx2`, `BraxisAlphaDarkPlatesEx2`, `BraxisAlphaWreckedPlatesEx2`, `BraxisAlphaMeshEx2`, `BraxisAlphaRustEx2`, `BraxisAlphaRockEx2`: field; R varies |
| CharEx2 | `CharDirtLightEx2`, `CharDirtEx2`, `CharDirtCrackedEx2`, `CharSpongeEx2`, `CharMudEx2`, `CharRockEx2`, `CharRedCracksEx2`, `CharLavaCracksEx2`: field; R varies |
| Elsecaro | `Elsecaro1-8`: no field; R not measured |
| ElsecaroCity | `ElsecaroCity1-2`, `Elsecaro3`, `ElsecaroCity4-5`, `Elsecaro6`, `ElsecaroCity7-8`: no field; R not measured |
| JarbanMinor_Jungle | `JarbanMinor_Jungle1-8`: no field; R not measured |
| KorhalPlatformEx2 | `KorhalPlatformEx2_1` (s=15), `_2` (s=20), `_3` (s=2), `_4` (o=0.3), `_5` (s=5), `_6`, `_7`, `_8` (s=15). All field; R varies |
| KorhalWastes | `KorhalWastes_1-8`: no field; R varies |
| MarSaraEx2 | `MarSaraDirtEx2` (s=2), `MarSaraSandEx2` (s=3), `MarSaraRockyEx2` (s=3), `MarSaraDirtCrackedEx2` (s=3), `MarSaraDarkSandEx2` (s=3), `MarSaraBlackenedRockEx2` (s=2), `MarSaraConcreteEx2` (s=3 o=0.3), `MarSaraPanelsEx2` (s=3). All field; R varies |
| ProtossBase | `ProtossBase1-8`: no field; R varies |
| PurificationDesert | `Purification_Desert_1-8`: field; R varies |
| Redstorm | `Redstorm_1-8`: no field; R varies |
| ShakurasTemple | `ShakurasTemple1` (s=3 o=0.2), `2` (s=1.5), `3` (s=3), `4` (s=2; R flat), `5`, `6`, `7` (s=3), `8` (s=5). All field; R varies except `4` |
| Slayn, SlaynTemple | `Slayn1` (s=30 o=0.3), `2` (s=35 o=0.3), `3` (s=3 o=0.3), `4` (s=25 o=0.3), `5` (s=25 o=0.3), `6` (s=3), `7` (s=5 o=0.3), `8` (s=15 o=0.3). All field; R varies |
| SlaynGrass | `SlaynGrass1` (s=30 o=0.3), `2` (s=35 o=0.3), `3` (s=35 o=0.3), `4` (s=25 o=0.3), `5` (s=25 o=0.3), `6` (s=3), `7` (s=5 o=0.3), `8` (s=15 o=0.3). All field; R varies |
| SnowRefinery | `SnowRefinery1-8`: no field; R not measured |
| TarsonisInterior | `TarsonisInterior1-8`: no field; R not measured |
| TheVoid | `Void1-8`: no field; R varies |
| VolcanoIsle | `VolcanoIsle_1-8`: no field; R varies |

Field set but no stock tileset turns it on: `CastanarGratingEx2`, `CastanarGridEx2`, `CastanarMeshEx2`, `CastanarMetalEx2`, `CastanarPanelsEx2`, `CastanarTilesEx2` (R flat); `CastanarRockEx2`, `CastanarSmallTilesEx2`, `Endion1-8`, `EndionAiurProtoss1-2`, `SpearOfAdun8` (R varies); `AiurCity10` (R not measured).

**Catalog note.** `packages/core/data/texture-extracted.json` holds 48 ids the game doesn't define (`Elsecaro_1-8`, `ElsecaroCity_1-8`, `GenericTerrainEx3_1-8`, `JarbanMinor_Jungle_1-8`, `SnowRefinery_1-8`, `TarsonisInterior_1-8`). They look like `GenericTerrainEx3`'s `##id##_N` template expanded for tilesets whose `BlendTextures` use `Name1-8` ids. Worth a separate look.

## 3. How a weight shows

**[verified] as shader arithmetic, simulated; not seen in game.** Two layers with independent, uniformly random heights, cruder than real height maps (mean R ≈ 0.35, spatially correlated). Each figure is the stone's mean share of the colour, and in brackets the share of texels where stone is over 50%:

| Stone weight | Both scale 1, offset 0 | Both scale 3 | Both scale 3, offset 0.3 | Stone scale 3 over a flat-height base (scale 1) | Over a flat base (scale 3) |
|---|---|---|---|---|---|
| 1/15 (7%) | 9% (4%) | 7% (4%) | 3% (0%) | 2% (0%) | 0% |
| 2/15 (13%) | 16% (7%) | 11% (8%) | 6% (1%) | 8% (0%) | 0% |
| 4/15 (27%) | 28% (18%) | 22% (18%) | 17% (12%) | 27% (8%) | 0% |
| 8/15 (53%) | 53% (56%) | 55% (56%) | 55% (57%) | 65% (71%) | 22% (13%) |

For an author:

- **A low weight gives patches, not a tint.** At 2/15, 7-8% of texels are mostly stone and the rest have none or a little: the stone peeking through. Its patches sit where the stone's height peaks and the base's dips, so they follow the base's crevices.
- **The share isn't the weight.** With a high offset or a flat-height partner, a low weight shows far less than its paint share and can disappear. On a WoL base texture (flat R), a 15% LotV stone mostly vanishes. On height-blended ground, the visible share depends on the weight, both textures' heights, scale and offset.
- **Around 50% the blend tips.** Above half weight the stronger texture takes nearly every texel except the other's peaks.
- **Layer order doesn't matter.** The layer that wins a texel is the one with the larger weight × height, whatever its slot.
- `t3TextureMasks` weights are 0-15 per layer, so the steps are 1/15: 15% is 2/15 (13.3%) or 3/15 (20%). The compile dithers a Paint Region's weight across a cell so 0.15 averages 15% (ADR-0028, decision 5), but the cut above works on each texel's own weight.

`texture_usage` measures a Paint Region's textures **as painted**, the weights in the masks, before this cut. On a height-blended texture what shows in game can be well under what it reports.

### Pictures

> **TODO(author):** texture pictures at a few weights, to confirm section 2 and the table above by sight. The existing tools can't make them without running the game: `texture_sheet` shows each texture alone, from a gallery, with no blending. Wanted: `BelShirDirtDarkEx2` over `BelShirGrassLightEx2` at weights 2/15, 4/15 and 8/15 on a BelShirEx2 map, and the same pair on a map whose tileset is off (`KorhalCityEx2`); then one texture from each of the "no field, R varies" and "field set, tileset off" groups (for example `KorhalWastes_1` over `KorhalWastes_2`, and two `Endion` textures on an Endion map). To make them: a test Mission under a Mission's git-ignored `output/`, one Paint Region per weight side by side, each a blend weight (`paint_region` with a `rect` and a `mix` of `{ texture, weight }` plus the base as `{ texture }`), compiled, then `capture_shots` with one close Shot per region. Add the frames here beside the weights, and mark the list confirmed once the author has looked.

## Public sources

The SC2Mapster forums now redirect to CurseForge, so these were read only as search-result snippets **[unverified quotes]**:

- [SC2Mapster, "weird terrain issue" (146785)](https://www.sc2mapster.com/forums/development/terrain/146785-weird-terrain-issue?comment=5): a texture-blend glitch on Mar Sara put down to "Blizzard's first implementation of Height Map blending". The fix offered: clear the texture's Height Map entry in the Data Editor, since "every Mar Sara texture has a height map by default". This fits `MarSaraEx2`'s data.
- [SC2Mapster member posts](https://www.sc2mapster.com/members/_forgeuser4362031?page=2): "only Void and Nova textures will have the functionalities… height maps need to be enabled in data", and "the void maps use it to paint between cracks with other textures". This fits the tileset flag.
- [Patch 3.0 notes (a copy)](https://wccftech.com/starcraft-ii-patch-30-paves-legacy-void/): the Terrain Module lines cover Map Texture Sets only. When height blending shipped is not established.
- [s2editor-guides, Texture Sets](https://s2editor-guides.readthedocs.io/New_Tutorials/02_Terrain_Editor/030_Texture_Sets/): Terrain Types are CTerrain entries in the Data Editor. No mention of height maps.

## What remains uncertain

1. **The fallback with no `Heightmap` field.** The shader reads R from the textures bound in the height pass. Whether the engine binds the normal map when `Heightmap` is empty, or treats the texture as flat, isn't in the data. For the fallback: Blizzard enabled `GenericTerrainEx3` tilesets whose textures set no `Heightmap` but have height in R, which would be pointless otherwise. For the field mattering: `ShakurasTemple4` borrows another file, and the Mar Sara forum fix was to clear the field. An in-game test settles it: a KorhalWastes_* pair at a low weight.
2. **Defaults.** The engine's defaults for `HeightMapScale` and `HeightMapOffset` (presumably 1 and 0) and for `HeightMapEnabled` (presumably 0) aren't in any XML.
3. **Which CTerrain's flag applies** on a map with several texture sets (ADR-0016), or a texture set named after a tileset other than the map's.
4. **The diffuse pass using the adjusted masks** is read from the shader's structure, not traced in the engine.
5. **The Editor brush's "Height Blend Scale" and "Height Blend Cutoff"**: whether they show in the SC2 Editor and what they do.
6. **What it looks like.** The table in section 3 is arithmetic on random heights. The pictures above would settle the look and items 1 and 3.
