# Exemplar Map data analysis (2026-10-26)

A second pass over the 13 Map Studies and the raw map files behind them, to firm up the unratified candidates in `candidate-lessons.md`, find new ones, and settle the two open questions in `README.md`. Nothing here is a Design Lesson until the user ratifies it.

**Tags.** Every claim is tagged **[measured]** (computed from `study.json` or the raw files, reproducible with the scripts listed at the end) or **[inferred]** (an interpretation of measurements). "L0-L3" are cliff levels (L1 is ordinary ground). "Visible doodads" excludes helpers: point lights (`LightOmni*`, `LightSpot*`), curtains, pathing/sight blockers and `*PlacementDoodad` markers.

## Read this first: the 13 maps are not 13 independent samples

**[measured]** Three map pairs share content, found by searching for one translation that maps many same-type, same-yaw, same-scale doodads of one map onto another:

| Pair | Offset (cells) | Terrain overlap | Shared doodads |
|---|---|---|---|
| 3-7 inside 3-8 | (+32, +64) | 98.7% of 3-7's playable cells have the same cliff level, 98.3% the same dominant texture | 683 = 71% of 3-7, 50% of 3-8 |
| 3-0 inside 3-1 | (+56, 0) | 66.9% same level, 66.7% same texture | 1,067 = 56% of 3-0, 38% of 3-1 |
| 3-11 -> 3-12 | (+32, +28) | none (29% same level by chance, 0% same texture) | 135 = 14% of 3-11, 40% of 3-12: a set piece of 61 `RockTower*` and 74 coloured curtains |

**[inferred]** 3-8 is 3-7 extended, and 3-1 largely 3-0 extended. Counts like "10 of 13 maps" double-count those pairs; the effective sample is about 11 maps (3-0/3-1 and 3-7/3-8 each counting once and a bit). The 3-11 -> 3-12 copy is not double evidence about terrain, but it is direct evidence that the user reuses Doodad Composites between maps (see N4). The study's per-map numbers are still right; only the cross-map tallies need this discount. All tallies below say which pairs they include.

## Part 1: Corrections to the existing candidates

Summary: 10 candidates checked; **8 need corrections**: 4 substantive (1, 2, 4, 5 change what the rule says or its numbers), 4 smaller (6, 7, 9, 10: wrong or fragile sub-claims, missed data); 3 and 8 hold with additions (3's two classes become a continuum). Old vs new in each entry.

### 1. "Variety lives on the main level; pits and heights are near-monochrome" — reframe

- **Numbers check [measured].** The ranges are right as stated: the top texture covers 24.6-51.7% of L1 on 11 of 13 maps (3-9: 73.6%, 3-12: 98.8%); 49.1-96.0% of L0 (12 maps; 3-12 has no L0) and 48.5-100% of L3. But several values sit near 50% (3-3 L0 50.3%, 3-5 L0 49.1%, 3-8 L0 50.9%, 3-2 L3 48.5%, 3-3 L3 50.3%, 3-6 L3 48.5%), which is not "near-monochrome".
- **Area confound [measured].** L1 is the biggest level on most maps, and a bigger level holds more areas. Within 16x16-cell windows lying at least 80% on one level, L1's median top-texture share is 89-100% on the large-field maps except 3-2 (3-2: 64.8%, 3-3: 100%, 3-4: 89.1%, 3-10: 93.0%, **3-11: 100%**, 3-12: 100%) and 54-65% only on the patchwork maps (3-0, 3-1, 3-5, 3-6, 3-7, 3-8). So on half the maps L1 is not varied where you stand; it changes texture from area to area.
- **"Pits and heights" is the wrong cut [measured].** Using trigger points plus placed player units as a proxy for where play happens: on 3-11 (the made map) L3 holds 41.9% of points and is 99.5% `Slayn8`; on 3-12 L3 holds 94.7% of points. On 3-2 and 3-3 L0 is 59-63% of the map yet holds 0-3% of points (it is the void floor). Levels with almost no points are locally near-monochrome: window median 89-100% on every such level measured, except 3-11 L0 (68.8%, `Slayn7` with `SlaynGrass4`).
- **New wording.** *Unused levels (void floors, pits, backdrop heights) take one texture; the used ground's variety comes either from patchwork within an area or from a different field per area (see 3).* Merge with candidate 3 and with N2 below.
- **Threshold sensitivity:** low. Dominant-texture counts don't depend on the 10% "present" threshold; other window sizes were not tried.

### 2. "Elevation is legible by texture alone" — overstated

- **[measured]** Across a cliff, comparing the dominant texture two cells either side of each cliff-edge cell: the two sides differ on 36-91% of crossings (median 63%). Strongly legible: 3-10 (90.7%), 3-4 (78.3%). Weakly: 3-12 (36.0%), **3-11 (39.9%)**, 3-9 (42.1%), 3-6 (44.0%). Comparing directly adjacent cells gives 13-74%.
- **[measured]** The candidate's own example contradicts it: 3-7 and 3-8 have `UlaanDirt` on both L0 and L1 and `IceWorld4` on both L2 and L3, i.e. two bands, not one texture per level. Same-dominant adjacent levels also on 3-2 (L0 = L1), 3-3 (L0 = L1 = L3), 3-4 (L0 = L1 = L3), 3-5 (L2 = L3), 3-6 (L0 = L1, L2 = L3), 3-9 (L1 = L2), 3-10 (L2 = L3), 3-12.
- **New wording.** *Use texture to separate a few elevation bands (low/high), not every level; the cliff carries the rest.* On the made map more than half the cliff crossings keep the same texture top and bottom, so this is at most a weak lesson.

### 3. "Blends are seams between fields; two field styles" — holds, but it is a continuum

- **Numbers check [measured].** All quoted numbers are right: blended cells within 2 cells of a border 80.6-100%; large-field maps 83.4-96.6% single-texture cells and 10.9-57.4% of ground near a border; patchwork maps 41.8-58.8% and 81.3-86.0%.
- **Missing maps [measured].** 3-5 (61.5% single, 74.4% near a border), 3-6 (39.8%, 76.8%) and 3-9 (69.9%, 53.6%) were left out. 3-6 is the most patchwork map of all; 3-5 and 3-9 sit between the groups. It is a continuum with two ends, not two classes.
- **Threshold sensitivity [measured].** The single-texture share depends strongly on the 10% "present" threshold for patchwork maps (3-0: 41.4 / 48.5 / 62.5 / 78.8% at 5 / 10 / 20 / 30%; 3-7: 35.5 / 41.8 / 56.6 / 75.7%) and barely for large-field maps (3-3: 95.7-97.9%; 3-12: 96.1-98.7%). The ranking of maps is stable at every threshold; the absolute numbers are not. The border radius matters less: at 1 / 2 / 3 cells, blended cells near a border are 70.0-100% / 80.6-100% / 87.3-100%, and the gap to the share of all ground that near is widest on large-field maps at every radius (3-11: 79.0 vs 28.4%, 91.6 vs 38.3%, 96.9 vs 45.5%).
- **Partly tautological [inferred].** Any blend gradient that crosses 50% creates a dominant-texture border, so "blends sit near borders" mostly says that partial overlays which never reach 50% are rare. On patchwork maps 81-86% of all ground is near a border, so a 95% figure there carries little information; the lift is real on large-field maps (3-3: 100% vs 32%; 3-11: 92% vs 38%; 3-12: 100% vs 11%).
- **Mask method check [measured].** The study normalises the 8 mask weights per cell. On all 13 maps the 8 layer weights sum to exactly 15 at every texel sampled, so the masks are already normalised and the method is sound.
- **Weight.** 3-11 is a large-field map (83.4% single, window median 100% on L1 and L3). Large fields are the user's own style.

### 4. "Cliff sets are mixed, not taken from the tileset" — overstated (the study counts painted-over cells)

- **Measurement error [measured].** `cliffSetUse` counts every cliff cell with `f != 0 || cid != 0`. Cells with `f = 0` and a non-zero `cid` have no cliff (the Editor remembers the set last painted there); they are 31-71% of the counted cells on several maps (3-11: 5,004 of 6,131; 3-5: 6,302 of 8,817; 3-2: 1,814). Counting only `f = 1` cells (real cliff meshes):

| Map | Families with real cliff cells (share of f = 1 cells) |
|---|---|
| 3-2 | Starship 54%, Shakuras 46% |
| 3-3 | Slayn 90%, HybridLabXelNaga 10% (the "#2: 336" in the study are all `f = 0`) |
| 3-5 | Castanar 72%, DesertWorld 20%, BelShir 4%, BrokerOffice 4% |
| 3-7 / 3-8 | ZhakulDas 90 / 94%, Xil 8 / 5%, KorhalCity 1.9 / 1.1%, Shakuras 0.3 / 0.2% (6 cells) |
| 3-0, 3-1, 3-6, 3-9, 3-11 | one family, both of its variants (Cliff0 + Cliff1, or Manmade + Organic) |
| 3-4, 3-10, 3-12 | one set |

  3-1's `ZhakulDasEx1Cliff1` has no `f = 1` cells (52 cells with flags 4, 5, 12); 3-9's `EndionCliff0` has none.
- **New wording.** *Old: "10 of 13 maps list two or more cliff sets, often from other tilesets." New: 5 of 13 maps (4 independent) build cliffs from two or more families; 5 more use both variants of one family; 3 use a single set. Where families are mixed, one carries 54-94% of the cliffs and the others are accents for specific areas.* Whether a family is "the tileset's own" can't be read from the name: the maps run custom tilesets (e.g. `UmbraWargirls3`, `HotSZerusWargirlsEyeCandy222`) whose local `CTerrain` sets the cliff list (see Part 4). Better rule: see N1.
- **Unknown flags [measured].** `f` values 4, 5, 6, 12 and 3 appear on 3-1, 3-2, 3-4, 3-5, 3-6 (3-4: 587 cells). Their meaning is open.

### 5. "Doodads hug cliffs" — the baseline was wrong; the effect is real but modest

- **Baseline error [measured].** The study's doodad "cliffEdge" context is *within one cell* of a cliff-edge cell (`edgeDistance <= 1`), but the candidate compared it with `cliffEdgeCellShare` (edge cells only, `edgeDistance = 0`). Cells within one cell of an edge are 4.5-44.3% of the playable area, not 2-24%.
- **Corrected, visible doodads in the playable area [measured]:**

| Map | Doodads within 1 cell | Cells within 1 cell | Lift at 1 cell | Lift on the edge cell / within 2 |
|---|---|---|---|---|
| 3-0 | 67.3% | 39.3% | 1.71 | 1.67 / 1.36 |
| 3-1 | 63.1% | 44.3% | 1.42 | 1.29 / 1.28 |
| 3-2 | 43.0% | 27.5% | 1.56 | 1.26 / 1.84 |
| 3-3 | 34.1% | 21.8% | 1.56 | 1.63 / 1.39 |
| 3-4 | 39.7% | 30.7% | 1.29 | 1.23 / 1.29 |
| 3-5 | 41.1% | 40.8% | 1.01 | 0.90 / 1.06 |
| 3-6 | 33.7% | 29.1% | 1.16 | 0.85 / 1.16 |
| 3-7 | 42.0% | 22.4% | 1.88 | 2.03 / 1.70 |
| 3-8 | 39.7% | 26.1% | 1.52 | 1.49 / 1.42 |
| 3-9 | 20.8% | 19.5% | 1.07 | 0.83 / 1.11 |
| 3-10 | 21.2% | 24.7% | 0.86 | 0.64 / 0.84 |
| 3-11 | 42.3% | 20.6% | **2.05** | 1.96 / 1.84 |
| 3-12 | 6.5% | 4.5% | 1.43 | 1.02 / 1.78 |

  *Old: "10 of 13 maps, 34-62% of doodads within one cell of a cliff, against 2-24% of cells." New: on 9 of 13 maps (7 independent) visible doodads are 1.3-2.1 times as likely as chance to sit within a cell of a cliff; 3-6 is marginal (1.16) and 3-5, 3-9 and 3-10 show none.* The radius (0, 1 or 2 cells) moves individual lifts by up to 0.4 but doesn't change which maps show the effect, except 3-12 (1.02 on the edge cell itself).
- **What drives it [measured].** Cliff-dressing models (names with `Cliff`, `GapFiller`, `RockTower`, `Glacier`) sit within a cell of a cliff 55-100% of the time on 10 maps and make up 21-29% of visible doodads on 3-7, 3-8, 3-11 and 3-12. Without them the lift falls to 0.14-1.71 (3-11: 1.61, 3-7: 1.43, 3-0: 1.71). Exceptions: on 3-4 and 3-10 `Aiur_CliffDoodads_Medium` sits by a terrain cliff only 20% of the time, and on 3-12 rock towers only 21% **[inferred]**: there they build free-standing walls or spires instead of dressing a cliff.
- **Per type [measured].** The median type (types with 3 or more placements, all doodads) sits within a cell of a cliff 0-67% of the time (3-11: 24%); the pooled share is driven by a few plentiful cliff-dressing types.
- **Weight.** Strongest on the made map (2.05). Keep, with the corrected numbers and the "dress with cliff-specific models" clause.

### 6. "Dressing is clustered, with large empty stretches" — holds; drop the cluster-size numbers

- **[measured]** Empty 8x8 blocks against a uniform-random (Poisson) placement at the same density: 3-0 33% vs 1%, 3-1 18% vs 0.3%, 3-2 57% vs 7%, 3-3 69% vs 41%, 3-4 53% vs 12%, 3-5 26% vs 0.1%, 3-6 27% vs 1%, 3-7 53% vs 23%, 3-8 59% vs 27%, 3-9 28% vs 3%, 3-10 25% vs 8%, **3-11 54% vs 15%**, 3-12 89% vs 45%. Every map is far more clumped than chance. The densest 10% of blocks hold 33.5-98.5% of all doodads (3-11: 56.5%).
- **Cluster numbers are threshold artefacts [measured].** Single-link clustering chains: the largest cluster on 3-11 is 42 / 97 / 114 doodads at linking radius 1.5 / 2.5 / 4 cells; on 3-5 it is 253 / 1,102 / 3,206. "Most clusters are one or two doodads" counts clusters, not doodads: on 3-11 only 23% of doodads stand alone and 47% sit in clusters of 10 or more (radius 2.5).
- **New wording.** *Old: "54% of blocks empty, one block holds 41, largest cluster 97, most clusters one or two doodads." New: on every map more 8x8 blocks are empty than random placement would leave (1.7 times on 3-3, over 30 times on the densely dressed 3-0, 3-1, 3-5, 3-6), and the densest tenth of blocks holds a third to all of the dressing (3-11: 54% empty vs 15% expected; densest tenth holds 57%).* "Large empty stretches" is weaker on 3-1, 3-5, 3-6, 3-9 and 3-10 (18-28% empty).

### 7. Doodad Manipulation — numbers right; the made map does little of it; add the missed tint

- **[measured]** 3-4 tilts 20.7%; 3-3 and 3-5 stretch 43.2% and 40.6%; every map has some tilted, stretched, sunk or raised doodads (3-0 the least: 0.8% tilted, 0.5% stretched). All four composite examples check out against the raw `Objects`: `AntimatterMissileDoodad` at scale 2, 16 copies at heights 0.43 / 1.13 / 2.03 / 3.03 above ground, yaw 225 deg; 117 crates rolled 268 deg; `StarShipAdun_StasisPods` pitched 91 deg and scaled 0.65 x 0.5 x 0.85; `XelNagaColumn` pitched 90 deg at 0.5 x 0.6 x 2 (and 0.6 x 0.6 x 1.5 raised 6-8.6 as beams) with `TempleColumn` at scale 0.4 raised 3.31-3.35; `StarshipHallTrim` at 1 x 1.7 x 1 with `NoDoodadFootprint`.
- **`TarSludge` [measured].** All 49 on 3-11 sit exactly 0.27 below ground **and are tinted 47,187,255 (cyan)**. The study's `sunk` flag (threshold 0.5) misses them. The identical recipe (−0.27, the same cyan tint) is on 3-3 (22 of 36), so it is a reused recipe, not a one-off (N4).
- **Weight [measured].** The made map manipulates least: 3-11 lays 0.5% of visible doodads on their side, tilts 2.6% slightly, stretches 0.8% (2x or more) and stacks 0.9%; its manipulation is mostly `NoDoodadFootprint` (22%) and raising (17%, mostly `Slayn_RockCliffTall` and brick pieces). Heavy manipulation is concentrated in 3-4 (15.2% laid on side), 3-7/3-8 (tilted, stretched and sunk glacier cliff pieces: 12-16% tilted) and 3-5 (21.8% stretched, mostly decals). Keep the lesson, but weight it as "a tool the edited maps use", not the user's default.
- **Composite detection [measured].** The study's composite list (clusters with 2 or more manipulated members) inherits the chaining problem of 6 and counts uniform extreme scale as manipulation, which the glossary doesn't. 3-0's 74 "composites" are mostly tinted rocks and decals.

### 8. "Storytelling clutter comes in families" — holds; now with chance-corrected numbers

- **[measured]** Against a permutation baseline (types shuffled among the same positions, 30 runs), 3-11's pairs are strongly over-represented: `Protoss_Corpse_08` + `_09` 143 pairs (20x chance), corpses with each other 13-21x, `Slayn_Stone_Bricks` + `_Piece` 12.5x, `Slayn_CliffTemples` + bricks 6-17x, corpses + `TarSludge` 3.5-3.8x, and corpses + `Shakuras_Banner_Torn` 28x.
- **Across maps [measured].** Every map has families at 10x chance or more: 3-2 `BloodSplats` + `ZergCarcasses` (22x) and + stationary Dragoons/Reavers (15x); 3-3 corpses + `TarSludge` (9x); 3-5 `MarSaraCactus` + `RockSmall` + `TarsonisFoliage` (23-44x); 3-0/3-1 `Brambles` + `Rock` (9-11x); 3-4 crates + stasis pods (8x); 3-10 `Aiur_City_Archway_Large_Abandoned` + `Aiur_City_Curb_Destroyed` (70x).
- **Note [measured].** Some top pairs are helpers, not storytelling: 3-8's strongest pairs are `*PlacementDoodad` markers (50-96x), and blockers pair with rocks on 3-1. Raw co-occurrence counts in `study.json` are dominated by abundant types (3-0's top pair `DecalProtoss` + `TempleColumn` is only 1.3x chance); use lift, not counts.

### 9. "Lighting changes with area and story beat" — holds; sharpen how it changes

- **[measured]** 12 of 13 maps call `GameSetLighting` (3-10 none), and each of the 12 uses 2-5 lights. Examples check out (3-11: `ProtossAbyss` in `gf_TransitiontoEyeSetting`, `Temple` in `gf_TransitiontoNormalSetting`, `TheVoid2` in `gf_NTSetupBase`; 3-6: `Midnight`, `Midday`, `InsideTemple`, `Midnight2`).
- **Missing nuance [measured].** Many calls belong to cutscenes rather than areas (opening/ending/flashback functions on 3-0, 3-3, 3-4, 3-5, 3-6, 3-11; 3-12's only calls are in `gt_PostcreditScene_Func`). The blend times show three distinct uses:
  - instant cut (0 s) at an area transition or blackout: the majority, on 11 of the 12 maps (3-9 only drifts);
  - slow drift over a beat: 3-6 `Midday`/`Midnight` over 470 s on a timer; 3-9 `AntiochMidday` over 120 s and `AntiochNighttime` over 540 s after objectives;
  - short pulse for an event: 3-2 `StarshipDark` 3 s then `Starship` 1.5 s in `gt_PeriodicBooms_Func`; 3-4 0.25 s camera-mode switches.
- The study misses dynamic calls (3-1's `lp_lighting` variable in its zone-switching function) and all 21 `PlayerSetLighting` calls (3-4: 15, 3-8: 1, 3-9: 5) **[measured]**.
- 3-10 is not a counterexample: it lights two painted light regions in data (N7) **[measured]**.
- **New _Apply_.** Per Zone, give the lighting it cuts to on entry; per Beat, optionally a slow drift (minutes) for time passing; events may pulse a darker light for 1-3 s.

### 10. "Cliff feet are darkened with soft shading" — see Part 3

- **Numbers check [measured].** 8 of 13 maps are darkened (3-0, 3-3, 3-4, 3-7, 3-8, 3-10, 3-11, 3-12); cliff-edge cells 26.7-46.6% and near-edge 24.9-45.5% darkened; open ground 0.3-6.5% (3-3 is 6.5%, slightly above the quoted 0-6%). 3-0: 43.7% at edges vs 5.1% open.
- **Threshold sensitivity [measured]** (edge % / open %, cell darkened when its 4-corner mean is below the threshold):

| Threshold | 3-0 | 3-3 | 3-4 | 3-7 | 3-8 | 3-10 | 3-11 | 3-12 |
|---|---|---|---|---|---|---|---|---|
| 250 | 53/55 | 55/29 | 47/13 | 41/17 | 34/15 | 57/34 | 34/11 | 39/9 |
| 240 | 49/19 | 47/17 | 46/3 | 38/4 | 32/4 | 55/20 | 30/4 | 39/6 |
| 224 | 44/5 | 47/7 | 31/1 | 32/0 | 27/1 | 43/6 | 29/1 | 34/4 |
| 192 | 14/1 | 25/2 | 0.4/0.2 | 5/0 | 4/0 | 2/0 | 16/0 | 6/2 |

  The edge-vs-open contrast holds from 192 to 240; at 250 a faint 250-254 haze covers most open ground on 3-0. The percentages themselves move a lot with the threshold, so quote the contrast, not the 25-47%.
- **Why 5 maps have none [measured].** In the `tac-arcade` git history, 3-1 was 65% shaded until "3-1 Updates" (2022-09-17) and 3-9 53% shaded until 2020-08-04; both lost it in saves that changed cliffs. Only 3-2, 3-5 and 3-6 never had it.
- **New wording.** *Old: "looks more like a baked ambient-occlusion pass than hand painting; open question." New: the shading is an Editor bake (Part 3), wiped by any later cliff edit; 3-11, the made map, has it.* _Apply:_ compiled maps can't run that bake themselves; either reproduce it (a band on the low side of each cliff foot, darkest about 2 cells out, gone by 5-6 cells, cliff-line vertices left at 255) or have the user run the Editor's bake as a last step after the final cliff edit.

## Part 2: New candidate lessons

Same shape as `candidate-lessons.md`. Each has a counterexample check.

### Cliffs

**N1. Each cliff set goes with its own ground texture; natural and built cliffs split by area.**
**[measured]** For every real cliff cell (`f = 1`), the dominant texture on the level above it, excluding the edge cells themselves:
- 3-11 (made): `SlaynCliff1` has `Slayn8` on top 94.5% of the time and climbs L1 -> L3 on 88.8% of its cells; `SlaynCliff0` rims the L0 pits (L0 -> L1 on 81.8%) with `Slayn7` / `KorhalCityEx2_6` on top.
- 3-0 / 3-1: `ShakurasEx1Cliff1` sits under and over `ShakurasHextiles` (90.7% / 80.5% on top); `ShakurasEx1Cliff0` goes with `ShakurasDirtCracked` (3-0, 48%) or `ShakurasRockRough` (3-1, 64%).
- 3-2: `StarshipCliff0` with `Starship5` on top 88.2%; `ShakurasEx1Cliff0` with `ShakurasDirtCracked` on both sides 97%.
- 3-5: `CastanarEx1Cliff1` with `CastanarPanels` 82.7%; `DesertWorldCliff0` with `DesertWorld6/7` 87%; `BelShirEx1Cliff0` with jungle and grass; `BrokerOfficeCliff` with `CompoundMansion_4` 100%.
- 3-3: `HybridLabXelNagaCliff1` with `UlnarPortal6` / `Starship2`; `SlaynCliff1` with `Slayn4` / `Slayn8`.
- 3-7 / 3-8: `ZhakulDasEx1Cliff0` with `IceWorld4` on top (45-59%); `XilEx1Cliff1` with `UlaanDirt` on top (74-77%); `KorhalCityCliff0` with `ShakurasBricks` below (76%).
- 3-6: `ZerusCliff1` (150 cells) with `PortZionConveyorBelt` / `DesertWorld2` on top, against `Zerus3` / `CharDunes_8` for `ZerusCliff0`.

**[inferred]** `Cliff1` variants keep company with paving (hex tiles, panels, conveyor belts, `Slayn8` floors) and `Cliff0` with dirt, rock and sand, which fits the Editor's natural (`Cliff0`) and man-made (`Cliff1`) pairs; `packages/core/src/terrain/write-t3-terrain-xml.ts` already treats index 0 as natural. Not verified in the Editor.
**Counterexample check [measured]:** of the 10 maps with two or more sets in use, all but 3-9 give each set a different top texture (9 of 10; 7 of 8 independent). On 3-9 both sets sit under `KorhalCityEx2_7` (53% and 91%); on 3-6 the main set `ZerusCliff0` has no single partner (`Zerus3` 40%, `CharDunes_8` 36%).
_Apply:_ choose the cliff set and the texture of the ground it borders together, per area: natural cliff with natural ground, built cliff with paving. On a map with pits and plateaus, use one variant for the pit rims and the other for the high walls, as 3-11 does.

### Texturing and dressing by level

**N2. Leave void floors and backdrop levels bare: one texture, almost no doodads.**
**[measured]** Visible-doodad density on the lowest level, relative to its area: 3-0 0.14x, 3-1 0.37x, 3-2 0.02x, 3-3 0.35x, 3-6 0.17x, 3-7 0.26x, 3-8 0.26x, 3-9 0.26x, 3-10 0.29x, 3-11 0.23x (10 of 12 maps with an L0). The same levels are locally near-monochrome (candidate 1). Unused heights are bare too: 3-4 L2 0.19x and L3 0.04x, 3-5 L3 0.10x, 3-3 L3 0.26x, all with 0-3.5% of points. Used upper levels are dressed above average instead (3-0 L2 1.75x, 3-2 L2-L3 2.1-2.5x, 3-7 L2 2.34x, 3-8 L2 2.21x).
**Counterexample check [measured]:** 3-4's small L0 (4.6% of the map) is dressed at 1.30x and 3-5's (2.5%) at 0.77x. On 3-11, L3 holds 41.9% of points but only 0.5% of doodads (0.03x) and is 99.5% `Slayn8` **[inferred]**: an arena floor kept clear on purpose, so "bare" also applies to some play spaces.
_Apply:_ in the Mission Blueprint, mark each level band as play space or backdrop. Backdrop gets one texture and no dressing; dressing goes on the play levels, densest on the raised areas players look at.

### Doodads

**N3. Natural props get free rotation and a small scale jitter; built props snap to 45 degrees.**
**[measured]** Pooled over all maps, visible doodads of kind rock, foliage or tree: 7.3% have a yaw on a 45-degree step (random placement gives about 2.7% in the ±0.6-degree window used) and 7.8% are at scale exactly 1. Ruins and other built props: 46.3% on a 45-degree step, 34.7% at scale 1. Decals: 89.6% on a 45-degree step. Per map, natural props on a 45-degree step: 1.6-6.2% on 3-0, 3-1, 3-2, 3-5, 3-6, 3-7, 3-8; 12.1% on 3-9. Natural scale is jittered around 1, not varied widely: median 0.92-1.01, 10th percentile 0.53-0.89, 90th percentile 1.10-1.20 on 7 of 10 maps with 30 or more natural props (3-8: 1.75, 3-9: 2.50). Of types placed 5 or more times, 31-94% use 3 or more distinct scales and 77-100% use 3 or more distinct yaws.
**Counterexample check [measured]:** on the made map 3-11, 73.0% of natural props are at scale 1 (10th-90th percentile 0.98-1.00) and 23.0% are on a 45-degree step (`Slayn_RockCliffTall` dominates); 3-10's natural props are 35.7% snapped. So free rotation holds broadly, but scale jitter is an edited-map habit the user's own map doesn't share.
_Apply:_ the doodad placer randomises yaw for rocks, foliage and trees and snaps it to 45 degrees for architecture and decals. Scale jitter of about ±15% on natural props is optional (ask the user; 3-11 doesn't do it).

**N4. Keep Doodad Composites and recipes, and reuse them across maps.**
**[measured]**
- `TarSludge` sunk exactly 0.27 and tinted 47,187,255 appears on 3-11 (all 49) and 3-3 (22 of 36).
- 3-12 contains a 135-doodad set piece from 3-11 (61 `RockTower`, `RockTower1`, `RockTower12`, `RockTower122` and 74 `KorhalOutskirts`, `IceWorld`, `DesertWorld`, `HybridLab` and `CharDunes` curtains), shifted by (+32, +28), with yaw and scale unchanged.
- 3-8 is 3-7 extended (98.7% of 3-7's terrain, 71% of its doodads); 3-1 reuses 67% of 3-0's terrain and 56% of its doodads.
**Counterexample check [measured]:** apart from these, no two maps share 20 or more identically placed doodads after translation (other pairs tested: 3-11 -> 3-3 found no offset matching more than one doodad).
_Apply:_ store composites (members with relative offsets, yaw, pitch, roll, scale, tint and height) as named entries the compiler can stamp, starting with the ones above and the four in candidate 7.

**N5. Coloured point-light doodads mark families: cyan or green on vegetation, red on temple architecture.** *(weak)*
**[measured]** 11 of 13 maps place `LightOmni*` doodads, 30 or more on 9 (3-6: 617, 18% of all doodads; 3-0: 214; 3-1: 168; 3-5: 147). Nearest visible doodad within 3 cells of each light, pooled: cyan lights 55% natural (390 of 703), green 56% natural, red 70% ruin or built (205 of 293), white mostly decals (3-5's 147 white lights). Cyan lights pair with `Brambles` and `ShakurasFoliage` at 9-13x chance on 3-0, 3-1, 3-7, 3-8; `LightOmniRed` with `TempleColumn` at 4-6x and `LightOmniRedLarge` with `TempleBanner` at 26-40x on 3-0 and 3-1.
**Counterexample check [measured]:** the made map 3-11 and 3-9 have no light doodads at all; 3-2 and 3-3 have 9 and 3. **[inferred]** this is a habit of some edited maps, not of the user's own map.
_Apply:_ optional. If an area uses point lights, pick one colour per family and place them with that family.

**N6. Tint stock props into the map's palette.** *(weak)*
**[measured]** 3-0 and 3-1 tint 56-58% of visible doodads: rocks darkened to grey (`RockGiant` 85,85,85 x116; `Rock` 70,70,70 x60), `DecalProtoss` to 50,0,0 (x555), `PlantsAlien` to 255,150,200. 3-3 tints `Waterfall` purple (146,0,215) and `ProtossFireMedium` red; 3-4 tints 100 doodads 0,128,255. Elsewhere 0.2-13%, and on 3-11 only the `TarSludge` (5.6%).
_Apply:_ when a stock prop's colour fights the area's palette, tint it rather than swap the area's textures; keep tints to a few colours per map (2-23 distinct per map).

### Lighting, atmosphere and tilesets (from the catalog analysis, Part 4)

**N7. Light each area in data first; switch on beats, and switch the set with it.**
**[measured]** Lighting is set in data as well as triggers: 6 maps paint `LightingMap.tga` light-region masks (3-2 19.6%, 3-3 5.1%, 3-4 5.2%, 3-5 77.4%, 3-10 34.2% over two regions; 3-0/3-1 faint gradients), and the in-play lights define matching `LightRegions` with their own ambient, key/fill/back colours and fog. 3-10, the one map with no lighting triggers, lights its zones this way, so it is not a counterexample to candidate 9. Of 76 trigger functions that set lighting, 56 also start a soundtrack and 19 (on 8 maps) also swap something visible: doodad show/hide (14), fog (5), water state (2), tint (1), terrain region (2). 3-3 does all of it in two beats.
**Counterexample check [measured]:** 3-7, 3-8, 3-9, 3-11, 3-12 have no light-region map; light regions sit only on edited maps. **[inferred]** On 3-11 per-area lighting is done by trigger (`gf_TransitiontoEyeSetting` etc.).
_Apply:_ define a `CLight` per Zone in the map-local catalog (fits the user's preference for data over triggers); use `GameSetLighting` only for Beat changes, and change the soundtrack and the dressing in the same function.

**N8. Fill pits and abyss floors with water or lava, and let beats raise it.**
**[measured]** 11 of 13 maps have painted water areas (3-0 16, 3-1 27, 3-2 10, 3-3 4, 3-5 7, 3-6 36, 3-7 14, 3-8 22, 3-9 13, 3-10 1, 3-11 5 rectangles; 0.6% to 40.6% of the map, 3-11 the most). The rectangles lie on L0 2-5 times more than L0's share of the map (3-0 41 vs 10%, 3-6 51 vs 13%, 3-7/3-8 52 vs 9-11%, 3-9 70 vs 19%, 3-11 53 vs 21%, 3-1 28 vs 7%). Water types come from other planets (Avernus water on Shakuras, Xil water on the Umbra ice maps, Char lava on 3-11), and each pool height needs its own `CWater` (3-1 has five Avernus copies at 8.3-12.4). Two maps raise it as a beat: 3-3 `TaintedWater` rises 7.8 -> 9.55 and then damages; 3-11 Char lava rises 4.8 -> 8.4 and reddens over 15 s.
**Counterexample check [measured]:** 3-4 and 3-12 have none; 3-10 has one small area; on 3-2 and 3-3 the areas don't favour L0. The rectangle reading of `t3Water` is **[inferred]** from file structure and positions; confirm with one Editor-saved water area before writing it.
_Apply:_ give void floors and pits (the bare backdrop of N2) a water or lava surface in the area's palette; for a flood or eruption Beat, raise it with a `CWater` state change.

**N9. Darker, cooler ambient than stock; keep the key light.**
**[measured]** Over the 46 lights actually in play (trigger-set plus base), median ambient luminance is 0.31 against 0.39 for 84 stock tileset lights; 49% have a saturated ambient (saturation > 0.4) against 26%, mostly hue 200-250 degrees. Key light (0.80 vs 0.85) and HDR exposure (1.5) are unchanged; back light is brighter (0.38 vs 0.25). All 9 local fog colours are blue.
**Counterexample check [measured]:** 3-0, 3-1 (0.39), 3-9 (0.40) and **3-11 (0.42)** sit at or above stock; warm ambients on 3-5 and 3-9, magenta on 3-12. HDR ambient multipliers weren't modelled. Weak for the made map.
_Apply:_ when deriving a Zone light from a tileset light, try about 20% less ambient tinted blue-violet, key and exposure unchanged; check against the user's taste, since 3-11 doesn't do it.

**N10. Build a custom tileset from several planets; keep cliffs to one or two families.**
**[measured]** 10 of 13 maps cover at least 5% of their ground with each of 2-4 texture families (median 38% of the area outside the dominant family); 7 use 2-3 texture sets. Cliffs mix families on only 5 of 13 (corrected candidate 4). Skyboxes and water also come from other planets (above).
**Counterexample check [measured]:** 3-0 and 3-1 are pure `ShakurasEx1`; 3-12 is 97% Shakuras; the made map 3-11 is 83% Slayn with 10% Korhal.
_Apply:_ pick a primary planet for most of the ground plus 1-3 accent families, one or two cliff families (paired with ground per N1), and put the whole set, with its own lighting, skybox, fog and water, in a map-local `CTerrain`.


## Part 3: Open questions

### Ramp `dir` codes 4-7 — settled

**[measured]** Each `<ramp>` in `t3Terrain.xml` carries its uphill vector `u` in the `base` attribute, and the code-to-vector mapping is constant across all 122 ramps on the 13 maps:

| dir | u (x, y) | Uphill toward | Ramps |
|---|---|---|---|
| 0 | (0, −1) | south | 12 |
| 1 | (0, +1) | north | 14 |
| 2 | (−1, 0) | west | 8 |
| 3 | (+1, 0) | east | 16 |
| 4 | (−0.707, −0.707) | **south-west** | 6 |
| 5 | (+0.707, −0.707) | **south-east** | 8 |
| 6 | (−0.707, +0.707) | **north-west** | 38 |
| 7 | (+0.707, +0.707) | **north-east** | 20 |

**[measured]** `u` really is uphill: sampling the height map along `u` through each ramp's `mid` point, height rises in that direction on all 122 ramps (by 1.4-2.6 over ±2 cells), and the sync cliff level 3 cells along `u` is the ramp's `hi` level. Codes 0-3 agree with `packages/core/src/terrain/ramps.ts` (0 south, 1 north, 2 west, 3 east), so +y is north. The `base` centre is the high edge and `mid` lies downhill of it.

Side findings **[measured]**: diagonal ramps are 72 of 122 (59%), but that is map-specific (3-0 and 3-1 are nearly all diagonal, 3-11 and 3-3 have only straight ramps). All ramps climb exactly one level (107 L1 -> L2, 15 L2 -> L3). The study's `ramps.width` mixes units: the `w` of diagonal ramps is in diagonal steps (1.414, 2.828, 4.243, 5.657), straight ones in cells (3-6), so its quantiles shouldn't be compared across directions. 3-4, 3-5 and 3-12 have no terrain ramps.

### What `t3VertCol` values mean

**Answer: baked by an Editor pass, with a small hand-made or leftover remainder. Confidence high (about 90%) for the cliff shading.** Analysis by a helper agent; scripts in the scratchpad's `vertcol/` folder.

Evidence, strongest first:

1. **It is rebuilt map-wide in saves with no geometry change, nearly identical to before [measured].** In the `tac-arcade` history (136 saved versions of every map's `t3VertCol`, Episodes 1-3), 3-11's "wip" commit `e5c89ca` (2020-08-10) went from 0 to 9,574 shaded vertices and from 0% to 93% shaded cliff-mesh bytes in one save. It correlates at r = 0.986 (kind 1) and 0.967 (cliff meshes) with the version wiped earlier, yet only 29% of values are byte-identical (most differ by 1-8). **[inferred]** A re-run sampled occlusion calculation fits; a hand repaint of ~10,000 vertices could not come that close.
2. **Any cliff edit wipes all of it [measured].** A shaded map went back to all 255 in 9 of 9 saves that changed cliffs, including saves touching only 4-15 cliff pieces; shading never vanished in a save without a geometry change (21 such saves). Kind 1 and the mesh kinds go blank together, across the whole map.
3. **The same cliff model carries the same per-vertex values everywhere [measured].** Kinds 2 and 4 are one byte per vertex of a placed cliff or ramp model (the `id` is the model, the size its vertex count). Two copies of a model on one map correlate at 0.85-0.93; the same model across maps at 0.96 on average over 436 pairs (3-11 against 3-0, 3-7, 3-8: 0.97-0.98). Different models with the same vertex count: 0.34-0.6. On the 8 darkened maps 82-99.8% of cliff-mesh bytes are non-255; on the other 5, and on Editor-saved test maps, 100% are 255. Kinds 8 and 0 are always 255.
4. **Its shape follows geometry, not a brush [measured].** It sits on the low side of cliffs (3-0, share below 224 at 1-5 cells out: low side 77 / 88 / 38 / 11 / 6%, high side 10 / 3 / 2 / 3 / 1%); the same in all four facings (3-0: 78 / 80 / 82 / 80%), so not a sun shadow; vertices on the cliff line itself are exactly 255 in 86-96% of cases against 5-41% of their neighbours; it correlates 0.39-0.84 with an occlusion estimate computed from the height map (3-10: 0.84); doodads don't darken the ground around them. Value histograms are smooth on all 8 maps (170-233 distinct values, no brush-strength plateaus). Coverage depends on cliff set (3-11: `SlaynCliff1` 53% vs `SlaynCliff0` 15%).
5. **Not automatic on save [measured].** Editor-saved maps with cliffs (`missions/test-map/output/cliffs-and-doodads.SC2Map`, 311 cliff cells; `terrain-test`, `terrain-test-ramps`) are all 255 in every kind. **[inferred]** The bake is an explicit Editor command.

**The non-baked remainder [measured].** Darkened patches 6 or more cells from any cliff total 472 cells on 3-3 and 716 on 3-12 (44 or fewer elsewhere): an irregular blob with values down to 0 at 3-3's south-west corner, long arcs on 3-12 over featureless ground, and on 3-3 a hard-edged rectangle (vertex x ≥ 25, y ≥ 92) of exact 255s cutting through gradients. **[inferred]** Hand painting, or leftovers from edits that don't reset the bake (height brush, paste).

**Not settled.** The name of the Editor command (no flag in `MapInfo` or the XML mentions occlusion or baking), and whether height-brush or paste edits reset it. Two single-variable experiments would settle both (per the Editor bisection workflow; the user runs them):
1. *Wipe test:* copy 3-11 to `exp-ao-wipe`, raise or lower one cliff cell, save. Predicted: kinds 1 and 2 all 255 map-wide. Repeat with a height-brush-only edit and with a terrain paste.
2. *Bake test:* copy `cliffs-and-doodads.SC2Map` to `exp-ao-bake`, run the Editor's terrain lighting / ambient-occlusion command, save. Predicted: a low-side cliff-foot band peaking about 2 cells out, and per-model cliff-mesh values. It is worth asking the user what they ran on 3-11 around 2020-08-10.

## Part 4: Catalog data, water and fluff

Analysis by a helper agent; scripts in the scratchpad's `lighting/` folder. "Stock" means anything mounted through the maps' dependencies (ThoughtsInChaos -> NovaStoryAssets -> the three campaigns -> core mods; see `docs/reference/data-loading-and-dependencies.md`); stock LightData came from an extracted copy, stock TerrainData and WaterData were not available, so stock tilesets come from `packages/core/data/tileset-*.json`.

### Study measurement errors found here

1. **`lighting.calls` misses `PlayerSetLighting` [measured]:** 21 calls (3-4: 15, 3-8: 1, 3-9: 5). Together with the dynamic `lp_lighting` call on 3-1, lighting is switched more than the study shows.
2. **`waterBodies: 0` misreads `t3Water` [measured].** The body count at +12 is 0 on every map, but the count at +8 holds 0-36 entries, and every file is exactly `32 + 56n` bytes (re-checked for all 13). **[inferred]** Each entry is a 40-byte `CWater` name plus a rectangle (x0, y0, x1, y1, 8-aligned, inside the map): a painted water area.
3. **`read-t3-fluff-doodad.ts` reads x and y as int32; they are float32 [measured].** Read as floats, all 3,393 entries on 3-1 and 322 on 3-5 fall inside the map. Counts in the studies are right; positions are not.
4. **`MapInfo` `fogType` ("Black" on all 13) is the fog-of-war style**, not atmosphere.

### Local CLights [measured]

- 80 local `CLight`s across 13 maps (1-12 each); about 32 are referenced nowhere, and 6 overrides are empty or exact re-saves of the stock light. **[inferred]** A duplicate-and-rename workflow (`ProtossTemple12`, `Midnight2`, `_Low` variants) leaves dead copies; ignore lights nothing references.
- Overrides mostly change 1-3 fields (e.g. `KorhalCity` key direction steepened to z -0.95 on 3-3 and 3-6; `MeinhoffCampaignNight` exposure 1.6 -> 1.875). Larger rewrites: `Shakuras` on 3-12 (30 of 35 fields), `AiurCity` on 3-10 (25 fields, two light regions), `PsionicWaveUp` (magenta ambient).
- New lights start from a stock template; `StarshipDark` is the house night/interior template on 5 maps (3-2, 3-3, 3-6, 3-7, 3-8).
- 3-7/3-8's green-ambient overrides are all unreferenced: dead data, not a look.

### Custom tilesets [measured]

- 9 maps define new `CTerrain` ids, 4 override stock ones (3-1, 3-2, 3-9, 3-10). A full local `CTerrain` lists 8 blend textures and 1-4 cliff sets from several planets, plus lighting, skybox (9 maps; often another planet's: Shakuras sky over Starship and Slayn, BelShir sky over Umbra ice and Aiur), fog and sometimes `HideLowestLevel` (3-4, 3-7, 3-8).
- 7 maps repoint a stock texture id at another image in `TerrainTexData` (e.g. 3-7/3-8 `IceWorld2` -> the `purifierworld5` image; 3-11 adds `Nothingness`). 3-3 reskins `HybridLabXelNagaCliff1` with the Starship material; 3-5 adds `BrokerOfficeCliff`.
- Reuse is only between neighbouring maps (3-7/3-8 share `Umbra*`; 3-11 and 3-12 carry identical `NewAntioch*` entries, unused on 3-11).

### Fog [measured]

All 9 locally set fog colours are blue or cyan, and the values repeat exactly across unrelated maps (121,214,244 at density 0.10 on 3-4, 3-5, 3-6, 3-7/3-8; 45,68,86 at 0.06 on 3-3 and 3-12), so they are copied presets **[inferred]**. 3-11: 0,172,255, density 0.20, height -25. 3-10: density 0.70. Triggers toggle fog on 3-3, 3-6 and 3-11. A weak lesson at most; it agrees with N9.

### Fluff [measured] — not a lesson

Only 3-1 and 3-5 have `t3FluffDoodad` entries. The flag byte is the texture-layer index (matches the cell's dominant layer in 95-100% of entries), entries cluster on clutter-bearing textures (3-5: `AiurTempleJungle1` holds 72% of entries on 2.9% of the area) in painted patches, about 0.85 cells apart. **[inferred]** Added ground clutter painted per texture, not suppression. 3-0 has the same textures and none, so it is not automatic. 2 edited maps only.

### Other [measured]

Imported `.m3` models on 3-2 (43), 3-3 (23), 3-4 (11), 3-9 and 3-10 (3 each); `CModel` lighting overrides on 8 maps (portrait/effect lighting); `CTexture` swaps on 3-8 and 3-11. 1,432 of 1,433 point-light doodads have a non-default scale (scale sets the light radius).

## What this pass could not settle

- **The bake command** behind `t3VertCol` and whether height-brush or paste edits reset it: needs the two Editor experiments in Part 3.
- **Cliff `f` flags 4, 5, 6, 12, 3** (587 cells on 3-4): meaning unknown.
- **Natural vs man-made cliff variants** (N1): inferred from names and paired textures, not checked in the Editor.
- **`t3Water` entries as water rectangles** (N8): inferred from structure; needs one Editor-saved water area.
- **Light-region channel mapping** in `LightingMap.tga`: not fully resolved.
- **Walkability.** "Used level" is proxied by trigger points and placed player units; 3-11 places no units, so its usage rests on points alone. Pathing (`t3CellFlags`, painted pathing) wasn't read.
- **What players see.** Everything here is top-down data; the capture tours (only 3-11 default exists) are needed to check that the numbers match what reads on screen, e.g. whether texture bands (candidate 2) or curtains are visible at camera height.
- **Curtain doodads.** 7 maps place `*Curtain` models (3-6: 358 visible; 3-11 and 3-12: 77 each, all on 3-11's L2); their visual role (mist, light shafts, edge hiding) can't be read from the data, so no lesson is drawn.
- **Ramps.** Diagonal vs straight is map-specific (3-0/3-1 nearly all diagonal, 3-3/3-11 all straight); no lesson.

## Scripts

All throwaway, in the session scratchpad (`/private/tmp/claude-501/-Users-abw-repos-sc2-mapper/04eea227-8092-4bea-aa25-09b09ec68355/scratchpad/`), run with `node <script>` against the compiled readers in `dist/`:

- `lib.mjs`: loads a map with the study's own loader, grid and doodad classifier.
- `tex.mjs` (candidates 1-3), `masksum.mjs` (mask normalisation), `cliffs.mjs` (cliff sets by flag, level pair and adjacent texture), `dood.mjs`, `cliffdood.mjs` (5, 6), `c7.mjs`, `recipes.mjs`, `xform.mjs`, `xform2.mjs`, `misc.mjs` (7, transforms), `cooc.mjs` (8, permutation lift), `lights.mjs`, `curt.mjs` (light and curtain doodads), `lvdood.mjs`, `used.mjs` (dressing and points by level), `dup.mjs`, `offset.mjs`, `overlap.mjs` (shared content between maps), `ramps.mjs`, `ramps2.mjs` (ramp directions).
- `vertcol/` (helper agent): `s1-stats.mjs` (per-map shares, thresholds), `s3-geometry.mjs`, `s5-ao.mjs`, `s8-facing.mjs`, `s9-cliffvertex.mjs`, `s18-cliffset.mjs`, `s22-doodadnear.mjs` (shape tests), `s10-kinds.mjs`, `s12-meshcorr.mjs` (mesh kinds), `s19-history.mjs`, `s20-rebake.mjs`, `s21-allhistory.mjs` (git history, read-only), renders `val-<id>.png`, `ao-<id>.png`.
- `lighting/` (helper agent): `lights.py`, `diffs.py`, `lightrefs.py`, `inplay.py` (local CLights, overrides, in-play vs stock), `lregions.py`, `lightmap.py` (light regions), `terrain.py`, `texcover.mjs` (CTerrain, tileset families, fog), `water.py`, `waterrects.mjs`, `waterdefs.py` (t3Water, CWater), `fluff.mjs`, `fluffbase.mjs`, `omni.py`, `looks.py`, `cobeat.py` (what lighting switches alongside).
