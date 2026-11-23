# Why each principle holds

The backing for each Layout Principle in SKILL.md and each pacing check in [`JUDGEMENT-CHECKS.md`](JUDGEMENT-CHECKS.md). Read an entry when a finding needs its reasoning or when a call is close.

- **Calibration** names the Blizzard missions that follow or bend the rule, with the numbers measured on them: The Evacuation, Zero Hour, The Devil's Playground and Media Blitz, one per calibrated archetype.
- **Origin** names a well-known public idea the rule restates for an overhead RTS camera, where one fits.

A rule a Blizzard mission bends on purpose is a starting point, not a pass mark: when a design breaks one deliberately, keep the design and record why.

## Layout Principles

**LP-1 Mechanic first.**
- Calibration: The Evacuation's road is a chain of three named chokes, each with a defensive feature. The Devil's Playground's lava needs its high and low ground; it's the whole mission.
- Origin: "form follows function" (Louis Sullivan). Blizzard's own account of building The Evacuation starts every mission by prototyping its core mechanic, in several versions of the map ([Singleplayer Storytelling](https://www.moddb.com/games/starcraft-ii/features/singleplayer-storytelling), 2010).

**LP-2 Graph, then polygons, then population.**
- Origin: the architect's parti and bubble diagram, and the blockout or graybox pass that level designers make before art. The Zone graph is our bubble diagram.

**LP-3 Teach in order.**
- Calibration: The Evacuation introduces exactly one new threat per convoy, with a tip in the quiet before each. Zero Hour's intro shows zerglings overrunning marines before the player meets them. Media Blitz breaks the demonstration for its kill teams, which arrive with only a Transmission. The checker's `teaching` check spaces introductions as Blizzard does.
- Origin: kishōtenketsu, the four-part introduce, develop, twist, conclude structure, as Nintendo's designers have described it for *Super Mario 3D Land*.

**LP-4 Read before committing.**
- Calibration: all four missions preview their goals by script (camera pans, revealers, pings, an opening tour), and terrain overlooks are rare. Media Blitz's seven base ramps all climb from low ground the enemy overlooks; the act-1 tour previews them instead. That's why the checker's `readable-approach` accepts a Beat's `reveals`.
- Origin: Jay Appleton's prospect–refuge theory (*The Experience of Landscape*, 1975): people favour places that offer both an open view (prospect) and somewhere to hide (refuge), so they can see without being seen.

**LP-5 Refuge, then prospect.**
- Calibration: in The Devil's Playground every low-ground field borders high ground, so refuges overlook prospects, 18–38 s apart. The Evacuation's bunkers sit 56 cells (about 40 s of convoy) apart.
- Origin: Appleton's prospect–refuge theory, applied to the ground. Appleton's prospect is the view; here the prospect is the open, exposed ground that view takes in, and the refuge is the base, a regroup pocket or high ground that looks out over it.

**LP-6 Pace through contrast.**
- Calibration: The Evacuation's road is loud during every convoy, and its quiet is the 72–82 s gap between convoys: contrast in time, not space. Media Blitz's connecting streets are the quiet Zones between its strongholds.
- Origin: push and pull, the level designer's habit of following an intense space with a calmer one.

**LP-7 Enemies are walls.**
- Calibration: The Devil's Playground's real gates are its Zerg towns, across the routes to the far fields. Zero Hour puts burrowed ambushes in each field on the way to its bonus sites. In an escort the walls come to the road: The Evacuation wakes burrowed groups at the chokes as the convoy passes. The checker routes round enemy-held Zones for this reason (ADR 0003).

**LP-8 Layered stronghold.**
- Calibration: every Media Blitz core sits behind two enemy-held Zones (an outpost, then a front yard), and threat rises to the core, or nearly (Tower 3's core is 0.88 of its yard).
- Origin: defence in depth, as in a concentric castle.

**LP-9 Show, then withhold.**
- Calibration: The Evacuation's briefing tours town, road, junction and starport before play. Media Blitz's first act is a hero raid that borders every base the later Beats use, and act 2 shows the cores again with beacons and pings.
- Origin: *miegakure*, "hide and reveal", from Japanese garden design: a view glimpsed and then hidden draws people on.

**LP-10 Cue every branch, price every risk.**
- Calibration: Media Blitz repeats Mengsk statues at its street junctions as landmarks and numbers its pings. Zero Hour gives each rebel site shared vision, a minimap ping and an objective ping when it appears. The Evacuation fires a tip as the player approaches each chrysalis site.
- Origin: Kevin Lynch's *The Image of the City* (1960): people find their way by paths, edges, nodes and landmarks. Fog makes every unscouted branch uncertain; the rule is against arbitrary uncertainty, not hidden information.

**LP-11 Refuges stay safe.**
- Calibration: nothing attacks The Evacuation's colony, and its tips land in the quiet between waves. Zero Hour's tips play during the 70 s dig-in. Hold inverts the rule, since Zero Hour's base is breached every wave, and a base-building assault like Media Blitz attacks its base on a schedule. The Devil's Playground bends it on purpose: a small one-shot ambush on each neutral refuge teaches "clear your refuge before the surge".

**LP-12 Rewards one step off the path.**
- Calibration: Zero Hour's ledges are one ramp off the fields in front of the bridges, while its crossroads site sits deeper, under enemy high ground, as the riskiest bonus. The Evacuation's chrysalis sites are one Zone off the road or beside it. Media Blitz has one uncued true secret.

**LP-13 Open the map gradually.**
- Calibration: Zero Hour opens threat directions and bonus sites one at a time, never more than the base plus one new site. The Devil's Playground reveals exactly three fields per wave. Media Blitz runs three cores at once, at the rule's limit. The checker's `goal-spread` and `beat-gating` read this rule.

**LP-14 Real alternatives.**
- Calibration: Media Blitz is a loop-rich grid with two or three ramps into each enemy base. The Evacuation's road is linear by design, but the terrain gives the army flanking loops round two of its chokes.
- Origin: Umberto Eco's three kinds of labyrinth (linear labyrinth, maze, net) give the vocabulary for a graph's shape.

**LP-15 Size for the army, measure in time.**
- Calibration: The Evacuation's road runs about 140 cells, with 3 named chokes, 18, 18 and 12–14 cells wide; 2–4 chokes of 12–18 cells is the proposed Escort band. A marine walks it in about 45 s while the convoy takes about 100 s, which is why escort goals are timed at the escorted unit's speed.

**LP-16 The ground tells the truth.**
- Calibration: the checker's route checks trust declared Connections, so `terrain-agreement` compares them with the terrain first. Media Blitz's dressing matches each Zone's function: a parade ground with civilians and props.
- Origin: campaign-map makers' "malign" doodads, such as bones, that mark hazard ground ([A Guide to Creating Campaign Maps](https://www.moddb.com/tutorials/a-guide-to-campaign-maps)).

**LP-17 Every Zone has a job.**
- Calibration: Zero Hour's open fields have a chasm pit, huts and a rock. Media Blitz's courtyard is a declared `arena`. In The Devil's Playground every Zone holds something. The checker's `dead-space` reads this rule.

## Pacing checks

**PC-1 Callout spacing.** Media Blitz breaks it inside each stronghold (outpost, yard and core are adjacent loud Zones) and keeps it between them. It doesn't fit an escort, where the whole road is loud during a convoy.

**PC-2 Refuge and prospect alternation.** The Evacuation has three prospects in a row between its bunkers, but only about 40 s of convoy, so judge the run by travel time, not Zone count. Media Blitz's base is its only refuge, and the return trip is 45 s or less.

**PC-3 Prep before climax.** Each Media Blitz push starts from the base.

**PC-4 Reward after peak.** Rewards vary in kind: an expansion, a cache, reinforcements, an unlock, a story Transmission.

**PC-5 Start Zone.** Zero Hour's first conflict comes at 70 s, about 25 s of travel from the nydus. Media Blitz's act 2 meets its first conflict 16–20 s away and its first wave about 4 minutes in; its act 1 opens on conflict deliberately.

**PC-6 Timeline.** Zero Hour leaves no ground-wave gap longer than about 150 s, warns at 10, 5, 2 and 1 minutes, and ends on a scripted crescendo of 20 s waves. The Evacuation's quiet between convoys measured 72–82 s on Normal; 60–110 s is the proposed Escort band.

## The review report

The critique's three headings (function, usability, delight) echo Vitruvius's firmness, commodity and delight.
