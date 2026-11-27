# Tools

Small command-line tools the skills and reference docs use from a checkout. Run the Python ones with `python3 -I`; they need only the standard library.

| Tool | What it does |
|---|---|
| `music/find_music.py` | Searches the music catalogue (`music/tracks.json`) for a scene's beds and stingers, shows a track's card, and writes a listening sheet (HTML) for the author to audition candidates. The `cinematography` skill's "Score the scene" step uses it. |
| `music/tracks.json` | The music catalogue: every music id the Editor ships, the file it plays, where Blizzard used it, its length and sections, and listening notes. Notes tagged `[gemini]` are a model's listening, a first draft rather than a source. |
| `cutscene/timeline.py` | Prints one `.SC2Cutscene`'s cuts, lines, fades, Light switches, bookmark jumps and End Scene markers in time order, and flags the file problems the cinematic checks look for. |
| `cutscene/analyze.py` | Measures every `.SC2Cutscene` in a folder (shot lengths, lenses, pitch, depth of field, cut-to-line offsets, lights per camera) into one JSON file. |

## A CASC extractor

The game's own files are in its install's CASC storage. This repo ships no extractor: install a community one and name it in `SC2_CASC_TOOL`. Only a maintainer needs one: to regenerate the data core commits (`node packages/core/scripts/build-trigger-libraries.mjs` and `build-catalog-schema.mjs`, each given the install's folder), to extract the decals' model files for sc2-asset-catalog's `extract-decals` ([decal-catalog.md](../docs/reference/decal-catalog.md)), or to extract music for a listening sheet. A mapper needs one only to tune a terrain texture's height map with the `height-tuner` Utility ([its README](../packages/plugin-height-tuner/README.md)), which reads the texture's normal map and the stock terrain catalogs from the install on each run.

The scripts call it as [stormex](https://github.com/Talv/stormex) is called. stormex is built on [CascLib](https://github.com/ladislav-zezula/CascLib) and tested on StarCraft II:

```sh
"$SC2_CASC_TOOL" -S <install folder> -I <regex> -x -o <folder>   # extract every storage path the case-insensitive regex matches
"$SC2_CASC_TOOL" -S <install folder> -l -I <regex>                # list them
```

Install it from its [releases](https://github.com/Talv/stormex/releases) on Windows, or build it as its README says on Linux (CMake, with its CascLib submodule).

On macOS, two things stop its own build: current CMake refuses its old minimum version, and it compiles its FUSE mount, which needs macFUSE, even with FUSE off. Extracting doesn't need the mount, so build it with a stub in the mount's place (checked on macOS 27.2 with Homebrew's CMake, 2026-11-27):

```sh
brew install cmake
git clone --recursive https://github.com/Talv/stormex ~/tools/stormex
cd ~/tools/stormex
cat > src/cascfuse_stub.cc <<'STUB'
#include "cascfuse.hpp"
#include <iostream>
int cascfs_mount(const std::string&, HANDLE) { std::cerr << "built without FUSE\n"; return 1; }
STUB
sed -i '' 's|src/cascfuse.cc|src/cascfuse_stub.cc|' CMakeLists.txt
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DENABLE_FUSE=OFF
cmake --build build -j 8
```

Check it reads your install: `~/tools/stormex/build/bin/stormex -S "/Applications/StarCraft II" -l -I 'mods.core\.sc2mod.*terraintexdata\.xml$'` lists one file.

Then set the variable, for example in your shell's profile:

```sh
export SC2_CASC_TOOL=~/tools/stormex/build/bin/stormex
```

A script run without it stops and names `SC2_CASC_TOOL`. Another extractor works through a small wrapper that takes these four options. The wrapper must be an executable that runs without a shell: a script with its `#!` line on macOS and Linux, or an `.exe` on Windows (not a `.cmd` or `.bat`). The scripts lower-case what it extracts, so the case it writes paths in doesn't matter.

## Audio for a listening sheet

The game's music is Blizzard's, so it isn't in this repo. Extract it from your own install (about 1 GB), and point `find_music.py sheet` at the folder with `--audio-root` or `SC2_MUSIC_AUDIO`:

```sh
"$SC2_CASC_TOOL" -S "/Applications/StarCraft II" -I 'music.*\.ogg$' -x -o ~/sc2-music
export SC2_MUSIC_AUDIO=~/sc2-music
```

Without the audio, the sheet still lists the candidates, with a note saying how to extract it.
