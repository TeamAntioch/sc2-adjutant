# StarCraft II Campaign Mapper

Co-designs and compiles StarCraft II single-player campaign missions from narrative inputs and setting descriptions into playable map packages.

## Language

### Campaign & Narrative

**Campaign**:
A collection of missions that share story continuity, recurring characters, custom assets, and shared gameplay systems.
_Avoid_: Mod, project

**Campaign Mod**:
The shared dependency package that holds a Campaign's game data, characters, hero units, conversations, cutscenes, UI and reusable trigger libraries, referenced by each Mission in the Campaign. It holds no art or audio files of its own; those come from its Asset Mod.
_Avoid_: Base mod, dependency archive, data mod

**Asset Mod**:
The dependency package that holds a Campaign's own art and audio files, such as models, textures, portraits, voices, sounds and music, and nothing else. The Campaign Mod depends on it.
_Avoid_: Art mod, assets package

**Asset Source**:
Where one of an Asset Mod's files comes from, as its Mod Blueprint declares it: a file kept in the Workspace, a community asset fetched by its address with its licence, a stock file exported from each machine's game, a placeholder generated for it (such as a synthesized voice line), or a file derived from another Asset Source (such as a recoloured texture).
_Avoid_: Asset origin, asset reference, raw asset

**Mission**:
A single playable scenario within a Campaign, with its own setting, spatial layout, mechanics, objectives, and narrative flow.
_Avoid_: Level, stage

**Screenplay**:
The author-written narrative input for a Mission, or for a Campaign Mod's interludes and hub chats, containing scenes, dialogue lines, speaker cues, and stage directions.
_Avoid_: Script, story doc

**Screenplay Source**:
Where a Campaign keeps its Screenplays and how to fetch (and optionally edit) them, so that each arrives as a Screenplay the mapper can read; a Campaign with no Screenplay Source keeps its Screenplays as files in the Workspace.
_Avoid_: Script source, script DB, script repo

**Transmission**:
The in-game delivery of a dialogue line from a Screenplay, pairing a character portrait, subtitle text, and voice audio with a trigger event.
_Avoid_: Dialog popup, voiceover, chat message

**In-Game Cutscene**:
A scripted narrative sequence staged directly on the Mission's terrain using camera moves, unit orders, animations, and Transmissions, paired with a cleanup state so the player can skip it safely.
_Avoid_: Movie, prerendered cinematic

**Trigger Scene**:
An In-Game Cutscene compiled from a shot list, standing in for a Screenplay scene: it cuts and moves between the Mission's camera Anchors under the scene's lines, played as Transmissions, in Cinematic Mode on the map, and plays on the scene's cue in place of its bare Transmissions, with one skip and one cleanup shared with the scenes chained to it.
_Avoid_: Cutscene (for this alone), Model A (the research note's name for the tier)

**Scene Chain**:
The run of Screenplay scenes one cue plays back to back, as the Trigger Scenes and Cinematics among them share a skip and a cleanup (ADR 0012): which scene hands on to the next, which hands back to the Mission, which takes over from a Trigger Scene before it, and which victory outro ends the run. An entry that plays apart (delayed, or after another's) ends the run before it. The compile and the trigger-scene checks ask the one chain, so they agree on which scene hands back to the player.
_Avoid_: scene sequence

**Cinematic**:
A Cutscene Editor timeline compiled from a shot list, standing in for a Screenplay scene: it plays that scene's lines on a cast placed on one or more Sets, cut to the lines, and plays on the scene's cue in place of its Transmissions. A Mission's compiles into its Map Package; a Campaign Mod's hub chats and interludes compile into the mod's Cutscenes, in place of their hand-built scenes.
_Avoid_: Cutscene (for this alone), movie, scene

**Set**:
A location a Cinematic is filmed in, kept as data in the Workspace: its pieces, the marks where characters stand, its named cameras, its Lights and its ambience, in the set's own frame. Usually imported from an existing Cutscene Editor file by its name in the set catalog, with that file recorded as its source.
_Avoid_: Stage, room, backdrop (a backdrop is per shot)

**Model Guide**:
One model's curated description for casting it in a Cinematic: the Character it plays, if any, its Animation Families with what each shows and when to use it, the one it stands and talks in by default, its notable single animations, and the animations to avoid and why. Each part says whether the author confirmed it or an agent described it from watching the clip. Core keeps guides for the game's models and a Workspace for its Campaign Mod's; a Workspace's guide for a model replaces core's.
_Avoid_: Character sheet, anim list, animation catalog

**Animation Family**:
A model's animations that share their other words, numbered variants aside, such as `Stand Victory B`, `Talk Victory B` and `Walk Victory B`. A cast member stands, talks and walks in one family.
_Avoid_: Stance, pose, anim set

**Set Cutscene**:
A Campaign Mod's Set written back as a Cutscene Editor file with no shots, so the author can open the room in the Editor: everything the Set holds, where its source file had it. It replaces a hand-built set file under the Equivalence Check, and an Editor change to it comes back into the Set through sync.
_Avoid_: Set file, room cutscene

### Mission Design & Compilation

**Mission Blueprint**:
The structured specification of a Mission—covering spatial layout, terrain palette, placed entities, mechanics, objectives, and dialogue wiring—that is co-designed with the author and compiled into a Map Package.
_Avoid_: Manifest, config, map spec

**Co-design Stage**:
One of the four agreed steps of building a Mission with its author (Beats and Mechanics, geography sketch, palette and placement, dialogue and compilation), each closed by the author's explicit sign-off before the next begins. When the author redoes a signed-off Stage's design, the Stage is reopened: its sign-off and every later one are kept as superseded, and each Stage from there is signed off again. A sign-off records the files it covers (the Blueprint, and from Stage 3 the Map Package bar its `Assets`, minimap and the two files an Editor save rewrites) with their fingerprints, and `get_session_state` reports it stale when one has changed since; stale is a prompt to ask the author, and the sign-off stands until they reopen the Stage. "Stage" on its own always means this, never a Mission or a Beat.
_Avoid_: Step, phase, milestone

**Map Package**:
The unpacked StarCraft II map directory that the Galaxy Editor opens, validates, and saves directly.
_Avoid_: Map file, MPQ archive, output folder

**Compiled Content**:
The parts of a Mission's Map Package that its Mission Blueprint owns, or of a mod that its Mod Blueprint owns, written afresh by every compile.
_Avoid_: Generated content, Blueprint layer

**Mod Blueprint**:
The structured specification of a Campaign Mod or an Asset Mod, kept in the Workspace, that owns the mod's Compiled Content: for a Campaign Mod its game data, characters, conversations, cutscenes and UI; for an Asset Mod the Asset Source of each of its files.
_Avoid_: Mod spec, mod config

**Kept Content**:
The parts of a Mission's Map Package, or of a Campaign Mod or Asset Mod, that the package itself owns, such as hand-sculpted terrain, Editor-placed doodads, hand-made triggers, cutscenes or game data. A compile leaves them as it found them, and they are edited in place. A part may stay Kept Content for good; it becomes Compiled Content only when a change calls for the Blueprint.
_Avoid_: Locked layer, legacy content, base map

**Trigger Folder**:
A folder in the Editor's Triggers list (a trigger Category), filing variables, triggers and further folders in order, with a built-in icon. A Mission compile files each trigger and variable it generates in a Trigger Folder worked out from the Blueprint thing that made it, never one the author names, and writes only its own folders: the author's folders, and any item the author files in one, are left as they are.
_Avoid_: Category (for a Mission's), group

**Import**:
Making a Mission from a Map Package, or a Campaign Mod or Asset Mod from a mod, built outside the Workspace: the package is copied byte for byte into the Workspace, the source left untouched, and everything in it starts as Kept Content. An imported Mission gets a minimal Mission Blueprint read from its package (title, Campaign, map size, tileset, dependencies, and its Screenplay when the Campaign's Screenplay Source knows the package's conversation), with no Zones, Beats or Kept References, and an empty compile record. Only the Editor's default map name is changed, to the title. An imported mod keeps its package's name, which Missions depend on it by, and gets a minimal Mod Blueprint read from its package (its id, whether it is a Campaign Mod or an Asset Mod, its dependencies, and the catalog files its includes list names) and an empty compile record, and the Workspace's settings name it.
_Avoid_: Adopt, convert, migrate

**Equivalence Check**:
The comparison a mod compile makes when it converts a part of a Campaign Mod or Asset Mod from Kept Content to Compiled Content: what it writes is compared with the Kept original it replaces, ignoring what the Editor ignores (ordering, whitespace, attribute order, number formatting), and any difference not named as an Accepted Difference stops the compile.
_Avoid_: Parity check, diff check

**Kept Report**:
The list of the Kept Content left in a Campaign Mod or Asset Mod, by component (game data, strings, triggers, scripts, cutscenes, UI, package files, other files) and item, with a count: the to-do list of the mod's conversion. The Editor-only files left to the Editor, which no compile writes, are listed apart and not counted.
_Avoid_: Conversion status, Kept list

**Accepted Difference**:
A difference from a converted part's Kept original that the Mod Blueprint names, with its reason, as intended, so the Equivalence Check passes it.
_Avoid_: Allowed drift, exception

**Accepted Removal**:
A Kept item that the Mod Blueprint drops from the mod on purpose, named with its reason: a string nothing names, a line with no key such as an old merge conflict's, or a file nothing plays. The compile removes it, and the Equivalence Check expects it gone, so a part that writes it back fails. The author confirms each one first.
_Avoid_: Deletion, cut, cleanup

**Generic Entry**:
A catalog entry in a Mod Blueprint given by its catalog, class, id, parent and fields, as the game's own catalogs write them, and checked against the game's data schema before a compile writes it. Every catalog entry can be one; purpose-level shapes, such as characters, conversations and sound sets, compile down to Generic Entries.
_Avoid_: Raw entry, typed entry

**Character**:
One of a Campaign's speakers, declared once in its Campaign Mod's Mod Blueprint: the speaker as Screenplays write it, its CCharacter, what an off-map Transmission from it shows, its other CharacterData fields and its placeholder voice. Mission compiles name their Screenplays' speakers from it, and the mod compile writes its CCharacter as a Generic Entry.
_Avoid_: Speaker entry, cast member (a Cinematic's), portrait

**Library Interface**:
A Campaign Mod's GUI trigger library as its Mod Blueprint declares it: the library's id and name, and each function's name, kind, parameters with their types and the stable ids found at Import, and the library's other items: its categories (trigger folders) and what each files, its preset types, structures, comments and custom script. Mission compiles call the library's functions as typed trigger primitives read from it, and the mod compile writes each function and item into the mod from it and its body. The library's triggers and globals are the Mod Blueprint's `triggers`, which its categories file.
_Avoid_: Library manifest, function list

**GUI Body**:
The body of any trigger element a Blueprint owns, stored as data by its element Id: its local variables and its calls to any function in reach, with their parameters and values, and for a trigger its flags, events, conditions and actions (ADR-0026). A library function's is the default body, the other being a Galaxy file the Mod Blueprint owns, for code that's naturally text; a Mission Blueprint's triggers are GUI Bodies in `missions/<id>/triggers/`. The compile writes each as the Editor's GUI and generates its Galaxy through the one engine.
_Avoid_: GUI XML, trigger source

**Typed Primitive**:
One of the game's trigger functions, presets or block slots, named and with its parameters named, as a Mission's triggers are authored with it. It is how a call is authored, not a limit on what a trigger can hold: any function the game's libraries, or a library in reach, define is written as the Editor writes it.
_Avoid_: Wrapped function

**UI Component**:
A purpose-level piece of campaign presentation, such as a boss bar, a toast, a choice picker or a hero moment, that a Campaign Mod's Mod Blueprint turns on in its `ui` field. Core compiles it into the mod as the GUI library functions that drive it, which may return a value and may wait, and, for one with frames of its own, an SC2Layout file. Its look has a default built from Blizzard's stock assets, which the Blueprint can override field by field. A component with no layout, such as a hero moment, drives the camera and the game's own UI. One-off screens are hand-written layouts in the Blueprint's `files` instead.
_Avoid_: Widget, HUD element, frame tree

**Data Schema**:
The game's catalogs, the classes in each, each class's fields and the kind of value each field holds, read from the install's own catalogs (`docs/reference/catalog-schema.md`), that a Generic Entry is checked against.
_Avoid_: XSD, catalog definition

**Kept Reference**:
A Mission Blueprint's declared name for one piece of Kept Content it builds on, such as a unit, region, trigger or variable, so that Compiled Content can use it without the Blueprint owning it. The one exception is a trigger reference: it names its trigger by element Id, and may name one of the Blueprint's own triggers (Compiled Content) the same way, so converting a Kept trigger doesn't change the reference, and a Beat can start on, cue or hold a trigger the Blueprint authored.
_Avoid_: Adopted anchor, external anchor, kept anchor

**Hold**:
A trigger's start (a Run Trigger of it in another trigger, or its own Map Initialization event) switched off by the compile, so a cue's Compiled trigger runs it once the scenes before it have played. Declared on the trigger's Kept Reference (ADR-0014). A Kept trigger's start is switched off in the Map Package, a Blueprint trigger's in its body.
_Avoid_: Delay, gate, deferred trigger

**Brush Edit**:
One change to a Mission's Kept terrain, made in its own Map Package: an area (a Kept region, a point and a radius, a rectangle or a polygon, with a falloff) and an operation on it, such as raising, flattening or painting the ground, raising a cliff level, adding a ramp or painting it unpathable. The author confirms the area from a render first, and gets before, after and difference renders afterwards. Cells on the compile record are refused, since they are Compiled Content. Swapping one of the map's 8 texture slots for another texture is a Brush Edit with no area: it changes every cell painted with that slot, so it shows them all and needs the author's yes. When the author asks, or after a batch of edits, a capture tour looks at the edited areas in game, on a copy of the package.
_Avoid_: Terrain patch, sculpt

**Texture Set**:
One of a map's up to 8 sets of 8 terrain textures. Each 8×8-cell block of the map draws on one set, and the Editor allows 16 different textures across them all. A Mission can declare sets of its own in its Blueprint (`textureSets`): each holds textures from any tileset, and is painted over the generating Zones it lists or that stand at its `levels` (any Zone, on a fully generated map, where a `palette` of its own gives them bands and variety), whose blocks the compile moves onto it (ADR-0016).
_Avoid_: Tileset (a tileset is the game's own bundle of lighting, cliffs and default textures; a set's name only names one), palette (the `texturePalette` of a generated map)

**Beat**:
A distinct narrative and gameplay phase within a Mission's progression, bounded by trigger conditions, objectives, and story scenes.
_Avoid_: Phase, act, stage, step

**Black Mask**:
The Map Options setting (Unexplored Areas) under which ground the player hasn't explored is black, not shown greyed as under Grey Mask. A compiled Mission starts under Black Mask, as most of Blizzard's campaign missions do, unless its Blueprint asks for Grey Mask or for Black Mask (Reduced Radius), Black Mask without the reveal radius that lets cliff tops show through the fog in caves and interiors; a Melee Map keeps Grey Mask.
_Avoid_: Fog of war (the dimming of explored ground no unit sees now), shroud

**Mechanic**:
A mission-specific gameplay rule or environmental system—such as a periodic solar flare, stealth detection rule, or timed hazard—composed from trigger logic and game data.
_Avoid_: Gimmick, mutator, custom rule

**Zone**:
A named playable region of a Mission's spatial layout with a defined elevation, landform (what the ground is), role (what it's for in play: base, objective, refuge, vault, arena or path), connections to neighboring regions, and the zones it overlooks. In a Mission with Kept terrain each Zone says whether it is a Generating Zone or is drawn over Kept ground as an area only (for the checks, the preview and its trigger region).
_Avoid_: Area, sector, room, chunk

**Terrace**:
A step of rock a level high that the compile makes between two storeys of a generated map's ground, so no cliff climbs two levels at once: the game draws such a cliff as a black square. Where backdrop rock meets ground two or more levels above or below it, the rock comes down (or goes up) a level at a time, each step at least two cells wide. Floors (Zones that aren't backdrop, at their own elevation), ramps and bridges stay as drawn, and Kept ground isn't terraced. Two floors drawn two levels apart can't be terraced, and the compile warns.
_Avoid_: Step-down, cliff ring, intermediate level

**Playable Area**:
Where a Mission's units may go: MapInfo's one rectangle, which is also where the camera may go at the start, or the rectangle a Beat sets in its place for as long as it holds. By default the compile fits it round the Zones that aren't backdrop, inside the Editor's inset (ADR-0015).
_Avoid_: Map bounds (which covers this and Camera Bounds both), playable map

**Camera Bounds**:
Where the camera may aim, set by a Beat inside the Playable Area for as long as it holds; until one does, the Playable Area itself. Units may stand past them, and the camera still shows ground round its aim (ADR-0015).
_Avoid_: Camera area, view bounds

**Shot**:
A rectangle of a map, in cells, that one in-game frame must show whole, with an optional pitch and yaw: the least the frame shows, since its 16:9 frame shows more on its long side. Its camera is fitted to it, farther for a bigger one, and a Shot the camera can't frame whole is still captured and marked so. A Shot is not Camera Bounds: it says what a picture shows, not where play lets the camera go. Nor is it a cutscene's camera shot, an entry in a Cinematic's or a Trigger Scene's shot list (ADR-0009, ADR-0013): a Shot is a still of the map, taken outside any cutscene.
_Avoid_: Screenshot area, view, capture rect; "shot" for a cutscene's camera shot

**Generating Zone**:
A Zone beside Kept ground whose ground the compile writes: its cells are Compiled Content on the compile record, and every cell round them stays Kept. It meets the Kept ground at a seam, at the Kept cliff level where a Connection crosses, and leaves Kept objects on its ground in place, moved with the ground. A hand edit to its cells in the Editor is kept or discarded at the next compile, cell by cell.
_Avoid_: Generated block, new section, regenerated area

**Connection**:
A way across between two neighboring Zones—a ramp, a bridge, an open choke, a drop—which may be one-way and may be open only on a Schedule (rocks cleared at a Beat, a ford flooded each surge, a gate opened at a checkpoint).
_Avoid_: Link, edge, path, passage

**Anchor**:
A named, individually tracked entity on the map—such as a hero unit, objective structure, interactive prop, waypoint, or camera—with a stable identifier that triggers and cutscenes reference directly and that syncs back when moved in the Editor. A unit Anchor with no position is a Wave's unit instead: placed by nobody, it is the one unit a Wave's send creates (ADR 0008). A doodad Anchor with an `editorId` is one sync adopted: a doodad the author placed in the Editor on ground the compile writes, written at the Editor's own Id (ADR 0010).
_Avoid_: Key object, pin, marker

**Placement**:
A high-level spatial declaration inside a Zone—such as a resource base, enemy squad, or perimeter doodad scatter—that expands into concrete map entities while keeping playable paths clear.
_Avoid_: Prefab, stamp, spawner

**Wave**:
A timed attack that sets off from one Zone toward another, from a Beat onward, once or on an interval, arriving by ground, air, drop, nydus or burrow. Unlike an encounter, which fires once when the player enters its Zone (or on its own start condition), a Wave runs on the clock.
_Avoid_: Attack group, spawn, push

**Raid**:
A Wave that goes only where the player holds a unit of a given type (an Assimilator, say): at each send it heads for the first of its target Zones where the player holds one, or skips the send if there is none. It fights its way to that unit, and its survivors go home once the player holds none there. Its target Zones are fixed by the author, so a Raid never hunts the player across the map.
_Avoid_: Harass, hunt, strike

**Threat**:
Anything that makes part of a Mission unsafe for the player—an enemy group, a Wave, or a Mechanic such as a sun, a flare or a stealth patrol—described by where it reaches, when it is active, how it warns the player, where the player is safe from it, and what happens if it catches them (damage, combat, a setback to the last checkpoint, or failing the Mission).
_Avoid_: Hazard (for the general idea), danger, exposure

**Schedule**:
When something in a Mission is in effect: from a Beat onward, on a repeating cycle, during each pass of a patrol, or while a Mechanic's state holds (a checkpoint reached, a switch held). Threats and changing Connections share the same Schedules.
_Avoid_: Timer, timing, cycle (for the general idea)

**Asset Catalog**:
The indexed registry of tilesets, cliffs, doodads, and units—linking visual reference entries to their StarCraft II catalog identifiers, footprints, and semantic tags. It holds the game's own entries plus whatever the Workspace's Campaign Mod defines, its **catalog layer**: core's data files hold only the game's, and the mod's are read from the mod. The descriptions and pictures of the mod's doodads are kept in the Workspace beside the mod, not in the mod, and a mod doodad is described in the same words as a game doodad. A Mission also sees what its own Map Package's Kept game data defines, laid over the mod's. Its doodad descriptions and Doodad Uses are written by hand and published with sc2-asset-catalog. Everything else in it is extracted from the game on each machine.
_Avoid_: Asset list, gallery data, palette db

**Doodad Facing**:
Which way a doodad's face points when it stands at rotation 0 (its front), and where it belongs against a wall: at the wall's foot, hung on its face, on its top, or free on the floor, with how far out and how high. Measured by eye in the Editor and kept in core's Asset Catalog. A doodad nobody has measured may still have a front read by eye from its catalog renders (a sheet reading), which turns pieces with a warning. Its placement is only ever suggested. A doodad with neither has none, and nothing guesses one.
_Avoid_: Orientation, default facing, model axis

**Ground Outline**:
Where a doodad's model stands solid at a unit's height, seen from above, one for each variation. It's worked out once from the model's mesh and kept in core's Asset Catalog. Many doodads have no footprint of their own, or one far smaller than the model, so units walk through them. The compile paints no-pathing under a solid set-piece doodad or doodad Anchor from its Ground Outline.
_Avoid_: Footprint (that's the doodad's own data), collision shape, silhouette

**Pathing Paint**:
The author's own strokes with the Editor's pathing brush on a generated map: ground painted unpathable, or the compile's paint erased. Sync keeps them in the Blueprint, so the next compile writes them again over its own paint. A stroke near a doodad is kept relative to that doodad and moves with it.
_Avoid_: Pathing edits, blockers

**Doodad Search**:
Looking through the Asset Catalog for the doodads that could make one object, such as a crushing press over a conveyor belt. The object is broken into Search Parts, and each part gets a ranked shortlist of candidates, each judged from its pictures with a note on why it fits, plus the ones ruled out and why. A Doodad Search is shown to the author as a page of candidates for them to pick from. It's for one Mission, or for none.
_Avoid_: Contact sheet (that's only how it's shown), doodad hunt, asset search

**Search Part**:
One thing a Doodad Search looks for, given by what it has to read as to the player: "press head: a heavy flat block that drops onto the belt and looks like it could crush a Marine". Candidates are judged against that line. Not the same as a piece of a Doodad Composite: a Search Part may be filled by one doodad or by several.
_Avoid_: Slot, role, component

**Doodad Use**:
A short, general note on a doodad saying what it has been accepted as in a Doodad Search ("crusher press head"), with the variation and scale that made it work, so that later searches find it for that purpose too. It never names a Mission or a story. A Workspace keeps its own Doodad Uses until its author contributes them to sc2-asset-catalog, which publishes each doodad's in a file of its own beside its descriptions; until a release carries them, the Workspace's are laid over the published ones. A Campaign Mod doodad's Doodad Uses stay in the mod's doodad index, with its description.
_Avoid_: Usage note, tag, pick

**Doodad Finder**:
Where a mapper asks for doodads in plain words, many times in a row, and sees ranked candidates at once, each with its picture and look, then ticks the ones they want. It is published with sc2-asset-catalog. Ticked cards collect in the page's tray, whose ids and dependencies can be copied. Only sc2-adjutant's Doodad Finder adds the Doodad Search: there, the tray is kept for one named object as its Doodad Search, each ask the author ticks cards from a Search Part and its ticked cards that part's shortlist, and look closer carries it on to its pictures. The Doodad Finder never judges from pictures itself.
_Avoid_: Quick search, doodad browser, fast search, tray (that's only the page's panel of ticked cards)

### Melee Maps

**Melee Map**:
A 1v1 map, laid out the way ladder maps are, that the Galaxy Editor calls "Melee" in Map > Map Status. Its players pick any race and start at random, every pre-placed unit is Neutral, and it has no story or trigger of its own. It is built in any folder, not in a Workspace, and it belongs to no Campaign.
_Avoid_: Ladder map (for ours), versus map, skirmish map, melee Mission

**Melee Map Blueprint**:
The structured specification of a Melee Map that is compiled into its Map Package. It shares the Mission Blueprint's Zones, Connections and terrain fields, and adds the category, spawns, symmetry and playable size. It draws one Half, and it has no Beats, Screenplay, Waves, Mechanics or Anchors.
_Avoid_: Melee mission, melee mode, map spec

**Half**:
The part of a Melee Map that its Melee Map Blueprint draws. The compiler turns it 180° about the playable area's centre to make the rest. A Zone drawn across the centre belongs to both halves, so it must be symmetric under the turn itself.
_Avoid_: Side, mirror half

**Partner**:
An object's copy in the other Half, the object turned 180° about the centre, with the same id and `-rot` added. A Zone drawn across the centre is its own partner. The melee checks find a same-kind partner within 1 cell for every unit and start location.
_Avoid_: Mirror, twin, copy (for the checked pairing)

**Source Side**:
The side of the centre that the compiler draws from when something can't be drawn twice and stay symmetric (a ramp's fit, terrain noise, a resource base's layout): the cells below the centre, and the centre row up to the middle. The other side takes each of these from its partner. This is the compiler's choice and doesn't constrain the Half, which may lie on either side.
_Avoid_: First half, primary side

**Start Base**:
The standard ladder base (4 large and 4 small mineral patches, 2 geysers) a spawn starts at, with its start location at the town-hall spot. The game's town-hall rule must put the town hall on that spot.
_Avoid_: Spawn base, home base

**Main**:
The Zone a Start Base sits in, on the map's top level, with one ground entrance: its main ramp, the narrow diagonal ladder ramp, down to the Natural.
_Avoid_: Main base (for the Zone), start zone

**Natural**:
The base nearest a Main by ground, one level below it and just outside the main ramp.
_Avoid_: Expansion, second base

**Unbuildable Plate**:
The Neutral plate the compiler puts at the foot of each main ramp, 5-8 cells from its top. Nothing can be built on it, so a single Pylon can't wall a player in. Units still walk over it.
_Avoid_: Unbuildable rocks (for ours), ramp blocker

**Melee Principle**:
A numbered rule (MP-n) of the `melee-design` skill for how a Melee Map plays: the safe start, the choice of third, the distance budget, the attack paths and air exposure. It is drawn from measured ladder maps and contest rules. It is the Melee Map's counterpart of a Layout Principle.
_Avoid_: Melee rule (the compiler's checks are rules), map guideline

### Visual Design Knowledge

**Exemplar Map**:
A map whose look a Style Pack's author made, edited, or approves of (including other people's maps they admire), treated as an authoritative source of that pack's visual design lessons; its provenance (made, edited, or approved) sets how much weight its evidence carries.
_Avoid_: Reference map, sample map, inspiration

**Map Study**:
The structured record of one Exemplar Map's visual design—its texturing, cliff and ramp styling, doodad dressing, lighting, and composition—captured as measurements alongside a top-down render.
_Avoid_: Map analysis, map report, scan

**Measure**:
One lesson-neutral number about a map's look (the top texture's share of a level, how often the texture changes at a cliff, the share of decals snapped to 45°), named by what it measures and carrying no Design Lesson or threshold, so any Style Pack's maps can be compared on it. A Design Lesson may cite one; the measure itself never says what is right.
_Avoid_: Lesson metric, score, rule

**Blizzard Baseline**:
Every Measure over every campaign mission of Wings of Liberty, Heart of the Swarm, Legacy of the Void and Nova Covert Ops, shipped in core as each measure's spread and each map's value. It tells what is a Style Pack author's own taste from what every SC2 campaign map does.
_Avoid_: Blizzard average, norm, reference pack

**Design Lesson**:
A reusable visual design principle distilled from one or more Map Studies, citing the Exemplar Maps that support it, and applied when co-designing a Mission Blueprint.
_Avoid_: Rule, guideline, tip, pattern

**Style Rule**:
A Design Lesson put into code by a Style Pack, filling a slot of the dresser or texture painter (such as what a cliff pile holds, or which textures blend widely) so the lesson shapes the compiled Mission; a slot no Style Rule fills gets plain dressing or painting.
_Avoid_: Design rule, style hook

**Layout Principle**:
A numbered rule (LP-n) for a Mission's geography—its Zones, Connections, sight lines and pacing—backed by calibration studies of Blizzard missions, and applied when sketching or critiquing a Mission Blueprint's layout. Unlike a Design Lesson, it governs how a layout plays, not how it looks.
_Avoid_: Design rule, level-design rule, heuristic

**Doodad Manipulation**:
Placing a doodad with deliberate transforms beyond ordinary placement—tilt, non-uniform scale, height override, tint, or suppressed footprint—so that its model serves a different visual purpose.
_Avoid_: Doodad hack, trick, tweak

**Doodad Composite**:
A group of nearby doodads, usually manipulated, that together read as a single new visual object.
_Avoid_: Doodad cluster, kitbash, prefab

### Distribution & Extension

**Plugin**:
A shareable package that extends the mapper by making Contributions; it may fill one or more of the Campaign Pack, Style Pack, Host Adapter and Utility roles at once.
_Avoid_: Extension, add-on, module

**Workspace**:
An author's folder of Missions and mods for one Campaign, with shared settings naming which Plugins fill the Campaign Pack and Style Pack roles and which Utilities it adds; each author's machine settings, including its Host Adapter, sit alongside it rather than in it.
_Avoid_: Project, repo, campaign folder

**Contribution**:
One typed thing a Plugin adds, such as a Mechanic, a Design Lesson, an Exemplar Map, a Screenplay Source, a Host Adapter capability, or a skill for Claude Code.
_Avoid_: Hook, feature, export

**Campaign Pack**:
The role of the Plugin that supplies everything that makes a Campaign itself rather than any campaign: the name of its Campaign Mod, where its Screenplays come from and how their lines are named, and the Mechanics it defines.
_Avoid_: Campaign config, campaign plugin, mod pack

**Style Pack**:
The role of the Plugin that supplies one author's visual taste for how Missions should look: their Exemplar Maps, the Map Studies and Design Lessons drawn from them, and their Doodad Composites. A Style Pack can be used by authors other than the one it came from.
_Avoid_: Theme, preset, style guide, skin

**Host Adapter**:
The role of the Plugin that supplies what the author's machine can do with StarCraft II beyond reading and writing files, such as launching the Editor, running Test Document, capturing the screen, rendering models, or speaking placeholder lines.
_Avoid_: Platform layer, driver, backend

**Utility**:
The role of a Plugin that supplies an optional tool that works for any Campaign and any taste, such as a model workshop for retexturing and rescaling game models. A Workspace can add any number of Utilities, and has none until it lists one.
_Avoid_: Tool pack, extra, optional plugin

**Editor Broker**:
The one local process that drives the StarCraft II Editor for in-game captures and the other Editor actions that click its menus (open, Test Document, save), running one job at a time, first come first served, so that agents asking for Shots, tours or tests at once never click on each other's maps. It keeps the Editor running between jobs, merges waiting jobs on the same map into one tour, and starts no capture while a game its Test Document started is running.
_Avoid_: Editor queue, capture server, Editor lock

**Missing-Feature Report**:
An issue filed from a session in sc2-adjutant's public repo, with the mapper's consent and after they've read its text, saying what sc2-adjutant couldn't do and how the work got around it, in the product's own terms and without the mapper's map content, paths or names.
_Avoid_: Bug report, telemetry, feedback
