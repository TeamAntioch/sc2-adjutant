# Editor load and save findings

Three claims about what the Editor does when it opens and saves a Map Package, from another project's notes (see `related-repos.md`, issue #744, part of #735). Each bears on our phantom-edit handling: a compile fingerprints what it wrote, and an Editor save that rewrites files nobody edited makes the next compile see "changes" the author never made (ADR-0010, `packages/core/src/map/editor-changes.ts`). Only the tickets' statement of the claims was used; none of that project's code or text.

**Status: three save runs so far (an unchanged save, a place-a-unit-and-a-doodad save and a delete, all 2026-11-21; see [Results](#results)). The first claim is confirmed for what the Editor writes; the second and the locale claim were not reproduced on this map.** Each is an experiment on the author's Editor, which this work did not run. What exists is a tool that reads the result, so the experiment is one save and one command.

## The three claims

| Claim | What would confirm it | What we know without the Editor | Status |
|---|---|---|---|
| `Preload.xml` needs an entry per placed unit and doodad | After the Editor saves a map with a new unit type and a new doodad type placed, `Preload.xml` gains an `<Unit>` and an `<Actor>` for them; and a map missing an entry misbehaves (a load stall or a pop-in) | `data-loading-and-dependencies.md` finds the game reads `Preload.xml` as a loading-time streaming hint and nothing gates a load on it, so "needs" is probably "the Editor writes". The Editor-written files seen on disk name every placed unit type and doodad type (as `<Unit id>` and `<Actor id>`); we write none. | Confirmed 2026-11-21 for what the Editor writes: a save adds an `<Unit id>` for each placed unit type and an `<Actor id>` for each placed doodad type (see Results). Needs an in-game check: whether a missing entry does anything. |
| A save after a delete changed four untouched Objects nodes | Delete one object, save, and `compare-saves --touched <that id>` lists changed elements other than the one deleted | Our compile record already ignores formatting and attribute order when it compares an object (`canonicalXml`), so only a change of value would show as a phantom edit. ADR-0010 records that an Editor open-and-save re-lays files out. | Not reproduced 2026-11-21 on one small generated map (see Results): deleting one unit changed no other object beyond a dropped default. Not ruled out for a bigger or Editor-built map. |
| Saving in one locale dropped another locale's strings | With a package holding two locale folders, save in the Editor under one locale and compare: the other locale's `GameStrings.txt` has fewer keys | We write only `enUS.SC2Data`; `import-map` reads every locale folder it finds. A drop matters to us only for a Kept package a translator also edits. | Not reproduced on one small map (2026-11-21, see [Results](#saved-in-german-with-a-second-locale-folder-2026-11-21-editor-version-not-recorded)): no keys dropped. Untried: a real translator's file with keys `enUS` lacks. |

**An assumption in the Preload check, needs an Editor check:** the tool takes a placed doodad's `Type` to be the `<Actor id>` in `Preload.xml`, and a placed unit's `UnitType` to be the `<Unit id>`. That matches the Editor-written files read here (every placed type had an entry of that form) but is not confirmed as the Editor's rule; the report says so each time.

## How to run the experiment

For each claim, on a throwaway copy under a Mission's git-ignored `output/` (never the author's own map, and not while the map is open elsewhere):

1. Copy the package folder to `before/`. Open the original in the Editor, make the one edit the claim is about (place a unit and a doodad; delete one object; or switch the Editor's locale and save), save, close.
2. `npm run compare-saves -- <before> <after> --touched <ids of the objects you edited>`; add `--json` for the raw result.
3. Read the three sections of its report: **Objects** (added, removed, changed, and with `--touched` the changes nobody made: phantom edits), **Preload.xml** (placed types with no entry before and after the save, entries the save added or dropped), **Localized strings** (per locale, keys dropped, added and rewritten).

Write each answer back here, in the Status column, with the date and the Editor version, and for a confirmed phantom-edit change add it to what `editor-changes.ts` does not compare, with a test.

The comparison lives in `packages/core/src/map/save-comparison.ts` and is tested on synthetic packages (`save-comparison.test.ts`), not on an Editor save.

## Results

### Unchanged save, 2026-11-21 (Editor version not recorded)

A generated mission map (`trigger-test`, two placed units, no doodads), compiled to a throwaway folder, opened in the Editor by double-clicking its `ComponentList.SC2Components`, saved with ⌘S with no edit, and quit. `compare-saves` on the package before and after, plus a plain file-by-file comparison:

- **Objects:** 4 unchanged, 0 changed, 0 added, 0 removed. No phantom edits.
- **Files left byte-identical:** `Triggers`, `MapScript.galaxy`, `Objects`, `Regions`, `MapInfo`, `DocumentInfo`, `t3Terrain.xml`, `t3HeightMap`, and the other terrain files, strings and `.version` files.
- **Files the Editor rewrote:** `ComponentList.SC2Components` (it added a `GameData` component, dropped `<Optimized/>`, re-indented) and `DocumentHeader`.
- **Files the Editor added:** `Preload.xml`, `PreloadAssetDB.txt` (empty), `BankList.xml` and `GameData.version`.
- **`Preload.xml`:** it now names the two placed unit types (`Unit:<hero>`, the Campaign Mod's hero, and `Unit:Zealot`), plus `Actor:SYSTEM_ActorConfig` and `Terrain:BelShirEx2`. Doodads were not placed, so the `<Actor id>` rule for doodads is untested.
- **Strings:** `enUS` 13 keys before and after, nothing dropped.

**What it means for evidence coverage (#748):** coverage fingerprints every file in the Map Package except `Assets/` and `Minimap.tga`. The Editor rewrote two of them, `ComponentList.SC2Components` and `DocumentHeader`, with no edit, so an open-and-save would show every Stage sign-off and `capture_shots` capture as stale. Not yet changed in code.

### Placed a unit and a doodad, 2026-11-21 (Editor version not recorded)

The same generated map, with one new unit type (`Raynor01`) and one doodad (a Campaign Mod's fan, `<fan>` below) placed and saved:

- **Objects:** 2 added (the doodad and the unit, each with a `ForcePlacement` flag), the other 4 untouched. The untouched hero lost its `Rotation="0"` attribute, which the Editor leaves out at its default. The compile already ignores that (`editorObjectForm`), so it is not a phantom edit; `compare-saves` called it one until it learned the same rule (#811).
- **`Preload.xml`:** `Unit:Raynor01` and `Actor:<fan>` were added along with the earlier entries. This confirms the first claim for what the Editor writes, and that the placed doodad's `Type` is its `<Actor id>`. Whether a missing entry does anything in the game is untried.
- **Other files:** besides the two files the earlier save rewrote, `MapInfo`, `MapInfo.version`, `Objects.version` and `Minimap.tga` changed. `MapInfo` is binary and was not read, and the compile treats it as derived.
- **Strings:** unchanged.

### Deleted one object, 2026-11-21 (Editor version not recorded)

The same generated map, with an unreferenced Zealot added by hand to both copies (every unit the map had was named by a trigger, and the Editor refuses to delete one without saying so), then deleted in the Editor and saved:

- **Objects:** 1 removed (the Zealot), 3 unchanged. The untouched hero lost its default `Rotation="0"`, as in the placement save; the compile ignores it. No other object changed, so the claim that a delete changed four untouched Objects nodes was **not reproduced** here.
- **Files:** `Triggers`, `MapScript.galaxy` and the terrain files stayed byte-identical. The Editor rewrote the component list and document header and added the four files seen before, and changed the minimap and `Objects.version`.
- **Preload.xml:** the placed types, `Unit:<hero>` and `Unit:Zealot`, were named after the save.
- **What this does not cover:** a delete of an object a trigger names. The Editor warns first, and what it then does to `Triggers` and `MapScript.galaxy` was not tried.

### Saved in German with a second locale folder, 2026-11-21 (Editor version not recorded)

The same generated map, with a hand-made `deDE.SC2Data` (the 13 `enUS` keys, each text prefixed `[DE] `) and a `deDE` line in `ComponentList.SC2Components`. Opened in the Editor with its locale set to German (the window titles were German), one Zealot moved, saved:

- **Strings:** `deDE` 13 keys before and 13 after, `enUS` 13 and 13. Nothing dropped, added or rewritten, and neither locale's string file was touched. So the claim that a save in one locale dropped another locale's strings was **not reproduced** here.
- **Component list:** the Editor rewrote it and kept both `enUS` and `deDE` lines.
- **Other files:** as in the earlier saves: `Preload.xml`, `BankList.xml`, `GameData.version` and `PreloadAssetDB.txt` added, `DocumentHeader`, `Objects` and the minimap rewritten, and the untouched object re-laid out only.
- **What this does not cover:** a real translator's file, in particular keys that `enUS` lacks (where a drop would show first), more than two locales, and a save made under the other locale's Editor setting than the one the map was authored in. A first attempt saved an untitled map by mistake and wrote nothing here; it is not counted.
