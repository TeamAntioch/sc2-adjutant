# Related Repositories

External repos worth knowing about for sc2-adjutant, grouped by what we'd use them for.

Sources:

- `sc2-ida-mcp-setup` `docs/reference-repos.md`, plus its `README.md` and `tools/mpqcli/README.md`.
- [map-package-findings.md](./map-package-findings.md): "Tools evaluated" and "Triggers".
- GitHub metadata checked on 2026-10-25 with `gh api repos/<owner>/<name>` and `.../contents/<path>` (read-only, nothing cloned).

"Confirmed" means the repo exists publicly and the paths listed were seen in its contents listing. Licence is GitHub's SPDX id. "None" means no licence file, so treat the code as all rights reserved: read it, don't copy it.

## Formats and parsing

### sc2-arcade-watcher/sc2-ida-mcp-setup

- **What:** reverse-engineering notes on the Windows game client and Editor, build 96921 (5.0.15), kept as an IDA/MCP workspace. Most of it covers Battle.net and anti-tamper.
- **Language / licence:** GitHub says HTML (it's mostly Markdown and Python scripts); no licence. Confirmed.
- **Use:** byte-level specs for terrain and package files; SC2API (Windows only: the Mac client ignores `-listen`, see `game-testing.md`); launch switches and log patterns for `validate-map`. Formats carry over to our 5.0.17 Mac build; addresses don't. Our terrain cross-check is in `docs/reference/terrain-file-formats.md`.
- **Paths:**
  - `docs/file-format/` (MapInfo, all t3 files, painted layers, ComponentList, `.version`, DocumentHeader)
  - `docs/terrain-loading-pipeline.md`
  - `docs/sc2api-raw-client.md` (headless `CreateGame` over `/sc2api`)
  - `docs/vfs-readers.md` (override order: the map wins over its dependencies)
  - `docs/cvariable-list.md` (`-run` switches)
  - `docs/mpq-reader.md` (where SC2's MPQ handling diverges from StormLib)
  - `output/galaxy-native-binding-96921.json` (2,874 natives with arity; decoded in `docs/galaxy-native-catalog.md`)
- Read-only. Run nothing from it.

### sc2-arcade-watcher/sc2-file-format-docs

- **What:** the published file-format notes. Its file list matches the clone's `docs/file-format/` plus the terrain pipeline, the runtime API and the MPQ/CASC docs.
- **Language / licence:** GitHub says Python (`scripts/mapinfo_parser.py`, `scripts/sc2_launcher_ipc.py`); no licence. Confirmed.
- **Use:** read this first for binary formats ([map-package-findings.md](./map-package-findings.md#tools-evaluated)). It's the stable link to cite instead of the IDA workspace.
- **Paths:** `t3*.md`, `painted-pathing-layer.md`, `painted-creep-layer.md`, `terrain-loading-pipeline.md`, `terrain-runtime-api.md`, `mpq-format.md`, `component-list.md`, `version-file.md`, `scripts/mapinfo_parser.py`.

### modkit (`sc2-arcade-watcher/modkit`)

- **What:** per `reference-repos.md`, a TypeScript monorepo (`@modkitx/*`) that parses and converts SC2 on-disk formats: MPQ/CASC, `.SC2Map`/`.SC2Mod`, catalog XML, Triggers↔Galaxy, `.SC2Layout`, `.SC2Bank`/`.SC2Replay`, M3.
- **Language / licence:** TypeScript per the doc; licence unknown. **Not confirmed:** `sc2-arcade-watcher/modkit` returns 404, so it's probably private. `sc2-arcade-watcher/sc2-modkit` exists, but it's only the issue tracker for the Modkit VS Code extension.
- **Use:** if it becomes reachable, it's the closest thing to our stack: a TypeScript reader for packages and catalogs, and Triggers↔Galaxy conversion to check our trigger writer against.
- **Paths (per the doc):** `packages/archives-processing/` (mpq, casc codecs), `packages/document/`, `packages/map/`, `packages/catalog/`, `packages/schema/`, `packages/triggers/`, `packages/galaxy*/`, `packages/m3/`.

### sc2-arcade-watcher/sc2-xsd

- **What:** XSD schemas for SC2 XML files.
- **Language / licence:** no language tag; no licence. Confirmed.
- **Use:** validate generated XML in tests or a `validate-map` step.
- **Paths:** `Catalog.xsd`, `GameData.xsd`, `DocumentInfo.xsd`, `ComponentList.xsd`, `Objects.xsd`, `BankList.xsd`, `Attributes.xsd`, `SC2Layout.xsd`.
- There's no schema for `t3Terrain.xml`, `Triggers` or `Regions`.

### Talv/sc2-texture-scanner

- **What:** an old Python tool that reads `t3TextureMasks` (built for Ice Escapes maps).
- **Language / licence:** Python; no licence; archived 2017. Confirmed.
- **Use:** an independent reader for our texture-mask writer. `t3texturemasks.md` flags a bug: `blocksY` uses `sizeX`, so it's only right on square maps.
- **Path:** `scanner.py`.

## Game data and trigger libraries

### SC2Mapster/SC2GameData

- **What:** a text mirror of Blizzard's GameData, UI and Galaxy files. Patch 5.0.3, but every trigger ID we've checked matches 5.0.17 ([map-package-findings.md](./map-package-findings.md#triggers)).
- **Language / licence:** GitHub says HLSL (shader sources); no licence. Confirmed.
- **Use:** already our source for Ntve FunctionDef/ParamDef/Preset IDs and for the tileset tables in `packages/core/data/` (each tileset's blend textures and cliff sets are now the published sc2-asset-catalog's extractors', in `texture-extracted.json` and `cliff-extracted.json`).
- **Paths:**
  - `mods/core.sc2mod/base.sc2data/TriggerLibs/NativeLib.TriggerLib`
  - `mods/core.sc2mod/enus.sc2data/LocalizedData/TriggerStrings.txt`
  - `campaigns/voidstory.sc2campaign/base.sc2data/TriggerLibs/`
  - `mods/*/base.sc2data/GameData/TerrainData.xml`

### sc2-arcade-watcher/sc2-game-data

- **What:** a CASC-extracted text tree for SC2 and Heroes: catalogs, layouts, Galaxy libraries (1,254 files), shader source, localized strings. No binary media; `Assets.txt` only lists the paths.
- **Not in it:** Blizzard's maps come with only their Objects, `t3Terrain.xml`, Regions and scripts. Their height maps (`t3HeightMap`), cliff levels (`t3SyncCliffLevel`), cell flags (`t3CellFlags`) and MapInfo come from your own install, extracted over CASC ([Game storage](#game-storage)). Extracted names come out lower case. Co-op maps aren't in the install.
- **Language / licence:** GitHub says HLSL; no licence. Confirmed.
- **Use:**
  - Full native prototypes for a `validate-map` lint, alongside the arity list from `sc2-ida-mcp-setup`.
  - Terrain catalogs to build cliff, texture and water tables from Blizzard data instead of hand-picking: cliff sets per tileset, `CWater` entries for t3Water, doodad footprints.
  - The `Assets.txt` path list for a sound catalog.
- **Paths:**
  - `mods/core.sc2mod/base.sc2data/TriggerLibs/natives.galaxy`, `NativeLib.galaxy`, `NativeLib_h.galaxy`, `natives_missing.galaxy`
  - `mods/liberty.sc2mod/base.sc2data/GameData/TerrainData.xml`, `CliffData.xml`, `CliffMeshData.xml`, `TerrainTexData.xml`, `TerrainObjectData.xml`, `WaterData.xml`
  - `mods/void.sc2mod/`, `campaigns/` (campaign data)

## Packaging and publishing

### koda-27/sc2publish

- **What:** a headless map builder and Battle.net publisher. It merges component folders into an MPQ, builds Arcade metadata and publishes with no game or Editor. `reference-repos.md` and our earlier notes list it under `sc2-arcade-watcher`, but that path returns 404. The public repo is `koda-27/sc2publish`.
- **Language / licence:** Python; MIT. Confirmed.
- **Use:** a deterministic MPQ v0 writer to port or follow when we pack `.SC2Map` files (SC2API `CreateGame` needs a packed map) and later `.SC2Campaign`. Its MapInfo v24–39 reader can cross-check our writer. Publishing is out of scope.
- **Paths:** `src/sc2publish/mpq.py`, `build.py`, `mapinfo.py`, `catalogs.py` (with `data/` stock catalogs), `metadata.py`.

### TheGrayDot/mpqcli

- **What:** a CLI to create, list, extract and verify MPQ archives, built on StormLib. `sc2-ida-mcp-setup` vendors v0.10.2 and packs maps with `create --game starcraft2`.
- **Language / licence:** C++ with CMake (GitHub's language tag says Python); MIT. Confirmed (GitHub now spells the owner `thegraydot`).
- **Use:** the quickest way to pack a map for SC2API tests before we have our own writer. On macOS it needs building from source; the vendored binary is Windows-only.
- **Paths:** `src/`, `README.md`, `docs/`.

### ladislav-zezula/StormLib

- **What:** the reference MPQ library.
- **Language / licence:** C; MIT. Confirmed.
- **Use:** behind mpqcli and the `erivgout` packer. `docs/mpq-reader.md` in `sc2-ida-mcp-setup` lists where SC2 differs: v2 headers rewritten to v1, and some v3 header fields reused.

## Models

### Solstice245/m3studio and TeamAntioch/m3studio (its fork)

- **What:** a Blender add-on that imports and exports `.m3`/`.m3a`.
- **Language / licence:** Python; GPL-2.0. Both confirmed.
- **Use:** reading a model headless and exporting one, in Blender 4.5 (not 5): [m3-models-in-blender.md](./m3-models-in-blender.md), whose "Tools" names the fork's export fixes and the upstream workarounds. Also doodad footprints or bounds that the catalogs don't give. `structures.xml` is a versioned schema of every M3 section.
- **Paths:** `structures.xml`, `io_m3_import.py`, `io_m3_export.py`, `shared.py`.

## Game storage

### Talv/stormex

- **What:** a command-line tool that lists and extracts the files of a Blizzard game's CASC storage, built on CascLib. Tested on StarCraft II.
- **Language / licence:** C++ with CMake. Release binaries are for Windows; on macOS and Linux it builds from source.
- **Use:** the extractor the build scripts in `packages/core/scripts/` call through `SC2_CASC_TOOL` ([tools/README.md](../../tools/README.md)).
- **Paths:** `README.md`, `src/`.

### ladislav-zezula/CascLib

- **What:** the reference CASC library, which stormex is built on.
- **Language / licence:** C++; MIT.

### sc2-arcade-watcher/WhiteoutLib (fork of FernandoS27/WhiteoutLib)

- **What:** a C++20 library for Blizzard on-disk formats: M3, CASC/MPQ internals, BLP/DDS textures.
- **Language / licence:** C++; BSD-3-Clause. Confirmed.
- **Use:** CASC internals if we extract sounds or models from the install (the long-term sound-preview idea). M3 spec as a second reference.
- **Paths:** `docs/M3_FILE_FORMAT_SPECIFICATION.md`, `docs/CASC_ROOT_FORMATS.md`, `src/whiteout/storages/casc/`, `src/whiteout/storages/mpq/`.
- Upstream also has WebAssembly bindings: `whiteout-wasm` (browser and Node, in-memory) and `whiteout-node` (Node only, disk I/O, pthreads). Neither is on npm (checked 2026-10-26). Building them needs emsdk and a Python codegen step (`bindings/wasm/README.md`).

### FernandoS27/WhiteoutFlakes

- **What:** a real-time renderer for Blizzard models, built on WhiteoutLib. For SC2 it reads `.m3`/`.m3a` and `.dds` straight from the install's CASC storage. It ships a GLFW/ImGui viewer, a storage browser, a web viewer, and C and Rust bindings. It draws models only, not terrain or maps.
- **Language / licence:** C++; BSD-3-Clause, plus `LICENSE-AI.md`: code an AI generates from its source counts as a derivative work and must keep the BSD notice. Running the binary has no such implications. Confirmed 2026-10-26.
- **Status:** active (last push 2026-09-18). v1.5.0 ships a signed but un-notarized `WhiteoutFlakes-macos-arm64.dmg` (Metal). Per its README, SC2 materials and animations are work in progress and SC2 effects are missing.
- **Use:**
  - Asset Catalog thumbnails. The viewer's command line renders a model to image files and exits: `--export-anim <seq> <fps> <folder>`, `--export-angles <n>`, `--export-orbit-pitch`, `--export-fit`, `--export-crop`, `--export-sheet auto`, `--transparent`, `--res <w> <h>`. The positional model path can be a storage path (for example `Assets/Doodads/ShakurasTree/ShakurasTree.m3`; doodad paths follow `CModel` `Doodad` in core `ModelData.xml`), which it resolves against the install it finds itself (`tools/basic_viewer/documents/document_loader.cpp`).
  - `--headless-test`, an offscreen render smoke test, to check the backend before a batch run.
  - **Not** for terrain, `.SC2Cutscene` playback or talking portraits.
- **Paths:** `tools/basic_viewer/cli/cli_options.cpp` (every flag), `include/whiteout/flakes/storage_browser.h` (walks a CASC install's model tree), `src/renderer/profiles/sc2_heroes/`.
- **Spike (2026-10-26), release v1.5.0 on an M1 Max:** no renders.
  - Metal can't start: the backend reads `shaders/metal/{vs,ps}`, but the bundle ships `shaders/mtlvs` and `shaders/mtlfs`. `--backend vulkan` (MoltenVK) works.
  - v1.5.0 is 137 commits behind `main`. Its command line (`tools/basic_viewer/test_main.cpp` at the tag) has only `--backend`, `--export-anim`, `--gif`/`--apng`/`--webp`, `--transparent`, `--ui`, `--res`, `--camera`, `--headless-test` and `--multiscene-test`. It treats unknown flags as model paths, and the model has to exist on disk, so storage paths fail with `File not found`. The flags and storage-path loading listed above are only on `main`.
- **Spike (2026-10-27), `main` d2756ce built locally, Metal only, macOS 27.2, Xcode 27.1:**
  - **Works:** it finds `/Applications/StarCraft II` by itself, opens CASC and reads all 3,780 GameData files. Storage paths load.
  - **Variation naming:** variations are `Assets/Doodads/<id>/<id>_00.m3`, `_01`, and so on. The bare `<id>.m3` doesn't exist.
  - **Extraction:** `--save-m3 <out.m3> --save-m3-textures` writes the model and its `.dds` textures out of CASC to disk, without rendering. Checked on `ShakurasRockColumn_00`: 2 textures.
  - **Rendering doesn't work yet.** Every export is a black image (with or without `--transparent`), and `--headless-test` fails its own check (`readback OK 256x256 mean RGB=(0,0,0)` → `FAIL`).
  - Before that, Metal crashed on `A command encoder is already encoding to this command buffer`. `CopyBuffer` in `src/gfx/metal/metal_command_list.mm` closes an open render encoder before a blit, but not an open compute encoder. Closing both fixes the crash (local patch, not upstream).
  - The prebuilt WC3 Metal shader bundles are also stale against `main` (`bundle has 162/200 permutations, the 3.0.0 layout expects 162/350`). That may or may not cause the black output.
- **In use:** `packages/plugin-host-macos/scripts/build-whiteoutflakes.sh` builds the Vulkan setup below into `~/.cache/sc2-adjutant/whiteoutflakes`. The macOS Host Adapter runs it for `model.render` and `model.export` (`packages/plugin-host-macos/whiteoutflakes.ts`), from the machine config's `modelViewerPath`, and `npm run thumbnails` and `npm run model-anims` call those. The Windows Host Adapter does the same on D3D11 (below). Both go through one driver, core's `packages/core/src/host/whiteoutflakes.ts` (and `whiteoutflakes-frames.ts`), in the plugin SDK, which holds the recipe, the frame judging and keying, and the mod-model staging.
  - **Full run (2026-10-27):** first 2,107 of 2,521 doodads rendered, in about 27 minutes with 4 workers. That includes 160 of the 348 that have no screference gallery picture.
  - **Failures:** 335 actors whose model id isn't the actor id (e.g. `AiurTempleAdunGeneratorDoodad` uses `Aiur_Temple_AdunGenerator`; helper actors only have an `EditorModel`). The other 79 are decals that draw nothing in a turntable.
  - **Model lookup (same day):** `packages/core/scripts/build-doodad-models.mjs` resolves each actor's `Model` through ActorData and ModelData (parents, `##id##` tokens) into `packages/core/data/doodad-models.json`. Its `VariationCount`s match `packages/core/data/doodads.json` for every doodad. That recovered 257 doodads, for 2,362 of 2,521 in all. Still failing: 80 decals and the like that write no frames, 32 helpers whose game model is `InvisibleUnit` (not in the storage either), and 47 whose model file the viewer can't find under `Assets/…` or a package-prefixed path, e.g. `KorhalRedCarpet`.
  - **Mod models (2026-11-08, #559):** the viewer opens a loose `.m3` by its file path, but it looks a texture up only at `<model folder>/<texture path>`, at `<model folder>/<file name>`, the same two under its executable's folder, and then CASC (`src/io/file_resolver.cpp:21-53`). Its `--content-root` reaches only the test harnesses. A mod model whose textures are game textures renders textured as it is; one whose textures are only in the mod draws untextured. The macOS Host Adapter stages such a model beside links to the package files of the textures it names ([macos-host.md](../../packages/plugin-host-macos/docs/macos-host.md#rendering-a-mods-models)).
  - **Run in parallel only with separate caches.** The viewer keeps its Vulkan pipeline cache and PSO trace in `~/Library/Caches/WhiteoutFlakes`. Processes sharing them corrupt them and draw magenta while still exiting 0, so the Host Adapter gives each concurrent run its own `HOME`, under `<cacheDir>/whiteoutflakes/worker-homes/`. Garbled frames are a separate fault, below.
  - **Backgrounds and garbled frames.** The viewer is asked for a transparent background, but the readback mostly writes it as solid white, sometimes solid black (about 80% and 8% of frames), and now and then as tiles of black, white and magenta that can cover the model too. It happens with the real `HOME` as well as a worker's. A pixel scan of the first full run found 159 such frames across 143 doodads, where the earlier check (one angle, shrunk to 16×16 and gated on a logged pipeline failure) had found one. The CLI now decodes every frame (`packages/core/src/preview/read-png.ts`), rejects any with magenta or a mixed border, prefers white-background frames (retrying the render up to 3 times), and keys the background out itself: white or black reaching the border, plus enclosed white areas of 24 pixels or more. Enclosed black is kept, because dark models shade to pure black; a dark model reaching the border can still lose bits of its black edges (e.g. `DOM_Crate`). A dark model reaching the border also reads as "mixed", so mixed frames are taken as a last resort, keyed as white, with the magenta check catching real tiles. Re-render (2026-10-27): 2,361 of 2,521 render, all with keyed backgrounds and no magenta-tiled frames; `JarbanMinor_MiningCart` is magenta in every frame and fails. The very first frame of a run is drawn on the viewer's grey clear colour (#353B45), not keyed at all; when the model's dark edges made the white frames read as mixed, that grey frame ranked above them and 172 doodads kept a grey angle 0. Such frames now read as "unkeyed" and are skipped.
  - **Descriptions (2026-10-27):** 365 doodads were described from these thumbnails into `packages/core/data/doodad-catalog.json` (`rendered: true` where the gallery has no picture). Sizes came from each model's MODL bounding box (`--save-m3` extracts the `.m3`; MD34 index → MODL, min/max/radius floats), since auto-fitted thumbnails lose scale.
- **Spike (2026-10-27), same commit, Vulkan only (MoltenVK):** renders work. `--headless-test` passes, and `ShakurasRockColumn_00`, `ShakurasFoliage_00` and `ShakurasArchonStatue_00` come out textured and recognisable. Each takes about 0.3 s once the app is running.
  - **Thumbnail recipe:** pass `--export-recipe <file.ini>` plus `--export-anim 0 30 <folder> --export-duration 34`. The recipe's `[Export]` section sets `HideOverlays=true` (no grid), `Transparent=true`, `PreRollMs=500` (without it the first frame can be magenta while textures stream in), `CameraMode=orbit`, `Angles=4`, `OrbitFit=true`, `OrbitFitMargin=1.5` (at the default 1.15, 1,179 of 2,361 rendered doodads touched the frame edge; at 1.5, 174 do, mostly effects reaching past the model's bounds; `AutoCrop` only crops, it doesn't rescale), `OrbitPitch=35`, `AutoCrop=true`, `Width=512`, `Height=512`. Keys are in `tools/basic_viewer/capture/export_ini.cpp`. Grid hiding and background exist only as recipe keys, not as command-line flags.
  - **Rough edges:** the first angle isn't keyed transparent; the others are (in this spike; see the full run above). Shading is darker than in game (SC2 materials are work in progress upstream).
  - **SDK without the LunarG installer:** Vulkan-Headers at tag `v1.4.341` (the CI pin) and VulkanMemoryAllocator `v3.3.0` (`include/vk_mem_alloc.h` → `<sdk>/include/vma/`), plus Homebrew `vulkan-loader` and `molten-vk`. Configure with `-DVulkan_INCLUDE_DIR=<sdk>/include -DVulkan_LIBRARY=$(brew --prefix vulkan-loader)/lib/libvulkan.dylib -DWDX_ENABLE_METAL=OFF`. CMake bundles Homebrew's MoltenVK into the `.app` itself.
  - **Still needed:** the `CMAKE_CXX_FLAGS` GLFW include, `CMAKE_OSX_DEPLOYMENT_TARGET=26.0`, Slang v2026.1.2, Xcode's `DEVELOPER_DIR`, and `cmake --install`. The other Metal-only workarounds aren't, and neither is the local `CopyBuffer` patch.
- **Windows (2026-11-14 to 11-18), same commit, Windows 11 ARM64 in Parallels, MSVC 14.44 (VS 2022 Build Tools), CMake 4.4, LunarG SDK 1.4.341.0:** builds for x64 and ARM64, renders only on WARP in the VM. `packages/plugin-host-windows/scripts/build-whiteoutflakes.ps1` builds it, and the Windows Host Adapter runs it ([windows-host.md](../../packages/plugin-host-windows/docs/windows-host.md#rendering-and-exporting-models)).
  - **Building:** upstream CI's flags (`.github/workflows/windows.yml`: `-A x64 -DWDX_BUILD_WC3_SHADERS=OFF -DWDX_USE_PREBUILT_SHADERS=ON -DWDX_BUILD_WC3_DEBUG_SHADERS=OFF -DWDX_ENABLE_TRACY=OFF -DWDX_BUILD_MAX_PLUGIN=OFF -DWDX_ENABLE_WEBGPU=OFF`) with `-G "Visual Studio 17 2022"`, `VULKAN_SDK` set and its `Bin` (slangc) on `PATH`, then `cmake --build <b> --config Release --target WhiteoutFlakesStandalone`. The exe lands in `<b>\standalone\` with `shaders`, `lang` and `fonts` beside it. An ARM64 build (`-A ARM64`) also needs `-DCMAKE_DISABLE_FIND_PACKAGE_Vulkan=ON` (the SDK's loader is x64 only) and the SDK's `Include` on the compiler's path anyway, because `tools/basic_viewer/app/platform_window.cpp` includes `vulkan/vulkan.h` unconditionally (`-DCMAKE_CXX_FLAGS_INIT=/I<sdk>\Include`). Cloning needs `core.longpaths=true`: `externals/dr_libs`' nested miniaudio has test files past `MAX_PATH`, and the submodule checkout fails without it. A fresh ARM64 build took about 21 minutes.
  - **Backends on the VM's GPU (Parallels):** none work. D3D11 creates its device, then loses it (device removed) during setup, and `--headless-test` fails after up to a minute. D3D12 fails `CreateGraphicsPipelineState` (E_FAIL). Vulkan has no driver (`ErrorIncompatibleDriver`). x64 (emulated) and ARM64 builds behave the same.
  - **WARP:** `D3D11CreateDevice` with `D3D_DRIVER_TYPE_WARP` renders correctly. Upstream has no switch for it (its device choice is by name or by dedicated memory, skipping software adapters), so `packages/plugin-host-windows/scripts/d3d11-warp.patch` adds an opt-in, `WF_D3D11_WARP=1`, in `src/gfx/d3d11/d3d11_device.cpp` (10 lines added, 1 changed; for the author to offer upstream). With it, `--headless-test` passes in about 20 s, the thumbnail recipe above renders `ShakurasRockColumn_00` textured at 4 angles, on white in every frame (so one attempt each), in about 20 s per run, of which the viewer reports about 2.5 s of exporting: the rest is opening CASC and reading the 3,780 GameData files. `--save-m3 <out> --save-m3-merge-anims` writes a valid MD34 file in 3 to 9 s, and it opens no device, so it works on the GPU as well.
  - **The install:** the viewer finds `C:\Program Files (x86)\StarCraft II` by itself.
  - **Caches beside the exe.** On Windows the viewer writes its pipeline cache (`vk_pipeline_cache.bin`, for Vulkan) and PSO trace (`pso_trace.bin`) into its exe's folder (`tools/basic_viewer/platform/platform_paths.cpp`), not under a home folder, so concurrent runs each need their own copy of the viewer's folder, which is what the Windows Host Adapter gives its workers. It also writes ImGui's `imgui.ini` into its working folder, even for a command-line export, so the adapter runs it in the worker's folder.
  - **Mod models:** loose `.m3` files and the textures beside them load as on macOS. A test mod whose diffuse texture was swapped for its normal map rendered in the normal map's colours, so the staged copy's texture won over the game's.
- **Building `main` on macOS:** CMake and Ninja (Homebrew), plus `slangc`. The standalone Slang release works (`-DSLANG_DIR=<sdk>`); CI gets it from the LunarG Vulkan SDK 1.4.341.0. It has to be an older Slang: v2026.20 rejects the bundled WC3 shaders (`uint frontFace : SV_IsFrontFace` in `externals/Wc3Shaders`, error E30701). v2026.1.2 works.
  - **Xcode for Metal:** the Metal backend needs full Xcode. `slangc` passes Metal shaders to Xcode's `metal` compiler, and Command Line Tools don't include it (build error `failed to load downstream compiler 'metal'`). On Xcode 26 and later, `metal` is a stub until you run `xcodebuild -downloadComponent MetalToolchain` (about 840 MB, no `sudo`). `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` selects Xcode for the build without `sudo xcode-select`.
  - **Workarounds for a Metal-only build** (`-DWDX_ENABLE_WEBGPU=OFF`, which CI never uses):
    - `src/gfx/metal/metal_swap_chain.mm` and `tools/basic_viewer/app/platform_window.cpp` include `GLFW/glfw3.h` and `vulkan/vulkan.h` unconditionally. Add both to `CMAKE_CXX_FLAGS`, which works because the project enables only CXX, so `.mm` files compile as C++. The Vulkan headers come from Homebrew `vulkan-headers`.
    - Link Homebrew `vulkan-loader` (`CMAKE_EXE_LINKER_FLAGS=-L<lib> -lvulkan -Wl,-rpath,<lib>`). With the loader present, add `-DCMAKE_DISABLE_FIND_PACKAGE_Vulkan=ON` so the Vulkan backend stays off.
    - Xcode 27's libc++ marks floating-point `std::from_chars` as macOS 26+, so set `CMAKE_OSX_DEPLOYMENT_TARGET=26.0`. CI uses 13.3 with an older Xcode.
  - **Assembling the app:** run `cmake --install <build> --prefix <stage>` to put shaders, fonts and translations into `Contents/Resources`. Then copy `shaders/mtlvs` → `shaders/metal/vs` and `shaders/mtlfs` → `shaders/metal/ps`. The prebuilt pack's install skips that remap, which is the same bug as v1.5.0.

## Prior art

### erivgout/sc2-map-editor-mcp

- **What:** an MCP server for reading and editing existing maps and mods. Windows-centred. Evaluated, not adopted ([map-package-findings.md](./map-package-findings.md#tools-evaluated)).
- **Language / licence:** TypeScript plus a C++ native packer; MIT. Confirmed.
- **Use:**
  - Its StormLib pack settings for campaign packaging: MPQ v1, zlib, regenerated `(listfile)`, backslash paths.
  - Its game-log patterns and its passed/skipped/unsupported result model for `validate-map`.
  - **Don't** copy its cliff encoding: it uses 16 per level, and Editor 5.0.17 writes 64.
- **Paths:** `native/sc2mpq/src/commands.cpp` (`pack`), `packages/sc2-core/src/editor/runtime.ts` (`Script compile error:`, `Script load failed:`, `Trigger Error in ... Near line`), `packages/sc2-core/src/editor/launch.ts`.

### VoVanRusLvSC2/SC2Editor-MCP-Codex

- **What:** an MCP server for the StarCraft II Editor, compared with ours in issue #735 (commit `4b230ed`). Windows-centred. Only the tickets' descriptions of it were used, none of its code or text.
- **Language / licence:** its licence covers its code and documentation (per #738): read it, don't copy it; re-implement from the idea.
- **Use:**
  - A source of rules about how the Editor loads Triggers and Galaxy, unverified on the Mac. Seven of them (issue #738) are checked in `editor-trigger-rules.md`; cite it as the source of the rule list.
  - The idea of refreshing an open map in place (check the document is clean, close it, swap the files, open the same path). Built as `editor.refresh` and `compile_map`'s `refresh` option (#739) from our own code and words, from comparing the two designs; none of its code or text was used. The Mac facts it rests on were read off a throwaway map on 2026-11-21; the adapter's behaviour still needs an Editor check: see "Same-file refresh" in `packages/plugin-host-macos/docs/macos-host.md`. The same comparison's `checkClosed` guard on `compile_map` shipped in #739's first part.
  - The idea of a static route check: report a route blocked by a cliff-level difference or cut-out cells without running the game. Re-implemented as `check_layout`'s `route-open` check (#749, `packages/core/src/layout/route-checks.ts`) from our own terrain code; none of its code or text was read.
  - Three ways to tighten package writes (#743), re-implemented from the idea alone: a lock across processes for a Map Package's writes (`packages/core/src/map/package-lock.ts`, a lock file in the temp folder holding the owner's pid and start time, a dead or old owner's lock taken over), a hash check between a Kept edit's read and its write (`kept-session.ts`), and `MapScript.galaxy` among the fingerprints a compile checks for the Editor's changes (`editor-changes.ts`). Their claims about the Editor are unverified here; none of the three depends on one, but how the Editor lays out a saved `MapScript.galaxy` is untested, so the compile compares the script's form (line endings, blank lines and comments set aside) before it asks.
  - Data rules for hero work. The five rules behind `docs/reference/data-rules.md` (#740) are re-implemented from the idea and each is checked against stock data here. Its claims stay unverified until an Editor check; that file says which.
  - The idea of a batch tool that runs several tools in one call and lets a later step refer to an earlier result (#751). Considered and not built: our tools are already coarse, each one is a whole step (compile, sync, check), so a batch saves few round trips; and a batch tool would need its own copy of every tool's input rules, Editor-open check and refusal, or would risk skipping them. Reopen it if an author workflow shows a repeated fixed sequence of three or more calls.
  - The idea of a read-only tool that shows an entry as the game sees it, with the entries that refer to it (`show_entry`, issue #742, `effective-entry.md`): inspired by this repo's idea only, with no code or text used, and unchecked in the Editor.
  - Seven terrain format facts (issue #745), checked against our writers and Editor-saved maps in `terrain-checks.md`: five match, the sync cliff level of a saddle cell was fixed, and the ramp-rail seam fact still needs an Editor check. Only the tickets' description of them was used.
  - The idea of a declarative test manifest a Blueprint carries, with route tests that should arrive or be blocked and combats with an expected outcome (issue #741). Idea only; none of their code or text was used. Only the route half is built (`tests.routes`, run by `check_layout`'s `route-tests` and `test_mission`, statically); see "Mission tests" in `game-testing.md`.
  - The combat half of the same manifest idea (issue #741): only the recording tool for its read-back question is built, `npm run probe-game` (`packages/core/src/host/game-probe.ts`), which logs the game's ClientAPI during a Test Document run. Idea only; none of their code or text was used. Needs an Editor check and an in-game check: whether a player's `result` changes at victory or defeat; no combat manifest is designed until that is recorded.
  - The idea of evidence records that go stale when the files they cover change (issue #748), built for Stage sign-offs and `capture_shots` captures: each records the files it covers with fingerprints and reports itself stale on read (checks are computed on demand and keep no record). Idea only; none of its code or text was used, and which files each Stage covers is our own call. Needs an Editor check: whether an Editor open-and-save of an unchanged package rewrites covered files (ADR-0010 says it re-lays them out), which would report Stage 3 and 4 sign-offs stale after a save with no edit.
  - Three claims about what the Editor does on a load and save (issue #744), recorded in `editor-saves.md` with `npm run compare-saves`, which reads a package before and after a save (changed Objects nodes, `Preload.xml` against the placed types, a locale's dropped strings). Only the ticket's statement of the claims was used. None is confirmed or ruled out: each needs an Editor check.
  - The idea of placement statistics for the Style Pack (issue #747): doodad density per tileset and vegetation-to-texture pairs, computed here from our own maps by `npm run placement-stats` and recorded in `placement-stats.md`. The ticket's own wording was the only source; none of their numbers, code or text was used.
  - The idea of cross-checking our cutscene support against Blizzard's Cutscene Editor manual and listing what we cover, check or ignore (issue #750), built from the Editor's own files instead, since the manual was not read: `cutscene-coverage.md` with `npm run cutscene-census`. Idea only; none of their code or text was used, and their Heroes-file format claims were not used. Needs a read of the manual to finish the comparison; gaps are not filed as tickets.
  - The idea of checking MapInfo's player table and option bits against Blizzard's melee maps (issue #746), recorded in `mapinfo-checks.md`: our melee writer matches the ladder maps, and the sc2-file-format-docs layout is cited as the layout's source. Idea only; none of their code or text was used.

### Blizzard/s2client-proto

- **What:** the SC2API protobuf definitions.
- **Language / licence:** Python tooling around `.proto` files; MIT. Confirmed.
- **Use:** message definitions for a headless `validate-map` over `/sc2api` (`CreateGame` with `local_map.map_path`, `Observation`, `Debug`). `sc2-ida-mcp-setup/docs/sc2api-raw-client.md` notes that the client-embedded schema can differ from upstream.

### Others listed in `reference-repos.md`, not relevant

`sc2-data-reader` (live memory), `sc2-standalone-client`, `superiority` (Battle.net protocol clients), `gsvm-research` (Galaxy bytecode VM), `sc2-layout-schema` (in `sc2-arcade-watcher/sc2-galaxy-toolkit`; UI layouts) and `s2m-decoder`/`s2mdec` (Arcade metadata). Useful only if we touch UI layouts (the styled flare countdown) or publishing.

## Applying this to sc2-adjutant

1. **Tileset tables from data.** Generate each tileset's blend textures and cliff sets (`packages/core/data/texture-extracted.json`, `cliff-extracted.json`) from `sc2-game-data` `TerrainData.xml`/`CliffData.xml`, as `npm run extract-catalog` already does from SC2GameData. Keep the overrides for tilesets a Campaign Mod defines.
2. **XML validation.** Add a test that validates generated `DocumentInfo`, `Objects`, `ComponentList.SC2Components` and catalog XML against `sc2-xsd`. Vendor only the XSDs we use, and note that the repo has no licence.
3. **MPQ packing.** For packed maps (SC2API `CreateGame`, campaign packaging), follow `koda-27/sc2publish` `mpq.py` (MIT) for a TypeScript writer. Use the `erivgout` StormLib settings as the target format. Build mpqcli locally as a stopgap and a cross-check.
4. **`validate-map`.** Combine the native arity list (`sc2-ida-mcp-setup` `output/`) with the prototypes in `sc2-game-data` `natives.galaxy`, the `erivgout` log patterns and result model, and `s2client-proto` for the headless run.
5. **Cite stable sources.** In code comments, cite `sc2-arcade-watcher/sc2-file-format-docs` rather than the IDA workspace.
6. **modkit.** Ask the arcade-watcher maintainers whether it's public. If it is, re-evaluate it as a reader for round-trip sync (Recommended Next Work item 4).
