# Trigger coverage

How much Editor-saved trigger content core can write as the Editor does, and what stops the rest. `packages/core/scripts/trigger-coverage.mjs` measures it over real packages: a map's Kept triggers and functions through the Kept renderer, and a mod's library functions through the library generator, each compared with the Galaxy the Editor saved for it. It also converts each map's Kept triggers into Blueprint elements as `convert_triggers` would, writing nothing. It is the progress measure for spec #937, and its conversion table is spec #1027's; each of their PRs quotes its numbers before and after. It doesn't run in CI, since its corpus is private or external.

## What it measures

The script takes package folders and treats each one by what it holds. A folder with a `<Library>` in its `Triggers` and no `MapScript.galaxy` is a mod; anything else with a `Triggers` is a map. A folder with no `Triggers` is skipped with a note on stderr. Files are found case-insensitively, since Blizzard's packages are lower case.

- **A map.** Each `Trigger` and `FunctionDef` in `Triggers` is rendered by the Kept renderer (`src/triggers/kept-trigger-galaxy.ts`), from core's catalog (`src/triggers/trigger-catalog.ts`), the way `tune_kept_triggers` and `outline_kept_trigger` render one. The result is compared with the element's section of `MapScript.galaxy` (`keptElementSpan`), library element names bound from the saved text as the renderer binds them. A `compile-record.json` beside the map package marks the Compiled elements, which are skipped: only Kept ones count. Every call reachable from a Kept element, through its events, conditions, actions and parameters, is also counted by where the called function is defined.
- **A map's conversion.** Each Kept trigger is converted as `convert_triggers` converts a Mission's (`convertKeptTriggers` in `src/map/convert-mission-triggers.ts`, the converter without its writes; ADR-0026). It's read into a Blueprint element, everything it names is checked in reach, and its Triggers XML and Galaxy are written back and compared with the Editor's, the Equivalence Check the next compile makes. One that passes converts; any other is refused with why. A Mission's package, one with a `blueprint.json` beside it in a Workspace, is checked as its own conversion would be: its compile record's Compiled items are skipped, its holds and its Blueprint's own triggers are taken into account, and the libraries in reach are the game's and the Workspace mods its dependencies load. The Workspace's Plugins aren't loaded, so a Campaign Mod the map doesn't load is only out of reach, where `convert_triggers` adds that it should be in the Blueprint's dependencies. Any other map is checked against the game's libraries alone. Each Kept function is converted the same way (#1032): its XML, its declaration in Global Function Declarations and its definition in Global Functions are compared with the Editor's; each global its declaration and initialization, and each comment filed among the items its XML. The map's other Kept items (folders and the rest) are counted by kind as not yet convertible.
- **A mod.** Each `FunctionDef` of the mod's library is read (`src/mods/library-xml.ts`) and written (`src/mods/library-galaxy.ts`) as `convert-library` would, and compared with its definition in the Editor's `Base.SC2Data/Lib<id>.galaxy` by the same normalized comparison the Equivalence Check uses (`difference` in `src/mods/equivalence.ts`).

A match means the text is the same as the Editor's, line for line. It doesn't mean the rest render wrong: a render that differs may still be valid Galaxy. The Editor's Galaxy is the oracle here, as #937 decides.

## Running it

Build core first; the script imports from `packages/core/dist`. Then name the package folders, as many as you like, maps and mods mixed:

```
npm run build -w @team-antioch/sc2-adjutant
node packages/core/scripts/trigger-coverage.mjs [--out <dir>] <map or mod package folder>...
```

It prints the report as Markdown. `--out <dir>` also writes `report.md` and `report.json` there; the JSON has every row, where the Markdown keeps the top of each list. Point it at the unpacked package folder (`<Name>.SC2Map`, `novacampaign.sc2mod`), not an MPQ.

## Reading the report

### Maps

The **Maps** table has one row per map:

| Column | Means |
|---|---|
| Kept elements | the Triggers and FunctionDefs counted, with the Compiled ones skipped |
| match the Editor | rendered the same as the map's `MapScript.galaxy`, and the share of Kept elements |
| differ | rendered, but not as the Editor wrote it. The list at the end shows each one's first differing line, the Editor's and ours |
| uncatalogued | not rendered: the element calls a function or preset the catalog lacks, or uses a form the renderer doesn't read |
| error | the renderer threw. Its message is listed with the forms |
| no section | rendered, but `MapScript.galaxy` has no section of that name to compare with |

**Calls reachable from Kept elements** counts each call by where its function is defined: in core's catalog; in the game's library data (`packages/core/data/trigger-libraries.json`) but not the catalog; in the map itself (no `Library`); in a library whose data core holds but that lacks this function; or in a library the data doesn't hold at all, named. The rows are sorted by calls. *Game library data only* is what a template-driven fallback could reach; the last rows need that library's definitions first.

**Uncatalogued functions** ranks the functions the catalog lacks by how many Kept elements call them. *The only blocker of* counts the elements that call no other missing function and use no unread form, so wrapping that one function alone would make them render. An element that also lacks a preset doesn't count. A function shows as `<library>/<id>` with its Galaxy identifier when the game's data has one.

**Uncatalogued presets** gives only a count: the presets the catalog lacks, which the elements use as values. The JSON lists them by key with the elements each blocks.

**Forms the renderer doesn't read** lists what stopped a render other than a missing function: a value or parameter type, a flag, a block, an element the `Triggers` file doesn't hold. Ids and quoted names are taken out of each reason so like ones group.

### Conversion

The **Conversion** table has one row per map:

| Column | Means |
|---|---|
| checked against | the Mission's reach (its Workspace's record, Blueprint and mods) or the game's libraries alone |
| Kept elements | every Kept item of the map, of every kind: filed in `Root` or a folder, not Compiled, not already the Blueprint's |
| convert | the elements that would convert and pass the Equivalence Check, of every kind, and their share |
| Kept triggers | the map's Kept triggers |
| convert | the triggers that would convert, and their share |
| written back by the tool | the converted triggers the authoring tool writes back as they are |
| refused | the triggers that stay Kept. Each has a reason, listed below |
| Kept functions, Kept global variables, Kept comments | the same for each kind: how many the map has, and how many convert |
| not yet convertible | the map's other Kept items, which no conversion reads yet, then one column per kind in the Editor's terms (folder, record, custom script, preset), the commonest first |

**Refused functions, global variables and comments, by reason** list their reasons as the triggers' are; the JSON's `functionRefusals`, `globalRefusals` and `commentRefusals` list each.

**Refusals, by reason** groups the refused triggers' reasons, Ids, names and counts taken out so like ones group, each with examples as `<map>:<trigger name> (<Id>)`. A trigger has one reason: the first the converter meets, in the order it checks (read, reach, XML, Galaxy). A trigger the reader refuses isn't checked further, so fixing its reason can show another. The JSON's `conversionRefusals` lists every refused trigger by map, name and Id, with its whole reason, `notYetConvertible` counts the other items by kind, and `notYetConvertibleItems` lists each by map, kind, name and Id.

A package with no GameStrings converts its text values as empty, as `convert_triggers` would, so their Galaxy differs from the Editor's. The script says so on stderr. Point it at a copy that holds them.

### Mods

The **Mods** table has one row per mod:

| Column | Means |
|---|---|
| functions | the library's FunctionDefs |
| native | functions flagged native, which have no Galaxy body to write |
| read refused | the reader refused the function (`UnconvertibleFunctionError`): it holds a form a conversion doesn't write yet |
| Galaxy refused | read, but the generator refused it (`UnrenderableGalaxyError`) |
| match the Editor | written the same as the Editor's `Lib<id>.galaxy` |
| match but for the old Editor's header | the same once our `// Automatic Variable Declarations` line is taken out (below) |
| differ | written, but not as the Editor wrote it. The list at the end shows each one's first difference |
| no Editor Galaxy | `Lib<id>.galaxy` has no definition of that name |
| disabled | disabled, or with no body |

**Refusals** groups the reader's (`read:`) and the generator's (`galaxy:`) reasons, ids taken out, each with two examples.

### The older Editor's header

The current Editor writes a `// Automatic Variable Declarations` comment line at the top of a function's body, before the declarations it makes for loops and the like. An older Editor didn't, and several of Blizzard's mods were last saved by one. The generator always writes the line, as the current Editor does. So a function that differs only by that line is counted in its own column rather than as a difference. It is an allowance in the report, never something the generator leaves out.

## The corpus and its baseline

The baseline for #937, run on 2026-11-22 from `main` at `2e6213a`, over:

- **The author's own Workspace**, which is private: three of its Missions' Map Packages, called Mission A, B and C below, and its Campaign Mod. The repo names none of its content (`packages/core/tests/no-campaign-content.test.ts`), so the tables leave its packages and its library id unnamed. Rerun it there with its packages' folders.
- **Blizzard's packages** from the public game-data mirror [sc2-arcade-watcher/sc2-game-data](https://github.com/sc2-arcade-watcher/sc2-game-data) @ `7be8945`: the Liberty campaign map `campaigns/liberty.sc2campaign/base.sc2maps/maps/campaign/thanson01.sc2map`, as an older Editor-saved map, and six mods, `mods/missionpacks/novacampaign.sc2mod`, `mods/missionpacks/campaigncommon.sc2mod`, `campaigns/swarmstoryutil.sc2mod`, `mods/voidprologue.sc2mod`, `mods/challenges.sc2mod` and `mods/warcoop/warmeleeai.sc2mod`.

### Maps

| map | Kept elements | match the Editor | differ | uncatalogued | error | no section |
|---|---|---|---|---|---|---|
| Mission A | 47 (8 Compiled skipped) | 41 (87%) | 0 | 6 | 0 | 0 |
| Mission B | 134 | 31 (23%) | 0 | 103 | 0 | 0 |
| Mission C | 204 | 34 (17%) | 7 | 163 | 0 | 0 |
| thanson01.sc2map | 133 | 5 (4%) | 2 | 126 | 0 | 0 |

Of the three Missions' 385 Kept elements, 106 (28%) match.

| defined in | functions | calls |
|---|---|---|
| core catalog | 132 | 5,566 (68%) |
| game library data only | 184 | 1,339 (16%) |
| the map's own | 174 | 647 (8%) |
| library not in the data (the Campaign Mod's) | 19 | 431 |
| library not in the data (Camp) | 19 | 129 |
| library not in the data (Lbty) | 1 | 20 |
| library not in the data (VCMI) | 3 | 11 |
| library not in the data (VCUI) | 3 | 3 |

8,146 calls in all; the five libraries the data doesn't hold take 594 (7%).

The commonest blockers: `ActionQueueAdd` blocks 87 elements and is the only blocker of 60, then `Or` (17), `IncrementInteger` (16), `TechTreeUpgradeAddLevel` (14, the only blocker of 11) and `TextTagDestroy` (11). Of the forms, the largest is 57 thanson01 elements naming a Variable the `Triggers` file doesn't hold: older maps reuse an element Id across types, and the reader keeps one element per Id (#939). Then actor message values (19), a disabled Trigger (10), and the `FlagCreateThread` (9) and `FlagCall` (8) flags.

### Mods

| mod | library | functions | native | read refused | Galaxy refused | match the Editor | match but for the old Editor's header | differ | no Editor Galaxy | disabled |
|---|---|---|---|---|---|---|---|---|---|---|
| the Campaign Mod | its own | 127 | 54 | 0 | 0 | 70 | 0 | 0 | 0 | 3 |
| novacampaign.sc2mod | NovC | 121 | 0 | 39 | 45 | 0 | 35 | 2 | 0 | 0 |
| campaigncommon.sc2mod | ComC | 292 | 0 | 69 | 52 | 0 | 161 | 10 | 0 | 0 |
| swarmstoryutil.sc2mod | 281DEC45 | 224 | 0 | 76 | 67 | 0 | 58 | 22 | 0 | 1 |
| voidprologue.sc2mod | A3DDD02B | 324 | 0 | 99 | 57 | 140 | 0 | 25 | 0 | 3 |
| challenges.sc2mod | Chal | 40 | 0 | 21 | 3 | 0 | 5 | 11 | 0 | 0 |
| warmeleeai.sc2mod | W3AI | 3 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |

The Campaign Mod's 70 GUI functions all match. Of Blizzard's 1,004 library functions, 399 match (259 of them only with the old Editor's header allowed for), 70 differ, 307 can't be read and 224 can't be written. The largest refusals: text parameters (61), array variables (48 and more), calls into another mod's library (`SwaC` 42, `ComC` 33), `ValueType` values (35), presets with no value of their own (35 and 17), and `FlagAllowBreak` functions, the caller's own (25) or a callee's (27, 17 and 4).

Of the 70 differences, 45 are at a function's `// Automatic Variable Declarations` section: we write one where the Editor wrote none, or the Editor's automatic declarations (`auto…`) come where we write `// Variable Declarations`, so leaving out our one line doesn't make them match. 20 are a `return` where we leave a template's `#DEFRETURN` macro unfilled.

## The conversion baseline

The baseline for #1027, run on 2026-11-23 from the `trigger-authoring` stack (#1031, on #1030's converter), over the same corpus: Missions A, B and C in the author's Workspace, checked against their own reach, and thanson01 from the game-data mirror @ `7be8945`, checked against the game's libraries. Take thanson01 from the mirror: a copy without its GameStrings refuses 8 more triggers, their texts read as empty.

| map | checked against | Kept triggers | convert | refused | not yet convertible | function | folder | global variable | comment | record | custom script | preset |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Mission A | the Mission's | 42 (8 Compiled skipped) | 26 (62%) | 16 | 28 | 5 | 17 | 2 | 0 | 2 | 2 | 0 |
| Mission B | the Mission's | 74 | 48 (65%) | 26 | 138 | 60 | 44 | 27 | 5 | 1 | 0 | 1 |
| Mission C | the Mission's | 91 | 37 (41%) | 54 | 285 | 113 | 64 | 25 | 67 | 11 | 3 | 2 |
| thanson01.sc2map | the game's libraries | 127 | 70 (55%) | 57 | 129 | 12 | 22 | 76 | 18 | 0 | 0 | 1 |

Of the three Missions' 207 Kept triggers, 111 (54%) convert. Of the corpus's 334, 181 (54%).

The 153 refusals, by first reason:

- **A library's global variable**, named by a map trigger (`it names <lib>'s Variable <id> where the map's own is expected`): 94 in the Missions, every one the Campaign Mod's (16, 24 and 54), and 14 in thanson01 (Camp's). The reader takes a map trigger's variables to be the map's own. This is the largest gap: Mission C's every refusal is one.
- **A library not in reach**: Camp 38 in thanson01 (36 calls, a preset-typed local, a lone call), Lbty 1, and VCMI 2 in Mission B. #951's libraries would bring them in reach.
- **Galaxy the renderer doesn't write**: 3 calls whose template uses `#DEFRETURN`, and 1 local variable of `<GameType>`, all in thanson01.

None is refused at the XML or Galaxy comparison: each trigger that reads and is in reach writes back as the Editor wrote it.

Not yet convertible, over the four maps: 190 functions, 147 folders, 130 global variables, 90 comments, 14 records, 5 custom scripts and 4 presets. These are #1032's.

### After library globals (#1051)

A map trigger may now name a library's global, and a member of a library's structure, as `<library>/<id>`, checked against the library in reach: a Workspace mod's globals and structure members are read from its package's Triggers (`library-reach.ts`), and its Blueprint interface's structures. The game's library data holds no globals. Run on 2026-11-23 over the same corpus:

| map | checked against | Kept triggers | convert | refused |
|---|---|---|---|---|
| Mission A | the Mission's | 42 (8 Compiled skipped) | 40 (95%) | 2 |
| Mission B | the Mission's | 74 | 72 (97%) | 2 |
| Mission C | the Mission's | 91 | 82 (90%) | 9 |
| thanson01.sc2map | the game's libraries | 127 | 70 (55%) | 57 |

Of the three Missions' 207 Kept triggers, 194 (94%) convert; of the corpus's 334, 264 (79%). thanson01 still converts 70: its 14 triggers that named Camp's globals read now, but stay refused because Camp isn't in reach (#951), 10 of them first for a call into it.

The 70 refusals, by first reason:

- **A library not in reach**: Camp 52 in thanson01 (46 calls, 4 globals, a preset-typed local, a lone call), Lbty 1, and VCMI 12 in the Missions (2, 2 and 8).
- **Galaxy the renderer doesn't write**: 3 `#DEFRETURN` templates and a `<GameType>` local in thanson01, and a water value in Mission C.

### After functions (#1032)

A Mission Blueprint's element file may hold a map function (`"kind": "function"`), and the converter reads Kept functions as it does triggers. Run on 2026-11-23 over the same corpus:

| map | checked against | Kept elements | convert | Kept triggers | convert | Kept functions | convert | not yet convertible |
|---|---|---|---|---|---|---|---|---|
| Mission A | the Mission's | 70 | 44 (63%) | 42 | 40 (95%) | 5 | 4 (80%) | 23 |
| Mission B | the Mission's | 212 | 130 (61%) | 74 | 72 (97%) | 60 | 58 (97%) | 78 |
| Mission C | the Mission's | 376 | 179 (48%) | 91 | 82 (90%) | 113 | 97 (86%) | 172 |
| thanson01.sc2map | the game's libraries | 256 | 81 (32%) | 127 | 70 (55%) | 12 | 11 (92%) | 117 |

Of the corpus's 914 Kept elements, 434 (47%) convert, from 264 (29%): the triggers as before, and 170 of its 190 functions (89%). Not yet convertible: 147 folders, 130 global variables, 90 comments, 14 records, 5 custom scripts and 4 presets.

The 20 function refusals, by first reason:

- **A library not in reach**: VCMI 4 and VCUI 1 in the Missions, Camp 1 in thanson01.
- **XML in another order than ours**: 5 in Mission C, whose FunctionDef's elements the Editor saved in another order than the one it reaches them in (a call before the parameter definition it was given later). Writing them in the saved order is a follow-up.
- **Galaxy the renderer doesn't write**: 2 functions returning a preset type (`<ReturnType>` with a `<TypeElement>`), the 3 that call them, an If Then Else whose conditions are all disabled, a water value and a doodad value, all in Mission C.
- **A call that names no function** (`its call <id> names 0 functions`), 1 in Mission C.

### After globals and comments (#1032)

A Kept global converts into the Blueprint's `triggerVariables`, and a comment filed among the map's items into a file of its own. Run on 2026-11-23 over the same corpus:

| map | Kept elements | convert | triggers | functions | globals | comments | not yet convertible |
|---|---|---|---|---|---|---|---|
| Mission A | 70 | 44 (63%) | 40 of 42 | 4 of 5 | 0 of 2 | 0 of 0 | 21 |
| Mission B | 212 | 156 (74%) | 72 of 74 | 58 of 60 | 21 of 27 | 5 of 5 | 46 |
| Mission C | 376 | 256 (68%) | 82 of 91 | 97 of 113 | 10 of 25 | 67 of 67 | 80 |
| thanson01.sc2map | 256 | 166 (65%) | 70 of 127 | 11 of 12 | 67 of 76 | 18 of 18 | 23 |

Of the corpus's 914 Kept elements, 622 (68%) convert, from 434: 98 of its 130 globals and all 90 comments. Not yet convertible: 147 folders, 14 records, 5 custom scripts and 4 presets.

The 32 global refusals, by first reason:

- **Galaxy the renderer doesn't write**: 17 of a record or preset type (`<TypeElement>`: 2, 2, 11 in the Missions, 2 in thanson01), 5 objectives (1 in Mission C, 4 in thanson01), a ping and a `<GameType>` in thanson01.
- **A constant** (8: 4 in Mission B, 3 in Mission C, 1 in thanson01), which the Editor declares in Constants, a section the compile doesn't write yet.
