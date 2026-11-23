# Puzzle props

A catalogue of interactive props for hero-mission encounters, the rules that make them combine, and what to avoid. It distils puzzle-prop research on Blizzard's hero missions (Back in the Saddle, Ghost of a Chance, Conviction, Templar's Return, Nova Covert Ops) and the tactics games (Shadow Tactics, Desperados III, Divinity: Original Sin 2, Into the Breach, Invisible, Inc., Hitman). The SC2 bases named below are stock game data ids; check each one loads in the Campaign Mod's dependencies before using it, and read the Campaign Pack's knowledge for props the campaign already has. Tags: [dev] a developer on their own work, [data] game files, [wiki] fan wiki, [mine] our inference.

## Rules every prop follows

### Readability

- **R1 One key reveals every usable prop** (Desperados III's highlight mode) [wiki]. In SC2, a hero ability or shared hotkey that lights up props through a behaviour response.
- **R2 Draw every range that matters, without decoration.** Mimimi dropped decorated cones because they "made it harder to read" [dev, [Perceptive 17:46](https://www.youtube.com/watch?v=I2aek5pDl-8&t=1066s)].
- **R3 Telegraph who a hazard hits and what it does.** Into the Breach built "weapons that could be described by the UI" [dev, [ITB GDC 25:21](https://www.youtube.com/watch?v=s_I07Iq_2XM&t=1521s)]. Cut what can't be shown clearly.
- **R5 A prop works the same everywhere.** A taught interaction is a "promise"; breaking it makes players "stop experimenting" [dev, Wagner].
- **R6 Art never changes a prop's pathing or sight footprint** [dev, [Desperados III devcom 23:17](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=1397s)].
- **R7 The setup fits one screen with no camera turning** [dev, [Desperados III devcom 31:47](https://www.youtube.com/watch?v=mLGBbFPjicQ&t=1907s)].
- **R8 No hidden dice.** No chance-based props, alarms or wave picks inside an attempt [dev, Invisible, Inc.].
- **R9 Let the AI demonstrate a prop first,** away from pressure [dev, DOS2].

### Combination

- **C1 The prop is the kill; a distraction delivers the victim.** In Shadow Tactics a thrown stone triggers the ox and a lure brings guards under the boulder [wiki].
- **C2 Few interaction channels.** "You have noise, you have vision, and that's basically it" [dev, [Jaffe 35:24](https://www.youtube.com/watch?v=cQiVL-5ES8g&t=2124s)].
- **C3 Triggers are tool-agnostic, and enemies follow the same rules.** Any damage sets off a barrel, enemy fire included, but the AI never targets props on purpose (DOS2 had to pull that from its AI) [dev].
- **C4 Design around groups of skills, not one named skill** [dev, Wagner]. A prop that only one ability can use is a "driver", which Mimimi bans.
- **C8 Ration prop families like features.** One featured family per mission; doors, hold-points and breakable shortcuts can recur as infrastructure [dev, [Shadow Tactics GDC 31:22](https://www.youtube.com/watch?v=4h2ZvfYjHp0&t=1882s)].

### Against single-solution puzzles

- **S1 Props are optional.** "The core mechanics are way too open to create situations or puzzles where only one solution would work" [dev, Desperados III].
- **S2 Unseen accidents don't raise the alarm** [wiki/dev].
- **S3 Every key costs something:** single use, noise, a body, or exposure.
- **S6 Design each prop's failure, and never method-lock an opportunity** [dev, [Hitman 40:18](https://www.youtube.com/watch?v=hc8_W2PERZE&t=2418s), [43:32](https://www.youtube.com/watch?v=hc8_W2PERZE&t=2612s)]. If a prop is used early or destroyed by a stray shot, the encounter stays solvable and any objective text pointing at it updates.
- **S7 The map never leaves zero options** [dev, Into the Breach].

## Library conventions [mine]

1. **One prop record:** `family`, `states` (the morph pair), `triggerSources` (any damage, hero interact, a specific hero), `noise` (none, local investigate, zone alarm), `accident` (an unseen kill skips the alarm), `telegraph` (tooltip, decal, reveal-key response), `secondKey` (the costlier fallback), `singleHeroFallback`. A prop can stand in an encounter record as the key enemy's analogue.
2. **One visual class, one reveal key.** Every usable prop carries the reveal response and an info-text tooltip (`UnitSetInfoText`).
3. **Show the footprint.** Every prop that hurts or blocks draws its exact area (blast radius, fall line, cone) on hover or under the reveal key, from the same numbers as its search effect.
4. **Noise is the single glue.** Props that are destroyed, tripped or shot loudly call one `ReactToPoint(point, radius)`; guards investigate for a fixed time (about 6 s), then go home; unseen accidents skip it. That one call lets hero distractions, barrels, wires and noise makers combine.
5. **The standard telegraph stack** (Blizzard's own) [data]: a region tripwire, a revealer on the far-side prop, a minimap ping and alert, a reticle (easier difficulties only, as HotS does), one voiced line naming the prop and its effect, a state-change ping, the reticle removed on use.
6. **Two-hero helpers:** a both-heroes-in-region check, a short AI leash at doors for the hero the player isn't controlling, and a single-hero mode that turns every "both" check into "the controlled hero".

## Building blocks [data]

- **Two-state props are morph pairs.** Each state has its own footprint, so pathing (and sight, where the footprint has `BlockVision`) changes with the morph. Script orders the morph ability.
- **Units versus doodads.** A unit prop can be ordered, killed, given behaviours and hooked with `TriggerAddEventUnitClick/Range/Region`. A doodad takes only region-wide actor messages.
- **Runtime pathing** changes with `PathingModify`. No native for runtime sight blocking was found.
- **No Blizzard library has a door, bridge, switch, alarm or hack helper.** The reusable helpers are signposting: reticle plus text tag, objective pings, `UnitSetInfoText`. The NCO stealth library (LibNCMI) hard-codes Nova; rewriting a slim stealth loop is usually better than loading it.

## Candidate props

Ranked for a two-hero campaign by combo value, stealth-or-loud fork value, reuse, readability and cost (S: about a day; M: 2–4 days; L: a week or more, a system with an AI loop). Every card follows the conventions above.

| # | Prop | Decision it gives | SC2 base [data] | Cost |
|---|---|---|---|---|
| 1 | **Door with a remote control** (fuse box, console) | Reach the control by stealth, shoot it from range, or force the door (slow and loud). Inverted, a control that *closes* doors traps a patrol or cuts reinforcements | `GateControlUnit`, `AvernusGateControl`; door families MetalGate, SecurityGate and others with `…Lowered` states | S |
| 2 | **Hold-point beacon** | Who channels and who holds, and where the holder stands. Single-hero fallback: moving off pauses the channel and keeps progress | a beacon unit, a channel, waves from the spawn slots | S |
| 3 | **Split gate / dual plate** | Send the stealthier hero through alone while the other holds, or take the long way together | a gate plus a far-side control or two regions polled together | S |
| 4 | **Explosive barrel or crystal** | Spend it now or save it, and who pulls enemies onto it. An unseen barrel kill is an accident | `ExplodingBarrelLarge` (death response, splash) plus a radius decal | S |
| 5 | **Sentry with a detection cone** (guard, rotating turret, searchlight) | Time the sweep, remove or blind the sentry, or distract it | `GhostDetectorCone`, `RotatingTurretPassive*` with `DetectionCone9Guide`, `OracleSearchlightUnit` | L |
| 6 | **Alarm panel, runner, trip wire** | Stop the runner, disable the panel in advance, or let the alarm go and fight. Alarms reset after a fixed time, so failure is recoverable | `NovaAlarmBot`, `NovaTripWire`, `AlarmLight` doodads, pop-up turrets | M |
| 7 | **Power source running local defences** | Cut the power (turrets, cones, locks go dead) loudly or quietly, or deal with each defence | `CBehaviorPowerSource`/`PowerUser` (unpowered disables abilities and detection), `PowerCore` | M |
| 8 | **Rockfall tower** | Crush a group, seal a spawner, or block pursuers on the way out | `CollapsibleRockTower*` (`RockCrushSearch`) plus a fall-line decal | S–M |
| 9 | **Cage with a release console** | Release a third party into the guards, or leave them. Released units are hostile to the heroes too | `UmojanLabZergCageUnit`, `HybridHoldingCellSmallUnit` | M |
| 10 | **Capturable overwatch console** | Spend a hero holding a console (vision plus a turret) or keep both mobile. Doubles as the observation spot | `CAbilInteract TowerCapture` on a console, `UnitSetOwner` on a linked turret | S–M |
| 11 | **Breakable shortcut** (vent, debris, weak wall) | Spend time and noise on a shortcut, or take the long way | `CompoundSewers_Vent_Destructible`, `DestructibleRock*` | S |
| 12 | **Extending bridge** | Extend it with a control (which may alert the far side), or take the other spoke. The enemy retracts it on alarm | `ExtendingBridge*`, light-bridge pairs with `…Out` states | S–M |

**Build order** [mine]: 1–4 and 11 first (no AI loop); then 5 and 6 together (they share the stealth loop and the alarm); then the rest. A noise maker (a machine a hero shoots to pull guards) is a stretch once `ReactToPoint` exists.

**Gotchas** [data]: a destructible control can be shot by the AI too; check each door footprint for `BlockVision` before relying on it to hide a hero; detection cones ignore walls (keep walls out of cone setups or add a line-of-sight check); turrets are `Structure`, which many hero disables exclude; no lava-damage unit exists, so a hazard must be a unit with a decal matching its search area; cliff level can't change at runtime, so elevators are footprint swaps; a neutral barrel hurts every player, heroes included.

## Avoid

- **Single-key props.** Ghost of a Chance fails the mission when its gate control becomes unreachable. Every prop has a costlier second way through; playtest each setup with the prop disabled.
- **Look-alikes.** Decorative searchlights, barrels or lava near working ones break the promise (R5). Keep look-alike doodads away from encounter spaces, or retexture the working ones.
- **Gap crossings the kit can't make.** Don't build a crossing puzzle until the hero ability that crosses exists, and give that ability a cost.
- **Driver and puppet props.** Props only one ability can use, mind-control tricks, NPC keys.
- **Carried keys and inventory.** Micro and backtracking with no decision.
- **Invisible hazard regions** and **timed lockdowns** that fail the mission.
- **Hint reticles on every difficulty.** Reticles on the easier difficulties only; the reveal key is the hint on all of them.
- **Enemies using props on purpose,** and **trap-heavy rooms**: one prop family per mission, never every room.
