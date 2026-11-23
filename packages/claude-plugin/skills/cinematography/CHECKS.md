# Cutscene checks

Apply every check for the scene's tier, and record each as passed, fixed, an issue, or intended (with the reason). For a compiled Cinematic, `check_workspace` (`npm run check-workspace`) computes F1, F3, C4's shot lengths and T4 from its timeline, and flags lines with no shot on screen and shots held more than 2 s past their lines. For a trigger scene that compiles, it computes the checks the "Trigger scene" section marks *(computed)*, timed the same way. The rest is still by hand. C11 isn't automated, since Sets' cameras carry no framing tag. The ids are this skill's, and the numbers are Blizzard's, measured over its 336 `.SC2Cutscene` files and the scenes in its 115 campaign map scripts (n = sample size). They're starting points: when a scene breaks one on purpose, keep the design and record why. C6 and L4 depend on what the frame actually shows, so on paper they're a question for the author's Test Document run.

A *transmission* gets T5 and T7. A *ping* adds C3 and O1. Trigger scenes and cinematics get the sections below, the music checks included.

## Every trigger scene or cinematic

- **O1 Lowest tier.** The tier below can't do the job; say why.
- **C2 One line.** In a two-character exchange, every camera is on one side of the line between the speakers, or a wide or an arcing move re-establishes before the camera crosses.
- **C5 Motivated moves.** Each move names follow, reveal or reaction. Orbits and drifts with no subject change are flagged.
- **L1 Motivated light.** Any added light matches the mission Light's key direction or a visible source.
- **L4 Subject contrast.** The shot's subject (the speaker, the goal) is the brightest or highest-contrast thing in the frame.
- **T1 Skippable.** The skip point sits after setup and before the first visible frame.
- **T2 One cleanup.** Skip and natural end run the same cleanup, and the world after it is identical either way: units, doors, camera, bounds, Light, fog, objectives.
- **T5 Text carries it.** Every line has subtitle text and a speaker name. Nothing important is told by colour or picture alone.
- **T7 Replayable.** What the scene told the player is also in the objective text or a later reminder.
- **O4 React to the player.** An outro's lines branch on an outcome the blueprint tracks (objective counts, a hero surviving), when it tracks one.

## Music (every trigger scene or cinematic)

The M checks come from how Blizzard plays music in its 413 mission and library scripts and its 336 cutscene files. Like the others, they're starting points.

- **M1 Callable.** Every cue names an id our maps load, that isn't `silent` or `empty` in sc2-adjutant's `tools/music/tracks.json`. `find_music.py` lists only these by default. A file with no loaded id gets a map-defined `CSound` (parent `MUSIC`, with a `CSoundtrack` that plays it), and the plan says so.
- **M2 The right id for the in-point.** A cue from the top plays a Soundtrack, a one-shot with `pool_size` 1 so the file is known. A cue with an in-point plays the file's Sound with an offset. A pool id (`pool_size` > 1) is never used where a beat must land on a known moment.
- **M3 Long enough, and ends on purpose.** From its in-point, each cue lasts until its Until, or its Until says how it leaves early: a fade, a crossfade or a stop on a cut. A cue that runs out before the next one begins is flagged unless the gap is meant. Check `ends:` (fade out, hard stop, loop point) against how the slot ends.
- **M4 Mission music comes back.** The scene pauses or stops the mission music at its start. The one cleanup stops every scene cue (with a fade) and brings the mission music back, on skip and on natural end alike (T2). Nothing from the scene plays on into gameplay unless the plan says it carries over.
- **M5 Lines read over music.** From the first line to the last, Speech mode is on (music at 70%), or the bed under the lines is quiet in its own right. Game mode returns at the handback.
- **M6 One bed at a time.** Beds hand over by crossfade or under a cut; two beds never play together. Stingers play over a bed or in a gap, not over another stinger.
- **M7 Silence is a choice.** A scene with no music, or a held silence before a hit, says so in the plan and why. Blizzard holds silence on purpose with `Music_Silence`, as six LotV maps do after their intros.
- **M8 The author heard it.** Every cue was picked by the author on a listening sheet, with its in-point. The plan records the other candidates per slot and the date. A cue only a model has heard is an open question, not a plan.

## Trigger scene

`check_workspace` computes the checks marked *(computed)* from the scene's shots, its camera Anchors' values (a value an Anchor leaves out is the game camera's) and its timed lines, and names the shot and an edit in each finding. H3 and O2 read the start and the goal from the Zones' roles (`base`, `objective`) the Anchors are in. A Kept camera's values and Zone aren't known, so it isn't judged. C3's ±15° for geography shots, H3's objective after the handback, O2's threat direction and C6 stay by hand. Held by construction, since the compiler writes them: T3 and H2 (the template's timings, which `check` compares with T3's), T6 (the lines play waited, so Cinematic Mode goes off only after the last), T9 (ADR 0013: the scene cuts off only the in-play script line playing, which plays again after it, and its Cleanup clears only its own line), H1 and H4 (the cleanup runs under black and puts AI time back), and L2, L3 and O3 for now, since a scene declares no Light or fog change and no staged cast yet.

Camera:
- **C1 Establish.** *(computed)* The first shot after the fade-in is a wide (gameplay-framed, or distance at least about 25). This holds when dialogue plays over map shots too; only a scene framed on its speakers opens closer. Blizzard opens with a cut under black, then a slow move. A short scene on a moment in play may open with no fade (`open.fade: false`), easing to its first camera from the player's (C7) so the player keeps their bearings, where the black would hide what the scene is for (RECIPES.md "Trigger scene").
- **C3 Screen direction.** *(computed)* Every camera keeps yaw within ±45° of 180, and geography shots within ±15°. Successive shots turn no more than 45°, and anything past 90° is a deliberate, recorded choice. A moving group keeps its screen direction across cuts. (Blizzard: 95% within 45°, 78% within 15°, n=1,859 camera objects.)
- **C4 Shot length.** *(computed)* Moves last 1.5-15 s (median 5 s, n=510), or exactly the line they play under. The camera is moving for about half the scene (median 57%); flag under about 20% or over about 95%.
- **C6 Safe low angles.** A shot pitched below about 40 looks at dressed, playable terrain or a background the scene sets on purpose. No map edge or skybox seam.
- **C7 Eased moves.** *(computed)* Moves use velocity −1 and decelerate 10 (822 of 832 Blizzard moves), unless a snap is intended.
- **C8 Lens.** *(computed)* FOV stays 27.8; get closer with distance. Blizzard changed the camera-object lens on 1% of 1,859.
- **C9 Depth of field.** *(computed)* Off in gameplay-framed shots, at most about 0.1 in closer ones.

Light:
- **L2 Restore on exit.** Every Light, fog or time-of-day change in the scene is undone in cleanup.
- **L3 Mood changes.** A light change during gameplay blends over 10 s or more. Inside the scene, change the Light under black.

Timing and handback:
- **T3 Fast skip.** *(computed)* Fade out over 0.5 s on a skip and 2.0 s at the natural end; the handback fade-in is 1.0 s after a skip and 1.5 s after the natural end.
- **T4 Length.** *(computed)* Intro about 35 s (warn over 60), mid-mission about 30 s (warn over 55), victory outro about 25 s (warn over 45). An on-map briefing flyover can run to about 2 minutes. Review anything over 30 s for what could go. The limits are Blizzard's 90th percentiles, so a long scene is a review item rather than a failure. But when the lines alone run past the budget, walk the author through every line, one by one: does it need the player's full attention now? If not, it could move into play as a transmission, move to a later cue (one line on its own cue is a cue entry's `line`), or be cut. Record the author's decision for each line. The author can keep a long scene, but only on purpose.
- **T6 Lines survive mode changes.** No Cinematic Mode off while a transmission is playing; turning it off clears transmissions.
- **T9 In-play lines aren't lost.** A scene cued on a moment in play starts on time rather than waiting for the line playing. It cuts off only that line and replays it after the handback. Its cleanup clears only its own lines, never every transmission.
- **H1 Switch under black.** World-changing cuts, staged-cast creation and removal, mode switches and bounds changes happen while the screen is black. A trigger scene that opens with no fade has no black at Setup, so `check_workspace` refuses it beside a staged cast, marks, hidden live units, a Light, fog or mask change, and on a scene played straight after another on its cue, which opens on that scene's black.
- **H2 Settle together.** Fade-in, Cinematic Mode off and the camera's move to the gameplay view share one duration: 1.5 s, or 1.0 s after a skip.
- **H3 Land where the player acts.** *(computed)* The last camera is the start (mission start) or the player's saved camera (mid-mission), and the objective is issued or flashed straight after. When scenes run back to back, this applies to the last of them.
- **H4 Unlock everything, start the clocks.** Every camera lock, pause, invulnerability, AI pause and time-of-day pause set in the scene is cleared in cleanup. Gameplay clocks that would fire during the scene (a hazard countdown, waves, mission timers) are paused for it or started after the handback.
- **O2 Opening teaches the map** *(computed)* (mission-start scenes). It shows the start, the primary goal or a glimpse, and the main threat's direction, in gameplay framing.
- **O3 Staged cast.** The scene films units created for it, not the live army.
- **O5 Frame what the moment did.** A shot on the cue's unit (`unit: "cue"`) frames the unit the moment is about. When the moment is a data effect, such as a strike, a blink or a cast on a unit, the scene is cued on `effectStarts`, which keeps the unit the effect struck. An `anchorNears` by unit type keeps the first of the type in its circle, measured from the units' centres and counting ones under construction, which can differ from the unit the data's search picked.

## Cinematic

Run these first: a broken file makes the craft checks moot. `timeline.py` flags F1 and F2.

File:
- **F1 It ends.** Every take has an End Scene marker, and no stray one sits at t=0. `WaitForCutsceneToEnd` waits for that marker, so a file without one never returns, and a timeline that runs past its last line (a 150 s final shot) is a missing marker.
- **F2 Jumps land.** Every `jumpToBookmarkWhenHit` names a bookmark the file defines. Dialogue placed after a jump is reachable only if something plays it.
- **F3 Nothing is cut off.** No fade-out, End Scene or jump falls while a line is still playing, and no camera track runs on past the last line.
- **F4 One version.** One file per scene. When an older copy sits beside the current one, say which is current and offer to delete the other.

Scale: sets built in the world at map scale (as a campaign's own cutscenes often are) aren't at Blizzard's story scale, about 2.8 m per unit. So compare distances within a file, not against Blizzard's numbers. Older files use the `depthOfField` amount (`doftype` 0) instead of an f-stop; judge C9 on those with an Editor look at a close-up rather than by the numbers.

Camera:
- **C1 Establish.** The first shot is about 1.5× the distance and 1.5× the length of the coverage after it, and the last shot is the longest.
- **C4 Shot length.** Hard cuts. Shots run 1-12 s (median 4 s, n=1,580), and the scene's median shot is 3-7.3 s. Conversation cuts land on the new line's start (±50 ms); action cuts follow the picture.
- **C8 Lens.** A lens per shot size: 10-20° for close-ups and singles (LotV's median is 17.5°), 35-50° for wides and two-shots. Flag under 8° or over 60°. Set `verticalFOV`.
- **C9 Focus.** With DOF on, focal depth is 0.6-1.1× the eye-to-target distance, and the f-stop is 1-4 in close shots.
- **C10 Eye level.** Most shots are within 10° of level; flag a scene where more than about 10% look down 30° or more.
- **C11 Conversation cameras.** In a conversation set, each line names a camera (Medium by default; CloseUp for emphasis, Far, Shoulder, TwoShot, and `...Listener` for the reverse). The shot is the line. Flag a conversation where more than about a third of lines leave Medium. Dialogue coverage stays locked off.

Light:
- **L3 Base Light.** The base Light switches with no blend, on a cut or at t=0.
- **L5 Character rigs.** Each character shot has a key and a rim tied to it. The rim is about 3× the key, and the key about 1.5× the fill. Rims are cool; the mood sets the key's temperature.
- **L6 Light per shot.** About 5-15 local lights per camera, each tied to its shot with Active for Shot, and an Active Light at t=0.

Timing and handback:
- **T4 Length.** A story cinematic runs about a minute (warn over 140 s); an insert inside a mission about 15 s (warn over about 40 s).
- **T8 Black at both ends.** It fades in from black over about 1 s at t=0, and holds about 2 s of black before the End Scene marker.
- **H5 Insert hand-off.** A cinematic inside a mission is entered from black, and on return the map camera cuts under black before a fade-in of about 2 s.
