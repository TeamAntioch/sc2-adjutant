---
name: cinematography
description: Cinematography for SC2 mission cutscenes. Plans or critiques a scene's shots, camera, lighting, music, length, skip and handback. Use when staging a Screenplay scene or stage direction, when writing or reviewing an In-Game Cutscene or a Cutscene Editor cinematic, or when asked whether a cutscene will read well.
---

Plan or review how a Screenplay scene goes on screen: which tier carries it, its shots, its light, its music, and how control leaves and returns to the player. This is the cutscene half of Co-design Stage 4, dialogue and compilation. The blueprint has no `Cutscene` entity yet, so the plan lives in `missions/<id>/cutscenes.md` (format below).

Where the inputs are. Read the Blueprint with the sc2-adjutant MCP server's `get_blueprint` tool; its fields are core's Mission Blueprint schema (`MissionBlueprintSchema`):
- **Scenes and lines** are in `screenplay.scenes`. Or, when `screenplay.script` is set, they're in its markdown export: scenes, `**SPEAKER** \`sound ID\`: text` lines and `>` stage directions. Then `script.cues` gives each scene's cue by scene number, and `script.speakerAnchors` maps speakers to units on the map. A scene's Beat is its `beatId`, or the Beat its cue falls in.
- **Line lengths** come from the voice files in `script.audioDir` (`<sound>.ogg` or `.wav`, the recording over the placeholder) when they exist. A spoken placeholder is trimmed to its speech (silence below about -50 dBFS cut, 50 ms kept at each end), so lines played back to back have no gap between them but the speaker's own; `npm run tts` trims one spoken before that in place. Otherwise estimate 0.91 s + 0.39 s per word, a fit to 975 of Blizzard's voice lines with known lengths (about ±1.5 s a line).
- **Script changes** a finding calls for, such as cutting a scene that runs too long, are made at the Screenplay's source, through the Campaign Pack's Screenplay Source: the Campaign Pack's own prompt or skill for it, if it ships one (the server lists the Plugins' prompts), or else sc2-adjutant's `edit-screenplay` CLI. Never edit the markdown copy.
- **The mission Light** is the blueprint's `lighting`, or else the tileset's default Light (core's `getTilesetLight`).
- **A shot on the map** is a camera Anchor (`kind: "camera"`). Its `position` and `cameraTarget` are both the point the camera looks at, and `cameraValues` sets the rest by index: `Distance`, `Pitch`, `Yaw`, `FieldOfView`, plus `DepthOfField`, `FocalDepth` and `Roll` when needed. The gameplay view is `Distance` 34, `Pitch` 56, `Yaw` 180, `FieldOfView` 27.8.

The rules are this skill's: the numbered rules below and the checks in [`CHECKS.md`](CHECKS.md), cited by id (C1, L3, T4, H2, O1, M1 ...). They're drawn from Blizzard's own files: all 336 of its `.SC2Cutscene` files (HotS, LotV, Nova Covert Ops and menus), the 295 in-mission scenes in its 115 campaign map scripts (`MapScript.galaxy`), and the music calls in 413 mission and library `.galaxy` scripts. Where a number matters, CHECKS.md gives Blizzard's figure and its sample size.

## Leading words

- **Tier**: what carries a scene. From lowest to highest:
  - *transmission*: a portrait line during play.
  - *ping*: a transmission plus a short camera pan while the player keeps control.
  - *trigger scene*: Cinematic Mode on the mission map, with camera objects, staged units and transmissions.
  - *cinematic*: a `.SC2Cutscene` timeline with its own set, actors, lenses and lights.

  Every scene uses the lowest tier that does its job (O1). One scene can mix tiers: a trigger scene that drops into a cinematic insert and comes back, as LotV's Aiur06 intro does.
- **Gameplay framing**: the RTS view: gameplay yaw (180), a high pitch (about 45-56), lens 27.8. The player maps what it shows onto the minimap. **Cinematic framing** is eye level, close, any yaw and a chosen lens. Geography is told in gameplay framing; character drama in cinematic framing.
- **Line**: the line of action between two speakers, or along a moving group's travel. Every camera stays on one side of it. In a trigger scene the gameplay yaw is a line too, the one the player has watched all mission.
- **Motivation**: why the camera moves: *follow* a unit, *reveal* a goal, threat or route, or catch a *reaction*. A move with no motivation is a held frame.
- **Coverage**: a wide master plus closer shots of the same action that can be intercut. Conversations are covered by Medium, CloseUp and Far per speaker and listener.
- **Key, fill, rim**: the three-point rig. The key sets direction and mood, the fill sets how dark the shadows get, and the rim separates the subject from the background. In SC2 the mission Light is the key, fill and back for a trigger scene; a cinematic builds a rig per shot.
- **Under black**: while the screen is faded out. Every cut that changes the world, every unit created or removed and every mode switch happens under black.
- **Handback**: returning control: fade in, Cinematic Mode off and the camera settling to the gameplay view, all together, landing where the player acts next.
- **Staged cast**: units created for the scene and removed in cleanup, standing in for the live army.
- **Mood**: one word per scene (`tense`, `somber`, `triumphant` ...) that picks the Light, the key's colour temperature and the music.
- **Cue sheet**: a scene's music, on its own clock. Cues start at a time, a line, a shot or an event, not necessarily on cuts. Several cues can follow each other in one scene: an intro, a couple of pieces, a stinger.
- **Bed**: the music under a stretch of the scene. One bed plays at a time; the next one crossfades in. A **stinger** is a short hit played over the bed, or in a gap.
- **In-point**: where in its file a cue starts. Often not the top: the right moment is usually somewhere inside a track. A cue with an in-point plays as a Sound with an offset, not as a Soundtrack.
- **Mission music**: the soundtrack the mission plays in gameplay. A scene pauses or stops it, and the one cleanup brings it back.

## Principles every scene gets

1. Pick the tier first, and pick the lowest one that does the job. Talk over gameplay when the player can keep playing (O1).
2. A mission-start scene teaches the map: the start, the primary goal or a glimpse of it, the main threat's direction, then land at the start with the objective issued. It does this in gameplay framing (O2).
3. Establish, then go closer: the first shot is the widest and among the longest (C1).
4. Keep every camera on one side of the line. In a trigger scene, hold the gameplay yaw, and keep each army moving the same way across the screen (C2, C3).
5. Every move names its motivation. Ease moves out, and hide lens changes inside subject movement (C5, C7).
6. Cut on emotion and story first. In a conversation, cut on the new line's start (C4, C11).
7. Light from something in the world: the tileset's sun, a lamp, a console, a hazard's glow. Give the subject the most contrast in the frame (L1, L4).
8. A cinematic re-lights every shot: a key, a weaker fill and a cool rim about three times the key, tied to that camera (L5, L6).
9. Every scene is skippable, and skip and natural end run one cleanup to one identical world state (T1, T2).
10. Switch under black, settle together on handback, and put back everything the scene changed: Light, fog, locks, pauses, camera (H1-H4, L2).
11. Keep it short. A trigger scene runs about half a minute, a cinematic about a minute. When dialogue runs past the budget, go through it line by line with the author: keep it, move it into play as a transmission, move it to a later cue, or cut it. The objective text repeats what the scene told (T4, T7).
12. The game's clocks stop for the scene: hazard countdowns, wave timers and mission timers are paused or started after the handback (H4).
13. Lines carry subtitles and a speaker name. Outros react to what the player did when the blueprint tracks it (T5, O4).
14. The author picks the music by ear. Offer 2-5 candidates per bed or stinger on a listening sheet, with a reason each, and write down what the author picks and where it starts. Never put a cue in the plan that only a model has heard (M8).
15. Music runs on its own clock. Start a cue where the scene's feeling changes, which may fall inside a shot. Start inside a track when that's where the right moment is. Under lines, the music steps back (Speech mode, M5). Silence is a choice too, recorded as one (M7).

## Plan a scene

1. **Read the scene's job.** Read its lines, stage directions, cue and Beat, plus the Beat's objectives, `reveals` and the Zones involved. List every mismatch between the screenplay and the blueprint (a speaker, camp or prop the screenplay stages that the map doesn't have); these go to the author as open questions. Done when you can say in one sentence what the player must know or feel after the scene, and where they act next.
2. **Choose the tier** and say why the tier below won't do. A reveal the player could pan to themselves is a ping. Geography the player must remember is a trigger scene. Faces, eye lines and character drama are a cinematic. When a scene needs both, teaching the map wins the frame: tell the geography in a trigger scene, and carry the drama in its transmissions, or in a cinematic insert inside it.
3. **Write the shot list** in `missions/<id>/cutscenes.md`. Give every shot its size, subject, framing, camera (an existing camera Anchor, or a proposed one with its target and `cameraValues`), length or the line it plays under, move and motivation, and light. Add the scene's mood and Light, staged cast, skip point, cleanup state, and the clocks it pauses.
4. **Score the scene.** From the scene's job and Mood, list its music slots: one bed per stretch of feeling, a stinger per hit, or none. For each slot:
   - Search the catalogue with sc2-adjutant's `tools/music/find_music.py` (catalogue `tools/music/tracks.json`). `search --words "..." --energy 2-3 --tension 4-5 --min-seconds 40` prints candidate cards; filters are on energy, tension, valence (1-5), length, `--kind` (`full cue`, `ambient bed`, `stinger`, `loop`, `song`) and `--faction`. `show <file>` prints one card in full, with every section and timestamp. By default it only lists music our maps load, and skips silent files.
   - Read the cards, not just the ranking. Keep 2-5 that fit the slot's length and feeling, with a one-line reason each and a suggested in-point from the card's sections. Prefer a track that reaches the right moment within the slot's span; check how it ends (`ends:`) against how the slot ends. A card with `CHECK` means the two listening models disagree, so say so in the reason.
   - Write the slots and candidates to `missions/<id>/output/music/<scene>.json` (the spec format is in the script's header), run `find_music.py sheet <spec> <out.html>` (it plays the game's music from a local extract, given by `--audio-root` or `$SC2_MUSIC_AUDIO`; the extraction steps are in sc2-adjutant's `tools/README.md`), and open the sheet in Chrome or Firefox, since Safari may not play Ogg: `open -a "Google Chrome" <out.html>`. Then hand it to the author.
   - The author listens, sets in-points, picks one per slot, and pastes back the "Your picks" box. Write the Music block (below) from it. Done when every slot has the author's pick and in-point, or "none" on purpose.
5. **Place the cameras.** For a trigger scene, check each proposed camera's target and direction with the server's `preview` tool, on a scratch copy of the Mission (its folder copied under another name). The preview draws only position and target, so what a frame actually shows (map edges, skybox, dressing) is a question for the author's Test Document run. For a cinematic, sketch the set: actors, the line, and each camera's side of it. Cast each actor's model and anims from its Model Guide ([Casting a model](#casting-a-model)). Start from an existing set. Ask the server's `find_sets` tool for the place the scene needs ("a cramped ship corridor with a cockpit at one end"; served when the Set Finder package, an optional dependency of core, is installed): it gives the sets that could play it, best first, each with its written look, what it could stand in for and its pictures. Read a candidate's pictures before choosing it, since the look is written from neutral-light renders and the ranker reads only the look; where one set holds several places, its look names the model pattern for each. The author can browse the published sets with `npx @team-antioch/sc2-set-finder --open` (`npx.cmd` on Windows); in an sc2-adjutant checkout, `npm run set-finder -- --workspace <folder> --open` also shows the Workspace's own sets. Each card has the set's plan from above and an overview among its pictures. Once a set is chosen, the server's `import_set` tool writes it into the Mission with its pieces, marks (who stands where, facing what) and named cameras. In an sc2-adjutant checkout, core's `data/cinematic-sets/README.md` also lists every catalogued set, menu backgrounds included, with a top-down plan of its marks and cameras. The sky and far backdrop are per shot, composited in the cutscene rather than dressed on the map ([`RECIPES.md`](RECIPES.md#backdrops-per-shot)). A shot no catalogued file has (space, a planet's surface) gets a set built by hand, judged in a test Cinematic first ([`BUILT-SETS.md`](BUILT-SETS.md)).
6. **Apply every check in [`CHECKS.md`](CHECKS.md)** for the scene's tier, the music checks included. Done when every check for the tier is recorded as passed, fixed, an issue or intended.
7. **Present the plan:** a short play-by-play of what the player sees and hears, the shot list, the cue sheet, the open questions, the checks that shaped it, and the trade-offs. Done when the author has approved it, the plan is in `cutscenes.md`, and the approved camera Anchors are in the blueprint.

When the plan is built, [`RECIPES.md`](RECIPES.md) has the SC2 mechanics: the skip and cleanup template, the handback, how to play a cinematic, how to play, pause and restore music, and the gotchas verified in game. A Cinematic's cue sheet goes in its `sounds`, each cue from a line or a time, with its in-point (`fromMs`), volume, and its Until as an end on a line or a time with a fade (`untilLine`, `untilMs`, `fadeOutMs`) ([`BUILT-SETS.md`](BUILT-SETS.md#sounds-look-ats-and-attached-lamps)); a trigger scene's is built by hand from the recipe.

## Casting a model

A **Model Guide** says what a model's Animation Families and notable animations show and when to use each, the family it stands and talks in by default, and the animations to avoid; the format is in sc2-adjutant's `docs/reference/model-guides.md`. A Campaign Mod's guides are in `mods/<id>/model-guide.json`, the game models' in core's `data/model-guide.json`, and a mod's entry for a model replaces core's. Each description's `source` is `author` when the author gave or confirmed it, or `viewed` when an agent watched the clip.

1. **Read the guide** of every model you cast, before choosing its model or anims: each family's `shows` and `use`, its `default`, its notable `anims` and its `avoid` list. Cast from an `author` entry as settled. When the plan leans on a `viewed` entry for something important, such as the family a speaker carries the scene in or how a character looks in its key shot, name that entry in the plan's open questions so the author can confirm it. Done when every cast member's model and anim is chosen from its guide, or from a guide drafted in step 2.
2. **Draft a guide the first time you cast a model that has none.** `check_workspace` notes each cast model that has recorded animations but no guide. Watch its clips, in the Editor's previewer or in a render (sc2-adjutant's `docs/reference/m3-models-in-blender.md` poses a model with its animations in Blender), and add its entry to the Campaign Mod's `mods/<id>/model-guide.json`, a game model's too, every description `"source": "viewed"`: the families worth casting, what each shows and when to use it, a `default` when one is plainly right, and the animations to avoid. Write only what you watched, since names mislead (two families named alike can differ by a weapon held); an animation whose clip you can't see stays out of the guide, unreviewed, and goes to the author as a question. Done when `check_workspace` reports no error in the file and the plan names the new entry for the author to confirm.
3. **When the author confirms an entry**, change its `source` to `"author"`, folding in any correction they gave. Done when `check_workspace` reports no error in the file.

## Critique a scene

1. **Read the intent:** the Screenplay scene, its stage directions and cue, and the Beat it serves. List every mismatch between what the screenplay asks for and what the scene stages (a missing reveal, the wrong speaker on screen, a reaction with no shot). These lead the report.
   When there's no Screenplay (an Editor-made map), its conversation data is the script: line texts in `enUS.SC2Data/LocalizedData/ConversationStrings.txt`, speakers in `Base.SC2Data/GameData/ConversationData.xml`.
2. **Name the tier** the scene needs, from the screenplay rather than from what was built. A scene built one tier too high is a finding.
3. **Rebuild the shot list and the cue sheet** from the trigger script, the camera Anchors or the `.SC2Cutscene`, if `cutscenes.md` doesn't match them. For `.SC2Cutscene` files, use sc2-adjutant's `tools/cutscene/`:
   - `python3 -I timeline.py <file> [<map or mod folder>]` prints the cuts, lines, fades, light switches, jumps and End Scene markers in time order, and flags the file problems in the cinematic checks.
   - `python3 -I analyze.py <folder> <out.json>` measures every file in a folder: shot lengths, lenses, pitch, depth of field, cut-to-line offsets, lights per camera, and rim, key and fill strengths.
4. **Read the code that plays the scene**: the triggers, and any library wrapper they call (a campaign library's own StartCutscene / EndCutscene functions, say). Skip, cleanup, handback and Light restore live there, not in the file. A scene that isn't wired up yet is critiqued as it will play, and its wiring checks become requirements.
5. **Apply every check in [`CHECKS.md`](CHECKS.md)** for the tier. For a cinematic, check each cast member against its model's Model Guide too ([Casting a model](#casting-a-model)): an anim the guide avoids, or a family cast against an `author` entry's `use`, is a finding.
6. **Report** under four headings:
   - Mismatches and open questions
   - Reading (does the player come away knowing what they need)
   - Craft (camera, light, music, rhythm)
   - Safety (skip, cleanup, handback, mission music restored)

   Each finding gives the shot or trigger, what's wrong, the check id, and a concrete edit, phrased in the leading words: "cut to the wide under black and let the reveal move end on the goal at gameplay yaw", not "improve the camera". Done when every check for the tier is accounted for.

## The shot list

`missions/<id>/cutscenes.md` holds one section per scene:

```markdown
## <scene id>: <one-line job>
- Cue / Beat: <cue> / <beat id>
- Tier: trigger scene, because <reason the tier below won't do>
- Mood / Light: tense / BelShirEx2 (unchanged)
- Staged cast: <units created for the scene>; removed in cleanup
- Skip: after setup, before the first fade-in. Cleanup: <final world state>
- Clocks paused: <hazard countdowns, waves, timers>; resumed after the handback

| # | Size | Subject | Framing | Camera | Length | Move (motivation) | Light |
|---|------|---------|---------|--------|--------|-------------------|-------|
| 1 | Wide | Start base | gameplay | cam-intro-1 → cam-intro-2 | 8 s | push in (reveal start) | mission |

### Music
- Mission music: paused at the scene's start; resumed after the handback, on skip and on natural end.
- Under lines: Speech mode (music at 70%) from the first line to the last.

| # | At | Plays | From | Until | Layer |
|---|----|-------|------|-------|-------|
| 1 | 0:00, under black | `Space_1_FULL` (1:37, ends): Sound `PAiur01_Music_Outro` | 0:38 | crossfade into 2 over 3 s | bed |
| 2 | the line "They're here" | `The_Rescue_FULL` (1:56, hard stop): Sound `PAiur04_Music_Intro` | 0:31 | fade 2 s with the handback | bed |
| 3 | 1:19, the alert cut | `ZLab02MusicEvent9_Ambush03` (0:13): Soundtrack `ZLab02MusicEvent9_Ambush03` | 0:00 | plays out | stinger |

- Picked by the author on `output/music/<scene>.html`, <date>. Also heard: <the other candidates per slot>.
```

**At** is a time on the scene clock, a line, a shot or an event, whichever reads best. **Plays** gives the file (with its length and how it ends) and the id that plays it: the Soundtrack when it starts at the top, the Sound when it has an in-point. **From** is the in-point in the file. **Until** says how it leaves: plays out, fades, crossfades into the next cue, or stops on a cut. A shot that should land on a hit in the music says so in its Move notes. A scene with no music says `Music: none, on purpose` and why.
