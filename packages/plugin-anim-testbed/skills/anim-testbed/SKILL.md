---
name: anim-testbed
description: Builds an animation and sound test map from a spec, with a dialog in the game to pick a unit, clip, slot and variation and play it. Use when the author wants to audition or compare a unit's animations or sounds (attack, hit, death, impact, voice) in the game, to check a new model's clips, or to time sounds against a clip, instead of a one-off test map with chat commands.
---

The anim-testbed Utility turns one **spec** into a test map. The spec lists the units, their clips, the slots and the variations to compare. The map has a trigger dialog: Unit, Clip, Slot and Variation dropdowns, Play, Stop, Kill, Loop, a Send box, and a readout of each cue as it fires. Build it with `node {{PLUGIN_FOLDER}}/dist/testbed.js <spec.json>`; `--check` validates without writing. The spec format and what the build checks: [README.md]({{PLUGIN_FOLDER}}/README.md). A spec to start from: [examples/stock-units.json]({{PLUGIN_FOLDER}}/examples/stock-units.json).

## Leading words

- **Slot**: what a Play does, by its kind. `clip` plays the selected clip with cues at the unit; `impact` plays it with cues at the target, timed from its `land`; `hit` plays the unit's hit reaction; `death` kills the unit and plays the cues where it died; `cues` plays the cues alone.
- **Variation**: one candidate in a slot. It is a list of cues, with a `note` saying what it is, and `pick` on the one recommended.
- **Cue**: `<what>[@<when>][~<stop>]`. `<what>` is a CSound id, `actor <message>`, `actor:<child> <message>` or `target <message>`. `<when>` and `<stop>` are seconds, `strike`, `land` or `strike+0.2`.
- **Strike** and **land**: when a clip's swing goes and when it lands on the target, in seconds from its start.

## Steps

1. **Settle the test.** Find out which units, which clips, which slots, and the candidates in each. Put a unit's real model on it: a stock CUnit by `unit`, or a model of the Workspace's own by `new` (its `.m3`, `.m3a` files and texture folders). Read a clip's strike and land off the clip at 30 frames a second, or start from a guess the author tunes in the game with `-t`. Done when every candidate has CSound ids and times, and a note saying what it is.
2. **Write the spec.** Put it beside the Mission, for example `missions/<id>/tests/<name>.json`, with `base` the Mission's Map Package and `out` under the Mission's git-ignored `output/`. Use `roots` for private folders (extracted game files, a model's exports), so no machine path is written into it. Blizzard's files never go in a repo: the build copies them into the test map only. Done when `--check` reports no errors.
3. **Read the check.** An error is a real fault: an unknown CSound, unit or model plays nothing in the game and says nothing. An `AnimPlay` that matches none of a model's clips never plays, and the error lists the clips it has. Name clips with SC2's own words (`Spell C`, not `Attack Mega`). A warning about a stock actor is only that the build can't list the game's actors: make sure the id is right.
4. **Build and hand it over.** Build, then tell the author the map's path and what to try. Open it in the Editor and run Test Document. After a rebuild that changes a model, quit the Editor first: it keeps a model loaded by name.
5. **Record what the author picks.** Move `pick` to each chosen variation in the spec. Use `-t` in chat to tune a clip's strike and land, then copy the printed numbers back into the spec. A death mix the author settles on can become data with the `sound-mix` skill, from its sound cues.
