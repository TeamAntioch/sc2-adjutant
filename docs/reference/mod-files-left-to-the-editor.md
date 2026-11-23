# A mod's files left to the Editor

Some files in a mod's package are the Editor's own data: what it shows while the author works, which the game doesn't need to load the mod. The author decided on #333 (2026-11-02) to leave these to the Editor. A Mod Blueprint doesn't own them and no compile writes them: they're Kept Content for good (ADR-0010), not a part still to convert, so the Kept Report lists them apart and leaves them out of its count.

The rule names each file, not its folder, since nobody has checked that everything in those folders is Editor-only. Any other file in these folders is still counted until that's decided, including a `Base.SC2Data/LocalizedData/Editor/EditorCatalogStringsSC2.txt`, since Base isn't a locale. A path matches in any case, as the game reads its files.

| File | What it holds |
|---|---|
| `Base.SC2Data/EditorDataASD/EditorCategories.xml` | The Editor's category lists (`ObjectType`, `FieldType` …), the values an entry's `EditorCategories` field picks from to sort it in the Editor's lists. |
| `Base.SC2Data/LocalizedData/EditorASD/EditorCatalogStringsSC2.txt` | The Editor's display names for catalog values, such as `EDSTR_ENUMVAL_e_soundCategoryAlert=FX_Map_Events` for a sound category. |
| `<locale>.SC2Data/LocalizedData/Editor/EditorCatalogStringsSC2.txt`, for any locale | The same strings, for that locale's Editor. |

What each step does with them:

- **The Kept Report** (`kept-report`, `kept_report`, and the report after `compile-mod`) lists them on their own line, `Left to the Editor: <count>`, after the components, each file with `--items`. They're out of the Kept count. `kept_report` returns them as `leftToEditor` (`count` and `items`), and `compile_mod`'s `kept` gives their count. A mod with none has no such line.
- **The compile** (`compile-mod`) leaves them as they are in the package, as any Kept Content: they're never in the compile record, and the Equivalence Check never compares them. The Editor keeps writing them when the author saves the mod.
- **`convert-files`** refuses to convert one by name, since the compile isn't meant to write it.
- **`check-workspace`** doesn't count Kept Content, so these files never come up there, and the check passes with them.

A Blueprint that writes one anyway, in `files`, owns it like any other file: it's Compiled Content then, not left to the Editor, and `convert-files` refuses it as already written.

The other files the #333 survey called Editor-only aren't left to it. `Base.SC2Data/GameData.xml` is the includes list, which the game needs and the compile generates (`mod-includes.md`). An empty `GameData/Assets.txt` is removed as an Accepted Removal; a non-empty one is the mod's asset-key table, which the Blueprint owns.

Code: `packages/core/src/mods/kept-report.ts` (`isLeftToEditor`).
