---
name: sound-mix
description: Turns a layered sound (several CSounds at timed offsets, some stopping or fading early) into actor data that one `Create` plays, from a unit's death, attack or hit. Use when a unit's sound is a mix of stock or custom CSounds, when moving a trigger-script sound audition into data, or when a death sound must keep playing after the unit dies.
---

A **sound mix** is several CSounds played as one sound, each from its own time. A CSound can't do it (each play picks one of its variations), but a `CActorSound`'s `Layers` can: each layer is its own CSound after its own `PlayDelay`. The sc2-adjutant MCP server's `sound_mix` tool writes the actors from a list of layers and checks every CSound first. Outside a Workspace, run `npm run sound-mix -- <mix.json> [--xml] [--sounds <file or folder>]` from an sc2-adjutant checkout. How the actors work and what's been checked in the game: [sound-mixes.md](https://github.com/TeamAntioch/sc2-adjutant/blob/main/docs/reference/sound-mixes.md).

## Leading words

- **Layer**: one CSound in the mix, with its start (`at`) and, if it ends early, its `stop` and `fade`, in seconds from the mix's start.
- **Wiring**: the `On` line on the unit's actor that creates the mix on its event.
- **Silent main**: the silent CSound a mix plays as its actor's own sound when no layer starts at 0.

## Steps

1. **Collect the layers.** Each one's CSound id and start time, from the author's audition or plan. Times come from the clip: the frame the strike, the fall or the limb's landing happens on, at 30 frames a second. A layer the plan cuts off at a moment (a charge-up ending on the strike) gets a `stop` at that moment. It gets a `fade` (0.2 to 0.3 s is a soft end) unless the plan has it cut dead. Done when every layer has an id and a time, and every early end has a stop.
2. **Make the data.** Call `sound_mix` with the mixes, `xml: true` for a map's own `ActorData.xml`, or without it for Generic Entries in a Mod Blueprint's entries. A test map's own CSounds count only if its package is in `sounds`. A refused id is a real problem: an unknown CSound plays nothing in the game, with no error. Fix it from the near match the tool names, or find where the CSound should be defined. Done when the tool returns entries with no refusals.
3. **Check where each CSound comes from.** The reply names the package each stock CSound is in. Each must be one the map or mod loads through its dependencies. The silent main (`Nova_SniperRifleTail_Dummy`) is in `Void.SC2Mod`; a mod that doesn't load it names its own silent CSound in `silent`.
4. **Add the entries and the wiring.** Put the entries where the mod or map keeps its actors, and add the wiring line to the actor of the unit the mix is for, on its event: `UnitDeath` for a death, `WeaponStart.*.AttackStart` or an ability's event for an attack. Create the mix from the unit's actor, not from a trigger playing a sound on the unit: a sound on a dead unit is dropped, while a mix takes its place once and plays on where the unit died.
5. **Hear it in the game.** A mix is right only when heard with its animation. Hand it to the author through Test Document, beside the audition it came from if there is one. Ask whether every layer plays, on its time, through the death, and how each stop sounds. Record what was heard. The reference doc lists what has and hasn't been checked in the game.
