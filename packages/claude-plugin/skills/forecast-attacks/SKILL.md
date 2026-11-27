---
name: forecast-attacks
description: Forecast attacks for SC2 units, built in Mod data. A forecast attack shows a marker (arc, lane, circle) for a windup the target can walk out of, then strikes only what is still inside. Use when giving any unit a telegraphed, dodgeable attack, when replacing or keeping a unit's auto-hit weapon, when ranged enemies should hold at range or melee enemies should take turns, or when a forecast attack doesn't fire, hit, face or show its marker.
---

Give a unit a **forecast** attack in a Mod's entries: the unit commits, a **marker** shows where the strike will land, the unit **winds up**, then the strike hits whatever is still inside the shape. The target dodges by walking out. Everything here is catalog data (`compile_mod` entries); no triggers.

The recipes are proven in game on Zergling, Hydralisk and Roach copies. Entry shapes are in [RECIPES.md](RECIPES.md); read it before writing entries.

## Leading words

- **Forecast**: one telegraphed attack: commit, windup, release, strike.
- **Commit**: the moment the unit picks a target and the marker appears. Everything after it is locked to the spot the target stood on.
- **Windup**: the time between commit and strike, 1.75 s by default. The unit is held still and facing, so the marker stays honest.
- **Slot**: a hidden buff on the target saying a forecast of one kind (melee or ranged) is already coming at it. A unit commits only while the target's slot of its kind is free, so attacks take turns instead of stacking.
- **Quiet**: the slot buff outlasts the windup by about 1.5 s, so the target gets a breath after each strike.
- **Recovery**: a random pause on the attacker after each strike, so a group doesn't fire in lockstep.
- **Driver**: a permanent periodic buff that only moves the unit (follow, circle, hold, approach). It never attacks; the autocast ability does.
- **Ranged rule**: a ranged unit walks to one cell inside its attack range and holds there while an enemy is in range.
- **Stagger**: the attacker is stunned when its strike finds the target mid-dodge, if the Workspace has a dodge behaviour. Dodging through an attack is rewarded.
- **Kind**: whether a forecast is **aimed** or **area**, which decides who sees its marker and who it can hit when AI-driven units (an ally squad, a partner hero) fight beside the player's hero. See section 3a.
- **Controlled hero**: the unit the player is driving at the moment, marked by a behaviour the Workspace names (the hero switch moves it).

## 1. Decide with the author

Ask each, one at a time, with the default:

| Question | Default |
|---|---|
| New unit types, or edit the stock ones? | New types, with `parent` the stock unit, so stock units elsewhere are untouched |
| Keep the unit's normal weapon beside the forecast? | Remove it (`WeaponArray` index removed). Keeping it means the unit still auto-hits; only keep it when the forecast is a special move on top of a normal attack |
| Which shape per attack? | Melee: arc in front (90–120°, 1.75–2 cells). Ranged: a lane of projectiles, or a lobbed circle |
| How many forecasts per unit? | One. A unit with a close and a far attack gets two, split by distance on the commit |
| Windup length | 1.75 s |
| What do held-back melee units do? | Circle the target at about 3 cells until its melee slot frees |
| Does dodging stagger the attacker? | Yes, when the Workspace has a dodge behaviour on its heroes; name it |
| Aimed or area, for each attack? (only when AI-driven units fight beside the player's hero) | Aimed for quick, narrow attacks (a pounce, a lane, a swipe); area for anything that lands on the ground (a lobbed circle). Name the controlled hero's behaviour |

This step is done when every row has an answer.

## 2. Build the shared pieces once

One set per Mod, shared by every unit, with no unit or Campaign prefix: the slot buffs and validators, the winding buff, the strike and stagger buffs, and their apply and remove effects ([RECIPES.md § Shared](RECIPES.md#shared)). One shared winding buff means a unit with two forecasts never winds up both at once. Done when they compile.

## 3. Build each forecast

Per attack, in this order ([RECIPES.md § Forecast](RECIPES.md#forecast)):

1. **Ability**: an autocast `CAbilEffectTarget`. Its autocast validators are only unit-behaviour checks (slot free, recovered).
2. **Commit set**: rechecks the slot, adds any distance check, applies the slot on the target, winding (and an aim buff for the animation) on the caster, and creates the windup persistent.
3. **Windup persistent** at `TargetUnit` with `ExpireDelay` = windup. Its location is the spot the strike aims at.
4. **Release set**: removes winding, applies recovery, runs the strike.
5. **Strike set**, validated by caster alive and not staggered: the shape's search, or the projectile launch.
6. **Hit switch**: dodging → stagger the caster; otherwise damage.
7. **Marker actor**, created on the persistent's start and destroyed on its stop ([RECIPES.md § Markers](RECIPES.md#markers)).
8. **Sounds and launch point** ([RECIPES.md § Show](RECIPES.md#show)).

Done when each attack's chain compiles and its marker, windup, strike and hit are all named entries.

## 3a. Aimed and area attacks (with AI-driven allies)

Skip this when only the player's units are ever targeted. Where AI-driven units fight beside the player's hero, a marker for every attack on every ally clutters the screen, and a hidden marker that can still hurt the player breaks the promise that every attack is readable. So each forecast declares a kind:

- **Aimed:** the marker shows only when the target is the controlled hero. Aimed at anything else, the attack runs an unmarked twin of its windup persistent, and its hit switch never damages the controlled hero (an extra case that does nothing on it), so the player can't be hit by an attack they couldn't see. AI-driven units in the shape are hit as usual.
- **Area:** the marker always shows, whoever the target, and the strike hits everything in the shape, the controlled hero included.

Build an aimed attack's commit as a switch on the target: the controlled hero's behaviour picks the marked persistent, anything else the unmarked one. Both release the same way. When the player switches heroes mid-windup, the Workspace's switch reveals or hides the windups already running on the two heroes. That belongs to the Workspace's hero switch, not to this skill's data. Not yet proven in game.

The attacker's windup animation and the hit itself always show, so an attack on an ally never lands unannounced.

## 4. Build the driver and the unit

- A melee unit follows the nearest enemy while that enemy's melee slot is free, and circles it otherwise.
- A ranged unit follows the ranged rule.
- Either kind backs off from an enemy that comes within 2 cells, a melee unit only while another unit holds the slot.
- Hold the driver while winding.
- The unit actor animates the windup and strike from behaviour events.

See [RECIPES.md § Driver](RECIPES.md#driver) and [RECIPES.md § Unit](RECIPES.md#unit). Done when the unit compiles with the abilities and driver on it.

## 5. Test in a map

Place the units against a hero in a flat test Mission and play it. Check, per attack:

- the marker appears at commit and faces or sits where the strike lands;
- the unit holds still through the windup;
- walking out before the strike takes no damage, and standing in takes the full hit;
- with kinds (3a): an aimed attack on an ally shows no marker and doesn't hurt the controlled hero standing in it; an area attack shows its marker on any target and hits everyone;
- melee and ranged units take turns on one target, with a quiet gap;
- ranged units hold one cell inside range.

Temporary debug flashes (a different stock model per step, since tint doesn't show on cursor splats) and a raised life pool on the test units help; keep them out of the Mod. Done when the author has seen every check pass.

## Gotchas

Each cost a test round:

- **Placeholder spheres**: a new `CActorUnit` with `parent` the stock unit's actor finds no model, since `unitName` is bound there. Parent it on `GenericUnitStandard`, set `unitName` by its id, and copy the stock actor's `Model`, macros and events.
- **Autocast never fires**: a distance validator (`CValidatorLocationCompareRange`) in `AutoCastValidatorArray` breaks autocast. Put distance checks on the commit set.
- **Autocast cancelled every tick**: a driver issuing `stop` each period cancels the autocast. Stop only while the unit has a move order (`CValidatorUnitOrderQueue`, `AbilLink move`, `Find 1`).
- **Strike faces nowhere**: an arc search faces its effect's target point. With the windup persistent on the caster, the arc has no direction. Put the persistent at `TargetUnit` and the search at `ImpactLocation CasterUnit`.
- **Unit slides during the windup**: the winding buff needs `SuppressMoving` and `SuppressTurning`, not only `DisableAbils`.
- **Marker vanishes early**: a model actor that plays one non-looping clip ends with the clip. Loop `Stand` in an `AnimBracketStart BSD Birth Stand Death` and close the bracket on the strike's search or on `ActorOrphan`.
- **Effect model never shows**: many impact models have only a `Death` clip. Parent the actor on `ModelAnimationStyleOneShot`, which plays it once and destroys the actor.
- **Ranged units walk into melee**: `move` on the target follows into contact. Order a move to a point one cell inside range on the line to the target (an offset vector, below).
- **Targets workers or air**: search filters need `Ground` in the required list.
