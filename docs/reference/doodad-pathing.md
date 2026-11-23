# Pathing under doodads

How a generated map's compile paints no-pathing under doodads, how the author tunes it in the Editor, and how sync brings their tuning back. What was checked, and what wasn't, is at the end.

The code: `packages/core/src/terrain/doodad-pathing.ts` (which doodads, their paint, the author's paint), `packages/core/src/map/compiled-pathing.ts` (the layer the compile writes, and the connection and path-width checks), `packages/core/src/sync/sync-pathing.ts` (sync), and `packages/core/src/catalog/doodad-outlines.ts` (Ground Outlines).

## Why

Units walk through many doodads. A doodad blocks ground units only through the footprint its actor names (`CActorDoodad`'s `Footprint`), and most have none. In a Kept map's ruined temple a marine walked between the `Aiur_Temple_Bigwalls` blocks and through the pillars.

The game's data, read from SC2GameData's `ActorData.xml` and `FootprintData.xml` on 2026-11-11, for the doodads the author listed:

| Doodad (variations) | Footprint | Ground Outline, variation 0 |
| --- | --- | --- |
| `Aiur_Temple_Bigwalls` (14) | none | a solid block 8.3 × 4.4 cells; the others are blocks and curved walls from 2.3 × 2.5 to 9 × 5 |
| `Aiur_Temple_Pillars` (4) | none | a disc about 1.6 across; the others 0.75-1 |
| `Aiur_Temple_Pillars_Broken` (6) | none | 2.4 × 2.1; the others up to 3.1 × 4.6 |
| `TempleColumnSet` (8) | `FootprintDoodad1x1` | a column 0.75 across |
| `Aiur_Stone_Temple_Doodads` (6) | none | 6 × 4.3, 13 cells² solid |
| `Aiur_Temple_Inlay` (5) | none | low raised edges, 0.5 cells² (catalogued as a decal, so not painted) |
| `Aiur_Rock_Cliff` (3) | none | 4.5 × 8, 5 cells² solid |
| `JarbanMinor_Medium_Rock_Group` (8) | none | 3 × 3.4, 6 cells² solid |

`TempleColumnSet` has a footprint, and its column fits inside it, yet the author listed it among the pieces units walked through. Core's default footprint sets only `GroundNoSpawn` and `NoBuild` in a `Place` layer, so whether `FootprintDoodad1x1` blocks units isn't clear from the data. So the compile paints under a solid doodad whether or not it has a footprint. Where the footprint does block, the paint changes nothing.

Not every footprint blocks. `Footprint2x2PlacementOnly` has no `Place` layer, so it only stops building. `ShrubFootprint1x1` places only `NoBuild` and `ShrubVision`. The doodad catalog's `blocksGround` doesn't match the actors' `Footprint` fields one for one either. In 2,588 doodads, 60 are `blocksGround` with no footprint, and 136 have a footprint without it.

## Which doodads are painted

A doodad is painted when:

- it's in a set piece's `anchor` or `props`, one of its `added` doodads, or a doodad Anchor, and
- its catalog role (`doodad-catalog.json`'s description) is `structure`, `prop` or `cliff`.

Clutter, foliage, decals and effects stay walkable, and so do cliff, shore and edge dressing. A doodad's own `pathing` overrides this: `"block"` paints it whatever its ring or role, and `"walk"` never does. `pathing` goes on:

- a set-piece member (`{ "type": …, "pathing": "walk" }`, or a composite member),
- an `added` doodad,
- an entry in a set piece's `edits` (one generated piece), and
- a doodad Anchor.

`JarbanMinor_Medium_Rock_Group` is catalogued as clutter, so a set piece's rock groups aren't painted unless they say `"pathing": "block"`.

A doodad whose origin stands more than 0.75 cells above the ground under it isn't painted either, as its outline (cut 0.25 to 1 above its origin) is then clear of a unit's height: a composite's raised member, an overhead pipe. `pathing: "block"` paints it anyway.

The Ground Outline then says where. A piece with nothing solid at a unit's height, such as creep webbing, an arch's span or a light, paints nothing there.

## Ground Outlines

A Ground Outline is where a model stands solid at a unit's height, seen from above. There's one for each variation, kept in `packages/core/data/doodad-outlines.json`. To record a doodad's (every variation), run this in sc2-adjutant:

```
npm run doodad-outlines -- <doodad id>...
```

`--print` reads and prints without writing, and `--draw` draws each outline in text. A variation the viewer fails to export is tried once more; a failure a second try can't mend (no such variation, no model file, no Host Adapter with `model.export`) isn't. It pulls each variation's `.m3` out of the game through the Host Adapter's `model.export`, as `model-footprints` does, so it takes a few seconds a variation.

How an outline is made:

1. **The solid triangles.** These are the faces each mesh region is drawn with by a batch with an opaque standard material (`m3-mesh.ts`). Glow, blend and terrain-splat layers are left out, and so are hidden regions.
2. **The cuts.** The triangles are cut by level planes 0.25, 0.5, 0.75 and 1 above the model's origin, which is the ground it stands on. Below the first a flat inlay or low rubble stays walkable. Above the last an arch's span or an overhang does.
3. **The fill.** Each cut's segments are drawn on a grid of 0.125 cells and closed by a pixel. Whatever the grid's border can't reach is filled (the inside of a closed wall or pillar), then opened again by a pixel. A wall modelled as one face stays a thin band.
4. **The union.** The cuts are unioned and stored as bits, base64, one line per doodad.

An edge can come out up to one pixel (0.125 cells) wider than the mesh. A variation with nothing cut is `null`.

A doodad the compile would paint but has no outline for is named in one warning. Until it has one, units walk through it. For a game doodad the warning gives the command to record it. A Campaign Mod's doodad or the Blueprint's own can't be recorded yet (the file is core's, and the recorder reads the game's catalog), so for those the warning says to paint the pathing in the Editor and sync. `pathing: "walk"` silences it either way.

The data file says the step and the cuts its outlines were made with. If they aren't the code's, the compile refuses to read the file rather than read its outlines at the wrong scale, and the doodads have to be recorded again.

## The paint

The Editor's pathing layer, `CellAttribute_Pnp`, has 8 sub-cells a cell: 2 across and 4 up, each half a cell wide and a quarter high (`pathingBit` in `write-cell-attribute.ts`). For each painted doodad, every sub-cell near it is sampled at 4 points. Each point is taken back into the model's frame (turned back by the doodad's rotation, counterclockwise from east, then divided by its x and y scale) and looked up in the outline of the doodad's variation. A sub-cell at least half covered (2 of the 4 points) is painted.

Pitch, roll, the z scale and a height offset are ignored. A doodad sunk or tilted a long way may be painted wider or narrower than it stands.

The layer the compile writes is built in this order:

1. the dug pools' paint,
2. the doodads' paint,
3. the Blueprint's `pathingPaint`: each entry's `clear` erased, then each `block` painted.

Like the Editor, the compile writes no file when nothing is painted. A package written without its objects (`generate_terrain`) has no doodads, so it gets the pools' paint and the author's absolute `pathingPaint` only. Beside Kept ground none of this runs. The package's `CellAttribute_Pnp` is the author's there, and `pathingPaint` is warned about and not compiled.

## Pathing Paint: the author's tuning

The author paints or erases with the Editor's pathing brush, saves, and runs sync. Sync keeps the result as `pathingPaint`:

```json
"pathingPaint": [
  { "block": [[20, 100, 1, 1]] },
  { "doodad": "ruin1-temple/added/1", "block": [[3, -0.5, 0.5, 1]], "clear": [[0, 0, 1, 1]] }
]
```

- Each rectangle is `[x, y, width, height]` in cells, on the sub-cell grid: `x` and `width` in halves, `y` and `height` in quarters.
- An entry with `doodad` (a placed doodad's id) holds offsets from the corner of the sub-cell under that doodad's origin. When the doodad moves, so do its strokes. Turning it doesn't turn them.
- An entry without `doodad` stays where it is.
- A placed doodad's id is an Anchor's id, `<set piece>/<type>/<n>` (or `<set piece>/<type>/<ring>/<n>` for a type's later member) for a generated member, or `<set piece>/added/<n>` for an added one, counting from 1.

Which doodad a stroke goes with:

- **An erased sub-cell** goes with the first doodad, by id, whose paint it was. A pool's paint has no doodad.
- **A painted sub-cell** goes with the nearest doodad (set-piece or Anchor) within 2 cells of that doodad's paint, or of its origin when it paints nothing.
- **The rest** stand where they are.

An entry the strokes don't touch stays as it's written, one the author wrote by hand included. An entry they do touch is made again from the layer, and its sub-cells stay with its doodad (or with none). New strokes come after the entries that were there. An entry for a doodad that's no longer placed is kept, warned about and left out of the compile.

### How sync tells the author's strokes apart

Sync reads the layer only when the Editor saved it: when its bytes aren't the ones the compile record has for `file:CellAttribute_Pnp`. A layer the author kept (`--keep`) stays the package's.

Sync tells the strokes from what the compile wrote, using the Blueprint as it was compiled, before sync moves any doodad. The Editor's layer is still painted where the compile put it. The strokes are then laid over what the Blueprint as synced paints, with its doodads where they now stand. So:

- paint left behind by a doodad the author moved in the Editor isn't a stroke, and erasing it changes nothing;
- the next compile paints under the doodad where it now stands;
- a stroke beside a moved doodad goes with it from where it now stands.

Erasing paint under a moved doodad's new spot does count, as the compile paints there now.

Once sync has the strokes, it puts the Editor's layer on the compile record as the compile's own, so the next compile writes over it without stopping. A sync that only moved doodads does this too, with nothing to add to the Blueprint.

A package with no compile record (a copy, a package that isn't the Mission's own) can't say which layer it was painted over. Sync takes the one the Editor's layer is nearest of what the Blueprint could have compiled: with the doodads' paint, without it, or with the absolute `pathingPaint` alone (a package written without objects). A package with no record and no layer gives nothing back.

A package compiled before doodads were painted has only the pools' paint. Sync recognises that layer from the record's fingerprint, takes the author's strokes from it, and puts the doodads' paint under them. If the Blueprint no longer compiles the layer the record has, sync can't tell the strokes apart. That happens when the Blueprint changed since the compile, or when the Editor saves the layer again after a sync that moved doodads and before a compile. Sync says so, and the compile stops on the file for the author to keep or discard. Compiling after each sync, before painting again, avoids it.

### The compile's check

`CellAttribute_Pnp` is a file on the compile record, so a compile stops on an Editor edit that sync hasn't brought back. It lists the file under "Run sync first" when sync would bring it back. A layer the Editor left with nothing painted counts the same as no file.

When the last compile painted nothing, it wrote no file and the record doesn't list one. A layer the author paints in the Editor then is still caught: the compile puts the file on the record as unwritten, and stops on it the same way.

## Connections cut by the paint

After painting, the compile looks at each Connection with a crossing point (`at`). It warns when ground units could cross between the two Zones near that point with the pools' and the author's paint alone, and can't once the doodads' paint is added. A way the author's own `pathingPaint` closes isn't warned about.

The search keeps to 10 cells round the point, on the sub-cell grid, off cliff cells, and a sub-cell clear of anything blocked (about a small unit's radius). A Connection without `at` isn't checked.

## Ways squeezed by the paint

A way that stays open can still be too tight: rubble and a broken arch in a temple's middle leave room for one unit, and heroes bunch up and file through. So the compile also warns when, inside a Zone, doodads squeeze the way between two of its crossings narrower than 3 cells (`PATH_WIDTH`: two heroes abreast, with a margin), where it was at least that wide with the pools' and the author's paint alone.

- A Zone's crossings are its Connections either way round, except `air-only`: the sub-cells within 3 cells of the crossing point, or, without one, along the edge the two Zones share.
- The way keeps to the Zone's own cells and off cliff cells, and is as wide as the circle that fits along it.
- A way that was narrow already, such as a `narrow` Connection or a squeeze in the terrain, isn't the doodads' doing and isn't warned about.
- A crossing the doodads cut outright has the cut warning above instead.

The warning names the pairs of crossings, up to three places where the wide way stops, and the doodads painted there, the one with the most paint there first. Every pair of crossings is checked, not only the way the heroes are meant to go: the check doesn't know the intended route.

These run in the compile, not the layout checker. The layout model is drawn from the Blueprint alone, without the generated ground or the expanded dressing the paint needs.

## Checked, and not checked

Checked (2026-11-11):

- Ground Outlines for the 14 doodads that map's set pieces place, from their real `.m3` files, drawn in text. The `Aiur_Temple_Bigwalls` variations are solid blocks and curved walls at ground height, matching the screenshot's towers. The pillars are discs. `Aiur_City_CreepWebbing` has nothing solid at a unit's height.
- A compile of a copy of that map (outside its Workspace): 1,345 cells painted, the ruin1 temple's walls and pillars among them, drawn cell by cell and compared with the Blueprint's `added` walls. Its one connection warning: ruin4's connection to int45 at (112, 232), cut by `TempleColumnSet`, `Aiur_Stone_Temple_Doodads` and added pieces of `ruin4-temple`. That wasn't looked at in the Editor.
- That compile in the Editor (2026-11-12): the author saw the ruin1 temple's walls and pillars painted, and its middle too cluttered for the heroes' way through. After the path-width check went in, the copy's compile warned of squeezed ways through ruin1 (near (186, 35), (186, 44) and (204, 36)), ruin2 and int34. Whether those places are the one the author saw wasn't confirmed.
- A stroke round trip on that copy: a cell erased under the wall at (201, 42) and one painted at (150, 80). The compile stopped with "Run sync first", naming `file:CellAttribute_Pnp`. Sync kept the erase with `ruin1-temple/added/1`, the wall, and the painted cell where it is. The next compile wrote the edited layer, and a second sync found nothing.
- Unit tests:
  - reading the mesh, cutting and filling, storing outlines,
  - the sub-cells under a turned and scaled outline,
  - the author's paint and its round trip through sync,
  - a compile → Editor stroke → sync → compile cycle on the Ashen Crossing fixture, with the strokes moving with their doodad,
  - a doodad dragged in the Editor, its leftover paint erased and a cell painted beside it, then sync and a compile that doesn't stop,
  - a layer painted where the last compile wrote none,
  - an entry written by hand kept as it is,
  - a terrain-only package, the connection and path-width checks against the author's own paint, and the missing-outline warning for a doodad that isn't the game's.

Not checked:

- **In game:** that units are stopped by the paint, and how close they get to a wall.
- **In the Editor:**
  - that it shows and keeps the compile's paint round doodads,
  - that the rotation sense is right (counterclockwise from east, as Doodad Facings measured; the outlines assume a model's x is east at rotation 0),
  - what the Editor saves when the last paint is erased (no file, or an empty one: both are taken as nothing painted).
- **Footprints:** which footprints block units (`FootprintDoodad1x1`, `FootprintDoodad1x1BlockLOS`). The paint doesn't depend on it.
