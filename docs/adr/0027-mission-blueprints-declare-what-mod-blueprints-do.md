# Mission Blueprints Declare What Mod Blueprints Do

A Mission Blueprint had no catalog entries of its own. A Mod Blueprint had raw entries (`gameData`) and Generic Entries (`entries`), but a Mission could only name entries already in its map, through Kept References. So a game-data change tried on a map had to be an Editor edit: Kept Content with no Blueprint source, which had to be rewritten by hand to move it to the Campaign Mod (#103). The same went for strings, whole files, the includes list, Characters, Set Cutscenes and Accepted Removals. We decided (issue #109, the author approving the plan on 2026-11-25) that a Mission Blueprint declares everything a Mod Blueprint can, from the same schema. Moving a part between a Mission and its Campaign Mod is then just moving its declaration and its source file.

## Decision

- **Declared Content is one schema.** `DeclaredContentShape` (`packages/core/src/domain/declared-content.ts`) holds `gameData`, `includes`, `entries`, `characters`, `strings`, `files`, `setCutscenes`, `acceptedDifferences` and `removals`. Both Blueprints spread it into theirs, so a field can't drift between them.
- **One compile reads it.** Reading and checking each part (`packages/core/src/mods/declared-parts.ts`) is shared. A Mod's compile writes the parts into the mod. A Mission's compile merges them into its Map Package beside its own parts (`packages/core/src/map/mission-declared.ts`). A part both would write is refused, naming both writers.
- **The Equivalence Check applies the same way.** A Kept part a Mission's Declared Content writes over is converted under it, with its Accepted Differences. Its Accepted Removals are dropped, and the check expects them gone, as a mod's are.
- **Every other Mod Blueprint field is accounted for.** Each one is either a mod's by nature or has a Mission counterpart of its own shape, and `MOD_ONLY_FIELDS` and `MISSION_COUNTERPARTS` say which, with the reason. A test fails when a Mod Blueprint field is in none of the three. Adding a Mod field therefore means deciding where it stands for a Mission.

## What isn't shared, and why

- `kind`: a Map Package is neither a Campaign Mod nor an Asset Mod.
- `library`: the Editor makes trigger libraries only in mods. A Mission's functions are FunctionDefs among its own `triggers`, which use the same interface schema.
- `ui`: a UI Component's functions go into the library. A Mission drives the Campaign Mod's components with `uiActions`.
- `assets`, `voices`: an Asset Mod's. A Campaign's art lives in its Asset Mod, and a Campaign Mod holds none either. A Mission's own model and texture files are its doodads' sources.
- `triggers`, `doodads`, `dependencies`, `name`, `description`, `screenplays`, `soundSets`, `cinematics`: the Mission has its own counterpart of each, in a different shape, because of what a map is. For example, its triggers are authored elements and not a library's, and its doodads' files come from its folder. A Mission doodad now also takes a `name`, so it covers everything a Mod doodad does.

## Considered Options

- **Copy the Mod fields into the Mission schema.** Rejected: two copies drift apart, which is how the gap opened in the first place.
- **Rename the Mission's `triggers` to match the Mod's.** Rejected: they are different things. A mod's are a library's triggers spliced from a Triggers file, and a map has no library.
- **Make Mod-style `screenplays` and `soundSets` declarable in a Mission too.** Deferred: a Mission plays one Screenplay its Beats cue, and a second kind of conversation in a map is a feature of its own.

## Consequences

- A Mission that declares no Declared Content compiles exactly as before, so the golden is unchanged.
- `acceptedDifferences` on a Mission now defaults to `[]` instead of being optional.
- A Mission's catalog doesn't include its own declared entries yet, and sync doesn't bring an Editor change to a Mission's Set cutscene back into its Set. Both are listed in [declared-content.md](../reference/declared-content.md).
