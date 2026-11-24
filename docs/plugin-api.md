# The plugin API

A **Plugin** adds to sc2-adjutant what core doesn't know: a Campaign's own Mechanics and naming, a visual style, or what one kind of machine can do with StarCraft II. This page is the contract between a Plugin and core, for plugin API version **2**. The decision behind it is [ADR-0005](./adr/0005-code-plugins-with-typed-contributions.md), and the terms (Plugin, Contribution, Campaign Pack, Style Pack, Host Adapter, Mechanic) are in [GLOSSARY.md](../GLOSSARY.md).

The field-by-field types are in [`packages/core/src/plugins/plugin-api.ts`](../packages/core/src/plugins/plugin-api.ts), and every field has a doc comment there. A Plugin's code imports them from `@team-antioch/sc2-adjutant/plugin-sdk`, so an editor shows those comments as you write. This page covers what the types can't say: what each part is for, who may contribute it, and the rules core enforces when it loads a Plugin.

## What a Plugin is

A Plugin is a folder holding a manifest, `sc2-adjutant-plugin.json`. It may also hold a code entry point and the files its manifest names. A Plugin of knowledge alone, with documents, Composites or Lights, needs no code.

Each Plugin fills zero or more **roles**:

| Role | Named in | What it may contribute beyond the shared kinds |
|---|---|---|
| `campaign-pack` | the Workspace config's `campaignPack` | a naming template, a Screenplay Source, the Campaign Mod's name |
| `style-pack` | the Workspace config's `stylePack` | style rules (Design Lessons as code) |
| `utility` | the Workspace config's `utilities` list | nothing beyond the shared kinds: an optional tool a Workspace chooses to add ([ADR-0023](./adr/0023-utility-plugin-role.md)) |
| `host-adapter` | the machine config's `hostAdapter` | Host capabilities |

A Plugin with no role, such as a single Mechanic, goes in the Workspace config's `plugins` list. Mechanics come only from the Workspace's Plugins: a Host Adapter that contributes any is refused. One Plugin can fill several roles: name it in each slot, and declare each role in its manifest.

### Naming a Plugin

A Workspace config (`sc2-adjutant.workspace.json`) or the machine config names a Plugin by its **source**:

- `bundled:<name>`, for a Plugin that ships with sc2-adjutant. `bundled:hazard` is built into core. `bundled:host-macos`, `bundled:host-windows` and `bundled:style-antioch` are packages of their own, found wherever core can resolve them (installed beside core).
- A local folder: a path starting with `./` or `../`, relative to the Workspace root (or, for `hostAdapter`, to the machine config file), or an absolute path. A relative folder that a linked git worktree doesn't hold is looked for from the main working tree.

Loading a Plugin by npm package name isn't supported yet.

### Load order

Core loads the Workspace's Campaign Pack, then its Style Pack, then its `utilities` in their order, then its `plugins` in their order. Nothing else is loaded. A source named in more than one slot loads once, with each of those roles. A Plugin named twice by another source is refused, and so is a second contribution of anything that must be unique (below). The machine's Host Adapter is loaded on its own, from the machine config, whatever Workspace is open.

The MCP server rereads the Workspace config and every manifest on each call, so a config edit applies on the next call. It imports a Plugin's code once per process, so after editing code, restart the server (in Claude Code, `/reload-plugins`). The machine config and the Host Adapter are read once, at start.

## The manifest

```json
{
  "name": "beacon",
  "version": "0.1.0",
  "pluginApi": 2,
  "roles": [],
  "contributions": { "mechanics": ["beacon"] },
  "entry": "./dist/index.js"
}
```

| Field | Rules |
|---|---|
| `name` | Lowercase, like an npm package name. A `bundled:<name>` Plugin's manifest must be named `<name>`. |
| `version` | The Plugin's own version, shown by `list_plugins`. |
| `pluginApi` | The plugin API version the Plugin was built for. Core refuses a Plugin built for any version but its own, naming both. |
| `roles` | Any of `campaign-pack`, `style-pack`, `utility` and `host-adapter`. A Plugin named in a role slot must declare that role. |
| `contributions` | What the Plugin contributes, by kind (next section). Unknown kinds are refused, so a misspelling fails loudly. |
| `entry` | The code entry point, relative to the manifest. Needed when the Plugin contributes code. |

Every file a manifest's `contributions` name must be a file inside the Plugin's folder, after symlinks are resolved. A path outside the folder, a missing file or a folder is refused.

## Contributions

### Shared kinds

Any Plugin may contribute these.

| Kind | Manifest | Code | What it is |
|---|---|---|---|
| `mechanics` | the Mechanic types | `mechanics` | Gameplay a Blueprint's `mechanics[]` entries use ([Mechanics](#mechanics)). |
| `knowledge` | `[{ id, title, description?, file }]` | none | Documents (`.md`, `.json` or `.txt`), served as MCP resources at `sc2-adjutant://plugins/<plugin>/knowledge/<id>`. The skills read a pack's knowledge only through these resources, never from its files. |
| `prompts` | `[{ name, title?, description, arguments?, file }]` | none | MCP prompts for the Plugin's own workflows. The file is the prompt's text, with `{{argument}}` where each argument goes. |
| `skills` | the skill folders, `["skills/<name>"]` | none | Claude Code skills ([ADR-0023](./adr/0023-utility-plugin-role.md)): folders in the Plugin, each holding a `SKILL.md` and its files. A folder's name is lowercase letters, digits and hyphens. A skill is copied as its Plugin's name, a hyphen, and its folder's name (`example-pack` and `dressing-review` make `example-pack-dressing-review`), and the copy's `SKILL.md` frontmatter `name:` is set to that. A folder named as its Plugin is, or starting with its Plugin's name and a hyphen, keeps its name (`portraits` from Plugin `portraits`). A scoped Plugin name loses its `@`, and each run of other characters a skill name can't hold becomes a hyphen (`@scope/x.y` makes `scope-x-y-<folder>`). `list_plugins` shows each skill by the name it's copied as. The Claude Code plugin's SessionStart hook copies each into the Workspace's `.claude/skills/<copied name>/`, where Claude Code finds project skills, and the `sync` tool does the same mid-session ([the plugin's README](../packages/claude-plugin/README.md#skills-from-the-workspaces-plugins)). In a skill's Markdown files, `{{PLUGIN_FOLDER}}` is filled in with the Plugin's folder on copy, so a skill runs its scripts and reads its docs from the Plugin (`python3 {{PLUGIN_FOLDER}}/skills/<folder>/script.py`, with the skill's folder in the Plugin, not its copied name), not from the copy. Other files are copied as they are, except Python's `__pycache__` folders and `.pyc` files, which are left out. |
| `composites` | a JSON file, `{ "composites": [...] }` | none | Doodad Composite recipes. A set piece can stamp one that its Mission doesn't define. |
| `lights` | a JSON file, `{ "lights": [...] }` | none | Lights for a look no stock Light has. Each one copies a stock Light in full (`from`, an id in core's `data/light-catalog.json`) and retunes its key, fill, back, ambient and exposure, as a Mission's own `lights` entry does. A Mission names one wherever it names a Light (its `lighting`, a transition's, a Cinematic's or a shot's), and only the Lights a Mission names are written into its map. `compile-cutscene` writes the Lights a test Cinematic names into the map it writes into, over any older copy, so a retuned Light shows, and `check-workspace` warns of a Light a Cinematic names that is none of its sets', the Mission's, a Plugin's or stock. Fog isn't part of a Light: it is the Mission's `sky.fog`. |
| `exemplarMaps` | a JSON file, `{ "exemplars": [{ id, map, provenance, note? }] }` | none | Exemplar Maps. Each one's Map Study is `<id>/study.json` beside the list. `map` is the source map's path inside the folder the machine config's `exemplarMaps` names, so a pack can be shared without its source maps. The list, each Map Study and the Composites are also served as knowledge documents (`exemplar-maps`, `study-<id>`, `composites`). |
| `cutsceneSources` | the source kind ids | `cutsceneSources` | Kinds of Cutscene Editor source the cinematic set catalog reads, with a hook that strips a Campaign's naming conventions from actor names. Core provides `blizzard` itself. |

Unique across the loaded Plugins: Mechanic types, Composite ids, prompt names, the names skills are copied as, Light ids and cutscene source ids. Core refuses a Plugin that repeats one, naming the Plugin that had it first. A Light is also refused when its values are invalid, when it copies a Light the stock catalog lacks, or when it takes a stock Light's id. A Mission's own Light can't take a Plugin Light's id either.

### Campaign Pack kinds

Only the Plugin named as the Workspace's `campaignPack` may contribute these. Core refuses one from any other slot.

| Kind | Manifest | Code | What it is |
|---|---|---|---|
| `naming` | one template name | `naming` | How a Screenplay's conversation, lines, sounds and speakers' CCharacters are named in the compiled map. Every hook is optional, and core's default naming fills in the rest: the Mission id, scene and line (`outpost`, `Line1-2`, `outpost-1-2`). |
| `screenplaySource` | one Source name | `screenplaySource` | Where the Campaign keeps its Screenplays, if not as files in the Workspace. `fetch` returns a Screenplay in core's [Markdown format](./screenplay-format.md). The optional `edit` changes it at its source, and the optional `refForConversation` names the Screenplay of an imported conversation. |
| `campaignMod` | the Campaign Mod's package name, without `.SC2Mod` | none | Which Workspace mod is the Campaign Mod ([ADR-0011](./adr/0011-mods-from-mod-blueprints.md)). A Workspace config can name it instead, as `campaignMod`, so a Campaign needs no Plugin to have one. When both name one, they must agree. |

A Campaign's characters are declared in its Campaign Mod's Blueprint, not by a Plugin. A manifest that still has `contributions.characters` is refused, and the error says where they went.

A Screenplay Source is the one Campaign Pack hook that may read files, run commands or use the network. Every other is pure.

### Style Pack kinds

`styleRules` lists rule ids, and the code's `styleRules` gives each rule: `{ id, lesson?, ...slots }`. A rule is a Design Lesson as code. It fills slots of core's dresser and texture painter (`StyleRuleSlots`):

| Slot | What it decides | With no rule |
|---|---|---|
| `yaw` | how a pile piece, set-piece member or Composite copy turns | its free turn |
| `pileScale`, `lipScale` | default scale ranges | scale 1 |
| `cliffPile`, `shorePile` | what a cliff-foot or shore pile holds, and where each piece stands | one large piece |
| `lipClumps` | how a lip line grows in clumps | even spacing |
| `breakWear` | caps and debris on a broken built run | one of each, at scale 1 |
| `varietyPatches` | variety patches in natural ground under a texture palette | one texture per zone |
| `blendGroup` | which textures blend widely into each other | one group |
| `compositeWarnings`, `cliffTextureWarnings` | advice on Composite copies and on the textures across cliffs | none |

Two rules can't fill one slot. Only the rules of the Plugin named as the Workspace's `stylePack` apply. A Plugin that contributes rules must declare the `style-pack` role. The registry checks each rule's shape when it loads, and each slot's result when it is called. An error names the rule, its Plugin and the slot. The pile hooks get a deterministic `random(key)` and the dresser's own `choose(role, count)`, so that dressing is stable across compiles. Don't use `Math.random`.

### Host Adapter kinds

`capabilities` lists the capability names, and the code's `capabilities` maps each one to an async function `(request, context) => result`. Only the Plugin the machine config names as `hostAdapter` may contribute them. Each capability gets a `HostContext` with the machine's settings (`sc2Path`, `editorPath`, `cacheDir`, `modelViewerPath`, `exemplarMaps`) and a `requirePath(setting)` that fails with the setting to add. No machine path is built in.

| Capability | What it does |
|---|---|
| `editor.open` | Opens a Map Package in the Galaxy Editor. |
| `editor.checkClosed` | Rejects when the Editor has the Map Package open, since rewriting an open map can crash it. |
| `editor.refresh` | Closes the author's own map in the Editor so a compile can rewrite it. It never saves, and it never discards unsaved changes. |
| `editor.testDocument` | Opens a Map Package and runs File > Test Document. |
| `editor.save` | Opens a throwaway copy of a map, saves it in the Editor, and closes it. |
| `editor.captureTour` | Runs a capture map and screenshots each stop its bank announces, then closes the map unsaved. A bulk job with no manual form. |
| `editor.closeCaptureCopies` | Closes, unsaved, any capture copies the Editor has open, after quitting the `games` the Editor Broker recorded as a capture's. It quits no other game. |
| `game.running` | Whether a StarCraft II game is running. |
| `game.banksDir` | The folder the game keeps its banks in, which the Editor Broker snapshots around a test game. |
| `game.list` | Every running game as `{ pid, startedAt }`, so the Editor Broker can record the game a job starts and tell it from the author's. |
| `game.logsFolder` | The folder the game writes its logs to (GameLogs). Core reads a run's crashes and errors from it ([game-testing.md](reference/game-testing.md#reading-a-runs-logs)). |
| `game.quit` | Quits one recorded game and no other, gracefully (the game's own quit, then Yes) and by its pid and start time, ending the process only after a timeout. |
| `game.launch` | Starts the game on a Map Package without the Editor. |
| `screen.capture` | Captures the game window (else the Editor's) to an image. |
| `tts.speak` | Speaks a placeholder line into a WAV file. |
| `model.render` | Renders a model on a turntable to PNGs, reading it from mod packages first and then the game. Rejects with `modelNotFound` when neither has it. |
| `model.rendererKey` | A string that changes whenever `model.render`'s output would, used to key cached thumbnails. |
| `model.export` | Writes a game model's `.m3`, with its animations merged in, and optionally its textures. |
| `model.exportGltf` | Writes a model as a glTF binary with its textures embedded. |

A capability resolves when its job is done. When it can't do the job, it rejects with a reason the author can act on. Core asks whether a capability exists before using it. A co-design tool without one hands the step to the author as instructions, and a bulk tool with no manual form isn't listed at all. So a Host Adapter may leave out what its platform can't do.

### Declared and contributed must match

For each kind a Plugin's code provides (`mechanics`, `naming`, `screenplaySource`, `styleRules`, `capabilities`, `cutsceneSources`), the manifest lists the same ids, each once. Core refuses a Plugin whose code contributes anything else, and the error lists both sides. `list_plugins` reports what the manifest declares, so this keeps it truthful.

## Mechanics

A Mechanic is gameplay the Blueprint names by `type`: a hazard that sweeps zones on a cycle, a gate that opens on a timer, a resource the hero carries. Write one with `defineMechanic`, which keeps its params typed from its schema:

```ts
import { defineMechanic, type PluginCode } from "@team-antioch/sc2-adjutant/plugin-sdk";
import { z } from "zod";

const beacon = defineMechanic({
  type: "beacon",
  paramsSchema: z.object({ zoneId: z.string() }).strict(),
  validate: (params, context) =>
    context.zones.some((zone) => zone.id === params.zoneId) ? [] : [{ message: `Unknown zone id: ${params.zoneId}`, path: ["zoneId"] }],
  buildTriggers: (params, context) => [/* Triggers built from typed GUI primitives */],
});

export default { mechanics: [beacon] } satisfies PluginCode;
```

Every hook is a pure function from a read-only context to typed data. It must not read files, use the network or keep state between calls. That keeps compiles deterministic, and it leaves room for a sandbox later without changing the contract. An error a hook throws is reported with the Blueprint entry and the Plugin that provides it.

| Part | Required | What it is for |
|---|---|---|
| `type` | yes | The `type` a Blueprint's `mechanics[]` entry names. |
| `paramsSchema` | yes | A Zod schema for the entry's `params`. It joins the Blueprint's validation, so make it strict. |
| `buildTriggers` | yes | The Mechanic's triggers, built only from typed GUI trigger primitives ([ADR-0002](./adr/0002-typed-gui-trigger-primitives.md)): core's and its own `primitives`. It returns a list of triggers, or `MechanicTriggers` when it also needs global variables, gameplay clocks that core pauses during cutscenes, actions at a Beat's start, or actions before victory. |
| `primitives` | no | Editor functions, presets and block slots core hasn't wrapped, each verified byte-exact against an Editor-saved map. A primitive core or another Mechanic already defines differently is refused. |
| `single` | no | At most one entry of this type in a Mission. |
| `requires` | no | Other Mechanic types a Mission must also have for this one to work. |
| `cues` | no | Named moments where the Blueprint can cue scenes (`{ type: "mechanic", mechanicId, cue }`). The triggers get what to play there from `context.cueActions(cue)`. |
| `validate` | no | Checks against the rest of the Blueprint that the schema can't make, such as ids that must exist. Each issue's `path` is relative to `params`. |
| `warnings` | no | Advice that doesn't stop the compile. It is printed with the compile's own warnings. |
| `buildGameData` | no | Map-local catalog entries, strings and hotkeys. Static setup belongs in data, so the Editor shows what the game does ([ADR-0007](./adr/0007-static-state-in-game-data.md)). Core fails the compile when two sources set the same string or hotkey. |
| `threats` | no | The Threats the Mechanic adds ([ADR-0006](./adr/0006-threats-and-schedules.md)). The layout checker's safety checks read these like any enemy's. |
| `connectionChanges` | no | Changes the Mechanic makes to the Blueprint's Connections on a Schedule, such as a ford that floods each surge. |

What the hooks read:

- **`MechanicContext`** (every hook) has the Blueprint's zones, Anchors, Beats, regions, the other `mechanics[]` entries and the Mission's Light. It also has `placedUnits()`, the units the built Placements place. Don't call `placedUnits()` from `validate`, which runs before the Placements are known to parse.
- **`MechanicTriggerContext`** (`buildTriggers`) adds `mechanicId`, the Campaign Mod's `library` (its functions as typed primitives, read from the Mod Blueprint's library interface) and `cueActions(cue)`.
- **`MechanicThreatContext`** (`threats`) adds `walkableFrom(zoneId)`, for a Threat that covers wherever a ground unit can walk.

**Names.** Trigger names and global variable names are global in the map script: each trigger becomes `gt_<name>`, with everything but letters, digits and underscores dropped. Derive every trigger, variable and element id from `mechanicId` (or the entry's params), so two entries of one type don't collide. Never reuse a core trigger's name, such as "Mission Start". A clash fails the compile, naming both triggers.

## Code and packaging

- **Import core only from `@team-antioch/sc2-adjutant/plugin-sdk`.** It re-exports the plugin API, the typed GUI trigger primitives Mechanics build from, and the helpers a Host Adapter reads and writes images and models with. Anything else in core is internal and can change without notice. In the sc2-adjutant repo, lint refuses a Plugin file that imports core any other way.
- **The entry's default export is a `PluginCode`:** `{ mechanics?, cutsceneSources?, naming?, screenplaySource?, styleRules?, capabilities? }`. The registry checks its shape when it loads it.
- **Declare core as a peer dependency** (`"@team-antioch/sc2-adjutant": "^0.1.0"`), so a Plugin uses the core it is loaded by and doesn't bundle its own copy. Core checks errors such as `modelNotFound` by their `code`, not their class, so a bundled copy of the SDK still works.
- **A published Plugin ships JavaScript.** Node won't strip TypeScript types under `node_modules`, so a Plugin installed from npm must point `entry` at built JavaScript, such as `./dist/index.js`. A Plugin in a local folder outside `node_modules` (in a Workspace, say) may point `entry` at TypeScript directly: Node 22.18 or later loads it as it is. Give that folder a `package.json` with `"type": "module"`, and import core's types with `import type` so Node erases the import.

## Versioning

`pluginApi` is the contract's version. Core provides one version (`PLUGIN_API_VERSION`, now 2), and it refuses a Plugin built for another. A change that a Plugin written for the old contract would break on raises the version. A new optional hook, Contribution kind or capability doesn't.

Version 2 changed the `threats` hook to return Threats with a footprint, a schedule, a telegraph, safety and a consequence.

One breaking type change was made within version 2. A Screenplay Source's `ScreenplayRequest` carries `missionId` for a Mission's Screenplay or `modId` for one of a Campaign Mod's, so `missionId` is optional in the type. A Source that reads `missionId` as a string no longer type-checks until it handles `modId`. At run time, a Source that knows only Missions is still asked only about Missions until its Campaign Mod declares Screenplays.

## Worked examples

- [`packages/core/src/plugins/hazard/`](../packages/core/src/plugins/hazard/): the generic `hazard` Mechanic, built into core as `bundled:hazard`. It has a strict schema, a `validate` hook and a `threats` hook. It builds no triggers yet, so its `buildTriggers` returns none: see `MechanicTriggers` in the types for what a full one returns.
- [`packages/core/examples/example-campaign/plugins/campaign-example/`](../packages/core/examples/example-campaign/plugins/campaign-example/): a Campaign Pack in a Workspace, with a naming template and the Campaign Mod's name, in TypeScript loaded as it is. The [example Workspace's README](../packages/core/examples/example-campaign/README.md) walks through making it your own.
- [`packages/plugin-style-antioch/`](../packages/plugin-style-antioch/README.md): a Style Pack. It has knowledge documents, Exemplar Maps, Composites, a prompt, and style rules in `rules.ts`.
- A Style Pack of a mapper's own, in a Workspace folder (`"stylePack": "./style-pack"`): the MCP server's `scaffold_style_pack` makes one with the Antioch package's layout (a manifest, an empty Exemplar Maps list, `LESSONS.md`, `candidate-lessons.md`, a `GUIDE.md` stub and a `.gitignore` for captures), and `add_exemplar_map` records each of its Exemplar Maps. It has no style rules.
- A Utility: a folder in a Workspace (`"utilities": ["./utilities/portraits"]`) whose manifest declares the `utility` role and contributes `skills: ["skills/portraits"]`, a skill that runs its scripts from `{{PLUGIN_FOLDER}}/skills/portraits/`.
- [`packages/plugin-host-macos/`](../packages/plugin-host-macos/README.md) and [`packages/plugin-host-windows/`](../packages/plugin-host-windows/README.md): Host Adapters.

`list_plugins` on the MCP server shows each loaded Plugin with its roles and Contributions. When a Plugin can't load, it and `npm run check-workspace` say why.
