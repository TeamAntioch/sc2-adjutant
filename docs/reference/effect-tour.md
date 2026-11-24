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
- **A plain `Destroy` removes a generic actor at once.** Its particles go with it unless they're emitted in world space.
- **Holding the game still loses frames.** `GameSetGlobalTimeScale(0)` around a frame stops the game writing the bank, so the capture misses those frames: 15 of 38 in a test, against none without it. `--freeze` still turns it on, to compare.
- **Frames need to be at least 1.5 s apart.** The host polls the bank every 0.5 s and takes up to a second over a screenshot, so frames 1.3 s apart were lost.
- **Some particles are gone before any still.** Many impacts and casts fire their particles in one burst within 100 ms of Birth starting, and those particles live 0.1–0.6 s. A still lands at least 0.25 s after its planned moment, so it shows an empty pad. Examples are the large lava impact and the Yamato impact. Filming them needs video of the game window: `effect-tour capture --video` records it, cuts a clip per effect and picks the frames where the most changed after the attach. See the macOS host's docs ("Watching the game") for why the game window is made smaller than the display while it records.
- **Heroes effects draw in StarCraft II as they are.** Models converted with WhiteoutFlakes (`--save-m3-sc2`) draw their meshes and their particles. Most of their particles are such short bursts, though, so stills miss them.
