---
name: hero-mission-design
description: Mission design for hero-centred SC2 campaign missions (installation missions), where the player drives one or two heroes and at most a small squad, with few or no AI allies and no base. Plans or critiques the mission as a chain of encounters, its pacing, teaching order, recovery, checkpoints and failure, approach forks, optional content and per-mission campaign sheet. Use when a Mission has no base to build, when its heroes carry the play, when planning or reviewing a hero mission's structure, or when asked whether a hero mission will play well.
---

Plan or review a hero mission's structure: what its encounters are, in what order, how the player recovers between them, what a defeat costs, what is optional, and how it sits in the campaign. Single encounters are the `encounter-design` skill; AI allies are `ally-design`; bosses are `boss-design`; the Zones themselves are drawn with the `level-design` skill's tools and procedure, with this skill's principles taking over where they differ (below).

Where the inputs are. Read the Blueprint with the sc2-adjutant MCP server's `get_blueprint` tool: its Beats, objectives, Mechanics, Zones and screenplay. Read the active Campaign Pack's knowledge through the server (`list_plugins`, then the knowledge resources `sc2-adjutant://plugins/<plugin>/knowledge/<id>`): the heroes' kits and the campaign's settings for hero missions (mission length, hub shape, which recovery and failure models it uses, what it has ruled out). **The pack's settings win over this skill's defaults**; where the pack is silent, use the defaults below and say so.

The rules are this skill's **Hero-mission Principles** (HM-1 to HM-25, below) and its checks ([`CHECKS.md`](CHECKS.md), cited by id). [`PRINCIPLES.md`](PRINCIPLES.md) gives each principle's backing: Blizzard's hero missions, the squad-tactics and companion games, and published design talks. Its evidence ratings matter: a *thin* or *our inference* principle is a default to try, not a rule to defend.

**Corrections go into the guidance.** When the author corrects a hero-mission design, put the general lesson into this skill and anything campaign-specific into the Campaign Pack's knowledge, in the same change, and tell them where it went.

## Leading words

- **Installation mission**: a mission with no base or economy, carried by heroes and at most a small squad. Blizzard's own term. Until the Blueprint has an `installation` archetype, declare `commando` and read its bands loosely.
- **Encounter**: the authoring unit inside a Zone: a named space, an enemy mix and a one-line intended problem. Designed with `encounter-design`.
- **Breather**: a space with no fight, between encounters: recovery, loot, lore, dialogue.
- **Recovery**: whatever restores the heroes between encounters: a full heal, a heal station with a visible recharge, a capturable beacon, kill drops.
- **Golden path**: the critical path from start to goal. Forks and side spaces hang off it.
- **Mode shift**: the one change of play in a mission's second half: escape, chase, defend-moving, backtrack under pressure, split heroes.
- **Approach fork**: a choice between two ways through (stealth or loud, two routes, two tools) that the fiction and the briefing name.
- **Power gradient**: what the map hands out instead of resources: squad grants, side rewards, beacons and hero growth along the path.
- **Campaign sheet**: one row per mission: setting, objective type, high-impact feature, featured prop family. Linted for back-to-back repeats.

## Hero-mission Principles

### Structure and pacing

- **HM-1 Mechanic from the fantasy, then a chain of encounters.** Pick the mission's one dominant mechanic from what the heroes are (their fantasy), then author the mission as 6–10 named encounters. Prior work stopped at Zones and Beats; the encounter is the finer unit.
- **HM-2 A small hub, visible forks, hidden linearity.** Default shape: a small hub with 2–3 spokes, each forking visibly, and about two forks per mission that the team will actually test. Fight spaces inside a spoke are interconnected, not corridors. At most one open zone per act built on one of Serr's layouts (symmetric, concentric, node, field).
- **HM-3 Teach, combine, examine.** Each hero ability gets its own encounter (prompt, a target built for it, practice), then appears in combination, and each tool's arc ends in a "final exam" that combines what was taught (`level-design` LP-3).
- **HM-4 No two fights without a reason.** A breather between encounters, filled with loot, lore, dialogue or recovery. A fight followed by a fight is a warning to justify, not an error.
- **HM-5 One mode shift, in the second half, with a real decision.** Escape: which route, short and dangerous or long and safe. Chase: when to spend abilities slowing the pursuer. Defend-moving: where to stand as the target moves, and what to let through. Backtrack under pressure: which shortcut to open or what to abandon. Split heroes: when to switch, and which side to let slip.
- **HM-6 Urgency from the situation, not a clock.** A pursuer, a collapse, a patrol cycle, rewards placed ahead. A countdown only where progress extends it or it serves a rescue the player cares about.
- **HM-7 A short critical path, optional stretch.** Default 15–25 minutes on the golden path and about 10 minutes of optional content, measured by logged internal playthroughs.
- **HM-8 Escalate.** Within the mission and across the campaign: start small; squad size, ally competence and set-piece scale grow. A story stretch may weaken allies on purpose.
- **HM-9 Plan across the campaign.** Keep the campaign sheet. Never repeat a setting or objective type back to back, introduce one high-impact feature at a time, keep story climaxes mechanically familiar, and announce any removed tool in the briefing.

### Hero power

- **HM-10 Cap power below "solo the map".** The heroes' ceiling sits where the mission's other tools still matter. Hero mobility (blink, cliff jump) has a real cost, and a hero never covers a missing squad role. Limit what the heroes can gather with a rule of play, not a bare count: a cap with no reason in the world reads as artificial. Let the limit come from what holding more costs, so taking more is a skill the player can show and losing some sets them back without stranding them.
- **HM-11 Overpowered moments are set-pieces.** One-off, framed by the story, never the baseline.
- **HM-12 The squad comes from the script.** Fixed per mission unless the pack says otherwise, capped by type, refills by scenario, topped up before set-pieces. Many hero missions have no squad at all; then skip the squad rules.
- **HM-13 Choices are informed, tried and correctable.** Brief the threats before a loadout pick, give an exclusive upgrade a trial encounter, and let changes happen where the pack allows.
- **HM-14 The heroes alone can always win.** Squad units, allies and props widen the options, never gate the win, on every difficulty.

### Recovery, checkpoints and failure

- **HM-15 Recovery between encounters, as geography.** Put it in breathers, keep those spaces safe until a Beat breaks one on purpose, and make the next recovery point visible from the current one.
- **HM-16 Every pickup is a decision.** Kill drops keep a small force aggressive; placed pickups sit where taking them means leaving safety; consumables are ones the fights genuinely need.
- **HM-17 Fail on the pair, checkpoint anyway.** With two controllable heroes, the downed hero waits for the partner's revive, control passes to the standing hero, and the mission fails only when both are down. With one controllable hero, checkpoint generously. Checkpoint after major encounters even where free saving exists, and keep checkpoints separate from recovery points unless the pack says otherwise.
- **HM-18 Slow down; never a flaky net.** On detection or ambush, slow the moment (slow motion, a grace period) rather than rescue the player; never demand precise input from a panicking player. Against soft-locks, use invisible relief on the easier difficulties, never a safety net that sometimes fails. Where AI allies fight beside the heroes, route the relief through them (enemies target the allies more, the allies take less damage), so the numbers stay tense while the pressure eases; without allies, ease the enemy's reinforcements while a hero is down.
- **HM-19 Difficulty through composition.** Harder difficulties swap units (a caster for a ranged unit, an elite affix), make enemies cloak, focus the heroes and flank allies. Not more hit points.

### Choice and optional content

- **HM-20 One meaningful approach fork per mission,** named in the fiction and the briefing. Progress is never gated on information the player may have missed.
- **HM-21 Side spaces pay in power.** Off the golden path but visible from it, about one side reward per two encounters, paying in gear, ally upgrades or hero growth rather than score. Missable rewards are nice-to-have. Cap rewards so farming never beats the objective; camps don't respawn unless the fiction says they would (`level-design` LP-12).
- **HM-22 Optional challenges teach replays.** Written during map design, scoring approach and preservation rather than time, without spoiling the mechanic.

### Readability and reuse

- **HM-23 Art for orientation, detail where attention is.** One landmark per Zone, distinct silhouettes and ground per sub-area, an eye-catcher at the next goal; the art budget goes on the golden path, encounter spaces and side-reward spots. Heroes read at default zoom: scale the models up modestly first, and change the zoom only if that isn't enough.
- **HM-24 Dialogue: gameplay first, plot in cinematics.** In-mission lines support play first, then character and world; plot goes to cutscenes. Banter goes in breathers after hard encounters, the hero who triggers a line speaks first, lines gate on objective progress with a cooldown, and the channel is Transmissions, never camera pans. Region-entry lines only for key areas. Fully voice a few exchanges rather than lightly voice many.
- **HM-25 Reuse encounters, never structure.** Draw encounters from the shared encounter library (teach room, fork, two-state encounter, heal node, squad grant, side reward, ally moment, ally trigger, mode shift, capstone); never repeat a mission's structure.

## What changes from `level-design`

`level-design`'s tools, procedure and checker still apply. These of its rules change for a hero mission:

- **Travel is in hero-seconds** between encounters and recovery, not worker-seconds against wave intervals (LP-15).
- **Attack waves mostly drop out.** Two-state encounters replace them (`encounter-design` EN-6); `threat-paths` and the Hold bands apply only to a mode shift that defends.
- **The resource gradient becomes the power gradient** (HM-15, HM-16, HM-21).
- **Chokes are hero positioning tools in every encounter**, not 2–4 base entrances (`encounter-design` EN-3).
- **Enemy bases and the ~120-unit strength target don't apply** unless the mission has a base to assault. Size enemies per encounter, by role (`encounter-design` EN-7).
- **Escorts flip.** The escort waits for the hero (`ally-design` AL-9), when the campaign has escorts at all.
- **Stage by area with bounds.** A hero mission plays one encounter space at a time, so bound each one (ADR-0015). Give the Beat that opens a space a `playable` round its Zones, so heroes and enemies can't wander past it. Give it `camera.bounds` where the space should feel close, such as a stealth room or a corridor.
  - The camera bounds bound where the camera aims, not where the heroes walk. Leave the walkable route up to about 7 cells past them.
  - Where the space's opening scene pans in from the last one, set `camera.transition: true`.
  - Open `"entire"` round a cutscene that films outside the space, and keep each checkpoint's cameras inside the bounds of the Beat it plays in.

## Plan a hero mission

1. **Read the mission's place.** Read the Beats, objectives, Mechanics and screenplay, the heroes' kits and the pack's hero-mission settings. Say which heroes are controllable in each Beat (both, one, or one with the other AI-driven), and whether there is a squad or allies. Done when you can name the dominant mechanic and say what the mission celebrates (HM-1).
2. **Fill the campaign sheet row**: setting, objective type, high-impact feature, featured prop family. Compare with the neighbouring missions' rows and flag any repeat (HM-9).
3. **Choose the shape** (HM-2): the hub, its spokes, where the two forks sit, and whether this is the act's one open zone. Choose the approach fork (HM-20) and the mode shift, if any (HM-5).
4. **List the encounters in order**, each with its one-line problem, the tool it is built for, and what it teaches, combines or examines (HM-3). Put a breather after each (HM-4) and recovery where the pack's model puts it (HM-15). Mark side spaces and their rewards (HM-21). Done when the list runs from start to goal with its forks.
5. **Write the failure model**: what a downed hero does, where the checkpoints are, what the relief valve is on the easier difficulties, and what slows down on detection (HM-17, HM-18).
6. **Hand the encounters on.** Draw the Zones with `level-design`'s procedure (with the changes above), design each encounter with `encounter-design`, its allies with `ally-design`, and any boss with `boss-design`. Until the Blueprint has an Encounter layer, record the list in `missions/<id>/encounters.md` (format in `encounter-design`).
7. **Run [`CHECKS.md`](CHECKS.md)** and present the plan: the shape, the encounter list with a one-line play narrative each, the failure model, the estimated golden-path time, and the open questions. Done when the author has approved the encounter list.

## Critique a hero mission

1. **Read the intent** as in step 1 above. List every mismatch between the screenplay, the pack's settings and the Blueprint (a squad the pack rules out, a timer the screenplay doesn't justify, an escort in a campaign without escorts). These lead the report.
2. **Rebuild the encounter list** from the Blueprint and `encounters.md`, and estimate the golden-path time in hero-seconds.
3. **Run `level-design`'s checker** (`check_layout`, `preview`) and read its warnings through the changes above.
4. **Work through [`CHECKS.md`](CHECKS.md)**, then each encounter with `encounter-design`'s checks.
5. **Report** under: mismatches and open questions; structure and pacing; hero power; recovery and failure; choice and optional content; readability. Each finding gives what's wrong, the principle or check id, and a concrete edit or the question that decides it.
