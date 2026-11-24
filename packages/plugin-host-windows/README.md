# @team-antioch/sc2-adjutant-host-windows

The Windows **Host Adapter** for [sc2-adjutant](https://github.com/TeamAntioch/sc2-adjutant). It is the Plugin that does what a Windows PC can do with StarCraft II, so the co-design tools can open, test and look at your maps for you. Without it, those tools hand you the steps to follow in the Editor yourself.

## What it does

| Capability | How |
|---|---|
| `editor.open`, `editor.checkClosed` | Opens a Map Package in the Galaxy Editor, and tells whether the Editor has it open. |
| `editor.testDocument`, `editor.save` | Runs File > Test Document, and saves a throwaway copy of a map, through the Editor's menu. |
| `game.banksDir` | The folder the game keeps its banks in; test_mission snapshots it around a test game. |
| `editor.captureTour`, `editor.closeCaptureCopies` | Plays a capture map and screenshots each camera stop, then closes it unsaved. |
| `game.launch` | Starts the game on a Map Package without the Editor. |
| `game.logsFolder` | `<Documents>\StarCraft II\GameLogs`, Documents as the shell has it. |
| `game.running`, `game.list`, `game.quit` | Tells whether a game runs, lists the running games with their start times, and quits one recorded game gracefully (close the window, then Yes), ending it only after a timeout. |
| `screen.capture` | Captures the game's window, even when other windows cover it. |
| `tts.speak` | Speaks placeholder voice lines with Windows' built-in voices. |
| `model.render`, `model.rendererKey`, `model.export`, `model.exportGltf` | Renders game and mod models to turntable thumbnails, and exports them as `.m3` or glTF, with the WhiteoutFlakes model viewer on D3D11. It falls back to WARP, Windows' software rasterizer, when the GPU can't run the viewer. |

The Editor, window capture and speech are driven by small C# helpers that the adapter compiles on first use, with the `csc.exe` that comes with Windows. Nothing is installed, and no binary ships.

## Install

`npx @team-antioch/sc2-adjutant init` installs it in a new Workspace on Windows, and names it in your machine config. To add it to an existing Workspace:

```sh
npm install @team-antioch/sc2-adjutant-host-windows
```

Then name it in your machine config (below): it loads only when it's named. It needs sc2-adjutant core (`@team-antioch/sc2-adjutant`) installed beside it, which is a peer dependency.

## What it needs

Set these in `%APPDATA%\sc2-adjutant\machine.json`:

```json
{
  "hostAdapter": "bundled:host-windows",
  "editorPath": "C:\\Program Files (x86)\\StarCraft II\\Support\\SC2Editor.exe",
  "sc2Path": "C:\\Program Files (x86)\\StarCraft II",
  "cacheDir": "~/AppData/Local/sc2-adjutant",
  "modelViewerPath": "~/AppData/Local/sc2-adjutant/whiteoutflakes/stage-arm64/WhiteoutFlakes.exe"
}
```

- **`editorPath`**: the 32-bit Editor, `Support\SC2Editor.exe`.
- **`sc2Path`**: the install folder, for `game.launch`.
- **`cacheDir`**: a folder outside the Workspace for the compiled helpers and the model viewer's working copies.
- **For models, `modelViewerPath`**: the WhiteoutFlakes viewer, which `scripts\build-whiteoutflakes.ps1` builds (`powershell -ExecutionPolicy Bypass -File scripts\build-whiteoutflakes.ps1 [-Dir <dir>] [-Arch x64|ARM64]`) into `stage-<arch>\`: `stage-x64` on most PCs, `stage-arm64` on an ARM PC as in the example above. It needs Git, Visual Studio 2022 (or its Build Tools) with the C++ workload (and the ARM64 tools for an ARM64 build), CMake, and the LunarG Vulkan SDK 1.4.341.0 with VMA. The first build takes 20 minutes or more.

Every path comes from the machine config. Nothing about your machine is built in, so a capability that needs a missing setting fails with the setting to add. The rest of the machine config is in [core's README](https://github.com/TeamAntioch/sc2-adjutant/tree/main/packages/core#the-machine-config).

## More

- [`docs/windows-host.md`](https://github.com/TeamAntioch/sc2-adjutant/blob/main/packages/plugin-host-windows/docs/windows-host.md): setup in detail, the Editor and game behaviour this adapter relies on, and how to do each step by hand.
- [The plugin API](https://github.com/TeamAntioch/sc2-adjutant/blob/main/docs/plugin-api.md#host-adapter-kinds): what every Host Adapter capability takes and returns.

MIT licensed.
