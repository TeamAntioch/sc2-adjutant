# Exemplar Maps

The Antioch Style Pack's Exemplar Maps: maps its author made, edited or approved, studied for visual design lessons. A **Map Study** measures one map's texturing, cliffs, doodads, lighting and composition; a **Design Lesson** is a rule the author ratified from the studies, in `LESSONS.md`. The lessons feed a Mission Blueprint's co-design; they are not compiler defaults.

The pack ships no screenshots. Every lesson states its rule, its numbers and the map, lighting and stop or place that show it, so it stands without a picture, and the `exemplar-design` skill works from the lessons, the studies and the layer images, saying so when a frame isn't available. To make the in-game frames yourself, see [Generating the screenshots](#generating-the-screenshots).

## Contents

- `exemplars.json`: each Exemplar Map's id, `map` and provenance, plus capture settings. `map` is the source map's path inside the folder the machine config's `exemplarMaps` (or `SC2_ADJUTANT_EXEMPLAR_MAPS`) names. The source maps aren't part of the pack: they are all of Episodes 1 to 3 of `TeamAntioch/tac-arcade` except 1-9.5, which the author skipped. 3-11 is `made`, the rest `edited`; evidence from a `made` map weighs more. 2-6 uses `Antioch 2-6.SC2Map`, not the single-file `Antioch 2-6 NotComponents.SC2Map` beside it.
- `<id>/study.json`: the Map Study. Sections: `texturing`, `cliffs`, `doodads` (including Doodad Manipulation and Doodad Composites), `lighting`, `composition`. Each section notes its thresholds.
- `<id>/textures.png`, `elevation.png`, `height.png`, `doodads.png`, `vertex-shading.png`, `pathing.png`: layer views, 4 px per cell, north up. Legends are in `study.json` under `layers`. `height.png` (shaded relief of the height map, showing sculpted height within a cliff level) and `pathing.png` (the Editor's painted pathing in red over the elevation, written only for a map with paint) came after the first studies were made; a study written since has them, and its `layers.note` names them.
- `LESSONS.md`: the ratified Design Lessons, DL-01 to DL-19, each with its rule, evidence, weight and Blueprint hook.
- `mixtures.md` and `mixtures.json`: the dressed places of the 24 independent maps (1,029 places), grouped into 10 moods, to generate new places from rather than copy. Each place gives its map, `center` in cells, mood and motifs; `frames` names the place's in-game frames by their path under the screenshots folder (below), which a package install doesn't have.
- `data-analysis.md`, `episode-1-analysis.md`, `episode-2-analysis.md`: the measurements and arguments behind the lessons. `candidate-lessons.md` is superseded by `LESSONS.md`.

A study also writes `<id>/minimap.png`, the Editor's own `Minimap.tga`. It's a copy of the source map's art, so it stays out of the package.

## Regenerating the studies

```sh
npm run study            # every Exemplar Map
npm run study -- 3-11    # one
```

The study reads each source map from the folder the machine config's `exemplarMaps` names (`SC2_ADJUTANT_EXEMPLAR_MAPS` overrides it), else the Workspace config's, and writes `study.json` and the layer images into `<id>/` here. It needs only the source maps: no Editor and no game. The MCP server's `study_exemplar` tool runs the same code, so it works from a package install too.

## Generating the screenshots

The lessons were checked against in-game frames: camera tours of each map, one frame per stop, captured through the Editor. They are generated, not shipped, and never committed: the sc2-adjutant repo ignores any `captures/`, `frames/` or `evidence/` folder here.

**What you need:**

- The source maps, in the folder the machine config's `exemplarMaps` names. They aren't included.
- The StarCraft II Editor and a Host Adapter with `editor.captureTour`, since capture runs through the Editor's Test Document. These frames were made with the macOS Host Adapter; its requirements and safety rules are in its docs and the header of its `capture-tour.ts`. In short: the Editor with Test Document set to Windowed, the app running the capture allowed Accessibility and Screen Recording, and the screen unlocked and awake for the whole run. The game window can sit behind other windows (not minimized). The Windows Host Adapter has `editor.captureTour` too.
- `editorPath` and `cacheDir` in the machine config. Core builds each capture copy of a map under `<cacheDir>/capture/maps/`, and the adapter only ever closes documents there.
- `SC2_RESEARCH_DIR`, naming a research archive: a folder of your own outside the repo, where all of this pack's screenshots go. Without it the captures go into the pack's own `exemplar-maps/` (git-ignored), as for any other Style Pack, and `mixtures.mjs` finds none.
- A clone of the sc2-adjutant repo, run inside a Workspace whose `stylePack` is this pack. The commands below are the repo's: `npm run capture-exemplars` is a root script, and `make-frames.sh` and `mixtures.mjs` are in core's `scripts/` folder, which the npm package doesn't include. None of them work from a package install: the MCP server's `capture_exemplar` tool does what `capture-exemplars` and `make-frames.sh` do (both are wrappers over the same code), and `find_places` what `mixtures.mjs` does, for the maps it is given.

**The commands**, from the repo's root:

```sh
npm run capture-exemplars -- --places [id ...]                    # place tours: a frame centred on every place in mixtures.json
npm run capture-exemplars -- [id ...]                             # grid tours: every (map, lighting) not yet captured, ~13 min each
packages/core/scripts/exemplar-capture/make-frames.sh             # 1000px copies again, after mixtures.mjs (each capture also makes them)
```

`--start-on-init` starts a tour at map init, for maps whose timed triggers never fire, and `--show-errors` keeps data errors on screen to debug a tour that doesn't start. A rerun skips tours that already have frames, so a stopped run resumes. Frames are the game window cropped to 16:9, 1600×900. If the Editor can't come forward to open the menu, the macOS adapter posts a notification asking for one File > Test Document click.

After a new capture, `node packages/core/scripts/exemplar-analysis/mixtures.mjs` rewrites `mixtures.json` here, linking each place to its frames, then `make-frames.sh` makes the copies of the grid-tour frames it links (run `npm run build` first; both read the archive). A capture makes the place-tour copies itself.

**Where they go**, all under `$SC2_RESEARCH_DIR/docs/research/exemplar-maps/`:

- `<id>/captures/<lighting>/`: a grid tour, one per lighting the map's triggers use (`default` when it sets none), with `stops.txt` giving each frame's camera target (`stop x y`). Every area is shown in every lighting; pair frames with areas using the study's `lighting.calls`.
- `<id>/captures/places-<lighting>/`: a place tour, one frame centred on each place in `mixtures.json`, in the map's main lighting (`placeLight` in `exemplars.json` where the triggers leave it unclear). A map lit by zone lists `placeZones` (rectangles with a lighting) and gets one place tour per lighting.
- `<id>/frames/<tour>/`: the 1000px copies (JPEG quality 75): every place-tour frame, and any grid-tour frame `mixtures.json` links to a place, with each tour's `stops.txt`. These are the paths `mixtures.json` names.
- `<id>/evidence/`: the frames a ratified lesson was shown with, copied by hand at ratification. `LESSONS.md` describes each one in words and doesn't link to it.

## Decisions

- **Lighting for captures:** one tour per lighting the map uses, not matched to areas. It needs no guessing from trigger logic and runs unattended; the extra frames are cheap.
- **Place tours:** captures stop at each place's centre in `mixtures.json`, in one lighting, instead of stepping a grid in every lighting: every place gets a centred frame, in far fewer stops.
- **No screenshots in the pack:** the frames are game imagery and large (over 1,000 frames), and the lessons don't need them: they are measured from the map data. Each citation names the map, the lighting and the stop (or, for a place-tour frame, the place's centre) and says what the frame shows, so it stands alone.
- **Design Lesson format:** ratified lessons live in one `LESSONS.md`, read by the `exemplar-design` skill during co-design. Each has an id (`DL-NN`), a rule written as an instruction, evidence (maps, numbers, and what the frames show), a weight (more for 3-11, which the author made, for Blizzard's maps and for agreement across maps) and a Blueprint hook. Drafts stay in `candidate-lessons.md` and `data-analysis.md`. Machine-readable lessons wait until stable lessons become compiler defaults.
- **Ratification:** each candidate is brought to the author one at a time with its rule, numbers and two to four chosen frames (supporting or contradicting); the author keeps, rewords or drops it. Kept lessons go into `LESSONS.md`.

## Open questions

- `t3VertCol` holds the Editor's Generate Static Shadows bake (verified; see DL-10).
