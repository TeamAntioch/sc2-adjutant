# Episode 1 against the Design Lessons (2026-10-27)

Episode 1 of `TeamAntioch/tac-arcade`: 1-1 to 1-9, all `edited` (confirmed by the author). 1-9.5 is skipped at the author's request. Measured with `packages/core/scripts/exemplar-analysis/lessons.mjs` and `overlap.mjs`; frames from place tours, plus one grid tour of 1-4.

## Read this first: three Episode 1 maps are shared with others

| Pair | Offset | Shared doodads | Terrain | Counted |
|---|---|---|---|---|
| 1-9 ~ 2-0 | (8, 24) | 689, all of 1-9 | identical | 2-0 |
| 1-4 ~ 1-6 | (-64, 0) | 448, 71% of 1-6 | identical | 1-4 (author's choice) |
| 1-3 ~ 2-1 | (0, 0) | 325, 55% of 1-3 | identical | 2-1 |

The author chose 1-4 over 1-6, keeping the original with most of the distinct dressing. 1-9 and 1-3 follow the same rule: 2-0 and 2-1 already count and carry more of their own dressing. Confirmed by the author (2026-10-28); reversing it only means adding the map back to `INDEPENDENT` in `mixtures.mjs` and running its place tour (1-3's and 1-9's full-size place tours are archived in `~/Library/Caches/sc2-adjutant/captures/`).

That leaves six independent Episode 1 maps: 1-1, 1-2, 1-4, 1-5, 1-7, 1-8. They add 195 places to `mixtures.json` (1,029 in all).

## Part 1: The ratified lessons

| Map | Tileset | DL-01 one-texture areas | DL-02 up with texture change | DL-03 blend at border | DL-04 families, top | DL-05 cliff lift | DL-06 per 100 cells, empty, densest tenth |
|---|---|---|---|---|---|---|---|
| 1-1 | AntiochOldAiur | 0 | 0.72 | 0.92 | 2, 0.76 | 1.36 | 6.8, 0.29, 0.35 |
| 1-2 | BelShirEx1 | 0 | 0.59 | 0.97 | 1, 1.00 | 1.68 | 2.8, 0.40, 0.45 |
| 1-4 | Char2 | **0.81** | 0.31 | 0.87 | 1, 1.00 | 1.58 | 1.6, 0.74, 0.76 |
| 1-5 | BraxisAlpha platform | 0 | (down 0.73) | 0.91 | 2, 0.93 | 1.04 | 7.1, 0.41, 0.41 |
| 1-7 | AntiochOldAiur | 0 | 0.87 | 0.98 | 2, 0.83 | 0.63 | 0.8, 0.71, 0.47 |
| 1-8 | AntiochOldAiur | 0 | 0.32 | 0.92 | 2, 0.83 | 1.26 | 6.3, 0.26, 0.37 |

### DL-01. Backdrop one texture; natural ground never one texture — holds on five maps; 1-4 is older design (C-1)

Five maps have no single-texture frame area on their main level. 1-4 has 81%: its main level (level 0, 53% of playable cells) is 99% `Char2_1`, a dark ash. The grid tour shows that this is open play ground, not backdrop: the Terran base and the routes between areas sit on it (its `Char2` stop 162). It still reads as varied, from the texture's own cracks and red flecks, the cliff edges, lava, and the lilac high ground above it, which does mix textures (stops 97 and 125). See candidate C-1.

### DL-02. Elevation reads from the cliff, best with a texture change — holds, weaker on two maps

0.59-0.87 of upward crossings change texture on 1-1, 1-2 and 1-7; 1-4 (0.31) and 1-8 (0.32) are lower, like 2-5 (0.23). On 1-4 that follows from the one-texture plain.

### DL-03. Blend at borders — holds (0.87-0.98).

### DL-04. Cliff set paired with its ground; one main family — holds. One or two families, the top one at 0.76 or more.

### DL-05. Dress the cliffs first — holds on natural maps

Dressing near cliffs is 1.26-1.68 times denser than away from them on the natural maps. 1-5 is a built platform (1.04), which the rule allows. 1-7 (0.63) has only 213 doodads and 2 places.

### DL-06. Concentrate dressing into set pieces — holds; two maps are much sparser

The densest tenth of blocks holds 35-76% of the dressing. 1-4 (1.6 per 100 cells) and 1-7 (0.8) are far sparser than any Episode 2 or 3 map except 3-3 (1.4); they don't follow DL-06's "dress denser than feels necessary".

### DL-07. Doodad Composites — holds, as a tool. 1-1 tints 30% of its doodads, second only to 3-0 (56%).

### DL-08. Story props as families — holds

Top pairs: TempleArch + TempleDebris (1-1, lift 72), BloodSplats + ZerglingRagdoll (1-2, 58), FireMedium + UmojanLabDebris (1-5, 70), SpiresLarge + VolcanicSpire (1-4, 44), TempleBricks pairs (1-7, 1-8).

### DL-09. One light for the mood; change it at Beats — holds; four maps set it in data

Every map picks its own light. 1-4 (`Char2`) and 1-5 (`BraxisAlpha`) set it with a trigger at map start. The other four set it in data, with no trigger at all: a map-local terrain type names the light (1-1 and 1-8 `AiurNight`, 1-2 `BelShirEx2`, 1-7 `MarSaraCampaignDay`). This is the data-first habit the toolkit already prefers, and it's why the first pass, which only counted `GameSetLighting` calls, reported these four as setting none. No map changes its light during play.

### DL-10. Not measured.

### DL-11. Rotate natural props freely; snap built props — holds for rotation; natural scale varies a lot

Natural props are almost never snapped (3-11%). Built props are snapped on 1-5 (70%) but much less on the natural maps (10-47%), as in Episode 2. Natural props are rarely at scale 1 (3-23%), with 10th-90th percentile spreads like 0.6-1.38 on 1-1: Episode 1 uses the scale variation DL-11 leaves optional.

### DL-12. Point lights — optional, and rare here (1-4: 37; others 0-16).

### DL-13. Water — not measured.

### DL-14. One main planet plus accents — holds (one to three families).

## Part 2: Candidates

**C-1. A dark volcanic plain can be one texture (DL-01 exception?).** 1-4 keeps its playable low ground, 53% of the map, almost entirely one ash texture. It works because the texture is busy on its own and the plain is broken by cliffs, lava and a contrasting high ground. Options: (a) add a narrow exception to DL-01 for busy volcanic or ash ground broken by lava and cliffs; (b) treat 1-4 as an older habit not to copy and leave DL-01 as it is. **Decided (2026-10-28): (b).** The author agreed it is an older design; DL-01 stays as it is. Five of six Episode 1 maps and every Episode 2 and 3 map follow it.

**C-2. At night, tell ground types apart by brightness (1-8). Ratified 2026-10-28 as DL-17.** Under `AiurNight`, 1-8 has three ground types at three brightness levels: dark jungle canopy, mid-grey temple plazas (`MonlythBricks`), and creep, which is the brightest thing on the map and reads as pale violet. Enemy ground stands out with no extra marking. The bright creep was a side effect of the light, not a plan, but the author kept it because they liked it. Lesson: on a night map, check each ground type's brightness under the chosen light, and keep a found contrast like this when it helps.

**C-3. Night maps need point lights. Ratified 2026-10-28 into DL-12.** On 1-8, cyan pylon glows, 21 `Floodlight`s at the Terran bases and warm torch spots provide most of the color and focal points. Without them the dark ground has nothing to catch the eye. Point lights stay optional on day maps and are expected on night maps.

**C-4. Trees go in masses, as solid canopy (1-8). Ratified 2026-10-28 as DL-16.** Half of 1-8's 2,181 doodads are one type, `AiurTree`. 774 of its 1,070 trees stand outside the playable bounds, framing the map in dark forest. The 296 inside are packed a median 1.32 cells apart, and 72% of them sit in clumps (5 or more other trees within 4 cells), so the canopy reads as solid forest with clear ground between blocks. 2-3, also forest, packs the same way (1.10 cells, 69% clumped). 1-7 scatters its 91 playable trees 4.24 cells apart with no clumps, and reads as the sparse map it is. Measured from Objects with `AiurTree` positions only.

## What this pass did not do

- **1-8's place tour was fixed on 2026-10-28.** At first it never started: the game ran the copy with its full UI, no bank and no script error. The cause was 1-8's imported `TriggerLibs/Terran/Terran.galaxy`, an old Liberty melee AI that overrides the game's own and references units that no longer exist (`c_TU_Firebat`, `c_TU_Vulture`). When it fails to compile, every trigger stops silently. `make-copy.sh` now drops imported trigger libraries from capture copies, and 1-8's 68 places have frames.
- DL-10 and DL-13 are not measured, as in Episode 2.
- 1-6, 1-3 and 1-9 have Map Studies but are not in the mixtures.
