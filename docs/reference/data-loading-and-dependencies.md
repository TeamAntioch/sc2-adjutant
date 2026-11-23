# Data Loading and Dependencies

How the game decides which mods to mount for a map, which copy of a file wins, and what the package metadata files (`DocumentHeader`, `DocumentInfo`, `ComponentList`, `.version`, `Preload.xml`) are for. Compared against what our writers produce.

Sources:

- `sc2-ida-mcp-setup` (read-only clone of `github.com/sc2-arcade-watcher/sc2-ida-mcp-setup`), notes on the Windows client and Editor, build 96921 (5.0.15). We target 5.0.17 (build 98310). File formats, path names, cvar names, log strings and error codes carry over; addresses and struct offsets don't, so none are given here. Paths below are relative to the clone's `docs/` unless they start with `tools/`.
  - `dependency-manager.md`, `pathroot-system.md`, `vfs-readers.md`, `mpq-reader.md`, `runtime/game-data-loading.md`, `texture-asset-resolution.md`
  - `file-format/document-header.md`, `document-info.md`, `component-list.md`, `version-file.md`, `preload-xml.md`, `preload-asset-db.md`
  - `tools/mpqcli/README.md`
  - `sc2-data-reader.md` was skimmed: it maps a memory reader's offsets and has nothing on data loading.
- Our writers: `packages/core/src/map/write-document-header.ts`, `packages/core/src/map/write-document-info-xml.ts`, `packages/core/src/map/write-component-version.ts`, `packages/core/src/map/write-map-package.ts`.
- Editor-saved bytes: `packages/core/tests/fixtures/document-header/mos-belshir-test-map.DocumentHeader` (golden test) and the git-ignored maps in `missions/test-map/output/`. A local Campaign Mod's own package, for its mod header.
- [map-package-findings.md](./map-package-findings.md#map-packages) and its `sc2-ida-mcp-setup` entry under [Tools evaluated](./map-package-findings.md#tools-evaluated).

Our Editor-golden findings take precedence. Where the docs disagree, they're given as background. Nothing here was tested in the game for this write-up; in-game results quoted are from [map-package-findings.md](./map-package-findings.md).

## What applies to us

| Applies to our Mac 5.0.17 build | Build-specific internals (not used here) |
|---|---|
| Dependency string format, built-in mod paths and their parent chains | Struct sizes and offsets (`DependencyEntry`, `ArchiveHandle`, ...) |
| Sub-archive names (`Base.SC2Data`, `enUS.SC2Data`, ...) and their priority order | Function addresses, vtables, globals |
| Error codes and strings (`UI/TextError/CannotLoadDescFile`, `537067531`) | The task-queue machinery and NGDP/CASC internals |
| cvar names: `testmod`, `extramods`, `meleeMod`, `run` | Windows-only code paths (Win32 file APIs, TACT keys) |
| File formats: `DocumentHeader` header fields, `.version`, `ComponentList`, `Preload.xml` | The exact numeric `base_tier_offset` |

## Dependency resolution

Sources: `dependency-manager.md` ("ModPath__MatchAndValidate", "CDependencyManager::Refresh", "g_LocaleModEntries"), `pathroot-system.md` ("Locale Mod Dependency Table", "ModDescriptor Table"), `file-format/document-header.md` ("Read Pipeline", "Error Codes").

### The algorithm

On a map load the engine builds a fresh dependency list from the map's own dependencies, then:

1. Normalises the path. If it is already registered, stop.
2. If the path is one of the 21 built-in mods, take its parents from a static table (up to 4 parents each).
3. Otherwise read the archive's binary `DocumentHeader`. If there is none, fail with `537067531` (not found).
4. Recurse into each dependency listed there. The closure is appended dependencies first.
5. Check that `<mod>/Base.SC2Data` exists.
6. Register the mod.

The mounted set is then replaced by diffing: the common prefix of the old and new lists stays mounted, the rest is unloaded in reverse, and the new tail is loaded in order. A mod already in the list is not loaded twice.

The game reads dependencies from `DocumentHeader`, not `DocumentInfo`. This matches what we found: the Editor opens a map without `DocumentHeader`, but Test Document refuses it.

### Dependency string format

Source: `file-format/document-info.md` ("Dependency Format").

```
bnet:{Name}/{Version}/{CatalogId},file:{LocalPath}
file:{LocalPath}
```

- `bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod` is the stock form; `999` is the Blizzard catalog ID used for built-in mods.
- The `file:` path is relative to the install root and may use `/` or `\`. It can name a packed archive or a loose folder.
- The same string goes into `DocumentInfo` `<Dependencies><Value>` and, NUL-terminated, into `DocumentHeader` (verified against the Editor fixture and a local Campaign Mod's own header).
- The Editor writes a local mod as `file:Mods\<Name>.SC2Mod` with no `bnet:` part. It resolves through the symlinks in `/Applications/StarCraft II/Mods/`.

### Built-in chains

Each built-in mod's parents (`pathroot-system.md`, "Locale Mod Dependency Table"). Expanding recursively:

| Mod | Direct parents | Full closure, load order |
|---|---|---|
| `Mods/Liberty.SC2Mod` | — | Liberty |
| `Mods/Swarm.SC2Mod` | Liberty | Liberty, Swarm |
| `Mods/Void.SC2Mod` | Swarm | Liberty, Swarm, Void |
| `Campaigns/Liberty.SC2Campaign` | Liberty | Liberty, Liberty Campaign |
| `Campaigns/Swarm.SC2Campaign` | Liberty Campaign, Swarm | Liberty, Liberty Campaign, Swarm, Swarm Campaign |
| `Campaigns/Void.SC2Campaign` | Swarm Campaign, Void | ... Swarm Campaign, Void, Void Campaign |
| `Campaigns/VoidStory.SC2Campaign` | Void Campaign | ... Void Campaign, VoidStory |
| `Mods/NovaStoryAssets.SC2Mod` | Void Campaign | ... Void Campaign, NovaStoryAssets |

`Core.SC2Mod` is mounted once at startup, before everything else.

So **VoidStory → Void Campaign → Swarm Campaign + Void.SC2Mod**, and so on down to Liberty.

`Mods/VoidPrologue.SC2Mod` isn't in the table above. Its own `DocumentInfo` in the game data's mirror depends on `Campaigns/Swarm.SC2Campaign`. Neither are the Liberty and Swarm story campaigns. The doodad catalog found that their doodads show once a map depends on Void Story, so the compile takes Void Story to bring them in.

The compile reads this table (`packages/core/src/map/game-packages.ts`) to check that a map loads what its Cinematics film (#1019). `compile_map`, `compile_cutscene` and `check` warn about anything in a package the map's dependency chain doesn't load, and name the dependency to add. That covers a Set imported from a Blizzard cutscene, which needs the package the cutscene is in. It covers a Set piece or cast member whose CModel only such a package defines, and a Light only such a package defines. The chain runs through the Workspace's own mods' dependencies. A dependency the check can't follow, such as a mod outside the Workspace or a game package missing from the table, may load anything, so the check then warns about nothing. `import_set` notes the dependency a Set from a story package needs.

A CModel entry and its model file can be in different packages. Nova Covert Ops' bridge pieces (`SMX3_Nova_Ship_Bridge01` and on) have their CModels in `Liberty.SC2Mod`'s ModelData, but their `.m3` files are in `NovaStoryAssets.SC2Mod`'s assets. So a map loading only `Void.SC2Mod` knows the models and draws nothing. The game data's mirror has the catalogs but not the assets, so `data/package-entries.json` records which package defines each CModel and CLight, not where each file is. A Set's source cutscene stands in for the files. A cast model whose CModel is in a base mod and whose file is in a story package isn't caught; that needs a listing of the install's CASC storage by package.

Maps on a local Campaign Mod whose `DocumentHeader` depends on `NovaStoryAssets`, `VoidStory` and its own Asset Mod mount roughly: Core, Liberty, Liberty Campaign, Swarm, Swarm Campaign, Void, Void Campaign, NovaStoryAssets, VoidStory, the Asset Mod, the Campaign Mod, then the map. That is why such maps can use VoidStory sounds such as `Kerrigan_Extinction_ShockwaveExplosion`.

### Errors

| Code / string | Meaning |
|---|---|
| `537067531` (`0x2003000B`) | Not found: no `DocumentHeader` in the archive, or a file in no mounted archive |
| `536936462` (`0x2001000E`) | `DocumentHeader` FourCC isn't the product's (`H2CS` on disk) |
| `536936463` (`0x2001000F`) | `DocumentHeader` version above 8 |
| `536936466` | Invalid (empty) path |
| `UI/TextError/CannotLoadDescFile` + the mod path | A mod's descriptor failed validation; shown in the error dialog |

[map-package-findings.md](./map-package-findings.md#logs-and-testing) already records the last one as the string to match in `GameLogs`.

## Mounting and override priority

Sources: `vfs-readers.md` ("Sub-Archive Loading Matrix", "Archive Priority System", "File Resolution"), `runtime/game-data-loading.md` §§ 1, 4, 6.

### Sub-archives

Each mounted mod or map is opened as up to 27 readers: 9 slot types × 3 tiers.

| Subtype | Path inside the archive | Priority offset |
|---|---|---|
| 0–2 | the archive root | +0, +10, +20 |
| 3 | `Base.SC2Assets` | +30 |
| 4 | `Base.SC2Data` | +40 |
| 5 | `<locale>.SC2Assets` (e.g. `enUS.SC2Assets`) | +50 |
| 6 | `<locale>.SC2Data` (e.g. `enUS.SC2Data`) | +60 |
| 7 | `Teen.SC2Assets` | +70 |
| 8 | `Team.SC2Assets` | +80 |

Tier adds 0–2.

### The formula

```
priority = 100 × (mount_index + 1) + 10 × subtype + tier
```

The highest priority wins; ties go to the reader opened last. The 100-point stride is bigger than any archive's internal range (at most 82), so **every reader of a later-mounted archive beats every reader of an earlier one**. Inside one archive, `enUS.SC2Data` beats `Base.SC2Data`, which beats the root.

The map is mounted after its whole dependency closure (dependencies first, as above; `texture-asset-resolution.md` lists the search order as "Liberty / Swarm / Void / map"). So for plain file lookups, a file at the same path in the map wins over Void and the Campaign Mod. `testmod` relies on the same rule (below).

Two kinds of override, which behave differently:

- **Whole-file shadowing.** Textures, models, sounds and other assets looked up by path: the single highest-priority copy is used.
- **Catalog merging.** `GameData/*.xml` from each archive are loaded per mod and layered, so a map can override one field. Our partial `<CTerrain id="MonlythEx1"><Lighting .../>` and map-local `EffectData.xml` work in game ([map-package-findings.md](./map-package-findings.md#map-packages)). The doc shows the same merge behaviour for UI layouts (`runtime/game-data-loading.md` §6.1) and says `testmod` overrides catalogs and GameStrings; it doesn't trace the catalog merge itself.

### Unpacked folders and case

- Loose folders are a first-class backend: the same reader class handles packed MPQs and directories and decides after opening (`mpq-reader.md`, "MPQ vs DIR"). The doc author's live install (the China client) serves a stock unpacked `.SC2Map` this way. This is consistent with why our unpacked maps load in Test Document.
- Symlinks into `Mods/` work on this Mac (a local Campaign Mod).
- Case: the docs don't say how the directory backend matches case. MPQ name lookup is case-insensitive (standard MPQ hashing, not covered by the doc), and some XML readers compare tags case-insensitively (`t3Terrain.xml`, `ComponentList`). A loose folder on macOS follows the volume: APFS is case-insensitive by default, but a case-sensitive volume would not be. Write paths with the exact case the Editor uses and make references match file names exactly.

## ComponentList

Source: `file-format/component-list.md` (from the Editor binary).

15 types: `info` DocumentInfo, `text` GameText, `gada` GameData, `attr` Attributes, `aiai` CustomAI, `uiui` UI, `cuts` Cutscenes/Index, `font` font styles, `mapi` MapInfo, `terr` t3Terrain.xml, `plob` Objects, `regi` Regions, `trig` Triggers, `cine` Cinematics, `stdi` StandardInfo.xml.

- `Locale` only matters for `text`.
- Tag and attribute names are accepted in PascalCase and lowercase.
- **Read filter:** when a document is loaded outside the Editor, `attr`, `aiai` and `trig` are skipped. The game never reads our `Triggers` XML; it runs `MapScript.galaxy`. The two must be kept in sync by our writers, and any game-side check has to look at `MapScript.galaxy`.

## `.version` files

Source: `file-format/version-file.md` (from the Editor binary).

v2 layout, 44 bytes, little-endian: `cdes`, the component FourCC reversed, format version `2`, build, major, minor, patch, build again, entry count, Unix timestamp, terminal (`1`). Older v0 (36 bytes) and v1 (40 bytes) files still parse.

How the Editor uses them:

- The reader rejects a file whose magic or type tag doesn't match. [map-package-findings.md](./map-package-findings.md#map-packages) records that a missing file makes the Editor log `Unable to load '<component>'` and drop the component.
- **Timestamps:** the Editor takes the maximum timestamp over `Objects.version`, `Regions.version` and `Triggers.version` only.
- **Consolidation:** a routine reads three version files of the same type, checks the tags match, and keeps the one with the highest build and version tuple.

## Textures and silent failure

Source: `texture-asset-resolution.md` §§ 1–2.

- Lookup goes through the mounted archives in priority order (local MPQ/folder readers first, then CASC).
- A "resolved" result also counts files that are catalogued in CASC but not downloaded yet.
- **There is no placeholder texture.** A texture that fails to load leaves the material sampling nothing. The shader permutation doesn't change, so it doesn't fall back to a different look; it just renders wrong, with no error.
- The only log lines are for corrupt files, not missing ones:
  - `WARNING: Corrupt texture ` (header read failed)
  - `WARNING: Texture DB does not match file info or file is corrupt for ` (header mismatch)
- The doc leaves open how a map-local texture is arbitrated against a CASC copy when both resolve.

A misspelled texture name in a map-data override (`BlendTextures`) or a missing custom asset therefore needs our own check; the game won't report it.

## Preload.xml and PreloadAssetDB

Sources: `file-format/preload-xml.md`, `file-format/preload-asset-db.md`, `file-format/document-info.md` ("Preload Format").

- `Preload.xml`: `<Preload>` with `<Asset path=".." Type="Image"/>` and catalog references `<Actor|Sound|Terrain|Unit|User id=".."/>`.
- `PreloadAssetDB.txt`: INI-style `[Section]`, `id=`, then `path`, `asset`, `Actor`, `Model`, `Sound`, `Texture`, `Effect` lists. `##id##` in a sound name is replaced by the entry's id.
- `DocumentInfo` `<Preload>` holds the same hints as `GameLink:Unit;Viking`, `AssetFile;<path>`, `Bank;<name>`.
- At load, the game reads `Preload.xml` then `PreloadAssetDB.txt` from every mounted archive, merges them and streams the assets. It is a loading-time optimisation for CASC streaming; nothing says a missing file fails a load.

Editor-saved 5.0.17 maps in `missions/test-map/output/` all have a `Preload.xml` (`SYSTEM_ActorConfig`, the tileset as `<Terrain>`, one `<Unit>` per placed unit type), an empty `PreloadAssetDB.txt` and a `BankList.xml`. A local Campaign Mod saved by the Editor ships both preload files and `DocumentInfo` preload entries. We write none of these.

### Does the game need `PreloadAssetDB.txt`?

Settled for maps, not yet for mods (checked for ticket #279, 2026-11-01):

- **The game reads it, at load.** It isn't an Editor-only cache: the preload pipeline (`Preload__LoadAndStream` in `preload-asset-db.md`) looks it up in every mounted archive, after `Preload.xml`, and queues each asset it names for NGDP streaming, the download of game files not yet on disk. It only fetches; nothing in that pipeline gates the load on the file being there.
- **The Editor writes it on save, derived from the package's game data.** It has one `[Catalog]` section per catalog the package defines or overrides entries of, and one `id=` per entry, listing the assets, actors, models, sounds and textures that entry pulls in. A Korhal map the Editor saved has one `[Terrain]` entry (its tileset's textures, Light, skybox and ambience); an Editor-made map with no data of its own has an empty one; a large Campaign Mod's is 1 MB, 2,156 entries over 23 catalogs; its Asset Mod, which has no game data, has an empty one. It is generated, never authored.
- **A map without it loads and plays.** Our writers have never written one, and our compiled maps play in Test Document: a compiled Mission's flare, sun and capture Mechanics were all verified there. Editor-saved maps have one; our compiled maps don't.
- **Not tested: a mod without it.** Every mod we have played against had one. The pipeline reads mods the same way as maps, so a Campaign Mod without it should load the same; the cost would at most be assets streamed on first use rather than at load, and only for Blizzard files not already downloaded. Before a mod compile drops it as an accepted difference (spec #277), play a Mission against a copy of the Campaign Mod with `PreloadAssetDB.txt` removed. Since the Editor writes it again on every save of the mod, a compile that drops it will see it come back after an Editor save.
- **Deferred: a Campaign's two mods keep it.** The author deferred the test (2026-11-02, #333): preloads being there can't cause a problem, but removing them could. So `PreloadAssetDB.txt` and `Preload.xml` stay Kept in its Campaign Mod, and `PreloadAssetDB.txt` in its Asset Mod. Their `DocumentInfo` preloads are the Editor's, 13 and 1, since a compile only drops an `AssetFile` preload that nothing names any more and never adds one (#312).

## `testmod` and `extramods`

Sources: `dependency-manager.md` ("CVariable Command-Line Controls"), `runtime/game-data-loading.md` § 6 (Layer 2).

| cvar | Value | Effect on each map load |
|---|---|---|
| `testmod` | `A` or `A;B` (only the first two tokens are read) | `A` alone is appended as the map's last dependency. `A;B` replaces dependency `B` with `A` in place, if the map has `B`; otherwise `A` is appended. |
| `extramods` | `A;B;C...` | Each non-empty token is appended in order. Open for `-run` and Editor map loads. |
| `meleeMod` | default `Void` | Picks the multiplayer mod stack (`LibertyMulti` → `SwarmMulti` → `VoidMulti`). Not relevant to campaign maps. |
| `run` | path | Launches a `.SC2Map`, `.SC2Replay` or `.SC2Save`. |

- Order of processing: `testmod`, then `extramods`, then `meleeMod`.
- `testmod` is read per map load, not at boot. An Editor-initiated map load overwrites it with the request's own testmod fields.
- Absolute paths to loose folders worked in the doc author's tests. Because these mount after the map's dependencies, they override them.
- Each switch is also a cvar of the same name, so it can go on the command line (`-testmod <path>`) or in `Variables.txt`.

Use for us: test a changed copy of a Campaign Mod without editing generated maps (`-testmod /path/Campaign-test.SC2Mod;Mods\Campaign.SC2Mod`), or add a debug mod to every test map with `-extramods`. How `B` has to be spelled to match our `file:` dependency (path only, slash direction) isn't documented; try it before relying on it.

## Packing to MPQ

Sources: `mpq-reader.md` ("MPQ Header Format", "MPQ vs DIR"), `tools/mpqcli/README.md`, `galaxy-vm-interpreter.md` §15.8.

- Storm looks for the `MPQ\x1A` header at 512-byte-aligned offsets, so an archive can carry a prefix (Storm also tracks an `MPQ\x1B` user-data block). Header sizes: v0 32, v1 44, v3+ 208 bytes. Sector size is `512 << shift`.
- The repo vendors `mpqcli` v0.10.2 (StormLib, Windows build): `mpqcli create --game starcraft2 --output Maps/x.SC2Map <folder>`, plus `list`, `extract`, `verify`, `info`. Upstream is cross-platform but would need building for macOS.
- **A packed archive is required for SC2API `CreateGame`.** The map-path resolver only takes archive files, relative to `<install>/Maps/`, and rejects folders. The doc author repacked an unpacked map with `mpqcli` for every headless run.
- Not required for the Editor or Test Document, which take our unpacked folders. Battle.net publishing and `.SC2Campaign` distribution will need packing too.
- Two other writers to borrow from: `erivgout/sc2-map-editor-mcp`'s StormLib settings (MPQ v1, zlib, regenerated `(listfile)`, backslash paths) and `koda-27/sc2publish` (MIT; deterministic MPQ v0). See [related-repos.md](./related-repos.md).

## Our writers against the docs

| Item | Docs | Our writer | Verdict |
|---|---|---|---|
| `DocumentHeader` required | Game reads deps from it; `537067531` without it | Always written | Agree |
| `DocumentHeader` magic/version | FourCC + version ≤ 8 | `H2CS`, `8` | Agree |
| Build ID | `pathroot-system.md` `VersionInfo`: flag `1`, major, minor, patch, build, data build | `01 05 00 11`, 98310 twice | Agree. `document-header.md` names the four bytes major/minor/revision/flag, i.e. flag last; the Editor writes the flag first, as `VersionInfo` does. |
| `DocumentHeader` dependencies | Per dependency: name, path name, 64-bit ID, path, 16 bytes of cached offsets | NUL-terminated dependency string only | **Conflict. Ours wins.** The doc's layout is the in-memory struct. Our writer is byte-exact against an Editor-saved header, and a local Campaign Mod's own header has the same NUL-terminated strings. |
| `DocumentHeader` trailing entries | "Locale entries": NUL-terminated key, u32 locale ID, NUL-terminated value | u16-length key, `SUne` (enUS), u16-length value: the map's name, descriptions and player names | **Conflict. Ours wins**, for the same reason. The doc's "locale entries" are the localized attributes. |
| Fields after the build | `field_18`, `field_1C`, `field_20`, `field_24`, `field_28` unnamed | 0, document ID, document ID, 1, 0 | Matches the Editor's map output. A Campaign Mod's header has `2` and `0` in the first and fourth, so these differ between maps and mods. |
| `DocumentInfo` | `<DocInfo>`, `<ModType>`, `<Dependencies><Value>` | Same | Agree |
| Dependency string | `bnet:...,file:...` | Default `bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod`; a local mod as `file:Mods\<Name>.SC2Mod` | Agree |
| `ComponentList` | `<DataComponent Type Locale>`; `Optimized` described as an attribute | `<Optimized/>` element, then entries in Editor order | Ours matches Editor output (an imported Kept map has the same element). The doc's description is loose. |
| Triggers in the game | `trig` skipped outside the Editor | We write `Triggers` and `MapScript.galaxy` from one model | Agree; the script is what runs |
| `.version` | v2, 44 bytes, field at `+0x20` is an "entry count" | Same layout, `+0x20` called `saveCount`, value 1 | Agree on bytes. The field's meaning is unsettled; 1 matches the Editor. |
| Map overrides | Map mounts last; later archive wins | Lighting, textures, effects as map-local catalogs | Agree, and verified in game |
| `Preload.xml`, `PreloadAssetDB.txt`, `BankList.xml` | Optional preload hints, read at load | Not written | Gap, harmless for maps: ours load and play without them (see above) |

One inconsistency in our own code, not in the docs: when a blueprint has no `dependencies`, `writeDocumentInfoXml` falls back to the Void dependency but `writeDocumentHeader` gets an empty list. Since the game resolves from `DocumentHeader`, such a map would load with no Void dependency. Every current blueprint sets `dependencies`, so it hasn't shown up.

## Applying this to sc2-adjutant

1. Fix the default: resolve `dependencies ?? [DEFAULT_DEPENDENCY]` once in `write-map-package.ts` and pass the same list to both `DocumentInfo` and `DocumentHeader`. Add a test that the two always agree.
2. Get an Editor-saved Void-only map header (e.g. re-save `base-test-map.SC2Map`) and add it as a second golden fixture, so the `bnet:...,file:...` form is covered too.
3. Add `validate-map` checks for this layer: every dependency's `file:` path exists under the install (or `Mods/` symlinks) and contains `DocumentHeader` and `Base.SC2Data`; `ComponentList` entries all have files and `.version` files with matching tags; `DocumentHeader` and `DocumentInfo` list the same dependencies.
4. Check texture and asset names ourselves (map-data `BlendTextures`, `t3Terrain.xml` textures, voice files referenced from `SoundData.xml`), against the tileset table and the files we write, with exact case. The game fails silently.
5. Write a `Preload.xml` like the Editor's (`SYSTEM_ActorConfig`, tileset, placed unit types). Cheap and closer to Editor output; low priority.
6. Use `-testmod` / `-extramods` for Campaign Mod experiments and a debug mod. A direct launch doesn't work on the Mac, so put them in the Editor's Test Document extra arguments ([game-testing.md](./game-testing.md) §1).
7. For the SC2API route to a headless `validate-map` (Windows only; the Mac client ignores `-listen`), add a pack step (StormLib or a TypeScript MPQ writer, deterministic) and copy the packed map into `<install>/Maps/` before `CreateGame`.
8. Keep `ComponentList`, `.version` and `DocumentHeader` byte-exact with Editor output over the docs, as now.
