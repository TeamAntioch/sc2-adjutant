---
name: custom-doodads
description: Makes a custom .m3 model a doodad maps can place and the Editor's doodad palette lists, by declaring it in a Blueprint's doodads so the compile writes and checks its files, CModel and CActorDoodad. Use when the author has a new model (exported from Blender, or a community asset) to place as a doodad, when a placed model shows as a placeholder ("Invalid placed doodad"), or when a model is missing from the doodad palette.
---

A doodad type is a `CActorDoodad` id. The actor draws the `CModel` of its own id, and the `CModel` names the `.m3` file, whose material layers name their textures by storage path (`Assets/Textures/Ring_Diff.dds`). Every piece must be there. A `CModel` with no actor is the usual miss: the Editor logs `Invalid placed doodad '<id>' … A placeholder model will be used` and leaves it out of the palette.

A model that only needs other textures (a recoloured stock doodad, a community texture pack) needs no new `.m3`: it's a texture swap, a doodad with `swaps` (step 3). With `gameModel` it draws the game's own `.m3`, so a recoloured stock doodad ships only its new textures. In a Mission or the Campaign Mod, the compile writes the model's slot declaration, a `CTexture` per swap and the actor's events, and checks them against the model, since a swap whose pieces don't match fails silently in the game. sc2-adjutant's `docs/reference/texture-swaps.md` explains the three pieces. A swap `swaps` can't express (a random pick with `TextureSelectBySlot`, one a trigger or a behaviour sends, a texture group) is written by hand: the declaration in `fields.model`, the event in `fields.actor`, and each `CTexture` a Generic Entry in the Campaign Mod (in a Mission, an entry in the map's own `TextureData.xml`). Nothing checks a hand-written swap.

A Blueprint's `doodads` declare all of it at once. The compile writes the `CModel` and the `CActorDoodad`. It refuses a doodad whose model or texture isn't among the files the map loads (unless `gameTextures` lists the texture as the game's), and a doodad whose id is a game doodad's or unit's. Work through the declaration; hand-written XML is the fallback at the end, for a map no Blueprint compiles.

## 1. Choose the home

| Home | When | Files | Compile |
|---|---|---|---|
| The Campaign Mod's Blueprint `doodads` | Any Mission may use it, or it's part of the Campaign's look. The default. | In the Asset Mod, declared in its `assets` | `compile_mod` on the Asset Mod, then on the Campaign Mod |
| The Mission Blueprint's `doodads` | One map uses it, or it's a test or preview copy | In the Mission's folder (`art/`), named in the declaration | `compile_map` |

Tell the author which home, and why, before writing anything.

## 2. Check the export

Find out three things about the model: the texture paths it names, whether its bounds cover its mesh, and whether it has a Stand animation. The compile in step 4 reports only problems: a texture it can't find, bounds that fall short, and a missing Stand when `animate` is set. It never lists a model's textures or animations. So ask the author which textures are the game's own and whether the model should loop an animation:

- **Textures**: each path the model names is a file you ship or one the author confirms is the game's own (`gameTextures`, step 3).
- **Bounds**: the model's bounds cover its geometry. The game culls the whole model once its bounds box leaves the screen, so a model whose bounds fall short vanishes while part of it is still in view. The compile warns about this one.
- **Stand**: a static model with no animations is a valid doodad. A model meant to loop its Stand needs a Stand animation.

This step is done when the author has answered for the textures and the animation; step 4's compile checks the bounds.

## 3. Declare it

**In the Campaign Mod.** Put the `.m3` and each texture it names in the Asset Mod's folder, and declare each in its Blueprint's `assets` as a Workspace file, at `Base.SC2Assets/` plus the path the model names it by: `{ "path": "Base.SC2Assets/Assets/Textures/Ring_Diff.dds", "source": { "file": "art/Ring_Diff.dds", "sha256": "…" } }`. A swap's new texture goes in the Asset Mod the same way (or in another mod package the Campaign Mod loads, compiled first), unless it's the game's own. A `gameModel` ships no `.m3`. Run `compile_mod` on the Asset Mod. Then add the doodad to the Campaign Mod's Blueprint `doodads`, and run `compile_mod` on it.

**In a Mission.** Put the files in the Mission's folder and add the doodad to its Blueprint's `doodads` with `patch_blueprint`, naming the model's file in `source` (none for a `gameModel`) and each texture it ships in `textures`, a swap's new texture among them. A texture needs no `textures` entry when the Map Package already holds it as Kept Content (not a copy a compile wrote), or when the Campaign Mod (or a Workspace mod it depends on) has it and the Blueprint's `dependencies` name the Campaign Mod. The compile looks in no Workspace mod the Mission doesn't depend on. The compile copies the files into the Map Package's `Assets/`, so the binaries are committed twice, in the Mission's folder and in the package. Check whether the Workspace's `.gitattributes` gives both to Git LFS, and tell the author if it doesn't.

Two Kept leftovers refuse the compile: a file at the same path with other bytes (a model imported in the Editor, then exported again), and a hand-made `CModel` or `CActorDoodad` of the doodad's id that differs from the one the compile writes. The message says "which is Kept Content". Remove the Kept copy from the package first, with the author's say-so.

| Field | Writes | Notes |
|---|---|---|
| `id` | Both entries' id: the doodad type | Letters, digits and underscores. The compile refuses a game doodad's or unit's id, since the entries would replace that doodad's, or that unit's actor and model. Don't reuse a mod's id either: a Mission doodad with a Campaign Mod doodad's id replaces it across the map, and nothing warns. |
| `model` | `CModel` `Model` | A storage path of its own, such as `Assets/Doodads(Custom)/Rings/Ring.m3`. A file at a game doodad model's path, or (in a Mission) at a path a Workspace mod it loads already holds, replaces that file for everything that draws it; the compile warns. |
| `gameModel` | Nothing | `true` when `model` is the game's own `.m3` (`Assets/Buildings/Protoss/PylonEx2/PylonEx2.m3`): no `source` and no copy, and `textures` or `gameTextures` list only swaps' `with` textures. The compile refuses a path core knows of no game model at (a CModel's file, a game doodad's or a story set's part named by file; a doodad with variations is its numbered files, `_00.m3` and on) and warns when a file the map loads is at that path. It checks no bounds and no Stand for `animate`. With `swaps`, the compile reads the game's `.m3` through the Host Adapter's `model.export`, and refuses on a machine without it. |
| `swaps` | Per swap n: a `TextureDeclares` on the `CModel` (`Prefix` the replaced file's base name, slot `swap<n>`), a `CTexture` `<id>_Swap<n>` on `with`, and `TextureSelectById <id>_Swap<n>` on `ActorCreation` and `ModelSwapped` | `[{ "replace": "<a texture the model names>", "with": "<the new texture>" }]`, one entry per texture replaced. The `CTexture`'s slot takes the component (`swap1.emissive`) of the layer the model has `replace` in, or the bare slot for any other layer, such as an environment map. A Mission's `with` is in `textures`, Kept, a Workspace mod it depends on, or `gameTextures`; a Campaign Mod's is in the Asset Mod (or another mod package it loads) or `gameTextures`, and its `CTexture`s go in the Campaign Mod's `TextureData.xml`. `docs/reference/texture-swaps.md` explains the slots. |
| `source`, `textures` | The files, at their storage paths | Mission only: the files in the Mission's folder. No `source` with `gameModel`. |
| `name` | `Actor/Name` and `Model/Name` in ObjectStrings | Campaign Mod only. A Mission's doodad shows its id. |
| `group` | `EditorCategories` `DoodadType:<group>` | The palette group: `Environment`, `Structures`, `Props` (the default), `Debris`, `Blocker`, `CliffRamps`, `TerrainObject`, `Track` |
| `tilesets` | `TexSets` | Only those tilesets' doodad lists show it; every tileset's without it |
| `footprint` | `Footprint` | A CFootprint id, for a doodad that blocks pathing |
| `scale` | `CModel` `ScaleMin`, `ScaleMax` | Every copy's size. Fix a model's size here, not copy by copy. |
| `animate` | Keeps `On` index 1, the looping Stand | A still prop without it |
| `gameTextures` | Nothing | Texture paths the model names that are the game's own. Each one is a decision: ask, never guess. |
| `fields.model`, `fields.actor` | More fields, over the ones above | Generic entry fields, such as `{ "Flags": { "index": "AdjustTerrain", "value": 1 } }`. An actor's own `On` replaces the whole list, so repeat `{ "index": 0, "removed": 1 }` and `{ "index": 1, "removed": 1 }` before an event such as `{ "Terms": "ActorCreation", "Send": "AnimPlay Preview Walk PlayForever" }`. The swaps' events go after that list, and their `TextureDeclares` after the model's own. |

## 4. Compile and read every message

A refusal names what's missing:

- **The model isn't there**: the path is wrong, or the Asset Mod hasn't been compiled since the file was added. For a Campaign Mod doodad, the Campaign Mod may not depend on that Asset Mod. Its DocumentInfo needs `file:Mods\<Asset Mod>.SC2Mod`.
- **A texture isn't there**: add the file at exactly the path the message names. For a Mission, the file may be in a Workspace mod the Mission doesn't depend on: the message lists the ones it searched. Once the author confirms a texture is the game's own, list it in `gameTextures` instead.
- **A gameModel core knows of no game model at**: the path is usually wrong. Copy it from the game's data (a stock doodad's or unit's `CModel`). If the game does have the file, core's list of game models lacks it: tell the author, who can report it on sc2-adjutant.
- **A Git LFS pointer** (a model, a texture or a swap's new texture): the file isn't pulled on this machine. Run `git lfs pull`.
- **It doesn't read as an .m3** ("so its swaps can't be checked" too): the file isn't a model, or is damaged. Export it again.
- **The id is the game's doodad or unit**: choose a new id, and change any Anchor that places it.
- **A file can't be read, or isn't in the Mission's folder** (Mission only): the `source` or `textures` path is wrong. It's relative to the Mission's folder.
- **Two doodads write one storage path from different files** (Mission only): give one of them its own path, or ship one file for both.
- **A schema problem** (`doodads.0 (Ring): …`): a `fields.model` or `fields.actor` entry names a field or value the game's data doesn't have. Fix the field it names.
- **The id is also a Composite's actor** (Mission only): rename one of the two.
- **`source` with a `gameModel`, or no `source` without one**: leave `source` out for the game's own model; give it, or set `gameModel`, otherwise.
- **"a gameModel's textures are the game's own"**: `textures` or `gameTextures` lists a texture that isn't a swap's `with`. Remove it: the game model's own textures are the game's already.
- **A swap replaces a texture its model doesn't name**: copy the path from the list the message gives.
- **A swap draws a texture that isn't there**: add the file where the message says it looked (`textures` in a Mission, the Asset Mod for the Campaign Mod), or, once the author confirms it's the game's own, list it in `gameTextures`.
- **Two swaps replace one texture, or files of one base name**: give each texture one swap. One declaration's prefix takes both files of one base name, so swap one of them.
- **A swap ships a texture its gameModel names** (Mission only): that file would replace the game's in every model of the map. Give the new texture a path of its own.
- **A gameModel's swaps without `model.export`**: this machine's Host Adapter can't read the game's model, so the slots can't be derived. Compile on a machine whose Host Adapter has it, or take the swaps out. "Couldn't be read from the game" means the export itself failed: read its message, and check the `model` path.

Act on each warning too:

- **Bounds don't cover the mesh**: export again (step 2).
- **Animated with no Stand**: leave `animate` out.
- **Unused `gameTextures`**: remove the entry.
- **A swap's prefix also takes another texture, or its texture is in more than one layer**: the swap changes each one the message lists, or may leave a layer of another component with the model's own. Tell the author, and look at it in the game.
- **A swap in the bare slot** ("which the game was seen to fill only for an environment map"): `replace` isn't in a diffuse, emissive, normal or specular layer, nor only in environment layers. Tell the author, and look at it in the game.
- **"Is a gameModel, but … is at that path too"**: a file the map loads replaces the game's model, and the swaps are checked against that file. Remove it, unless the author means to replace the model.
- **A model or file that replaces another's** ("at a game doodad's model's path", "where … is too"): give it a path of its own, unless the author means to replace it.
- **"Doodads … are the Campaign Mod's, which the map doesn't load"**: add the dependency the message names to the Blueprint's `dependencies` with `patch_blueprint`.
- **"Added dependency … for doodads …"**: the compile added a game campaign the doodads come from, but only to this compile's output. Add it to the Blueprint's `dependencies`, or the warning comes back on every compile.
- **"Objects places … which isn't a doodad type"**: a Kept copy the Editor placed whose type is a `CModel` with no actor. Declare that type in `doodads`.
- **"Objects places … a doodad type that isn't in core's catalog"**: a Kept copy whose type nothing core reads defines. It may be a game doodad from a mod the map doesn't depend on, or a missing custom one. Ask the author which.

This step is done when the compile succeeds with no warning about the new doodad, and you have acted on each other doodad warning or reported it to the author. A Kept doodad the author placed is theirs to settle, so don't keep compiling to clear it.

## 5. Place it, and hand it over

Place it with a doodad Anchor (`doodadType` the id), a set piece, or by the author from the palette. A Mission can place a Campaign Mod doodad only when its Blueprint's `dependencies` name the Campaign Mod (`file:Mods\<Name>.SC2Mod`). The Editor shows a placeholder otherwise, and the compile warns. After a Campaign Mod doodad, run `index_mod_doodads` with `only: ["<id>"]`, and describe its new entry from its sheet, as that tool's description says, so a Doodad Search finds it.

Before handing the map to the author, `check_workspace` (`/sc2-adjutant:check`) reports no problem, and the last compile ended step 4. Then tell the author what to look at in the Editor:

- **The palette** lists it under its group (and the map's tileset, with `tilesets`).
- **Placed copies** stand at the right height, with no placeholder.
- **Panning away** doesn't make it vanish while part of it is still on screen.
- **No faces are missing** from any side.
- **The shading** isn't pillowy, and the surface reads as the material it should.

## Fallback: a map no Blueprint compiles

On a map outside every Workspace Mission, write the same two entries by hand, the `CModel` in the map's `Base.SC2Data/GameData/ModelData.xml` and the `CActorDoodad` in `Base.SC2Data/GameData/ActorData.xml`, each inside the file's `<Catalog>` (create the file with `<?xml version="1.0" encoding="utf-8"?>` and `<Catalog>…</Catalog>` when the map has none):

```xml
<CModel id="Ring" parent="Doodad"><Model value="Assets\Models\Rings\Ring.m3"/></CModel>
<CActorDoodad id="Ring"><On index="0" removed="1"/><On index="1" removed="1"/><RandomScaleRange value="1.000000,1.000000"/></CActorDoodad>
```

A map with no game data of its own also needs `<DataComponent Type="gada">GameData</DataComponent>` in its `ComponentList.SC2Components`, or the Editor never reads the files. Then put the model and every texture it names at their storage paths in the map. Say it's a hand-made fallback when you hand it over, and move it into a Blueprint's `doodads` once the map is a Mission's. `Preload.xml` needs no entry: preloads are a streaming hint.
