# Choosing cliffs

How to fill the blueprint's `cliffPalette` and `cliffSets` for step 2 of [`GUIDE.md`](GUIDE.md): a cliff set chosen together with the ground it borders (DL-04). The fields are defined on `cliffPalette`, `cliffSets` and the Zone's `cliff` in `packages/core/src/domain/mission-blueprint.ts`; the compiler assigns them (`packages/core/src/terrain/cliff-sets.ts`).

## The palette

A cliff belongs to the ground on top of it.
- `natural`: cliffs under natural ground. Pair it with the textures on top (`pairsWith` in the catalog).
- `built`: cliffs under Zones whose `surface` is `built` (a fortified mesa, a raised platform).
- `pit`: cliffs dropping below the main level, so pit rims and high walls can differ (DL-04).
- A Zone's own `cliff` is an accent for that Zone's cliffs and wins over the palette.

## Areas with their own cliffs

`cliffSets` gives an area its own family over the palette, chosen with the area's ground (DL-04): a list of `{ "cliffSet": "AiurTempleCliff1", "zones": ["ruin*"] }` groups. `zones` takes Zone ids or `*` patterns over them, as `textureSets` does. A Zone is in one group at most, and its own `cliff` wins over its group. Beside Kept ground a group lists generating Zones only, and its set must be one of the map's cliff sets already (the compile warns otherwise).

Which side owns a cliff between two Zones:
- A cliff belongs to the Zone on top of it, the lip, so a mesa's or a ledge's cliffs follow the mesa's or the ledge's choice.
- A wall of backdrop rock is the exception. Where the Zone on top is a `backdrop` and the Zone at the foot isn't, the cliff belongs to the floor at its foot if that floor names a set (its own `cliff` or its group's). The walls a tunnel's or a ruin's units see are then chosen with the floor they stand on, even where one rock band surrounds several floors. A floor that names nothing leaves its walls to the rock: the rock's own choice, else the palette. So on a wall, a backdrop's own `cliff` gives way to a floor that names a set.
- A step between two backdrops (bands of rock meeting) belongs to the higher one. Give the rock bands round an area a group of their own if those steps show.

For example, a Mission whose tunnels and rock wear `ProtossBaseOrganicCliffs` (the palette's `natural`), whose ruin floors wear `AiurTempleCliff1`, and whose dark north-west wears `CastanarEx1Cliff0`:

```json
"cliffPalette": { "natural": "ProtossBaseOrganicCliffs" },
"cliffSets": [
  { "cliffSet": "AiurTempleCliff1", "zones": ["ruin1", "ruin2", "ruin3"] },
  { "cliffSet": "CastanarEx1Cliff0", "zones": ["ruin4", "int45", "ruin5", "r5_t*", "esc_l*"] }
]
```

Here ruins 4 and 5 sit in the north-west group, as a Zone is in one group. A generated map uses at most 4 cliff sets, counting the palette's `natural` even where no cliff wears it. Validation refuses a Blueprint naming more than 4 (the palette's `natural`, the groups' sets and the Zones' `cliff`), and the compile refuses a map whose cliffs would wear more, `built` and `pit` included. Beside Kept ground the map keeps its own list. That figure is the community's, not yet checked in the Editor, and none of the 166 archived maps with cliffs uses more than 4.

Keep one main family (DL-04): usually its natural and built sets as `natural` and `built`, with accents only where the story singles out a place. DL-14 allows one or two families, and a third only on purpose, such as a set of ruins that should read as one before any dressing. Without a palette every cliff wears the tileset's first set. Cliff sets from any tileset can be mixed with no override (checked in the Editor, 2026-10-26: Bel'Shir's natural set on a Mar Sara map).

## Ragged outlines

Cliffs under natural ground don't follow their Zones' polygons exactly: a long straight side would make a long straight cliff, which looks artificial. The compiler wobbles each natural outline in and out by whole corner steps (2 cells), smoothly along the edge, up to the blueprint's `raggedCliffs` cells (4 by default; `0` keeps every cliff on its polygon). The wobble is seeded from the blueprint's `terrainSeed`, or the Mission's id when it has none, so the same blueprint always compiles the same terrain; a renamed Mission sets `terrainSeed` to its old id to keep its cliffs' shapes (`packages/core/src/terrain/ragged-outlines.ts`).

What stays put:
- Built Zones (`surface: "built"`) keep straight sides, and so do the cliffs under them; beside a built Zone the wobble fades in over a few cells.
- The ground round every ramp, bridge and terrain object, and round each Connection's `at`. Ramps are fitted on the straight polygons first, then the wobble fades in over a few cells away from them. Give a narrow crossing an `at` so its width stays as drawn.
- A natural polygon's own corners. The wobble fades in along its sides, so a Zone only a few corners across hardly wobbles.
- Borders between Zones on the same level. Only cliffs move; textures and regions follow the polygons.

Everything after the cliff levels reads the wobbled cliff: cliff sets (a cliff wears the set of the Zone whose ground is on top of it), cliff piles, lip lines, a pit pool's banks (measured from the foot of the cliff, not the polygon), and the layout checker's cells. Draw polygons where the cliff should run on average, and reach for `raggedCliffs: 0` only for a deliberately geometric place.

## Finding cliffs

The catalog holds every cliff set the tilesets use. Its descriptions are the published [`@team-antioch/sc2-asset-catalog`](https://github.com/TeamAntioch/sc2-asset-catalog)'s, written from each set's picture: `look`, `kind` (natural or built), `tone` and `pairsWith`. Core's [`packages/core/data/cliff-extracted.json`](../../../packages/core/data/cliff-extracted.json) adds each set's `tilesets` and gallery picture, and each tileset's cliff sets in order; a set's `family` and the `variant` its name suggests (`…Cliff0` organic, `…Cliff1` manmade) come from its id. Trust `kind` over `variant`: lab, platform and city families name built walls `Cliff0`, and a few `Cliff1` sets are natural rock. 19 sets have no picture or description. Search by words, every one of which must appear in the set's id, family, tilesets or description:

```sh
node -e "import('@team-antioch/sc2-asset-catalog/catalog/cliff-catalog.js').then(({ readCliffCatalog, searchCliffSets }) => { for (const e of searchCliffSets(readCliffCatalog({ extractedDir: 'packages/core/data' }), { words: process.argv.slice(1) })) if (e.description) console.log(e.id, '|', e.description.look, '|', e.description.kind, '|', e.description.pairsWith) })" marsara
```

Core's extracted fields are regenerated with `npm run extract-catalog`. A description is changed by pull request on sc2-asset-catalog and reaches here with a release (`docs/agents/asset-catalog.md`).

## Steps

1. With the textures chosen ([`TEXTURES.md`](TEXTURES.md)), pick a family whose natural set `pairsWith` the main ground and whose built set suits the builders. Add a `pit` set if the map has pits, a `cliffSets` group for an area whose ground calls for its own family, and a Zone `cliff` only for a place the story singles out. Present them in the same table as the textures.
2. Write `cliffPalette`, any `cliffSets` and any Zone `cliff`. Done when `npm run compile-map` succeeds.
3. The author looks in the Editor, then runs Generate Static Shadows last (GUIDE.md step 6).
