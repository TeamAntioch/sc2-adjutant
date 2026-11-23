---
name: encounter-design
description: Encounter design for hero-centred SC2 campaign missions. Plans or critiques one encounter (a named fight or stealth space): its intended problem, the hero tool it is built for, its size and positioning tools, its enemy roles and two authored states, its telegraphs, spawns and alarm, its stealth rules and its puzzle props. Use when designing or reviewing a single fight space, a stealth setup or a puzzle prop in a hero mission, or when asked whether an encounter is readable, fair or too easy for the heroes.
---

Plan or review one encounter. The mission's chain of encounters, its recovery and its failure model are the `hero-mission-design` skill; allies inside the encounter are `ally-design`; a boss is `boss-design`; the Zone it sits in is drawn with `level-design`'s tools.

Where the inputs are. Read the Blueprint with the sc2-adjutant MCP server's `get_blueprint` tool: the Zone, its Beat, its `encounter-group` Placements, Anchors and Mechanics. Read the heroes' kits (abilities, ranges, speeds, cloak, distraction) and the campaign's hero-mission settings from the active Campaign Pack's knowledge through the server (`list_plugins`, the knowledge resources). Unit and prop data come from the server's `asset_catalog` tool and the unit data. **Measure from the real kits.** Every size and timing in an encounter follows from the heroes' range and speed; where the pack has no numbers, say which you assumed.

The rules are this skill's **Encounter Principles** (EN-1 to EN-14, below), its checks ([`CHECKS.md`](CHECKS.md)) and its prop catalogue ([`PROPS.md`](PROPS.md)). [`PRINCIPLES.md`](PRINCIPLES.md) gives the backing.

**Corrections go into the guidance.** When the author corrects an encounter, put the general lesson into this skill and anything campaign-specific into the Campaign Pack's knowledge, in the same change, and tell them where it went.

## Leading words

- **Encounter**: a named space, an enemy mix and a one-line **intended problem** ("break the ranged pair on the ridge before the melee rushers close"). The authoring unit inside a Zone.
- **Setup**: Mimimi's word for an encounter built as a multi-solution puzzle against the available heroes, with a focal point.
- **Tool**: what the encounter is built for: a hero ability, a hero combination, a prop, an ally, the environment. Most hero-mission encounters are built for a hero tool.
- **Problem enemy** and **key enemy**: the enemy that makes the encounter hard, and the enemy whose removal (by the tool) unlocks it.
- **Positioning tool**: terrain the heroes use to fight well: high ground, a choke or ramp, a sight blocker, a kiting loop.
- **Two-state encounter**: an enemy group with an **aggressive territory** and a smaller **fallback**, switched by casualties or hero position.
- **Distraction**: a hero tool that rearranges enemies (a taunt pulls, a decoy lures).
- **Observation spot**: where the player stands to read the encounter before committing.
- **Objective point**: the spot allies orient on in an encounter that has allies (`ally-design` AL-1).
- **Prop**: an interactive object (door control, barrel, beacon, sentry). See [`PROPS.md`](PROPS.md).

## Encounter Principles

- **EN-1 Write the encounter down.** Space, intended problem, the tool it is built for, enemy roles (problem and key enemies), entry points, observation spot, objective point (if allies), ally job (if any), cover-to-exit distance, and the recovery after it.
- **EN-2 Readable before triggered.** The player can see the encounter from its observation spot before it starts. Ambushes are rare and survivable through spacing, not through enemies visibly hesitating (`level-design` LP-4).
- **EN-3 A positioning tool, and a second exit.** Every encounter space has at least one positioning tool; a narrow space has a second way out (`level-design` LP-14).
- **EN-4 Size it to the heroes, one screen.** Sizes come from the heroes' ranges and speeds, written as the campaign's building codes (cliff tier, choke and ramp widths in cells). A setup fits on one screen at the campaign's default zoom, two at most.
- **EN-5 Threats stay local.** Patrols don't cross into the next encounter; encounters are sealed from each other by sight. A distraction pulls only enemies inside its own encounter: a combat distraction (a taunt) everyone in a small radius, a stealth distraction (a decoy) one or two guards.
- **EN-6 Two authored states.** The group holds an aggressive territory, then falls back to a smaller one when its leader dies, its losses pass a threshold, or a hero crosses a line. Author places, not moves. This is the default enemy template; it replaces attack waves.
- **EN-7 Roles on two axes; build from roles, not bodies.** Each enemy type has one clear role on two opposed axes, by default range (melee or ranged) × mobility (holds a position or roams). Build each encounter from 2–3 roles, including a mutually covering pair (by default a ranged holder plus a melee roamer). Counters are visible and learnable.
- **EN-8 Telegraph through the world.** Threats are shown by the environment; enemies spawn from visible sources that fit them (drop pods, a Nydus, doors, warp-ins); reinforcements are announced by the standard alarm (a siren doodad, a Transmission, a minimap ping at the source). Scripted waves vary on retry through spawn slots; AI state changes are loud.
- **EN-9 Build on the kit's shape.** Each hero has a kill, a distraction and a signature. The distraction slot is stealth-tactics practice: a campaign that plays as an ARPG, won in open combat, may drop it, and its Campaign Pack says so. Combinations come from general tools that work together, not from bespoke pair actions. Wind-ups, durations and stuns last long enough for the player to switch heroes and follow up.
- **EN-10 Built for one tool, needed the first time.** Tune the encounter so its tool is needed on a first playthrough on Normal, by raising enemy toughness rather than the tool's damage. A hero-only brute force stays possible but costly, and a skilled replay may bypass it. Put chokes on the route the less mobile hero must take, so the more mobile hero's blink or jump can't skip them.
- **EN-11 Bosses end through mechanics.** Phases, arena changes, adds, environment; prefer not to build a pure boss gauntlet. Hand bosses to `boss-design`.
- **EN-12 Stealth is optional, readable and reactive.** Detection visuals match the true detection area exactly; rules are uniform per enemy type; patrols are deterministic; guards respond to events (noise, bodies, alarms) and investigate for a fixed time, then go home. On detection, slow the moment rather than rescue.
- **EN-13 The camera never hides play.** The default camera looks north from the south, so tall cliffs and doodads go on an encounter's north edge and low ones on its south. Decoration never changes pathing or sight-blocking; compare the pathing and sight layers before and after dressing where the tools can.
- **EN-14 Props are optional keys with a second way through.** A prop gives a decision, carries the campaign's prop telegraph, behaves the same everywhere, and always has a costlier second way through. One featured prop family per mission. See [`PROPS.md`](PROPS.md).

## The encounter record

Until the Blueprint has an Encounter layer, keep a mission's encounters in `missions/<id>/encounters.md`, one heading per encounter, in golden-path order:

```markdown
## <encounter id>: <name>
- Zone: <zone id>  ·  Beat: <beat id>  ·  Heroes: both | <one hero> | one + AI partner
- Problem: <one line>
- Tool: <ability, combination, prop, ally or environment>  ·  Teaches | Combines | Examines: <what>
- Enemies: <role> (<unit type> × n) ...  ·  Problem enemy: <type>  ·  Key enemy: <type> (by <tool>)
- States: aggressive <area>; fallback <area>; switch on <leader killed | losses > x% | hero past <line>>
- Space: <size in cells>, one screen: yes/no  ·  Positioning tools: <list>  ·  Exits: <n>
- Entry points: <list>  ·  Observation spot: <anchor>  ·  Objective point: <anchor> (if allies)
- Props: <prop> (second way: <how>)
- Stealth: <detection rules> | none
- Alarm and spawns: <sources>, <slots>
- Ally job: <job> | none
- Recovery after: <breather, heal, checkpoint>
- Brute-force check: <what stops the heroes from just fighting through>
```

## Plan an encounter

1. **Read its place.** The mission's encounter list (from `hero-mission-design`), the Beat, which heroes are controllable, and the kits. Done when you can say the intended problem in one line and name the tool it is built for (EN-1, EN-10).
2. **Pick the roles** (EN-7): the covering pair, the problem enemy and the key enemy, and the unit types that fill them.
3. **Shape the space** (EN-3, EN-4, EN-13): size from the kit, the positioning tools, the observation spot (EN-2), the exits, and the north-south grading. Sketch it as a Zone with `level-design`'s tools.
4. **Write the two states** and their switch (EN-6), and the spawn sources and alarm (EN-8).
5. **Add props and stealth** if the encounter uses them (EN-12, EN-14, [`PROPS.md`](PROPS.md)), each prop with its second way through.
6. **Write the brute-force check**: how the heroes would fight straight through, and what makes that costly (EN-10).
7. **Run [`CHECKS.md`](CHECKS.md)** and record the encounter. Done when every field of the record is filled or marked as not applying.

## Critique an encounter

1. **Rebuild the record** from the Blueprint and `encounters.md`. List what's missing.
2. **Walk it from the observation spot**: what the player sees, what they'd try first, and what each hero alone would do.
3. **Run [`CHECKS.md`](CHECKS.md)**.
4. **Report** under: problem and tool; space; enemies; telegraphs and stealth; props; brute force. Each finding gives what's wrong, the principle or check id, and a concrete edit.
