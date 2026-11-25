# anim-testbed, an sc2-adjutant Utility

Audition a unit's animations and sounds in the game with a GUI. One **spec** per test lists the units
(stock ones, or models of your own) with their animations, the **moments** to judge (an attack, its
impact, a hit, a death, a voice line) and, per unit and moment, the **variations** to compare. The
build turns the spec into a test map:
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
   variation is tagged with what it holds (`[sound]`, `[visual]`, `[anim]`). `*` marks the spec's pick,
   and "(none: the action alone)" plays the moment with no cues.
2. For a moment that plays an animation, the **Animation** dropdown shows the one it plays: the
   variation's, or the unit's for the moment. Pick another to try it.
3. Press **Play**. **Stop** cuts the timeline and the sounds. **Loop** replays the selection.
4. Watch the readout: one sentence on what plays ("marine attack: animation attack (1.15 s). Sounds
   at the unit."), then a timeline in seconds from Play. The animation's strike and land are marker
   rows, and each cue is greyed until it fires.
5. Retime the animation with **Strike** and **Land**, under the Animation dropdown: each press moves
   the time by 0.05 s, and Play plays it. A time that differs from the spec's turns gold. Where the spec
   leaves `land` out, it follows the strike ("= strike") until the land is stepped itself. The times are
   clamped: 0 ≤ strike ≤ land ≤ length, and a strike stepped past the land pushes it.

**Send** plays the edit box's text as a CSound id at the unit. Text with a space goes to the unit's
actor, and text starting with `target ` goes to the target's actor.

In chat, `-t <strike> [land]` sets the selected animation's times, `-len <s>` its length (it has no
stepper), and `-help` lists the commands. They are clamped like the steppers, and say when they were.

### Retimes back into the spec

Every retime is saved straight away to a bank named after the spec (`stock-units` saves
`AnimTuneStockUnits.SC2Bank`), with what the build gave each time. After quitting the game:

```sh
node node_modules/@team-antioch/sc2-adjutant-anim-testbed/dist/testbed.js <spec.json> --apply [--bank <file>]
```

- It finds the bank under the game's Banks folder, which the Host Adapter names (`game.banksDir`). With
  more than one, or a Host that can't name the folder, give it with `--bank`.
- It writes each changed `strike`, `land` and `length` into the spec in place, keeping its comments and
  layout, and prints each (`marine / attack: strike 0.10 → 0.15`). A `land` left out stays out while it
  follows the strike.
- A time the spec has changed since the build is skipped and said, as is an animation the spec no
  longer has. These stay in the bank; what was written leaves it, and the bank goes once empty.
- A new game starts from the spec's times and leaves the bank alone, so retimes from several games add up
  until `--apply`.

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
| `moments` | Name → `{ "do", "at", "from" }`, in dropdown order. Below |
| `sounds` | CSound id → `{ "parent", "from": folder, "files": [globs], "fields": {…} }`: the map's own sounds, from files the build copies in |
| `data` | XML files of `<Catalog>` elements (CModel, CActor…, CEffect…), each routed to its catalog in the map |
| `assets` | `[{ "from", "to": "Assets/…" }]`: other files the data names |
| `units` | Below |
| `tour` | The stops a `--capture` build films: `{ "unit", "moment", "variation", "anim", "hold" }` |

**A moment.** Something that happens to a unit that you want to judge. It says what Play does to the
selected unit, where its sounds play and when cue times start:

- `do`: `play` plays an animation (the variation's, else the unit's for the moment). `kill` kills the
  unit, plays the sound cues at the point it died and sends actor cues to its corpse; it respawns after
  `respawn` s (sounds played on a dead unit are dropped, so they play at a point instead). Left out,
  Play runs the cues alone.
- `at`: `unit` (the default) or `target`, where the sound cues play. With no target in the spec,
  `target` is the point in front of the unit. Actor cues always go where they say (`actor`, `target`).
- `from`: `start` (the default: the animation's start, the death or Play), or the animation's `strike`
  or `land`. A cue's plain seconds count from it. `strike` and `land` need `do: play`.

| Moment | As do, at, from |
|---|---|
| An attack | `{ "do": "play" }` |
| Its impact | `{ "do": "play", "at": "target", "from": "land" }` |
| A hit | `{ "do": "play" }`, with the unit's hit animation and its `clear` |
| A death | `{ "do": "kill" }` |
| Voice lines | `{}` |

Some spellings are kept for what isn't built yet ([#96](https://github.com/TeamAntioch/sc2-adjutant/issues/96)),
and the build refuses them: `do: "order <ability>"`, a unit's key as `at` or as a cue's target, and
`on <event>` as a cue's time or a moment's `from`.

**A unit.** It has a `key` (its name in the dropdown) and either `unit` (a CUnit id) or `new`.
`new` is `{ "id", "model", "anims": [.m3a], "textures": [folders], "scale", "alias" }`: the build copies
the files in and adds a CModel, CUnit and CActorUnit for it. Then come `reach` (where the target stands),
`idle`, `respawn` (4), `animations` and `moments`.

**An animation.** Name → `{ "play": "AnimPlay Attack Spell,C NonLooping", "strike", "land", "length",
"clear" }`. These are facts about the model, so every moment shares them. The length defaults to the
model's own clip length where the build can read it. `clear` stops it after that many seconds, as a hit
reaction needs; 0 (the default) lets it finish.

**A unit's moment.** Name → `{ "anim", "variations" }`: the animation it plays (the unit's first by
default) and the candidates to compare. A unit with no variations for a moment still lists it, and
plays its action alone.

**A variation.** `{ "cues": [...], "note", "label", "pick", "anim" }`. `anim` plays another of the
unit's animations instead of the moment's, so animations can be compared like sounds. A cue is
`<what>[@<when>][~<stop>]`:

- `<what>` is a CSound id, `actor <message>` (to the unit), `actor:<child> <message>` (to an actor in
  its scope, such as one a cue created), `target <message>`, or `effect <id>`: a CEffect from the unit
  at the target, or at the point in front of it with no target (from the unit's player once it's dead).
  An effect's damage is real: a target it kills comes back after 2 s.
- `<when>` and `<stop>` are seconds (from the moment's `from`), `strike`, `land`, or `strike+0.2`.
  With no `@` the cue is at the moment's zero.
  `~<stop>` fades a sound out then.

```json
{ "cues": ["Marine_Stimpack~0.6", "Marine_AttackLaunch@strike+0.05",
           "actor Create MyStumpBurst@0.1", "actor:MyStumpBurst Destroy@2.1"],
  "note": "a stim grunt cut off at 0.6 s, then the burst", "pick": true }
```

## What it checks

Every id the spec uses is checked before anything is written, because a missing sound, model or unit
plays nothing in the game and says nothing:

- **Sounds and models** against the game's packages (core's `package-entries.json`), the Workspace's
  mods, the base map, and the spec's own data.
- **Units** against the game's units (core's tech catalog) and the same places.
- **Actors** named by `Create`, a child actor or a site op, and **effects** named by an `effect` cue,
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
| `tune.ts` | The tuning bank, and `--apply`'s edit of the spec |
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
