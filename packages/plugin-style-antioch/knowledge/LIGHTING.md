# Lighting

How to light a mission through the blueprint (DL-09): one light for the mission's mood, painted lighting regions where its places differ, and transitions that change it when the story moves on.

## Fields

- **`lights`**: the mission's own lights. Each is a full copy of a stock light (`from`) with a few knobs turned, written to the map's `LightData.xml`:
  - `ambient`: `color` (0-1 floats, not 0-255) and/or `scale` (multiplies its brightness);
  - `key` (the sun): `color`, `scale`, `direction` (where it shines toward: x east, y north, z up);
  - `exposure`: HDR exposure (stock lights mostly sit at 1.5).
- **`lighting`**: the light the mission plays in, stock or one of `lights`. Without it, the tileset's own.
- **`lightRegions`**: up to three more lights (regions `"2"` to `"4"`) painted onto the ground, each blending into the next, with region 1 the mission's light as it is. Each takes `from` (a light to copy, one of `lights` or stock) and the same `ambient`, `key`, `fill` and `back` knobs, but not `direction` or `exposure`. It can also take `specular`, `environment` and `fog`. A Zone's `lightRegion` names one region, or a list shared equally (`[1, 2]`). Every cell takes its nearest walkable Zone's region, and each edge blends over about `blend` cells (8). The fields, defaults and warnings are in sc2-adjutant's `docs/reference/lighting-regions.md`.
- **`transitions`**: each has an `id`, an optional `beatId`, a `cue` (the screenplay's cues: `missionStart`, `anchorDies`, `anchorEntersZone`, `anchorCaptured`, `encounter`, and `{ "type": "mechanic", "mechanicId": <entry id>, "cue": <name> }` for a moment a Mechanic declares, such as the flare's `firstFlare`), an optional `afterSeconds`, and a `light`:
  - a **cut**: `{ "to": "StarshipDark" }` (`seconds` defaults to 0);
  - a **drift**: `{ "to": "Midnight", "seconds": 480 }`;
  - a **pulse**: `{ "to": "<bright light>", "seconds": 0.25, "back": { "after": 1.5 } }`, which blends back to `back.to`, or else the mission's light.

Each transition compiles to its own trigger, which its cue's trigger runs without waiting, so a pulse's hold doesn't delay the dialogue.

## Steps

1. **Pick the starting light** from `packages/core/data/light-catalog.json` (634 stock lights; portrait and UI lights left out). Each has a `summary` (ambient and key brightness, hue and saturation; exposure) and a `group` (`Tilesets` for planet lights, `StoryModeCutScenes...` for interiors and story sets). Start from the tileset's own light (`packages/core/data/tileset-lights.json`) unless the mood is far from it. Done when the light's summary matches the mood in words ("cold blue night", "warm haze").
2. **Retune it** when the mood asks for it. The exemplars' in-play lights have a darker ambient than stock (median 0.31 against 0.39), more often saturated and blue-violet, with key and exposure unchanged (N9); 3-11, the user's own map, doesn't do this, so offer it, don't impose it. Turn 1-3 knobs, as the exemplars' overrides do.
3. **Paint the places that differ**: when the light should change with where the heroes are rather than when (deeper underground, inside a ruin, a lit square in a dark city), give those Zones lighting regions instead of transitions. A region or a 50/50 mix of two per Zone gives up to seven steps. Backtracking needs nothing, and an edge between two places blends instead of cutting. A transition that switches Light hides the regions while it's on, so a region ladder replaces a ladder of transitions. Done when each Zone whose place has a light of its own names its region.
4. **List the transitions**: a cut where the player moves to a new place, goes through a blackout or enters a cutscene; a drift for time passing; a pulse for an event (DL-09). `StarshipDark` is the exemplars' house night and interior light. Done when every Beat that changes place or time has its transition, or a reason it keeps the light.
5. **Check it in game.** Lighting only shows in Test Document; `npm run lighting-preview` cycles candidate lights the way a flare would.

## Point lights

Light doodads placed in the map (DL-12): `LightOmni<Colour>` and `LightOmni<Colour>Large` shine; fixtures such as `Floodlight`, `DOM_LabFloodLight`, `DOM_Groundlights`, `LandingLights` and `AlarmLight` glow and mark a place.

- **Where.** Expected wherever the light is dark: a night map, an interior, a cave, the void. Optional, off by default, under a daylit sky. Of Blizzard's 100 dressed campaign maps, 44 place no omni lights (nearly all daylit outdoors), and the 18 with 30 or more are all dark: The Escape 147, Belly of the Beast 308, Shakuras City 177.
- **How many, indoors.** About one omni light per 170 floor cells, plus one or two fixtures per 100 floor cells: Blizzard's hero-mission interiors carry 1.8 lights per 100 floor cells, 0.6 of them omni. The Escape, the densest-lit, has 3.8, 2.2 of them omni.
- **With what.** Each light stands beside a prop group or a fixture, one colour per family (DL-12): white over stores and floodlit posts, yellow over consoles and furniture, red on alarms and machines, blue or cyan on lab and tech. In Blizzard's interiors 46% of solid props have a light within 4 cells. A fixture is usually lit by an omni light beside it (`CompoundMansion_Light` with `LightOmniYellow`, 16x chance).
- **Not in rows.** Of 1,062 evenly spaced runs on Blizzard's industrial maps, 5 are lights. Landing and ground lights may line a bay or a lane; omni lights go with their groups.
- **Height.** Most omni lights stand at floor level; a few are raised 0.7-1.4. Fixtures on a hatch's rim stand 0.5-0.9 up; most wall lights stand at the wall's foot (74%), a tenth hang on its face (DL-19).
- **How.** There's no `pointLights` setting yet. Place lights as set-piece members beside their props, inside a Composite (the pack's `console-bank`, `supply-stack` and `steam-hatch` carry theirs), or as doodad anchors. Shores have their own (`dressing.shores.lights`, [`WATER.md`](WATER.md)). Look at the result in Test Document as well as the Editor.

The compiler warns about a light id that is neither one of `lights` nor stock, since a dependency may define it.
