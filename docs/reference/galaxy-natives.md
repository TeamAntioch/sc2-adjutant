# Galaxy Natives

What the reverse-engineered native table tells us about the Galaxy calls our generated `MapScript.galaxy` makes, what it leaves out, and how to turn it into a `validate-map` check.

Sources:

- `sc2-ida-mcp-setup` (read-only clone of `github.com/sc2-arcade-watcher/sc2-ida-mcp-setup`), notes on the Windows client, build 96921 (5.0.15). We target 5.0.17 (build 98310). Names, type codes and error names carry over; addresses, struct offsets and registration indices don't, so they are left out. Paths below are relative to the clone.
  - `output/galaxy-native-binding-96921.json`
  - `docs/galaxy-native-catalog.md`
  - `docs/galaxy-vm-interpreter.md`
- Our writers: `packages/core/src/triggers/trigger-catalog.ts` and `packages/core/src/triggers/write-map-script.ts`.
- Our trigger findings, [map-package-findings.md](./map-package-findings.md#triggers), and the `sc2-ida-mcp-setup` entry in [map-package-findings.md](./map-package-findings.md#tools-evaluated).

Nothing here was tested in the game. Counts and arities come from reading the JSON with a scratch script.

## What applies to us

| Applies to our Mac 5.0.17 build | Build-specific internals (not used here) |
|---|---|
| Native names and arities | Implementation addresses (`impl` in the JSON) |
| One-letter type codes and their Galaxy types | Registration / dispatch index (`i`) |
| Trigger function signature `bool (bool, bool)` | VM struct layouts and offsets |
| Error names (`e_execTimeout`, ...) and the 8 MB code limit | Numeric error IDs (keep only as identifiers) |
| `MapScript.galaxy` is compiled on every map load | Opcode table, GC handle layout |

Natives added after 5.0.15 are missing from the JSON. Natives whose arity changed would show up as false mismatches. Neither case has been seen in our calls.

## The binding JSON

Source: `output/galaxy-native-binding-96921.json`.

Top level: `build` (96921), `count` (2874), `note`, `rows`. Each row:

| Field | Meaning | Use to us |
|---|---|---|
| `i` | Registration index, which is also the case number in the VM's native switch | None. Bytecode isn't stored in maps. |
| `name` | Native name as written in Galaxy (`UnitCreate`) | Yes |
| `impl` | Address of the implementation in the 96921 Windows binary | None |
| `arity` | Parameter count | Yes |
| `ret` | Return type code, or `null` | Yes |
| `params` | One type code per parameter; `"-"` for zero parameters; or `null` | Yes |
| `impl_name` | Set for 23 stubs: 21 shared `nullsub` stubs (e.g. `DebugInt`, `DebugFixed`, `DebugPoint`) and 2 camera natives kept under other names | Tells you a native does nothing in release builds |

Names are unique. For every row with a signature, `len(params) == arity`.

### Count

The JSON has 2,874 rows. `docs/galaxy-native-catalog.md` says 2,857. The difference is the 17 natives with 7 or more parameters. The catalog's registration table only covers the 1-to-6-parameter registrars, and those 17 are the rows with null signatures below.

Arity distribution: 0 → 310, 1 → 683, 2 → 1,004, 3 → 539, 4 → 205, 5 → 88, 6 → 28, 7 → 13, 8 → 1, 10 → 1, 12 → 1, 13 → 1.

### Natives with null signatures

These 17 rows have `arity` but `ret` and `params` are `null`. Only the arity can be checked from the JSON.

| Native | Arity |
|---|---|
| `AIDefaultEconomy` | 7 |
| `AILimitTech` | 7 |
| `AIBestTargetPoint` | 8 |
| `MakeMsgAnimBracketStart` | 7 |
| `MakeMsgAnimPlay` | 7 |
| `CameraShakeStart` | 7 |
| `DialogControlSetPositionRelative` | 7 |
| `DialogControlInvokeAsText` | 7 |
| `DialogControlInvokeAsString` | 7 |
| `PortraitCreate` | 10 |
| `SoundPlayAtPointForPlayer` | 7 |
| `SoundPlayOnUnitForPlayer` | 7 |
| `TextTagCreate` | 7 |
| `TransmissionSendForPlayerSelect` | 13 |
| `TransmissionSendForPlayer` | 12 |
| `UnitAbilitySpendExplicit` | 7 |
| `TriggerAddEventKeyPressed` | 7 |

`TransmissionSendForPlayerSelect` is the native behind our "Send Transmission For Player" call, so its argument types can't be checked from this file.

### Type codes

37 codes. The Galaxy type names come from the compiler type table in `docs/galaxy-vm-interpreter.md` §13.3. Counts are from the JSON (the occurrence column in `docs/galaxy-native-catalog.md` mixes return and parameter counts, so don't rely on it).

| Code | Galaxy type | As return | As parameter |
|---|---|---|---|
| `-` | void (also the `params` value for zero parameters) | 1,456 | — |
| `?` | bool | 245 | 461 |
| `1` | byte | 2 | 2 |
| `2` | color | 9 | 31 |
| `3` | fixed | 145 | 348 |
| `4` | int | 445 | 2,237 |
| `s` | string | 151 | 1,108 |
| `x` | text | 55 | 157 |
| `U` | unit | 70 | 374 |
| `u` | unitgroup | 43 | 68 |
| `v` | unitref | 4 | 44 |
| `f` | unitfilter | 4 | 13 |
| `p` | point | 66 | 149 |
| `r` | region | 10 | 39 |
| `l` | playergroup | 11 | 226 |
| `T` | trigger | 6 | 127 |
| `t` | timer | 5 | 14 |
| `a` | abilcmd | 13 | 29 |
| `o` | order | 12 | 27 |
| `d` | soundlink | 3 | 16 |
| `n` | sound | 3 | 9 |
| `y` | transmissionsource | 7 | 5 |
| `i` | actor | 14 | 25 |
| `e` | actorscope | 10 | 12 |
| `M` | doodad | 3 | 3 |
| `m` | marker | 6 | 19 |
| `R` | revealer | 4 | 5 |
| `c` | camerainfo | 4 | 9 |
| `b` | bank | 5 | 53 |
| `W` | wave | 7 | 42 |
| `w` | waveinfo | 4 | 7 |
| `g` | wavetarget | 23 | 10 |
| `j` | aifilter | 3 | 23 |
| `k` | effecthistory | 1 | 9 |
| `z` | bitmask | 1 | 18 |
| `{` | datetime | 4 | 13 |
| `q` | generichandle | 3 | 4 |

The catalog doc calls `q` "animquery". The VM doc's compiler table calls it `generichandle`, and `DataTableGetGenericHandle` returns `q`, so `generichandle` is the better name (anim queries are one kind of handle).

### What's missing

- **Parameter names.** Only types.
- **Constants.** No `c_*` values (`c_gameOverVictory`, `c_timeGame`, ...). The Galaxy compiler knows them; the JSON doesn't.
- **Ntve FunctionDef, ParamDef and Preset IDs.** The JSON is the engine side. The Editor's GUI IDs (`00B542C6` and so on) live in the trigger library definitions.
- **Library functions.** `libNtve_gf_*`, `libHots_*`, `libVCMI_*` and a Campaign Mod's own `lib<Prefix>_*` are Galaxy code in TriggerLibs, not natives, so they aren't listed.
- **Signatures for the 17 natives above.**
- **Anything added after build 96921.**

## Natives, FunctionDefs and library functions

Three layers, which the Editor blurs:

1. **Native.** An engine function with no Galaxy body, declared `native` in `TriggerLibs/natives.galaxy`. This is what the JSON lists.
2. **Ntve FunctionDef.** A GUI definition in `NativeLib.TriggerLib` (library `Ntve`), referenced by opaque ID in our `Triggers` XML. Many FunctionDefs render straight to one native call: "Game Over" (`00000198`) becomes `GameOver(...)`. The Galaxy argument order follows the native and can differ from the XML parameter order (see `sendTransmission` in `trigger-catalog.ts`). [map-package-findings.md](./map-package-findings.md#triggers) says the XML order is definition order; the header comment in `trigger-catalog.ts` says it is whatever the Editor wrote and can differ. We copy the Editor either way.
3. **Library function.** A FunctionDef with a Galaxy body. The Editor compiles it into the library script as `libNtve_gf_<Name>`, and the map script calls that. Example: "Unit In Region" (`22E8E351`) renders `libNtve_gf_UnitInRegion(...)`. Library enums show up as `libNtve_ge_*` presets. The map reaches them through `include "TriggerLibs/NativeLib"` and `libNtve_InitLib()`.

Some FunctionDefs render as operators rather than calls: "Set Variable", "Comparison" and "Arithmetic (Real)" in our catalog.

Where to get full prototypes:

| Need | Source |
|---|---|
| Native prototypes with parameter names, plus `c_*` constants | `TriggerLibs/natives.galaxy` in `sc2-arcade-watcher/sc2-game-data` |
| FunctionDef / ParamDef / Preset IDs and their Galaxy rendering | `mods/core.sc2mod/base.sc2data/TriggerLibs/NativeLib.TriggerLib` in `SC2Mapster/SC2GameData` (patch 5.0.3; every ID we checked matches 5.0.17) |
| Display names | `enus.sc2data/LocalizedData/TriggerStrings.txt` in the same repo |
| Campaign libraries (VCMI, Hots) | `campaigns/voidstory.sc2campaign/base.sc2data/TriggerLibs/` in `SC2Mapster/SC2GameData` |
| A Campaign Mod's own library | its `Triggers` file, in the mod's package |

## Natives our writers call

Regenerated on 2026-10-25 by scanning string and template literals in `packages/core/src/triggers/trigger-catalog.ts` and `packages/core/src/triggers/write-map-script.ts`, then cross-checked against the generated `MapScript.galaxy` for a compiled Mission and `lighting-preview` and the three Editor fixtures in `packages/core/tests/fixtures/editor-triggers/`. Script: `scan_natives.py` in the session scratchpad (`/private/tmp/claude-501/-Users-abw-repos-sc2-mapper/b7d1d154-e2f1-4db7-9fd3-ac1e6ee665ca/scratchpad/scan_natives.py`).

Every call below exists in the 96921 table, and the argument count we emit equals its arity.

| Native | Arity | Signature (ret ← params) | Emitted by |
|---|---|---|---|
| `AbilityCommand` | 2 | `a ← s4` | `abilcmd` value |
| `EventUnit` | 0 | `U ← -` | `triggeringUnit` |
| `GameOver` | 4 | `- ← 44??` | `gameOver` |
| `GameSetLighting` | 2 | `- ← s3` | `setLighting` |
| `ObjectiveCreate` | 4 | `4 ← xx4?` | `objectiveCreate` |
| `ObjectiveLastCreated` | 0 | `4 ← -` | `lastCreatedObjective` |
| `ObjectiveSetState` | 2 | `- ← 44` | `objectiveSetState` |
| `OrderTargetingPoint` | 2 | `o ← ap` | `orderTargetingPoint` |
| `PlayerCreateEffectUnit` | 3 | `- ← 4sU` | `playerCreateEffectUnit` |
| `PlayerGroupAll` | 0 | `l ← -` | `allPlayers` |
| `PointFromId` | 1 | `p ← 4` | `point` value |
| `RegionFromId` | 1 | `r ← 4` | `region` value |
| `SoundLink` | 2 | `d ← s4` | `soundlink` value |
| `SoundPlayForPlayer` | 5 | `- ← d4l33` | `playSound` |
| `StringExternal` | 1 | `x ← s` | `text` value |
| `StringToText` | 1 | `x ← s` | empty `text` value |
| `TechTreeRestrictionsEnable` | 2 | `- ← 4?` | `techRestrictionsEnable` |
| `TechTreeUnitAllow` | 3 | `- ← 4s?` | `allowUnit` |
| `TechTreeUpgradeAllow` | 3 | `- ← 4s?` | `allowUpgrade` |
| `TimerCreate` | 0 | `t ← -` | `newTimer` |
| `TimerPause` | 2 | `- ← t?` | `timerPause` |
| `TimerStart` | 4 | `- ← t3?4` | `timerStart` |
| `TimerWindowCreate` | 4 | `4 ← tx??` | `timerWindowCreate` |
| `TimerWindowLastCreated` | 0 | `4 ← -` | `lastCreatedTimerWindow` |
| `TimerWindowShow` | 3 | `- ← 4l?` | `timerWindowShow` |
| `TransmissionSendForPlayerSelect` | 13 | null | `sendTransmission` |
| `TransmissionSource` | 0 | `y ← -` | `noTransmissionSource` |
| `TransmissionSourceFromModel` | 1 | `y ← s` | `modelTransmissionSource` |
| `TransmissionSourceFromUnit` | 4 | `y ← U??s` | `unitTransmissionSource` |
| `TransmissionSourceFromUnitType` | 2 | `y ← s?` | `unitTypeTransmissionSource` |
| `TriggerAddEventMapInit` | 1 | `- ← T` | `mapInit` |
| `TriggerAddEventTimer` | 2 | `- ← Tt` | `timerExpires` |
| `TriggerAddEventUnitDied` | 2 | `- ← Tv` | `unitDies` |
| `TriggerAddEventUnitRegion` | 4 | `- ← Tvr?` | `unitEntersRegion` |
| `TriggerCreate` | 1 | `T ← s` | every trigger's `_Init` |
| `TriggerDebugOutput` | 3 | `- ← 4x?` | `triggerDebugOutput` |
| `TriggerEnable` | 2 | `- ← T?` | `triggerEnable` |
| `TriggerExecute` | 3 | `- ← T??` | `triggerExecute` |
| `TriggerGetCurrent` | 0 | `T ← -` | `currentTrigger` |
| `UIDisplayMessage` | 3 | `- ← l4x` | `textMessage` |
| `UnitCreate` | 6 | `u ← 4s44p3` | `unitCreate` |
| `UnitFromId` | 1 | `U ← 4` | `unit` value |
| `UnitGetOwner` | 1 | `4 ← U` | `unitOwner` |
| `UnitGetPosition` | 1 | `p ← U` | `unitPosition` |
| `UnitGetPropertyFixed` | 3 | `3 ← U4?` | `unitPropertyFixed` |
| `UnitIssueOrder` | 3 | `? ← Uo4` | `unitIssueOrder` |
| `UnitLastCreated` | 0 | `U ← -` | `lastCreatedUnit` |
| `UnitRefFromUnit` | 1 | `v ← U` | unit params with `unitRef` |
| `UnitRefFromVariable` | 1 | `v ← s` | variable params with `unitRef` |
| `UnitSetPropertyFixed` | 3 | `- ← U43` | `setUnitPropertyFixed` |
| `Wait` | 2 | `- ← 34` | `wait` |

The three `TechTree*` rows were added on 2026-10-31 for a blueprint's `tech` and checked against the 96921 table by hand, not by the scan.

`UnitCreate` returns a unit group and `UnitIssueOrder` returns a bool; we use both as statements and ignore the result, as the Editor does. The two `TriggerAddEventUnit*` events take a `unitref` (`v`), which is why `ParamDef.unitRef` exists.

### Calls that aren't natives

| Call | What it is |
|---|---|
| `libNtve_gf_CinematicPortrait` | NativeLib library function (`cinematicPortrait`) |
| `libNtve_gf_UnitInRegion` | NativeLib library function (`unitInRegion`) |
| `libVCMI_gf_SendTransmissionCampaignPlaceHolder` | VoidCampaignMissionLib function; catalogued, not used by generated missions |
| A Campaign Mod's own transmission function (`lib<Prefix>_gf_SendTransmission…`) | Campaign library function; catalogued, not used for now |
| `libNtve_InitLib`, `libHots_InitLib`, `libVCMI_InitLib`, a Campaign library's `lib<Prefix>_InitLib` | Library init functions, called from `InitLibs` |
| `InitLibs`, `InitGlobals`, `InitTriggers`, `InitMap`, `gt_*_Func`, `gt_*_Init` | Functions the map script defines itself |

Preset values that aren't native constants: `libNtve_ge_CinematicPortraitPosition_CenterLeft` / `_CenterRight`, `libVCMI_ge_MissionTransmissionPortraitOptioins_HidePortraitAfter` (Blizzard's spelling), `libVCMI_ge_MissionTransmissionCueSoundOptions_DefaultCueSoundBehavior`. The `c_*` presets we emit (`c_gameOverVictory`, `c_objectiveStateCompleted`, `c_timeGame`, `c_unitPropLife`, `c_maxPlayers`, ...) are native constants, but the JSON can't confirm them.

## VM facts that matter for generated scripts

Source: `docs/galaxy-vm-interpreter.md` §§ 1, 2, 9, 10, 13, 14.1, 15.4, 15.6.

### Trigger functions

- The engine calls every trigger function with the signature `?(??)`: `bool f(bool testConds, bool runActions)`. Our `gt_<Name>_Func (bool testConds, bool runActions)` matches.
- The call validates the signature string before running. A mismatch returns `e_functionNotFound` and nothing runs. So the function named in `TriggerCreate("gt_X_Func")` must exist with exactly that signature.
- Bit 0 of the caller's status is "evaluate conditions", bit 1 is "run actions".

### Wait and yield

- `Wait` pauses the thread with `e_execPaused`. On the trigger path the frame and thread are kept and resumed later. That is how `Wait` works inside a trigger.
- Engine event handlers (the non-trigger path) run on a pool of 8 internal threads and are **not allowed to yield**. They return `e_noInternalThread` when the pool is exhausted. Our scripts don't define event handlers, only triggers.
- `TriggerExecute(t, checkConds, wait)` with `wait = true` runs the target on the caller's timeline; with `false` it doesn't block. (Behaviour of the native, not something the VM doc covers.)

### Size limits

| Limit | Value | Error |
|---|---|---|
| Compiled bytecode (all scripts loaded for the map) | 8 MB (`0x800000`) | `e_scriptTooLarge` |
| Global data addresses | below 16 MB (`0x1000000`): globals and interned constants share one segment | none named in the doc |
| VM stack | 4 MiB segment; call frames are checked | `e_stackOverflow` |
| Instruction budget per run | not given | `e_execTimeout` |

The code limit counts everything compiled for the map, including the included TriggerLibs, not only `MapScript.galaxy`. Our scripts are a few kilobytes, so none of this is close. A long loop with no `Wait` is the realistic way to hit `e_execTimeout`.

### Runtime error names

From `Galaxy__RegisterErrorStrings`. The names are what to match in logs; the numeric IDs are build data and only useful as identifiers.

| Name | Raised when |
|---|---|
| `e_divByZero` | Integer or fixed division / modulo by zero |
| `e_numericOverflow` | Division overflow |
| `e_stackOverflow` / `e_stackUnderflow` | Call frame push / pop out of range |
| `e_arrayIndexOverflow` / `e_arrayIndexUnderflow` | Array bounds check failed |
| `e_invalidAddr`, `e_invalidGlobalPtr`, `e_invalidStackPtr`, `e_invalidCodePtr` | Bad memory access |
| `e_referenceTableFull`, `e_referenceCountOverflow` | Too many live strings/handles |
| `e_nativeCodeError` | A native failed |
| `e_functionNotFound` | Host call with a signature that doesn't match (e.g. a trigger function that isn't `bool (bool, bool)`) |
| `e_execTimeout` | Instruction budget exhausted |
| `e_execPaused` | Normal yield (`Wait`), not an error |
| `e_scriptTooLarge` | Code over 8 MB |
| `e_unknownInstr` | Bad bytecode (shouldn't happen with compiled source) |
| `e_noInternalThread` | Event-handler thread pool exhausted |

The full table has about 180 entries including compiler front-end errors. The doc doesn't list the compiler messages.

### Compile on load

- `MapScript.galaxy` is plain Galaxy source. It is compiled every time the map loads; nothing compiled is stored in the map (`docs/galaxy-vm-interpreter.md` §13.1, §15.8).
- Order: compile the map script, compile each TriggerLib, then run the top-level `InitMap` function.
- A compile error therefore shows up as a failed or empty map load, not as a runtime error. [map-package-findings.md](./map-package-findings.md#logs-and-testing) lists the log patterns to look for (`Script compile error:`, `Script load failed:`, `Trigger Error in ... Near line`); those come from `erivgout/sc2-map-editor-mcp`, not from this doc.
- Function and global tables are rebuilt on each map load and cleared on unload.

## Proposed `validate-map` lint

A static check over a generated package, run after `compile-map`. Pass/skip/unsupported results, as [map-package-findings.md](./map-package-findings.md#logs-and-testing) suggests.

What it checks:

1. **Native names.** Every call in `MapScript.galaxy` that isn't defined in the script and isn't a `lib*_gf_*` / `lib*_InitLib` name must be in the native table. Unknown names are a warning, not an error, because the table is from 5.0.15.
2. **Arity.** Argument count equals `arity` for every native call, including the 17 with null signatures.
3. **Argument types, where cheap.** For literal arguments and for calls to natives with known return codes: `UnitFromId(...)` passed where a `v` is expected is an error; an `int` literal where `s` is expected is an error. Skip anything involving variables, operators or library calls.
4. **Trigger wiring.** Each `TriggerCreate("<name>")` names a function defined in the script as `bool <name> (bool testConds, bool runActions)`, and each `trigger` global is assigned in an `_Init` that `InitTriggers` calls.
5. **Library calls.** Every `lib<X>_*` call has a matching `include` and `lib<X>_InitLib()` in `InitLibs`. A Campaign library that requires Hots and VCMI needs both, as `usedLibraries` already enforces.
6. **IDs that point into the map.** `UnitFromId`, `PointFromId` and `RegionFromId` arguments exist in `Objects` / `Regions`.
7. **String keys.** Every `StringExternal("Param/Value/<id>")` key is in `enUS.SC2Data/LocalizedData/GameStrings.txt`.
8. **Size.** Warn long before 8 MB of source; there is no exact source-to-bytecode ratio.

What it can't check:

- Whether the script compiles. There is no Galaxy compiler here, so syntax and full type checking need the game and a log scrape, or a third-party parser. [plaxtony](https://www.npmjs.com/package/plaxtony) (npm) has type-checked a hand-written script against Blizzard's `natives.galaxy` outside the Editor (2026-11-11).
- Types for the 17 natives with null signatures, including `TransmissionSendForPlayerSelect`, unless we load `natives.galaxy`.
- `c_*` constant names and `libNtve_ge_*` / `lib*_gf_*` names and signatures, unless we load `natives.galaxy` and the library headers.
- Catalog references inside strings (a custom hero unit's id, `"SolarFlareDamage"`, `"BelShirFlare"`, sound IDs). Those need the GameData catalogs of the map and its dependencies.
- Runtime behaviour: infinite loops (`e_execTimeout`), divide by zero, wrong game logic.
- Natives added in 5.0.16 or 5.0.17.

## Applying this to sc2-adjutant

1. Copy the name/arity/ret/params columns of the binding JSON into `packages/core/data/galaxy-natives.json` (drop `i`, `impl`, `impl_name`) with a note on the source build. Keep it read-only data.
2. Add `validate-map` checks 1, 2, 4 and 5 first. They are a few dozen lines over a token scan and would have caught nothing so far, but they guard every new catalog entry.
3. Add a unit test that renders every `NTVE_FUNCTIONS` entry with dummy arguments and checks name and arity against the table, so a catalog mistake fails `npm run test` rather than Test Document.
4. Fetch `TriggerLibs/natives.galaxy` from `sc2-arcade-watcher/sc2-game-data` to fill in parameter names, the 17 missing signatures and the `c_*` constants. Then extend check 3 and add constant checks.
5. Add checks 6 and 7, which only need files we already write.
6. When we add a test harness (`TriggerDebugSetTypeFile` + `TriggerDebugOutput`, both in the table), have the Test Document flow scrape `GameLogs` for the `e_*` names above and the compile-error patterns in [map-package-findings.md](./map-package-findings.md#logs-and-testing).
7. Keep any looping triggers on a `Wait`. The budget behind `e_execTimeout` isn't documented.
