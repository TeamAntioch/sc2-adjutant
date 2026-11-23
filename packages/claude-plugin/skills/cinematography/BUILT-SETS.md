# Building a set by hand

A shot that no catalogued cutscene file has (open space, a planet's surface, an exterior) is filmed on a **built set**: a Set written as JSON by hand instead of imported with `import-set`. It's the same `SetSchema` as an imported set (core's Set schema), so it validates and compiles like an imported one. Judge it in a **test Cinematic** before its shots join a scene's Cinematic.

The set holds what stays in place, alive or not: its pieces loop their animations. What moves, talks or changes from shot to shot is the Cinematic's: the cast and each shot's `moves`, `anims` and `hide`.

## The set file

`missions/<id>/sets/<slug>.json`:

| Field | What to write |
|---|---|
| `name` | The set's name. |
| `provenance` | Leave it out. It records an imported set's source file. |
| `lights` | Base Light ids (`CLight`s the map loads). The first is the Cinematic's base Light at t=0 unless the Cinematic's `light` or its first shot's `light` names one. With `[]` and no `light` the cutscene sets none, so it plays in whatever Light the game has: name one. |
| `pieces` | The scenery: `{ id?, model, modelPath?, at, rotation?, scale?, variation?, tint?, teamColor?, opacity?, anim?, hidden?, shots? }`. `model` is a CModel id in the map's loaded data. An imported piece whose source named a model file and no CModel carries that file as `modelPath` ("Assets/.../Room_01.m3"), with `model` the file's name, and is written back by its file. `id` (lowercase, unique in the set) lets a Cinematic's shots bring the piece in, take it away, fade and scale it (see Pieces that come and go). `anim` is the animation it loops; left out, its model's Stand (see Pieces animate). `rotation` is degrees about z, or the Editor's (x, y, z) for a card stood on its edge or a planet tilted. `scale` is one number or (x, y, z). `tint` is RGB, 1 each for none and above 1 to brighten (Blizzard's go up to about 1.6), `teamColor` `{ diffuse, emissive }` 0-1 RGBA. `shots` ties the piece to set cameras by name (see Backdrops). |
| `marks` | Where characters stand, `{ name, model, at, facing, anim? }`. `anim` is what the character loops in a Campaign Mod's Set cutscene when its default family's Stand won't do (a pilot's `Ride`); a cast member on the mark still gives its own. Can be `[]`: cast members can stand `at` a point instead. |
| `cameras` | Named orbit cameras, `{ name, target, distance, pitch, yaw, fov, heightOffset?, roll?, blur?, focalDepth?, falloff?, shadowDistance? }`. `shadowDistance` is how far from the eye shadows are drawn, 75 cells when left out (see Shadows). An imported set's target cameras (an eye and a point it looks at) arrive as these values too, and a camera marked `moves: true` moved in its file and is held at its first frame. |
| `lamps` | Lights of the set's own, `{ name, type: "omni" \| "spot", at, rotation?, color, strength, attenuationStart?, range, hotspot?, falloff?, shadows?, shots? }`. |

Every camera and mark name, and every piece `id`, is unique in the set, since Cinematics name them.

## The set's frame

The set's 0,0,0 is yours. Put the subject there, since the Cinematic places the whole set at an `offset`. Units are cells, and z is up. For scale: a Terran-sized character is about 1.2 cells tall; sky models and planets are scaled up to tens of cells, or set far back.

A camera's `target` is the point it looks at, not its eye. The eye is `distance` back from the target against the view direction, which at yaw θ is (sin θ, −cos θ): yaw 0 looks south (−y), 90 east (+x), 180 north (+y). The eye sits at the target's height plus `heightOffset` plus `distance` · sin(pitch), so a positive pitch looks down and a negative one looks up. `fov` is the vertical field of view in degrees; the gameplay lens is 27.8. Core's `cameraEye` computes the eye (sc2-adjutant's `docs/reference/editor-and-engine.md`, "Where a cutscene camera's eye sits"). For example, target (0, 10, 2), distance 30, pitch 5, yaw 180 puts the eye at (0, −19.9, 4.6), looking north.

A point is in frame when its angle off the view axis, seen from the eye, is inside half the lens: fov/2 vertically, and atan(tan(fov/2) · 16/9) horizontally on a 16:9 screen. The far clip is 600 cells from the eye.

A crowd or ring of identical pieces (N units around a point) is just N pieces. Compute their points with a throwaway script and paste the JSON. A unit facing a ring's centre turns toward it: work out the turn from one piece in the first test map rather than assuming which way a model's 0° faces.

## Pieces animate

A piece loops its `anim` all through the Cinematic, or its model's `Stand` (its first numbered one, such as `Stand 01`, when it has no plain one). When the piece's model's animations are recorded, by core or the Workspace, the clip is written with its recorded length, as a cast member's is, so units idle, fires burn and shield domes shimmer. A model that isn't recorded gets a bare `Stand` with no length, and an animated model stands frozen in it. A frozen particle emitter may draw nothing at all.

- Record every animated model before building, with `record_model_anims` (from a shell, `npm run model-anims -- <model id>...` in the Workspace's folder). It reads the game's ModelData, resolving the path templates the game fills in and a model's numbered variation files (`<name>_00.m3`), and exports each game model through the Host Adapter. Each model goes in its owner's file: a game model in the Workspace's root `model-anims.json`, the Campaign Mod's own in `mods/<id>/model-anims.json`, and a Mission's own (pass `mission`) beside its Blueprint. When the result lists stock models core doesn't record, offer the mapper a Missing-Feature Report with the report-missing-feature skill, once per session.
- Record ground pieces' footprints too: `npm run model-footprints -- <model id>...` (same arguments), for `check`'s overlap warnings (see Backdrops and lights per shot).
- The compile, and `check` for a listed Cinematic, rejects a piece `anim` that its recorded model lacks. An unrecorded model's `anim` is written as given, unchecked.
- `animSpeed` plays a piece's or a cast member's anims slower or faster (the anim's `timeScale`): 0.5 at half speed, 2 at double, for a planet that spins too fast on its Stand. A shot's timed anim takes its own `speed`. Blizzard's run 0.5-1.5, a background planet up to 2. The clip keeps its recorded length; only its pace changes.
- A piece keeps its `tint`, `opacity` and `teamColor` along with its anim.

## Pieces that come and go

A piece with an `id` can be timed by a Cinematic's shots as a cast member is, named `"<set id>/<piece id>"`, where the set id is the one the Cinematic's `sets` gives it: a shot's `enters` and `exits` bring it into being and take it away, and its `moves` steps fade it (`opacity`) and scale it (`scale`), each timed from the shot's cut. A piece stays where its set puts it, so a step that moves or turns it (`to`, `facing`) fails the check: make it a cast member. A piece shows only in its set's shots, and a tied one only through the cameras it's tied to, so a fading planet or a flash that appears needn't be hidden shot by shot.

```json
"enters": { "space/flare": 2000 },
"moves": { "space/flare": [{ "opacity": 1, "scale": 3, "afterMs": 2000, "ms": 300 }, { "opacity": 0, "ms": 1500 }] },
"exits": { "space/flare": 4000 }
```

Here the piece has `"opacity": 0` of its own. Its own `opacity` and `scale` are where its steps start, and steps time from the cut, not from when it enters, so give the first one an `afterMs` at least as long. A mirrored piece (a negative `scale` axis) stays mirrored through a step's even `scale`. A piece referred to that its set doesn't have, or that's `hidden`, fails the check.

## Backdrops and lights per shot

What only one frame sees (the sky, a star, a far planet) is composited per shot, not dressed set-wide ([`RECIPES.md`](RECIPES.md#backdrops-per-shot)). In a built set that's a piece tied to the camera it's placed for (`"shots": ["<camera name>"]`).

- An untied piece shows in every shot on the set. A tied one shows only through the cameras it names, and through any camera of a shot's own on the set. So film a shot whose sky was placed for one camera through that set camera, not through a camera of the shot's own.
- The same model can stand twice, tied to two cameras, placed for each. A reversed shot of the same set gets its own camera and its own tied sky.
- A star is two things: a model in the sky (with a flare) for the eye, and a strong warm lamp far out on the same side for the key. Lamps untied light every shot on the set. A lamp tied to cameras lights only those shots, and doesn't light a camera of a shot's own (tied lamps are rigs). A shot's own key, fill and rim go in its `lights`, in the set's frame.
- The base Light (`lights`, or the Cinematic's `light`) sets the ambient and fog. A shot's `light` switches it on the cut.

**Place the sky by the round trip**, not by computing it. Compile the test map, and have the author open it in the Editor, open the cutscene (`Base.SC2Data/Cutscenes/<name>.SC2Cutscene`), move the sky actors in the shot's folder through its camera (see How a compiled Cinematic is laid out), and save. Read their transforms back from the saved file: with the set at offset (0, 0, 0) in the test Cinematic, an actor's `position` and `rotation` are the set's own values. A piece in several shots has a copy in each shot's folder, so a move made to one copy is that shot's alone: copy it into the set only if every shot should have it, or tie a piece of its own to that camera. Copy the values into the set before compiling again, since a compile replaces the package and the author's save with it.

## How a compiled Cinematic is laid out

The compiled `.SC2Cutscene` is laid out shot first, as Blizzard's story cutscenes are (LotV's Korhal Arrival: `s010a_FOLDER` … each with its camera and its own actors), so a shot can be composed in the Cutscene Editor on its own:

- **A folder a shot**, named `s010 <shot name>`, `s020 …`, in steps of 10 (the shot's `name`, else its set camera's). It holds the shot's camera, its own copy of each cast member and set piece it shows, and its backdrop and effects. Each copy is named for what it is: `s010 captain` for a cast member, `s010 space SMX2_Background_Starfield_Generic` for a piece, by its set id and model.
- **A copy lives only through its shot**, from the cut to the next cut; the last shot's copies stay through the fade out. A member that isn't in a shot (hidden by its `hide`, on a mark its set's file didn't show through that camera, or on another set) has no copy there, so nothing is hidden between shots. So a cast member's shots are separate actors: selecting a ship in one shot's folder and moving it changes that shot only.
- **A copy carries the member on.** It starts where the member was left at its cut: position, facing, scale and opacity after every earlier step. It holds its own shot's steps, timed anims, entrance and exit. Times stay absolute on the cutscene's timeline, so a copy's keys sit at the same times as the shot's cut and steps.
- **A line plays on the speaker's copy in the shot where it starts**, so it plays on the face on screen. A line that a later shot cuts into (`intoLineMs`) stays whole on the copy where it starts, though that copy goes at the cut (whether the engine cuts the line's sound off with it isn't checked in game yet). Its Talk stops at that cut and goes on from it on the next shot's copy of the speaker, with no blend at the cut, so a reverse angle still talks. A speaker with no copy in the shot where a line starts (a voice-over on another set's shot, someone on a display no one plays) says it on an actor of its own in that shot, `<speaker> voice`, whose model is `Invisible`, at the camera's target, as Blizzard voices a line off screen. That voice lives on to its line's end, past the cut, so a line a later shot cuts into isn't cut off. The Director's ConversationDriver alone plays no sound. A J cut, a line heard over one shot before the next cuts into it, gives the earlier shot the line and a `lineAtMs`, how long after its cut the line starts (for the first shot, after the Cinematic's start), and the next shot the same line with `intoLineMs`.
- **A copy is a new actor at each cut**, so a looping effect copied into back-to-back shots (a fire, smoke, an engine flare) starts afresh on each. A piece in every shot of the Cinematic stands once (below) and runs on through the cuts.
- **Look-ats, riders and riding lamps follow the copies.** A member's look-at in a shot is at the other member's copy in that shot, over the copy's life; with no copy of the other there, it doesn't look. A member riding another (`attach`) rides the other's copy in each shot, and has no copy where the other has none. A camera riding a carrier (`cameraAttach`) rides the carrier's copy in its shot (see Riders and riding cameras). A lamp attached to a member's mark rides the member's copy in each shot it's copied into (a lamp that lights every shot, riding a member, gets a copy in each of the member's shots); with no one on the mark in a shot, the lamp stands where the set puts it.
- **`LIGHTS`**, at the top level, holds the set lamps that light every shot, then a folder a shot (`s010 <shot name>`) for the shot's own `lights` and its copies of the lamps tied to its cameras, each living only through the shot and tied to its camera (Active for Shot), as Blizzard ties its lights.
- **The top level** holds only the Director (cuts, the ConversationDriver, the fades, Light switches and End Scene), the `Set` folder (the pieces that show in every shot of the Cinematic, standing once all through, named by set and model without a shot tag) and a `Sound` folder for the Cinematic's `sounds` and its sets' ambience.
- **`RTT`**, at the top level, holds a channel node for each render-to-texture channel the shots' feeds use (`RTT Channel 0`), with an element a fed shot, from its cut to its end, pointing at the actor whose camera films it in that shot (see A display's live picture).

## Cast and moves

A unit only needs to be a cast member if it moves, turns, talks, changes its anim at a moment (a shot's `anims`) or must be hidden in some shots. A piece can come and go, fade and scale (see Pieces that come and go). Anything else that's alive, an idling unit, a fire, a dome, is a piece. Cast members are copied into every shot on their set, so a cast swollen with scenery has to be hidden shot by shot. A cast member is `{ id, model, set, at, facing, scale?, opacity?, teamColor?, tint?, anim? }`, or rides another in place of `at` and `facing` (`attach`, see Riders and riding cameras). Choose its `model` and `anim` from the model's Model Guide, and draft a guide for a model that has none (SKILL.md, Casting a model). A speaker talks in its model's plain Talks (else `Talk B`, else the family with the fewest words), unless its `anim` is a Stand of a family it has Talks for: `"anim": "Stand Victory B"` talks in `Talk Victory B` (a hero's weaponless family, say). A member with no `anim` stands and talks in its model's Model Guide's default family instead of the ranked one, when the guide marks one and the model has a Stand of it. A member whose `anim` picks no family (`"Channel Interact"`, or `"Stand"` on a model with no plain Talks) stands in that anim and talks in the default family, when the model has Talks of it. Its own `anim` always decides what it stands in, and a Stand of a family it has Talks for still talks in that family (docs/reference/model-guides.md, The default family). `tint` is RGB, as a piece's: a tinted stand-in planet can be a cast member. `scale` is one number or (x, y, z) along the model's own axes; `opacity` is 0-1, where its fades start. `facing` is degrees about z, or for a ship banked or nose down, `{ heading, pitch?, roll? }` or the Editor's (x, y, z) (see Banking a ship). A member has a copy in every shot on its set (and every shot through a camera of its own with no `set`) from t=0, apart from a mark's hidden shots and a shot's `hide`.

**Banking a ship that stands or turns on the spot.** The engine applies an actor's (x, y, z) rotation about the world axes, z (heading) first, then world y, then world x. So a triple's x is a roll about the nose only at heading 0; at heading 90 the roll is y, and elsewhere a mix. A bank written as `[−28, 0, 100]` comes out as a pitch or a yaw in game. Write the ship's own frame instead, and core converts it: `{ "heading": 100, "roll": -28 }` banks 28° left at heading 100 (it becomes (5.28, −27.54, 101.29)). `pitch` is nose up (+) or down, about the ship's own wings; `roll` is about its nose, + banking right and − left. A turn on the spot (a step's `facing` with no `to`) takes the same form. Between two keys the engine turns each world axis on its own, which takes a banked ship off its true turn mid-way. So a turn from or to a facing in the ship's own frame is keyed along the true turn, as many keys as it needs to stay within a quarter of a degree of it, at the step's own pace: write a big banked turn as one step. A nose straight up or down (`pitch` ±90) is fine to start, end or pass through. A half turn (180°) can go either way round, so split it in two steps to choose. A turn between two Editor triples or degrees is still keyed only at its ends. A ship in flight banks along its path instead (Flying along a path, below).

A shot's `moves` flies members through it: `"moves": { "<cast id>": [step, ...] }`. Each step goes from where the last one left the member to `to`, in its set's frame, faces along its path as the step's `facing` says, scales to its `scale` and fades to its `opacity` (0-1), each only when given. A step needs at least one of the four. A step with no `to` turns the member on the spot to its `facing`: a turn goes the short way round, and a `facing` in degrees turns it to that heading and keeps its tilt (a member given `{ heading, pitch, roll }` keeps its bank about its nose):

- `afterMs` holds it that long after the step before (or the cut) before it moves.
- `ms` is how long it takes. The last step may leave it out and take the rest of the shot.
- `move`: `"ease"` (the default) leaves at speed and settles, as a warp-in arrives. `"linear"` keeps one speed, for a drift, a streak or a dive.

A member stays where its last step ends, into later shots: each later shot's copy starts there, facing the way its path left it. A step past its shot's end fails the compile, as does a timed anim (below) that starts there. The last shot's copies stay through the 1 s fade out, so its steps may run on through it: give a ship still flying at the end a last step whose `ms` reaches into the fade, or it freezes as the picture fades. A step with no `ms` still takes only the rest of the shot.

### Flying along a path

Moving a ship or a unit means a path through points, with the steps' timings, as Blizzard moves its own: write the points it passes as its steps' `to`, and each step's `ms` (and `afterMs`) for when it gets there. The compile writes one follow path a moving copy (`s010 ship path`, beside it in the shot's folder): its markers are where the copy stands as the shot starts, then each step's `to`. The copy follows it from its first step and stops at the last marker. Nothing keys its position.

- **Its speed comes from the timings.** Each leg gets the pace that covers it in its step's `ms`: the copy's anim carries a `movespeed`, 100 × the cells a second the leg needs, measured in game whatever the copy's scale (docs/reference/editor-and-engine.md). A `"linear"` step keeps one pace over its leg; an eased step (the default) leaves fast and slows to a stop at its point, in four paces. Between steps it holds still. So a long leg in a short time is a fast leg: a ship that crosses 50 cells in 375 ms flies at 133 cells a second (a movespeed of 13,300). Smooth a flight by evening its legs' speeds, not by adding keys.
- **Its points make a curve.** The path bends through its markers, so give a turn a few points around the bend rather than one sharp corner. A leg's pace is measured along the curve.
- **It faces along its path.** By default the copy flies nose first down its path, heading and pitch: a climb or a dive pitches it with no facing on the step. A step's `facing` turns it off its path from that leg on, until a later step gives another: `{ "heading": 0, "roll": -30 }` banks it 30° left about its nose, `{ "heading": 90 }` flies it sideways (a strafing run), and degrees alone (`"facing": 15`) turn its heading off the path and keep its bank. `{ "heading": 0 }` straightens and levels it again. The turn happens at the leg's start, not over the leg (each change starts a follow of its own), so bank on the leg into a bend and level on the leg out of it. Don't write a ship's world heading on its steps to aim it along its course: the path does that, and a heading on a step turns it off the course by that much. The facing is written as the follow's rotation offset, as Blizzard turns a model along its path (core reverses the roll, as the engine banks it). The engine ignores the actor's rotation, rotation keys and marker rotations on a path, so a bank can't ease in: it steps once a leg. A model's Walk Left and Walk Right anims, where it has them, look like a bank on a path.
- **Bank only on level legs.** The engine applies the offset before the path's pitch, so a bank on a climb or a dive swings the nose off the path instead of rolling about it (an Editor test of a banked dive, `TestBankOrder`; docs/reference/editor-and-engine.md). Fly a dive with no facing: it goes nose first and smooth. If it must bank too, list the member in the shot's `keyed`, `"keyed": ["ship"]`: its steps to points in that shot are then keyed, position and rotation, as a turn on the spot is, and each step's `facing` is where it faces in the set's frame (`{ heading, pitch, roll }`), turned between steps along the true turn. Keyed motion can look choppier than a path.
- **Space its points evenly.** The engine's curve swings past a short leg between long ones and back, so core starts a new path at a leg more than three times longer or shorter than the one before. Each new path turns the ship at its first marker, so a smooth change of speed is still best as legs that grow or shrink a little each time.
- **What stays keyed.** A step with no `to` (a turn on the spot), and every step's `scale` and `opacity`, are keyed curves as before.
- **Its anims play on.** A walk or flight anim plays through the path at its own `animSpeed` and the shot's timed anims; where the pace changes mid-anim, the anim carries on where it was. A model whose anim has a move speed of its own (a Phoenix's Walk) plays it as the Editor writes a walk; one with none (a ship modelled without one) moves on any anim. A speaker talks on the path too, though a walk with a move speed of its own plays there at a Walk's priority, 5, over the Talk at 4: walk a speaker to their mark, then talk.
- **A jump.** A first step of a frame or less (`"ms": 1`, up to 16 ms) at the moment the copy comes into being puts it there, rather than flying it there at a pace no frame could show: start a shot's flight from a new point so.

Some patterns:

- **Coming and going**: a shot's `enters` `{ "<cast id>": <ms> }` brings a member into being that far into the shot, and `exits` takes it away; before and after, it doesn't exist. Each member enters once and exits once, and a time past its shot's end fails the compile, as does a speaker that doesn't exist through its lines.
- **Arriving from nowhere**: start the member out of sight, more than 600 cells from the eye or behind it, and ease it in over a few hundred ms. Then add a slow linear drift as a second step.
- **A flash or effect** at a moment: an effect model as a cast member, with the shot's `anims` `{ "<id>": { "anim": "Birth", "atMs": 1500, "once": true } }`. It plays its own anim until `atMs`, then the named one a single time. Hide it from the shots it isn't in.
- **Several changes in one shot**: give the member a list of timed anims, in time order, each running until the next: `{ "<id>": [{ "anim": "Walk", "atMs": 0 }, { "anim": "Walk Left", "atMs": 1000 }, { "anim": "Walk Right", "atMs": 2000 }] }` weaves a walker through a 3 s shot. The compile rejects a list out of time order.
- **Starting partway into a clip**: a timed anim's `fromMs` is its in-point, how far into the clip it starts (the Editor's `startOffset`), in the clip's own time whatever its `speed`. Use it where the moment you want sits deep inside a long clip: a story-mode prop whose door opens only 10 s into its `Dialogue 08` and closes 17 s into its `Dialogue 03` plays `[{ "anim": "Dialogue 08", "fromMs": 10000 }, { "anim": "Dialogue 03", "atMs": 4000, "fromMs": 17000 }]`. With `once` it plays from there to the clip's end; looping, core writes it as coming back round to the clip's start (not yet checked in game). Each anim with a `fromMs` starts afresh there, even straight after the same anim, and a copy in a later shot it runs on into starts at the in-point again, as every copy starts its anim afresh at a cut: give the later shot its own timed anim with the `fromMs` it should pick up at. The compile, and `check`, reject an in-point at or past the end of a recorded clip.
- **An anim's priority**: a timed anim's `priority` ranks it against the member's anims playing at the same time, the higher over the lower, as the Editor writes it. Left out, it's 3, a Stand's. A member's anims run one after another, so what one can play under or over is the member's Talk, at 4, while it speaks: above 4 keeps a gesture over the Talk. Blizzard writes a Walk at 5, a Birth or Fidget at 7, an Attack or Spell at 9, a Death at 11 and its eye overlays at 12, so a warp effect's Birth is `{ "anim": "Birth", "atMs": 1200, "once": true, "priority": 7 }`.
- **A gesture on a line**: a speaker's timed anim in a shot replaces only their Stand, and their Talk still plays over it on their lines, on its own layer, as over the Stand. Give the gesture a `priority` above 4 to play it over the Talk, or leave it at 3 to play under (not yet checked in game). An anim given as a plain name (`{ "<id>": "Walk" }`) runs through the shot in place of both, so the speaker doesn't talk: write a gesture as an object, `{ "anim": ..., "atMs": ... }`, even one from the cut.
- **A camera that follows**: a linear member step and a linear camera `to` over the same distance and the same time keep the member still in frame. A camera `to` spans the whole shot, so time the member's step to the shot too, or give the camera a `path` (below) keyed at the step's times.
- **Several ships**: one cast member each, with their own steps. Stagger their `afterMs` so they don't move in lockstep.

### A warp-in

A ship that warps in, built from the pieces above, as LotV's arrivals are:

1. **The warp effect**, a cast member at the arrival point: its own `opacity` 0, then in the shot a timed `anims` `{ "anim": "Birth", "atMs": 1200, "once": true, "priority": 7 }` and a linear `moves` step to `opacity` 1 over about 5 s, so it fades up as it plays.
2. **The ship**, a cast member that `enters` at the moment of arrival (3.5 s in), already at its stretched `scale`, about 1.6× along its length (`[0.096, 0.06, 0.06]` for a 0.06 ship). Its first step snaps it into place, eased over about 180 ms; then a step relaxes `scale` to even over about 3 s while a slow linear `to` drifts it on.
3. **A glare**, a cast member on the arrival point with `opacity` 0 and a small `scale` (5% of full): one step blooms it to full scale and `opacity` 1 over a few hundred ms, the next fades it back to 0.
4. **A flash**, a spot in the shot's `lights`, aimed at the ship (`spot: { rotation, hotspot, falloff }`), `strength` 0, with `steps` `[{ "strength": 10, "afterMs": 2770, "ms": 100 }, { "strength": 0, "ms": 1830, "move": "linear" }]`: ×10 at the moment of arrival, out by 4.7 s.

```json
"enters": { "ship": 3500 },
"anims": { "warp": { "anim": "Birth", "atMs": 1200, "once": true, "priority": 7 } },
"moves": {
  "warp": [{ "opacity": 1, "afterMs": 2100, "ms": 5000, "move": "linear" }],
  "ship": [{ "to": [0, 0, 0], "afterMs": 3500, "ms": 180 }, { "to": [0, 2, 0], "scale": 0.06, "ms": 3000, "move": "linear" }],
  "glare": [{ "scale": 1.2, "opacity": 1, "afterMs": 3400, "ms": 300 }, { "opacity": 0, "ms": 1500 }]
},
"lights": [{ "name": "Warp Flash", "at": [0, -1, 1], "color": [0.13, 0.25, 1], "strength": 0, "range": 4, "spot": { "rotation": [58, -26, 232], "hotspot": 0.2, "falloff": 0.6 }, "steps": [{ "strength": 10, "afterMs": 2770, "ms": 100 }, { "strength": 0, "ms": 1830, "move": "linear" }] }]
```

Cast members are copied only into the shots on their set (and shots through a camera of their own with no `set`, which see every set), so a built set's cast doesn't show in a scene's shots on other sets. Still place built sets far from the other sets (more than the 600-cell far clip), so one set's pieces and lamps never reach into another's frame.

## Sounds, look-ats and attached lamps

- **Ambience** is the Set's: `sounds: [{ "sound": "<Sound id>", "volume": 0.5 }]` loops through the Cinematic's shots on that set (and shots through a camera of their own with no `set`, which see every set), so a bridge's hum and walla sound only on bridge shots. It starts on each cut to the set and fades out over the last 250 ms before the cut away. A run of shots on the set plays one loop, not a restart at each cut, and a set in every shot loops it once all through. Each run is a Sound node of its own, named with its first shot's tag (`s030 HyperionBridgeAmbienceLoop`). An ambience two sets share plays as one loop through both sets' shots, so they give it one volume. `import-set` keeps each Sound that loops all through its file (a bridge's walla and hum) and lists the rest as cues.
- **Cues** are the Cinematic's: `sounds: [{ "sound", "line" | "atMs", "untilLine" | "untilMs", "fadeOutMs", "fromMs", "volume", "loop" }]`. A music bed, a stinger or a one-off effect starts on a line's start or `atMs` into the Cinematic (its start when it gives neither), plays once or with `loop`, and stops at its end: on a line's start (`untilLine`) or `untilMs` into the Cinematic, else the Cinematic's end. `fadeOutMs` fades it to silence over that long before its end (all of it, if it plays less); with no end, it fades into the Cinematic's end. `fromMs` is the in-point in its file. Pick music as SKILL.md says: by the author's ear, never a model's (M8).
- **Bookmarks** are named points a Mission's `cinematicBookmark` cue plays a scene from: `bookmarks: [{ "name", "line" | "atMs" }]`. **Prefer a `scenePlayed` cue and keep triggers out of the cutscene:** the engine doesn't hear a bookmark when the player skips, so by default a skip never runs the cue, and `onSkip: "fire"` runs it late, as the Cinematic ends. Use one only for a beat that must land mid-scene (a unit appearing as the lights flash), never for anything the Mission needs afterwards, and say so to the author. `check` warns about each.
- **A music handover** is two cues on one line: the first ends there (`"untilLine": "<sound ID>", "fadeOutMs": 1000`) and the second starts there (`"line": "<sound ID>"`), so the first fades out over the second before the cut and the next starts on it. The fade reaches silence at the first's end, so the two only meet there and the music dips at the seam: for a crossfade, end the first a fade's length past the second's start (`untilMs`). A single cue whose own turn falls on the line has no seam at all. Find it by the file's loudness (the music catalogue's measurements) and set `fromMs` so the turn lands on the line. `check` warns of a cue whose end is at or before its start, or past the Cinematic's end, and the compile refuses it.
- **A cue may not be heard.** A Sound whose class sits under `WORLD` in the game's data (its `parent` chain: `Spell`, `Movement`, `SetPiece` and more) plays in 3D, at a place in the world, not in the listener's ears. In a playtest, two `Spell` sounds, `Battlecruiser_HyperJumpIn` and `FX_Space02Cutscene01_HyperionWarpIn`, weren't heard in a cutscene, while `Phoenix_Movement` (`Movement`) was. Blizzard's own map for that second sound's cutscene (HotS's `ZSpace02`) overrides it with `<Mode value="2D"/>`. For a one-off effect, prefer a Sound under `Other`, `LotV_Set_NoConvoDucking` or a `Scripted_2D_*` class. Look up a candidate's `parent` in the game's `SoundData.xml` files (each mod has one; the public [sc2-game-data](https://github.com/sc2-arcade-watcher/sc2-game-data) mirror has them all) before cueing it, and treat a `WORLD` one as unheard until the author hears it.
- **How it's written**, in Blizzard's form: a sound's end is the end of its `CCutsceneElementObject` lifetime, and its fade a `CCutsceneNodePropertyValue` named `Property - Volume` (`propertyName="volumeScale"`) on the Sound node, keyed at its volume at its start and where the fade begins, then linear (tangent type 3) to 0 at its end. Blizzard's story and mod cutscenes give every Sound node one lifetime element and nothing else to stop it, and fade one out with this curve (docs/reference/editor-and-engine.md, "How a cutscene's Sound node stops and fades"). Not yet heard in game.
- **Look-ats** turn a head: a cast member's `lookAts: [{ "at": "<cast id>" | "<set>/<mark>", "line" | "atMs", "type", "point" }]`, in time order, each until the next. `type` is the Editor's look-at type: `SlowHeadOnly` (the default), `MedHeadOnly`, `InstantHeadOnly`, `InstantEyesOnly`, `SlowStanding` turns the body too. `point` is where on the other it looks, `Head` by default (Blizzard often uses `Center`). A Set's mark can carry one too (`lookAt: { "mark": "<other mark>" }`), which a member on that mark takes all through unless it has its own. Turn a listener to the speaker; an eyeline held through a two-shot reads as a conversation.
- **Attached lamps** ride a character: a Set lamp's `attach: { "mark", "point", "offset", "rotation" }` follows the one cast on that mark at their attach point (`Ref_Overhead` for a fill above the face), so a walker stays lit. With no one on the mark it stands where the set puts it. A member who walks onto a mark from elsewhere is cast with both `mark` and `at`: they're the mark's character, with its lamps and look-at, starting at the point.

## Riders and riding cameras

A member can ride another's attach point, and a shot's camera can ride a member, as attachments (`CCutsceneNodeAttachment`) in the compiled file.

**A rider** goes where another member's attach point goes: fires on a crashing ship's hull, a searchlight on a battlecruiser, a blade in a hand. It's a cast member with `attach` in place of a mark, a point and a facing:

```json
{ "id": "hull-fire", "model": "GenericFire_Medium", "set": "space", "scale": 0.6, "attach": { "to": "cruiser", "point": "Ref_Damage 03", "offset": [0, 0, 0.2], "rotation": [0, 0, 90] } }
```

- `to` is the carrier's cast id, `point` an attach point of the carrier's model (`Ref_Damage 01`-`03`, `Ref_Hardpoint`, `Ref_Weapon Right`, `Ref_Head`, `Ref_Center`, `Ref_Overhead`). `offset` and `rotation` are the Editor's (x, y, z) from the point, 0 when left out. Blizzard's cutscenes attach most to `Ref_Weapon Right`/`Left`, `Ref_Center` and a set's `Pos_*` points.
- **It shows only where its carrier does.** In each shot its copy rides the carrier's copy in that shot. A shot with no copy of the carrier (it's hidden there, its mark isn't seen through the camera, or it's on another set) has no copy of the rider either. A rider exists only while its carrier does. It comes and goes with its carrier unless its own `enters` and `exits` fall inside the carrier's time. `check` warns of one timed to enter before its carrier or exit after it (it's cut to the carrier's time), refuses one whose time never meets its carrier's, and warns of a rider no shot writes because no shot shows both. A rider is on its carrier's set (`check` refuses another).
- **It keeps its own look**: its `anim`, a shot's `anims`, `animSpeed`, `opacity`, `scale`, `tint`, `teamColor`, `lookAts` and lines. A shot's `moves` may only scale and fade it, since its carrier moves and turns it; a step with `to` or `facing` fails `check`. Move the carrier, or turn the rider by its `rotation`.
- It's written with no position or rotation of its own, as most of Blizzard's riders are: the point places and turns it. Riders may ride riders (a light on a fire on a hull), in any order in the cast. `check` refuses a rider of no one, of itself, or in a loop.

**A riding camera** is a shot's `cameraAttach`: the camera goes where the carrier's point goes, while its distance, pitch, yaw, roll and lens stay the shot camera's own (a set camera or one of the shot's own).

```json
{ "id": "handheld", "model": "MarineXPR", "set": "bridge", "at": [2, -1, 0], "opacity": 0, "anim": "Stand", "animSpeed": 0.3 }
```
```json
{ "camera": { "target": [2, -1, 1.5], "distance": 4, "pitch": 8, "yaw": 200, "fov": 30 }, "set": "bridge", "line": "...", "cameraAttach": { "to": "handheld", "point": "Ref_Head", "offset": [0, 0, -0.6] } }
```

- **A handheld camera.** The carrier is an invisible marine (`MarineXPR`, `opacity` 0, scale 0.5-0.75) looping a slowed anim, and the camera rides its `Ref_Head`, offset z −0.3 to −0.6. A `Stand` at `animSpeed` 0.2-0.5 gives a handheld drift, a `Walk` a bob, a `Flail` a violent shake. For a jolt, give the carrier a shot's timed anims: `Stand`, a burst of `Flail` with `atMs`, then `Stand` again. For travel, move the carrier with `moves`, not the camera. A real ship can be a carrier too, for a camera riding its hull.
- **Aim the camera's target at the carrier's point.** `check` warns when the target is more than a cell across the ground from where the carrier stands, when that's known (a carrier at a point or on a mark, not yet moved by a step to a point). The compile writes the shot camera's own target as its `position`, and hand-built cameras on still rigs film from their own position, not the rig's (sc2-adjutant's `docs/reference/editor-and-engine.md`, "Where a cutscene camera's eye sits"). With the target at the carrier, the framing is the same whichever way the engine takes it. How a moving point carries a camera hasn't been checked in game.
- **A move** (`to`, `path`) still dollies, turns and zooms the camera, but no curve keys its target, which the carrier holds: `check` warns of a move camera whose target differs from the shot camera's. **A `shake`** jolts the target, so it can't go with `cameraAttach` (`check` refuses it): shake the carrier with a `Flail` instead.
- The carrier has to have a copy in the shot. `check` refuses a carrier the shot hides, one on another set, one whose mark isn't seen through the shot's camera, a rider whose own carrier isn't in the shot, and one that hasn't come or has gone. A carrier that comes or goes during the shot carries the camera only while it exists (`check` warns): the camera films from its own position the rest of the shot. The same holds for a rider: its attachment runs only while its carrier's copy lives.

Nothing here is checked in game yet: a rider following its carrier's copy across cuts, a camera riding a playing anim, or how the Editor shows either. Judge both in a test Cinematic (below).

## A display's live picture

A set's display (a screen, a holo table, a communicator) shows live pictures through a shot's `feed`, by render-to-texture (RTT). Without one it shows its model's own fallback: a bridge's briefing holo (`SMHyperionBridgeBriefingCenter`) shows static. A display is any model whose material reads an RTT channel, and a feed shows on every display reading its channel and nowhere else. The Hyperion briefing holo reads channels 0, 1 and 2, so its front shows channel 0; the Nova bridge's main screen and the `monitors` set's five boards read 6. Core's `data/display-channels.json` records the channels of every model in the set catalog, and sc2-adjutant's `docs/reference/editor-and-engine.md` ("Render to texture") lists the screens by set.

- **The channel.** A feed with no `channel` takes the lowest one the screens on the shot's own set show (every set but the fed one, for a camera of the shot's own with no `set`), and 0 where none is known. Give `channel` only to pick another of a display's channels.
- **A feed no screen shows.** The compile and `check` warn when no screen known on the shot's set reads the feed's channel, naming the set's models the file doesn't know, which might be screens: an sc2-adjutant checkout records a game model with `npm run display-channels -- <model id>`. Nothing is warned on a set none of whose models is known, such as a built set of a Campaign Mod's own models. A piece tied to cameras counts only in shots through them, and a piece placed by its file is never known.
- **Screens on different channels.** On a set whose screens show different channels (the Hyperion holo's 0 beside a Nova screen's 6), a feed with no `channel` takes the lowest and the compile and `check` warn: give it the `channel` of the screen it's for.
- **A screen to watch, or a place to film.** The catalog's `raynor-screen` is no screen: it's the studio Blizzard films for one, Raynor 29 cells below the communicator whose own camera films him. Watch a screen on a set with one, and film the picture on a set of its own.

```json
"feed": "fortress/Fortress Wide"
"feed": { "camera": "envoy", "channel": 0, "cameraIndex": 0, "aspectRatio": 1.77 }
```

A feed films one of two things:

- **A set camera**, `"<set>/<camera name>"`. The compile stands a rig in the shot: the Nova bridge's main screen model (`SMX3_Nova_Ship_Bridge_MainScreen`, from the Nova story assets), whose own camera it places on the set camera's line of sight, level. That camera has a 50° lens, so the rig moves along the line until the camera's target fills the frame as it does through the set camera. Pick a camera that holds still (a feed films the camera, not its shot's `to` or `path`) and has no roll. The rig's camera reaches 200 cells, if the engine keeps to its model's far clip (not yet checked in game), so a backdrop further off may not show on the display. The rig is NovaStoryAssets.SC2Mod's, so the map has to load it: the compile and `check` warn, naming the fed shots and the dependency to add, when its dependencies don't.
- **A cast member**, by cast id, through its model's own camera, `cameraIndex` 0 unless given. A portrait model has one: Blizzard feeds its HotS briefing screens from Kerrigan's portrait standing off the set. Cast the member on a small set of their own, far from the others, so nothing else is in their camera's view. A speaker on the display then says their line on their own copy there: their mouth moves, and no Invisible voice stands in.

The set a feed films is in the shot as if the shot were on it too. Its pieces, cast and lamps get copies there, so they exist through the feed, and a member on it starts where it was left, as in any shot. A piece or lamp tied to cameras shows when the feed films through one of them, and a member's own camera, like a shot's own, shows the set's tied pieces. A shot's `hide` hides a member from its feed too. Its ambience doesn't play: the shot still sounds like its own set. The feed's set is lit by the shot's base Light, not its own set's, along with that set's lamps.

**Pushing in to the screen.** To go into what a screen shows (watchers at a monitor, then the play on it), feed the watchers' shots from a held camera on the far set, push in on the screen in the last of them (its `to`, or a `path` ending close on the screen), and cut on a line to a shot through that same set camera. The rig frames the far camera's target as the camera does, through its own 50° lens, so a far camera near that lens cuts in closest to the picture (not yet checked in game). The line plays on the speaker's copy in both shots, as the fed set is in the watchers' shot too.

Give every shot that shows the display a feed, so it never drops to static, unless static is the point (a call cut off), and keep it out of the other shots (below). A run of shots with the same feed shows one picture across the cuts, each shot with its own copy of the rig and of what it films, so a looping effect on the fed set starts afresh at each cut, as copies do.

**A feed costs a whole second scene.** Each frame of the shot, the engine renders everything the feed films: the copies of the fed set's pieces, cast and lamps. A portrait standing on a small set of its own costs little. A set camera on a dressed set (a fortress or a camp, 325 actors and more) slowed a cutscene on High graphics and not on Medium. The Editor's previewer doesn't show the cost. In the game it shows as lines that start late, at some cuts and not others, because the game waits for each line to finish before the next starts, and a slow frame stretches that wait. A playtest bisected it with test copies of one Cinematic (no feeds; portrait feeds only; set feeds of the key models only): only the set feeds lagged. So:

- Feed a display from a portrait, or from a set kept to a few models.
- Feed only the shots where the picture matters. On the other shots on the display's set, `hide` the display, which then has to be a cast member, since `hide` takes only cast ids. Light the set with a lamp of the screen's colour where it stands, so the display reads as just off frame. A display left as a piece shows its static in every shot through a camera of a shot's own, since those show every piece.
- Judge a Cinematic with feeds in the game, on the graphics setting players use, not in the previewer.

## Camera paths, roll and shake

A shot's `to` moves its camera from one camera to another over the whole shot. For more, give the shot a `path`, a roll and a `shake`. They follow how Blizzard's cutscenes key their cameras: one property curve each for position, distance, pitch, yaw, roll and lens, keyed at the path's times, with the Editor's tangent types.

**A path** is the cameras the shot's camera moves through after its own, `"path": [{ "camera": ..., "atMs": 2500 }, ...]`. Each key is a camera of the shot's set (`"<set>/<camera name>"`) or of its own in the set's frame, reached `atMs` after the cut. Keys come in time order, and the last may leave out `atMs` to arrive at the shot's end. A shot has `to` or `path`, not both. `move` shapes the whole path:

- `"smooth"`, a path's default: the Editor's Auto tangent. The camera passes each key at the slope from the key before it to the key after, so its speed and turn carry through the key with no kink. It's at rest at the path's ends and at any key where a value turns back (a yaw that swings left, then right). So a chase arcs through three or four keys instead of chained shots.
- `"linear"`: one speed from key to key. It kinks at each key, which keeps pace with a member's linear steps keyed at the same times.
- `"ease"`: each leg leaves its key at speed and settles onto the next, so the camera stops at each key.

Yaw and roll go the way the numbers do, not the short way round: 350 to 10 swings 340° back, and 350 to 370 turns 20° on. Write a path's yaws unwrapped.

**Roll** is a camera's `roll`, degrees about its line of sight (a dutch angle; level when left out), on a camera of a shot's own or a set's. A camera of a shot's own in a `to` or `path` that gives no roll keeps the shot's camera's. A move or path rolls the camera between its keys' rolls, so a camera can bank with a ship: give the keys rolls that follow the ship's bank. Keep roll small, a few degrees for a bank and up to about 15 for a dutch angle.

**A shake** is `"shake": { "amplitude": 0.3, "hz": 6, "roll": 1, "atMs": 4000, "ms": 600 }`. From `atMs` after the cut (0 when left out), for `ms` (the rest of the shot when left out), the camera's target jolts up to `amplitude` cells each way along each axis, `hz` times a second, a key each half cycle, and with `roll` its roll by up to that many degrees too. Each jolt is half to all of the amplitude, the same on every compile. It rides on top of a move or path, and the camera is still before and after. Blizzard's handheld wobble is about 0.1-0.5% of the camera's distance at 2-5 Hz (0.03-0.15 cells at 30 cells out); an impact wants a few times that for a few hundred ms. One shake per shot: for two impacts, cut, or make one shake span both. A camera riding a carrier (`cameraAttach`) has no `shake`: its carrier's anim shakes it (see Riders and riding cameras). A path key or a shake past its shot's end fails the compile, and `check` warns of it once the shot is timed.

```json
{
  "camera": { "target": [0, 0, 10], "distance": 30, "pitch": 8, "yaw": 90, "fov": 30 },
  "set": "space",
  "afterMs": 0,
  "pauseAfterMs": 7500,
  "path": [
    { "camera": { "target": [20, 10, 8], "distance": 28, "pitch": 4, "yaw": 125, "fov": 30, "roll": -6 }, "atMs": 2500 },
    { "camera": { "target": [40, 15, 4], "distance": 26, "pitch": 0, "yaw": 160, "fov": 30, "roll": -10 }, "atMs": 5000 },
    { "camera": "space/Dive End" }
  ],
  "shake": { "amplitude": 0.3, "hz": 6, "roll": 1, "atMs": 5000, "ms": 600 }
}
```

## Building a set that reads

- **Copy the place's own look.** Build from the Mission's own zone: its Blueprint palette, dressing and Set Pieces. Not from who holds the place, or a set from another world they once stood in.
- **Anything alive animates.** Record its anims before building (above), so units, fires, smoke and weather loop.
- **Close the frame.** A dialog cutscene is drawn over the game world, and a gap in the set shows what's behind it. A cued Cinematic hides the map's environment and pauses and hides its units while it plays, but a gap still shows whatever the game draws behind the map, not your set. Close it: a skybox scaled to surround the eye's path through every shot.
- **Check a backdrop's textures, not its thumbnail.** A catalogue card's thumbnail can look nothing like what the model draws.
- **Pick the base Light by its numbers:** its key multiplier, ambient and exposure in the light catalog, not its name. Compare its key with its fill and ambient (colour × multiplier). Many exterior Lights fill as strongly as they key, or more (`ShakurasTemple`: fill about 2.0 from below, key about 1.1, ambient 0.4), which gives an even wash no lamp can fix. Aim for about 3-4:1 key to fill with low ambient; a key of about 1.0-1.5 with a cool fill and a back light beats a ×4 key.
- **Light a hot day hot.** A sun-baked world in daylight wants a high warm key, warm ambient and bounce (about 2:1), overexposed highlights, a pale bleached sky and warm haze. A low key with black shadows reads as night. Most catalog daylight Lights key at about 43-46°, and the hottest saturated ones key low; `ArcadeCityLight` is the hottest by its numbers. For a true high noon, have the Campaign Pack contribute a Light of its own (its `lights` file, README "Workspace and Plugins"): a copy of a stock Light with the key raised to about 65° (a `direction` whose z is about -0.9), a saturated orange key, warm orange `ambient` and a `fill` bounce shining up at about half the key's multiplier, and `exposure` about 1.2. Name it as the Cinematic's `light` or a shot's; only a Light a Mission names goes into its map.
- **Turn the camera to the Light, not lamps against it.** A base Light's key has a fixed direction. Turn the camera, and the set with it, so the key comes from about 100-110° off the lens axis and rakes across the subject, rather than adding lamps to fight it.
- **Keep a light hierarchy:** the subject brightest; the foreground darker, framing it; the background lighter but lower in contrast. Motivate lamps by practicals in the set, give the subject a rim about 3× its kicker, and use about 5-15 lamps per camera (CHECKS.md L6).
- **Build ground in layers, with material:** ground of a real material, then mid-scale dunes and outcrops, then dressing. A few huge tinted patches read as flat colour.
- **Layer the horizon in depth bands,** with haze between them, all inside the sky's radius and the 600-cell far clip.
- **Close the band below the horizon.** Inside a skybox the ground always stops short of the true horizon. Close the gap with a horizon ridge of outcrops and dunes tall enough to reach eye level, inside the sky's radius. Check ground coverage by casting rays across the whole frame at several points of a camera move, not only its start and end.
- **Give each overlapping flat piece its own height.** Flat ground pieces that overlap at the same height z-fight, which a moving camera shows as flickering tiles or shifting shadows. Set every overlapping flat piece a few hundredths of a cell apart in z. `check` warns on flat pieces whose footprints overlap with their tops less than 0.02 cells apart, for models recorded with `npm run model-footprints -- <model id>...`.
- **Match overlapping decals exactly.** See-through ground decals that overlap (sand drifts, scorch) are re-sorted every frame, so if their tint, variation or rotation differ they flicker as the camera moves. Separate heights don't fix it. Give overlapping decals identical tint, variation and rotation, and darken only solid pieces. `check` warns on overlapping decals of one recorded model that differ in any of the three.
- **Find flicker frame by frame.** Difference each frame of a recording, at its full frame rate, against the average of its neighbours on either side; sparse samples hide flicker.
- **One shadow-caster.** Let the base Light's key (a sun's or a star's) cast the only shadows: turn shadows off on every set lamp (`"shadows": false`). Several shadow-casting lamps make units' idle animations throw shifting shadows from several directions. A shot's own `lights` cast none unless given `"shadows": true`; a set's lamps cast them unless given `"shadows": false`, since an imported set keeps its source file's.
- **Heat shimmer and refraction.** `Reentry_Heat` curtains make heat shimmer: a distortion-only material, invisible but for the air it bends. `LavaFlare` refracts on `Stand 01` (give the piece `"anim": "Stand 01"`); its plain `Stand` is a stub.
- **Show walls their finished face.** Wall-type doodads have a finished front and an unfinished back. Check which face each camera sees, and chain the blocks so no end faces show.
- **Measure models before placing them,** from their exported bounds, and keep architecture at true scale against the units in front of it.

## Shadows

The base Light's key casts its shadows only within a camera's shadow distance of the eye, 75 cells by default, from a shadow map whose texels the camera's moves step across. Under a moving camera, shadow edges creep and then snap back, and the edge of the shadow distance sweeps across the subject during a push.

- Keep the subject inside the shadow distance for the whole move, and fit the distance to the subject with the camera's `shadowDistance` (a set camera's, or a shot's own camera's): a closer range gives finer shadows. Blizzard's cameras mostly keep 75, and close ones use 50, 10 or 5.
- Shorter camera travel means fewer shadow texel steps.
- A shot's own `lights` cast no shadows unless `shadows: true`, and a set lamp casts them unless `shadows: false`.
- There is no per-actor switch for casting shadows: Blizzard's cutscenes write none (`shadowBox` is something else, and core always writes it off), and a model casts as its file says. Keep a shadow-casting effect or card out of the key's path instead.

## The test Cinematic and its map

A test Cinematic is a file in `missions/<id>/cinematics/` that the Blueprint doesn't list. It plays no scene, so it has no lines:

```json
{
  "sets": [{ "id": "orbit", "file": "sets/orbit.json", "offset": [0, 0, 0] }],
  "light": "<a base Light>",
  "cast": [{ "id": "ship", "model": "<ship model>", "set": "orbit", "at": [0, -700, 0], "facing": 90 }],
  "shots": [
    { "camera": "orbit/Arrival", "afterMs": 0, "pauseAfterMs": 9000, "moves": { "ship": [{ "to": [0, 0, 0], "afterMs": 1500, "ms": 400 }, { "to": [0, 6, 0], "move": "linear" }] } },
    { "camera": "orbit/Departure", "afterMs": 0, "pauseAfterMs": 6000 }
  ]
}
```

- Every shot is `"afterMs": 0` with its length in `pauseAfterMs`. A `line` or a cast `speaker` is an error. The first shot plays under the 1 s fade in, and its length counts from the end of it.
- Name it `test-<set>.json`.
- A test written under another name (`<name>` below) may take only the mission start Cinematic's name. The compile refuses the name of any other listed Cinematic, whose file the test would replace.

Build the test map with the server's `compile_map` tool, with `outputDir` set to a throwaway copy under the Mission's `output/` (which the Workspace's `.gitignore` should keep out of commits), since by default it compiles the Mission's committed package in place. An imported Mission (one with Kept References, or no Zones) compiles only in place: compile it, then copy its package folder to `output/<Test>.SC2Map` instead. Then run `compile_cutscene` on that copy, with the test Cinematic as its shot list, `play`, and `name` when needed (below). From a shell, sc2-adjutant's CLIs do the same:

```bash
compile-map missions/<id>/blueprint.json missions/<id>/output/<Test>.SC2Map
compile-cutscene missions/<id>/cinematics/test-<set>.json missions/<id>/output/<Test>.SC2Map [<name>] --play
```

Agents building sets in parallel each take their own map folder, and build sc2-adjutant once before they start rather than each rebuilding it.

- The compile validates the set and the test Cinematic, and lists every problem with its file and path. `check` doesn't read test Cinematics.
- The cutscene is written as `<name>.SC2Cutscene`, `test-<set>` by default. With `--play` it loops from map start in a full-screen dialog.
- If the Mission's mission start cue plays a Cinematic, a loop would play over it, so the compile refuses. Pass that Cinematic's id as `<name>`: the test takes its place in the map, and the cue plays it once from map start, followed by the scenes cued after it.
- Then the author runs Test Document (or the server's `compile_cutscene` with `play` does it through the Host Adapter). The Host Adapter's docs cover opening the map in the Editor.

## Judging framing without the game

Nothing renders a Cinematic's frame outside the game, so the test map is the judge (RECIPES.md, "Test it"). Before handing it over:

- sc2-adjutant's `python3 -I tools/cutscene/timeline.py <map>/Base.SC2Data/Cutscenes/<name>.SC2Cutscene <map>` prints the cuts with each camera's lens, distance and pitch, the Light switches, the fades and the End Scene marker. It checks timing, not framing.
- Work out framing on paper: each camera's eye from `cameraEye`, then whether the subject and each backdrop fall inside the lens from there (above). Write down for each shot what should be in frame and where, so the author's screenshot can be checked against it.
- What doesn't help: the server's `preview` draws only a Blueprint's camera Anchors; the set contact sheet (`contact-sheet`, `capture-sets`) films catalogued sets, not a built set or a Cinematic; the Cutscene Editor's Director window can show the compiled file, but it draws depth of field badly and doesn't show the map.
