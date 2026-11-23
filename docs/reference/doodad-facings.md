# Doodad Facings

Which way a doodad's face points, and where it stands against a wall. The author's measurements in the Editor are kept in [`packages/core/data/doodad-facings.json`](../../packages/core/data/doodad-facings.json) ([ADR-0018](../adr/0018-measured-doodad-facings.md)). Fronts read by eye from the catalog's turntable renders are kept beside them in [`doodad-sheet-readings.json`](../../packages/core/data/doodad-sheet-readings.json) ([ADR-0021](../adr/0021-doodad-fronts-read-from-sheets.md)). The dressing reads both to turn a piece's front to the room, and the measurements to keep a piece clear of a wall's slope. `search_doodads` gives each doodad's facing and where it came from.

## Why it's measured

A doodad has no front in its data. Its model was built facing whichever way its artist chose, and the models disagree. At rotation 0, most wall pieces face south, towards the camera, but some face west and one faces north. So no rule works for them all. A Kept city map's factory interior was dressed on the guess that a model's front points along its rotation, and most of its wall pieces came out a quarter-turn wrong. The same pieces stood 0.6-1.1 cells from their wall zone's edge, so they sat half on the cliff slope and took its height.

On our hand-built Kept maps, the turn varies by model, and even one model's turn varies: `ZergWallDecorTwoHigh` faces at rotation + 270° in 82% of its placements and `DOM_GroundTrims` at + 180° in 58%. Counts like these hint at a front but don't settle it. `doodad-facings.json` records only what the author has checked by eye. A doodad's renders often show its front plainly, though, so a front read from them comes second ([Sheet readings](#sheet-readings)). A doodad in neither file is unknown, and nothing guesses for it.

## The format

```json
{
  "about": "…",
  "placements": {
    "wall-foot": { "standOff": 2.6, "about": "…" },
    "wall-face": { "standOff": 1.9, "height": 2.2, "about": "…" },
    "wall-top": { "about": "…" },
    "free": { "about": "…" }
  },
  "doodads": {
    "CompoundSewers_Tank": { "front": 180, "placement": "wall-foot", "measured": "author, 2026-11-09, facing strip" }
  }
}
```

- **`front`** is the direction the doodad's face points into the room when it stands at rotation 0. It's in degrees counterclockwise from east, the Editor's rotation convention, so 270 is south. A doodad at rotation *r* faces *r* + `front`, and to face direction *f* it stands at rotation *f* − `front`.
- **`placement`** is where it belongs:
  - `wall-foot`: on the floor at the wall's foot.
  - `wall-face`: hung on the wall's face.
  - `wall-top`: on top of the wall.
  - `free`: anywhere on the floor.
- **`standOff`** is the distance in cells from the wall zone's polygon edge to the doodad's origin, measured out into the room. A negative stand-off is on the wall. **`height`** is the height above the ground under the doodad, as the Editor's HeightOffset gives it. A doodad gives its own `standOff` or `height` only where it differs from its placement's.
- **`runsAlong`** marks a piece whose length runs along the wall, across its front, such as a pipe run, a glass wall or a rail.
- **`note`** says anything else the author saw. **`measured`** says who measured it, when and how.

One row per doodad, sorted by id. `formatDoodadFacings` writes that layout, and a test holds the file to it.

## What's measured

The author's facing strip of 2026-11-09 holds 53 doodads, all from that factory interior's dressing. The author placed one of each at rotation 0 at the foot of a straight wall facing south, adjusted each until it looked right, and confirmed them all.

- **Front 270°** (south at rotation 0): 49 of them, the signs, consoles, monitors, pipes, crates, lockers, lights and wall panels. `PipesLong`, `DOM_LabGlassWalls` and `Tarsonis_Guardrail` run along the wall at that rotation.
- **Front 180°:** `ElectricConduitPathMedium`, `CompoundSewers_Tank` and `JarbanMinor_Tank`.
- **Front 90°:** `DOM_LabWallScreens`. Its origin sits well forward of its back, so it stands at 5.1 cells, about 2.5 further out than the other floor pieces.
- **Floor pieces at the wall's foot** look right with their centre about 2.6 cells out from the wall zone's polygon edge. That clears the cliff slope, about 1.6 cells from the first higher cliff sample. It's the gap that works for these models; deeper models need more.
- **Hung on the face:** `SpacePlatformSign`, `UmojanLabMonitorWall`, `UmojanLabAlarms`, `Korhal_CorporateSignage`, `SpaceCamera` and `CastanarLightboard` hang about 1.9 cells out at a HeightOffset of 2.0-2.4 (recorded as 2.2). `BraxisAlphaMonitorBig` hangs at about 3.7. Its stand-off wasn't recorded, so it takes the hung pieces' 1.9.
- **On the wall top:** `Korhal_WallCap` and `HybridWallPillar2High`. How far in from the edge wasn't recorded, so the dressing can't place them against a wall yet.

Each was measured on one variation. A doodad whose variations are different models could face differently in each. Measure again if one looks wrong.

A Campaign Mod doodad that replaces a game doodad's model keeps the game doodad's facing, which may no longer fit the new model. Measure the mod's model on the strip.

## How the dressing uses it

These apply to a set piece's members ([DRESSING.md](../../packages/plugin-style-antioch/knowledge/DRESSING.md)):

- **`yaw`** is the direction the member's front faces, in degrees counterclockwise from east. A measured doodad, or one with a sure sheet reading, stands at rotation `yaw` − `front`. A Doodad Composite turns by its `front`. If the recipe gives no `front`, the compile uses the front its members agree on, each member's yaw plus its own front (measured or read), all within 30° of their mean. The Style Pack's `console-bank` comes out at about 225° this way. A doodad or composite with no front takes `yaw` as its rotation, and the compile warns about it.
- **`against: "wall"`** backs every copy onto a wall within the set piece's radius, front to the room. The walls are the edges of the Zones higher than the set piece's floor Zone, where the ground just inside the edge is higher than the set piece's level and the ground three cells out is on it. Each copy picks a point on such an edge from its own seed and stands at its stand-off along the edge's normal:
  - A `wall-foot` piece stands on the floor.
  - A `wall-face` piece hangs over the slope at its height above the ground there, with "ignore placement" set.
  - A `wall-top` piece needs a measured stand-off. Without one it isn't placed, and the compile says so.
  - An unmeasured doodad stands as a floor piece at 2.6 cells. It's turned by its sure sheet reading's front, if it has one. Otherwise it's turned as if its front were its rotation, and the compile warns. If its sheet suggests it hangs on the face or sits on the top, the compile says so: the suggestion doesn't move it.

  A composite stands far enough out that each of its measured pieces clears the wall by its own stand-off, and each unmeasured piece by 2.6. Its wall-top pieces don't count. A member can't take both `yaw` and `against`.

Every piece turned by a sheet reading is named in one warning per compile, with a count. Pieces the author has since removed, turned or swapped by hand in the Editor don't count: "5 pieces turned by fronts read from catalog sheets, not measured: SpaceGunRack ×2, XelNagaWall ×3 …". If one faces wrong, measure it on the strip, and the measurement takes over.

Doodad anchors and a set piece's `added` doodads keep the rotation they're given. Turn them with the table: rotation = facing − `front`.

## Measuring more: the facing strip

```sh
npm run facing-strip -- missions/<id>/output/facing-strip <doodad> <doodad> … [--tileset <id>] [--spacing <cells>] [--dependency <dep>]…
```

This writes a strip Blueprint into the folder and compiles its Map Package there. Put it under a Mission's git-ignored `output/`. The strip is a level-1 floor with rows of walls two levels up, each wall's south edge straight, and up to 30 doodads to a row, 8 cells apart. Each doodad stands at rotation 0 and scale 1, 2.6 cells south of its wall's edge, over a point named for it. The tileset defaults to `KorhalCityEx2`. The compile adds any campaign dependency the game's doodads need. For a Campaign Mod's doodads, give the mod with `--dependency`, written as a Mission's Blueprint names it.

Open it in the Editor and set each doodad as it should stand:

- Turn it until its front faces south, into the room.
- Move it out or in until it stands right against the wall, or onto the wall's top.
- Raise it to hang it on the face.
- Move a piece that belongs out on the floor more than 6 cells from the wall.
- Delete one that doesn't go against a wall at all.

Save, then read the strip back:

```sh
npm run facing-strip -- --read missions/<id>/output/facing-strip [--write] [--by <who>]
```

For each doodad, the read-back takes its Editor Id, or else the nearest doodad of its type within half the spacing of its point. It reports:

- **front**: 270 less the saved rotation, to the degree.
- **placement**:
  - `wall-top` if it stands beyond the wall's edge.
  - `wall-face` if it's raised more than half a cell above the ground under it, with that height.
  - `free` if it's more than 6 cells out.
  - `wall-foot` otherwise.
- **stand-off** and **height**, recorded only where they differ from the placement's by more than 0.3.

A deleted doodad is listed and stays unmeasured. `--write` merges the readings into core's `doodad-facings.json`, each one replacing its doodad's old entry, marked measured by `--by` (default `author`) today. Then commit the file.

## Sheet readings

Each catalog doodad's variation 0 is rendered from four sides (`npm run thumbnails`): a turntable of four pictures, a0 to a3, pitched down 35°. Picture *n* looks at the model from 315° − 90*n* counterclockwise from east: a0 from the south-east, a1 the south-west, a2 the north-west and a3 the north-east. That was calibrated on 2026-11-11 against the measured doodads. Every one with a visible front that the author measured south shows it in a0 and a1, `DOM_LabWallScreens`' north shows in a2 and a3, and `ElectricConduitPathMedium`'s west in a1 and a2. So a front pointing south shows in a0 and a1, west in a1 and a2, north in a2 and a3, and east in a3 and a0. A front pointing straight at one camera, a diagonal, shows face-on in that one picture.

`doodad-sheet-readings.json` keeps one reading per doodad:

```json
"SpaceGunRack": {"faces": [3, 0], "sure": true, "placement": "wall-foot", "note": "open gun rack east side, solid back", "read": "agent, 2026-11-11, catalog sheet"}
```

- **`faces`** gives the pictures that show its front: two side by side, or one. It's empty when the model has no front, such as a crate, a pipe run or a tank that looks the same from two sides.
- **`sure`** means the front is plain and the pictures agree. For an empty `faces`, it means the doodad really has no front. `search_doodads` gives a sheet facing's `sure`, and `diagonal` for a single-picture front.
- **`placement`** and **`standOff`** are suggestions. `standOff` is given for a deep floor piece: its depth behind its origin, from its model's bounds, plus 0.5. It's only given when that's more than 0.3 beyond the wall-foot default. That rule fits `DOM_LabWallScreens`' measured 5.1 and every floor piece that looked right at the default, except `SpaceArmoredDoorDiagonal` (0.8 too far out). A model whose bounds are a cube gets none, since a cube is its culling box, not its shape.

Only a sure reading with two pictures turns a piece. A single-picture front is a diagonal, which the four pictures can't place exactly: the author's `BraxisAlphaMonitorBig` model reads as 225° from its sheet but was measured at 270°. Such a front, or a doubtful one, is a suggestion, and the doodad belongs on the strip. A doodad the author has measured is never read.

The first pass, on 2026-11-11, read the 1,412 rendered props, structures and clutter that weren't measured. It left out rocks, plants, effects, decals, cliffs and doodads sharing another's picture. 384 have a front, and 185 of those are sure two-picture fronts.

### Reading more: the sheets

```sh
npm run sheet-readings -- --batches <folder> [--renders <folder>] [--per <n>]
```

This writes montages of the doodads still worth reading (rendered, unmeasured, unread) into `<folder>/batches`, six to an image. Each row is one doodad with a0 to a3 left to right, and `batches.txt` names each image's doodads in row order. `<folder>/calibration` gets the measured doodads laid out the same way, with `answers.md` saying which pictures each one's front shows in. The renders are core's `data/thumbnails/doodads` unless `--renders` says otherwise; a worktree has none of its own, so point it at the main checkout's. Put the folder somewhere that lasts, not a session scratchpad.

Brief each reader (an agent, a range of montages each) to:

1. Look at the calibration first.
2. Look at every montage in its range itself, one at a time, never judging from names.
3. Write one JSON line per doodad, in order:

```json
{"id": "DOM_LabConsoles", "faces": [0, 1], "sure": true, "placement": "wall-foot", "note": "lit screens"}
{"id": "HavenDoodadsCrates", "faces": [], "sure": true, "note": "symmetric crate"}
```

The front is the side meant to be looked at: a screen, a sign or logo face, a control panel, an opening, a grille, a statue's or creature's face, a vehicle's nose. Readers should use `faces: []` for anything that looks the same from two or more sides, or that the pictures don't settle, and `sure: false` for anything they're unsure of, including a model too small, cut off or broken to judge. The placement words are the ones above: `wall-foot` for a floor piece that belongs backed against a wall, `wall-face` for a hung sign, screen, light or camera with no base, `wall-top` for a cap, `free` for a front that stands out on open floor (vehicles, statues, buildings, wall sections that are the wall themselves).

```sh
npm run sheet-readings -- --merge <file.jsonl>... [--by <who>] [--bounds <file.json>]
```

This checks every line and merges the lines into core's `doodad-sheet-readings.json`, each replacing its doodad's old reading, marked read by `--by` (default `agent`) today. It skips any doodad the author has measured. Each wall-foot reading's stand-off suggestion comes from its model's bounds, read through this machine's Host Adapter (a few hundred models take several minutes) or from `--bounds`. Then commit the file.

If the macOS Host Adapter's turntable recipe changes its angles or where they start, redo the calibration before reading more, and read again what was read under the old one.
