# Vertical Slice 1: First Playable Mission

## Goal

Compile a `Mission Blueprint` into an unpacked `.SC2Map` `Map Package` that opens in `StarCraft II Editor (Fixed)` and supports a basic playable loop, establishing the end-to-end pipeline and round-trip sync.

## Scope

### 1. `Mission Blueprint` JSON/YAML Input
- A strict schema (Zod) for `Zones`, `Anchors`, `Placements`, `Beats`, `Objectives`, `Mechanics`, and a Markdown `Screenplay`.
- A sample blueprint: `<workspace>/missions/<id>/blueprint.json`.

### 2. SVG 2D Layout Preview
- Render an annotated SVG from the `Mission Blueprint` showing `Zones` (colored by elevation), `Connections` (ramps/chokes), and `Anchors` (icons/labels).
- Output: `<workspace>/missions/<id>/preview.svg`.

### 3. Terrain & `MapInfo` Generator
- Generate `t3Terrain.xml`, `t3HeightMap`, `t3SyncHeightMap`, `t3SyncCliffLevel`, `t3TextureMasks`, `t3SyncTextureInfo`, `t3CellFlags`, `t3Water`, and `MapInfo`.
- Input: `Zones` (polygons, elevations, connections), `mapSize`, and `tilesetId`.
- Rasterize `Zone` polygons onto the `2×2` cliff grid, carve ramps, and paint texture weights.

### 4. `Objects`, `Regions`, & `Triggers` XML
- **`Objects`**: Emit `ObjectUnit`, `ObjectDoodad`, `ObjectPoint`, and `ObjectCamera` with stable `id`s derived from `Anchors`.
- **`Regions`**: Emit `<region>` entries for each `Zone` (matching the rasterized bounds).
- **`Triggers`**: Emit a minimal `<TriggerData>` tree with:
  - `Initialization` (setup units, cameras, objectives)
  - `Mechanics` (a `Solar Flare` timer that damages units outside `Shadow` zones)
  - `Transmissions` (binding `Screenplay` lines to a Campaign library's transmission function or `TransmissionSendForPlayerSelect`)
  - `In-Game Cutscene` (a `Start`/`Skip`/`Cleanup` trigger triad)

### 5. Localized Strings & TTS Audio
- **`GameStrings.txt`**: Map info, player names, objective text, and trigger strings.
- **`ConversationStrings.txt`**: Character names, conversation group names, and dialogue lines.
- **TTS `.ogg` Pipeline**: Generate `.ogg` files for each `Screenplay` line using a character-to-TTS-voice dictionary, so transmissions have valid audio lengths before voice recording.

### 6. Round-Trip Sync Stub
- **`import` command**: Read `Objects` and `Regions` from an existing `Map Package` and update `Anchor` positions in the `Mission Blueprint`.
- **Terrain Locking**: Allow locking the terrain layer in the `Mission Blueprint` so recompilation preserves manual Editor edits.

## Out of Scope (Vertical Slice 1)
- Procedural `Placements` (resource bases, enemy squads, doodad dressing) — `Anchors` only.
- Full `Asset Catalog` indexing — use hardcoded tilesets/cliffs/doodads for the first mission.
- `.SC2Cutscene` timeline files — only trigger-driven In-Game Cutscenes.
- Advanced `Mechanic` types beyond the solar flare timer.
- Campaign Mod authoring — read-only dependency on the Campaign's existing Campaign Mod.

## Success Criteria
1. `npm run build` produces a CLI binary.
2. `sc2-adjutant compile <workspace>/missions/<id>/blueprint.json` generates `<workspace>/missions/<id>/output/<id>.SC2Map/` containing all required component files.
3. Opening the generated `Map Package` in `StarCraft II Editor (Fixed)` shows terrain, placed units, regions, and triggers without errors.
4. Running "Test Document" launches SC2 and plays the mission with working objectives, transmissions (with TTS audio), and the solar flare mechanic.
5. Moving an `Anchor` in the Editor and running `sc2-adjutant sync <workspace>/missions/<id>/blueprint.json <workspace>/missions/<id>/output/<id>.SC2Map/` updates the `Mission Blueprint` with the new coordinates.
