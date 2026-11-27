# Paint Regions: Polygons with a Texture Mix

A Mission Blueprint can say how much of each texture a part of the map shows. Notes from a Still Review (#122) read like "the dark stone at about 15%, the dark grass at 80%, with 5% sand", or "a tiny bit of dark stone along the wall to the left". Until now a Blueprint couldn't say either. A texture palette names a main texture and up to 3 variety textures, with no amounts, and how much variety shows comes from the Style Pack's `varietyPatches` rule, for the whole map. Issue #132 is the spec.

## Decisions

1. **A Paint Region is a polygon in the Blueprint.** `paintRegions` is a list of `{ id, polygon | zone, mix, falloff?, levels? }`.
   - `polygon` is an outline in map cells, inside the map. `zone` takes a Zone's polygon instead, and follows the Zone when it moves. A region gives one of the two.
   - `mix` is up to 8 entries, `{ texture, weight }`, `{ texture, share }` or `{ texture }`.
   - `falloff` is the width of the feathered edge in cells (decision 4).
   - `levels` are the cliff levels it paints, every level when left out. A cell's level is its Zone's `elevation`.
   - A region paints the cells whose centre its outline holds, never past its outline.
2. **Each texture gets a blend weight or an area share.** These are two different things, and the mix keeps them apart.
   - A **blend weight** is that fraction of the texture's layer in every cell. Stone at 0.15 means a hint of stone in every cell, not stone patches.
   - An **area share** is patches of the texture covering about that fraction of the region. The variety painter from #117 lays them down, a wash with a full-strength core.
   - The weights and shares together are at most 1. What they leave goes to the one texture with no amount. With none, it goes to the ground the Zone palette paints there. A mix has at most one texture with no amount.
   - On LotV height-blended textures (#137's research), a texture's visible share isn't linear in its weight. The shader multiplies each layer's weight by its height map and cuts any layer more than 1.0 below the strongest. So a low weight shows as patches in the other textures' crevices, not as a tint, and can vanish over a flat texture. That is one more reason a weight is never read as an area share, or the other way round. #137 covers what this means for authoring.
3. **The order of layering.** The compile paints the Zone palettes first, then each Paint Region in list order. A later region covers an earlier one where they overlap. A region overrides its Zones' palette inside it, and leaves it alone outside.
4. **The edge is feathered.** Over `falloff` cells inward from the outline, the region's mix fades in from the ground under it. Past that it holds in full. The default is 2 cells, and 0 gives a hard edge. So no region shows a seam along a polygon edge unless it asks for one, as the Editor's soft brush doesn't.
5. **The compiler rasterises the polygons into a per-cell mix map.** It has one channel per texture of the cell's texture set, and the texture painter reads it (#134). The map lives only inside the compile. The Blueprint stores the polygons.
6. **A region names only textures its cells' texture set holds.** That set is the 8 textures of the block each cell is on. The schema checks this, and names the set and its textures:
   - on a fully generated map, a cell's set is its 8×8 block's, by ADR-0016's rule (the set whose Zones cover most of the block; `blockSet` in `terrain/texture-grid.ts`, which the compile shares). Set 0 is the map's textures (`textures`, else the palette's, then the tileset's).
   - beside Kept ground, a region paints only generating Zones' cells. The ground of a Kept Zone, or of a cell no Zone holds, stays as the package has it (ADR-0010). A region's `zone` must be a generating Zone. A generating Zone in a texture set is checked against that set. One in no set is on whatever set the package has its blocks on, which only the compile can read, so the compile checks it.
   - A region over two sets must hold the texture in both, unless its `levels` keep it to one.
   - The other checks: unique ids, a polygon inside the map, a known Zone, each texture once in a mix, and the two rules on amounts above.
7. **This ticket adds the schema and its checks only.** A Blueprint with Paint Regions compiles exactly as before until #134 paints blend weights and #135 paints area shares.

## Considered options

- **A bitmap committed beside the Blueprint** (a mix map, or paint brushed in the Editor, read back). Not yet. An agent can't write a bitmap from a review note, and a PR diff can't show one. A polygon is a few lines of JSON that both can read, and a region can follow a Zone. A committed bitmap for Editor-brushed paint is left for later. It would come in as one more layer under the regions.
- **One amount per texture, read as a weight or a share by the texture or the Style Pack.** Rejected. "15% stone" means a hint in every cell to one author and stone patches over 15% of the ground to another, and on a height-blended texture the two look nothing alike (decision 2). The mix says which.
- **Amounts on the Zone's palette** (`variety` with shares). Rejected. Review notes name parts of the map that don't follow Zone edges, such as a strip along a wall. A region can still take a Zone's outline with `zone`.
- **Feathering outward, across the outline.** Rejected. A region would paint cells it doesn't hold, which might be on another texture set, and the checks in decision 6 couldn't be sure of its cells.

## Consequences

- `get_blueprint` and `patch_blueprint` pass `paintRegions` through, as they do every field, and `patch_blueprint` refuses a region the checks refuse.
- A region's texture check runs in the Catalog-aware schema (`missionBlueprintSchema`), since set 0's textures can come from the tileset.
- Later tickets: #134 rasterises the mix map and paints blend weights. #135 paints area shares through the variety painter. #136 adds tools to write a region from a Zone, a rectangle or a Still Review mark, and to measure each region against its mix. #137 covers knowledge, skills and a tutorial.
