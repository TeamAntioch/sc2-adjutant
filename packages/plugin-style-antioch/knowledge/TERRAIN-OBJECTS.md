# Terrain objects

Terrain objects are the Editor's Terrain → Objects layer: Blizzard's built pieces that carry their own ground, such as bridges, pits, trenches, holes, elevators, floor plates and craters. Each one is a model plus a grid of cliff levels that it stamps into the terrain under itself. That makes it different from a doodad, which sits on the ground and leaves it alone. Most stamps only level the ground under the model, so the model does the shaping. Maps list them by id in `t3Terrain.xml`'s `cliffDoodadList`. 13 Exemplar Maps place 39 different ones, mostly 1-4 to 1-6, 2-2 and 3-4: Korhal holes, coolant pipes, grid floors, blast craters, subway entrances and Starship flora pods.

Place one through the blueprint's `terrainObjects`: an `id`, its catalog `type`, the centre vertex `at` and a `rotation` (quarter turns anticlockwise; at 0 the stamp's first row lies along the north edge). The compiler writes the object and stamps its cliff levels over the zones. Two rules:

- **The stamp's edges sit on the 2×2 cliff grid** (even vertices), as the Editor snaps them. A stamp `across` × `down` vertices has half-sizes (across−1)/2 and (down−1)/2, and the centre must be odd on an axis whose half-size is odd: Bridge6x10 (7×11, half-sizes 3 and 5) centres on an odd x and an odd y. The compiler refuses an off-grid centre and names the nearest good one; off the grid, cliff meshes would show through the object as holes.
- **Fit the zones to the stamp.** Its edge corners must meet the ground at the levels it sets. Bridge6x10 at (67, 63) covers vertices 64–70 × 58–68, so its chasm's level-0 corners run from y 60 to 66 (a chasm zone from y 60 to 67), with level-1 ground at 58 and 68. A wider chasm leaves the bridge short, and its stamp fills the far end, as the Editor does when the author places one by hand. `npm run compile-map` warns then. The ground beside each end is lowered a vertex either way; the model covers it.

sc2-adjutant's test-fields example, `packages/core/examples/test-fields/missions/terrain-objects/blueprint.json`, is a worked example with two bridges, two holes and a Height 2 piece.

For a crossing between zones, prefer a `bridge` connection to a hand-placed bridge. The compiler picks a stock bridge and reshapes the chasm to fit it (see below). Place a bridge by hand only for a variant it doesn't pick, such as a destroyed (`…D`) or diagonal bridge.

## Bridge connections

A `bridge` connection between two level-1 zones with level-0 ground between them compiles to a stock bridge. Its id is `<zone>-<other zone>-bridge`. The compiler:

- **Places it** at the connection's `at` (from either side's listing), or else where the zones come closest. The bridge spans east-west or north-south, whichever is the larger gap between the two zones.
- **Picks it** from the tileset's own bridges, or Castanar's on a tileset with none. Castanar's straight bridges span 10 or 16 cells, and Monlyth's light bridge spans 16 and is turned for north-south. It takes the longest that fits the gap, measured along the deck between the level-1 corners either side.
- **Builds bridgeheads** when the gap is longer than the bridge. The bridge is centred in the gap, and each end gets a landing of the bridge's width that fills the chasm up to it, so its stamp meets the ground. If the gap is shorter than every bridge, the shortest is used, and its stamp widens the chasm round its ends.

It refuses banks that aren't both on level 1 (no stock straight bridge joins other levels), a crossing with no lower ground on the line, higher ground in the way, and a gap that runs off the map. The connection's `width` isn't used, since stock decks have a fixed width. The test-fields example's `missions/bridge-connections/blueprint.json` has one of each case: an exact fit, bridgeheads, the long bridge, and a gap narrower than any bridge.

## Finding terrain objects

The catalog, [`packages/core/data/terrain-object-catalog.json`](../../../packages/core/data/terrain-object-catalog.json), holds Blizzard's 400 terrain objects. Each entry has:

- `name`: the Editor name.
- `family` and `height`: for an object shipped in three copies at cliff levels 1 to 3 ("(Height 2)").
- `package`, and `overriddenBy` when a later package swaps its model.
- `model`, `tileset`, `cliffSet`.
- `size`: `across` and `down` in cells.
- `levels`: the cliff levels its stamp uses, 0 to 3.
- `heightCodes`: the stamp itself. One string per row, where A to D are cliff levels 0 to 3 and a space leaves the ground alone. A few of Blizzard's grids have fewer rows than `size.down`.
- `doodads`: the doodads made from the same piece. Blizzard ships most terrain objects as a doodad too, such as the trench doodads that dress a trench. Their doodad-catalog entries have pictures.
- `image`: a picture in the sc2-mapping-reference gallery (`public/doodads`), for 102 of the 400. Some pictures show the companion doodad rather than the object: the Valhalla floors' pictures show neon pipe rings, not the floor.
- `sheet`: the picture to read first. It's a 512 px JPEG of the model's four turntable renders on grey, in `packages/core/data/catalog-sheets/terrain-objects/`, shared by the height copies. 395 of the 400 name one; the other five have no model. Sheets are rendered game assets, so they're git-ignored and built on the author's machine: `npm run thumbnails -- --terrain-objects`, then `npm run catalog-sheets` (the Host Adapter needs `model.render`). If the file is missing, say so and fall back to `image` and `description`.
- `thumbnail`: where there's no gallery picture, the first raw WhiteoutFlakes render in `packages/core/data/thumbnails/terrain-objects/`. It's git-ignored and exists only once `npm run thumbnails -- --terrain-objects` has run.
- The `sheet` and `thumbnail` paths are relative to core's package folder, not the repo root: open `packages/core/` plus the path.
- `exemplars`: how many each Exemplar Map places.
- `description`, written by looking at the gallery picture, the render and the companion doodad's picture:
  - `look`
  - `kind`: natural or built.
  - `use`: what it does to the ground. One of `bridge`, `pit`, `hole`, `crater`, `trench`, `floor`, `platform`, `wedge`, `wall`, `ramp`, `elevator`, `structure`, `cage`, `pen` or `ice`.
  - `story` and `biome`: tags from the doodad catalog's vocabulary.
  - `state`: for destroyed pieces.
  - `seen`: what the description rests on, `picture`, `render`, `doodad` (the companion doodad's picture) or `unseen`. 74 are `unseen`, from the name and stamp only, because their renders came out blank or broken: the Xel'Naga cavern wedges, the hybrid glass floors, Kaldir's psi disintegrator and expedition gate, the Armored Generator, and three objects whose model isn't in the game data. Look at one of those in the Editor before using it.

Search by words:

```sh
python3 -c "import json,sys; c=json.load(open('packages/core/data/terrain-object-catalog.json')); [print(k,'|',v['description']['use'],v['size'],'|',v['description']['look'],'|',v.get('sheet','')) for k,v in c.items() if all(w in json.dumps({**v,'heightCodes':0}).lower() for w in sys.argv[1:])]" bridge
```

Rebuild its facts with `node packages/core/scripts/build-terrain-object-catalog.mjs <reference>/public/doodads` (`<reference>` is a clone of [TeamAntioch/sc2-mapping-reference](https://github.com/TeamAntioch/sc2-mapping-reference)). Descriptions are kept.
