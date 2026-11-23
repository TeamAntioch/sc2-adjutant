# Map package findings

What we found, by building maps and opening them in the Editor and the game (Editor 5.0.16 build 97671, game 5.0.17), about the files a map package needs and how the Editor and game read them. The writers named here are in `packages/core/src/`. Each finding is ours unless it says where it came from. Where another reference doc disagrees with one, this doc wins.

## Map packages

Maps are unpacked directories (`.SC2Map`, `.SC2Mod`). A working minimal map holds `ComponentList.SC2Components`, `DocumentInfo`, `MapInfo`, `t3Terrain.xml`, `t3HeightMap`, `t3SyncHeightMap`, `t3SyncCliffLevel`, `t3TextureMasks`, `t3SyncTextureInfo`, `t3CellFlags` and `t3Water`. `Objects`, `Regions`, `Triggers`, `GameData`, `GameStrings.txt`, `ObjectStrings.txt`, `ConversationData.xml` and the rest are optional. `Objects` and `Regions` are listed in `ComponentList.SC2Components` as `plob` and `regi`.

- **Component `.version` files.** Every data component needs a 44-byte `<component>.version` file beside it (`Objects.version`, `t3Terrain.version`, ...). Without one the Editor logs `Unable to load '<component>'` and silently drops that component, which is why placed units were once invisible. Written by `map/write-component-version.ts` (build 98310 / Editor 5.0.17 values).
- **MapInfo** (version 39) is written field by field from `sc2-ida-mcp-setup`'s `docs/file-format/mapinfo.md` (`terrain/write-map-info.ts`).
  - The first 8 bytes after the version are an **integrity hash** the game recomputes on load and rejects on mismatch: `len(description) + 7·h + 2·(dx² + dy²) + 3·w − popcount(gameOptionsFlags) − 17`, where dx and dy span the playable bounds and the description is the tileset id. A writer that hard-codes the hash is right for one tileset-id length only: maps on an 11-character tileset id (`MeinhoffEx1`) were refused by Test Document ("cannot open map") while the Editor opened them. The Editor doesn't check the hash, so always Test Document a new tileset or map size.
  - Player records are `{slot u8, controller i32 (1 User / 2 Computer / 3 Neutral / 4 Hostile), team i32, aiName, color i32, startLocation i32, resourceFlags u32, aiPersonality}`. We write slots `0` (Neutral), `1` (User, team −1) and `15` (Hostile), and declare every other player who owns a unit as a computer player.
  - Checked 2026-10-25: parsing nine generated maps with this layout reproduced each stored hash exactly.
- **DocumentInfo** declares dependencies. Default: `bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod`. A Campaign Mod's units need a `file:Mods\\<Name>.SC2Mod` dependency, which resolves through a symlink in the game's `Mods/` folder.
- **DocumentHeader.** The game client (Editor Test Document) refuses a map with no binary `DocumentHeader`, though the Editor opens it fine. Layout: `H2CS`, version 8, `2S\0\0`, `01 05 00 11` (5.0.17), the build twice, 0, a per-document u32 twice, 1, 0, the dependency count and NUL-terminated dependency paths, then the attribute count and (u16-length key, `SUne`, u16-length value) pairs. Written by `map/write-document-header.ts`, golden-tested against an Editor-saved header.
- **Objects ids** are read as signed 32-bit: anything above `0x7fffffff` breaks the file. We derive 31-bit FNV-1a ids from Anchor slugs (`map/stable-object-id.ts`) and check for collisions at generation time.
- **Unit `Position` Z** is an offset above the terrain. Editor-saved maps always use `0`.
- **Doodads** are `ObjectDoodad` entries in Objects only (no terrain-file changes), with z the absolute terrain height.
- **Minimap.tga** (not a component) is what the game draws as the minimap; without it the minimap is black. The Editor writes it as uncompressed 24-bit BGR, top-left origin, 1 px per cell, black outside the camera bounds.
- **Catalog overrides** in a map's own `Base.SC2Data/GameData/` work in game: a partial `<CTerrain id="<tileset>"><Lighting value="…"/></CTerrain>` or `<BlendTextures index=… value=…/>` override, a full copy of a stock Light with changes in `LightData.xml`, and a map-local `CEffectDamage` in `EffectData.xml`.

### Reference maps

When the Editor rejects something, a small Editor-saved map with the feature working is the thing to compare against ([debugging-the-editor.md](./debugging-the-editor.md)). The ones we kept were 128×128, saved by Editor 5.0.17: one on the Void campaign dependency with BelShirEx2 and two Marines, and one with a Campaign Mod dependency. Keep them git-ignored under a Mission's `output/` in the Workspace, and copy them before relying on them.

## Terrain

The formats are in [terrain-file-formats.md](./terrain-file-formats.md). What our writers rely on:

- Terrain binaries are uncompressed fixed-header grids and can be generated directly.
- `t3HeightMap` stores two channels per vertex (base and cliff): visible height = `(r0·scale − bias) + (r1·scale − bias)`, with bias and scale from `t3Terrain.xml`'s `vertData`. `r2` is the vertex cliff level.
- Ordinary ground is cliff level 1 at height 8, cell flag `0x02`. Cliff level 0 is chasm or void, and the Editor won't place units on it.
- `cliffCellList` is indexed per 2×2 cells (`num = (w/2)·(h/2)`). A wrong grid size, or marking every zone-boundary cell, makes the Editor reject `t3Terrain.xml`. Cliff sets are real catalog entries (`BelShirEx1Cliff0`).
- **Cliffs** (`terrain/cliffs.ts`, golden-tested against an Editor-saved map): the source of truth is the cliff level at even-coordinate corner vertices. Editor "cliff height N" is internal N+1. A vertex's level r2 is derived (an edge midpoint takes the max of its corners; a centre is high if any side has both corners high), r1 is the cliff height of r2, each 2×2 cliff cell whose corners differ gets `<cc f="1" cid="0" cvar=0..3>`, cells under cliff cells get flag 0x03, and the sync cliff level is the level held by at least 3 of a cell's vertices, else the minimum.
- **Ramps** (`terrain/ramps.ts`): a straight ramp is a 2×4 cliff-cell stamp on the low side of the edge, exactly as the Editor writes its default straight ramp (r2 unchanged, r1 from a fixed rise table, `cc f=2`, flags 0x03 on the two outer rows each side, sync +8/+24/+40) plus a `<rampList>` element. Ramp `dir` is 0 uphill-south, 1 north, 2 west, 3 east, 4 south-west, 5 south-east, 6 north-west, 7 north-east. On 2026-10-25 the Editor wrote 0 and 2 for its own south and west ramps and kept generated ramps through a save, so `sc2-ida-mcp-setup`'s claim that the reader drops `dir` 0 is wrong for 5.0.17. A ramp climbs exactly one Editor level. The Editor's wide diagonal ramp blends into the cliffs either side, so its values hold only for that shape.
- **The Editor rewrites only the terrain components you edit**, so "open and Save As" doesn't validate generated terrain. Ask the author to edit the area instead.
- **The tileset named in MapInfo controls lighting**, not the terrain file's tileset name. With one Campaign Mod's dependency, `BelShirEx1` rendered washed out (white streaks) where `BelShirEx2`, the Editor's own Bel'Shir choice, was fine. Test a new tileset against your Campaign Mod.
- **A map's `t3Terrain.xml` texture list overrides the tileset's in game, but the Editor shows the tileset's own textures**, so a texture change belongs in a `BlendTextures` override too. The `tilesets` of `packages/core/data/texture-extracted.json` therefore hold each tileset's real `BlendTextures`.
- **Lighting.** The tileset picks the default Light (the CLight with the tileset's id, or its `Lighting`), and triggers switch Light with `GameSetLighting` (blend seconds). The tileset sets the default fog, and `FogSetEnabled`, `FogSetDensity`, `FogSetColor`, `FogSetStartHeight`, `FogSetFallOff` and their `…OverTime` forms change it in game (BelShirEx2, 5.0.17), subtly from the gameplay camera.
- **Painted no-pathing** (`CellAttribute_Pnp`): 4 header bytes `00 00 02 00`, then a byte per cell from the bottom row, 255 for a whole cell. Each cell is 2 × 4 sub-cells, bit `(row < 2 ? 4 : 0) + 2·column + row % 2` with row 0 at the bottom. The Editor writes CellAttribute files only once painted and doesn't list them in ComponentList.
- **t3Water**: header `WATR`, 110, the count, zeros to 32 bytes; per pool a 40-byte null-padded CWater id and float32 x0, y0, x1, y1 (golden-tested against an Editor-saved area). `WaterSetState("<CWater>|<state>", seconds, c_wtcLinear)` raises and drains a pool (verified in game 2026-10-27).
- **Terrain objects** (`terrain/terrain-objects.ts`): the Editor doesn't apply a listed `<cliffDoodad>`'s height-code stamp on load, so the writer stamps the cliff levels itself. Stamp edges must sit on even vertices: off-grid, cliff meshes show through the object as holes (2026-10-28). Stamp rows run west to east.
- **Two levels apart.** The game draws a cliff one level high. Where neighbouring cells (diagonals too) differ by two levels or more, it draws a black square (seen in game 2026-11-11).
- `Regions` written from Zone polygons are rectangular bounding boxes. The reader handles rect, circle and diamond shapes.

## Triggers

How triggers are written is in [galaxy-natives.md](./galaxy-natives.md) and [editor-trigger-rules.md](./editor-trigger-rules.md). The findings behind them:

- `compile-map` writes GUI triggers: `Triggers` XML, the matching `MapScript.galaxy`, `GameStrings.txt` (DocInfo and `Param/Value/<id>` text) and `TriggerStrings.txt`. The writers reproduce two Editor-saved maps byte for byte (`packages/core/tests/fixtures/editor-triggers`). Files are CRLF, `.txt` files start with a BOM, and `Triggers` has no trailing newline.
- Every native function, parameter and preset is an opaque Ntve id (`triggers/trigger-catalog.ts`). The definitions are inside CASC, so ids come from Editor-saved maps or from [SC2Mapster/SC2GameData](https://github.com/SC2Mapster/SC2GameData) (`mods/core.sc2mod/base.sc2data/TriggerLibs/NativeLib.TriggerLib` with `enus.sc2data/LocalizedData/TriggerStrings.txt`; campaign libraries under `campaigns/voidstory.sc2campaign/base.sc2data/TriggerLibs/`). It mirrors patch 5.0.3, but every id we've checked matches 5.0.17. Look an id up there before asking for a reference map. A Campaign Mod's own library definitions are readable in its unpacked `Triggers`.
- XML parameter order is definition order. The Galaxy argument order can differ, and each `FunctionDef.galaxy` renders it.
- "Send Transmission For Player" (`Ntve` 00B542C6, `TransmissionSendForPlayerSelect`) is what generated Missions call: Unit Transmission Source (flash, no portrait override, "Talk"), Cinematic Portrait centre-left, the line's sound, wait. VCMI's "Send Transmission (Campaign)" is a placeholder that prefixes "[PH] " to every message. A library transmission that starts a talking-portrait transmission on another thread cut back-to-back lines' audio off even with explicit waits, so we don't use one.
- Player Property Changes (`B83E0A67`, MineralsCollected/VespeneCollected) with `PlayerGetPropertyInt >= n` (`00000051`, presets `FBC23176`/`3671A90E`, `>=` `B128CB9A`) counts collected resources (verified in Test Document 2026-10-25).
- Unit Enters Region's region `ValueId` is the region's index + 1. An `abilcmd` value's `ValueTypeInfo` is 1 for a unit target and 2 for a point.
- If Then Else and Pick Each blocks are written as `SubFunctionType` in XML and `auto<id>_g/_u/_var` in Galaxy, as the Editor saves them.
- Unit-attached effect actors inherit their host's visibility: `FogVisibility Hidden` kept a dome created under fog hidden after the fog lifted.
- A data effect such as a map-local `CEffectDamage` (Spell, armor ignored, shields absorb) applied by "Create Effect On Unit (From Player)" (`PlayerCreateEffectUnit`) works in game. An outcome caused by a unit dying should wait a few seconds before `GameOver`, so the death plays.
- `TechTreeRestrictionsEnable(p, true)` must come before a player's allows. Untested in game: whether a disallow does anything while restrictions are off (the Editor's hint says not).

## Logs and testing

[game-testing.md](./game-testing.md) has the launch switches, SC2API and the plan for `validate-map`. The log lines to look for:

- `Unable to load '<component>'` in the Editor log: a component it dropped, usually for a missing `.version` file.
- `Script compile error:`, `Script load failed:` and `Trigger Error in ... Near line` in the game's logs, from `erivgout/sc2-map-editor-mcp`'s matcher (`packages/sc2-core/src/editor/runtime.ts`). Not yet seen here.
- A checker should report each check as passed, failed, skipped or unsupported, so a machine without the game skips the game stage instead of failing it.

## Caveats

- Only 128×128 is verified in the Editor. MapInfo no longer pins the size, but the other writers haven't been tried at other sizes.
- Verified 2026-10-24: compiled maps open in the Editor (on Apple Silicon, through the fix shim in [macos-host.md](../../packages/plugin-host-macos/docs/macos-host.md)); with `.version` files present placed units render and the `Unable to load` warnings go; units can be placed by hand on generated terrain; and a Campaign Mod's custom unit resolves by name with its dependency.
- We write no `t3VertCol`, `t3HardTile` or `t3FluffDoodad`, and our maps still open in the Editor and run under Test Document.

## Tools evaluated

Evaluated 2026-10-25. [related-repos.md](./related-repos.md) lists every external repo and what to use it for.

- **`erivgout/sc2-map-editor-mcp`** (MIT; a Windows-centred MCP server for editing existing maps). Not adopted. Worth borrowing: its StormLib MPQ pack settings (`native/sc2mpq/src/commands.cpp` `pack`: MPQ v1, zlib, a regenerated `(listfile)`, backslash paths) for campaign packaging, and its game-log patterns and passed/skipped/unsupported model (above). Don't copy its cliff encoding (16 per level; Editor 5.0.17 writes 64).
- **`sc2-arcade-watcher/sc2-file-format-docs`**: read it first for binary formats (cliffs, doodads).
- **`sc2-arcade-watcher/sc2-ida-mcp-setup`**: reverse-engineering notes on the Windows game client, build 96921 (5.0.15). File formats, cvar names and error strings carry over to the Mac build; addresses don't. What we use from it is written up in [game-testing.md](./game-testing.md), [galaxy-natives.md](./galaxy-natives.md), [terrain-file-formats.md](./terrain-file-formats.md) and [data-loading-and-dependencies.md](./data-loading-and-dependencies.md).
- **Sound preview outside the Editor** (an idea, not built): extract a sound's files from the game's CASC storage (for example with CascLib) so it can be auditioned without hunting for it in Data → Sounds.
