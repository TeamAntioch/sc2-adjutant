---
name: anim-testbed
description: Builds an animation and sound test map from a spec, with a dialog in the game to pick a unit, a moment and a variation and play it. Use whenever the author works on a custom unit, custom sounds or a custom animation, to see and hear it in the game, and when they want to audition or compare a unit's animations or sounds (attack, hit, death, impact, voice), check a new model's animations, or time sounds against an animation.
---

The anim-testbed Utility turns one **spec** into a test map. The spec lists the units with their animations, the moments to judge and the variations to compare. The map has a trigger dialog: Unit, Moment and Variation dropdowns, Play, Stop, Loop, a readout of the variation's timeline as it plays, and a Send box. Build it with `node {{PLUGIN_FOLDER}}/dist/testbed.js <spec.json>`; `--check` validates without writing. The spec format and what the build checks: [README.md]({{PLUGIN_FOLDER}}/README.md). A spec to start from: [examples/stock-units.json]({{PLUGIN_FOLDER}}/examples/stock-units.json).

## Leading words

- **Moment**: something that happens to a unit that you want to judge (an attack, its impact, a hit, a death, a voice line). It is only a name; the spec's optional `moments` list orders the dropdown.
- **Variation**: one candidate for a unit's moment, as a whole timeline: a list of `elements`, with a `note` saying what it is and `pick` on the one recommended.
- **Element**: one thing on the timeline, at `at` seconds from Play: `{ "anim": "<the unit's animation>" }`, `{ "sound": "<CSound>" }`, `{ "effect": "<CEffect>" }` (from the unit at the target; its damage is real), `{ "actor": "<message>" }` or `{ "kill": true }`. `"on": "target"` puts a sound or actor message on the target, `"on": "<child actor>"` sends a message to an actor in the unit's scope. `stop` fades a sound or clears an animation. `"muted": true` leaves it out of Play.
- **Animation**: one of a unit's animations, by name: its `play` message, `length`, and its `strike` and `land` (when the swing goes and when it lands, in seconds from its start), which the readout marks so sounds can be lined up by eye. Nothing is timed from them: every element's time is absolute.

## Steps

1. **Settle the test.** Find out which units, which animations, which moments, and the candidates in each. Put a unit's real model on it: a stock CUnit by `unit`, or a model of the Workspace's own by `new` (its `.m3`, `.m3a` files and texture folders). Read an animation's strike and land off it at 30 frames a second. Place each element at an absolute time: an impact sound at the attack's land, a body fall when the corpse hits the ground. Done when every candidate has its elements and times, and a note saying what it is.
2. **Write the spec.** Put it beside the Mission, for example `missions/<id>/tests/<name>.json`, with `base` the Mission's Map Package and `out` under the Mission's git-ignored `output/`. Use `roots` for private folders (extracted game files, a model's exports), so no machine path is written into it. Blizzard's files never go in a repo: the build copies them into the test map only. Done when `--check` reports no errors.
3. **Read the check.** An error is a real fault: an unknown CSound, unit or model plays nothing in the game and says nothing. An `AnimPlay` that matches none of a model's clips never plays, and the error lists the clips it has. Name clips with SC2's own words (`Spell C`, not `Attack Mega`). A warning about a stock actor is only that the build can't list the game's actors: make sure the id is right.
4. **Build and hand it over.** Build, then tell the author the map's path and what to try. Open it in the Editor and run Test Document. After a rebuild that changes a model, quit the Editor first: it keeps a model loaded by name.
5. **Record what the author picks.** Move `pick` to each chosen variation in the spec, and change the elements' times the author asks for, then rebuild. A death mix the author settles on can become data with the `sound-mix` skill, from its sound elements.
