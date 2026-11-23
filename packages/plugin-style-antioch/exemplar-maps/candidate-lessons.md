# Candidate Design Lessons (superseded)

> Superseded on 2026-10-26 by `LESSONS.md` (DL-01 to DL-14). Kept as the first draft; several claims here were corrected by `data-analysis.md`.

Drafted from the 13 Map Studies on 2026-10-25, before the Design Lesson format was agreed. Nothing here is a Design Lesson until the user ratifies it. Numbers come from each map's `study.json`; "L0-L3" are cliff levels (L1 is ordinary ground).

## Texturing

**1. Variety lives on the main level; pits and heights are near-monochrome.**
The top texture covers only 25-52% of L1 on 11 of 13 maps, but 49-96% of L0 and 48-100% of the highest level (3-11 L3: Slayn8 at 99.5%; 3-4 L3: SpearOfAdun1 at 100%; 3-0 L0: ShakurasStone at 78%).
_Apply:_ give each non-playable elevation a single signature texture, and spend texture variety where units walk.

**2. Elevation is legible by texture alone.**
Each level's dominant texture usually differs from its neighbours' (3-0: Stone, Sand, DirtCracked, RockRough for L0 to L3; 3-7 and 3-8: UlaanDirt below, IceWorld4 above).
_Apply:_ choose a texture per elevation band before painting details.

**3. Blends are seams between fields, not noise; there are two field styles.**
Blended cells (two or more textures each giving at least 10%) sit within 2 cells of a border between dominant textures: 81-100% of them on every map.
- *Large fields* (3-2, 3-3, 3-4, 3-10, 3-11, 3-12): 83-97% of cells show a single texture, and only 11-57% of the ground is near any border, so the seams are thin lines between broad fields.
- *Patchwork* (3-0, 3-1, 3-7, 3-8): 42-59% of cells show a single texture, and 81-86% of the ground is near a border; small patches interlock across the whole level.
_Apply:_ never spread blending evenly. Choose the style per area: broad fields with thin seams for built or tiled spaces, patchwork for natural ground.

## Cliffs

**4. Cliff sets are mixed, not taken from the tileset.**
10 of 13 maps list two or more cliff sets, often from other tilesets (3-5 uses four: DesertWorld, BelShir, Castanar and BrokerOffice; 3-7 and 3-8 mix ZhakulDas, Xil, KorhalCity and Shakuras).
_Apply:_ pick cliff sets for the look of each area; the tileset's own set is only a default.

## Doodads

**5. Doodads hug cliffs.**
On 10 of 13 maps, 34-62% of all doodads sit within one cell of a cliff edge, while cliff edges are only 2-24% of the playable cells. The Shakuras maps (3-0, 3-1) go furthest, at about 60%; 3-12, a mostly flat map, is lowest at 8%.
_Apply:_ dress cliff bases and lips first; open ground gets sparse accents.

**6. Dressing is clustered, with large empty stretches.**
On 3-11, 54% of 8x8 blocks have no doodads at all, yet one block holds 41. Most clusters are one or two doodads, with a few big set pieces (3-11's largest has 97 members).
_Apply:_ concentrate dressing into set pieces and leave breathing room between them.

**7. Ordinary models are manipulated into new objects (Doodad Manipulation).**
Every map tilts, stretches, sinks or raises doodads; 3-4 tilts 21%, and 3-3 and 3-5 stretch over 40%. Composites seen:
- 3-4: `AntimatterMissileDoodad` at 2x scale stacked at heights 0.4, 1.1, 2.0 and 3.0 into a tower; crates rolled about 270 degrees onto their sides in piles; stasis pods pitched 90 degrees and squashed.
- 3-7: `XelNagaColumn` laid flat (pitch 90 degrees, scale 0.5 x 0.6 x 2) as beams, with small `TempleColumn`s raised 3.35 above them to form a gateway.
- 3-3: `StarshipHallTrim` stretched 1.7x along one axis, footprint off, and repeated as a continuous trim line.
- 3-11: `TarSludge` sunk 0.27 below ground everywhere it appears, so it reads as a stain, not an object.
_Apply:_ when the asset list lacks a shape, build it from tilted, stretched or stacked parts; keep a library of these as Doodad Composites.

**8. Storytelling clutter comes in families.**
On 3-11 the strongest co-occurrences are Protoss corpses with each other and with `TarSludge` (a battlefield), and temple bricks with temple fragments (a ruin).
_Apply:_ scatter themed families together, not single props.

## Lighting and atmosphere

**9. Lighting changes with area and story beat.**
12 of 13 maps set lighting from triggers, and most switch between several: 3-11 uses `ProtossAbyss` in the Eye setting, `Temple` in the normal setting and `TheVoid2` at the NT base; 3-6 runs `Midnight`, `Midday` and `InsideTemple`.
_Apply:_ give each Zone or Beat its own lighting in the Mission Blueprint.

**10. Cliff feet are darkened with soft shading.**
`t3VertCol` is now decoded (see `packages/core/src/terrain/read-t3-vert-col.ts`). On 8 of 13 maps, 25-47% of cliff-edge and near-edge cells are darkened, against 0-6% of open ground (3-0: 44% at edges vs 5% open). In `vertex-shading.png` it shows as an even gradient along the foot of every cliff, which looks more like a baked ambient-occlusion pass than hand painting. 3-1, 3-2, 3-5, 3-6 and 3-9 have none.
_Apply:_ open question: find out how the shading is made (an Editor bake step or painting), then decide whether compiled maps should always have it.
