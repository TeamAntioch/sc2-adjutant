---
name: melee-design
description: Drafts, compiles and revises a 1v1 ladder-style StarCraft II Melee Map from four short answers, or critiques one. Use when someone wants a melee or ladder map ("I want a melee map"), when drafting or revising a Melee Map Blueprint, or when asked whether a melee map will play well.
---

Build a **Melee Map**: a 1v1 map the Galaxy Editor calls Melee, laid out the way ladder maps are. The person asking draws nothing. You ask four questions, draft half the map as a **Melee Map Blueprint** (a JSON file), compile it, revise it against the report, and hand it over. The compiler turns the half 180° to make the other half, stamps the standard bases, the main ramp and its plate, and checks the melee rules.

[`BLUEPRINT.md`](BLUEPRINT.md) is the blueprint's field reference: coordinates, zones, bases, rocks, what the compiler refuses, and a worked draft. Read it before drafting or editing a blueprint.

The principles' numbers come from 21 Blizzard ladder maps (the Ladder 2017 Season 1, 2018 Season 4 and 2019 Season 3 packs in [Blizzard/s2client-proto](https://github.com/Blizzard/s2client-proto#map-packs)) and the TeamLiquid Map Contest (TLMC) rules ([TLMC 22](https://tl.net/forum/starcraft-2/644151-team-liquid-map-contest-22-presented-by-monster-energy)). What makes a map Melee in the Editor is in sc2-adjutant's `docs/reference/melee-maps.md`.

## The compiler

- **`compile_melee_map`**, a tool on the sc2-adjutant MCP server, takes the blueprint's path and an `outputDir`. Pass both as absolute paths, because relative ones resolve against the Workspace, not the map's folder. It writes the `.SC2Map` folder and returns the distance report. The server runs only in a session opened in a Workspace. The map itself can live in any folder.
- **Outside a Workspace** the server isn't there. Run the CLI from the sc2-adjutant checkout the plugin uses: `npm run compile-melee-map -- <blueprint.json> <outputDir>`. It prints the same report.
- **A broken rule** fails the build and writes nothing. The message is a schema error naming a field, a melee rule in brackets (`[main-ramp] main main: …`), or a plain sentence about the half's shape (a lopsided centre zone, a zone turned off the map). Each one says what to change. Fix the blueprint and compile again. A broken rule is never handed over.
- **Drawing warnings** come first, as `Warning: <base>/<piece> … stands on a cliff or ramp` (or `outside its zone`) lines: a base's minerals or geysers off flat ground, or out of its zone. The map builds, but the base is broken. Fix every one, as the message says: move the base's `at`, or turn its `facing`.
- **Report warnings** come under `Warnings (n):` at the end, each labelled with its check in brackets. They cover a distance outside its band, a base missing from the progression (no natural, only one third), the base count, and air below 60% of ground. They are advice, so the map still builds.
- **The report finds the bases itself.** The natural is the base nearest the main by ground, and the third and second third are the next two. The other player's bases (the partners) count too. So any base you put near the natural can become "the third" in the report. Keep the two thirds you mean nearer than every other base.

## Leading words

- **Half**: the part of the map you draw. The compiler turns it 180° about the playable area's centre to make the other half.
- **Partner**: an object's copy in the other half. It gets the same id with `-rot` added.
- **Main**: the start base's zone, on the top level, with one way out: the main ramp down to the natural.
- **Natural**: the nearest base, one level below the main and just outside its ramp.
- **Third**: the next base taken. A good map offers two **candidate thirds** in different directions, close in distance, so the third is a real choice.
- **Ramp to ramp**: worker seconds from the top of one main ramp to the top of the other. This is the rush distance, the map's main number.
- **Attack path**: a ground route from one side's bases to the other's. Count them and look at where they meet the natural and the thirds.
- **Band**: the Standard range a distance should fall in. The report warns outside it.

## Melee Principles

- **MP-1 Ladder norms first.** Players have built their timings and walls on ladder maps. Use the standard base, the standard ramp and the Standard bands, and spend novelty on the layout of the middle.
- **MP-2 A safe start.** The main has one ground entrance, the fixed ramp. The natural sits one level down, 6-10 s away, with one choke that standard walls can close. The standard diagonal main ramp is the one every race's standard wall was tuned for, which is why the compiler fixes it.
- **MP-3 The third is a choice.** Give two candidate thirds: the nearer 10-20 s from the main, the other within about 4 s of it. The report warns on the first number against the band, and on the second only for the gap. Put them in different directions with different trade-offs: one safer but further from the middle, one closer but more exposed.
- **MP-4 Distance sets the game.** Ramp to ramp 33-38 s is TLMC's Standard band, and the ladder maps' median is 35-36 s. Shorter rewards early aggression, longer rewards greed. Hit the band before tuning anything else.
- **MP-5 More than one road.** The middle needs at least two attack paths from natural to natural, so armies can move round each other. The defender should reach between natural and third faster than an attacker can switch between them.
- **MP-6 Air is a shortcut.** Where the air distance to an early base is much shorter than the ground distance, drops and flyers can hit it before the army arrives. Keep that ratio above 60%. The report measures each main, natural and nearer third. Look at the second third's air line yourself. On the ladder maps, start-to-start air distance runs 63-91% of ground.
- **MP-7 Cliffs over mineral lines.** Low ground the enemy can stand on, right under a main's or natural's minerals, invites Reapers, Blink and Siege Tanks. Back mineral lines onto the map edge or higher ground.
- **MP-8 Features earn their place.** Rocks change a distance, and the report shows the number with the rocks up and with them down. Add one only to make a choice, such as a shortcut that opens late. Judge a map by how well each feature plays, not by how many it has.
- **MP-9 Fair by rotation.** The compiler makes the halves identical. Any zone you draw across the centre must be symmetric on its own. 17 of the 19 two-player ladder maps are rotationally symmetric; the other two mirror left to right.
- **MP-10 Readable at a glance.** High ground, chokes and bases should read from the minimap and the default camera. Give each level a clear outline, and avoid slivers of ground that look walkable but aren't.

## Build a melee map

1. **Ask the four questions, one at a time.** Wait for each answer before asking the next, and give a default with each question:
   1. *Where should the map live?* Any folder works, and no Workspace is needed. The default is a new folder in the current one, named after the map once it has a name.
   2. *What's it called?* The title becomes the map's name, and its slug becomes the blueprint `id`.
   3. *How should it look?* A tileset (offer three or four, such as `BelShir`, `KorhalCityEx2`, `Char`, `Agria`), or an Exemplar Map from the active Style Pack. For an Exemplar Map, read the pack through the server (`list_plugins`, then its knowledge resources) and take that map's tileset and lighting. With no server or no Style Pack, offer tilesets only.
   4. *Any idea for it, in a line?* This is optional, for example "a wide open middle" or "the thirds sit on high ground".

   Done when you have all four answers, the last possibly "none".
2. **Fix the defaults** without asking: Standard, two spawns, `rot180`, a 160×160 map with 136×136 playable, 14-16 bases (7 or 8 in the half), stock textures only. Say what they are in one line, and change one only if the person asks.
3. **Draft the half**, following [`BLUEPRINT.md`](BLUEPRINT.md): the main, the natural, two candidate thirds, the remaining bases, the middle and its attack paths. Shape it by the idea, if there was one. Write it as `<folder>/<id>.json`. Done when every zone has a job, the half holds 7 or 8 bases, and you can name the attack paths.
4. **Compile and revise.** Compile to `<folder>/<Title without spaces>.SC2Map`. Fix every broken rule and drawing warning first; those don't count as tries. Then revise against the report warnings (see **Revising against the report**) and compile again. Stop when no warnings remain, or after three revisions. A revision is any recompile after the first draft. Done when the build is clean and you have the last report.
5. **Hand it over.** Give:
   - the map's path;
   - the distance report as the compiler printed it;
   - every warning left, labelled **"Warning left:"**, with why it remains and what would fix it;
   - a short play sketch: where the bases are, the attack paths, and the choice of third;
   - the **walk-through checklist** below.

   Done when the person has every item, and every warning left has its reason.
6. **Revise from notes.** Turn each note into a blueprint edit, and leave the rest of the draft as it was. Ask the person to close the map in the Editor first, because rewriting a map the Editor has open can crash it. Recompile, and go through steps 4 and 5 again. Report which numbers moved. Done when every note maps to a change in the blueprint, or to a reason it can't be made.

## Revising against the report

The report times a worker at 3.9375 cells/s, so 1 s is about 4 cells walked. Ramps, corners and going round cliffs add about 10% to a straight-line estimate, and each ramp onto high ground adds a detour to and from it. Make the smallest change that moves the number, a few cells where you can. A third on high ground may need the main and natural pulled in as well. Moves that work:

- **Ramp to ramp** too short: move the natural's exit away from the centre, or put a high pod or a cliff across the straight line. Too long: open a more direct path through the middle, or bring the natural's exit toward the centre.
- **Main to natural** outside 6-10 s: move the natural's town hall toward or away from the main ramp. The main's own hall can move a cell or two toward the ramp, as long as the town-hall rule still fits it.
- **Main to third** or **second third**: move the third along its path from the natural's exit, or move the exit between the two thirds so they come out even. A third on high ground: move its ramp toward the natural's exit, or make the main and natural smaller so everything moves closer.
- **The wrong base reported as a third**: move that base further out, or bring your intended thirds closer.
- **Base count**: add or remove a base in the half. Each one counts twice.
- **Air vs ground** below 60%: lengthen the air line by moving the base, or shorten the ground path to it.

## Walk-through checklist

The person opens the map in the Galaxy Editor and plays it with Test Document:

- [ ] Map > Map Status says **Melee**.
- [ ] Main ramp: a Terran wall (Supply Depot, Barracks, Supply Depot) and a Protoss wall close the top. The unbuildable plate sits at the foot.
- [ ] Natural: the choke closes with a standard wall (Protoss Gateway, Cybernetics Core and Pylon; Zerg buildings to narrow it).
- [ ] Worker timing: send a worker from the main's town hall to the natural's. The time should be close to the report's main-to-natural figure.
- [ ] Each base: the minerals and geysers look right, and a town hall fits on the marked spot.
- [ ] Drop spots: no ground that only air can reach next to a main or natural, and no low ground under a mineral line that a Reaper or Siege Tank could use.
- [ ] Ramps and cliffs read clearly from the default camera and the minimap.

## Critique a melee map

Read the blueprint and the latest report, then go through every Melee Principle. For each one, report kept, broken (what to change in the blueprint) or not applicable. Also cover what the report can't measure:

- wall-offs at the main ramp and natural, for each race;
- whether the third is a real choice;
- who switches between natural and third faster;
- cliff exposure of mineral lines;
- high ground over bases that Siege Tanks could use;
- what each rock changes.

Done when every principle is marked and every warning is explained.
