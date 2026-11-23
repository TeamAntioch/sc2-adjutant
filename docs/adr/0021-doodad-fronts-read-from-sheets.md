# Doodad Fronts Read From the Catalog Sheets

ADR-0018 let only the author's measurements turn a doodad, so every doodad not on the facing strip stayed turned as if its front were its rotation. That guess was wrong for all 53 doodads the author measured. Measuring the rest on the strip, a few dozen a session, would take a long time. But the Asset Catalog already has four turntable renders of each doodad's variation 0, and a doodad's front can usually be seen in them. So core now also keeps **fronts read by eye from those renders**, in `packages/core/data/doodad-sheet-readings.json` ([doodad-facings.md](../reference/doodad-facings.md)). This changes ADR-0018's "only what the author has checked by eye goes in" for the front alone (#594, decided by the author on 2026-11-11):

- **Calibrated against the measurements.** Picture *n* looks at the model from 315° − 90*n*, down at 35°. A front the author measured south shows in pictures 0 and 1 for every measured doodad that has a visible front, and `DOM_LabWallScreens`' north shows in 2 and 3. A front pointing between two cameras shows in both, so a reading names the two pictures, or one for a diagonal front, or none.
- **A sure front turns pieces, and the compile warns.** A reading the reader was sure of, with two pictures that agree, turns a set piece member's `yaw`, a composite's front and an `against: "wall"` piece, as a measurement does. Each compile then gives one warning naming every doodad it turned this way, with a count, leaving out pieces the author has since removed, turned or swapped by hand. That list is what to put on the next facing strip. A doubtful reading, or a single-picture (diagonal) one, turns nothing.
- **Placement and stand-off are suggestions only.** `search_doodads` shows them, and a warning says when a sheet suggests a wall piece hangs or sits on top. But an `against: "wall"` piece with no measurement still stands as a floor piece at the wall-foot default.
- **A measurement always wins.** The merge never writes a reading for a measured doodad, and the dressing reads measurements first.

The first pass, on 2026-11-11, read 1,412 doodads (props, structures and clutter with renders, leaving out rocks, plants, effects, decals and cliffs). It found 384 with a front, and 185 of those are sure two-picture fronts. Eight agents did the reading, each briefed with the calibration montages.

## Considered Options

- **Use readings like measurements** (the author's option (a)). Rejected. A wrong reading would fail silently. Nothing in the compile would say which pieces to doubt, and the line ADR-0018 draws between checked and unchecked facings would go.
- **Only suggest a front until the strip confirms it** (option (c)). Rejected for the front. The front is what the sheet shows best, and a wrong turn is plain to see and cheap to fix. Holding back a likely-right reading in favour of a guess that's usually wrong buys nothing. Kept for placement and stand-off.
- **One warning per sheet-turned piece.** Rejected. A densely dressed Mission would list dozens on every compile, and warnings people always see get ignored. One line with counts names the same doodads.
- **Store the readings as entries in `doodad-facings.json` with a source field.** Rejected. A reading records which pictures showed the front, which a measurement has no words for. The readings are also re-made by a different process. A separate file keeps the author's file to the author's measurements, and the trust level is which file an entry is in.
- **Work out stand-off from the model's bounds.** Tested, not adopted. The bounds' depth behind the origin, plus a fixed gap, can't be right on its own: `SignsWarning` (0.08 deep) and `DOM_LabGlassWalls` (1.83 deep) both looked right at the 2.6 default. max(default, depth + 0.5) fits `DOM_LabWallScreens`' 5.1 and every floor piece that looked right at the default. It misses `SpaceArmoredDoorDiagonal` by 0.8, and bounds that are a cube are a culling box, not a shape. So a deep piece's reading carries the result as a suggested `standOff`, and nothing places by it.

## Consequences

- `getDoodadFront`, `rotationToFace` (now with a `source`), `compositeFrontFrom`, `frontFromPictures` and `sheetPictureAzimuth` (`packages/core/src/catalog/doodad-facings.ts`) read both files. `getDoodadFacing` still reads measurements alone. `sheet-readings.ts` picks candidates, merges readers' lines and suggests stand-offs.
- `npm run sheet-readings -- --batches <folder>` makes the montages for doodads still unread, with the calibration. `--merge` records a reader's JSON lines.
- Each reading is of variation 0. A doodad whose variations are different models may face differently in each, as with measurements.
- If the turntable recipe in the macOS Host Adapter changes (its `Angles` or start), the calibration has to be redone, and readings made under the old one re-read.
