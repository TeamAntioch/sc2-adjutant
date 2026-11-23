# Mission archetypes

Each archetype is a known "play" to riff on, like the "library of several dozen plays" Dustin Browder describes for SC2's missions ([Game Informer, 2009](https://gameinformer.com/games/starcraft_ii_wings_of_liberty/b/pc/archive/2009/10/30/feature-lead-designer-dustin-browder-on-story-and-map-design-in-starcraft-ii)). Each entry gives:
- when to use it
- its parti (a Zone-graph sketch using blueprint roles)
- the rules that matter most for it
- the checker warnings it expects
- SC2 examples

Declare the archetype in the blueprint by the slug after each heading (`archetype: "hold"`). A mission can change archetype between acts: set `archetype` on the first Beat of the new act. The checker's `archetype-bands` applies the Bands below to the Beats each archetype covers. Hold, Escort, Moving hazard and Assault have been calibrated against one Blizzard mission each, named in each Bands heading. Their **Bands** are measured Blizzard values: treat them as a starting range, not a pass mark. The other examples come from memory of the missions.

Graph shapes, after Umberto Eco's three kinds of labyrinth: a **labyrinth** is linear, a **maze** branches with dead ends and risk, and a **rhizome** (his net) is fully connected (air, Nydus and warp links count).

## Hold / survive (`hold`)

**Use when** the story is "hold out until rescue, the timer or the last wave".

**Parti:**
- the base (`base`) on a plateau with 2–4 entrances (`ramp` or `narrow`)
- outside it, `path` Zones toward several enemy spawn directions
- optionally a `refuge` fallback inside, for a shrinking fortress: safe ground lost Zone by Zone

**Rules:**
- Travel time from a spawn to an entrance buys warning; the wave interval buys rebuild time.
- Count the ground entrances into the held region and fix them on purpose; this is the main difficulty dial. List air approaches separately.
- Compare bounce times: the defender should cross between entrances faster than the attacker, as Zero Hour's bridges do (see Bands).
- Put rich resources or rescue sites outside the walls to pull the player out, so turtling doesn't win.

**Bands (Zero Hour):**
- 2 ground entrances (two bridges over a chasm), plus 3 air directions.
- Bounce ratio 0.4: the defender crosses between the bridges in 24 cells, the attacker in 61.
- Spawn to entrance about 9–10 s for zerglings.
- Waves about 110–240 s apart per entrance (60–150 s combined), falling to 20 s only in the scripted finale.
- Base plus one rescue site open at a time.

**Expect:** `entrances` to report the count you chose for the player's held region. `threat-paths` to show each ground wave entering by one of them, about 9 s or more after it sets off, and `safe-havens` to list the base as attacked. Give the hold objective `completeWhen: {"type": "timer", "seconds": …}` (and the same victory condition): the route checks then report the hold rather than staying `not-evaluated`.

**Examples:** Zero Hour; The Dig (hold while the drill works); All In; The Evacuation (defence variant).

## Escort (`escort`)

**Use when** something must travel a route: a convoy, a train, a hero on foot.

**Parti:**
- one clearly marked road (a distinct texture), built as a chain of `path` Zones
- side Zones that approach the road and serve as ambush lanes
- pre-built strongpoints (Placements) along the road
- the player's `base` beside the road, not on it

**Rules:**
- The road is defensible at fixed points and short enough to follow with an army: Blizzard built The Evacuation's road for both a static defence in its bunkers and a mobile army that follows the convoys.
- Keep the escort route wide; a `narrow` connection on it is a declared drama beat (LP-15).
- Escorted units must never need a blind uphill entry.
- Time the road at the escorted unit's speed, not an army's: give its Anchor a `speed` and make the escort goal `anchorEntersZone` for that unit.

**Bands (The Evacuation):**
- Road about 140 cells: a marine walks it in about 45 s, the convoy takes about 100 s.
- A strongpoint every 60 cells or less (2 bunkers 56 cells apart, plus turrets at both ends).
- 2–4 chokes on the road, 12–18 cells wide.
- Attackers gather 25–50 cells off the road.
- 60–110 s of quiet between convoys.

**Expect:** fixed single points of failure along the road, reported as intended. `archetype-bands` reports a road outside 120-160 cells. List the destination and road in the escort Beat's `reveals`.

**Examples:** The Evacuation; Engine of Destruction.

## Moving hazard (`moving-hazard`)

**Use when** a Mechanic sweeps the map on a timer: lava, a solar flare, a day/night cycle, a storm. There are two variants:
- **Traversal:** the player crosses the hazard zone to a goal, running between shelters.
- **Occupation:** the player has to work inside the hazard zone (Devil's Playground's mining in lava-prone low ground).

**Parti:**
- Zones stratified by exposure, at two or more elevations or with shelter (`refuge`)
- **Traversal:** refuges spaced about one hazard interval of travel apart along the critical path
- **Occupation:** every Zone the hazard covers sits one short retreat from safe ground

**Rules:**
- The Mechanic needs terrain to act on: at least two tiers, or shelter Zones, with paths between them.
- The final warning is at least 1.2 times the worst retreat to safe ground, from every Zone the hazard covers. The checker allows a second of slack on the retreat, because it measures from the worst cell of a sketched Zone.
- Refuge spacing in travel time sets the pace (LP-5; PC-2).
- Demonstrate the hazard on units other than the player's before the first exposure (LP-3).
- Safe ground next to enemy bases doesn't count as a refuge.

**Bands (The Devil's Playground, occupation):**
- First surge at 60 s, then every 300 s (Normal); deadly for about 15 s; countdown always on screen.
- Final warning 10 s against a worst retreat of 6–8 s: a ratio of 1.2–1.7.
- Refuges 18–38 s apart.
- 3 new field sites opened per reveal.

**Expect:** `introduces` on the first Beat naming the hazard. Declare it as a `hazard` Mechanic (`affectedZoneIds`, `safeZoneIds`, `firstSeconds`, `intervalSeconds`, `deadlySeconds`, `warningSeconds`), or another Mechanic whose Threats cover whole Zones, which the checker reads the same way. `hazard-retreat` then names every affected Zone whose retreat is over the band. Late Zones that deliberately push the player onto enemy high ground can break it; record them in `layout-notes.md`.

**Examples:** The Devil's Playground (lava, high ground); Outbreak (day/night). (A Mission with a hazard Mechanic isn't always this archetype: judge it from its screenplay.)

## Multi-objective race / hub and spoke (`race`)

**Use when** the player must take several sites (relics, outposts, artifacts), often against an enemy racing for them.

**Parti:**
- a `base` hub with `objective` spokes
- spokes opened in tiers by Beats (`opensAtBeat`)
- each spoke reachable on its own

**Rules:**
- No more than about three sites active at once (LP-13).
- The hub is lower-threat than its spokes.
- Across the mission, the spokes cover most of the map's distinct Zones (LP-17).
- "N of M" objectives can be done in more than one order, each site with its own local challenge.

**Expect:** `goal-spread` warnings if too many sites share a Beat.

**Examples:** Welcome to the Jungle (a race for gas canisters); The Great Train Robbery (an intercept race).

## Commando / small squad (`commando`)

**Use when** there's no base and a hero or squad infiltrates.

**Parti:**
- a chain of mostly single connections (a labyrinth)
- `refuge` pockets between encounters
- optional `vault` side branches for rewards
- at least one loop near high-threat Zones, so a squad can escape (LP-14)

**Rules:**
- Readable approaches matter most here: the squad can't absorb surprises (LP-4).
- Threats are walls the player sneaks around, so put patrol groups across the line from entry to exit (LP-7).

**Expect:** single points of failure, intended; `dead-space` warnings on vaults that are still empty.

**Examples:** Breakout; Ghost of a Chance.

## Assault (`assault`)

**Use when** the goal is to destroy an enemy base.

**Parti:**
- the player's `base`, then contested `path` and `arena` Zones
- the enemy `base` with at least two approaches, such as a front choke plus a `rocks` backdoor or an `air-only` angle
- outlying enemy expansions to pick off first

**Rules:**
- A layered stronghold: the path to the core crosses at least two enemy-held Zones, and threat doesn't fall over the last two or three Zones (LP-8).
- Each approach into the enemy base is previewable: from high ground the player can take, or by a scripted reveal or tour (LP-4). Blizzard mostly uses the script.
- Give the player reasons to leave their base early: exposed rich resources and enemy expansions that grow over time.
- **Multi-core variant:** several enemy bases, one goal in each, open together (no more than 3). A hero raid in the first act can double as the tour that previews them (Media Blitz).

**Bands (Media Blitz):**
- Base to each core 36–50 s; base to the nearest outpost 16–20 s.
- 2 enemy-held Zones before each core.
- 2–3 ramps into each enemy base; a single ramp up to an inner keep is fine.
- Counterattacks every 180 s (Normal), arriving 20–40 s after they set out.

**Expect:** `entrances` should show at least two ways into each enemy-held region. `critical-path` reports the enemy bases the route has to fight through. Each core goes in the `reveals` of its Beat or an earlier one.

**Examples:** Media Blitz; Smash and Grab.

## Expansion pressure (`expansion`)

**Use when** the mission is about economy and territory rather than one site.

**Parti:**
- a modest start `base`
- richer resource Zones further out, toward the goal or exposed in the middle
- a contested middle

**Rules:**
- Resources get richer and more exposed with distance from the start.
- No single best spot; give each area pros and cons.

**Expect:** nothing specific yet; the resource-gradient check is still a judgement call.

**Examples:** general practice across campaign missions.
