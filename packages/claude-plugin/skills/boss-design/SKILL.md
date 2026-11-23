---
name: boss-design
description: Boss-fight design for SC2 campaign missions where the player drives a hero, alone or with an AI companion. Plans or critiques a boss's job, arena, attacks and telegraphs, phases, the companion's role, retry and finish. Use when a Mission's screenplay or Beats call for a boss or a named-enemy duel, when designing or reviewing one, or when asked whether a boss fight will play well.
---

Plan or review one boss encounter: what it is for, where it happens, every attack and its answer, how it escalates, what the companion does, and what a defeat costs. The blueprint has no boss entity yet, so the plan lives in `missions/<id>/bosses.md` (format below). The arena is a Zone; size and shape it with the `level-design` skill. Intro and kill scenes go to the `cinematography` skill. Building the fight on the engine is the `boss-build` skill.

Where the inputs are. Read the Blueprint with the sc2-adjutant MCP server's `get_blueprint` tool: the Beat the boss belongs to, its objectives, the screenplay scene around it, the hero Anchors, and the Zones. Read the heroes' kits (abilities, ranges, speeds, cloak) from the active Campaign Pack's knowledge and prompts through the server (`list_plugins`, the knowledge resources), and from the unit data when the pack has none.

The rules are this skill's **Boss Principles** (BP-1 to BP-20, below), its checks ([`CHECKS.md`](CHECKS.md), cited by id) and its mechanic catalog ([`MECHANICS.md`](MECHANICS.md)). [`PRINCIPLES.md`](PRINCIPLES.md) gives each principle's backing: the Blizzard campaign fights (Warcraft III, StarCraft II, Nova Covert Ops) and the published design writing it rests on. When a call is close, read the backing.

**Corrections go into the guidance.** When the author corrects a boss design, put the lesson into this skill in the same change, and tell them where it went.

## Leading words

- **Job**: what the boss is for. A *spectacle* shows off the heroes' kit, a *story* boss lands a plot beat, an *exam* tests mastery. Campaign bosses on Normal are spectacle or story; exams belong on Hard and in optional objectives.
- **Hook**: the one mechanic a player will describe afterwards, drawn from the boss's fiction. The arena is built round it.
- **Attack**: one thing the boss does that can hurt. Every attack has a *telegraph* and an *answer*.
- **Telegraph**: the warning before an attack lands, on several channels at once: a cast bar or wind-up in data, a ground marker, a sound, and a voice line the first time.
- **Answer**: what the player does about an attack: move, a named hero ability, or the companion. An attack with no answer is a tax.
- **Safe ground**: where the answer puts the hero. It moves between patterns.
- **Opening**: a window when the boss can be hurt, or hurt more. It is as clearly signalled as an attack.
- **Phase**: a stretch of the fight with its own attack set. Phases change rules, not just numbers. A phase starts at a *health cut* (with a floor, so burst damage can't skip it) or at an *objective gate* (break the projectors, fetch the key).
- **Adds**: units the boss brings in. They are the main difficulty knob after the boss's life, and the companion's natural target.
- **Companion**: the AI-driven ally hero beside the player's hero, when the Mission has one. Its **job** in the fight is something it always succeeds at and the player can see.
- **Retry cost**: the minutes a defeat sends the player back. Cut it to the fight itself.
- **Finish**: how the boss leaves play: killed, stopped at low life so a scene takes the kill, captured, or outlasted.

## Boss Principles

- **BP-1 Pick the job first.** Spectacle, story or exam decides how hard it is and how long it runs (PRINCIPLES.md).
- **BP-2 Bosses are rare.** Blizzard's campaigns average well under one per mission. Ask whether the Beat needs a boss, a named elite inside a wave, or a non-boss climax (a gauntlet, a chase, a race, a survival clock).
- **BP-3 One hook from the fiction**, and the arena built round it.
- **BP-4 Every attack has a telegraph and an answer.** Write the boss's pattern beside the player's reactions ("slam, slam, opening" against "step out, step out, strike"). A row with no reaction is a design bug.
- **BP-5 Telegraph twice, in one vocabulary.** A wind-up or cast bar in data, plus a ground marker in script, with the same shape and colour meaning the same thing in every mission. Tie the danger to the boss's body and facing.
- **BP-6 Size telegraphs for click-to-move.** Lethal attacks warn at least 2 s at Faster, chip damage about 1.5 s, and every marker's radius comes from the heroes' real speeds. Bigger attacks get longer wind-ups.
- **BP-7 No unwarned one-shots.** The biggest Normal hit takes at most about half a hero's life and shields. Failure spreads over seconds, and a dead player can say what killed them.
- **BP-8 Make the opening as obvious as the danger.** A missed attack teaches itself; a missed opening teaches nothing. Every opening gets an actor state and a sound, and hits during invulnerability visibly fail. Prefer a failure in the boss's own fiction to a generic deflect: a quick boss evades with a showy blink, so the immunity reads as her skill, not as a rule.
- **BP-9 Threaten about half the arena, and move the safe ground.** A safe spot that never moves ends the tension once found. Leave room for error round every safe area.
- **BP-10 Teach before it can kill.** Each mechanic appears earlier in the mission or in the boss's first phase at low stakes. The first phase is the easiest. A hero ability the mission just granted works on the boss. A tease met outside the fight (the boss passing through a raid) gets the camera: the RTS player may be looking elsewhere, so a few seconds of in-game cutscene frame the move they must remember.
- **BP-11 Two or three phases that change the rules.** New attacks, a changed arena (a hazard switching on, doors closing), adds, a relocation. Changing the arena is often cheaper than changing the boss. The last stretch is a peak and a release, not the longest phase.
- **BP-12 Gate phases on objectives as often as on health.** An objective gives the companion and the player a job besides hitting the boss.
- **BP-13 The companion opens windows; the player passes the test.** Dodges, the decisive interrupt, soaks and kill order are the player's. The companion does steady damage, kills adds, drops pickups, backs up interrupts and calls out each attack the first time. It never takes the kill.
- **BP-14 The companion survives by rule, not by brilliance.** The boss publishes its danger zones and safe points for the companion to read. The companion takes reduced area damage, is moved to safe ground by script for each lethal attack, and is downed rather than killed. Its death never fails a normal mission.
- **BP-15 The boss notices the companion, but isn't balanced round it.** It mostly targets the player's hero, sometimes the companion, and nearest-unit cones keep the companion behind the hero.
- **BP-16 Run the boss from script, predictably.** One controller per boss picks attacks by range, region and timer; the engine AI is off. Rhythm comes from alternation the player can learn, not uniform randomness.
- **BP-17 Make retry cheap.** Autosave as the boss appears, play the intro once, skip it on retry, and show how far the attempt got. Consider a hidden checkpoint that resets the arena instead of a mission restart.
- **BP-18 Show what's true.** A boss bar only for a single readable boss, with ticks at the phase cuts, hidden while the boss can't be hurt. Invulnerability is always visible.
- **BP-19 Finish on purpose.** Story bosses stop at low life so a scene takes the kill. Kill the boss's adds with it, and let nothing hurt the heroes after the win.
- **BP-20 Difficulty through numbers, plus one mechanic.** Life, add counts and cadence scale by difficulty; Hard adds one whole attack. A recurring boss changes arena between meetings and saves one phase for the last.

## Plan a boss

1. **Read the fight's place in the mission.** Read the Beat, objectives, screenplay scene and the heroes' kits, and say whether a companion is present. List every mismatch between the screenplay and the blueprint (an arena, an add or a prop the scene needs that the map lacks); these go to the author. Done when you can say in one sentence what the fight tests or celebrates and how it ends.
2. **Choose the job and the form.** Name the job (BP-1). Decide whether it is a boss at all (BP-2), then pick a starting archetype from [`MECHANICS.md`](MECHANICS.md#archetypes) and the hook (BP-3). Say why a smaller form won't do.
3. **Sketch the arena** with the `level-design` skill: its Zone, size in hero travel time, cover, hazards, entrances, and where adds come from. Done when the hook has ground to act on and the safe ground can move.
4. **Write the attack table** (format below): every attack with its telegraph, answer, safe ground, who it punishes (the hero in close, the hero at range, whoever stands still) and the companion's response. Draw from [`MECHANICS.md`](MECHANICS.md). Done when every row has a telegraph, an answer and a companion response.
5. **Write the phases**: two or three, each with its trigger (health cut with floor, or objective gate), what changes, its adds, and its opening. Done when each phase changes a rule (BP-11).
6. **Give the companion its job** (BP-13 to BP-15): one or two jobs, its survival rules, the hints the boss publishes for it, and what it does in each phase. Skip this step when the hero fights alone, and say so.
7. **Write retry, finish and difficulty**: the autosave point, what a defeat resets, the intro and kill scenes for the `cinematography` skill, and the per-difficulty numbers and Hard's extra attack.
8. **Apply every check in [`CHECKS.md`](CHECKS.md).** Done when each check is recorded as passed, fixed, an issue or intended.
9. **Present the plan**: a short play-by-play of a successful fight, the attack table, the phases, the companion's job, the open questions and the trade-offs. Done when the author has approved it and it is in `bosses.md`.

## Critique a boss

1. **Read the intent**: the screenplay, the Beat and the plan in `bosses.md` if there is one. List mismatches between what the screenplay asks for and what the fight stages. These lead the report.
2. **Rebuild the attack table** from what was built: the boss's triggers and its unit, ability and effect data. Note each attack's real wind-up and marker, not the intended one.
3. **Play it or read a playtest.** Ask a tester what killed them, and what they thought the boss was doing. Their model of the pattern is what the fight teaches.
4. **Apply every check in [`CHECKS.md`](CHECKS.md).**
5. **Report** under four headings:
   - Mismatches and open questions
   - Reading (can the player see each attack, its answer and each opening)
   - Fairness and pacing (damage, phases, retry cost)
   - Companion (its job, its survival, whether it carries or idles)

   Each finding gives the attack or trigger, what's wrong, the principle or check id, and a concrete change in the leading words: "give the slam a 2 s ground marker and move its safe ground to the far pillar in phase 2", not "make it fairer". Done when every check is accounted for.

## The plan

`missions/<id>/bosses.md` holds one section per boss:

```markdown
## <boss id>: <one-line hook>
- Beat / objective: <beat id> / <objective id>. Job: story. Archetype: rusher.
- Arena: <zone id>, about 12 s across at hero speed; pillars on the east side; adds from the two north gates
- Companion: present. Job: kills the hatchlings; backs up the interrupt. Survival: half area damage, downed 20 s
- Phases: 1 at 100-70 % (teach), 2 at 70-35 % with floor at 70 % (floor electrified), 3 at 35-0 % (no adds, signature attack)
- Retry: autosave on arena entry; defeat resets the arena and revives both heroes at the door. Intro once.
- Finish: stopped at 5 % life; kill scene. Adds die with it.
- Difficulty: life 4000/5000/6500/8000; Hard adds the chase beam

| # | Attack | Phase | Telegraph | Answer | Safe ground | Punishes | Companion |
|---|--------|-------|-----------|--------|-------------|----------|-----------|
| 1 | Slam | 1-3 | 2 s wind-up, red circle r 3 | step out | outside the circle | the hero in close | steps out by script |
```
