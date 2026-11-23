# Terrain File Formats

What the game does with the terrain files in an unpacked `.SC2Map`, how our writers line up with the reverse-engineered specs, and enough detail on the files we don't write yet to implement them.

Sources:

- `sc2-ida-mcp-setup` (read-only clone of `github.com/sc2-arcade-watcher/sc2-ida-mcp-setup`), notes on the Windows client and Editor, build 96921 (5.0.15). We target 5.0.17. Formats carry over; addresses don't, so none are given here. Paths below are relative to its `docs/`.
  - `terrain-loading-pipeline.md`
  - `file-format/t3heightmap.md`, `t3syncheightmap.md`, `t3synccliff.md`, `t3synctextureinfo.md`, `t3cellflags.md`, `t3texturemasks.md`, `t3terrain-xml.md`, `t3water.md`, `t3vertcol.md`, `t3hardtile.md`, `t3fluffdoodad.md`, `painted-pathing-layer.md`, `painted-creep-layer.md`, `component-list.md`
- Our findings in [map-package-findings.md](./map-package-findings.md#terrain) and the writers in `packages/core/src/terrain/`.
- Editor-saved bytes: `packages/core/tests/fixtures/editor-terrain/` (5.0.17, golden tests) and the git-ignored `missions/test-map/output/cliffs-and-doodads.SC2Map` (Editor-saved, 128×128), which has every t3 file including the ones we don't write.

Our Editor-golden findings take precedence. Where the docs disagree, they're given as background.

Units used below: a 128×128 map has 128×128 **cells** and 129×129 **vertices**. `t3Terrain.xml` `dim` and the `t3HeightMap` header hold vertex counts.

## Part 1: Load pipeline

### Files, readers and order

`t3Terrain.xml` is parsed first. It supplies the grid size, quantize parameters, texture and cliff-set names, ramps and cliff cells (`file-format/t3terrain-xml.md`). The binaries are then read by three separate loaders.

**Render terrain** (`terrain-loading-pipeline.md`, "Load Order"). One orchestrator reads seven files in a fixed order:

| Step | File | Magic (bytes on disk) | Accepted versions | Editor writes |
|---|---|---|---|---|
| 1 | `t3HeightMap` | `HMAP` | 101 only | 101 |
| 2 | `t3VertCol` | `VTCL` | 103–104 | 104 |
| 3 | `t3CellFlags` | `LFCT` | ≤ 102 (≤ 100 sparse list, 101–102 byte grid) | 102 |
| 4 | `t3HardTile` | `HRDT` | 102 only | 102 |
| 5 | `t3FluffDoodad` | `DLFT` | 101, 102, 103 | 103 |
| 6 | `t3TextureMasks` | `MASK` | ≤ 102 (< 102 raw pixels, 102 tiled nibbles) | 102 |
| 7 | `t3Water` | `WATR` | 104–110 | 110 |

The "Editor writes" column comes from the bytes in `cliffs-and-doodads.SC2Map`. After the reads, the height grid is dequantized into a vertex grid and the geometry patches are welded.

**Simulation terrain** (`t3syncheightmap.md`, `t3synccliff.md`, `t3synctextureinfo.md`). The sync files are read by the game-state loader, not the render orchestrator. They give the bit-identical data the deterministic simulation uses:

| File | Magic | Versions | Notes |
|---|---|---|---|
| `t3SyncHeightMap` | `SMAP` (not named in the doc) | ≤ 101 dequantized, ≥ 102 raw | Grid capped at 257 vertices; larger maps are centred |
| `t3SyncCliffLevel` | `CLIF` (header ignored by the reader) | not checked | Grid capped at 256 cells; falls back to the sync height map |
| `t3SyncTextureInfo` | `RTXT` | < 101 one set, ≥ 101 `set_count` | Grid capped at 256 cells; no fallback |

**Terrain layers** (`painted-pathing-layer.md`). A third reader loads 16 bitfield layers plus two painted layers, `PaintedPathingLayer` and `PaintedCreepLayer`. The docs don't place it relative to the other two loaders.

### Missing or bad files

What the docs say:

- If any render reader returns failure, the whole render-terrain load fails. No partial loads (`terrain-loading-pipeline.md`, "Error Handling").
- But most readers always return success. `t3HeightMap` leaves default cells on a bad header (height 0, third field 1). `t3VertCol`, `t3CellFlags`, `t3FluffDoodad` and `t3HardTile` always return 1. `t3HardTile` clears itself if any tile fails validation.
- Only `t3TextureMasks` has its failure checked inline. `t3Water` returns 0 if a body has more than 1,000 wave records or a read fails.
- `t3SyncTextureInfo`: a missing file or bad magic leaves the grid zeroed, so every cell reads as texture 0 of set 0.
- `t3SyncCliffLevel`: a missing file is rebuilt from the sync height map (below).

What we know from our own maps: we write no `t3VertCol`, `t3HardTile` or `t3FluffDoodad`. Our maps still open in the Editor and run under Test Document ([map-package-findings.md](./map-package-findings.md#caveats)). So a missing optional render file is treated as empty, at least for those three. The docs don't say this outright. `terrain-loading-pipeline.md` only notes that the earlier steps "presumably assert internally".

Our earlier notes said "if one of the seven terrain files fails to load, the whole terrain load fails". That holds for the render orchestrator's return value. In practice, by the docs, only a bad `t3TextureMasks` or `t3Water` can trigger it, and the seven are the render files, not the seven we write.

### Sync-cliff fallback

`t3synccliff.md`, "Fallback". When `t3SyncCliffLevel` is absent, the reader builds each cell from the sync height map's second grid (one byte per vertex, stride 257). It takes the cell's four corner vertices, raises each to the map's base cliff level, and stores their **sum**.

With the file present, each raw uint16 is raised to `base_cliff << 6` and stored as `(raw + 8) >> 4`. Both paths give 4 units per cliff level: raw 64 becomes 4, and four corners at level 1 sum to 4. A later pass computes `(c + 1) >> 2` (clamped to 16) for a per-level bitmask, which brings it back to whole levels.

This lines up with our findings: the sync height map's second channel is the vertex cliff level, and the sync cliff file is 64 per level. What the fallback loses is ramps. Our ramp cells carry in-between values (+8/+24/+40), which a corner sum can't produce. Keep writing the file.

### Size limits implied by the formats

- `t3TextureMasks`: width and height (in mask texels, 8 per cell) must be multiples of 64 and ≤ 2048. So maps must be a multiple of 8 cells and at most 256 cells per side.
- Sync grids: 256 cells / 257 vertices per side. Larger maps are centred in a 256 window.
- `t3HeightMap` sizes must match `t3Terrain.xml` `dim`.

Only 128×128 is verified for us ([map-package-findings.md](./map-package-findings.md#caveats)).

## Part 2: Formats we already write

All integers are little-endian. Each table compares the doc, our writer and what the Editor writes.

### t3HeightMap (`packages/core/src/terrain/write-t3-height-map.ts`; `file-format/t3heightmap.md`)

| | Doc | Ours | Agree? |
|---|---|---|---|
| Magic, version | `HMAP`, exactly 101 | `HMAP`, 101 | Yes |
| Header | 32 B: magic, version, sizeX, sizeY, 16 zero | Same | Yes |
| sizeX/sizeY | "grid width (cells)", must match the XML dims | Vertex count (129 for a 128 map), as the Editor writes | Bytes agree. The doc's "cells" means vertices: `t3CellFlags` is read at `sizeX - 1` |
| Cell | 6 B: `heightBase`, `heightAdjustments`, `mask` | `r0` base layer, `r1` cliff-height layer, `r2` vertex cliff level | Layout agrees, meanings don't |
| Order | Row-major, Y outer | Same | Yes |

Disagreements and background:

- **Third uint16.** The doc calls it a "terrain layer mask" with default 1, and says the in-memory copy uses bit `0x9000` as a cliff flag. We found, golden-tested, that it's the vertex cliff level (1 for ordinary ground, 0 for a pit, up to 15). The doc's default of 1 is ordinary ground, which fits our reading. The `0x9000` bits are runtime state; the Editor never writes them in our fixtures.
- **Second uint16.** The doc calls it "fine height offset (dents/jitters)". We found it's the cliff layer: the height contributed by the vertex's cliff level (`CLIFF_HEIGHTS` in `packages/core/src/terrain/cliffs.ts`, 0 for level 1). Height-brush work goes in the first channel.
- **Height formula.** The doc dequantizes each field separately as `v·quantizeScale − quantizeBias` and sums them: `world_z = base·cellHeightScale + originZ + adj`. With scale 1 and origin 0 this is exactly our `(r0·scale − bias) + (r1·scale − bias)`. The doc also rejects the community formula (`(r0 + r1)·scale − bias − standardHeight − 1`). It says `standardHeight` isn't used per cell, which matches ours.
- **Quantize values.** The doc gives reader fallbacks (scale ≈ 0.1, standardHeight 8.0). The Editor picks bias and scale per map: 9.0 / 4.478322e-4 in `cliffs-and-ramps`, 9.000133 / 2.792436e-4 in `ramps`. We write 9.0 / 2.746134e-4, a range of ±9 per channel, whenever the map's heights fit it, which they do up to level 5. A map that goes higher (or lower) gets a wider one, as the Editor saves it: `heightQuantization` keeps a bias of 9 (more if a value is below −8) and picks the scale whose top is the highest value plus 1, rounded up to the 7 digits `<vertData>` holds. An Editor-saved test map with levels up to 15 has 9 / 5.798428e-4, a top of 29 for level 15's 28; ours for the same top is 5.798429e-4. A height outside the quantization it's written with is refused, not clamped.

### t3Terrain.xml (`packages/core/src/terrain/write-t3-terrain-xml.ts`; `file-format/t3terrain-xml.md`)

| Item | Doc | Ours | Agree? |
|---|---|---|---|
| `<terrain version>` | Reader default 115. Gates at < 114 (legacy `<texture>` path) and ≤ 112 (clears `cc f` bit 2) | 115 | Yes; neither gate applies |
| `<heightMap>` attrs | `tileSet`, `uvtiling` (4 floats), `dim` (2 ints), `offset` (3 `%f`), `scale` (3 `%e`) | Same, Editor spacing and trailing spaces | Yes |
| Element order (Editor writer) | cliffSetList, rampList, cliffDoodadList, vertData, masks, textureSetList, textureList, blockTextureSetList, cliffCellList | Same | Yes |
| `cliffSetList` | Written only when non-empty | Only when there are cliff cells | Yes |
| `textureSetList` / `textureList` | Writer hardcodes `num=8` / `num=64` | Same | Yes |
| `blockTextureSetList` | `num = ((dim−1)>>3)²`; no attrs read, size comes from `dim` | `(width/8)²`, all `tileSet="0"` | Yes |
| `cliffCellList` | Grid `((dim−1)>>1)²`; `numOccupied` counts cells unless `f==0 && cid==0`; such cells aren't written | `(width/2)²`; `numOccupied` = cells written | Yes |
| `<cc>` | `i`, `f` (default 1), `cid`, `cvar`; `i ≥ w·h` skipped | `f=1` cliff, `f=2` ramp, `f=12` under a terrain object, `cid=0`, `cvar` 0–3 | Yes |
| `cliffDoodadList` | Exists; see Part 3 | Written for blueprint `terrainObjects`, matching the Editor's (`packages/core/tests/fixtures/editor-terrain/terrain-objects`) | Yes |

Notes:

- **`cc f` bits 2 and 3** (values 4 and 8). The doc says bit 2 is cleared for terrain version ≤ 112 and guesses "hard cliff". The Editor sets both around terrain objects (2026-10-28 saves): cliff cells wholly inside an object's stamp get `f=12` and no cliff mesh bit, since the object's model is the wall, and a square ring of cells around the object gets bit 2 alone (`f=4`, or `f=5` on a cliff mesh). The ring is 8 cells across for a 5×5 Korhal Hole and 18 for the Castanar bridges and the 9×5 Space Platform cliff, at any rotation, so it probably follows the model's radius. We write the `f=12` cells but not the ring; nothing so far shows the ring matters.
- **Ramp validity.** The doc says the reader keeps a `<ramp>` only if `dir != 0 && hi < 8 && lo < 16`, and thinks the second `< 16` was meant for `hi`. The `hi < 8` part is wrong for 5.0.17 too: the Editor writes ramps up to `hi="15"`, and they work. **The `dir != 0` part is wrong for 5.0.17.** In an Editor test, the Editor wrote `dir="0"` for a straight ramp it placed climbing south, and `dir="2"` for one climbing west, which matches `packages/core/src/terrain/ramps.ts` (0 south, 1 north, 2 west, 3 east). All four of our generated ramps, including `dir` 0 and 2, survived an Editor save. The Editor writes some zero components as `-0.000000e+00` where we write `0.000000e+00`; it accepts both.
- **Ramp attrs.** The `TileSet` string format `u(%e, %e) r(%e, %e) c=(%e, %e) w=%e h=%e` matches ours. The doc also lists `rampHardTileHandles`, which neither we nor the fixtures write.
- **Diagonal ramp widths.** The Editor's diagonal ramps (`dir` 4-7) come in several widths, given by the `base` piece's `w`: √2 (1.414214), 2√2 and 3√2 are all on Ephemeron LE. Every ladder main ramp is the narrowest, √2: 15 cells of slope in a 5×5 box, its `base` centred on an odd vertex (all 54 such ramps on the 21 ladder maps), `mid` √2 by 2√2, `leftLo` and `rightLo` 2 by 2. Our wide template (2√2) is 27 cells in a 7×7 box. `packages/core/src/terrain/ramps.ts` stamps both; the narrow one was decoded from Ephemeron LE as the Editor saved it.
- The doc's own tables disagree on where `dir` sits in memory (byte at +8 vs +0x0C). That has no effect on the XML.

### t3CellFlags (`packages/core/src/terrain/write-t3-cell-flags.ts`; `file-format/t3cellflags.md`)

| | Doc | Ours | Agree? |
|---|---|---|---|
| Magic, version | `LFCT`, ≤ 102 | `LFCT`, 102 | Yes |
| Header | 24 B: magic, version, 16 zero | 32-B buffer: same 24 B, then width and height at 24/28 | Same bytes. Our code comment calls all 32 bytes "header" |
| Body (v101–102) | u32 width, u32 height, `width·height` bytes | Width/height in cells, one byte per cell | Yes; 16,416 B at 128×128, same as the Editor |
| Bits | Legacy path only sets `0x02` ("marks the cell") | `0x02` ground, `0x01` under a cliff mesh, `0x03` both | No conflict; the doc names no other bits |

**Bit `0x04` is hidden terrain** (the Editor's Hide Terrain brush): the ground doesn't draw there. On a Kept city map on 2026-11-10, the author hid 8 cells under a chute hatch. Those bytes went 3→7 and 2→6, and nothing else in the terrain changed. Hiding doesn't make a cell unpathable: `CellAttribute_Pnp` and `t3HardTile` were byte-identical before and after. The 16,827 cells of that map's Kept ground with `0x04` are the original map's own hidden ground. No other bit has been seen.

Which bits the compile owns (#595):
- `0x01` (cliff) and `0x02` (ground) are worked out from the terrain, on the cells it writes.
- `0x04` comes from the Zones' `hiddenCells`: on every cell of a generated map, and on a generating Zone's own cells beside Kept ground. Those are its whole 2×2 cliff cells; a listed cell at the Zone's edge that isn't one stays as the package has it, with a warning.
- Every other bit stays as the package has it. Kept ground keeps all its bits.

**Editor hides as changes.** The compile record's `hidden-cells` entry lists the cells the compile writes the bit on, and which of them it hid. A cell where the package's bit isn't what was written is an Editor change, named `hidden-cells`, and so is a cell newly the compile's that the package hides but the Blueprint doesn't. Either one stops the compile.
- sync brings it into `hiddenCells`;
- `--keep` leaves the bit as the package has it (a kept `hidden-cells:x,y` entry), while the Zone still writes the cell's ground;
- `--discard` writes the Blueprint's.

The cliff and ground bits are worked out from the terrain, so the Editor rewriting them isn't a change.

A hidden cell shows the sky unless something stands under it: for the chute, a `DOM_Walls_Interior` doodad below the ground.

`check` warns about each group of hidden cells in a Zone that the compile writes the bit on (`packages/core/src/map/hidden-cell-checks.ts`):
- one with no doodad within a cell of it, so the sky may show;
- one with cells that are neither painted unpathable nor cliff, so units may stand over the hole. A doodad's footprint isn't counted. On a generated map the compile writes the painted pathing, so a blocker or footprint is the way to block a hole there.

Still to check in game: whether a hidden cell blocks sight, and whether units walk over it.

### t3SyncHeightMap (`packages/core/src/terrain/write-t3-sync-height-map.ts`; `file-format/t3syncheightmap.md`)

| | Doc | Ours / Editor | Agree? |
|---|---|---|---|
| Header | 4 u32 (`field_00`, version, `field_08`, `field_0C`), then 3+3+1+1 int32, then 4 more int32: 64 B | `SMAP`, 102, vertex width, vertex height, 0,0,0, 4096×3, zeros: 64 B | Size agrees; the doc leaves most fields "unknown" |
| v ≤ 101 | uint16 per vertex, `(scale·v − offset) >> 4` | n/a | n/a |
| v ≥ 102 | One `w·h` uint16 grid, **then** a second `w·h` int16 grid | **Interleaved** per vertex: int16 height (8.8 fixed point), uint16 cliff level | **No** |
| Second grid | Kept as uint8 in memory; feeds the sync-cliff fallback | Vertex cliff level | Meaning agrees |

The Editor-saved `cliffs-and-doodads.SC2Map/t3SyncHeightMap` is 66,628 B (64 + 129·129·4). Its records are interleaved: the first is `eb07 0100`, height 2027 (≈ 7.92 × 256) then level 1. Our writer matches the Editor. Treat the doc's planar layout as wrong. This file isn't golden-tested yet.

**Walking heights at cliff vertices.** On an Editor-saved map the sync height isn't always the render height × 256. Of a Kept city map's 66,049 vertices (256×256, saved 2026-10-24), 47,941 are exactly `round(render × 256)`. Another 16,079 are within 2/256 of it, 9,847 of those truncated rather than rounded. The remaining 2,029 differ by more, and 1,016 differ by over 0.02 units (up to 5). Every one of those 1,016 is a corner of a cell under a cliff mesh (`t3CellFlags & 0x01`): there the sync map holds the height a unit walks at, not the cliff mesh's height. Our generator writes `round(render × 256)` everywhere. An edit to Kept ground must keep the gap at each vertex (see "Editing heights on Kept ground" below).

### t3SyncCliffLevel (`packages/core/src/terrain/write-t3-sync-cliff-level.ts`; `file-format/t3synccliff.md`)

| | Doc | Ours | Agree? |
|---|---|---|---|
| Header | 32 B, skipped by the reader | `CLIF`, 100, width, height, zeros, as the Editor writes | Yes |
| Body | uint16 per cell, row-major; size taken from the terrain grid, not the file | Same, 64 per level, ramp values in between | Yes (golden-tested) |
| Dequant | `max(raw, base << 6)`, then `(raw + 8) >> 4` | 64 per level | Yes, see Part 1 |

### t3SyncTextureInfo (`packages/core/src/terrain/write-t3-sync-texture-info.ts`; `file-format/t3synctextureinfo.md`)

| | Doc | Ours | Agree? |
|---|---|---|---|
| Header | `RTXT`, version, width, height, `set_count` (v ≥ 101): 20 B | `RTXT`, 101, cells, cells, set count | Yes |
| Names | `set_count × 8` strings, via a generic string reader | Null-terminated ASCII | Yes; the Editor file is null-terminated too |
| Cells | v ≥ 101: u32 texture index (0–7, low byte kept), u32 set index | Dominant texture, set index | Yes |
| Use | Sim-side lookup from position to physics material (footstep sounds and the like) | n/a | n/a |

### t3TextureMasks (`packages/core/src/terrain/write-t3-texture-masks.ts`; `file-format/t3texturemasks.md`)

| | Doc | Ours | Agree? |
|---|---|---|---|
| Header | 64 B: `MASK`, ≤ 102, reserved 0, width, height, 44 zero | `MASK`, 102, 0, 1024, 1024 | Yes |
| Width/height | "cells", ≤ 2048, multiple of 64 | Mask texels: 8 per terrain cell | Yes. The doc's "cells" are texels; its CPU path uses `8·dim − 8` |
| Body (v102) | 8 planar layers; each split into 64×64 tiles, row-major; each tile 64 rows × 32 B; high nibble = even column | Same; each 64×64-texel tile covers 8×8 cells | Yes. 4,194,368 B, same size as the Editor file |
| Weights | 4 bits per layer; layers 0–3 → GPU texture 0, 4–7 → texture 1 | 0–15 per layer per cell | Yes |

The doc points out a bug in `Talv/sc2-texture-scanner`: `blocksY` is computed from `sizeX`. Don't copy it.

### t3Water (`packages/core/src/map/write-water.ts`; `file-format/t3water.md`)

A header of 32 bytes: `WATR`, 110, the count of water areas, then zeros. Then per area 56 bytes: a 40-byte null-padded CWater id and four float32s, the rectangle x0, y0, x1, y1 in cells, read from an Agria pool the Editor saved (2026-10-27). The Editor keeps water as tiles: on 01-02's test save (2026-11-10) the author's new water was three areas (x 200-216 y 32-40, x 200-208 y 40-44, x 208-212 y 24-28), and the compile's one pool rectangle came back split in two where the new water met it. A Blueprint pool therefore has `rects`, each written as an area naming its CWater. These are the doc's "wave entries" (Part 3); its bodies we don't write, and the Editor wrote none. With no pools the file is the 32-byte header, as the Editor's empty one. Each Blueprint pool names its own CWater (`Agria_Pit`, a child of the stock type), whose states in `WaterData.xml` hold its heights.

An area the author draws names the stock type itself (`Agria`), and the Editor then saves a `WaterData.xml` with its own entry for each stock type it has met (Agria, Albion, BelShir on one Mission's first save), the drawn type's default state at the height the author gave it, as an attribute: `<CWater id="Agria"><State index="0" Height="15.100000"/></CWater>`. It leaves the compile's own CWater entries in the compile's layout. sync reads that height into the new pool, and a compile writing the Mission's pools replaces a `WaterData.xml` holding only such stock entries (`onlyStockWater`), where it would refuse any other Kept file.

### What an Editor save rewrites in a generated map's terrain

- **Only after a terrain edit.** A plain re-save (the MapScript drift test's, 2026-11-10) leaves every terrain file byte for byte. A terrain edit, even a small height brush, rewrites the whole terrain.
- **Its own quantization.** The Editor picks `<vertData>` afresh (on one Mission, our 9 / 3.662166e-4 became 1 / 2.441423e-4), so every raw value in `t3HeightMap` changes. Decode each file with its own `<vertData>` and compare heights: on that Mission only the 16 vertices the author brushed had moved. sync and the compile's change check both read it so (`src/map/terrain-resave.ts`), to 0.01.
- **Every ramp worked out again.** The compile writes a ramp's slope into the cliff layer (`r1`), at fractions of a level. On 01-02's test save (2026-11-10) the Editor redid all 14 of its ramps: on each, the row of vertices at the top level with a slope below it (`r1` 9.5 on level 6) took the lower level (5, `r1` unchanged), and the ramp's two corners (9.0 on level 6) went to level 5 with `r1` 8.0, their height down 1.0. Those 28 corners are the "exactly 1.0" vertices of the first save. sync and the compile's change check pass over every vertex the compile puts on a ramp (`onRamp`); the next compile writes its own ramps again.
- **`<terrain version>`** may be restamped (114 to 115 on a Kept city map whose package came from an import). The compile writes 115.
- **Doodads move with the ground.** The Editor resets a doodad's height to the ground under it (11.9945 to 11.997 on the Kept city map), within the compile's 0.05.
- **Objects in the Editor's form.** When the save rewrites `Objects`, every object comes back indented 4 spaces (ours 2), without `Rotation="0"` or `Variation="0"`, positions rounded to 4 decimals, and every doodad with `<Flag Index="HeightAbsolute" Value="1"/>` added. Read so, none of 01-02's 43 had changed (`editorObjectForm` in `src/map/editor-changes.ts`).
- **New files.** `t3FluffDoodad`, `t3HardTile` and `t3VertCol` appear (Part 3). The compile doesn't write them, so they are Kept files it leaves.

### Where the docs disagree with themselves

- The writer table in `t3terrain-xml.md` gives `VTCL` as `0x4C544356` and `LFCT` as `0x4C464354`. The reader docs and the Editor's bytes say the on-disk bytes are the ASCII strings `VTCL` and `LFCT` (LE `0x4C435456`, `0x5443464C`). Write the ASCII.
- `t3cellflags.md` notes an older wrong LFCT constant in the pipeline doc.

### Editing heights on Kept ground (`packages/core/src/kept-terrain/`, spec #247)

The height brushes (`edit_kept_terrain`) rewrite an Editor-saved package in place, so they follow its files rather than our writers:

- **Read with the map's quantization.** Every Editor-saved map has its own `<vertData>` bias and scale (a Kept city map: 9.002548 / 2.746134e-4). Decode `r0` and `r1` with them, never with ours. An Editor save picks them again even when no height changed (the same map, 2026-11-10: 9.003069 / 3.051764e-4 → 9.003311 / 3.051791e-4), so every raw value changes, though no height moves by more than 0.00024. A compile compares a generating Zone's heights with what it would write within 0.01 (`HEIGHT_MAP_TOLERANCE`, `changedCells` in `kept-terrain/generating-zones.ts`), never byte for byte or rounded.
- **Change only the base layer (`r0`).** The cliff layer (`r1`), the vertex cliff level (`r2`), the sync cliff level and `t3SyncCliffLevel` stay as they were, so cliffs keep their height and the sync files stay consistent. Flatten measures its target at the cliff layer most of the area is on: vertices on other levels keep their step.
- **Rewrite only changed vertices.** Unchanged vertices keep their bytes, headers included. The sync height of a changed vertex follows its render height: `round(new × 256)` where the two agreed, else the old sync height plus the change, which keeps a walking height's gap and the Editor's truncation.
- **Widen the quantization when it runs out, as the Editor does.** Each channel spans `65535 × scale`, starting at `−bias`: about ±9 at scale 2.746e-4. So ground at 8 can rise only about 1 in the base layer. The Editor saves a wider scale when it needs one (4.478322e-4 in `cliffs-and-ramps`). When an edit needs more range, the brush keeps the bias (or raises it), widens the scale, rewrites `r0` and `r1` of every vertex, and sets `<vertData>` in `t3Terrain.xml`, leaving every other byte of that file alone. Unedited heights move by less than one step of the new scale, and their sync heights don't change.
- **Leave `t3CellFlags` alone.** No flag depends on height. The Kept city map also has bit `0x04` (hidden terrain, above) on 16,827 cells (values 6 and 7). It isn't the painted pathing: none of its 2,547 painted cells has it (see "Painting pathing on Kept ground"). Height edits keep `t3VertCol`'s shadow bake, as the Editor's height brush does.
- **Doodads follow.** A Kept doodad's `Position` z is absolute (all 1,413 on the Kept city map have `HeightAbsolute`). A doodad on a changed cell moves by the height change at its own position. A doodad with `HeightOffset` and not `HeightAbsolute` is left as it is, since its z is a height above the ground. With both flags z is absolute: 852 of that map's doodads have both, and some sit below the ground (an `Elsecaro_Downtown_Building` at z 7.59 on ground at 7.99).
- **Write all or nothing.** Each changed file is written beside the old one (`<file>.edit-pending`), then all are renamed into place, so a failed write can't leave a height map at one quantization and `t3Terrain.xml` at another. The objects and trigger tools (`edit_kept_objects`, `tune_kept_triggers`) write through the same Kept session, so they are all or nothing too, and a call that changes no file writes nothing and isn't refused while the Editor has the map open.

Verified on the Kept city map on 2026-11-01. A flatten of 10×10 cells to 7.75 changed only 285 vertices of `t3HeightMap` and `t3SyncHeightMap` and three doodad heights in `Objects`. Everything else stayed byte-identical, and a compile in place afterwards changed nothing. Opening the map in the Editor and running Test Document, which also verifies 256×256 terrain writing, is still to do (PR for #248).

### Editing cliffs and ramps on Kept ground (`packages/core/src/kept-terrain/cliff-brushes.ts`, spec #247)

The cliff brushes (`raise-cliff`, `lower-cliff`, `add-ramp`, `remove-ramp`) reuse the generator's cliff and ramp code on an Editor-saved package. They rest on these facts about Editor-saved cliffs, measured on the Kept city map (2026-11-01):

- **Vertex cliff levels follow the corners.** Every one of the map's 66,049 `r2` values is what `vertexLevels` in `packages/core/src/terrain/cliffs.ts` gives from the levels at the even corners. `t3SyncHeightMap`'s level per vertex equals `r2` at every vertex. `t3SyncCliffLevel` follows `syncCellLevels` at all but 5 cells, which are round the terrain object. `t3CellFlags` bit `0x01` matches the cliff cells' mesh flag at all but 16 cells, also round the object. This rule isn't the Editor's always, though: in the author's many-levels test map (2026-11-07) 347 in-between vertices take the lower of their corners' levels instead of the max, at one-level steps as well as two-level ones, away from any ramp. Generated maps keep the max, which the Editor accepts, and a check on Kept `r2` values must allow both.
- **The cliff layer carries a small offset.** `r1` is the level's height (`CLIFF_HEIGHTS`) plus a few thousandths: -0.001 to -0.005 on most vertices. A level change moves `r1` by the level's height in whole quantization steps, so the offset stays to the byte and a level raised and lowered again comes back as it was. A ramp's vertices take the stamped height plus the offset.
- **Cliff sets are painted per cell.** `<cc cid>` is on flat cells too. 4,524 of the map's 5,020 entries are `f="0" cid="1"` (`CastanarEx1Cliff1` painted on flat ground). A cell has an entry when its `f` or its `cid` isn't 0. A new cliff wears the set already painted on its cell, or the set the edit names, which must be one of the map's own sets. A cell that stops being a cliff keeps its entry with `f` cleared, unless its `cid` is 0 too. Flat cells keep their `cvar` (0-3) as well.
- **`t3Terrain.xml` keeps the Editor's form.** It has CRLF line endings, `<terrain version="114">`, 24× texture tiling and no `<rampList>` when the map has no ramps. A brush rewrites only the cliff cell list, the ramp list and the cliff set list, each in the Editor's order and spacing, and checks first that regenerating the untouched list gives the same text. Everything else stays byte-identical.

The edit itself:

- **Raise or lower.** Every corner of the 2-cell cliff grid inside the area (a corner of a cell inside it) goes one level up or down, within 0 to 15. The vertex levels, sync levels, sync cliff levels, cell flags and cliff cells are worked out by the generator's rules from the old and the new corners, and written only where the rules' answers differ. So anything the Editor keeps off the rules elsewhere, round a terrain object for example, stays as it was. Cells that are part of a ramp (`f` bit 2) or round a terrain object (bits 4 and 8) are refused.
- **Add a ramp.** One of the generator's stock ramps (straight, wide diagonal or narrow diagonal) is stamped by `stampRamp` over the map's own values. `validateRamp` must first find the generator's edge from the low level to one above it. A ramp that climbs more than one level, or whose corners aren't at those levels, is refused. The new `<ramp>` is the generator's `rampXml`. On a fixture with straight outlines, a ramp added to Kept ground matches the generator's own ramp byte for byte in `t3Terrain.xml`, `t3SyncCliffLevel`, `t3CellFlags` and `r2`, and within a quantization step in `r1`.
- **Remove a ramp.** Only a stock ramp: its `<ramp>` must be what `rampXml` writes for it, with the Editor's `-0` read as 0. Its footprint goes back to plain cliff by the rules above. A vertex the ramp moved takes its level's bare height, since the offset the Editor kept there before the ramp isn't recorded anywhere.
- **Sync heights where the cliff moved.** At a vertex whose cliff layer changes, the walking height the Editor kept beside the old cliff is dropped: the sync height becomes the render height, keeping only the Editor's rounding (within 2/256). Units walk the generator's way, which Test Document runs.
- **Reset the shadow bake.** Any cliff or ramp edit sets every value of every `t3VertCol` entry to 255 and keeps the entries and their layout. That is how the Editor leaves the file after its own cliff edits (see "t3VertCol" below). The report says "static shadows need a rebake: Data > Generate Static Shadows (Cmd-Shift-L) in the Editor". `check-workspace` warns the same while Kept ground with cliffs (a `<cc>` with `f` bit 1) has no bake, which is no value below 255 or no `t3VertCol` at all. It doesn't warn about generated terrain (`t3Terrain.xml` on the compile record), which the next compile rewrites. Height brushes keep the bake.

Applied to the Kept city map on 2026-11-01. The 12×12 cells at (116, 110) went up a level, with a straight ramp up north at (122, 110). Only `t3HeightMap`, `t3SyncHeightMap`, `t3SyncCliffLevel`, `t3CellFlags` and `t3Terrain.xml` changed, the last by a `<rampList>` and 32 `<cc>` lines, with CRLF kept. Every vertex level still follows the corners, and a compile in place afterwards changed no file. Its `t3VertCol` (4,579 entries) turned out to hold no bake at all, every value 255, so nothing was reset, and `check-workspace` warns on it. Opening it in the Editor, rebaking and running Test Document is still to do (PR for #250).

### Painting textures on Kept ground (`packages/core/src/kept-terrain/paint-brushes.ts`, spec #247)

The paint brushes (`paint`, `swap-slot`, `clear-slot`, `set-blocks`) work on an Editor-saved package's own masks. They rest on these facts, measured on the Kept city map (2026-11-01):

- **Every texel's weights sum to 15.** All 4,194,304 of the map's mask texels have their 8 layer weights summing to exactly 15, as our generator writes them. The Editor's brush moves weight between layers; it doesn't add it.
- **The sync texture is the cell's dominant layer.** `t3SyncTextureInfo`'s texture index for a cell is the layer with the most weight over its 64 texels (8×8), the lower layer on a tie. All 65,536 of the map's cells agree, as does our generator. The set index is 0 on a map with one texture set, and the cell's block's set on a map with several.
- **The texture names are kept twice.** `t3Terrain.xml`'s `<textureList>` and the 8 null-terminated names in `t3SyncTextureInfo` list the same textures. 0101's are KorhalCityEx2's own but for slot 5, `CastanarMeshEx2`. Nearly all its ground is slot 0 (99.2% of the weight), and slot 1 is one diagonal road strip of 560 cells. Slots 2-7 are painted nowhere.

The edit:

- **Paint.** The texture is named, or given as a slot (0-7), and must be one of the map's 8. Otherwise the edit is refused, naming the 8 and the slot swap. A texel inside the area gets all 15 on the painted layer. Outside it, a texel's strength fades from 1 to 0 by its distance from the area, `1 − smoothstep(d / falloff)`, measured at the masks' resolution (8 texels per cell). So a soft stroke (3 cells) feathers over 24 texels, and a sharp one changes only the area's own cells. Each layer moves that far towards the painted one, and the result is rounded to whole weights with the sum of 15 kept (largest remainders, the painted layer first on a tie).
- **Sync.** Each cell with a changed texel gets its dominant layer again in `t3SyncTextureInfo`. Only the bytes of changed texels and cells are rewritten.
- **Swap a slot.** The new texture must be a terrain texture the game has (core's `data/texture-extracted.json`) and not already in another slot. The swap changes only names: one `<texture i="N">` line in `t3Terrain.xml`, whose CRLF and every other byte stay, and the slot's name in `t3SyncTextureInfo`. The masks stay as they are, so every cell painted with the slot changes look. Without the author's yes (`--confirm`, `confirm: true`), the swap only renders the slot's reach, map-wide: the cells where it has at least 10% of the weight, with the counts of cells it touches at all and of cells it dominates. A swap back is the undo.
- **Empty a slot.** `clear-slot { slot }`, with no area, writes the slot's name as `""` in the same two places: `name=""` in its `<texture i="N">` line, CRLF and every other byte kept, and a bare `\0` in `t3SyncTextureInfo`'s names table, which shrinks by the name's length. That is the Editor's own form for an empty slot (the "Texture sets" sample below). It is refused while any cell of a block on the slot's set has weight on the slot's layer, or has the slot as its sync texture in `t3SyncTextureInfo` (which would then name an empty slot), and the refusal names the cells. So no cell changes look: it needs no yes and renders nothing. A cell of a block on another set doesn't count, since its layer is another texture there, with one exception: for a set-0 slot, a Kept cell in a block a Blueprint set took from set 0, and that is still on that set, counts when the set holds the slot's texture on the same layer. A compile sends such a block back onto set 0 once no Zone of the set holds a cell in it, and refuses that if its Kept texels would then read differently; where the set's layer holds another texture, the return changes the cell's look whatever the slot holds, so emptying it changes nothing there. It is refused too while a generating Zone names the slot's texture and the next compile paints it from the slot's set: a Zone of none of the Blueprint's texture sets with a cell in a block on that set. The refusal names the Zones: give them another texture first. A slot of a texture set of the Blueprint's (`textureSets`, a `texture-set` entry on the compile record) is Compiled Content, for a slot swap as for emptying a slot, and both are refused, as is the whole list on a generated map: change the position in the Blueprint instead. A map-local CTerrain override listing the texture stays as it is. It makes room under the 16 once `texture_usage` reports a slot painted nowhere, in place of Map > Map Textures in the Editor. A swap into the empty slot is the undo. An Editor resave of an emptied slot is still to check (#535).
- **Several texture sets.** See "Texture sets" below for the format. A slot is 0-7 in set 0, and 8*s* to 8*s*+7 in set *s*.
  - **Paint by name:** the stroke paints every set holding the texture, each on its own layer.
  - **Paint by slot:** the stroke paints that slot's set only.
  - **Like the Editor:** a stroke paints only blocks whose set holds the texture. It leaves texels within 2 of a block of another set alone, and the report names the blocks it left.
  - **A swap** may not take the map past 16 different textures. A texture already in another slot of the same set is refused, but a copy in another set is fine.
  - **`set-blocks { set }`** moves the blocks the area touches onto a set. It writes their `tileSet` and their cells' sync set, and nothing else. Like a swap, it only renders the blocks before and after until the author says yes (`--confirm`, `confirm: true`).
  - **Seams:** each of these edits warns where a texture touches itself across a boundary between sets.
  - **Generating Zones** beside Kept ground still refuse a map with more than one set.
  - **Checked in the Editor.** On 2026-11-02 we edited a copy of the third texture-set sample: block 154 moved onto set 1, then a `CharDunes_6` stroke over cells 74-91 × 74-79 that runs over into set 0. The Editor opened and saved it with `t3Terrain.xml`, `t3TextureMasks` and `t3SyncTextureInfo` byte-identical (`texture-sets/ours/`).
- **Renders.** A stroke's renders blend the textures' colours by their weights, at 2×2 texels a pixel, so a feather shows as a gradient. The area render also shows doodads and cliff edges. The difference render shows how much weight moved. A swap's renders cover the whole map. The CLI and the tool print which colour is which texture.

Applied to a copy of the Kept city map on 2026-11-01. The 4×12-cell alley at (112, 149) was painted with `KorhalCityEx2_8`, feathered over 2 cells. It changed 7,296 texels in cells 110-117 × 147-162, the area plus its falloff, and 84 cells' sync textures. Every texel still sums to 15, and every cell's sync texture is still its dominant layer. Slot 1 was swapped for `KorhalCityEx2_6`: one line of `t3Terrain.xml` and one name in `t3SyncTextureInfo` changed. Swapping it back restored both to the byte. `check-workspace` passes, and a compile in place afterwards changed no file. Opening it in the Editor is still to do (PR for #249).

### Texture sets (#253)

A map can hold up to 8 texture sets of 8 textures. Each 8×8-cell block draws on one set. These facts are decoded from an Editor-saved sample, `packages/core/tests/fixtures/editor-terrain/texture-sets/` (128×128 cells, BelShirEx1, saved 2026-11-02). Its second set, CharDunes, is painted over a 3×3 square of blocks:

- **`t3Terrain.xml`.** The second set is named in `<textureSet i="1" name="CharDunes"/>`, and its textures fill `<texture>` slots 8-15. Set *s* owns slots 8*s* to 8*s*+7. The sample's set 0 lists two textures, `BelShirDirtLight` and `BelShirGrassLight`, and set 1 lists four, `CharDunes_1`, `_5`, `_3` and `_6`. The rest are `name=""`. Each block names its set in `<blockTextureSet i="N" tileSet="S"/>`, where N = block row × blocks per row + block column, rows and columns counted the same way as cells. The sample's set-1 blocks are 103-105, 119-121 and 135-137: block columns 7-9 of rows 6-8, so cells 56-79 × 48-71. Every other block is `tileSet="0"`.
- **`t3TextureMasks` keeps 8 layers whatever the sets.** The file's size doesn't change: 4,194,368 B, as with one set. A texel's layer *l* means texture *l* of its block's set. So layer 0 is `BelShirDirtLight` in a set-0 block and `CharDunes_1` in a set-1 block. Every texel still sums to 15.
- **A stroke paints only blocks of the brush's set.** The Texture brush has a Texture Set menu ("1 - BelShirEx1"), and its textures are that set's. Painting across into a block of another set does nothing there: the author painted `BelShirGrassLight` (set 0) across the square's west edge, and the Editor's view showed a hard cut at the boundary. The second save (`texture-sets/boundary/`) bears this out. 8,602 set-0 texels moved from layer 0 to layer 1, and no set-1 texel gained layer 1. The cut sits just short of the boundary, not on it. West of the square, grass is at 14-15 out to texel column 445 and 0 in columns 446-447. Inside the square, columns 448-449 are untouched in both saves, and paint starts at 450. On the north side the grass ends at row 382 with the square starting at row 384. So the Editor leaves about 2 texels unpainted on each side of a boundary between sets.
- **`t3SyncTextureInfo`.** The header's `set_count` is 2 here: the sets in use, or the highest set + 1. The names table then holds `set_count × 8` null-terminated names, set 0's 8 first, empty slots as a bare `\0`. The sample's file is 131,185 B. Each cell's record is (texture, set): the texture is its dominant layer, a local index 0-7 within the set, and the set is its block's set. All 16,384 cells agree with their block's `tileSet`, and no block mixes sets. The set-1 cells' dominant textures are 0 (446 cells), 2 (90) and 3 (40).

- **Adding a texture to a set fills its next empty slot.** In the second save `CharDunes_4` is new in slot 12, the first empty slot of set 1 (local 4). It is painted over 1,810 texels at the square's west edge, and 8 cells have it as their sync texture. The sync file's names table grew by those 11 bytes, to 131,196 B. Nothing else in `t3Terrain.xml` changed.
- **The Editor's tools.** Map > Map Texture Sets adds a set, and Map > Map Textures picks a set's textures. The terrain editor's Texture Set brush moves blocks onto a set; painting textures never does.
- **At most 16 distinct textures in a map,** across all its sets (the author, from the Editor). That is far fewer than the 64 slots.
- **A texture may sit in more than one set.** Each copy fills a slot in its own set, and it still counts once towards the 16.
- **The same texture touching itself across a set boundary glitches** in the render (the author, from the Editor). This probably comes from the unpainted band and from the two sets blending the texture on different layers. Where a texture is on both sides of a boundary, flag it rather than paint it up to the edge.

- **Moving a block onto another set changes only its set.** The third save (`texture-sets/block-move/`) is the second save with `BelShirGrassLight` painted south of the square. Then 8 blocks there (151-153, 167-169, 184-185) were moved onto set 1 with the Texture Set brush. In `t3Terrain.xml` only those 8 `tileSet` values changed. The masks changed only by the grass stroke, so each texel keeps its weights on the same layers. Layer 1 was grass and now shows as `CharDunes_5`: the texture swaps slot for slot, as the author saw in the Editor. In `t3SyncTextureInfo` the 512 moved cells changed their set index to 1, and their texture index stayed the same layer. The brush clears no band at the new boundary: layer 1 runs straight across texel column 640, out of the moved blocks into set 0.

### Custom texture sets (`packages/core/src/kept-terrain/texture-sets.ts`, ADR-0016)

A Mission can add texture sets of its own (`textureSets` in the Blueprint), each painted over some generating Zones: beside Kept ground those marked `"terrain": "generate"`, and on a fully generated map any Zone (see "On a fully generated map" below). What the Editor and the engine do with a set, and what the compile writes:

- **A set's slots live in `t3Terrain.xml`.** The engine's reader keeps 8 set names and 64 slot names from the list (`t3HeightMapDesc`'s `textureSet_slot[8]` and `texture_slot[64]` in `file-format/t3terrain-xml.md`), so the slots are what it draws. Map > Map Texture Sets lists sets by tileset ("(Void) Korhal City", "Braxis Alpha Ex2"), numbered from 1 in the Editor: its set 2 is the file's set 1.
- **The Editor holds a set to its tileset's textures.** The set's `name` is a tileset (CTerrain) id. On loading, the Editor keeps a slot's texture only if that tileset's `BlendTextures` lists it, and swaps any other for one of the tileset's unused textures, in the tileset's order. On 2026-11-08 a compiled `BraxisAlphaEx2` set on a copy of the Kept city map holding `KorhalCityEx2_1`, `BraxisAlphaPlatesEx2`, `KorhalPlatformEx2_4`, `PortCityB7`, `MarSaraPanels`, `NewFolsomGrating`, `BraxisAlphaMeshEx2`, `BraxisAlphaWreckedPlatesEx2` came back from an Editor save as `BraxisAlphaMetalEx2`, `BraxisAlphaPlatesEx2`, `BraxisAlphaMetalDetailEx2`, `BraxisAlphaDarkPlatesEx2`, `BraxisAlphaRustEx2`, `BraxisAlphaRockEx2`, `BraxisAlphaMeshEx2`, `BraxisAlphaWreckedPlatesEx2`, with no change made to the set. Order within the list is free: the Editor's sample (`texture-sets/`, no `TerrainData.xml`) holds `CharDunes_1`, `_5`, `_3`, `_6`, `_4`.
- **A map-local CTerrain override widens the list.** The Kept city map's `TerrainData.xml` overrides its tileset, `<CTerrain id="KorhalCityEx2"><BlendTextures index="5" value="CastanarMeshEx2"/>`, matching slot 5 of its set 0, which is why that slot survives the Editor. Map Texture Sets' Modify presumably writes such an override.
- **What the compile writes.** The set's `<textureSet i="s" name>`, its 8 `<texture>` slots (8s to 8s+7, empty ones `""`), `tileSet="s"` for each block holding a cell of its Zones, and a `CTerrain` override for its tileset in `Base.SC2Data/GameData/TerrainData.xml` with `BlendTextures` index *l* the set's slot *l*, merged beside the Kept entries. A tileset the package's own `TerrainData.xml` overrides already is refused as a set's name. In `t3SyncTextureInfo` it writes `set_count` (the highest set in use, plus one), the names table (`set_count × 8` names), and the set index of each moved block's cells. The masks change only in the Zones' own cells, painted all 15 on the texture's layer up to the block boundary, with no 2-texel band.
- **Kept texels in a moved block keep their weights.** They are read in the new set, layer for layer. So every layer they use must hold the same texture in both sets, or the compile refuses, naming the texture and the slot it goes in. `texture_usage` with a proposal lists those layers and gives an order that meets them.
- **A boundary between sets is never clean.** Where the same texture touches itself across it, the Editor renders an artifact, whatever slot it has in each set (the author; sharing the slot doesn't help). Where different textures meet, the game draws a hard, straight cut along the block edge, as neither side's texture can fade into one its set doesn't hold. Seen on the copy of the Kept city map on 2026-11-08, where set-0 concrete met set-1 panels in a rectangle of block edges. Hide the boundary under doodads, a wall or a cliff edge. A diagonal boundary is a staircase of 8-cell steps.
- **Where it needs cover** (`kept-terrain/set-boundaries.ts`, #539). `texture_usage` (the MCP tool and the CLI) lists each stretch of boundary between sets, and the compile warns with the stretches of each set it writes. A stretch is a run of cells along one block-edge line (`x = 136, y 48-63`), with the set and texture on each side, given as the cells either side of the line. Each pair of cells across the edge is read from the 4 texels nearest it on each side (the Editor's 2-texel band and 2 more). A texture with weight on both sides is an **artifact**. Otherwise the pair is a **hard cut**, between each side's texture with the most weight there. A pair with a cliff cell (`t3CellFlags` bit `0x01`) on either side is under the cliff mesh, so it is left out and only counted. Neighbouring pairs on one line with the same kind, sets and textures make one stretch, across block corners too. `render: true` (CLI `--render <file.png>`) draws the stretches over the ground round them, as the paint brushes' renders do: textures blended by weight, cliff cells darkened, hard cuts red and artifacts magenta. Stretches whose 8-cell margins meet share a view, and each cluster gets its own, so sets far apart don't shrink into one map-wide picture of 1-pixel lines; the CLI numbers the files (`name-1.png`, ...) when there are several. The list is the dresser's input for an edge line over each stretch, later.
- **Blocks it won't take.** A block already on another set the map has, as the Editor's Texture Set brush leaves one, is refused, since undoing the set could only send it to set 0.
- **Undo.** The compile record lists each set (`texture-set`) with its index, blocks and a fingerprint of its name, slots and those blocks' `tileSet`. A block no set covers any more goes back to set 0 if its texels read the same there. A set no block uses is emptied.
- **On a fully generated map** (`terrain/generated-texture-sets.ts`, #533). The compile writes the whole package, so each set goes on a fresh map of one set (the Mission's 8 textures, every block on it, nothing painted), at the next free index in `textureSets` order, through the same plan and writers. `t3Terrain.xml` gets each set's name, slots and blocks; `t3SyncTextureInfo` gets `set_count`, `set_count × 8` names and each cell's block's set; and `TerrainData.xml` gets each set's CTerrain override after the Mission's own tileset entry. The painter paints a texel's weights on its block's set's layers. Within a set the blends are as before. A texture blended in from a block of another set is given to the cell's own texture, so a set's edge is a clean cut along the block line, and the boundary warning lists its stretches. A set's Zone wears its `texture`; else, under the set's `palette`, its level band and variety patches as `texturePalette` paints the rest (below); else the set's first, with no variety patches. There is no record entry to undo: each compile writes the sets afresh.
- **A set's palette on a generated map** (`texturePlan` in `terrain/paint-textures.ts`). A set's `palette` takes `texturePalette`'s fields (`main`, `variety`, `low`, `high`, `built`), every texture one of the set's, so its Zones are painted by the palette's rules: built ground its `built`, other ground its elevation's band, natural ground for play patched with its variety (DL-01, where the Style Pack sets patches), and backdrop Zones their band's texture alone. The bands count from the set's own main level: its `mainLevel`, else the cliff level most of its Zones' flat cells are on (ties to the lower), so a set on levels 1 and 2 of a map whose main level is 3 still has a main. The Style Pack's cliff advice (DL-02) runs per palette, over the ground it paints: cells on its set's blocks (set 0's for the map's palette) whose painting Zone is its set's, with a set's advice prefixed `Texture set <id>'s palette:`. A cell snapped onto another set's block wears that set's textures, which no band chose, so it counts for neither; the snap warning covers it. A cliff between two sets' ground changes texture anyway. A palette beside Kept ground is refused: generating Zones there are painted one texture each.
- **A set chosen by level.** A set's `levels` takes every generating Zone whose `elevation` is one of them, as well as the Zones its `zones` names (it gives one or both). A Zone named by any set's `zones` keeps that set: lists win over levels (`textureSetOfZone` in `domain/mission-blueprint.ts`), so a cave's exit shelf at a tunnel level can keep the surface's look. A level is in one set at most, and each needs a generating Zone at it. In a cave whose rock is many backdrop Zones a level apart, `levels` follows the depth where id patterns can't.
- **Snapped blocks on a generated map.** No Kept ground stands in a set's edge blocks, but Zones of two sets can share a block. The block goes to the set whose Zones cover most of its cells. A cell is the last-listed Zone's whose polygon holds its centre, and a Zone in no set counts for set 0. A tie goes to set 0, then to the set listed first in `textureSets`, and a block no Zone covers stays on set 0. The other Zones' cells there are painted from the winning set, with the texture most of the block's cells wear (the set's first if none), and the compile warns, listing each snapped block (`block 138 (cells 80-87 × 64-71) went to texture set metal (set 1), over Zone field's 16 cells`). It doesn't refuse: the author's call on #533.

Applied to a copy of the Kept city map on 2026-11-08. Its factory (21 generating Zones over cells 136-213 × 46-111) got a set of `KorhalCityEx2_1` (shared at layer 0, the only texture the Kept ground in its edge blocks shows), `BraxisAlphaPlatesEx2`, `KorhalPlatformEx2_4`, `PortCityB7`, `MarSaraPanels`, `NewFolsomGrating`, `BraxisAlphaMeshEx2` and `BraxisAlphaWreckedPlatesEx2`, named `BraxisAlphaEx2`. Blocks 17-26 × 5-13 (90 blocks) moved onto set 1. No Kept texel or Kept cell's sync texture changed, every texel sums to 15, and every cell's sync texture is its dominant layer. A second compile changed no file. Dropping the set from the Blueprint gave back the committed package byte for byte. The map now holds 15 textures, and set 0's slots 2-7 are painted nowhere, so they can be emptied (`clear-slot`, #535). An Editor save then reset the set to BraxisAlphaEx2's own textures (above). Compiled again with the CTerrain override, the Editor kept all 8 (Map Properties > Textures showed the factory set). The author painted a `MarSaraPanels` stroke and saved:
- **Kept as written:** the set's name and slots, the names in `t3SyncTextureInfo`, every block's set, and `TerrainData.xml` (byte-identical, not rewritten).
- **The stroke:** 217 cells changed, all in set-1 blocks, from layers 0 and 1 to layer 4 (`MarSaraPanels`). No set-0 cell changed, and every texel still sums to 15.
- **Sync ties:** 2 cells' sync texture differs from our dominant-layer rule, likely ties the Editor breaks another way.
- **Unrelated Editor changes:** `<terrain version>` went from 114 to 115 and the quantization changed, as on any terrain save. And 29 of the factory's cliff cells went from `cvar` 1-3 to 0, which the next compile will find as hand edits to the generating Zones' cliff cells.
- **The shared texture glitches.** `KorhalCityEx2_1`, in both sets at slot 0 to keep the edge blocks' Kept ground, renders an artifact where it crosses the boundary. A set whose Zones fill its blocks whole needs no shared texture.
- **The Editor's thumbnails can be wrong.** Map Properties > Textures showed `PortCityB7` as tan, while in game it is grey stained concrete with skid marks, as the sc2-mapping-reference gallery's picture has it. Judge a texture in game, not by the Editor's thumbnail.

### Generating Zones beside Kept ground (`packages/core/src/kept-terrain/generating-zones.ts`, spec #247)

A Zone with `terrain: "generate"` in a Mission with Kept terrain is written into the package's own terrain files at each compile, cell by cell, with the brushes' readers and writers. The rules that keep every Kept cell byte-identical, but for a widened quantization (below):

- **The Zone owns whole cliff cells.** Its cells are the 2×2 cliff cells wholly inside a generating Zone's polygon (by cell centre) and outside every Kept Zone, less any the author kept. Cliffs then fall on the cliff grid, and a cliff cell is either all the Zone's or all Kept.
- **Only interior vertices change.** A vertex on the edge of the Zone's cells is a corner of a Kept cell too, so `t3HeightMap` and `t3SyncHeightMap` change only at vertices whose four cells are all the Zone's. The cliff grid's corners change only where all four cliff cells round them are the Zone's, so by `vertexLevels`, `syncCellLevels` and the cliff cell rule nothing outside the Zone's cells changes either. `t3SyncCliffLevel`, `t3CellFlags`, `t3SyncTextureInfo` and `t3TextureMasks` change only in its cells, and `t3Terrain.xml` only in its cliff cells' `<cc>` entries.
- **The seam.** The Zone's corners take its elevation as their cliff level. Where the Kept ground beside it is at another level, its own edge cliff cells get the cliff mesh. Each takes a set as on a generated map (`cliffCellZone` in `src/terrain/cliff-sets.ts`): the choice (`cliff`, else its `cliffSets` group's) of the generating Zone on top, or, for a wall of backdrop rock, of the floor at its foot that names one. A cell with Kept ground on top takes the choice of the Zone it was made in. A choice the map's `<cliffSetList>` lacks warns, and those cells, like cells with no choice, wear the set most Kept cliffs within 4 cliff cells wear. A map with no cliff sets gets its tileset's first, as a cliff brush gives it. Base heights (`r0`) are the generator's, eased from the base height at the nearest edge vertex over 3 cells (smoothstep), so flat ground meets flat ground without a step. Ground the map's quantization can't hold (a Zone at level 6 or higher, on the Kept city map's) widens it, as the Editor does: every vertex of `t3HeightMap` is rewritten, each Kept one by less than a step of the new scale, `<vertData>` says so, and the compile warns. The author chose this on 2026-11-07 (#525). The seam's Kept heights move with the widening, so the Zone's ground is blended a second time from them: a second compile then changes nothing. This is the one case where a Kept cell's bytes change.
- **Texture.** Its cells are painted all 15 with the Zone's `texture`, which must be one of the map's 8, or by default with the slot most of the bordering Kept cells show. The sync texture is each cell's dominant layer again.
- **Kept objects.** A Kept doodad on its cells with an absolute height moves by the ground's change at its position. The dressing is expanded with the Kept doodads near the Zone standing first, so set pieces keep their spacing from them, and clear of each Connection's `at` into Kept ground, then cut to the Zone's cells and set on the new ground. Doodad Anchors with no height stand on the new ground too. Nothing is removed.
- **Not written:** `t3VertCol`, so a static shadow bake goes stale where the Zone changes cliffs (the compile says so); `Minimap.tga`, `MapInfo` and the other Kept files. The Editor redraws the minimap when it saves.
- **The compile record** lists the cells in each of the seven files as `terrain-cells` rectangles, with a fingerprint of what each holds there: heights decoded to 0.01 with the map's own quantization (so a save at another one isn't a change), and the other files' bytes, texel weights and `<cc>` values. At the next compile a fingerprint that no longer matches in `t3HeightMap`, `t3TextureMasks` or `t3Terrain.xml` is a hand edit. The cells that differ from what the compile would write are named (`terrain-cells:t3HeightMap`, with the count and first cell), and the author keeps or discards them. Kept cells go into the record's `kept` list and leave the Zone in every file, a vertex's four cells and a cliff cell's 2×2 together. The sync files and cell flags aren't compared, since the Editor works them out from the others. If the Blueprint changed those cells as well, they're named too.

Applied to a copy of the Kept city map on 2026-11-01: a 12×12 `dock_yard` Zone at (140, 122), level 1, paved with `KorhalCityEx2_2`, beside a Kept `docks` Zone, with an open Connection at (152, 128). It changed 121 interior vertices (x 141-151, y 123-133) by up to 0.006, 144 cells' texels and sync textures, one Kept hut's height (+0.0016) and nothing else. No cliff cell changed, a second compile changed no file, and `check-workspace` passes. At elevation 2 the check reports the Connection. Opening it in the Editor and running Test Document is still to do (PR for #252).

### Painting pathing on Kept ground (`packages/core/src/kept-terrain/pathing-brush.ts`, spec #247)

The pathing brushes (`block-pathing`, `clear-pathing`) paint the Editor's pathing layer, `CellAttribute_Pnp` (Pnp: no pathing; `packages/core/src/terrain/write-cell-attribute.ts`). The Editor 5.0 writes this file, not the `PaintedPathingLayer` of Part 3. The facts, measured 2026-11-01:

- **The header counts sub-cells.** It is one uint32 (LE): width × height × 8, a bit for each sub-cell. That's `00 00 02 00` on a 128×128 map and `00 00 08 00` on the Kept city map (256×256). Five ladder maps (Triton, Newkirk Precinct, Bel'Shir Vestige, Para Site, Winter's Gate) agree, at sizes from 184,320 to 373,248 bits. Then comes a byte per cell, row by row from the bottom. Our writer used to write `00 00 02 00` whatever the size. It now computes the count, which gives the same bytes at 128×128. A file of the right length with that old header is still read, and a stroke writes it back with the right one.
- **The bits.** Each cell has 8 sub-cells, 2 wide and 4 high, and 255 is a whole cell (layout under `dugPoolPathing` in `shore-banks.ts`). On the Kept city map, 2,547 cells are painted: 1,385 whole, and the rest are the ragged edges of the Editor's round brush (most often 192, 48, 12 and 3: a pair of sub-cells). Nearly all of it is under building doodads and the blocks round them.
- **No flag follows the paint.** The painted cells' `t3CellFlags` are 2 or 3, like any ground or cliff. Bit `0x04` (16,827 cells) is on none of them.

The edit:

- **Whole cells.** Every cell inside the area becomes 255 (`block-pathing`) or 0 (`clear-pathing`). Every other cell keeps its byte, the Editor's part-painted edges included. There's no falloff: a soft or numeric one is refused, and `"sharp"` or none is accepted. A part-painted cell inside the area becomes whole, and the report counts those.
- **Only the paint.** Cliffs, doodad footprints and water still block where they do. Clearing an area where a doodad stands warns that its footprint may still block. Nothing else in the package changes, and doodads don't move.
- **The file comes and goes.** A map with nothing painted has no file, as the Editor leaves it. The first stroke writes one, with the header for the map's size, and clearing the last paint removes it. A file whose header or length doesn't fit the map is refused.
- **Compiled terrain is refused.** A compile of generated terrain owns `CellAttribute_Pnp`: it writes the file whole wherever a dug pool needs it, over any stroke, and removes it when the record lists it and no pool does. So a Mission whose `t3Terrain.xml` or `CellAttribute_Pnp` is on the compile record is refused, naming dug pools. A Mission with Kept terrain keeps the file at each compile, and generating Zones don't write it, so pathing is Kept Content everywhere on such a map, generated Zones included.
- **Renders.** The paint is drawn sub-cell by sub-cell in red over the height relief, with cliff edges dark and doodads dotted. The difference render shows newly blocked sub-cells in red and opened ones in blue. Map Study draws a `pathing.png` layer over the elevation when a map has paint.

Applied to a copy of the Kept city map on 2026-11-01. The 9×2 cells at (112, 156) were blocked, across the alley that runs north from (116, 152) between the diamond-shaped building block and the block east of it. Only those 18 bytes of `CellAttribute_Pnp` changed (0 → 255), and its header stayed. `check-workspace` passes, and a compile in place afterwards changed no file and kept the paint. Clearing the same cells gave back the original file to the byte. Seeing a unit stopped by the band in Test Document is still to do (PR for #251).

## Part 3: Formats we don't write yet

Location: the Editor puts every `t3*` file at the package root beside `t3Terrain.xml`. The painted layers are stored under their type names (`PaintedPathingLayer`, `PaintedCreepLayer`); the docs give no subfolder.

ComponentList: only `t3Terrain.xml` is a component (`terr`). None of the binaries appear in `component-list.md`'s enum or in the Editor's `ComponentList.SC2Components`, and only `t3Terrain.version` sits beside them. Adding any file below needs no ComponentList change and no `.version` file.

### PaintedPathingLayer and PaintedCreepLayer

`painted-pathing-layer.md`, `painted-creep-layer.md`. One shared format; the reader takes a layer index (0 pathing, 1 creep).

```
int32  bounds_min_x, bounds_min_y, bounds_max_x, bounds_max_y   // painted region, cells
uint8  paint[512 * 512 * 2]                                     // always 524,288 bytes
```

- Total 524,304 bytes whatever the map size. The cell at `(x, y)` sits at `paint[2·(x + y·512)]`, with a primary and a secondary byte.
- Bounds wider than 512 are clamped to centre ± 256.
- Each paint byte is looked up in a 7-entry table per layer (`{paint_value u8, layer_flag i32}`, −1 ends the table). A match sets that flag in the terrain cell bitfield. The table values are **not documented**.
- The reader walks four sub-cells per cell, alternating primary and secondary bytes. The bit index is `8·(col + row·gridWidth) + 2·subCell + isSecondary`. That's four sub-cells against two bytes per cell. The docs don't explain this; it's an open question.

Use for sc2-adjutant: the creep layer could keep Zerg creep off roads or objective areas. Painted pathing doesn't need this format: the Editor 5.0 saves its pathing brush as `CellAttribute_Pnp`, which we read and write (see "Painting pathing on Kept ground" in Part 2). No Editor-saved map we have holds a `PaintedPathingLayer` file.

### t3FluffDoodad

`file-format/t3fluffdoodad.md`. Header 24 B: `DLFT`, version, 16 zero. Then:

```
uint32 count
v102: { int32 x; int32 y; }            // 8 B each
v103: { int32 x; int32 y; uint8 flag; } // 9 B each
```

v101 is a legacy layout with names and four strings per entry; don't write it. The Editor writes v103. An empty file is 28 bytes: `DLFT`, 103, 16 zero, count 0. The docs describe the entries as cell positions for "fluff" (grass tufts, pebbles). Whether they add fluff or suppress the tileset's automatic fluff is not stated. The flag's meaning is open too.

Use: control automatic ground clutter, e.g. clear it from paths and building pads. Low priority. Writing the empty 28-byte file just makes our packages look like the Editor's.

### t3HardTile

`file-format/t3hardtile.md`. Header 24 B: `HRDT`, 102 (only), 16 zero. Then:

```
uint32 group_count
group:
  uint32 tile_count
  tile[tile_count]:
    int32 pos_x, pos_y, pos_z
    float normal_x, normal_y, normal_z   // must be unit length within 1%
    int32 field[6]
    float scale                          // must be >= 0
    int32 field_34
    uint8 flag_a, flag_b                 // 58 B per tile
  uint8 flag_a, flag_b, flag_c
  string name                            // "length-prefixed" per the doc
  int32 model_index                      // -1 = none
```

The doc's prose says "14 fields, 50 bytes + 2", but its table gives 16 fields and 58 bytes; the table is used above. The string encoding isn't pinned down: the same reader helper reads null-terminated names in `t3SyncTextureInfo`. One bad tile empties the whole file. The Editor wrote an empty file (28 B: `HRDT`, 102, 16 zero, count 0) for a map with cliffs and ramps. So our cliffs don't need it. It probably goes with the `<ramp rampHardTileHandles>` attribute.

Use: none planned. Optionally write the empty file.

### t3VertCol (vertex colour)

`file-format/t3vertcol.md`. Header 32 B: `VTCL`, version 103–104, `entry_count`, 20 zero. Then per entry:

```
int32 texture_index
int32 layer_index
int32 color_data[4]
v104: int32 enabled      // stored as (value != 0)
v104: int32 blend_mode
uint32 sub_data_size
uint8  sub_data[sub_data_size]
```

The Editor-saved `cliffs-and-doodads.SC2Map/t3VertCol` is v104 with 1,127 entries (74,144 B). We don't know whether that map has painted vertex colour. Its first entry reads 0, 1, then fixed fields that look like floats (two `4.0f`), then `sub_data_size` 25 followed by 25 `0xFF` bytes. That doesn't fit the doc's names, which read like guesses. The file looks like a list of patches with a sub-buffer each, not a per-vertex grid. The field meanings and the sub-data layout are open.

**Verified layout (2026-10-25).** Parsing all 13 Exemplar Maps (`packages/plugin-style-antioch/exemplar-maps/`) with the layout below ends exactly at each file's last byte, so the doc's field names above are wrong:

```
int32  id          // 0 for kind 1; a recurring hash-like id for other kinds
int32  kind        // 1, 2, 4 or 8
float  x0, y0, x1, y1   // rect in cells
int32  unknown_a, unknown_b   // almost always 0
uint32 size
uint8  data[size]
```

- **Kind 1** entries tile the whole map once in 4x4-cell squares, `size` 25: one byte per vertex of a 5x5 grid, row-major with x fastest. Neighbouring tiles repeat their shared edge vertices. Values are 255 where untouched. On 8 of 13 Exemplar Maps they darken smoothly along the foot of cliffs: the Editor's Data > Generate Static Shadows bake (Cmd-Shift-L), confirmed by a bake test on 2026-10-26 (evidence in `packages/plugin-style-antioch/exemplar-maps/data-analysis.md` Part 3 and `packages/plugin-style-antioch/exemplar-maps/LESSONS.md` DL-10). Any cliff edit resets every byte to 255, so run the bake after the last cliff edit. Our cliff and ramp brushes on Kept ground do the same: every value 255, entries and layout kept ("Editing cliffs and ramps on Kept ground" above). Entries for cliff models the edit adds or removes aren't added or dropped. The rebake rebuilds them.
- **Kinds 2 and 4** are one byte per vertex of a placed cliff or ramp model: `id` identifies the model, `size` is its vertex count, and the same model carries nearly the same values across maps. The same bake writes them; without it they are all 255. Kinds 8 and 0 are always 255.

Reader: `packages/core/src/terrain/read-t3-vert-col.ts`.

Use: tint ground under effects without new textures, e.g. scorch marks or a blighted moon's discoloured regions. Before writing it, decode one Editor map with a single small painted patch. Until then keep omitting it; maps load without it.

### t3Water (full body format)

`file-format/t3water.md`. Header 32 B: `WATR`, version 104–110, `wave_entry_count`, `body_count`, 16 zero. Then `body_count` bodies, then `wave_entry_count` wave entries.

Body, on disk, in read order:

| Field | Versions |
|---|---|
| name 1 (40-byte string read) | all |
| name 2, texture/material (40-byte string read) | all |
| 2 extra 40-byte strings | 107–109 |
| u8 `flag_a` | all |
| u8 `flag_b` | ≥ 105 |
| u32 count + N × 40-byte strings | 109 only |
| u32 `wave_count` (≤ 1000) | all |
| `wave_count` × wave record | all |
| body-level wave params (wave-record layout) | all |
| 3 × int32 footer | all |

Wave record, 116 B in memory, read field by field:

| Offset | Field | Notes |
|---|---|---|
| +0x00 | 8 × float | position/direction/extent |
| +0x20 | int32 | |
| +0x24 | 4 × float | colour or bounds |
| +0x34 | int32 | |
| +0x38 | int32 | read only for v ≥ 108, else 0 |
| +0x3C, +0x40 | int32 × 2 | |
| +0x44 | 4 × float | |
| +0x54 | int32 | |
| +0x58 | uv scale u | v106–109: one float for both u and v; v110: separate u then v; else 1.0 |
| +0x60…+0x70 | int32 × 5 | |

Wave entry, on disk: a 40-byte name read plus 16 bytes of data (4 floats).

This is **not** enough to implement non-empty water with confidence. The doc doesn't say whether a "40-byte string read" means a fixed 40-byte field or a string capped at 40, or how the body-level parameters are sized. Before writing water, take an Editor-saved map with one small water body and diff it against this table. The water's look comes from a `CWater` catalog entry (`WaterData.xml` in the game data), named by the body's strings.

Use: lakes, acid or lava pools and moats as terrain features. The compile writes the wave entries, which are the pools' rectangles (Part 2); the bodies stay undecoded and unwritten.

### t3Terrain.xml `cliffDoodadList`

`file-format/t3terrain-xml.md`, `<cliffDoodadList>` / `<cliffDoodad>`. Inside `<heightMap>`, after `rampList` and before `vertData`, written only when non-empty:

```xml
<cliffDoodadList num="1">
    <cliffDoodad name="..." pos="12.000000 34.000000 8.000000" rot="0"/>
</cliffDoodadList>
```

- `name`: a terrain object's id: a `CCliffDoodad` in Blizzard's `TerrainObjectData.xml`, catalogued in `packages/core/data/terrain-object-catalog.json`.
- `pos`: three floats written with `%f`, each followed by a space. x and y are the object's centre vertex (every stamp has an odd number of vertices each way). z is the cliff height of the stamp's lowest level (−8 for a bridge's level-0 sides, 0 for a level-1 hole).
- `rot`: quarter turns anticlockwise, 0–3. At 0 the stamp's first `HeightCodes` row lies along the north edge; each turn moves it a quarter round, north to west.
- Each entry is 416 B in memory.

These are the Editor's terrain objects (bridges, holes, trenches, floor plates), not cliff-face decorations: the Exemplar Maps' entries name ids such as `KorhalHole` and `TerrainObjectCoolantPipes1_1`. Editor saves from 2026-10-28 (`packages/core/tests/fixtures/editor-terrain/terrain-objects`, with a README) settle how they work:

- **The stamp is per vertex.** Each `HeightCodes` character sets one vertex's cliff level outright (A–D = 0–3; a space leaves it alone), centred on `pos`: Bridge6x10, 6×10 cells, has 7×11 codes. A stamp can lower ground as well as raise it.
- **The stamp lives in the terrain files, not the list.** The Editor applies it when the object is placed and writes the stamped vertex levels, then derives the rest from them. A map that lists objects without the stamp loads with the models drawn but the ground untouched, and saving it doesn't apply them either. So the compiler stamps the levels itself (`packages/core/src/terrain/terrain-objects.ts`), over the levels the zones and ramps give.
- **Derived data.** Cells under the stamp are flagged 3 in `t3CellFlags` and their cliff cells `f=12` (above). Sync cliff levels under a stamp don't follow the vertices: the Editor's deck on a bridge is 4 cells wide, which the highest vertex of each cell reproduces, but it also widens diagonally at each end (8 cells per bridge), apparently following the model. We don't reproduce the flares.
- A row runs west to east: the Editor's Castanar Bridge Diagonal (asymmetric) matches at all 195 vertices read that way (fixture `row-direction/`, 2026-10-28).

- **Stamps snap to the cliff grid.** Every Editor placement so far puts the stamp's edges on even vertices. Off the grid, cliff cells lie half under the stamp and draw cliff meshes through the object (seen as holes beside both bridges, 2026-10-28).

Use: bridges, pits and other built ground pieces, through the blueprint's `terrainObjects`. The compiler refuses an off-grid centre, and warns when a corner on a stamp's edge doesn't meet the ground around it. Both bridges in the fixture span a chasm two cells wider than they are, so their stamps fill one end.

## Open questions the docs flag

- The sync height map header fields are "unknown", and the doc's v ≥ 102 body layout contradicts Editor bytes (Part 2).
- Earlier render readers "presumably assert internally". Behaviour on a missing file isn't stated.
- `cc f` bit 2's ring around terrain objects: what it does, and how its size follows the model.
- The ramp validity check's second `< 16` probably meant `hi`. (Its `dir == 0` rule doesn't hold in practice; see Part 2.)
- Painted-layer lookup tables, and the four-sub-cell walk over two bytes per cell.
- t3VertCol field meanings ("color/weight", "blend layer").
- t3HardTile: tile field count (14 vs 16), the six geometry fields and the group string encoding.
- t3Water: string sizes, body-level parameter layout, the meaning of most wave fields.
- The t3SyncCliffLevel char-count note in its static init ("len/4? see note") is unresolved; it doesn't affect the file.

## Applying this to sc2-adjutant

1. **Ramp `dir` 0 — done.** Checked in the Editor on 2026-10-25: our numbering is right (see Part 2).
2. **Golden-test the sync files.** Add Editor-saved `t3SyncHeightMap`, `t3SyncTextureInfo` and `t3TextureMasks` to `packages/core/tests/fixtures/editor-terrain/` (copy them from `cliffs-and-doodads.SC2Map` before that folder goes) and compare them with our writers. Keep the interleaved sync-height layout.
3. **Fix the `t3CellFlags` comment.** The header is 24 bytes; width and height begin the body. Bytes don't change.
4. **Write the Editor's empty files.** `t3FluffDoodad` (DLFT v103, 28 B) and `t3HardTile` (HRDT v102, 28 B), so our packages match the Editor's file set. No ComponentList change. Optional: maps load without them.
5. **Guard map sizes.** Reject widths/heights that aren't multiples of 8, or that exceed 256, in the blueprint schema before trying sizes other than 128.
6. **Painted pathing.** Decoded as `CellAttribute_Pnp`. The compile paints it under dug pools, and the pathing brushes paint Kept ground (Part 2). Still open: painting it from zone tags (map edge, path, no-dressing), and having the doodad placer read the same mask.
7. **Water and vertex colour.** Do these only after a one-feature Editor sample of each. Use the single-variable bisection workflow in [debugging-the-editor.md](./debugging-the-editor.md) to check the Editor accepts the result, then Test Document.
8. **Quantize range.** Our fixed 9.0 / 2.746134e-4 covers ±9 per channel. If blueprints get taller terrain, compute bias and scale from the height range as the Editor does. The Kept-ground brushes already widen it when an edit needs more (see "Editing heights on Kept ground").
