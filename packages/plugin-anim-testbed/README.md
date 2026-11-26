# anim-testbed, an sc2-adjutant Utility

Audition a unit's animations and sounds in the game with a GUI. One **spec** per test lists the units
(stock ones, or models of your own) with their animations, the **moments** to judge (an attack, its
impact, a hit, a death, a voice line) and, per unit and moment, the **variations** to compare. Each
variation is a timeline: the unit's animations, sounds, effects and actor messages, each at a time.
The build turns the spec into a test map:
the base map's terrain, the units in a row, a target facing the selected one, and a dialog to pick and
play.

It is a Utility ([ADR-0023](../../docs/adr/0023-utility-plugin-role.md)): a tool a Workspace chooses to
add. It writes nothing from Blizzard anywhere but the test map, which must be inside a git-ignored
`output/` folder.

## Using it

A Workspace made by `init` has it already: `init` installs the package and lists `bundled:anim-testbed`
in the Workspace config's `utilities`. In a Workspace that doesn't have it, install the package beside
sc2-adjutant and list it:

```sh
npm install @team-antioch/sc2-adjutant-anim-testbed
```

```json
{ "utilities": ["bundled:anim-testbed"] }
```

At the next session start, its `anim-testbed` skill is copied into the Workspace's `.claude/skills/`.
Build a map from a spec:

```sh
node node_modules/@team-antioch/sc2-adjutant-anim-testbed/dist/testbed.js <spec.json> [--check]
```

`--check` validates without writing the map. Open the map in the Editor and run Test Document. After a
rebuild that changes a model, quit the Editor first: it keeps a model loaded by name.

In the dialog:

1. Pick a **Unit**, a **Moment** and a **Variation**. Changing the unit keeps the moment, so one moment
   can be compared across units. Each moment shows how many variations the unit has for it, and each
   variation is tagged with what it holds (`[anim + sound + visual]`, or part of it). `*` marks the
   spec's pick. A moment with one variation shows no Variation dropdown.
2. Press **Play** to play the variation's timeline. **Stop** cuts it and its sounds. **Loop** replays it.
3. Watch the readout: one sentence ("marine attack: variation 2 of 2, 3 elements, 1.15 s."), then the
   timeline in seconds from Play. Each element is greyed until it fires, and each animation's strike
   and land are gold marker rows, to line sounds up against by eye.

**Send** plays the edit box's text as a CSound id at the unit. Text with a space goes to the unit's
actor, and text starting with `target ` goes to the target's actor. `-help` in chat lists this.

`examples/stock-units.json` uses stock units and stock sounds only. It builds on the example Campaign's
Mission:

1. Copy the spec to `missions/ashfall-relay/tests/` in a Workspace made by `init`.
2. Compile the Mission once: `npm run compile-map -- missions/ashfall-relay/blueprint.json`.
3. Run the testbed on the spec.

## The spec

JSON, with `//` comments allowed. Paths are relative to the spec, or `<root>:path` with a root from `roots`.

| Key | What it is |
|---|---|
| `name`, `title` | The map's name (default: the spec's file name) and the dialog's title |
| `base` | Any Editor-saved `.SC2Map` folder, usually the Mission's Map Package. Its triggers are replaced; its terrain and data are kept |
| `out` | The map to write, inside an `output/` folder. By default `output/<name>.SC2Map` beside the base map: the Mission's git-ignored `output/` |
| `roots` | `{ "x": "~/private/folder" }`, so a spec names private files (extracted game files, a model's exports) without machine paths |
| `stage` | `at` [x, y] of the first unit, `gap` between units, `facing` (270: models face as exported), `fog` (false), `player` (0, neutral), and a tour's `cameraDistance` and `cameraShift` |
| `target` | `{ "unit": "Zergling", "player": 1 }`: stands `reach` in front of the selected unit; impact sounds play on it. Optional |
| `moments` | The moments' names, in dropdown order. By default, the order the units first name them |
| `sounds` | CSound id → `{ "parent", "from": folder, "files": [globs], "fields": {…} }`: the map's own sounds, from files the build copies in |
| `data` | XML files of `<Catalog>` elements (CModel, CActor…, CEffect…), each routed to its catalog in the map |
| `assets` | `[{ "from", "to": "Assets/…" }]`: other files the data names |
| `units` | Below |
| `tour` | The stops a `--capture` build films: `{ "unit", "moment", "variation", "hold" }` |

**A moment.** Something that happens to a unit that you want to judge: an attack, its impact, a hit, a
death, voice lines. It is only a name; what happens is in each unit's variations of it.

Some spellings are kept for what isn't built yet ([#96](https://github.com/TeamAntioch/sc2-adjutant/issues/96)),
and the build refuses them: an `order` element, a unit's key as an element's `on`, and `on <event>` as
an element's `at`.

**A unit.** It has a `key` (its name in the dropdown) and either `unit` (a CUnit id) or `new`.
`new` is `{ "id", "model", "anims": [.m3a], "textures": [folders], "scale", "alias" }`: the build copies
the files in and adds a CModel, CUnit and CActorUnit for it. Then come `reach` (where the target stands),
`idle`, `respawn` (4), `animations` and `moments`.

**An animation.** Name → `{ "play": "AnimPlay Attack Spell,C NonLooping", "strike", "land", "length" }`.
These are facts about the model, so every element that plays it shares them. The length defaults to
the model's own clip length where the build can read it. `strike` (when the swing goes) and `land` (when
it lands, the strike by default) are only shown: the readout marks them, and nothing is timed from them.

**A unit's moment.** Name → `{ "variations": [...] }`: the candidates to compare. A unit with no
variations for a moment still lists it, and Play does nothing.

**A variation.** `{ "elements": [...], "note", "label", "pick" }`: one whole timeline. An element is
one of these, at `at` seconds from Play (0 by default):

| Element | What it does |
|---|---|
| `{ "anim": "attack" }` | Plays one of the unit's animations. `stop` clears it then, as a hit reaction needs |
| `{ "sound": "Marine_Yes" }` | Plays a CSound on the unit, or on the target with `"on": "target"` (the point in front of the unit when the spec has no target). `stop` fades it out then |
| `{ "effect": "MyPunch" }` | Runs a CEffect from the unit at the target, or at the point in front of it (from the unit's player once it's dead). Its damage is real: a target it kills comes back after 2 s |
| `{ "actor": "Create MyBurst" }` | Sends an actor message to the unit; `"on": "target"` to the target's actor, `"on": "MyBurst"` to an actor in the unit's scope, such as one a Create made |
| `{ "kill": true }` | Kills the unit. Its sounds after that play at the point it died (sounds played on a dead unit are dropped), and it comes back after `respawn` s |

Any element can be `"muted": true`: left out of Play, kept in the spec.

```json
{ "elements": [
    { "anim": "attack", "at": 0 },
    { "sound": "Marine_Stimpack", "at": 0, "stop": 0.6 },
    { "sound": "Marine_AttackLaunch", "at": 0.15 },
    { "actor": "Create MyStumpBurst", "at": 0.1 },
    { "actor": "Destroy", "on": "MyStumpBurst", "at": 2.1 }
  ],
  "note": "a stim grunt cut off at 0.6 s, then the burst", "pick": true }
```

A spec in the shape before moments became timelines (`cues`, a moment's `do`, `at` and `from`, an
animation's `clear`) is refused, each key with where it went.

## What it checks

Every id the spec uses is checked before anything is written, because a missing sound, model or unit
plays nothing in the game and says nothing:

- **Sounds and models** against the game's packages (core's `package-entries.json`), the Workspace's
  mods, the base map, and the spec's own data.
- **Units** against the game's units (core's tech catalog) and the same places.
- **Actors** named by `Create`, a child actor or a site op, and **effects** named by an `effect` element,
  against the spec's own data and the Workspace's mods. Core can't list the game's own actors or
  effects, so an id outside those is a warning: make sure it's right.
- **Animations.** An `AnimPlay` must match at least one of the model's clips, where the build knows
  them. For a new model it reads them from its `.m3` and `.m3a` files; for a stock unit, from the
  `model-anims.json` files of core and the Workspace. Otherwise each word of the message is checked
  against SC2's animation words. An invented word never plays: a clip named `Attack Mega` didn't,
  `Spell C` did.

The generated script is written beside the map as `<name>.testbed.galaxy`. The package's tests
type-check it with plaxtony where `NATIVES` (core.sc2mod's TriggerLibs, extracted) and `PLAXTONY` are
set: `tools/check-galaxy.cjs`.

## Screenshots

`--capture <folder>` builds the map with the spec's `tour` and films it through the Editor, one frame
per stop. It needs a Host Adapter that can capture: the macOS one, with the Editor able to come to the
front ([macos-host.md](../plugin-host-macos/docs/macos-host.md)). The site's pictures of the testbed
come from the example's tour.

## Files

| Path | What it is |
|---|---|
| `testbed.ts` | The command |
| `build.ts` | The checks and the map |
| `spec.ts` | The spec's schema |
| `runtime/testbed.galaxy` | The map's script. The build fills in its CONSTANTS and DATA marker lines |
| `skills/anim-testbed/` | The skill |
| `examples/stock-units.json` | A spec with stock units only |
| `tools/check-galaxy.cjs` | The plaxtony check (not shipped) |

## What it's built on

These are in [docs/reference](../../docs/reference/README.md):

- Test Document runs `MapScript.galaxy` as it is, so the build writes it as well as Triggers.
- Dialog events fire only when each type is registered on its own, with `c_invalidDialogControlId` as
  the control. Pulldown items count from 1, and the script's own `DialogControlSelectItem` fires
  SelectionChanged too.
- A new unit's actor takes messages only after about 0.5 s.
- Sounds played on a dead unit are dropped.
