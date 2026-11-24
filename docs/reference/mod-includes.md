# A mod's includes list

The game loads a mod's catalog files in two ways. A file directly in `Base.SC2Data/GameData/` named for its catalog (`UnitData.xml`, `WaterData.xml` …) loads by its name. Any other catalog file, in a folder of GameData (`GameData/Heroes/RaynorData.xml`) or named for no catalog (`GameData/FutureMaps.xml`), loads only once the includes list names it. The game ignores any other XML in GameData.

The includes list is `Base.SC2Data/GameData.xml`, read in any case (one Campaign Mod's Editor saved it as `gamedata.xml`). It isn't Editor-only data: without it the game never loads those files. Not to be confused with `Base.SC2Data/GameData/GameData.xml`, the Game catalog.

```xml
<?xml version="1.0" encoding="utf-8"?>
<Includes>
    <Catalog path="GameData/Heroes/Common/genericmaterialimpactdata.xml"/>
    <Catalog path="GameData/Heroes/Common/genericcursordata.xml"/>
    <Catalog path="GameData/Heroes/RaynorData.xml"/>
    <Catalog path="GameData/Heroes/SwannData.xml"/>
</Includes>
```

Each path is relative to `Base.SC2Data`. The game loads the files in list order, after the standard ones, and that order matters when two of them give the same entry. The Editor doesn't sort the list: a Campaign Mod's list is in the order its files were added. Blizzard's shipped lists (`liberty.sc2mod`, `starcoop.sc2mod`) have the same shape, with `encoding="us-ascii"`.

## The Blueprint's `includes`

The Mod Blueprint owns the list as `includes`: the catalog files outside the standard ones, by package path, in load order.

```json
"includes": [
  "Base.SC2Data/GameData/Heroes/Common/genericmaterialimpactdata.xml",
  "Base.SC2Data/GameData/Heroes/Common/genericcursordata.xml",
  "Base.SC2Data/GameData/Heroes/RaynorData.xml",
  "Base.SC2Data/GameData/Heroes/SwannData.xml"
]
```

Each is a `.xml` in `Base.SC2Data/GameData/` (its folders in any case, as the list spells them), listed once in any case, since the game reads its files in any case.

- **Import** (`import-mod`) fills `includes` in from the package's list, in its order, each path as the list spells it and each file once in any case. A package with no list gets no `includes`. The list is still Kept after Import: the first compile converts it under the Equivalence Check, which a list with a file named twice fails until the difference is accepted.
- **The compile** (`compile-mod`) writes the list from `includes`:
  - each listed file the package will have, in order;
  - then each catalog file the Blueprint writes outside the standard ones (by `gameData`, `entries` or `files`) that `includes` doesn't name, at the end, with a warning to add it to `includes` where it should load;
  - leaving out a listed file the package won't have (gone, removed as an Accepted Removal, or a whole file the last compile wrote and this one doesn't), with a warning to remove it from `includes`;
  - and warning of a listed standard file, which the game loads by its name anyway, though it stays listed.

  With nothing to list, it writes no list, and one it wrote before goes.
- **Format.** The list is written as the Editor writes it: four-space indents and the package's own XML declaration and line endings, or `encoding="utf-8"` and LF for a new list. The file keeps the package's spelling, or is `Base.SC2Data/GameData.xml` when new.
- **The Equivalence Check** compares a Kept list with the one the compile writes, byte for byte, as `file:Base.SC2Data/<spelling>`. A difference fails the compile unless it's an Accepted Difference.

A Blueprint without `includes` leaves a package's Kept list alone. Its catalog files must then be standard ones, ones the package already has, or ones the Kept list names; any other fails the compile, saying to give the Blueprint its `includes`. A Blueprint with no `includes` whose package has no list, or whose list the last compile wrote, is treated as `"includes": []`, so a new catalog file in a folder gets a list, and keeps it. A Blueprint whose `files` write the list whole has no `includes`: the compile then writes no list of its own, and refuses `includes` beside it.

An empty Kept list (`<Includes/>`) imports as `"includes": []`. The compile writes no list then, and the Kept one stays Kept: remove it as an Accepted Removal (`file:Base.SC2Data/GameData.xml`).

## Giving a converted Blueprint its includes

A Blueprint imported before `includes` existed has none, and its package's list stays Kept. To convert it, copy the list's paths into `includes`, each prefixed with `Base.SC2Data/`, in the list's order, then compile. The Equivalence Check confirms the list comes out byte for byte, and it leaves the Kept report.

Code: `packages/core/src/mods/game-data-files.ts` (reading and writing the list), `compile-mod.ts` (`includesListFor`), `import-mod.ts`.

## Evidence: which root files the game loads without a list

Checked 2026-11-24 over the 12 stock packages (`STOCK_PACKAGES`, in the public game-data mirror): 1,161 `.xml` files sit directly in `Base.SC2Data/GameData/`. 1,157 are named `*Data.xml`; of those, only `SC2Data.xml` has a `<Catalog>` line (in `core.sc2mod`'s list). The other 4 (`CollectionSkin.xml`, `SC2Events.xml`, `WarChestSeason5.xml`, `WarChestSeason6.xml`, all `liberty.sc2mod`) are not named for a catalog and each has a line in that package's list. So every stock root file the game loads with no `<Catalog>` line is a `*Data.xml`, and every other root file is listed, which fits the rule above. The one counterexample in the whole mirror is `item.xml` of `war3data.sc2mod`, not a stock package, and not listed.
