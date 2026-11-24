# Mood Mixtures

How the exemplar authors dressed each kind of place, as mixtures to generate from rather than layouts to copy (DL-07, DL-08, DL-15). Data: `mixtures.json`; script: `packages/core/scripts/exemplar-analysis/mixtures.mjs`, which runs core's place-finding (`packages/core/src/study/find-places.ts`, as the `find_places` tool does) over this pack's maps, with the moods `mixtures.json` records as `moodRules`. Extracted 2026-10-27.

## Method

- **Maps:** the 18 independent maps: 2-0 to 2-6, 2-8, 3-0, 3-2 to 3-7, 3-9 to 3-11. 2-7, 2-9, 3-1, 3-8 and 3-12 share content with these (`episode-2-analysis.md`).
- **Places:** doodads within 2.5 cells of each other, with pathing, sight and placement helpers left out. Clusters wider than 18 cells are cut into 16-cell tiles, and places under 8 visible doodads are dropped. That gives 834 places.
- **Motifs [inferred]:** each type gets a motif from its name, whatever its planet: carnage, fire, wreck, military, creep, lab, civic, cargo, machinery, light, masonry, structure, vegetation, weather, rock, decal. `AiurTree`, `HavenTree` and `ZerusTree` are all vegetation, so a mixture can be rebuilt with another tileset's assets. It's name matching, so a few types land in the wrong motif.
- **Moods [inferred]:** each place's mood comes from its motif shares. The tests, recorded in `mixtures.json` as `moodRules`, are applied in order, and the first match wins:

  | Order | Mood | Test |
  |---|---|---|
  | 1 | battlefield | carnage ≥ 15% |
  | 2 | infestation | creep ≥ 20% |
  | 3 | military post | military ≥ 15% |
  | 4 | lab | lab ≥ 15% |
  | 5 | street | civic ≥ 20% |
  | 6 | ruin | wreck ≥ 15%, or masonry ≥ 15% with vegetation and rock ≥ 30% |
  | 7 | shrine | masonry ≥ 20% |
  | 8 | industrial | machinery and cargo ≥ 25% |
  | 9 | built edge | structure, decal and light ≥ 50% |
  | 10 | wild ground | everything else |
- **Roles:**
  - scatter: a type used 6 or more times in the place, or a decal;
  - anchor: a type used once or twice;
  - fill: the rest.
- **Frames:** every place has a frame centred on it, from a place tour (then `capture-places.sh`, now `npm run capture-exemplars -- --places`, 2026-10-27; 834 frames, each in its map's main lighting). A spot check of contact sheets matched the labels (battlefield, ruin, shrine, industrial; in the place tours, 3-11's trench battlefield, a 3-5 lab, a 3-6 tree line, a 3-10 banner plinth). One lab corner on 2-4 came out as infestation because `CharFloorPanel` matched the creep pattern; that's fixed.
- **Episode 3 grid tours are gone.** The original Episode 3 captures (7,790 frames) were lost with their worktree; the place tours replace them for reference. A place's `frames` name its 1000px copies by their path under `<id>/frames/<tour>/`. They aren't part of the pack: `make-frames.sh` writes them into the research archive (the Exemplar Maps README, "Generating the screenshots"). Without them, a place's `center` locates it on the map.

## The moods

Medians per place. Spacing is the median distance in cells to a place's nearest neighbour. Snapped is the share of yaws on a 45° step.

| Mood | Places | Maps | Main motifs (median share) | Doodads | Types | Anchors | Per 100 cells | Spacing | Snapped |
|---|---|---|---|---|---|---|---|---|---|
| battlefield | 36 | 10 | carnage 38%, plus wreck (cracks) and fire | 22 | 9 | 7 | 30 | 0.9 | 19% |
| infestation | 22 | 4 | creep 60%, masonry 12%, vegetation 11% | 14 | 8 | 7 | 22 | 1.1 | 7% |
| ruin | 70 | 10 | wreck 21%, vegetation 16%, masonry 14% | 15 | 7 | 5 | 23 | 1.2 | 14% |
| lab | 34 | 6 | lab 25%, structure 11%, machinery 8% | 16 | 6 | 4 | 29 | 1.1 | 69% |
| military post | 10 | 4 | military 22%, cargo 14%, decal 11% | 24 | 7 | 6 | 23 | 1.2 | 71% |
| shrine | 53 | 11 | masonry 33% | 15 | 4 | 1 | 24 | 1.1 | 86% |
| industrial | 77 | 10 | machinery 53%, structure 10% | 13 | 4 | 2 | 23 | 1.0 | 74% |
| street | 81 | 6 (67 on 2-2) | civic 67% | 15 | 4 | 2 | 15 | 1.4 | 76% |
| built edge | 98 | 9 | decal 24%, structure 11% | 17 | 3 | 2 | 19 | 1.4 | 84% |
| wild ground | 353 | 13 | vegetation 80% | 15 | 3 | 1 | 23 | 0.9 | 7% |

`mixtures.json` has, for each mood:
- quartiles of every measure;
- light colours;
- the type pool each map used for each motif (for example, battlefield fire: `ProtossFireMedium` on 2-1 and 3-2, `FireMedium` with `SmokePillarsTall` on 2-2);
- up to six example places with frames;
- every place, with its mood, motifs, top types and frames.

## What the mixtures show

- **[measured] Two kinds of place.**
  - Story places (battlefield, infestation, ruin) use many types: 7-9, and 5-7 of them one-offs. Their yaw is free: 7-19% snapped.
  - Built places (shrine, industrial, street, built edge, lab) repeat a few types: 3-6, with 1-4 anchors. Their yaw is snapped: 69-86%.

  That's DL-11's natural/built split, seen at the scale of a place. For a story place, sample many types once each; for a built place, choose few types and repeat them in order.
- **[measured] A battlefield is carnage plus damage plus fire, and little else.** Its pools across 10 maps are bodies or bones, ground cracks or torn plating, and fire or smoke. A planet's corpse and crack types change, but those three motifs don't.
- **[measured] Density is about the same for every mood:** 15-30 visible doodads per 100 cells, with nearest neighbours 0.9-1.4 cells apart. What changes between moods is which motifs are used and how many types, not how much is placed. Streets are the sparsest (15) and battlefields and labs the densest (29-30).
- **[measured] Point lights belong to moods.** Wild ground (2-3's forest) carries most of them: green, orange and cyan. Shrines are lit red (62 of 67 lights). Ruins are cyan, orange, green and red. Built edges are mostly white.
- **[measured, Blizzard] Indoors the same density sits on the walls.** Blizzard's hero-mission interiors carry about 18 doodads per 100 floor cells, in the same range as these moods, but most of it stands on the walls round the floor or within 2 cells of them, and the open floor is mostly decals (DL-06). So an industrial or lab place inside a room is a kit backed onto a wall, not a ring in the middle of the floor.
- **[inferred] Street rests on 2-2.** Outside 2-2, "street" places in Episode 3 are mostly ship kitchens (`AiurChef*`), because the civic motif also covers domestic props. A city mixture should draw from 2-2 (DL-15).

## Using it

To dress a place:
1. Pick its mood.
2. Take that mood's motif shares, type count, anchors, density, spacing and snapping, roughly at the median and varied within the quartiles.
3. Fill each motif from the mission tileset's own types. The pools show which types other authors used for that motif.
4. Arrange with DL-06's empty ground between places. In a built room, back each place onto a wall and give each working place its kit (machine, supply, stock, light, floor marks): [`INTERIORS.md`](../knowledge/INTERIORS.md).

Never place an exemplar place's members at their recorded offsets. Exact offsets are only for DL-07 shapes.

## Not done

- Moods come from name-matched motifs and fixed thresholds; most places haven't been checked against a frame. Every Episode 3 place now has a centred frame, so a visual pass per mood is cheap.
- How a place sits on terrain (against a cliff, at a ramp, in a pocket) isn't measured. DL-05 and DL-15 cover this in prose.
- There's no generator yet. `mixtures.json` is the input one would read.
