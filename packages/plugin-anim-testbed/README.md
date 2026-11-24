# anim-testbed, an sc2-adjutant Utility

Audition a unit's animations and sounds in the game with a GUI. One **spec** per test lists the units
(stock ones, or models of your own), their clips, the slots (attack, hit, death, impact, or any you
define) and, per unit and slot, the variations to compare. The build turns the spec into a test map:
the base map's terrain, the units in a row, a target facing the selected one, and a dialog to pick and
play.

It is a Utility ([ADR-0023](../../docs/adr/0023-utility-plugin-role.md)): a tool a Workspace chooses to
add. It writes nothing from Blizzard anywhere but the test map, which must be inside a git-ignored
`output/` folder.

## Using it

Install the package beside sc2-adjutant in the Workspace, and list it in the Workspace config's `utilities`:

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

1. Pick a **Unit**, a **Clip**, a **Slot** and a **Variation**. The Clip is used by the clip and impact
   slots, and `*` marks the spec's pick.
2. Press **Play**. **Stop** cuts the timeline and the sounds. **Kill** kills the unit and respawns it.
   **Loop** replays the selection.
3. Watch the readout: it lists the cues with their times, greyed until they fire.

**Send** plays the edit box's text as a CSound id at the unit. Text with a space goes to the unit's
actor, and text starting with `target ` goes to the target's actor.

In chat, `-t <strike> [land]` retimes the selected clip and prints the numbers to copy back into the
spec, `-len <s>` sets its length, and `-help` lists the commands.

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
| `slots` | Name → `{ "kind": … }`, in dropdown order. Kinds below |
| `sounds` | CSound id → `{ "parent", "from": folder, "files": [globs], "fields": {…} }`: the map's own sounds, from files the build copies in |
| `data` | XML files of `<Catalog>` elements (CModel, CActor…, CEffect…), each routed to its catalog in the map |
| `assets` | `[{ "from", "to": "Assets/…" }]`: other files the data names |
| `units` | Below |
| `tour` | The stops a `--capture` build films: `{ "unit", "slot", "clip", "variation", "hold" }` |

**Slot kinds.**
- `clip`: the selected clip plays and the cues run at the unit, timed from the clip's start.
- `impact`: the clip plays and the cues run at the target, timed from the clip's `land`.
- `hit`: the unit's `hit` reaction plays, cleared after `hitClear` s, with the cues.
- `death`: the unit is killed, the cues play at the point it died and actor cues go to its corpse. It
  respawns after `respawn` s. Sounds played on a dead unit are dropped, so they play at a point instead.
- `cues`: the cues alone.

A slot with no variations for a unit plays its action alone, so a `clip` slot with none is the way to
watch a clip.

**A unit.** It has a `key` (its name in the dropdown) and either `unit` (a CUnit id) or `new`.
`new` is `{ "id", "model", "anims": [.m3a], "textures": [folders], "scale", "alias" }`: the build copies
the files in and adds a CModel, CUnit and CActorUnit for it. Then come `reach` (where the target stands),
`idle`, `hit`, `hitClear`, `respawn` (4), `clips` and `variations`.

**A clip.** `{ "name", "play": "AnimPlay Attack Spell,C NonLooping", "strike", "land", "length" }`. The
length defaults to the model's own clip length where the build can read it.

**A variation.** `{ "cues": [...], "note", "label", "pick" }`. A cue is `<what>[@<when>][~<stop>]`:

- `<what>` is a CSound id, `actor <message>` (to the unit), `actor:<child> <message>` (to an actor in
  its scope, such as one a cue created) or `target <message>`.
- `<when>` and `<stop>` are seconds, `strike`, `land`, or `strike+0.2`. With no `@` the cue is at 0.
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
- **Actors** named by `Create`, a child actor or a site op, against the spec's own data and the
  Workspace's mods. Core can't list the game's own actors, so an id outside those is a warning: make
  sure it's right.
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
