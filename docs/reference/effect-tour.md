# The effect tour

The effect tour films the game's effect models (`Assets/Effects`) in the game itself, for an effects gallery: the charge-ups, impacts and auras a mapper picks for an actor. A renderer can't do it. Blender with m3studio draws an effect's meshes but none of its particles, ribbons or lights. WhiteoutFlakes, the viewer behind the doodad thumbnails, lists SC2 effects as missing. Most of what an effect is, is particles.

Code: `packages/core/src/capture/effect-tour.ts` (planning and the batch script) and `src/cli/effect-tour.ts` (the command).

## Running it

```sh
npm run effect-tour -- base                       # compile the flat test map, into missions/effect-tour (git-ignored)
npm run effect-tour -- make --models <folder> --base missions/effect-tour/Effect-Tour.SC2Map --out <out>
npm run effect-tour -- capture <out>              # film every batch through the Editor Broker
npm run effect-tour -- recut <out> <cut>          # cut the clips and pick the frames again, into a new folder
```

- **`base`** compiles a 256 × 256 flat floor, with Void (Campaign) as its only dependency (a few effect files are in that campaign's own assets). The view never reaches its edge.
- **`make`** reads each `Assets/Effects` model that core's `game-models.json` names, from a folder of the install's files extracted with a CASC extractor (`tools/README.md`: `"$SC2_CASC_TOOL" -S <install> -I 'assets\\effects\\.*\.m3$' -x -o <folder>`, about 2,000 files and 226 MB, in seconds). It leaves out Glazes: a glaze is a material laid over another model, so on its own it draws nothing. It writes batch maps of 120 effects each into `<out>/batch-NN/`, each with a `manifest.json` of its frames.
  - **`make --folder <folder>`** films every `.m3` under `<folder>/Assets/Effects` instead, for models that aren't in the game. Each batch map imports its models, and the textures they name from `<folder>/Assets/Textures`. `tools/effects/prepare-hots-effects.py` extracts Heroes of the Storm effects and converts them that way.
- **`capture`** films each batch through the Editor Broker (Test Document) into `<out>/batch-NN/frames/`. Only a batch that runs to its end gets its `index.html`, a contact sheet with one row per effect. A re-run skips the batches that have one, so a run that stops partway carries on where it stopped.
  - **`capture --quit-other-games`** is for unattended runs. A game the tool didn't start, such as a test game left open, makes every batch refuse with `A game is running that this tool didn't start`, since it may be the author's. With the flag each batch quits any such game first: the quit request, Yes, then a kill after 20 s. It logs each game's pid and command, then carries on. Two waits that would otherwise last all night give way to it too. A Test Document game the Editor Broker is holding its queue for is quit, so the hold ends. A broker built from an older version, which refuses the job (`speaks protocol N`), is waited out: the job asks again every minute until a broker of this version takes it. That broker is never stopped, since it may be running someone else's capture. The game is lost unsaved, so the flag is never the default. On 2026-11-25 a `Test/EditorTest.SC2Map` game left from a morning test stopped an overnight run this way.

As measured on 2026-11-23: all of the game's effects come to 1,313 models and 4,961 frames in 11 batches, about 4 h 20 min in game, plus 1–2 minutes to start each batch.

- **`pick <out>`** cuts the clips and picks the frames again from each batch's recording, in place.
- **`recut <out> <cut>`** does the same without the game into a new folder `<cut>`, with the same layout (`batch-NN/clips`, `peaks`, `frames`, `manifest.json`, `index.html`), so the gallery's import reads it as it reads a tour. `<out>` is only read: each batch's `frames/` is cloned, which costs no space on APFS. Its encodes run niced, two at a time (`--jobs <n>`), so it can run beside a capture. A batch already in `<cut>` with its `index.html` is skipped unless `--redo`; `--batches <a>-<b>` takes some of them.

## Clips and picked frames

Each clip is cut by phase (`effectCut` in `src/capture/effect-video.ts`) and its spans of the recording are joined into one clip. Most of a tour's recording is the holds the stills need, 1.5 s each plus the waits around it, where little moves. A clip keeps:

| Span | From | To |
| --- | --- | --- |
| `attach` | the base frame, the bare pad 0.8 s before the attach | the end of Birth, then 0.8 s of a looping Stand, or all of one that plays once |
| `move` | 0.55 s before the host starts to move | 0.3 s after it stops |
| `destroy` | 0.55 s before the plain `Destroy` | 1.25 s after it |
| `death` | 0.55 s before Death is played on the fresh copy | 0.3 s after Death ends, or before the copy is removed if that is sooner |

Each event's time is reckoned from the stop of the frame that follows it, less that frame's waits in the script. A stop is noted up to about 0.45 s late, so each span opens that much early. Spans that touch are joined, and the manifest records each clip's spans under `cuts`, in seconds into `frames/video.mp4`.

The picked frames are searched in the clip's spans, so each one's time (its caption in `index.html`) is into the clip. For most effects the search runs to the stand frame, before the host moves. A missile, or a model with ribbons, forms its trail only while it moves, so its search runs through the move too, and two of its four picks are kept for the moving frames with the most new bright pixels. A plain change from the base frame can't find a trail there, since the camera pulls back and follows the host and the whole ground shifts.

## Video quality and size

`capture --video` records the game window and cuts a clip for each effect from that recording. The gallery publishes a web-encoded copy of each clip, so the clips are masters and should lose as little as they can.

| | Size | Codec and quality | Where it is set |
| --- | --- | --- | --- |
| Recording, `frames/video.mp4` | 1600 × 900, the stills' size, up to 30 fps | HEVC, `AVVideoQualityKey` 0.9 | `VIDEO_SETTINGS` in `src/cli/effect-tour.ts`; the macOS host's recorder (`capture-tour.ts`) uses 0.9 when a request gives no `quality` |
| Clip, `clips/NNNN.mp4` | the recording's size | HEVC, `hevc_videotoolbox -q:v 90` | `CLIP_QUALITY` in `src/capture/effect-video.ts` |

- **At quality 0.5, particles smeared away.** The 2026-11-23/24 run recorded at 1280 × 720 at `AVVideoQualityKey` 0.5, which came to about 83 kbps, and cut 960 × 540 clips at `-q:v 50`, about 72 kbps. Sparks and particles were lost in both. The stills, 1600 × 900 JPEGs at quality 85, were fine.
- **1600 × 900 needs a Retina display.** The game window is 1280 points wide while it records (the macOS host's docs, "Watching the game"). On a display of 2 pixels a point that is 2560 pixels, scaled down to 1600. On a display of 1 pixel a point it is only 1280 pixels, scaled up, and the recorder logs `scaled up from 1280 pixels`. Keep the game window on the Retina display.
- **The clips are encoded again, not copied.** A stream copy can start only at a keyframe. The recorder's keyframes come about 1.1 s apart, and its HEVC has B-frames. The bare pad before an attach can be as short as 0.3 s (the effect is attached a second after its mark, and the host notices the mark up to half a second late). So a copied clip would mostly start on the previous effect. At `-q:v 90` the second encode loses next to nothing more.
- **The recorder writes a frame only when the window changes**, so a still scene costs little and size follows how much is moving, not the run's length alone.

### Sizes, as measured on 2026-11-24

A test batch of 20 effects, 13 particle-heavy ones (lava impact, Yamato, psi storm, nuke, plasma and fire impacts) and 7 spread through the list, filmed at the settings above and compared with the same effects in the 2026-11-23/24 run. The full run is projected from that run's totals: 15,254 s of recording and 15,091 s of clips for 1,313 effects.

| | Test batch | Old run, all 1,313 | Full run, projected |
| --- | --- | --- | --- |
| Recordings | 75 MB for 245 s: 2.45 Mbps, about 18 MB a minute | 186 MB, about 0.1 Mbps | about 4.7 GB |
| Clips | 92 MB for 229 s: 3.0–3.4 Mbps, 1.6–13 MB a clip (psi storm the largest) | 137 MB | about 5.5–6 GB |
| Stills and picked frames | 13 MB of stills, 3.4 MB of picked frames | | about 0.8 GB, as before |

- **Clips at `-q:v 90` come out larger than the recording they are cut from** (3.2 Mbps against 2.45). Encoded from a lossless copy of the recording, the psi storm's 15 s came to 1.6 MB at `-q:v 50`, 2.7 MB at 60, 4.4 MB at 70, 7.1 MB at 80 and 14.9 MB at 90. Looked at pixel for pixel, 60 lost the storm's fine tendrils, 70 softened them, 80 was close to the recording and 90 matched it. To halve the clips' size, set `CLIP_QUALITY` to 80.
- **What the gallery publishes.** The gallery's import (sc2-mapping-reference `scripts/import-effects.mjs`) encodes each clip with libx264 at CRF 28, preset slow, at the clip's own size. That encode of the 20 test clips came to 6.8 MB, 2.6 times the 2.65 MB published for the same effects today (2.5 times for the particle-heavy ones, 2.7 times for the rest). Today's 1,313 published clips are 122 MB, so the new ones come to about 320 MB, with the published effects folder at about 370 MB in all. Where that is too much, the import's encode is the place to change it (a smaller size or a higher CRF); the clips stay as they are.

## What a batch does

Each effect gets a map-local CModel (`FxTour0001`, with parent `FX`) naming its file. The script attaches the effect to a Marine on a pad (`libNtve_gf_AttachModelToUnit`), at the site the game attaches it at (below). The Marine shows the effect's scale, and carries its team colour (player 1, colour index 8). The script then takes these frames, each announced by saving the bank `FxTour` with key `stop`:

| Frame | When | What it shows |
| --- | --- | --- |
| `birth` | half way through Birth, if it has one | the build-up |
| `stand` | a second into a looping Stand, or half way through one that plays once | the effect |
| `moving` | after the Marine has slid a quarter of the frame sideways in a second; a missile or a model with ribbons goes 20 cells in 2 s (below) | whether the effect travels with its host or trails |
| `after-destroy` | half a second after a plain `Destroy` | whether anything is left behind |
| `death` | half way through Death, on a fresh copy, if it has one | the end |

- **Timing** comes from each model's `SEQS` (`catalog/m3-sequences.ts`). Waits for animations are in game time, and waits for a frame are in real time.
- **Framing** comes from its bounds (`catalog/m3-footprint.ts`): a sphere round them at a margin of 1.3, with the camera 6 to 70 cells away at pitch 40, looking at the effect's middle above the site it's attached at. Bounds seldom cover all the particles.
- **Clean-up:** before each effect, `ActorWorldParticleFXDestroy` clears whatever the last one left.

## Where each effect is attached

Until 2026-11-24 every effect was attached at the Marine's `Ref_Origin`, its feet. The gallery's first reviews found missiles stuck in the ground (AdeptSoulMissile) or with no trail (PhoenixMissile), each a small glow at the Marine's feet. A missile is built round its own centre, which is in the air in game, and many impacts and launches are built to sit at a unit's centre or weapon (#86).

`data/effect-sites.json` says where the game attaches each effect, derived by `packages/core/scripts/build-effect-sites.mjs` from the install's ActorData, ModelData and `.m3` files (only the derived facts are committed):

- **site:** the site most of the model's uses name: an actor's `HostSiteOps` for its model, an action actor's `ImpactSiteOps` for its `ImpactMap` models and `LaunchSiteOps` for its `LaunchAssets`, resolved through the actor's parents. With no use, a model under `ImpactFX` is guessed to sit at `Ref_Center` and one under `LaunchFX` at `Ref_Weapon`. A tie goes to `Ref_Origin`.
- **missile:** a `CActorMissile` names its CModel, or the CModel's parents hold `MissileFX`.
- **ribbons:** its `RIB_` records.

Of the 1,313 effects on 2026-11-24: 172 missiles; otherwise 421 at `Ref_Origin`, 245 at `Ref_Center` (112 more guessed), 28 at `Ref_Weapon` (24 more guessed), 19 at `Ref_Overhead`, 8 at `Ref_Head`, 5 at `Ref_Hardpoint`, and 279 nothing says. 324 have ribbons, 105 of them missiles.

The tour (`attachSite` in `effect-tour.ts`) attaches:

- a missile at `Ref_Center`, whatever its uses say;
- anything else at its site, guessed or not;
- at `Ref_Origin` when nothing says;
- at `Ref_Center` when the Marine lacks the site. The file records the Marine's attachment points (`hosts`).

The camera looks at the site's height, from the Marine's bind pose, but no lower than its `Ref_Center` (0.51 cells): the Marine's weapon bone rests at its feet in the bind pose, though Stand holds it at the chest. A model from `make --folder` has no actor data, so it goes at `Ref_Origin` as before.

## Fast moves for trails

A ribbon is drawn behind a moving emitter, so a trail forms only at speed. The old move, at most 12 cells in 1 s and usually 1–3, left none. A missile, or any model with ribbons, now moves at 10 cells a second for 2 s (`FAST_SPEED`, `FAST_MOVE`), near a slow missile's speed. Before it moves, the Marine turns to face the way it goes, since a missile flies facing forward, and the camera pulls back to at least 12 cells. Once the Marine is a quarter of the frame from the pad, the camera follows it, so the trail has the rest of the frame behind it. The `after-destroy` frame is taken where the move ends. An effect too short to move (a one-shot Stand under 1.5 s past its stand frame) still doesn't.

The spacing rules below are unchanged: the fast move is 2 s, longer than the 1.5 s frames need, and the 1 s between a video mark and the attach comes before the move.

## What the game does, as found filming it

- **A generic model actor plays Birth, Stand and Death as an animation bracket** (`ModelAnimationStyleContinuous`: `AnimBracketStart BSD Birth Stand Death`). Stopping the bracket (`AnimBracketStop BSD`) on the actor `AttachModelToUnit` makes removes it at once, with no Death. So the tour plays Death outright, with `AnimPlay FxTour Death`.
- **Models with no Birth or Stand:** the bracket doesn't play a model whose only animation is something else, such as an impact with only Death. The tour plays that animation as soon as the model is made.
- **Loops not named Stand:** the bracket plays only `Stand`, so a model that loops under another name (`GLstand`, `GLstand 01`…) shows nothing after its Birth. The tour plays its first such loop outright, `AnimPlay FxTour <loop> PlayForever` as Birth ends (or at once, when it has no Birth), and takes the stand frame in it. A name with several words goes as comma-separated anim props (`GLstand,01`).
- **A plain `Destroy` removes a generic actor at once.** Its particles go with it unless they're emitted in world space.
- **Holding the game still loses frames.** `GameSetGlobalTimeScale(0)` around a frame stops the game writing the bank, so the capture misses those frames: 15 of 38 in a test, against none without it. `--freeze` still turns it on, to compare.
- **Frames need to be at least 1.5 s apart.** The host polls the bank every 0.5 s and takes up to a second over a screenshot, so frames 1.3 s apart were lost.
- **Some particles are gone before any still.** Many impacts and casts fire their particles in one burst within 100 ms of Birth starting, and those particles live 0.1–0.6 s. A still lands at least 0.25 s after its planned moment, so it shows an empty pad. Examples are the large lava impact and the Yamato impact. Filming them needs video of the game window: `effect-tour capture --video` records it, cuts a clip per effect and picks the frames where the most changed after the attach. See the macOS host's docs ("Watching the game") for why the game window is made smaller than the display while it records.
- **Heroes effects draw in StarCraft II as they are.** Models converted with WhiteoutFlakes (`--save-m3-sc2`) draw their meshes and their particles. Most of their particles are such short bursts, though, so stills miss them.
