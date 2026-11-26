# Forecast attack recipes

The entries below are in `compile_mod` entry form (`catalog`, `class`, `id`, `parent`, `fields`), shortened to their fields. `<Unit>` and `<Attack>` stand for the unit and attack names. The numbers are tuned defaults that played well: a 1.75 s windup, a 1.5 s quiet, and recovery of 0.5–2 s (melee) or 1–3 s (ranged).

The filter string every search and ability uses, written `<EnemyGround>` below:

```
Ground,Visible;Self,Player,Ally,Neutral,Structure,Missile,Stasis,Dead,Hidden,Invulnerable
```

Strike searches drop `Visible` and `Stasis` from it, so a target that just stepped into fog is still hit.

## Shared

One set per Mod. Each slot kind (`Melee`, `Ranged`) gets its own buff, validator and apply effect.

| Entry | Class | Fields |
|---|---|---|
| `ForecastIncoming<Kind>` | `CBehaviorBuff` | Hidden, `MaxStackCount` 1, `Duration` = windup + quiet (3.25) |
| `ForecastSlotFree<Kind>` | `CValidatorUnitCompareBehaviorCount` | `Behavior` the buff above, `Compare` LT, `Value` 1 |
| `ForecastSlotTaken<Kind>` | `CValidatorUnitCompareBehaviorCount` | the same buff, `Compare` GE, `Value` 1 |
| `ForecastIncoming<Kind>Apply` | `CEffectApplyBehavior` | on the target |
| `ForecastWinding` | `CBehaviorBuff` | Hidden, `Duration` windup + 0.5 (a backstop; the release removes it). `ModifyFlags` SuppressMoving, SuppressTurning, DisableAbils; `StateFlags` SuppressAttack |
| `ForecastWindingApply` / `ForecastWindingRemove` | `CEffectApplyBehavior` / `CEffectRemoveBehavior` | `WhichUnit` Caster |
| `ForecastCasterNotWinding` | `CValidatorUnitCompareBehaviorCount` | `WhichUnit` Caster, `Behavior` ForecastWinding, EQ 0 |
| `ForecastStrike` | `CBehaviorBuff` | Hidden, 0.35 s: the strike animation hangs off it |
| `ForecastStagger` | `CBehaviorBuff` | Negative, 1.25 s, `Stun`, SuppressAttack, SuppressMoving, SuppressTurning, DisableAbils |
| `ForecastStaggerCaster` | `CEffectApplyBehavior` | `WhichUnit` Caster |
| `ForecastCasterNotStaggered` | `CValidatorUnitCompareBehaviorCount` | Caster, ForecastStagger, EQ 0 |
| `ForecastTargetIsDodging` | `CValidatorUnitCompareBehaviorCount` | the Workspace's dodge behaviour, GE 1 |

## Forecast

The chain for one attack. The pieces before the strike are the same for every shape.

```json
{ "class": "CAbilEffectTarget", "id": "<Unit><Attack>", "fields": {
  "Alignment": "Negative", "TargetFilters": "<EnemyGround>", "Range": 1.5, "Arc": 15,
  "AutoCastRange": 1.5, "AutoCastFilters": "<EnemyGround>",
  "AutoCastValidatorArray": ["ForecastSlotFreeMelee", "<Unit>Recovered"],
  "Flags": [{"index": "AutoCast", "value": 1}, {"index": "AutoCastOn", "value": 1}, {"index": "RequireTargetVision", "value": 0}],
  "Effect": {"index": 0, "value": "<Unit><Attack>Commit"},
  "Cost": {"Cooldown": {"TimeUse": 1}},
  "CmdButtonArray": {"index": "Execute", "DefaultButtonFace": "Attack"} } }
```

- **Facing:** `Arc` 15 makes the unit turn to face the target before it commits.
- **No PrepTime:** the windup persistent does the waiting, so an ordered cast never stalls on range.

| Entry | Class | Fields |
|---|---|---|
| `<Unit><Attack>Commit` | `CEffectSet` | `ValidatorArray` the slot (and any distance check); `EffectArray` slot apply, ForecastWindingApply, aim apply, the CP |
| `<Unit><Attack>CP` | `CEffectCreatePersistent` | `WhichLocation` TargetUnit, `ExpireDelay` 1.75, `ExpireEffect` the release |
| `<Unit><Attack>Release` | `CEffectSet` | ForecastWindingRemove, `<Unit>RecoverApply`, the strike |
| `<Unit><Attack>Strike` | `CEffectSet` | `ValidatorArray` CasterIsAlive, ForecastCasterNotStaggered; `EffectArray` ForecastStrike apply plus the shape |
| `<Unit><Attack>Hit` | `CEffectSwitch` | case ForecastTargetIsDodging → ForecastStaggerCaster; default the damage |
| `<Unit>Recover` | `CBehaviorBuff` | Hidden, `Duration` 0.5, `DurationRandomMax` 2 |
| `<Unit>Recovered` | `CValidatorUnitCompareBehaviorCount` | Caster, `<Unit>Recover`, EQ 0 |

### Distance split

A unit with a close and a far attack keeps them apart on the far attack's commit:

```json
{ "class": "CValidatorLocationCompareRange", "id": "<Unit>BeyondClose", "fields": {
  "WhichLocation": {"Value": "CasterUnit"}, "Compare": "GE", "Range": 2,
  "Value": {"Value": "TargetUnitOrPoint"} } }
```

### Arc

```json
{ "class": "CEffectEnumArea", "id": "<Unit><Attack>Search", "fields": {
  "ImpactLocation": {"Value": "CasterUnit"},
  "SearchFilters": "Ground;Self,Player,Ally,Neutral,Structure,Missile,Dead,Hidden,Invulnerable",
  "AreaArray": {"Arc": 90, "Radius": 2, "Effect": "<Unit><Attack>Hit"},
  "SearchFlags": {"index": "OffsetByUnitRadius", "value": 1} } }
```

The arc faces the effect's target point, which is the CP's spot.

### Leap with the strike

A melee lunge that carries the unit forward:

- **Offset:** a one-shot persistent at `CasterUnit` with `PeriodicOffsetArray` `"0,-2.4,0"`. Offsets are relative to the caster's facing, negative y forward.
- **Launch:** a `CEffectLaunchMissile` with `LaunchLocation` CasterUnit, `ImpactLocation` TargetPoint, `Flags` 2D and Placement, `PlacementRange` 1.5, and a charge mover (`HotSRaptorChargeMissile`).

### Lane of projectiles

A line the target steps out of. This is the Adept glaive pattern.

- **Launch persistent:** `CEffectCreatePersistent` at `CasterUnit`, `PeriodCount` 3, `PeriodicPeriodArray` 0.08. `PeriodicOffsetArray` is `"-0.3,-L,0"`, `"0,-L,0"`, `"0.3,-L,0"`, where L is the range plus half a cell.
- **Missile:** `CEffectLaunchMissile` at `CasterUnit` → TargetPoint, with `AmmoUnit` a stock weapon missile unit (`NeedleSpinesWeapon`), `Movers` a guidance `CMoverMissile` (`MaxSpeed` 14, `Acceleration` 1600), and `PeriodicEffect` the search.
- **Search:** `CEffectEnumArea` at `ImpactLocation SourceUnit` with `RectangleWidth` 1.25 and `RectangleHeight` 0.6. The source is the missile, so the rectangle travels with it.
- **Hit once:** the search's effect is a set validated by a 0.75 s hidden hit-mark buff being absent. It applies the mark, then the hit.

### Lobbed circle

- **Missile:** `CEffectLaunchMissile` at `CasterUnit` → TargetPoint, `AmmoUnit` a stock lob (`AcidSalivaWeapon`), with a `CMoverMissile` whose `MotionPhases` has `Driver` Ballistic, `Gravity` 40 and `FlightTime` 0.5. A fixed flight time lands every lob on the same beat, whatever the distance.
- **Hit:** its `ImpactEffect` is a circle `CEffectEnumArea` (radius 1.5, `ExtendByUnitRadius`).
- **Timing:** set the CP's `ExpireDelay` to the windup minus the flight time (1.25), and launch the lob on its expiry, so the shot lands at 1.75 s. The marker's bracket closes on the hit's search, so it stays until the shot lands.

## Markers

Each marker is created on `Effect.<Unit><Attack>CP.Start` and destroyed on `.Stop` or `ActorOrphan`. Set `FogVisibility` Visible and `SuppressSaveLoad`.

| Shape | Actor | Key fields |
|---|---|---|
| Arc | `CActorArc` | `Model` `ZergAOEConeRed`, `Angle` = the search's arc, `Radius` = the search radius + 0.375, `Aliases` `_Scalable`, `Host` `_Selectable`, `HostSiteOps` SOpShadow. Event terms carry `; At Caster` |
| Lane | `CActorQuad` with parent `ZergGuideVisualQuad` | `LaunchActor` / `CenterActor` / `ImpactActor` the `ZergGuideVisualQuadRed*` segments, `Quad` `-0.5,-1,0.5,0`, `Width` = the rectangle width, `Height` = L, `Host` `_Selectable` |
| Circle | `CActorModel` | `HostSiteOps` SOpTargetPoint SOpShadow with HoldPosition and HoldRotation. On creation `AnimBracketStart BSD Birth Stand Death`; `AnimBracketStop BSD` on `Effect.<search>.Start` and on `ActorOrphan`; `Destroy` on `AnimBracketState.*.AfterClosing; AnimName BSD`; a 5 s timer as a backstop |

- **Circle marker, stock options:** `Ravager_Artillery_Marker_Long` (native radius 0.5) and the Void campaign's `Aiur_VoidTendril_VoidZone_Missile_Cursor_Effect`. Scale each to the hit radius in its `CModel`.
- **Recolouring:** a marker in another colour needs a recoloured copy of the model and its textures. sc2-adjutant has no Blueprint step for this yet.

## Show

- **Launch point, missile and impact:** use a `CActorAction` with parent `GenericAttack` and attributes `effectLaunch` (the launch effect) and `effectImpact` (the hit). Copy `Missile`, `LaunchAssets`, `LaunchAttachQuery` and `ImpactMap` from the stock unit's attack action, for example `HydraliskAttack` or `RoachAttack`.
- **Splash at a point:** a `CActorModel` with parent `ModelAnimationStyleOneShot`, created on `Effect.<search>.Start` with `HostSiteOps` SOpTargetPoint. Use a stock impact model, scaled to the hit radius in its `CModel`.
- **Melee sounds:** a `CActorSound` created on `Effect.<search>.Start; At Caster` plays the swing. Another, created on `Effect.<damage>.Start; At Target`, plays the hit.

## Driver

A permanent hidden `CBehaviorBuff` with `Period` 0.25, whose `PeriodicEffect` moves the unit. Every top-level driver effect is validated by `ForecastCasterNotWinding`.

**Melee:**
- **Seek:** a `CEffectEnumArea` at CasterUnit, radius 10, `MaxCount` 1, `TargetSorts` TSDistance, for the nearest enemy.
- **Approach:** a switch. If the enemy's melee slot is free, issue `move` on TargetUnit. Otherwise circle.
- **Circle:** a set validated by a 1.5 s hidden `Circling` buff being absent. It applies the buff and creates a one-shot persistent at TargetUnit with `Flags` RandomOffset and eight `PeriodicOffsetArray` points on a 3-cell ring. Its periodic effect issues `move` on TargetPoint.

**Back off (both kinds):** the first case of the driver's switch. While an enemy is within 2 cells (`CValidatorLocationEnumArea`, GE 1), seek it and order a move to a persistent at TargetUnit with `OffsetVectorEndLocation` CasterUnit and `InitialOffset` `"0,-4,0"`, a point 4 cells from the enemy on the far side of the caster. A melee unit backs off only while the enemy's melee slot is taken (`ForecastSlotTakenMelee`), so the unit striking keeps its place.

**Ranged (the ranged rule):**
- **Hold or seek:** a switch. While an enemy is within range (`CValidatorLocationEnumArea`, radius = range, GE 1), issue `stop`, validated by a `CValidatorUnitOrderQueue` (`AbilLink` move, `Find` 1), so only a walking unit is stopped. Otherwise seek the nearest enemy within about range × 2.
- **Approach:** a persistent at TargetUnit with `OffsetVectorEndLocation` CasterUnit and `InitialOffset` `"0,-(range-1),0"`. That places a point range − 1 cells from the target toward the caster. Its `InitialEffect` issues `move` on TargetPoint. Raise the unit's range by a cell or two over stock, since holding back makes it miss more.

## Unit

- **Unit:** a `CUnit` with `parent` the stock unit. Remove its weapons (`{"index": N, "removed": 1}` in `WeaponArray`) unless the author keeps the default attack. Add the abilities and the driver to `AbilArray` and `BehaviorArray`.
- **Actor:** a `CActorUnit` with parent `GenericUnitStandard`, the stock actor's `Model`, `Macros` and birth and land events copied, plus the windup and strike animations:

```json
{"Terms": "Behavior.<Unit><Attack>Aim.On", "Send": "AnimPlay Windup Attack PlayForever 0.150000"},
{"Terms": "Behavior.<Unit><Attack>Aim.Off", "Send": "AnimClear Windup"},
{"Terms": "Behavior.<Unit><Attack>Strike.On", "Send": "AnimPlay Strike Attack NonLooping"}
```

- **Slow-motion windup:** `AnimSetTimeScale Windup <scale>` stretches a short clip (a leap's start) across the windup. A per-attack aim buff picks the clip when a unit has two attacks.
