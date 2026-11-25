# Declared Content

A Mission Blueprint declares the same Declared Content a Mod Blueprint does ([ADR-0027](../adr/0027-mission-blueprints-declare-what-mod-blueprints-do.md), issue #109). Both Blueprints take these fields from one schema, `DeclaredContentShape` in `packages/core/src/domain/declared-content.ts`, so the fields stay the same in both. To move a part from a Mission to its Campaign Mod (or back), move its declaration and its source file. Nothing about the part changes.

| Field | What it declares | In a Mission's Map Package |
|---|---|---|
| `gameData` | raw catalog entries, by the GameData file they go in | by entry, into that file |
| `entries` | Generic Entries, checked against the game's data schema ([catalog-schema.md](./catalog-schema.md)) | by entry, into each catalog's file |
| `characters` | Characters ([characters.md](./characters.md)) | CCharacters in CharacterData |
| `includes` | the includes list ([mod-includes.md](./mod-includes.md)) | `Base.SC2Data/GameData.xml` |
| `strings` | localized strings by file and key ([mod-strings.md](./mod-strings.md)) | by key, into each strings file |
| `files` | files written whole, and the strings a file names as `@<key>` | whole; layouts with CRLF endings, and a DescIndex that loads them |
| `setCutscenes` | Sets in the Blueprint's folder, written as cutscenes with no shots | among the map's Cutscenes, beside its Cinematics |
| `acceptedDifferences` | the Equivalence Check's Accepted Differences | as a mod's |
| `removals` | Accepted Removals | dropped from the package; the check expects each one gone |

Sources are files in the Blueprint's folder: `missions/<id>/` for a Mission.

## How a Mission's compile writes it

Every part is read and checked the way a mod's compile reads and checks it (`packages/core/src/mods/declared-parts.ts`): sources stay inside the folder, a raw entry needs an id, each entry is checked against the data schema, each file's and entry's strings must be its own, and the data rules, hotkey and missing-asset warnings apply. The Mission's compile then merges the parts in beside what it generates itself (`packages/core/src/map/mission-declared.ts`):

- **Catalog entries** are spliced into a GameData file the compile writes whole, such as the ActorData its Composites write. In a package with Kept game data they are merged by entry beside the Kept entries, as a mod's are. If no file is there yet, they get a file of their own. A file in a folder of GameData is loaded only through the includes list, so the compile adds it there and warns, the same as for a mod.
- **Strings** are added by key to a strings file the compile writes (GameStrings, TriggerStrings …), or merged by key beside the Kept keys.
- **Files** are written whole.
- **Set cutscenes** are written among the Cinematics' cutscenes, under `Base.SC2Data/Cutscenes/`.

One part has one writer. The compile refuses a key, an entry, a file or a cutscene name that the Mission's own compile also writes, and the refusal names both writers: for example `DocInfo/Name`, which comes from the Mission's `title`, or `MapScript.galaxy`. Each Kept part the Declared Content writes over is converted under the Equivalence Check, the same as for a mod.

A Mission's own doodad can also have a `name`, the same as a Campaign Mod's doodad. It is written into the map's ObjectStrings (`Actor/Name/<id>`, `Model/Name/<id>`).

## The Mod Blueprint fields a Mission doesn't share

`MOD_ONLY_FIELDS` and `MISSION_COUNTERPARTS` in `declared-content.ts` list each Mod Blueprint field that isn't Declared Content, and why. A test (`packages/core/tests/map/mission-declared.test.ts`) fails when a Mod Blueprint field is none of the three.

- **A mod's by nature:** `kind`, `library` (the Editor makes trigger libraries only in mods; a Mission's functions are FunctionDefs among its own `triggers`), `ui` (a UI Component's functions go into the library; a Mission drives the Campaign Mod's components with `uiActions`), and `assets` and `voices` (an Asset Mod's; a Campaign Mod holds no art either).
- **A Mission counterpart of its own shape:**
  - `title`, `summary` and `setting` for `name` and `description`.
  - Its own `dependencies`, which default to Void.
  - Its own `triggers`: authored trigger elements, one JSON file each, where a mod's `triggers` are the triggers and globals of its library.
  - Its own `doodads`, whose files come from its folder.
  - Its one `screenplay`, which covers `screenplays`, `soundSets` and `cinematics`.

## Gaps

- A Mission's catalog, which its validation and its compile look ids up in (units, doodads, models, Lights), doesn't include its own declared entries yet. It is the Campaign Mod's layer over the game's, plus the Mission's own doodads ([campaign-catalog.md](./campaign-catalog.md)). A check that looks up an id only the Mission's `entries` declare won't find it there.
- A Mission's own Characters aren't speakers for its Screenplay yet. Its speakers are matched against the Campaign Mod's Characters, as before.
- A Mission's `files` that write a whole strings file are compared with the Kept file as it stands, without its Accepted Removals taken out first, which a mod's compile does.
- An Editor change to a Mission's Set cutscene isn't brought back into its Set by sync, as a mod's is. The compile stops for it as for any Compiled file the Editor changed.
