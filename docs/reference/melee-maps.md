# What makes a map Melee

The Galaxy Editor sorts every map as **Melee** or **Custom**, and shows which in Map > Map Status. A map shows "Melee" only when none of the reasons below apply. When the map passes, Map Status says "All melee requirements have been met". The evidence is the Editor's own Map Status and strings, and Blizzard's 21 ladder maps of the 2019 Season 3 pool. The compiler's melee path (`map/compile-melee-map.ts`) writes a map that passes, and `map/melee-status.ts` checks the compiled package against every reason before writing it ([ADR 0009](../adr/0009-melee-maps.md)).

## The Editor's reasons a map isn't Melee

These are the Editor's own strings, from `EditorStrings.txt` in the core mod. Each is followed by what passes, as measured on all 21 ladder maps.

| Reason (the Editor's words) | What passes |
|---|---|
| Custom dependencies (see File > Dependencies) | `bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod` only. The game adds the multiplayer balance mods itself |
| Custom attributes (see Map > Game Attributes) | None |
| Custom 'TYPE' game data (COUNT) | Cosmetic catalogs only: TerrainData, LightData, WaterData (and TerrainTexData, SoundData, ModelData on some ladder maps). ActorData doodad actors (Doodad Composites) were tested and stay Melee. UnitData, AbilData and BehaviorData are untested, and contest rules forbid data that changes units anyway |
| Additional expansion data is not allowed; Arcade map (see Map > Map Options) | MapInfo publish mode 0 |
| Minimap Preview is not set to Map Image | Preview set to the map image |
| Show User Difficulty is not set to None | Difficulty 0 |
| Unexplored Areas is not set to Grey Mask | Fog `Dark` |
| Disable Replay Recording is set; Use Horizontal Field Of View is set | Game-option bits 0x01 and 0x10 clear. Ladder maps carry `0x4000` only ("All Units Use Base Height") |
| Custom loading screen | Loading screen type 0 (Melee) |
| Player ID is set to 'TYPE' control | User players. No Computer players |
| Player ID race is not set to Any | Race Any, with no AI or race name |
| Player ID start location is not set to Random | Start location 0 (random) |
| Player ID has pre-placed units, but is not Neutral | Every pre-placed unit owned by player 0 |
| Not enough Start Locations for all non-neutral players | One `ObjectPoint Type="StartLoc"` per spawn, at the town hall's centre (x.5, y.5) |
| Custom trigger libraries exist; Custom trigger elements exist | None |
| No triggers exist; Custom triggers exist; Trigger does not match default melee trigger | Only the stock "Melee Initialization" trigger, calling `MeleeInitResources`, `MeleeInitUnits`, `MeleeInitAI` and `MeleeInitOptions` at map init, with only `TriggerLibs/NativeLib` included. Data > Reset All Data restores it |

The MapInfo half of this list matches the reverse-engineered `MapInfo__CheckNonMeleeConditions` in [sc2-file-format-docs](https://github.com/sc2-arcade-watcher/sc2-file-format-docs/blob/main/mapinfo.md), which also wants locale mode 1.

## What else ladder maps share

None of these is a melee reason, but all 21 ladder maps have them, and the compiler writes them the same way:

- MapInfo version 39 and speed mode 0;
- player slots Neutral (0), Players 1-N and Hostile;
- the variant block's start-location list left empty, since the StartLoc points place the players;
- resources placed by unit type, never with a set amount, so the game's balance data sets them.

## Checking a map

- **In the Editor:** Map > Map Status, which lists every reason that applies.
- **From a package:** `meleeStatusReasons` in `map/melee-status.ts` runs the same list on an unpacked map. It found no reason on any of the 19 two-player ladder maps. `forbiddenFeatures` beside it checks the forbidden features of TeamLiquid's map contest ([TLMC 22](https://tl.net/forum/starcraft-2/644151-team-liquid-map-contest-22-presented-by-monster-energy)), which the Editor doesn't.
