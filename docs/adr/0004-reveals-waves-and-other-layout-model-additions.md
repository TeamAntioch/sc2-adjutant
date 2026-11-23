# Reveals, Waves and Other Layout Model Additions

Calibrating the checker against four Blizzard missions (Zero Hour, The Evacuation, Devil's Playground, Media Blitz) left 4 warnings and a column of `not-evaluated` checks. All of them were modelling gaps, not weaknesses in the maps. Blizzard previews goals with scripts, attacks with timed waves, sets goals that aren't places, moves the player's start between acts, and uses hazards other than flares. The model in [ADR 0003](0003-layout-model-for-the-level-design-checker.md) can say none of this. We add the facts below, in order of how much they unblock. ADR 0003's rules still hold: **derive rather than store**, and a check missing its inputs reports **not evaluated**, never pass.

Most of these fields are **declared for the checker before the compiler builds them**, as with every connection type except `ramp`. A blueprint can therefore promise a reveal or a wave that the compiled map doesn't yet have. The critique checks each one against the screenplay and Mechanics, and each later compiler change removes one such gap.

1. **Reveals.** `beats[].reveals: [zoneId]` lists the Zones the Beat's script shows the player: a camera pan, a revealer, a minimap ping, an opening tour. The first Beat's list covers the mission start. `readable-approach` passes a goal that is revealed in its Beat or an earlier one, as it does for an overlooked goal, and says which. This replaces ADR 0003's deferred "reveal Anchor": the layout needs to know *what* is shown, not where the camera stands.
2. **Waves.** A top-level `waves[]`: timed attacks that are separate from the one-shot `encounters`. Each wave has:
   - `id`, `spawnZoneId`, `targetZoneId`
   - `arrival`: `ground` | `air` | `drop` | `nydus` | `burrow`. Only `ground` waves route through connections. The others arrive at the target directly.
   - `unitTypes: string[]`, which the teaching check reads
   - `startsAtBeat`, optional `endsAtBeat`, `firstSeconds` (after `startsAtBeat` begins) and `intervalSeconds`
   - an optional `speed` in cells per second. Without it the checker assumes the reference speed and says so.

   A new `threat-paths` check routes each ground wave from spawn to target. It reports the entrance the wave uses, its travel time, and the hold bands from `ARCHETYPES.md` (warning time, interval, interval at least 5× travel). `safe-havens` treats a wave's target as threatened in the wave's Beats, so a hold mission no longer passes "for the wrong reason".
3. **Declared archetype.** An optional `archetype` on the blueprint (`hold` | `escort` | `moving-hazard` | `race` | `commando` | `assault` | `expansion`), and an optional `archetype` on a Beat that takes over from that Beat on (Media Blitz is a commando raid, then an assault). The checker applies the archetype's bands from `ARCHETYPES.md` directly, and skips rules the archetype exempts: two approaches per goal for Escort and Commando, for example.
4. **Goals that aren't places.** `OutcomeCondition` gains:
   - `timer {seconds}`: survive until it ends. The goal is the player's held region, so the route checks measure nothing. `safe-havens` and `threat-paths` carry the mission.
   - `resourceQuota {resource, amount}`: the goal is the resource sites, so `travel-times` measures the start to each `resource-base` Placement.

   Both are compiled (a timer, and a player-property check), so they are real outcomes, not checker-only. An `anchorEntersZone` goal whose anchor isn't the player's start unit is an **escort**. The route runs from that anchor, at its `speed` if the anchor declares one (a new optional Anchor field read only by the checker).
5. **A start per Beat.** An optional `beats[].startAnchorId`: the unit the player plays from in that Beat, carried forward to later Beats. Each Beat's goals are routed from that Beat's start, and the player's held region is derived from it. Media Blitz's act 2 plays from Horner's base, and The Evacuation's convoy runs from the colony.
6. **Hazards in general.** A `hazard` Mechanic type with params:
   - `affectedZoneIds` and `safeZoneIds`
   - `firstSeconds`, `intervalSeconds` and `deadlySeconds`
   - `warningSeconds`: how long before each surge the player knows it's coming

   It's checker-only until a compiler needs it. The checker reads a `flare` as a hazard too: it affects every Zone except its shelters, and its countdown is always on screen, so its warning is the whole interval. A new `hazard-retreat` check requires `warningSeconds ≥ 1.2 × the worst retreat` from any affected Zone to the nearest safe one, measured on the grid. That one rule covers both variants in `ARCHETYPES.md`. For a traversal hazard (a run between refuges) the retreat is the gap between refuges and the warning is the interval. For an occupation hazard (Devil's Playground's lava) both are short.
7. **Crossing points.** An optional `at: {x, y}` on a connection: where the ramp, bridge or gap actually sits. Routes go through it, which removes most of the remaining error in travel times. For ramps it replaces `edge` and `offset`, which migrate mechanically. The ramp compiler places the ramp on the high Zone's boundary nearest `at`. Diagonal ramps are the compiler's own follow-up, but this field gives it the data.
8. **Passive groups.** An optional `passiveUntilBeat` on an `encounter-group` Placement: the group doesn't attack until that Beat. `safe-havens` and "enemies are walls" ignore it before then. Media Blitz's parade garrison is the case.

**Derived, never stored:**
- whether each goal is previewed, and how (overlook, long view or reveal)
- each wave's route, entrance and travel time
- the start and held region for each Beat
- each hazard's worst retreat

**Order of work.** One PR each, in the order above: schema plus migration, then checks and tests, then the calibration blueprints filled in and re-run. Items 1 to 3 should clear the remaining calibration warnings. Items 4 and 5 turn Zero Hour's and The Evacuation's `not-evaluated` route checks into real results.

**Still deferred:**
- Zone `size`, `mood`, `intensity` and `district`
- the `landmark`, `vignette` and `cache` Placement kinds
- a `teleport` Connection type
- `Mechanic.stages[]`
- encounter strength (for the Assault "layers before the core" band)
- Asset Catalog tags
- compiling hazards (waves are compiled since ADR 0008; reveals since #416, as an explore under fog of a circle at a chosen point Anchor as their Beat starts, and a minimap ping once the scenes cued then have handed back; a reveal may name the point and radius as well as the Zone)
