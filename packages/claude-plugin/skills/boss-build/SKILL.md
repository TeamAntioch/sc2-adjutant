---
name: boss-build
description: Building a boss fight on the SC2 engine, the way Blizzard's campaigns do it. Covers the boss unit, its controller trigger, telegraphed attacks in data and triggers, phases, the arena gate, retry, a non-lethal finish, and support for an AI companion. Use when scripting or reviewing a boss's triggers and data, when turning a boss plan into Editor work, or when asked how to make a telegraphed attack, a phase change or a boss checkpoint in SC2.
---

Turn a boss plan (the `boss-design` skill's `missions/<id>/bosses.md`) into SC2 data and triggers, or review a built boss against how Blizzard builds them. Core has no boss entity, so the compiler doesn't build these yet; they're built the way the Workspace builds its other scripted encounters, in the Editor or by a Plugin's Mechanic. Tell the author which route each piece takes before building it.

The recipes below are what Blizzard's campaign data and map scripts do (StarCraft II 5.0.16: Wings of Liberty, Heart of the Swarm, Legacy of the Void, the Epilogue and Nova Covert Ops). Ids in backticks are real catalog entries or natives to copy from. Lines marked *untested* are proposals nobody has run in game; test them in an exp map before a Mission depends on them.

## Leading words

- **Controller**: the one trigger loop that runs a boss: pick an attack, order it, wait, repeat.
- **AI time**: waits on `c_timeAI`, which stop when the game pauses AI for a cinematic, so the boss freezes with the scene.
- **Script control**: the boss's owner and unit are kept away from the engine AI, so only the controller acts.
- **Marker**: the ground decal or model that shows where an attack will land, created when the attack is committed.
- **Delayed impact**: the effect that lands after the warning, from a persistent effect's delay.
- **Safe point**: an authored point or region the boss's pattern names as safe, for the companion to go to.
- **Floor**: a life value a phase change clamps to, so burst damage can't skip a phase.
- **Downed**: the state that replaces death for a story boss or a companion: invulnerable, stunned, untargetable.

## The boss unit

- An ordinary unit with `Heroic` and `Massive` attributes and a large life pool. Set life per difficulty in the map script with NativeLib's `libNtve_gf_DifficultyValueFixed(easy, normal, hard, brutal)`, not in data, so one unit type serves every difficulty.
- Owned by its own enemy player. Keep the engine AI off it: `AISetUnitScriptControlled(unit, true)`, and clear its type's tactical think for that player with `libNtve_gf_SetTacticalAIThink(player, "<UnitType>", "", true)`, which sets the type's `TacticalAIThink` field to an empty string. Maar (`tzeratul02`) and the *Maw of the Void* Mothership (`ttychus05`) are set up this way.
- Hidden permanent behaviours carry the special rules: death prevention (below), unkillable parts, shields.
- Flag it for the player with the unit's info text, a boss ping and boss music. A boss bar (`libNtve_gf_DisplayBossBar`) is for a single readable boss only; Blizzard put a bar on a boss once in the 39 map files of the 34 Legacy of the Void, Epilogue and Nova Covert Ops missions.

## The controller

- One loop per boss, waiting on AI time (every 0.0625-1 s in Blizzard's bosses). Each pass reads ranges, regions and visibility, picks an attack by rule (closest hero within 4: slam; else a target within 10: blast; a hero between 4 and 10 on Hard: chase beam, as the Xel'Naga Constructs do in `pulnar02`), and orders it with `UnitIssueOrder` or `libNtve_gf_AICast`.
- After ordering, wait for the ability-used event, then for the boss to go idle, then loop (*Supreme*, `zzerus03`; *Back in the Saddle*, `zlab02`). Cooldowns are timers whose lengths are difficulty values.
- Exit on game over, cinematic mode, a dead hero or a change of section. Pause it for phase transitions.
- For a stealth-aware boss, filter targets with `UnitIsVisibleToPlayer(target, bossPlayer)`, so cloak stays an answer (Stone, `nova07`).
- Guard against soft-locks: a timeout that relocates the boss if it can't reach a hero, and an anti-kite rule that sends it on after a few seconds without attacking.

## Telegraphed attacks

The data kit, with the stock entries that already do each piece:

| Piece | Build | Copy from |
|---|---|---|
| Circle that hits after a warning | `CEffectCreatePersistent` with `ExpireDelay`, its expire effect a `CEffectEnumArea` → `CEffectDamage`; a marker model actor created on `Effect.<persistent>.Start` | `RavagerCorrosiveBileCP` (`ExpireDelay` 2) and the `RavagerCorrosiveBilePrecursor` model. The `RavagerCorrosiveBileCursorSplat` is only the caster's targeting cursor |
| Cone | `CEffectEnumArea` with `<AreaArray Arc="90" Radius="…"/>`, plus a cone marker facing the caster's facing | The Hellbat's `HellionTankDamage` search |
| Line or rectangle | `CEffectEnumArea` with `<AreaArray RectangleWidth="…" RectangleHeight="…"/>`, or a persistent stepping small searches along a line | The void mod's `TimeStopStun` searches; Lurker's `LurkerMP` persistent and `LurkerMPSearch` |
| Pool that lingers | A periodic persistent effect, or an invulnerable dummy unit with a periodic search behaviour | `PsiStormPersistent` → `PsiStormSearch` |
| Cast bar | The ability's prep time with its progress shown | Heart of the Swarm boss abilities with `PrepTime` 2.5 and `ShowProgressArray` |
| Range circle | `CActorRange` | `SiegeTankSiegedRange`, `WidowMineAttackRange` |
| Tether beam | `CActorBeamSimple` created on a behaviour's start, host to target | `CycloneLockOnTrackingBeam` |
| Knockback or pull | `CEffectApplyForce` (positive pushes away, negative pulls in) | `RepulserFieldApplyForce`, `VortexForce`, `OverchargeForce`, Nova Covert Ops' `SkyTankKnockbackApplyForce`. The Reaper's KD8 knockback is a create-unit trick, not a force |
| Drag a unit to the caster | A launch-missile effect that moves the target | The Viper's `YoinkLaunchMissile` |
| Teleport | `CEffectTeleport` | `AdeptPhaseShiftTeleport` |

In script, add the second channel when the controller commits an attack: a ground indicator or model at the target point, a warning ping, a sound, and on the first cast a transmission. Telegraph lengths come from the plan; lethal attacks warn at least 2 s at Faster.

## Phases

- Poll life in the controller or a phase trigger (`UnitGetPropertyFixed(boss, c_unitPropLifePercent, …)` against the cut). No Blizzard campaign map uses the engine's life-percent event.
- At a cut, pause the controller, clamp life to the phase's floor, play the transition (burrow, fly off, shield up) with the boss invulnerable, swap the attack set and the arena (turn a hazard region on, close doors), spawn the phase's adds, and resume.
- An objective gate is a boss shield or invulnerability that ends when the objective's units die (shield projectors, `nova04`).
- Show invulnerability every time: a shield actor or an animation, and the boss bar's state if there is one.

## The arena

- The boss starts invulnerable and paused (`UnitSetState(boss, c_unitStateInvulnerable, true)`, `libNtve_gf_PauseUnit(boss, true)`). A player unit entering the arena region reveals it, plays the intro, autosaves, unpauses the boss and starts the controller.
- A short scripted bout the compiler can build is a Blueprint encounter: `startsWhen` starts it on a hero's arrival (`anchorEntersZone`) rather than the first player unit, `fromBeat` holds it until a Beat has started (a hero who walks in early starts the bout as that Beat starts, not before), and `behavior` adds a hidden `CBehaviorBuff` to the boss at the start whose `Duration` and `RemoveValidatorArray` (a life or shields fraction) end it, which an `encounterEnds` cue plays the next scene on. Keep the timing in that buff, so it's tuned in one place. The buff's `Duration` counts game time, which a scene doesn't pause, while `endsWhen.afterSeconds` counts AI time, which it does: a scene the encounter's start plays uses up the buff's time, so add the scene's length to the `Duration`.
- The autosave: Blizzard's campaigns call their campaign library's `CreateMissionAutosavePoint`. Check which save action the Mission's dependencies give it.
- Optional bosses leash: if every hero leaves the arena, the boss walks home and resets to full (the pirate capital ship, `zspace01`). The leash counts both heroes.
- A pocket arena for a solo hero (*Night Terrors*, `nova05`): pause AI time outside, clamp the playable area to the room, and reset the boss if the hero dies there.
- *Untested:* a hidden checkpoint instead of defeat. On a hero's death inside the arena, fade out, reset the boss's life, phase and adds, clear hazards, revive both heroes at the arena entrance and fade in, showing how far the attempt got.

## A non-lethal finish

Stone (`nova07`) shows the recipe, in Nova Covert Ops' data:
- A permanent `CBehaviorBuff` (`NovaStoneDeathPrevent`) whose damage response catches the fatal hit (`Fatal` 1, `ModifyFraction` 0) and runs a set effect.
- The set removes the death prevention and applies a downed buff (`NovaStoneIncapacitated`: `Invulnerable`, `Stun`, `Uncommandable`, `Untargetable`, abilities disabled).
- A second hidden buff (`NovaStoneStunMoniter`) runs the same set at a life threshold. Its `DisableValidatorArray` holds a `CValidatorUnitCompareVital` (`LifeLE15Percent`: life fraction `LE` 0.15), so it's active only below 15 %.
- A trigger polls for the downed buff and starts the scene. Kill the boss's adds in the same trigger.

## Supporting the companion

- **Hints**: name a safe point or region for each attack pattern, and publish the danger regions while markers are up. When the controller commits a pattern, order the companion to its safe point, pause the companion's attacks until the impact, then hand it back to its own logic. *The Escape* (`nova01`) does exactly this for Stone.
- **Area damage cut**: a hidden behaviour on the companion that reduces damage from area effects. *Untested* as data: a damage response with a fraction modifier, filtered to area effects by validator.
- **Danger flags**: boss search effects can carry `AINotifyFlags` (`RavagerCorrosiveBileSearch` sets `HurtEnemy` and `MajorDanger`), which warn engine-AI units about the area. *Untested:* whether a Computer-owned companion leaves such an area without an order.
- **Downed, not dead**: the same death-prevention recipe as the boss, with a revive (on a timer, or faster while the player's hero stands beside it). Warcraft III's simpler version resets the ally's life when it's hit below a threshold (`Tyrande_Cant_Die`).
- **One damage type per hero**: a hidden buff with a damage response of `ModifyFraction` 0, gated by a validator on the attacker's player, makes a unit immune to one hero (StarCraft II co-op's `MutatorImmunetoPlayer1` and `MutatorImmunetoPlayer2`).
- **Set pieces**: take the companion under script control for intros, transitions and invulnerable windows, so it doesn't attack what can't be hurt or walk into the arena first.

## Review a built boss

1. **Find the controller and its data.** List the boss's triggers, its unit, abilities, effects and behaviours. Done when every attack in the plan maps to an ability and an order in the controller.
2. **Check each attack's two channels**: its delay or prep time in data and its marker in script. Measure the warning against the plan.
3. **Check the guards**: AI time, script control, the exit conditions, the soft-lock timeout, the leash counting both heroes.
4. **Check phases**: floors, visible invulnerability, adds, and that the controller pauses across the transition.
5. **Check retry and finish**: the autosave point, what a defeat resets, the death prevention and the adds' cleanup.
6. **Check the companion**: hints for every lethal pattern, its survival rule, script control during set pieces.
7. **Report** each finding with the trigger or catalog entry, what's wrong, and the recipe above that fixes it. Hand design questions back to the `boss-design` skill's checks. Done when every attack, phase and guard is accounted for.
