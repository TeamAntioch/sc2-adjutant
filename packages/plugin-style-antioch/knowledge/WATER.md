# Water

How to fill pits with water or lava, and raise them at a Beat, through the blueprint's `water` and `transitions` (DL-13).

## Fields

- **`water`**: pools, each over one zone:
  - `type`: a stock water or lava type (`packages/core/data/water-types.json`, built by `node packages/core/scripts/build-water-catalog.mjs`), often another planet's;
  - `height`: absolute (ground is 8, a level-0 pit's floor 0; the author's Agria pit sits at 5.9);
  - `margin`: cells added around the zone's bounding box (default 4, so waves reach the cliff);
  - `rects`: `[[x0, y0, x1, y1], …]` in cells, the pool's own rectangles instead of the zone's box and margin. `npm run sync` writes them for water the author drew in the Editor, which keeps it as tiles, with `bank: false`, since the author shaped that ground by hand (kept as `terrainEdits.heights`);
  - `bank`: the floor rising into a bank along the pool's edge, so the waterline wanders instead of tracing the zone's polygon (`{ width: 5, rise: 0.8, dip: 1.2 }` by default: within about `width` cells of the edge, the bank's top drifts along the shore from `dip` under the surface to `rise` above it); `false` keeps the floor flat, the water against the cliff;
  - `dig`: `{ depth }` (default 4) for a pond dug into its zone's own level instead of a pit. The zone sinks into a bowl up to `depth` deep, with a rim that wanders 1.5 cells either side of the zone's edge, and the cells under the surface are painted unpathable (`CellAttribute_Pnp`). The bowl's slope is the bank, so `bank` is ignored. Keep `height` just under the ground around it (ground is 8, give or take 0.3: the author's test pond sat at 7.55);
  - `color`: 0-1 per channel, then opacity; without it the stock look;
  - `states`: further named heights (and colours), e.g. `{ "name": "Flood", "height": 7.5 }`.

  Each pool compiles to its own copy of its type (`Agria_Pit`), so pools keep their own heights.
- **A transition's `water`**: `{ "poolId": "pit", "state": "Flood", "seconds": 10 }` moves the pool to a state over that time; `"default"` returns it. It can share a transition with a light change, as 3-11's lava reddens while it rises.

## Steps

1. **Pick the pools.** Pits and void floors (backdrop) are where water goes (DL-13: 2-5 times more often than their share of the map). Done when every backdrop zone has water, lava or a reason to stay dry. A pool can also sit on a play level as a pond, dug in and painted unpathable (DL-13, 1-8's ponds): give it a zone on that level, listed after the zone around it and with no connections, and a `dig`.
2. **Pick each type and height** from the area's palette. The height sits between the zone's floor and the ground around it; the compiler warns when it won't show or would spill over the rim. Different heights need different pools, never one type stretched.
3. **List the Beats that move water**: a flood or eruption rises, a drain falls (3-3's tainted water rises 7.8 -> 9.55; 3-11's lava 4.8 -> 8.4 over 15 s). Done when each has a state and a transition.
4. **Dress the shore** through `dressing.shores` (below). Done when every pool with a bank has a pile, a fringe and sunken pieces chosen against its ground.
5. **Check it in game**: the surface, the waves at the cliff, the shore, and each rise.

## Shore dressing

`dressing.shores` dresses every pool's waterline (the author's review, 2026-10-27: "There's not enough stuff around the shoreline"):
- `pile`: a pile like a cliff pile's (`large`, `small`, `accent`, `tint`), heaped round a waterline cell, one every `spacing` cells of shore on average (default 2.5): 1-2 large pieces at the line, 3-6 small ones a little up and down the bank;
- `fringe`: plants and pebbles, one on `fringeChance` of the waterline cells (default 0.6); water plants, alien plants and small rocks. A shore is a natural edge, so its fringe should grow dense and right at the line, never as an even row ([`DRESSING.md`](DRESSING.md#edge-taste)); the fringe isn't clumped by any rule, so keep `fringeChance` high and let the piles make the clumps;
- `sunken`: big rocks or ruins standing in the shallows to break the surface, one every `sunkenSpacing` cells of shallows (default 6);
- `lights`: light doodads strung along the waterline (below);
- `edits`: Editor edits read back by `npm run sync`, keyed by the doodad's id after `shores/`.

Every piece stands on the ground at its own spot with "ignore placement" set. Pick the rocks by their look against the pool's ground texture, not by name or planet (the author, 2026-10-27: "the choice of rock is the wrong color against the terrain"); the catalog's `look` is the only colour data. On Agria's green ground, mossy grey-green Elsecaro rocks (`Elsecaro_Medium_Rock_Group`, `Elsecaro_Medium_Rock`, `Elsecaro_Large_Rock`) worked; brown and orange rocks stood out.

## Shore light and glow

Most exemplar shores carry no light: lights are no denser near water than elsewhere on 12 of 15 maps. Decide per mission, from its mood:
- **Dark outdoor mood** (a night, a dark planet): string `dressing.shores.lights` along the waterline, as 3-6's night shores pick their bank rocks out of the dark.
- **Daylight**: no lights. Glow, if any, comes from glowing plants and crystals.
- **Interior or dark temple** (3-7, 3-8, 3-2): leave the water dark, even where the map has lights elsewhere.
- **Lava** (3-11): no lights; the lava glows itself, with red-glowing pieces at most.
- **Built shore** (docks, a city waterfront): the place's own fixtures (streetlights, landing lights, city lamps) as set-piece or pile members, not coloured omni lights.

`lights` takes:
- `light`: the stock `LightOmni<Colour>Large` nearest the dark lighting's ambient hue (`summary.ambient.hue` in `packages/core/data/light-catalog.json`, or your retuned ambient colour). Never "water blue" by default: the colour the darkness already has, brighter at the line. Hues measured from the gallery: red 357°, orange ~15°, yellow 50°, green 123°, cyan 186°, blue 238°, purple 268°; white for an ambient with little saturation.
- `accent` and `accentChance` (default 1/6): the place's signature colour, sparingly (Shakuras' red among cyan);
- `reach` (default 10): only waterline within this many cells of the player's routes to the goals is lit, so lights go where the player looks (without goals, all walked ground counts);
- `spacing` (default 2.5) and `lift` (default 0.2 above the surface), as 3-6's strings.

Glow isn't always light: glowing biome plants and crystals (Shakuras' blue pods, Char's pink-tipped tendrils, Zerus plants) go in `fringe` and `sunken` in the biome's colour, in daylight too. Search the catalog for `glow` with the biome.

Dressing leaves the ground under a pool's surface bare except for sunken pieces, and cliffs whose foot is underwater get no cliff piles. Where a bank dips under the surface, the water still meets the pit's straight cliff. Damage in water (3-3) is out of scope: the author's campaign doesn't use it (2026-10-27).
