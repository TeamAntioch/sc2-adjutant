# Layout Model for the Level-Design Checker

The level-design skill proposes and critiques Mission layouts. It runs most of its rules as a deterministic checker over the `Mission Blueprint` (see the skill's [Layout Principles](../../packages/claude-plugin/skills/level-design/SKILL.md)). Connection types and `width` already exist. The checker still can't see what a Zone is *for*, which Zones see each other, which Connections change state or only go one way, or what each `Beat` introduces. We add only those facts, and we **derive everything else rather than declaring it**:

- **Split `terrainRole` into `landform` and `role`.** `landform` (`flat` | `ridge` | `canyon` | `transition`) is what the terrain is and may later drive terrain generation. `role` (`base` | `objective` | `refuge` | `vault` | `arena` | `path`) is what the Zone is for in play:
  - `refuge`: a sheltered foothold or regroup pocket that isn't the player's base.
  - `vault`: a small optional reward pocket.
  - `arena`: a deliberately exposed showdown, exempt from the "no open bowl" check.
  - `path`: replaces `neutral`.

  `terrainRole` is read only by the schema, fixtures and four mission blueprints, so it migrates mechanically now, before more blueprints depend on it.
- **Sight is derived, with an explicit escape hatch.** A Zone overlooks each lower Zone whose polygon it borders, whether or not a Connection joins them, because SC2 high ground sees low ground across a cliff edge. `overlooks: [zoneId]` on a Zone adds long views that the derivation can't see, such as across a chasm or a watchtower's radius. The many checks about previewing an objective before committing to it read this relation.
- **Connections gain three optional fields:**
  - `oneWay: true`: traversal only from the declaring Zone. It is declared on that side only, and a reverse declaration is a validation error.
  - `opensAtBeat` and `closesAtBeat`: Beat ids. When `rocks` or `collapsible` crossings change state now lives in the layout instead of being buried in Mechanics.
- **Beats declare `introduces: string[]`:** the Mechanic ids, enemy unit types or connection types first met in that Beat. Beat order is array order. The "one new thing at a time" and "introduce, develop, twist, test" checks read this list.
- **Derived, never stored:**
  - the critical path (the player's start → primary-objective Zones, gated by Beats)
  - enemies as walls (encounter Placements block reachability until their Beat)
  - Zone size class (from polygon area)
  - travel times (from polygon centroids and connection types)
  - optionality (Zones on no path to a primary objective)

**Deferred until a check or the compiler needs them:**
- Zone `size`, `mood`, `intensity` and `district`
- the `landmark`, `vignette` and `cache` Placement kinds
- reveal Anchors
- a `teleport` Connection type
- `Mechanic.stages[]`
- Asset Catalog tags such as `symbol`, `marker` and `hazard`

The checker reports any check whose inputs are missing as **not evaluated**, never as passed, so a sparse blueprint can't look clean.
