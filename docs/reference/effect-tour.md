# The effect tour

The effect tour films the game's effect models (`Assets/Effects`) in the game itself, for an effects gallery: the charge-ups, impacts and auras a mapper picks for an actor. A renderer can't do it. Blender with m3studio draws an effect's meshes but none of its particles, ribbons or lights. WhiteoutFlakes, the viewer behind the doodad thumbnails, lists SC2 effects as missing. Most of what an effect is, is particles.

Code: `packages/core/src/capture/effect-tour.ts` (planning and the batch script) and `src/cli/effect-tour.ts` (the command).

## Running it

```sh
npm run effect-tour -- base                       # compile the flat test map, into missions/effect-tour (git-ignored)
npm run effect-tour -- make --models <folder> --base missions/effect-tour/Effect-Tour.SC2Map --out <out>
npm run effect-tour -- capture <out>              # film every batch through the Editor Broker
```

- **`base`** compiles a 256 × 256 flat floor, with Void (Campaign) as its only dependency (a few effect files are in that campaign's own assets). The view never reaches its edge.
- **`make`** reads each `Assets/Effects` model that core's `game-models.json` names, from a folder of the install's files extracted with a CASC extractor (`tools/README.md`: `"$SC2_CASC_TOOL" -S <install> -I 'assets\\effects\\.*\.m3$' -x -o <folder>`, about 2,000 files and 226 MB, in seconds). It leaves out Glazes: a glaze is a material laid over another model, so on its own it draws nothing. It writes batch maps of 120 effects each into `<out>/batch-NN/`, each with a `manifest.json` of its frames.
  - **`make --folder <folder>`** films every `.m3` under `<folder>/Assets/Effects` instead, for models that aren't in the game. Each batch map imports its models, and the textures they name from `<folder>/Assets/Textures`. `tools/effects/prepare-hots-effects.py` extracts Heroes of the Storm effects and converts them that way.
- **`capture`** films each batch through the Editor Broker (Test Document) into `<out>/batch-NN/frames/`. Only a batch that runs to its end gets its `index.html`, a contact sheet with one row per effect. A re-run skips the batches that have one, so a run that stops partway carries on where it stopped.

As measured on 2026-11-23: all of the game's effects come to 1,313 models and 4,961 frames in 11 batches, about 4 h 20 min in game, plus 1–2 minutes to start each batch.

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

Each effect gets a map-local CModel (`FxTour0001`, with parent `FX`) naming its file. The script attaches the effect to a Marine on a pad (`libNtve_gf_AttachModelToUnit`, at `Ref_Origin`). The Marine shows the effect's scale, and carries its team colour (player 1, colour index 8). The script then takes these frames, each announced by saving the bank `FxTour` with key `stop`:

| Frame | When | What it shows |
| --- | --- | --- |
| `birth` | half way through Birth, if it has one | the build-up |
| `stand` | a second into a looping Stand, or half way through one that plays once | the effect |
| `moving` | after the Marine has slid a quarter of the frame sideways in a second | whether the effect travels with its host or trails |
| `after-destroy` | half a second after a plain `Destroy` | whether anything is left behind |
| `death` | half way through Death, on a fresh copy, if it has one | the end |

- **Timing** comes from each model's `SEQS` (`catalog/m3-sequences.ts`). Waits for animations are in game time, and waits for a frame are in real time.
- **Framing** comes from its bounds (`catalog/m3-footprint.ts`): a sphere round them at a margin of 1.3, with the camera 6 to 70 cells away at pitch 40. Bounds seldom cover all the particles.
- **Clean-up:** before each effect, `ActorWorldParticleFXDestroy` clears whatever the last one left.

## What the game does, as found filming it

- **A generic model actor plays Birth, Stand and Death as an animation bracket** (`ModelAnimationStyleContinuous`: `AnimBracketStart BSD Birth Stand Death`). Stopping the bracket (`AnimBracketStop BSD`) on the actor `AttachModelToUnit` makes removes it at once, with no Death. So the tour plays Death outright, with `AnimPlay FxTour Death`.
- **Models with no Birth or Stand:** the bracket doesn't play a model whose only animation is something else, such as an impact with only Death. The tour plays that animation as soon as the model is made.
- **Loops not named Stand:** the bracket plays only `Stand`, so a model that loops under another name (`GLstand`, `GLstand 01`…) shows nothing after its Birth. The tour plays its first such loop outright, `AnimPlay FxTour <loop> PlayForever` as Birth ends (or at once, when it has no Birth), and takes the stand frame in it. A name with several words goes as comma-separated anim props (`GLstand,01`).
- **A plain `Destroy` removes a generic actor at once.** Its particles go with it unless they're emitted in world space.
- **Holding the game still loses frames.** `GameSetGlobalTimeScale(0)` around a frame stops the game writing the bank, so the capture misses those frames: 15 of 38 in a test, against none without it. `--freeze` still turns it on, to compare.
- **Frames need to be at least 1.5 s apart.** The host polls the bank every 0.5 s and takes up to a second over a screenshot, so frames 1.3 s apart were lost.
- **Some particles are gone before any still.** Many impacts and casts fire their particles in one burst within 100 ms of Birth starting, and those particles live 0.1–0.6 s. A still lands at least 0.25 s after its planned moment, so it shows an empty pad. Examples are the large lava impact and the Yamato impact. Filming them needs video of the game window: `effect-tour capture --video` records it, cuts a clip per effect and picks the frames where the most changed after the attach. See the macOS host's docs ("Watching the game") for why the game window is made smaller than the display while it records.
- **Heroes effects draw in StarCraft II as they are.** Models converted with WhiteoutFlakes (`--save-m3-sc2`) draw their meshes and their particles. Most of their particles are such short bursts, though, so stills miss them.
