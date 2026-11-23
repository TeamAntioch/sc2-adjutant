# Placement statistics

Doodad density per tileset, and which doodads are placed most, counted over Blizzard's own maps, as input to a Style Pack's knowledge of how dense and how mixed a set looks (issue #747, part of #735). The numbers are ours: computed by `npm run placement-stats` from maps on the author's disk. No number comes from another project, and no map data is committed here, only counts.

## What was counted

- **Maps:** the 21 ladder maps (2019 Season 3 pool, Abyssal Reef to World of Sleepers), unpacked (the same extracts the MapInfo check uses, `mapinfo-checks.md`). The nine Blizzard template maps are left out: they are nearly empty and would pull their tilesets' densities down.
- **Density:** placed doodads (`ObjectDoodad` in `Objects`) per 1,000 cells inside the map's playable bounds, over all of a tileset's maps together, with the lowest and highest single map beside it. A tileset with one map has no spread to show.
- **Types:** the commonest three doodad types by count, as a share of the tileset's doodads. Doodads here are everything the Editor's doodad list holds: lights, fog, decals, curtains, trims and cliff dressing as well as plants and rocks. Read a high share for a `Curtain`, `Decal` or `Trim` type as the map's edge and ground work, not as scenery.
- **Vegetation:** a type counts when one of its name segments (split at underscores, case changes and digits) is a plant word: `tree`, `bush`, `shrub`, `plant`, `grass`, `flower`, `fern`, `palm`, `vine`, `moss`, `weed`, `cactus`, `reed`, `brush`, `bramble`, `foliage`, `overgrowth` and a few more, with an optional plural. Segments are matched whole, so `Breed` is not `reed`, and a place word such as `Jungle` is not a plant (`Aiur_Rock_Cliff_Jungle` is a rock). A name rule, not a catalogue lookup (`isVegetationName` in `packages/core/src/study/placement-stats.ts`): a plant with a plain name is missed, and a type that merely has a plant word in its name is counted. It is a rough share, good for comparing tilesets, not an audit.

## Density and commonest types, ladder maps

| Tileset | Maps | Doodads | Per 1,000 playable cells | Lowest and highest map | Vegetation (name rule) | Commonest types |
|---|---|---|---|---|---|---|
| AiurTempleJungle | 1 | 1599 | 64.05 | 64.05 to 64.05 | 22% (14.06 per 1,000) | `BelShirCurtain` 31%, `Aiur_Trees_Regular` 11%, `Aiur_Temple_BrickGroup` 9% |
| BelShirEx1 | 1 | 2707 | 146.86 | 146.86 to 146.86 | 20% (28.59 per 1,000) | `TempleBricks` 32%, `Rock` 19%, `BelShirTree` 12% |
| BraxisAlphaEx2 | 1 | 920 | 57.04 | 57.04 to 57.04 | 0% (0 per 1,000) | `Spires` 14%, `SpacePlatformCurtain` 9%, `DecalSpace_Baked` 8% |
| CastanarEx2 | 3 | 4465 | 73.79 | 48.23 to 107.05 | 14% (10.51 per 1,000) | `MarSaraCurtain` 9%, `MeinhoffCurtain` 9%, `IceWorldCurtain` 6% |
| Cybros | 1 | 2329 | 119.71 | 119.71 to 119.71 | 0% (0 per 1,000) | `Purifier_GroundTrim` 23%, `Purifier_Curb` 16%, `Purifier_Energy_Pipes` 14% |
| DesertWorld | 1 | 2131 | 87.57 | 87.57 to 87.57 | 74% (64.64 per 1,000) | `MarSaraCactus` 44%, `PlantsWasteland` 23%, `ChiseledRockEx1Large` 9% |
| Elsecaro | 2 | 6383 | 160.73 | 142.41 to 180.62 | 31% (49.83 per 1,000) | `MarSaraGroundProps` 8%, `PortCity_Garden_Plants` 6%, `Elsecaro_Bush4x4` 4% |
| KorhalCity | 1 | 731 | 34.27 | 34.27 to 34.27 | 0% (0.09 per 1,000) | `DecalSpace` 25%, `KorhalSkyScrapersMedium` 20%, `KorhalWallDoodad` 6% |
| KorhalCityEx2 | 1 | 4763 | 243.81 | 243.81 to 243.81 | 0% (0 per 1,000) | `ForceFieldWall` 44%, `StoreFrontNeonTubes` 19%, `PortCity_Trims` 8% |
| KorhalPlatformEx2 | 1 | 1276 | 48.81 | 48.81 to 48.81 | 0% (0 per 1,000) | `DecalSpace` 57%, `LandingLights` 6%, `Korhal_Platform_GrimeSplats` 3% |
| MarSaraEx2 | 1 | 2515 | 149.7 | 149.7 to 149.7 | 34% (51.25 per 1,000) | `MarSaraCactus` 13%, `Brambles` 12%, `Rock` 12% |
| MeinhoffEx3 | 1 | 2906 | 140.14 | 140.14 to 140.14 | 41% (57.68 per 1,000) | `JarbanMinor_GroundCover` 25%, `SnowRefinery_Natural_Brambles` 19%, `Shakuras_SmallBrush` 15% |
| ShakurasTemple | 2 | 2920 | 72.46 | 65.41 to 79.13 | 26% (18.46 per 1,000) | `AiurTree_Ex2` 12%, `Elsecaro_Small_Rock_Group` 9%, `MonlythCrystals` 8% |
| Slayn | 1 | 2110 | 124.88 | 124.88 to 124.88 | 23% (28.05 per 1,000) | `Slayn_CliffSpires` 16%, `Aiur_Rock_Cliff` 14%, `JarbanMinor_Small_Rock_Group` 12% |
| TarsonisCity | 1 | 3358 | 153.31 | 153.31 to 153.31 | 0% (0 per 1,000) | `PortZionGroundMix` 19%, `Tarsonis_Guardrail` 18%, `Shakuras_City_Debris_Splat` 10% |
| TarsonisEx1 | 1 | 2619 | 118.4 | 118.4 to 118.4 | 31% (36.48 per 1,000) | `Korhal_Curbs` 19%, `Tarsonis_Garden_Plant` 18%, `AgriaTree` 13% |
| VolcanoIsle | 1 | 1979 | 101.3 | 101.3 to 101.3 | 26% (26.36 per 1,000) | `Elsecaro_Medium_Rock_Group` 14%, `Aiur_Rock_Cliff_Jungle` 12%, `Elsecaro_GroundCover` 9% |

## What it says, and doesn't

- Ladder maps are competitive layouts, kept readable for play. Doodad density runs from about 35 per 1,000 cells (an open Korhal street) to about 245 (a neon Korhal city full of wall and trim pieces), with most tilesets between 50 and 160. A campaign map need not match them.
- Outdoor tilesets differ from city ones in what they are made of: rock groups, brambles, ground cover and a plant or two dominate the former; trims, curbs, signage and decal layers the latter. A Style Pack that dresses a set can take the shape of the commonest types as its starting palette.
- Sample sizes are small: fourteen of the seventeen tilesets rest on one map, so a tileset's figure is that map's, not the tileset's.

## Vegetation on its ground texture: built, not measured on Blizzard's maps

The same script pairs each vegetation doodad with the texture that dominates the cell under it (the layer with the most weight across the cell's texels, looked up through the cell's texture set), and reports, for each vegetation type placed at least five times, how its placements split across textures. It needs a map's `t3TextureMasks`, and **the ladder extracts have none**: they are the files a map ships, and the masks aren't among them. Blizzard's campaign maps are inside the game's archives, which this work did not read. So there are no Blizzard pairs here. The pairing was run to check it works on unpacked community campaign maps from the Style Pack's exemplar folder (34 maps); those counts describe that campaign's maps, not Blizzard's, and are not kept.

To get the pairs: unpack Blizzard maps that carry `t3TextureMasks` (the Editor's own saves of them do), put them in one folder, and run it.

## Unverified assumption

The texture pairing reads a doodad's `Position` x and y as cell coordinates in the same units as the texture grid (a doodad at 60.5, 50.5 is in cell 60, 50), clamped into the map. That is how our own placement and sync code treats positions and how a test fixture behaves, but it has not been confirmed against an Editor-placed doodad and its painted ground: **needs an Editor check**. It does not touch the density figures, only the pairs.

## Reproducing

```
npm run placement-stats -- <folder of unpacked maps> [--json] [--out <file>]
```

or set `SC2_PLACEMENT_MAPS` to the folder; it also gates one extra test (`packages/core/tests/study/placement-stats.test.ts`) that reads every map in it. A map folder is one holding `Objects`, `t3Terrain.xml` and `MapInfo`; one it can't read is listed as skipped, with the reason. Output is Markdown, or JSON with `--json`.

Nothing here needed the Editor or the game.
