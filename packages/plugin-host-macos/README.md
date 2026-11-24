# @team-antioch/sc2-adjutant-host-macos

The macOS **Host Adapter** for [sc2-adjutant](https://github.com/TeamAntioch/sc2-adjutant). It is the Plugin that does what a Mac can do with StarCraft II, so the co-design tools can open, test and look at your maps for you. Without it, those tools hand you the steps to follow in the Editor yourself.

## What it does

| Capability | How |
|---|---|
| `editor.open`, `editor.checkClosed`, `editor.refresh` | Opens a Map Package in the Galaxy Editor, tells whether the Editor has it open, and closes a clean copy so a compile can rewrite it. It never saves or discards your changes. |
| `editor.testDocument`, `editor.save` | Runs File > Test Document, and saves a throwaway copy of a map, through the Editor's menus. |
| `game.banksDir` | The folder the game keeps its banks in; test_mission snapshots it around a test game. |
| `editor.captureTour`, `editor.closeCaptureCopies`, `game.running` | Plays a capture map and screenshots each camera stop, then closes it unsaved. Captures run one at a time through the Editor Broker. A capture quits only the game it started. |
| `game.logsFolder` | `~/Library/Application Support/Blizzard/StarCraft II/GameLogs`. |
| `game.list`, `game.quit` | Lists the running games with their start times, and quits one recorded game gracefully (Cmd+Option+Q, then Yes), killing it only after a timeout. |
| `screen.capture` | Captures the game's window, else the Editor's. |
| `tts.speak` | Speaks placeholder voice lines with macOS's `say`. |
| `model.render`, `model.rendererKey`, `model.export`, `model.exportGltf` | Renders game and mod models to turntable thumbnails, and exports them as `.m3` or glTF, with the WhiteoutFlakes model viewer. |

It has no `game.launch`, because the Mac game starts only through the Editor's Test Document.

## Install

`npx @team-antioch/sc2-adjutant init` installs it in a new Workspace on a Mac, and names it in your machine config. To add it to an existing Workspace:

```sh
npm install @team-antioch/sc2-adjutant-host-macos
```

Then name it in your machine config, `~/.config/sc2-adjutant/machine.json`. It loads only when it's named:

```json
{
  "hostAdapter": "bundled:host-macos",
  "editorPath": "/Applications/StarCraft II Editor (Fixed).app",
  "cacheDir": "~/Library/Caches/sc2-adjutant",
  "modelViewerPath": "~/.cache/sc2-adjutant/whiteoutflakes/stage/WhiteoutFlakes.app/Contents/MacOS/WhiteoutFlakes"
}
```

It needs sc2-adjutant core (`@team-antioch/sc2-adjutant`) installed beside it, which is a peer dependency.

## What it needs

- **`editorPath`**: the Galaxy Editor app to launch. On Apple Silicon, the native Editor runs only through a community fix that ships as a launcher app ([the native Editor fix](https://github.com/TeamAntioch/sc2-adjutant/blob/main/packages/plugin-host-macos/docs/macos-host.md#the-native-editor-fix)). Point `editorPath` at that launcher, since the bare Editor crashes at launch.
- **`cacheDir`**: a folder outside the Workspace for capture copies and the model viewer's working copies.
- **Accessibility and Screen Recording permission** for the app that runs the MCP server (your terminal, or Claude Code). The Editor is driven through its menus, and captures read the screen.
- **For models, `modelViewerPath`**: the WhiteoutFlakes viewer, which `scripts/build-whiteoutflakes.sh [dir]` builds. It needs Xcode, with its Metal toolchain, Homebrew, git, and the GitHub CLI (`gh`) signed in, which downloads the shader compiler. Re-running it skips the steps already done.

Every path comes from the machine config. Nothing about your machine is built in, so a capability that needs a missing setting fails with the setting to add. The rest of the machine config is in [core's README](https://github.com/TeamAntioch/sc2-adjutant/tree/main/packages/core#the-machine-config).

## More

- [`docs/macos-host.md`](https://github.com/TeamAntioch/sc2-adjutant/blob/main/packages/plugin-host-macos/docs/macos-host.md): the Editor and game behaviour this adapter relies on, and how to do each step by hand.
- [The plugin API](https://github.com/TeamAntioch/sc2-adjutant/blob/main/docs/plugin-api.md#host-adapter-kinds): what every Host Adapter capability takes and returns.

MIT licensed.
