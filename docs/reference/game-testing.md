# Testing Maps in the Game Client

How to load a generated map in StarCraft II without clicking Test Document in the Editor, and how to tell from outside whether it worked. This is the groundwork for `validate-map`.

**Update 2026-10-27:** on the Mac the answer is "you can't". A bare launch exits within a second, and the game ignores `-listen`, so the SC2API is unavailable. Tests start through the Editor's Test Document. The ClientAPI on port 6119 does work, and reports whether the map loaded and how it ended. Details in the table below, [§1](#the-launcher-handshake-and-exit-code-47), [§2](#booting-in-listen-mode) and [§5](#5-the-clientapi-http-server).

Written 2026-10-25. Most of it comes from [`sc2-arcade-watcher/sc2-ida-mcp-setup`](https://github.com/sc2-arcade-watcher/sc2-ida-mcp-setup), reverse-engineering notes on the **Windows** client, build 96921 (5.0.15). We run the **Mac** client, 5.0.17 (build 98310). Paths below like `docs/sc2api-raw-client.md` refer to that repo. Addresses in it don't apply to us. Names usually carry over: cvars, command-line switches, protobuf messages, error strings, file formats.

## What is verified here

Every section is tagged with one of these:

- **Mac, verified:** shown on this machine by manual launches (Battle.net, the Editor's Test Document, direct attempts) or by the game's own logs in `~/Library/Application Support/Blizzard/StarCraft II/`. Nothing in this doc was tested for it. These are observations of what already runs.
- **Windows, documented:** from the RE notes. It should carry over, but nobody has tried it on the Mac.
- **Unknown:** the sources disagree, or don't say.

What the Mac has shown so far:

| Fact | Evidence |
|---|---|
| The Editor's Test Document launches `-run Test/EditorTest.SC2Map -displaymode 2 -preload 1 -NoUserCheats -reloadcheck -meleeMod Void -difficulty 2 -speed 2` | `<Parameters>` line at the top of every GameLogs file it leaves |
| Executable `/Applications/StarCraft II/Versions/Base98310/SC2.app`, version `5.0.17.98310`, `CodeBranch branches/SC2.5.0.a`, `Exe.Architecture x86_64` | same GameLogs header |
| ~~Launching `SC2.app/Contents/MacOS/SC2` directly with `-run` works~~ **Wrong, corrected 2026-10-27.** A direct launch exits with status 1 within about a second, leaving only an empty `SystemInfo.txt` and no crash report. It fails with or without `-run` or `-listen`, through `open` or the shell, and on macOS 26 and 27.2. The game starts only from Battle.net or from the Editor's Test Document. See [§1](#the-launcher-handshake-and-exit-code-47) | `packages/core/scripts/launch-sc2.sh` (untracked), manual launches on 2026-10-25 and 2026-10-27 |
| The Editor's Test Document starts the game with `/sbin/launchd` as parent and appends its "extra arguments" setting to the command line | `ps` on the running game, 2026-10-27 |
| `-displaymode 0` gives a window, and the Editor's Windowed setting passes 0. That settles the "Unknown" in §1 for the Editor's mapping | Editor launch with Windowed on; direct launch with `-displayMode 0` under lldb opened a titled window |
| The game always opens the ClientAPI on `127.0.0.1:6119`, with no `-clientapi` switch, and it answers `/game` and `/ui` | `curl` during Battle.net and Editor launches, 2026-10-27 (§5) |
| The game ignores `-listen` (both forms) and never opens the SC2API port | Battle.net and Editor launches with the switch on the command line, 2026-10-27 (§2) |
| Logs go to `~/Library/Application Support/Blizzard/StarCraft II/GameLogs/` as `<YYYY-MM-DD HH.MM.SS> <Channel>.txt`. Channels seen: `Alerts`, `Graphics`, `ScriptError`, `SystemInfo`, `Text`, `UI` | directory listing |
| The game writes each session's log files when it exits (one session's four files, created over 14 minutes, were all last modified at the quit). See [§4](#4-logs-to-read) | file times, 2026-11-24 |
| `Variables.txt` is in the same folder, with flat `name=value` lines. This Mac has `GraphicsApi=Metal` | file contents |
| A second instance isn't safe. The script refuses to launch, or kills the running one first | `launch-sc2.sh --replace` comment: "a second instance exits at startup" |

## 1. Launching a map directly

Sources: `docs/game-editor-ipc.md` (§ Map-launch flow, § Game-side CLI ingestion), `docs/code1-ipc-testconfig-gap.md`, `docs/launcher-ipc.md`, `docs/rendering-headless.md` (§ Boot Requirements), `docs/cvariable-system.md`, `docs/cvariable-list.md`, `docs/entrypoint-and-activation.md`.

### The Editor's command line

**Windows, documented.** Test Document (Editor command `0x11`) either sends a map-load command to a running game over shared memory, or spawns the game with this command line:

```
-run "<Maps|Mods|abs path>"  [-displaymode 0|1|2]  [-trigdebug]  [-breakOnError]
  [-breakOnStart]  [-preload 0|1]  -NoUserCheats -reloadcheck  [-fixedseed]  [-seedvalue N]
  [-difficulty N]  [-speed N]  [-source "..."]  [-testmod "..."]  [-testconfig "..."]
  [-meleeMod <locale>]
```

`-NoUserCheats` and `-reloadcheck` are always passed. The Mac Editor's line (above) matches this with the defaults filled in.

Each bracketed switch comes from an Editor setting ("condition"). Settings 39–47 are the Test Document preferences:

| Switch | Game cvar | Type | Editor setting | Meaning |
|---|---|---|---|---|
| `-run <path>` | `run` | string | `TestDocDefaultMapPath` (fallback) | Map, replay or save to load. The extension picks the mode: `.SC2Map` 1, `.SC2Replay` 2, `.SC2Save` 3. Relative paths resolve against `Maps/`. |
| `-displaymode N` | `displaymode` | int, default 2 | `TestDocWindowed` → 0, `TestDocWindowedFullscreen` → 1, else 2 | Window mode. **Unknown:** `cvariable-list.md` says 0 fullscreen, 1 windowed, 2 borderless, which contradicts the Editor mapping. |
| `-trigdebug` | `trigdebug` | bool | `TestDocTrigDebug` | Opens the trigger debugger window. |
| `-breakOnError` | `breakOnError` | bool | `TestDocBreakOnError` | Stops in the trigger debugger on a script error. `cvariable-list.md` also ties it to native asserts. |
| `-breakOnStart` | `breakOnStart` | bool | `TestDocBreakOnStart` | Stops in the trigger debugger at map start. |
| `-preload 0\|1` | not a confirmed cvar | — | `TestDocPreload` | Preload assets. |
| `-NoUserCheats` | not a confirmed cvar | — | always | Presumably disables typed cheat codes. Not confirmed. |
| `-reloadcheck` | `reloadcheck` | bool, default false | always | Arms the Editor→game "load this map" command (IPC code 1). Without it the game ignores reloads silently. |
| `-fixedseed` | `fixedseed` | bool | `TestDocFixedSeed` | Use a fixed random seed. |
| `-seedvalue N` | `seedvalue` | int | `TestDocSeedValue` (only with fixed seed) | The seed. |
| `-difficulty N` | `difficulty` | int | `TestDocDifficulty` | AI difficulty. |
| `-speed N` | `speed` | int | `TestDocSpeed` | Game speed. |
| `-source "..."` | — | — | — | Not explained in the source. |
| `-testmod "A;B"` | `testmod` | string | — | Test mod. At most two tokens: `A;B` makes A replace dependency B, a single `A` is added. |
| `-testconfig <file>` | `testconfig` | string | — | `.SC2TestConfig` file that sets lobby attributes (below). |
| `-meleeMod <name>` | `meleeMod` | string | `TestDocMeleeExp` | Melee mod override. The Mac Editor passes `Void`. |
| (appended) | — | — | `TestDocExtra` | Free-form extra arguments. |

Related cvars with no Editor setting: `extramods` (string, `;`-separated, every token is added as a mod), `testtype` (int, default 0, carried into the session), `race`, `windowwidth`/`windowheight` (1024×768 default, windowed mode), `sound` (bool, default true), `frameratecap`. The `testmod`/`extramods` semantics are from `docs/plans/archive/sc2rt-runner-dll.md` §14 9cq.

### Switches are cvars, so `Variables.txt` works too

**Windows, documented.** The game doesn't have a separate argument parser for these. Every switch above, except `-preload`, `-NoUserCheats` and `-source`, is a cvar of the same name. `-name value` on the command line and `name=value` in `Variables.txt` set the same variable. A command-line value overrides `Variables.txt`.

Caveats:

- Some cvars refuse persistent sources. A cvar with typeId bit 1 set is skipped when read from `Variables.txt` but accepted from the command line. The documented example is `development`. Check with a log line before relying on `Variables.txt` for a given switch.
- The game rewrites `Variables.txt`. Bool cvars are always written back; ints and floats only when overridden. Putting `run=` or `trigdebug=1` in it would affect every later launch, including normal play. Prefer the command line.
- Dotted names (`Debug.Console`, `Query.EnableStdin`) belong to a second config system that `Variables.txt` doesn't feed (`entrypoint-and-activation.md`, § Two Separate Config Systems).

**Mac, tried 2026-11-24:** `windowwidth` and `windowheight` in `Variables.txt` had no effect on the next Test Document's window; the game rewrites the file on a clean quit, writing back the size it ran at. Don't plan on sizing the game window from the file. **Windows: unchecked.**

On the Mac the file is `~/Library/Application Support/Blizzard/StarCraft II/Variables.txt`. On Windows it's `Documents/StarCraft II/Variables.txt`.

### SC2TestConfig

**Windows, documented.** `-testconfig <path>.SC2TestConfig` sets lobby attributes that `-run` alone leaves empty. `Game__ParseRunCommand` reads the `testconfig` cvar, and at load time `LauncherSession__LoadDependencyDesc` parses the file as a **dependency descriptor XML**. It's the same parser that reads a map's `DocumentInfo`; the content tells them apart, not the extension. Registered element names:

| Element | Purpose |
|---|---|
| `Dependency` | root container |
| `Name`, `VersionMajor`, `VersionMinor`, `DepNamespace`, `LocalPath` | dependency fields |
| `Attribute` | one lobby attribute |
| `AttNamespace` | attribute namespace |
| `Id` | attribute id: 1 Debug Mode, 6 Sandbox, 10 Game Variant, 12 Team Side, 50 per-player |
| `Player` | player index |
| `Value` | attribute value. Live example: Debug Mode `0001` = Enabled, Game Variant `0003` = Premade |

The source has no sample file, so the exact nesting is unknown. Without a testconfig, a map that reads lobby attributes sees them all unset; the live test showed `unknown variant:` on screen. Our generated campaign maps don't read lobby attributes yet, so this is low priority.

### The launcher handshake and exit code 47

**Windows, documented.** A fatal assert in `Game__LauncherIPCAndConfig` requires one of:

- `-listen <addr>` on the command line,
- a debugger attached (`IsDebuggerPresent()`), or
- a completed handshake with the Battle.net launcher over the `"StarCraft II IPC Mem"` shared-memory section (64 KB): the launcher writes its pid, `state = 4` (`LIPC_LAUNCHER_ACTIVE`) and optional map/mod paths, then waits for the game's ack at `shm+0x24`.

Started with none of these, `SC2_x64.exe` "exits 47 with no diagnostics". This was reproduced on Global build 97563: bare, with `-run`, and with the Editor mappings held open. That's why Windows tools inject the handshake (`scripts/sc2_launcher_ipc.py inject`) or use `-listen`.

**Windows, verified 2026-11-18 (build 98310):** `Support\SC2Switcher.exe -run "<absolute map path>" -displaymode 0` gets past the check with no Battle.net and no Editor. The switcher starts `Versions\Base<build>\SC2.exe` and exits, and the game's window was up 12 s later. The Windows Host Adapter's `game.launch` does this ([windows-host.md](../../packages/plugin-host-windows/docs/windows-host.md#starting-the-game)).

**Mac, verified 2026-10-27 (corrects an earlier claim that a plain `-run` launch works).** The Mac build has an equivalent check:

- **Bare launch:** exits with status 1 after 1–3 s. It briefly binds `127.0.0.1:6119` and leaves an empty `SystemInfo.txt`. There's no crash report and no unified-log entry.
- **Same, with ASLR off** (`posix_spawn` with `_POSIX_SPAWN_DISABLE_ASLR`): lives about 43 s, then exits with status 1 anyway.
- **Under lldb** (the `IsDebuggerPresent()` branch above): survives, initialises Metal, and reaches the retail login screen ("Connecting to Blizzard services", with Play Offline). It still ignores `-listen`.
- **Battle.net's launch:** `SC2 -sso=1 -launch -uid s2`, parent `/sbin/launchd`, working directory `/`. It adds two environment variables, `BDK_TITLE_CODE` and a per-launch `BDK_LAUNCH_GUID`.
- **Copying Battle.net's flags** (`open -n --env BDK_TITLE_CODE=S2 -a SC2.app --args -sso=1 -launch -uid s2`, with or without `-listen`): still exits after 1 s. The gate is the per-launch GUID that Battle.net registers with its Agent, the Mac counterpart of the Windows shared-memory handshake. Don't forge it.
- **The Editor's Test Document** gets past the check; the mechanism isn't known. This is the route we use: the macOS Host Adapter (`packages/plugin-host-macos/`) drives it through System Events.

[`padillac/MacOS-Starcraft-4.10-Init-Crash-Fix`](https://github.com/padillac/MacOS-Starcraft-4.10-Init-Crash-Fix) reports the same 5.0.17 behaviour on the Mac ("exits with status 1 and prints nothing") and hasn't investigated it. Its fix is for a different crash, in the old 4.10 build. The macOS update from 26 to 27.2 changed nothing.

### The `-reloadcheck` reload channel

**Windows, documented.** With the game already running, the Editor doesn't spawn a new process. It writes "code 1" (map path, seed, speed, difficulty, testconfig path, testmod paths) to the `"StarCraft II Editor/Game Shared Memory"` mappings. The game handles it only if started with `-reloadcheck`, and otherwise drops it with no log line. Map paths in code 1 must be absolute. This uses Windows named shared memory and events, so we can't drive it from Node on the Mac. Keep `-reloadcheck` on our command line anyway, for parity with the Editor: it lets the Mac Editor reuse a game that our script started.

## 2. SC2API: driving the game over a WebSocket

Sources: `docs/sc2api-raw-client.md`, `docs/rendering-headless.md` (§ Boot Requirements, § Live Test Results), `docs/debug-command-system.md` (§ SC2API `Debug` convergence), `docs/galaxy-vm-interpreter.md` §15.8, `tools/sc2_client_proto/README.md`, `tools/mpqcli/README.md`, `docs/plans/sc2-client-proto-tool.md`, vendored `tools/sc2_client_proto/proto/s2clientprotocol/sc2api.proto`.

This is Blizzard's public machine-control API: the one pysc2, python-sc2 and the C++ s2client-api use. Schema: [`Blizzard/s2client-proto`](https://github.com/Blizzard/s2client-proto) `s2clientprotocol/sc2api.proto`.

### Booting in listen mode

**Windows, documented.** The `listen` cvar (string) turns the API on. Its forms in the sources:

- `-listen 127.0.0.1:PORT`, passed as **two argv elements**: `"-listen"`, `"127.0.0.1:PORT"`. The repo's tools do this, and the headless run that loaded a map used it.
- `-listen <addr> -port <N>`, the public s2client form. A `port` string cvar ("Network port") exists, and `clientapi-http-server.md` names `-listen`/`-port`. The repo's tools never use it.

The repo's tools default to port 8168. Endpoint: `ws://127.0.0.1:PORT/sc2api`, binary protobuf `Request`/`Response` messages. Poll it with `Ping` until it answers. A headless run on Windows answered with `101 Switching Protocols`.

**Mac, verified 2026-10-27: not available on 5.0.17.** The game never opened port 8168 in any of these launches. It ignored the switch and booted as a normal client:

| Launch | `-listen` form | Result |
|---|---|---|
| Bare, python-sc2's argv (`-listen 127.0.0.1 -port 8168 -displayMode 0 -dataDir … -tempDir … -verbose`) | two-switch | exits with status 1 at the launcher check (§1) |
| Same, under lldb | two-switch | past the check, at the retail login screen after 150 s; no 8168 |
| Battle.net, with the switch in its extra launch arguments | both forms | home screen; only 6119 listening after 2 min |
| Editor Test Document, with the switch in its extra arguments | both forms | map runs normally; only 6119 listening |

The Editor launch combined `-run` with `-listen` and didn't crash, which contradicts the Windows caveat below. That fits the switch being ignored entirely. python-sc2 has no Mac-specific launch code; it runs the same argv everywhere. Use the SC2API from Windows SC2, for example in a Parallels VM.

What listen mode changes:

- It bypasses the single-instance check, so several API instances can run.
- It satisfies the launcher assert above.
- When no client has asked for a step, the game loop blocks for up to 50 ms per frame on the API queue (about 16 loops/s).
- The game simulates only when asked. Use `Step`, or set `realtime` in `CreateGame`.

### Crash caveat: no `-run` in listen mode

**Windows, documented.** In listen mode, `GameState__CommitGameStart` builds the pending API response on a per-request context. A game started without an API request (`-run <map>` or an Editor reload) dereferences a NULL context and crashes. This was seen 7 times in GameLogs. Start listen-mode games only with `CreateGame`, `JoinGame` or `StartReplay`. Never combine `-listen` with `-run`.

### Request sequence for a local map

| Step | Request | Notes |
|---|---|---|
| 1 | `Ping` | Returns `game_version`, `data_version`, `data_build`, `base_build`. Use it as the readiness check. |
| 2 | `CreateGame { local_map { map_path \| map_data }, player_setup[], disable_fog?, random_seed?, realtime? }` | Needs at least one participant. `player_setup` entries: `{type: Participant=1 \| Computer=2 \| Observer=3, race, difficulty, ai_build}`. |
| 3 | `JoinGame { race \| observed_player_id, options: InterfaceOptions }` | Ask for `options.raw = true` to get unit lists. |
| 4 | `Step { count }` | 16 game loops per game second (22.4 per real second at Faster). Step in small chunks if you need intermediate states: one 100-loop step ran straight past a 2 s and a 6 s timer in the Windows probe. |
| 5 | `Observation` | `observation.raw_data.units` lists every visible unit (type id, owner, position, health). Also `game_loop`, `player_result` when the game has ended. |
| 6 | `GameInfo` | Map name, `local_map_path`, playable area, pathing/placement grids, player info. |
| 7 | `Debug`, `Query`, `Action` | Optional (see below). |
| 8 | `LeaveGame` or `Quit` | `Quit` ends the process. |

Map paths and packing:

- `SC2API_ResolveMapPath` resolves a relative `map_path` against `<install>/Maps/` and accepts only an **MPQ archive file**, not an unpacked folder. Both `tools/mpqcli/README.md` and the headless test (`tm01_packed.SC2Map`) say this. The Mac `-run` route takes our folders; the API route won't.
- `map_data` sends the archive bytes inline. The game writes them to `TempLaunchMap.SC2Map`. That avoids copying into `Maps/`, but it still has to be a packed archive. The proto caps `map_path` at 260 characters.

Errors:

- Every `Response` has a top-level `repeated string error`. The dispatcher fills it when the play state doesn't allow the request. Exact strings: `"Already in the process of starting a game"`, `"Must start a game with CreateGame first"`, `"A game has not been started yet"`, `"Not in a game"`, `"Game has already ended"`, `"Application closing"`, `"Request missing command"`, `"Unknown command"`. `PlayerSetup` errors: `"There must be at least one participant or observer"`, `"Only 1v1 is supported when using multiple agents"`.
- `ResponseCreateGame` has its own `error` enum: `MissingMap=1`, `InvalidMapPath=2`, `InvalidMapData=3`, `InvalidMapName=4`, `InvalidMapHandle=5`, `MissingPlayerSetup=6`, `InvalidPlayerSetup=7`, `MultiplayerUnsupported=8`, plus an `error_details` string. A bad path or bad archive should come back here. **Unknown:** the RE notes don't show what happens when the archive opens but a component inside is broken (bad `t3Terrain.xml`, a refused tileset, a compile error in `MapScript.galaxy`). A Galaxy compile error "surfaces as a failed/empty map load" (`galaxy-vm-interpreter.md` §15.8). Plan for a timeout as well as an error.
- The Windows client's embedded schema differs from upstream s2client-proto in 23 items: extra `warmstart_game`/`take_over` requests, `cheating_opponent_upgrade_ids`, and no `record_replay` or APM fields. None of this affects the requests above.

### `Debug` maps to cheats

**Windows, documented.** `Debug` has no handler of its own. Each sub-command formats a text cheat and runs it through the in-game debug console (`DebugCmd__Execute`), only in listen mode:

| `DebugCommand` field | Text command sent |
|---|---|
| `game_state = 2` | `ShowMap`, `AllianceControl`, `Food`, `Free`, `Gimme`, `God`, `Minerals`, `Cooldown`, `TechTree`, `Upgrade`, `FastBuild`. `gas = 8` is unimplemented and does nothing silently. |
| `create_unit = 3` | `MakeUnit %s %d %d` |
| `kill_unit = 4` | `KillUnitByTag %d` |
| `score = 6` | `SetCurriculumScore` |
| `end_game = 7` | `victory` / `surrender` |
| `unit_value = 8` | `SetUnitValueByTag <Shields\|Life\|Energy> %f %d` |
| `draw = 1`, `test_process = 5` | not routed through the console |

Debug commands only run once a game is in progress. For `validate-map` the useful ones are `kill_unit` (to trigger "<Anchor> Dies" outcomes), `create_unit` and `end_game`.

### Sketch: `validate-map` over SC2API in TypeScript

No code here. Just the parts and where to find them. This needs Windows SC2; the Mac client ignores `-listen` (see above).

1. **Pack** the unpacked output into an MPQ `.SC2Map`. Candidates: `koda-27/sc2publish` (MIT; deterministic MPQ writer in Python, to port) or `sc2-arcade-watcher/modkit` (TypeScript MPQ/SC2Map, but not publicly available; see [related-repos.md](./related-repos.md)). The StormLib pack settings in [map-package-findings.md](./map-package-findings.md#tools-evaluated) (MPQ v1, zlib, regenerated `(listfile)`, backslash paths) are another reference.
2. **Spawn** `SC2` with `-listen` (and `-displaymode 0` if windowed means 0), `cwd` = `Support/`. Poll `ws://127.0.0.1:PORT/sc2api` with `Ping`.
3. **Protobuf:** compile the `.proto` files from `Blizzard/s2client-proto` with `protobufjs` or `@bufbuild/protobuf`, or use the precompiled `@node-sc2/proto` package (check that it's current). Transport: the `ws` package, binary frames, one outstanding request at a time.
4. **Run:** `CreateGame` with `map_data` and one participant (plus a computer opponent if the map needs one) → `JoinGame` with `raw: true` → `Step` → `Observation`.
5. **Check:** compare `raw_data.units` with the blueprint's unit anchors (unit type, owner, position within a tolerance). Check that `game_loop` advances. Optionally `Debug.kill_unit` a hero and expect `player_result` = Defeat.
6. **Collect** new GameLogs files and the harness log (sections 3 and 4), then `Quit`.

The Python reference client is `tools/sc2_client_proto/` (19 commands, `launch`, `shell`). Read it for request shapes; the project's rule is no Python.

## 3. A test harness inside the map

Sources: `docs/log-output-channels.md` (§ Galaxy `TriggerDebugOutput` sink), `output/galaxy-native-binding-96921.json`, `docs/plans/archive/sc2rt-runner-dll.md` §14 9cq.

**Windows, documented.** The map can write its own results. Natives (arity and type codes from the binding table):

| Native | Signature |
|---|---|
| `TriggerDebugSetTypeFile` | `(int type, string file)` |
| `TriggerDebugOutput` | `(int type, text inText, bool includeGameUI)` |
| `TriggerDebugOutputEnable` | `(bool)`. The gate defaults to on. |
| `TriggerDebugSetTypeName`, `TriggerDebugEnableType`, `TriggerDebugSetTypeFilter`, `TriggerDebugWindowOpen` | debugger window cosmetics |

What one `TriggerDebugOutput` call does:

1. Returns if output is disabled or the type is out of range. There are 16 per-type slots, 0–15 internally.
2. Appends to the trigger debugger's in-memory ring, which the `-trigdebug` window shows.
3. With `includeGameUI = true`, shows the text in the chat area.
4. Appends the text to the type's file, but **only** if `TriggerDebugSetTypeFile` opened one for that type earlier.

File rules:

- The path is `UserLogs/<name>.txt`, or `<mapname>_%08X.txt` when no name is given.
- At most 32 files per directory.
- Each file is capped at **2 MB**. After that the game writes an "ErrorLogTooLarge" message instead of the text.
- `\r\n` in the text becomes the literal `<n/>`. Keep one result per call and don't embed line breaks.
- The text argument is `text`, so string literals need `StringToText`.
- **Unknown:** where `UserLogs/` lives on the Mac. Probably `~/Library/Application Support/Blizzard/StarCraft II/UserLogs/`; it doesn't exist yet on this machine. Find it with the first harness run.

A generated test map would open a type file at map init, then write lines such as `PASS units-placed`, `FAIL objective-missing` and a final `DONE`. Mission maps shouldn't carry this. Add it only to `validate-map` builds.

## 4. Logs to read

Sources: `docs/log-output-channels.md`, `docs/logging-system.md`, `docs/cvariable-list.md` (§ log channels), `docs/galaxy-vm-interpreter.md` §2, §9, §10, `docs/dependency-manager.md`, `docs/sc2api-raw-client.md`.

### When the game writes its logs

**Mac, verified 2026-11-24:** the game writes its log files when it exits. One session's four files were created over 14 minutes (each when its channel first spoke) and were all last modified at the quit. So read a run's logs after the game has quit, never while it runs; a game that was killed may have left them incomplete or empty (zero-byte `SystemInfo` and `Text` files are what such a session looks like). This is why a capture quits its game gracefully, and why `test_mission`, whose game the author plays, can't report on its own run: see [Reading a run's logs](#reading-a-runs-logs).

### GameLogs files

**Mac, verified:** files are named `<YYYY-MM-DD HH.MM.SS> <Channel>.txt`. Each starts with a header block: `StarCraft II (B98310)`, `Executable`, `<Parameters>` (the full command line), `Parent Executable`, `<Version>`, `<DataBuild>`, `<CodeBranch>`, … `<AgentVersion>`, then a `====` rule. The timestamp is each file's creation time, so files from one session can differ by a second or more: `Alerts` at `13.32.25`, `ScriptError` and `Text` at `13.32.26`, and `Graphics` earlier still. Group a session by start time plus `<Parameters>`, not by an exact prefix.

**Mac, verified (2026-11-24):** `Text.txt` has no header block and so no `<Parameters>` line. Files of one session can be created over more than an hour (`UI` first spoke 75 minutes after the session's `Alerts`), so a gap in time can't end a session. Sessions with the same command line follow each other (every Test Document runs `-run Test/EditorTest.SC2Map`, whichever Mission it tests, and a capture's game does too). A crash or an error makes a folder `<stamp> <computer> B<build> P<pid> Crash` (or `Error`) holding that session's own files, its report `<folder name>.txt`, `NGDP`, `Streaming` and `Variables` copies, the replay, the map it ran and `mac.log`. The `P<pid>` is the game's process id, which is how a tool that recorded the pid it started knows a crash is its own.

**Windows, documented:** each `Log*` bool cvar enables one output channel, and the channel's file appears in GameLogs:

| File | Controlling cvar (default) | What's in it |
|---|---|---|
| `ScriptError.txt` | `LogScri` (true) | Galaxy runtime errors: the main file for `validate-map` |
| `UI.txt` | `LogUI` (true) | UI layout parse errors |
| `Alerts.txt` | `LogActorMovie`, `LogMove`, `LogUSER`, … | alert-class channels; lines start with the channel name, e.g. `USER` |
| `SystemInfo.txt` | `LogSystemInfo` (true) | hardware/OS at startup |
| `Graphics.txt` | `LogGFX` (false on Windows) | graphics device |
| others | `LogXML`, `LogTextError`, `LogLanguageError`, `LogCutscenes`, `LogSHAD`, … (mostly true) | per channel |

`disableAllLogging` (default false) suppresses everything. `LogGalaxyVerboseAssertion` defaults to true. Crashes leave a `<time> … Crash` folder in GameLogs.

### Reading a run's logs

Core reads them (`packages/core/src/host/game-logs.ts`, `game-run-report.ts`). Each Host Adapter names its folder with the `game.logsFolder` capability (the Mac's is the one above; Windows' is `<Documents>\StarCraft II\GameLogs`, Documents as the shell has it).

- **Which session is ours.** Files are grouped in the order the game made them: a file joins the latest group that doesn't have its channel yet and whose `<Parameters>` agree (a file with no header agrees with any); otherwise it starts a group. A run's sessions are those that started after the tool's run began and name its map in `<Parameters>` (or `EditorTest.SC2Map`), plus any crash folder whose `P<pid>` is a game the Editor Broker recorded as the tool's (#52). Overlapping games with the same command line can interleave; the pid match covers crashes only.
- **What it reports.** After `capture_shots`, whose game the tool quits: Crash or Error folders; each distinct error in `ScriptError`, `Alerts`, `Text`, `UI` and `Cutscenes` with a count of the lines that said it (the game prints `Final report for this error this game.` and then stops repeating, so a count is a floor); and which are new, meaning no known-error list knows them. A `Near line` line joins the error above it, and the `[ 13 1]` stamp some `Alerts` lines carry is dropped, so one error is one entry. `test_mission` can only report the **last Test Document run that had quit** before the call, labelled so: its own game runs on while the author plays and writes its logs at the quit, and a Test Document's map is always `EditorTest`, so the session may be another Mission's.
- **Known-error lists, two levels.** `known-errors.json` at the Workspace root applies to every Mission; one beside a Mission's Blueprint adds to it for that Mission. Both are the author's: a tool prints a proposed pattern for each new error and writes nothing. `check` validates both.

  ```json
  { "patterns": [
    { "match": "Cannot load font file", "reason": "this Mac has no Courier font; harmless", "added": "2026-11-24" },
    { "match": "^Catalog field '.*' could not be read", "regex": true, "reason": "tracked in #123", "added": "2026-11-24" }
  ] }
  ```

  `match` is text the error contains (or, with `"regex": true`, a regular expression it matches); `reason` is required and says why it's known (a proposed pattern's `TODO(author)` reason passes the format but `check` warns on it); `added` is the date, `YYYY-MM-DD`. A pattern is listed once per list.
- **Stale patterns.** The report records, in the machine's cache folder (`known-error-hits.json`), when each pattern last matched, and flags one unmatched, since its last match or else its `added` date, for 30 days, so the author can remove it. A machine with no `cacheDir` records nothing and flags nothing.


### Strings worth matching

From this Mac's own `ScriptError.txt` files:

| Pattern | Meaning |
|---|---|
| `Trigger Error in '<function>': <message>` | runtime error in a trigger function |
| `   Near line N in <function>() in <file>.galaxy` | location; follows the error |
| `Calling '<native>' is not authorized` | native not allowed in this context (seen: `CampaignMode` from a Campaign Mod's library) |
| `Catalog field '<field>' could not be read (Core: a required object could not be found)` | missing catalog entry or asset reference |
| `Could not get '<type>' from parameter in '<native>' (value: …)` | null or dead handle passed to a native |
| `Final report for this error this game.` | the game throttles repeats. Count distinct errors, not lines. |

From the RE notes and [map-package-findings.md](./map-package-findings.md#logs-and-testing):

| Pattern | Meaning |
|---|---|
| `UI/TextError/CannotLoadDescFile` + mod path | a dependency's descriptor failed to load |
| `Script compile error:` / `Script load failed:` | from `erivgout/sc2-map-editor-mcp`'s matcher. Not yet seen here. |
| `Unable to open map.` | bad path in an Editor reload (Windows) |

Strings a UI layout or a Galaxy script should produce when it's wrong, from the same sources. **Unverified until seen in a log here**; match them, and when one shows up, move it to the first table:

| Pattern | Probably means |
|---|---|
| `Unknown start tag` | a layout file's XML names an element the game doesn't have |
| `not able to be hooked up` | a layout frame refers to a handle or control it can't connect |
| `Unable to resolve layout of … for side(s)` | a frame's anchors don't fix its position or size on those sides |
| `Invalid property binding` | a layout property binds to something that isn't there |
| `could not be created` | an object (a frame or a catalog entry) failed to build |

### Galaxy VM errors and limits

**Windows, documented.** Runtime error names (`GalaxyError`, all registered by `Galaxy__RegisterErrorStrings`):

| Name | Id | Raised by |
|---|---|---|
| `e_scriptTooLarge` | 537329737 | compiled code over `0x800000` bytes (8 MB) |
| `e_execTimeout` | 537329776 | instruction budget exhausted. A loop that never waits. |
| `e_execPaused` | 537329773 | thread yield (not an error) |
| `e_divByZero` | 0x20070073 | div/mod |
| `e_numericOverflow` | — | `INT_MIN / -1`, fixed overflow |
| `e_stackOverflow` | 0x2007007C | call depth: frame push past the stack limit |
| `e_stackUnderflow` | 537329789 | |
| `e_arrayIndexUnderflow` / `e_arrayIndexOverflow` | 537329791 / 0x20070080 | array bounds check |
| `e_invalidAddr` | 537329781 | null or out-of-range memory |
| `e_invalidGlobalPtr` / `e_invalidStackPtr` / `e_invalidCodePtr` | 537329782–4 | segment validation |
| `e_nativeCodeError` | 537329785 | a native failed |
| `e_functionNotFound` | 537329795 | function lookup/signature mismatch |
| `e_referenceTableFull` / `e_referenceCountOverflow` | 537329793 / 537329794 | GC handle table |
| `e_unknownInstr` | 537329790 | bad bytecode |

Memory segments are fixed: code, data/globals, stack, each in an 8 MB arena (the data segment is 16 MiB). `MapScript.galaxy` is plain-text source compiled on every map load. A compile error doesn't show up as a runtime error; the map just fails to load or loads empty.

## 5. The ClientAPI HTTP server

Source: `docs/clientapi-http-server.md`.

**Windows, documented.** This is a separate, read-only JSON server (CivetWeb, single-threaded, 10 s request timeout), meant for OBS and casting tools. It isn't the SC2API.

- Enabled by `-clientapi`. The cvar `clientapi` defaults to `"127.0.0.1:6119"`. `-clientapi 6119` binds every interface; `-clientapi 127.0.0.1:6119` binds localhost only.
- `GET /game` returns `{"isReplay": false, "displayTime": 0.0, "players": [{"id": 1, "name": "…", "type": "user", "race": "random", "result": "Undecided"}]}`. `displayTime` is game time in seconds. `result` presumably changes from `Undecided` when the game ends; not confirmed.
- `GET /ui` returns `{"activeScreens": [...]}`. `GET /ui/activeScreens` returns the array alone. The table has 26 screen names, including `ScreenLoading/ScreenLoading` and `ScreenScore/ScreenScore`; which ones show during a `-run` test isn't documented.
- Requests are answered on the game thread, once per frame.

Use for `validate-map`: it works alongside `-run`, which the SC2API doesn't. A rising `displayTime` means the map loaded and the game is running. `players[].result` may give Victory/Defeat without the SC2API.

**Mac, verified 2026-10-27.** The game serves it on `127.0.0.1:6119` with no `-clientapi` switch, in both Battle.net and Editor launches. At the home screen:

```
GET /game → {"isReplay":false,"displayTime":0.0,"players":[]}
GET /ui   → {"activeScreens":["ScreenBackgroundSC2/ScreenBackgroundSC2","ScreenHome/ScreenHome","ScreenNavigationSC2/ScreenNavigationSC2","ScreenForegroundSC2/ScreenForegroundSC2"]}
```

During an Editor Test Document run:

```
GET /game → {"isReplay":false,"displayTime":17.0,"players":[{"id":1,"name":"Local Player","type":"user","race":"Terr","result":"Undecided"},{"id":2,"name":"Antioch Survey Detachment","type":"computer","race":"Prot","result":"Undecided"}, …]}
GET /ui   → {"activeScreens":[]}
```

`displayTime` rose 17 → 22 → 26 → 29 over about 9 s of wall time. The player names are the map's own, so `/game` confirms which map loaded. While the map is still loading it returns `displayTime 0.0` and no players. **Unknown:** whether `result` changes at victory or defeat; not yet observed.

## 6. Screenshots

### Getting in-game screenshots of a map: `capture_shots`

To see part of a map in the game, call the MCP tool `capture_shots` (or `npm run capture-shots -- <blueprint.json | Map.SC2Map> <shots.json>`). It needs a Host Adapter with `editor.captureTour` (the macOS one, `bundled:host-macos`, or the Windows one, `bundled:host-windows`) and the StarCraft II Editor; on a machine whose Host Adapter lacks it, it's refused, and the author sets `hostAdapter` in the machine config to one that has it. The rest of this section is the background research behind it.

- **When.** To judge what only the game shows: lit ground and cliffs, dressing and water as rendered, how far the player sees, how a Zone reads from the player's camera. For a layout's shape, the `preview` render is quicker and needs no game.
- **A Shot is a rectangle,** `rect: [left, bottom, right, top]` in cells, with an optional `pitch` (degrees down: 75 by default, a high view; 56 is the player's camera), `yaw` (degrees turned from the camera's north-facing view) and `label` (it names the frame). The camera moves back until the whole rectangle is in frame, so the rectangle's size sets the view. About 10-20 cells shows a set piece or a doorway in detail, 30-50 cells a whole Zone, and more an overview. The 16:9 frame shows more than the rectangle on its long side. A rectangle too big for the farthest camera (400), or at the map's edge where the camera can't centre on it, is still captured and marked `whole: false` in `shots.json`: split it, or move it inward.
- **Send every Shot in one call.** Starting the game takes minutes; each Shot after that takes a few seconds. One call with ten Shots costs about one game start, ten calls cost ten.
- **What the frames show.** The game runs a capture copy whose triggers are replaced by the camera tour, so none of the map's own triggers run: it shows the map as placed, revealed with no fog and no UI. Trigger-set lighting doesn't apply unless you pass `lighting` (a Light id); units a trigger spawns, actor changes and Beats' camera bounds aren't there either. The copy's camera bounds are its Playable Area.
- **Waiting.** Every capture on the machine goes through the Editor Broker ([macos-host.md](../../packages/plugin-host-macos/docs/macos-host.md#the-editor-broker-one-editor-job-at-a-time)), one at a time, so a call may wait behind another agent's. The call waits up to 10 minutes; a job not done by then comes back with a job id, and `capture_shots({ job })` waits again and collects the frames, or reports the job's place in the queue.
- **Where frames go.** For a Mission, `missions/<id>/output/shots/<name>/` (git-ignored); for any other Map Package, `<cacheDir>/shots/<name>/`. Each frame is its two-digit number with any label as a lower-case, dashed tail, such as `01-north-gate.jpg`, beside `shots.json` with each Shot's rectangle, camera and `whole`. Read the frames to look at them.
- **Stale captures (#748).** A Mission's `shots.json` (and `capture-edit`'s `views.json`) records `covers`: the Blueprint and Map Package files, with fingerprints, as they were when the frames were taken, the same shape and files a Stage 3 sign-off covers (`session/evidence-coverage.ts`; the Assets folder, the minimap and the two files an Editor save rewrites, `ComponentList.SC2Components` and `DocumentHeader`, are left out). `get_session_state` lists each `output/shots/<name>/` whose covered files differ now under `staleCaptures`, with what changed, and says to take it again. It only reports: nothing is deleted or rewritten, and a capture from before `covers` is never stale. `views.json` is written outside the Mission, under `$SC2_RESEARCH_DIR`, so it is recorded but not yet reported. A capture of a bare `mapPath` has no Mission and covers nothing.

### The in-game error panel

**Unverified.** The game shows its script and data errors in a panel that covers about the top 200 px of its window. Hide it (the green checkbox at its top left) before judging a layout or a screenshot of one, or the top of the picture is the panel's.

### The game's own screenshot paths

Sources: `docs/runtime/screenshot-direct-call.md`, `docs/cvariable-list.md`, `docs/rendering-headless.md`.

**Windows, documented.**

- PrintScreen is hotkey action 213. It writes `Screenshot<YYYY-MM-DD HH_MM_SS>.jpg` to the first writable of five candidate folders, `Documents/StarCraft II/Screenshots/` on Windows.
- The `ScreenshotFormat` cvar (default `"jpg"`) picks the format; the device call takes format index 0–4 (JPEG, PNG, …).
- The RE tool triggers it either by posting the key or by calling the handler with Frida. Neither applies to us. Poll the Screenshots folder for the new file instead of trusting return codes.
- The Stub (headless) graphics device returns success and writes no image, so screenshots need a real renderer.

On the Mac, the options are `screencapture -l <windowid>` (needs Screen Recording permission for the terminal), or sending the PrintScreen key via AppleScript/System Events. The Mac Screenshots folder isn't confirmed; probably under `~/Library/Application Support/Blizzard/StarCraft II/`. The public SC2API can also return rendered frames when `JoinGame` asks for `InterfaceOptions.render`. Unverified on Mac.

## 7. Things that don't work on macOS

- **Editor↔game live reload (IPC code 1):** Windows named shared memory and `OpenEventW`; can't be driven from Node on the Mac.
- **Launcher handshake (`StarCraft II IPC Mem`) and exit 47:** the shared-memory form is Windows-only. The Mac has its own check (Battle.net's per-launch `BDK_LAUNCH_GUID`), so a direct launch fails there too (§1).
- **SC2API (`-listen`):** ignored by the Mac 5.0.17 client (§2).
- **Headless Stub graphics device:** forced by hooking `GFX__DeviceInit` with Frida. `GraphicsApi` can't select it, and the `headlessNoRender`/`headlessNoActors`/`headlessReduceMemory` cvars are never read.
- **Render degradation knob:** Frida hooks on Windows addresses.
- **Debug console and `Debug.*` vars:** need binary patches or DLL injection.
- **sc2rt runner DLL, Frida agents, screenshot direct call:** injection into the Windows binary.
- **SC2Switcher:** Windows launcher shim, and a no-op against a running game anyway.

On the Mac, a "headless" run therefore still opens a window and renders with Metal. Use `-displaymode` and a small `windowwidth`/`windowheight` to keep it out of the way.

## Applying this to sc2-adjutant

1. **Launching:** `launch-sc2.sh` can't work on the Mac (§1). Start the game through the Editor's Test Document, as the macOS Host Adapter's `editor.testDocument` and `editor.captureTour` do. Put extra switches (`-trigdebug -breakOnError`, `-fixedseed -seedvalue N`) in the Editor's Test Document extra arguments rather than on our own command line. Group log files by `<Parameters>` and start time, not by one exact timestamp prefix (see section 4).
2. **Probe the Mac once, by hand:** done 2026-10-27. The ClientAPI works and the SC2API doesn't (see the table at the top).
3. **`validate-map`, static stage (no game):**
   - Every native called from `MapScript.galaxy` exists with the right arity (`output/galaxy-native-binding-96921.json`).
   - `.version` files, `ComponentList` and `DocumentHeader` are present.
   - Catalog XML validates against `sc2-xsd`.
4. **`validate-map`, game stage, first version (`-run` route, no packing):**
   - Build a test variant of the map that writes `PASS`/`FAIL`/`DONE` through `TriggerDebugSetTypeFile` + `TriggerDebugOutput`.
   - Launch with the Editor's Test Document. Poll `127.0.0.1:6119/game` until `displayTime` rises, or time out (a load failure).
   - Wait for `DONE` in `UserLogs/` or a timeout, then quit the game.
   - Fail on new lines in `ScriptError.txt` and on harness `FAIL` lines.
5. **`validate-map`, game stage, second version (SC2API, Windows only, e.g. Parallels):**
   - Once an MPQ packer exists, use `CreateGame` with `map_data` → `JoinGame` (`raw`) → `Step` → `Observation`.
   - Assert that unit anchors exist with the right type and owner.
   - Use `Debug.kill_unit` to exercise defeat/victory triggers and read `player_result`.
   - Never pass `-run` in this mode.
6. **Report** passed / failed / skipped per check, as [map-package-findings.md](./map-package-findings.md#logs-and-testing) suggests, so a missing game install skips the game stage instead of failing it.

## What a test game does to the Banks folder (issue #54)

A Test Document runs the Mission's real triggers, and the game saves banks into one shared folder (Mac: `~/Library/Application Support/Blizzard/StarCraft II/Banks/`; Windows: `<Documents>\StarCraft II\Banks\`, Documents as the shell has it). A run can rewrite a bank unnoticed, and the next test then starts from that state. Captures aren't affected: they use banks of their own.

- **Snapshot.** When the Editor Broker runs a `editor.testDocument` job (so for `test_mission`), it first copies the whole Banks folder into `<cacheDir>/banks/<run>/files/`, asking the Host Adapter for the folder's place (`game.banksDir`). A host without that capability, or a machine with no broker, takes no snapshot, and nothing is reported.
- **Report.** When the test game quits, the broker compares the folder with the snapshot and records each bank added, changed or removed. A bank is an XML file: `<Section name>` holds `<Key name>` holds `<Value int="5"/>`. For a changed `.SC2Bank` the report lists each section and key that was added, removed or changed, with the value before and after (`level: int="3" -> int="4"`). The `<Signature>` is ignored, so a bank that differs only in signature or formatting is listed as changed with that note. Another file in the folder is compared byte for byte. A run that changed nothing leaves nothing behind. The broker's hold decides when the game has quit: on a host with `game.list` it watches the game it saw start (a pid and start time new since the job began), and otherwise it asks `game.running`. When the Test Document started no game of its own (it never started, or had already quit), the changes are recorded at once.
- **Where it shows.** The next `test_mission` reply starts with the changes the author hasn't answered, and the `bank_changes` tool reports them at any time. With the game still running it shows the changes so far and applies nothing. On a host with no `game.running` it can't tell when the game quit, so it shows the changes so far until the author gives a keep or rollback, which it takes as their word that the game has quit.
- **Keep or roll back, per bank.** `bank_changes` takes `keep` and `rollback` (bank names as listed) or `keepAll` and `rollbackAll`. Roll back puts the snapshot's copy back (a bank the run added is deleted); keep leaves the bank as the game left it. Nothing is rolled back without the author's say: ask which first. A rollback restores the folder as it was just before that run, so changes made to that bank since, including by a later test game, go with it.
- **Pruning.** Only the newest five runs are kept in the cache. A run's copy is deleted once every one of its banks has been answered.

### Bank fixtures (issue #55)

Testing a Mission from a given campaign state (after mission 2, with research X) needs the banks to hold that state. A **bank fixture** is a folder of `.SC2Bank` files in the Workspace; a Blueprint names it with `bankFixture`, a path from the Blueprint's folder like the Screenplay's `source`, which must stay inside the Workspace:

```json
"bankFixture": "../../bank-fixtures/after-mission-2"
```

- **A run.** `test_mission` (through the Editor Broker, on a host with `editor.testDocument`, `editor.captureTour` and `game.banksDir`; otherwise it refuses and plays nothing) takes the usual snapshot, then copies the fixture's `.SC2Bank` files into the Banks folder, over any bank of the same path. Banks the fixture doesn't have stay as the author's.
- **Restore.** When the game quits, the broker puts the folder back as the snapshot has it: banks the game or the fixture added are deleted, changed or removed ones copied back. The same happens when Test Document fails to start. A run is only forgotten once the restore has worked; until then it stays `running`, is never pruned, and the next `bank_changes` (or `test_mission`) tries again. While one is unrestored no new test game starts, since the folder holds the fixture's banks and a snapshot of it would take them for the author's.
- **The report.** A fixture run changes banks on purpose, so nothing is asked of the author: `bank_changes` doesn't list it as waiting for a keep or roll back. What the game itself changed (compared with the folder just after the fixture went in, not with the author's) is recorded as already rolled back, for the run's record.
- **A host with no `game.running`** can't tell when the game quit, so the restore waits for the author: `bank_changes` with `rollbackAll`, taken as their word that the game has quit, puts the banks back. Until then the report says the folder holds the fixture's banks.
- **Saving one.** `save_bank_fixture` with a `name` copies the `.SC2Bank` files in the Banks folder to `bank-fixtures/<name>/` in the Workspace, and writes nowhere else. It refuses while a fixture run's banks aren't back or the game runs, and won't replace a fixture of that name without `overwrite`.
- **Checking.** `check_workspace` reports a `bankFixture` that is outside the Workspace, isn't a folder, names none that exists, or holds no `.SC2Bank` file.

**Needs a real run:** the report on a real game's banks (the folder's layout under the account, bank files the game saves while it quits, the time the quit takes) and a fixture's copy in and restore haven't been checked; the code is tested against fixture folders.

## Mission tests (issue #741)

A Blueprint can carry `tests`, a manifest of what its Mission should do. Today it has one list, `routes`; combats are the follow-up below.

```json
"tests": { "routes": [
  { "id": "start-to-vault", "from": "hero", "to": "vault", "expect": "arrive", "note": "the first Beat's way in" },
  { "id": "vault-sealed", "from": "yard", "to": "vault", "expect": "blocked" }
] }
```

`from` and `to` are each a Zone id (any open cell of it) or a placed Anchor id (its cell). The manifest's format is a first proposal, not the author's decision: the ticket asked for the author to be grilled on it, which hasn't happened.

### What runs: routes, static, no game

The walk reuses the cells `route-open` reads (`blockedCells` in `packages/core/src/layout/route-checks.ts`): cells under a cliff mesh, not a ramp's lane or a terrain object's deck, and cells `pathingPaint` cuts out whole. It steps through cells some Zone owns, to the 8 neighbours, a diagonal only past two open cells. Each test reads as passed or failed, with its note; a test naming a place the Blueprint doesn't have fails with that reason. Two places report it:

- `check_layout`'s `route-tests` check (warn on a failure, not evaluated with no tests);
- `test_mission`, after its compile and before the game starts: a `routeTests` array in its structured reply and a "Route tests" block in its text. A failure doesn't stop the game from starting.

What this does and doesn't prove: a failing `blocked` or a failing `arrive` caused by cliffs or paint is certain, since it reads the same terrain the compile writes. A passing `arrive` can still be stopped in the game by what the walk doesn't read (doodads' pathing, dug pools, unit collision, the 3-cell path-width rule). **Needs an in-game check:** that a walk this passes is walkable by a unit in the game, and that a `blocked` pair really stops one. Not run beside Kept ground.

### Not built: combat tests and reading results back from the game

The ticket's "done when" (a manifest runs through Test Document and a pass or fail comes back without the author reporting it) isn't met for anything that needs the running game. What is known about the read-back channels, from the sections above and nothing newer:

| Channel | State on the Mac |
|---|---|
| ClientAPI `GET /game` on 6119 | **Mac, verified (2026-10-27):** answers during an Editor Test Document run, with the map's own player names and a rising `displayTime`. So "the map loaded and is running" can be read back. **Unknown:** whether `players[].result` leaves `Undecided` at victory or defeat. Without that it can't report an outcome, only liveness. |
| In-map `TriggerDebugOutput` to a type file under `UserLogs/` | **Windows, documented (§3).** Unknown: where `UserLogs/` is on the Mac, and whether a Test Document run writes it. Needs a test variant of the map. |
| SC2API | Not available on the Mac (§2). |

The follow-up, once someone can run the game: (1) in one Editor Test Document run on a throwaway map, ending the game with a win and a loss, record what `/game` shows for `result`, and whether a `TriggerDebugOutput` line reaches a file and where; (2) pick the channel from that; (3) design the combat manifest (a spawn, an expected outcome, a time limit) with the author; (4) have `test_mission` poll the channel and return pass or fail. Needs an Editor check and an in-game check.

**Step 1 run, 2026-11-21 (Mac, Editor Test Document, a generated 128×128 map with a Zealot to kill and a hero to lose).** `npm run probe-game -- --seconds 300 --out <file.jsonl> --stop-when-decided` polls `/game` once a second and records only what changes. Tested against a scripted endpoint (`packages/core/tests/host/game-probe.test.ts`) and now run against the real game, once for each ending:

| | Loss | Win |
|---|---|---|
| How it ended | the author surrendered | the hero killed the Zealot named by the map's victory trigger |
| `players[].result` | `Undecided` then `Defeat` | `Undecided` then `Victory` |
| Players listed | one: id 1, "Local Player", type `user` | the same |
| Probe timeline | 404 at 69s (the map loading), unreachable at 78s, first answer at 81s, player joined at 95s, `Defeat` at 107.5s | 404 at 14s, unreachable at 25s, first answer at 30s, player joined at 48.5s, `Victory` at 66s |

So the ClientAPI does report the end of a game: `result` changes from `Undecided` to `Victory` or `Defeat`, and it is the only thing a test needs to read. The probe polls once a second and has `--stop-when-decided`, so it shows only that the change happens within the probe's polling interval, not how soon after the game ends; and it stopped at the first result, so it did not show whether `/game` keeps answering through the end screen. Between starting Test Document and the first answer the endpoint returns a 404 and then goes unreachable, so a reader must treat both as "not loaded yet", not as a failure. The map had a single human player and no computer opponent; an AI player, a team or a draw were not run.

`UserLogs/` is `~/Library/Application Support/Blizzard/StarCraft II/UserLogs/<map name>_<hash>/<log name>.txt`; an earlier test map already writes files there. **Still needs an in-game check:** whether a `TriggerDebugOutput` line reaches a file there. This map did not write one.

What remains for #741: (3) design the combat manifest (a spawn, an expected outcome, a time limit) with the author, (4) have `test_mission` start the test and poll `/game` until `result` leaves `Undecided`, returning pass or fail, with a time limit and a reading of 404 and unreachable as "still loading". The start itself is only Test Document (⌘F9), which `editor.testDocument` already drives.
