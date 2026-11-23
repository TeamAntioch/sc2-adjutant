# The Campaign Mod's doodad index

A Workspace describes and pictures its Campaign Mod's doodads to the same standard as core's doodad catalog (the descriptions `@team-antioch/sc2-asset-catalog` publishes, joined to `packages/core/data/doodad-extracted.json`, [ADR-0022](../adr/0022-open-source-doodad-finder-as-sc2-asset-catalog.md)), so they are searched, pictured and dressed with like the game's ([ADR-0017](../adr/0017-mod-doodad-index-in-the-workspace.md)). Nothing in it is specific to one Campaign.

## What it covers and where it lives

- **Covers:** the Campaign Mod's non-template `CActorDoodad`s. A game doodad the mod redefines is covered only when the mod changes its model. A doodad-typed `CModel` with no actor isn't a doodad anyone can place, and the doodads a Mission's own data defines aren't covered either.
- **The index:** `mods/<id>/doodad-catalog.json`, beside the Mod Blueprint, committed. The catalog layer reads it. `getDoodadDescription` (and with it the dressing rules' `role` and `size`), `asset_catalog` and Doodad Search (`search_doodads`, the search page) read the mod's entry wherever the index covers a doodad. An entry left for a doodad the index no longer covers is ignored. `add_doodad_note` writes a mod doodad's Doodad Uses into its entry's `description.uses`, as the records core keeps (a plain string from an older index reads as one; see [campaign-catalog.md](campaign-catalog.md#doodad-uses)), and `contribute_doodad_notes` never offers them to core.
- **Pictures:** `mods/<id>/catalog-sheets/doodads/<id>.jpg` when the model file comes from one of the Workspace's own mod packages. These are the author's art, and they're committed. `mods/<id>/catalog-sheets/game-models/<id>.jpg` when the model is a game file. These are rendered game assets, so they're git-ignored, as are the raw renders in `mods/<id>/thumbnails/`. Each git-ignored folder carries its own `.gitignore`.

## An entry

```json
"HarbourFan": {
  "name": "(Harbour) Fan",
  "categories": "DoodadType:Environment",
  "model": "Assets/Doodads(Custom)/Fan/HarbourFan.m3",
  "modelHash": "pkg:48212:3f0c…",
  "bounds": [1.4, 1.4, 1.1],
  "sheet": "catalog-sheets/doodads/HarbourFan.jpg",
  "described": "agent",
  "description": { "look": "a squat industrial fan in a square steel housing, blades behind a grille", "kind": "built", "size": "small", "role": "prop", "story": ["industry"], "biome": ["any"] }
}
```

- `model`: the storage path, resolved through the actor's `Model` (or its parent actor's, or the actor's id) and the `CModel` chain. `modelHash` is `pkg:<size>:<sha1>` of the file when a Workspace package holds it, else `game:<path>`. The entry is stale when the file's size differs from the recorded one, or the doodad names another game model. Only the size is compared, so `check` reads no model file. An edit that keeps a file exactly the same size goes unnoticed: `index-mod-doodads --only <id> --force` re-renders it.
- `bounds`: width, depth and height in game units, from the model's MODL record. That's the box the game culls the model by, so it is often loose, especially for effects.
- `unpictured`: the model has no file to draw, such as `Invisible`. It isn't tried again. `renderError`: the last render failed, and the next run tries again.
- `described`: `agent` or `author`. An entry is **pending** when it has no description, or no `described` for its current model.

## Building it

1. Run `index-mod-doodads`: the MCP tool `index_mod_doodads`, or `npm run index-mod-doodads -- [<workspace>] [--only <id>,…] [--force]`. It needs a Host Adapter with `model.render`, plus ImageMagick's `montage` for the sheets. It renders doodads that are new, whose model changed, whose last render failed, or whose sheet isn't on this machine. It writes their entries and drops entries for doodads the mod no longer covers. It lists the pending entries.
2. Describe each pending entry. Read its sheet (`asset_catalog` gives the absolute path) and write `description` in core's words, the ones the exemplar-design skill's DRESSING.md "Finding doodads" lists:
   - `look`: what it looks like, in a phrase someone could search for. Say what it would read as on a map.
   - `kind`: `natural`, `built` or `creature`.
   - `size`, against a Marine: judge it from the sheet. `bounds` helps, since its largest side roughly runs: tiny under 0.6, small 0.6–2.5, medium 2.5–8, large 8–15, huge above that. These were calibrated on core's rendered doodads, whose bounds vary a lot.
   - `role`: `cliff`, `structure`, `prop`, `clutter`, `foliage`, `decal` or `effect`.
   - `story` tags (battle, wreckage, ruin, abandoned, camp, mining, industry, lab, temple, city, military, crash and so on), and `biome`. Add `state` (destroyed, abandoned) only when the name says it and the picture shows the intact model.

   Then set `"described": "agent"`. Describe an unpictured doodad from its data instead: its `name`, `categories` and `model`, for example "invisible column that blocks line of sight". A helper is something a search should still find.
3. Run `check`. It warns, without failing, about doodads the index lacks and entries that are pending, stale or gone.

**The author's word stands.** When the author corrects a description, set `"described": "author"`. A rebuild never changes it. When an agent-described doodad's model changes, its words are kept but `described` is removed, so it becomes pending again. Rewrite its `look` and `size` from the new sheet. Doodad Uses (`description.uses`) always survive.
