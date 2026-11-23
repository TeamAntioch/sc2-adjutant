# A Campaign Mod's Doodad Index Lives in the Workspace

Core describes the game's doodads in `packages/core/data/doodad-catalog.json`. Each entry has a `description` in fixed words (look, kind, size, role, story, biome) and a 2×2 turntable `sheet`. A Campaign Mod's doodads used to reach the Asset Catalog only as ids in the catalog layer, so a Doodad Search could match them only by id, and the dressing rules couldn't see their `role` or `size`. A Workspace now keeps an index of its Campaign Mod's doodads, described and pictured to the same standard (#558).

**What it covers.** The Campaign Mod's non-template `CActorDoodad`s, the rule core and the catalog layer already use. A doodad-typed `CModel` with no actor isn't a placeable doodad: liberty.sc2mod has 257 of them, and only one appears among the 2,217 doodad types placed in 341 maps. A game doodad that the mod redefines is indexed only when the mod changes its model. Its look comes from its model, so with the same model, core's entry stands. When the model differs, the mod's entry replaces core's for every reader.

**Where it lives.** It lives at `mods/<id>/doodad-catalog.json`, beside the Campaign Mod's Blueprint, committed, like `model-guide.json` and `model-anims.json`. The catalog layer reads it. Entries use core's shape and words, plus `model` (the resolved storage path), `modelHash`, `described` (`agent` or `author`), and `unpictured` or `renderError`. An entry with no description is pending. `index-mod-doodads` writes the entries and an agent writes the descriptions. A rebuild never changes an `author` entry's description. It sets an `agent` entry back to pending when the model changed, and it always keeps a description's Doodad Uses.

**Which pictures are committed.** A sheet whose model file was read from one of the Workspace's own packages is the author's art, so it is committed under `mods/<id>/catalog-sheets/doodads/`. A sheet of a game model is a rendered game asset, which core never redistributes. It goes under `catalog-sheets/game-models/`, and the raw renders go under `thumbnails/`. Each of those two folders holds its own `.gitignore` of `*`. The folder a sheet is in decides whether it is committed, and no Workspace has to edit its root `.gitignore`.

**How a mod's models render.** `model.render` takes an optional `packages`: the Workspace's mod package folders in load order (`campaignModPackages`, which is the Campaign Mod and the Workspace mods it depends on). The model is still a storage path. The adapter reads the model from the newest-loaded package that holds it (`findPackageFile`, under `Base.SC2Assets` or the package root, in any case), else from the game. A model read from a package has every texture it names read from the packages first, too. A game model whose texture a mod replaces still draws with the game's texture: WhiteoutFlakes has no way to be told otherwise for a model it reads from CASC, short of patching it. Nothing is written into the packages. The macOS adapter needs this because WhiteoutFlakes reads a texture only from beside the model file or from CASC. So the adapter copies the `.m3` into its work folder, next to links to the package files of the textures the model names.

## Considered Options

- **The index inside the mod package.** It would travel with the `.SC2Mod`. Rejected: the game never reads it, and re-importing the mod would lose it.
- **The index in core's data files.** Rejected: core holds only the game's entries, and these are the author's assets.
- **A machine-local cache, rebuilt on demand.** Rejected: descriptions are written work, partly by the author, and they need review and history.
- **Commit every sheet, or none.** Committing a game model's sheet would redistribute a rendered game asset, and a Workspace may be public. Committing none would leave a fresh clone without pictures of the author's own models unless it had a Host Adapter. So the source of the model file decides.
- **Uncommitted pictures in the machine's `cacheDir`.** Rejected: a lookup would have to search two places, and the agents' pictures would be scattered across machines' caches.
- **Core passes file paths, or stages the files itself.** Rejected: the Host Adapter contract speaks in storage paths, as the game and the Editor do, and each adapter keeps its renderer's quirks to itself.

## Consequences

- `getDoodadDescription` takes a Catalog. The mod's entry wins whenever the index covers the doodad, even while the entry is pending.
- `check` warns, without failing, about doodads the index lacks and entries that are pending, stale or gone. An entry is stale when its package model's file has another size than `modelHash` records, or it names another game model. Telling it never reads a model file, so `check` stays fast however many doodads a mod has, and an edit that keeps a file exactly the same size goes unnoticed. An unpictured doodad never blocks a compile. A file that doesn't read fails the check, as a Model Guide file does.
- A mod doodad's Doodad Uses go into its own entry. They are never offered to core.
- The doodads a Mission's Kept game data defines aren't indexed. They can only be placed in that Mission.
