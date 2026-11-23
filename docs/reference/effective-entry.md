# An entry as the game sees it (`show_entry`)

`show_entry` (issue #742) is a read-only MCP tool. It returns one catalog entry (a unit, ability, actor, weapon, behaviour, effect ...) merged the way the game reads it, so an author or agent need not chase a parent chain through XML by hand. It writes nothing. The idea came from a comparison with another project's tools (see `related-repos.md`); only the ticket's description of it was used, and the implementation and wording are ours.

## What it reads

| Layer | Source |
|---|---|
| Blizzard's data | A folder laid out like SC2Mapster's SC2GameData: `mods/core.sc2mod`, `campaigns/liberty.sc2campaign` ... each with `base.sc2data/GameData`. Give it as the `stockData` input, or set `SC2_ADJUTANT_STOCK_DATA`. Packages load in the order of `STOCK_PACKAGES` (the same order `build-tech-catalog.mjs` merges in). A `git clone --depth 1 https://github.com/SC2Mapster/SC2GameData` works. Without it, only the mod is read. |
| A mod | The Campaign Mod, or the Workspace mod named by `mod`: its package's catalog files the game loads (`Kept`), then what its Blueprint owns (catalog sources, generic entries, characters and custom doodads), as `compile-mod` writes them. |

The install's own data is in CASC storage and isn't read here.

## What it returns

- **layers**: where the entry is defined, in load order.
- **chain**: the entry, its parent, its parent's ... A parent no layer defines ends the chain (`missingParent`); a cycle ends it with a note.
- **classDefault**: whether the class's default (an entry of the class with no id, `default="1"`) was applied. Inheritance order is class default, then the chain from the root down, then the entry's own fields.
- **fields**: each field as the game sees it, its elements written as XML, each with the entry and layer it came from. A field given only by `index` overlays just those indices over what it inherits; any other replaces every earlier element of that name.
- **removed**: elements a definition removed with `removed="1"`; they are left out of `fields`.
- **tokens**: `##name##` is replaced by, in order of priority, the attribute of that name on the entry, then on its parents, then a template's declared default (`<?token id="name" value="..."?>`). `##id##` is the entry's own id. A token nothing fills stays as written and is listed in `unresolvedTokens`.
- **referrers**: the other entries that name it, with how: `parent`, `token <name>` (an entry attribute), or the field and attribute (`WeaponArray@Link`) or text that holds the id as a whole value. A reference a template builds from a token is not followed. `referrerLimit` caps the list; the total is always given.

## What is checked, and what is not

| Behaviour | Backed by | Needs an Editor check |
|---|---|---|
| Later definition replaces a field, indexed fields overlay, `removed="1"` drops an element | The catalog layer (`campaign-catalog.ts`) already reads Campaign Mod data this way; not compared against a stock entry here | Yes: that the Editor's data view and the game agree for every field type (a field with a keyed index other than an enum or number is untested) |
| Class default applies before the parent chain | Stock data writes class defaults (`<CUnit default="1">`); that they apply to every entry of the class is assumed, not shown | Yes: whether an entry with a parent also inherits the class default, or only the root of its chain does. The tool applies it once, first |
| Token substitution (attributes, declared defaults, `##id##`) | `generic-entries.ts` documents the attribute and `<?token?>` forms; the catalog layer already substitutes `##id##` | Yes: the order of priority when a child and a template both give a token, and tokens in an element's text |
| Referrers by whole-value match | Entry ids are written whole in link fields | Yes: lists written as one comma- or space-separated value are not matched, so a referrer may be missing |

Nothing here was run against the StarCraft II Editor. Until an Editor check, read the result as our best account of the merge, not a confirmed one. The tests (`tests/mods/effective-entry.test.ts`, `tests/mcp/show-entry.test.ts`) use synthetic data in the shape of Blizzard's catalogs; they test the merge rules above, not the game.
