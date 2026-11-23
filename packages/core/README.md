# @team-antioch/sc2-adjutant

sc2-adjutant co-designs and compiles StarCraft II single-player campaign missions. You describe a Mission (its story, its places and its screenplay), and an assistant works through it with you, Stage by Stage, as a **Mission Blueprint**. sc2-adjutant then compiles the Blueprint into an unpacked Map Package that the Galaxy Editor opens and the game plays.

This is core: the compiler, the checks, the MCP server an assistant drives, the plugin SDK, and the data read from the game that they use. You use it through the [Claude Code plugin](https://github.com/TeamAntioch/sc2-adjutant/tree/main/packages/claude-plugin), which starts core's MCP server for the Workspace you have open.

## Install

You need Node 22.18 or later, and [Claude Code](https://claude.com/claude-code).

```sh
claude plugin marketplace add TeamAntioch/sc2-adjutant
claude plugin install sc2-adjutant@sc2-adjutant
npx @team-antioch/sc2-adjutant init my-campaign
```

`init` makes `my-campaign/`, a **Workspace** copied from the example Campaign. It writes a `package.json` that depends on core and on your platform's Host Adapter, with core's Workspace commands as its scripts (`npm run check`, `npm run compile-map -- missions/<id>/blueprint.json` and the rest). It also writes a `.gitignore`, runs `npm install`, and copies the skills of the Workspace's Plugins into `.claude/skills/`. It refuses a folder that already has a Workspace, or a file it would overwrite. `--no-install` leaves `npm install` for you to run; the first Claude Code session in the Workspace then copies the skills.

On macOS and Windows, `init` also writes [the machine config](#the-machine-config), naming your platform's Host Adapter, when you have no machine config yet. It never changes one you have: it says what yours names instead. Linux has no Host Adapter, so there `init` writes no machine config, and the tools that need one aren't offered.

Open Claude Code in the new folder and run `/sc2-adjutant:co-design`.

To update, run `npm update` in the Workspace and `claude plugin update sc2-adjutant@sc2-adjutant`. The plugin warns when its version and core's differ by a minor version, so you can tell when an upgrade is half done.

Working from a clone of the repo instead is in the [repo's README](https://github.com/TeamAntioch/sc2-adjutant#readme).

## What's in the package

- **The MCP server**, `sc2-adjutant-mcp <workspace folder>`, over stdio. The Claude Code plugin starts it for you. Any other MCP client can run it the same way.
- **`sc2-adjutant init <folder>`**, which starts a Workspace (above).
- **The plugin SDK**, `@team-antioch/sc2-adjutant/plugin-sdk`, which is what a Plugin's code imports. See [the plugin API](https://github.com/TeamAntioch/sc2-adjutant/blob/main/docs/plugin-api.md).
- **`bundled:hazard`**, a generic Mechanic built into core. It declares a hazard that sweeps zones on a cycle while safe zones stay clear, as a Threat for the layout checks. It builds no triggers yet, so it changes nothing in game.
- **The example Workspace** (`examples/example-campaign/`), which `init` copies. It has a Campaign Pack, a small Campaign Mod, a Screenplay and one Mission, and its README walks through making it your own.
- **Catalogs read from the game** (`data/`): units, doodads, textures, cliffs, Lights, trigger libraries and more. The compiler and the checks validate a Blueprint against them.

The Doodad Finder and the Set Finder (`@team-antioch/sc2-adjutant-doodad-finder` and `@team-antioch/sc2-adjutant-set-finder`) are optional dependencies, so an install has them by default. With them, the server also serves `find_doodads`, `open_doodad_finder` and `find_sets`.

## The Workspace

A Workspace is a folder of Missions with `sc2-adjutant.workspace.json` at its root. The tools find it above whatever Blueprint or folder they're given.

```json
{
  "campaign": { "id": "example", "name": "Example Campaign" },
  "missions": "missions",
  "campaignPack": "./plugins/campaign-example",
  "plugins": ["bundled:hazard"],
  "mods": ["example"]
}
```

| Field | What it is |
|---|---|
| `campaign` | The Campaign's `id` and `name`. |
| `missions` | The folder of Mission folders, relative to the Workspace root (`missions` by default). Each Mission folder holds its `blueprint.json`, its Screenplay and its committed Map Package. |
| `campaignPack` | The Campaign Pack Plugin: the Campaign's own naming, Mechanics and Screenplay Source. Optional. |
| `stylePack` | The Style Pack Plugin: the visual style the design skills follow, such as `bundled:style-antioch` once `@team-antioch/sc2-adjutant-style-antioch` is installed in the Workspace. `init`'s Workspace names none. Optional. |
| `utilities` | Utility Plugins: optional tools the Workspace chooses to add, each a local folder (`./utilities/<name>`) or a `bundled:<name>` package, loaded after the packs in this order. Each must declare the `utility` role. Optional. |
| `plugins` | Further Plugins, such as single Mechanics, loaded after the packs and Utilities in this order. |
| `mods` | The Workspace's mods by id, each in `mods/<id>/` with its Mod Blueprint. `import_mod` adds them. |
| `campaignMod` | The Campaign Mod's package name without `.SC2Mod`, when the Campaign Pack doesn't name it. Optional. |
| `exemplarMaps` | The folder holding the Style Pack's Exemplar Maps' source maps, relative to the Workspace root, when that folder travels with the Workspace. The machine config's `exemplarMaps` overrides it. Optional. |

A Plugin is named as `bundled:<name>` for one that ships with sc2-adjutant, or as a local folder (`./plugins/beacon`, relative to the Workspace root, or an absolute path). How to write one is in [the plugin API](https://github.com/TeamAntioch/sc2-adjutant/blob/main/docs/plugin-api.md).

## The machine config

Settings for your own machine live outside the Workspace, in `machine.json` in your sc2-adjutant config folder:

| Platform | Folder |
|---|---|
| macOS and Linux | `$XDG_CONFIG_HOME/sc2-adjutant/` when that is set, else `~/.config/sc2-adjutant/` |
| Windows | `%APPDATA%\sc2-adjutant\` |

`SC2_ADJUTANT_MACHINE_CONFIG` names another file. Every setting is optional, and an environment variable overrides each one:

| Setting | Env var | What it is |
|---|---|---|
| `hostAdapter` | `SC2_ADJUTANT_HOST_ADAPTER` | The Host Adapter Plugin: `bundled:host-macos`, `bundled:host-windows`, or a local folder relative to the config file. A Host Adapter loads only when it's named here, on any platform, and `init` names your platform's. Unset or `none`, none loads. |
| `editorPath` | `SC2_ADJUTANT_EDITOR_PATH` | The Galaxy Editor the Host Adapter opens. |
| `sc2Path` | `SC2_ADJUTANT_SC2_PATH` | The StarCraft II install folder. |
| `cacheDir` | `SC2_ADJUTANT_CACHE_DIR` | A folder for caches and scratch files: downloaded game data, capture copies, the model viewer's working copies. |
| `modelViewerPath` | `SC2_ADJUTANT_MODEL_VIEWER_PATH` | The model viewer the Host Adapter renders and exports game models with. |
| `exemplarMaps` | `SC2_ADJUTANT_EXEMPLAR_MAPS` | The folder holding the Style Pack's Exemplar Maps' source maps. |

Paths may start with `~/`. A relative path is relative to the config file, or, from an environment variable, to the current folder. No machine path is built in, so a capability that needs a path fails with the name of the setting to add.

## Host Adapters

A **Host Adapter** is the Plugin that does what your machine can do with StarCraft II: open the Editor, run Test Document, capture the screen, speak placeholder voice lines and render models. There is one for each platform:

- [`@team-antioch/sc2-adjutant-host-macos`](https://github.com/TeamAntioch/sc2-adjutant/tree/main/packages/plugin-host-macos), as `bundled:host-macos`
- [`@team-antioch/sc2-adjutant-host-windows`](https://github.com/TeamAntioch/sc2-adjutant/tree/main/packages/plugin-host-windows), as `bundled:host-windows`

`init` installs the one for your platform. Every tool works without a Host Adapter: what the machine can't do, a tool hands to you as steps to follow in the Editor, and a bulk job with no manual form isn't offered. A Host Adapter loads only when the machine config names it, and one it names must be installed.

## Plugins

Plugins add what core doesn't know: a Campaign's own Mechanics and naming (a **Campaign Pack**), a visual style (a **Style Pack**), an optional tool the Workspace chooses to add (a **Utility**), or a platform (a **Host Adapter**). The Antioch Style Pack, [`@team-antioch/sc2-adjutant-style-antioch`](https://github.com/TeamAntioch/sc2-adjutant/tree/main/packages/plugin-style-antioch), is one to start from. To write your own, read [the plugin API](https://github.com/TeamAntioch/sc2-adjutant/blob/main/docs/plugin-api.md).

## Links

- [Repository](https://github.com/TeamAntioch/sc2-adjutant)
- [The plugin API](https://github.com/TeamAntioch/sc2-adjutant/blob/main/docs/plugin-api.md)
- [Glossary](https://github.com/TeamAntioch/sc2-adjutant/blob/main/GLOSSARY.md)
- [Screenplay format](https://github.com/TeamAntioch/sc2-adjutant/blob/main/docs/screenplay-format.md)

MIT licensed.
