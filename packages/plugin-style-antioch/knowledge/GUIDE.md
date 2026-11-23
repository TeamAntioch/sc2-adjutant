# The Antioch look, step by step

How the `exemplar-design` method's steps apply with this Style Pack: which Design Lessons govern each step, how much each weighs, and the guides each step uses. The rules are the ratified Design Lessons in [`LESSONS.md`](../exemplar-maps/LESSONS.md). Read the whole file before proposing anything, and cite lessons by id ("DL-06").

Through the sc2-adjutant MCP server, each file this guide links is one of the pack's knowledge documents, at `sc2-adjutant://plugins/style-antioch/knowledge/<id>`: `LESSONS.md` is `lessons`; `TEXTURES.md`, `CLIFFS.md`, `DRESSING.md`, `INTERIORS.md`, `LIGHTING.md`, `SKY.md`, `WATER.md` and `TERRAIN-OBJECTS.md` are `textures`, `cliffs`, `dressing`, `interiors`, `lighting`, `sky`, `water` and `terrain-objects`; `mixtures.md` and `mixtures.json` are `mood-mixtures` and `mixtures`; `data-analysis.md` is `data-analysis`; the Exemplar Maps' README is `exemplar-maps-readme`; and each map's `study.json` is `study-<id>`. The pack holds no screenshots: in-game frames aren't shipped or served.

## Weights

Each lesson carries a **weight**. Evidence from Blizzard's campaign maps counts at least as much as 3-11, the map the pack's author made (the author, 2026-11-08: "they're pros"), and both outrank the edited maps; agreement between Blizzard and 3-11, and across independent maps, counts most. 3-1 reuses about two-thirds of 3-0, and 3-8 contains 3-7, so those pairs count once. A low-weight or optional lesson (DL-11's scale jitter on natural props, DL-12's point lights under a daylit sky) is offered to the author, never applied by default.

## Leading words

- **Backdrop**: a level band or area units never walk on (pits, void floors, distant heights). One texture and no floor clutter; a small pit can stay bare, a larger one is covered (water, lava, open sky or thick fog) and dressed vertically with wall pieces and a few silhouettes (DL-01, DL-13).
- **Ground for play**: terrain units walk on. Never one texture on natural ground (DL-01); built or tiled floors may be.
- **Set piece**: a dense cluster of dressing with a purpose, surrounded by empty ground (DL-06).
- **Family**: props that tell one story together, such as a battlefield or a ruin (DL-08).
- **Doodad Composite**: a new shape built from manipulated stock doodads, kept as a recipe (DL-07).
- **Kit**: the roles that make a built place read as working: a machine, what feeds it, its stock, its light and its floor marks (DL-08). Generated from its roles, not copied ([`INTERIORS.md`](INTERIORS.md)).
- **Wall band**: the walls round a room's floor, which carry most of an interior's dressing (DL-06).
- **Mood**: what the mission's light, and each Beat's change of it, is chosen from; there is no default palette (DL-09).

## Propose a look

1. **Read the agreed sketch**: mark every Zone or level band as backdrop or ground for play (DL-01), and name each Zone's mood (DL-09).
2. **Build the tileset** (DL-14): one main planet, 0-3 accent texture families, one or two cliff families paired with the ground they border (DL-04, through the blueprint's `cliffPalette` and, per area, `cliffSets`: [`CLIFFS.md`](CLIFFS.md)), plus water and lava pools through the blueprint's `water` ([`WATER.md`](WATER.md)), and the skybox, fog and any open sky through its `sky` ([`SKY.md`](SKY.md)).
3. **Texture each Zone** through the blueprint's `texturePalette`, following [`TEXTURES.md`](TEXTURES.md) (which starts by asking the author): backdrop gets one signature texture; ground for play gets touches of other textures throughout, with a blend style chosen per area (DL-01, DL-03). The cliff carries elevation, best with a change of texture across it (DL-02). Built ground is pads inside natural ground. Interior floors (labs, ships) can be one texture; outdoor built areas such as cities still mix floors in every view.
4. **Dress each Zone** through the blueprint's `dressing` and `set-piece` placements ([`DRESSING.md`](DRESSING.md), which also covers review feedback): cliffs first (DL-05), then edge lines: curbs end to end round built ground, wild clumps of plants on cliff lips (DL-18), then set pieces with empty ground between them (DL-06), each a story family (DL-08); no solid prop stands alone (DL-08), and pieces hang, stack and sink where it helps (DL-19). A built room is the exception to empty ground: dress it wall first and keep its floor clear, to the densities, order and kits in [`INTERIORS.md`](INTERIORS.md) (DL-06, DL-18 for painted lanes). Plant trees as solid canopy blocks, about 1 to 1.5 cells apart with clear ground between, and frame a forest map with forest outside its playable bounds (DL-16). Yaw: free for natural props, 45° snaps for built props and decals; scale 1 for built props (DL-11). Give each place a mood and dress it from that mood's mixture in [`mixtures.json`](../exemplar-maps/mixtures.json) (motifs, type count, density, spacing, snapping; fill motifs from this mission's tileset), never by copying an exemplar's layout (DL-08); name an exact Doodad Composite recipe only for a shape no asset provides (DL-07). A city Zone is a district of a dozen or more small themed places set into pockets between bare rooftops; ask the author whether its places should be populated with idle units that fit their story (DL-15).
5. **Light the mission** through the blueprint's `lights`, `lighting`, `lightRegions` and `transitions` ([`LIGHTING.md`](LIGHTING.md)) from its mood (one retuned light, and painted lighting regions where a place has a light of its own), and for each Beat ask whether its story calls for a lighting change; list the ones that do, with the music and dressing that change with them: a cut, a drift or a pulse (DL-09). Light a place on its own only when it is a different space, such as an interior. In a dark place (a night mood, an interior, a cave, the void), place point lights with their prop families (DL-12; indoors about one omni light per 170 floor cells), and on a night map check in a test frame that each ground type sits at its own brightness (DL-17). Add water rises as transitions where the story floods or erupts (DL-13).
6. **Finishing steps**: the author runs the Editor's Generate Static Shadows (Data menu, Cmd-Shift-L) after the last cliff edit and saves; any later cliff edit wipes it (DL-10). The compiler doesn't reproduce it.
7. **Present it**: for anything the author may not picture, describe what a lesson's evidence shows (each citation names its map, lighting and stop or place) and point at the map's layer images (`textures.png`, `doodads.png` and the rest beside its `study.json` in the pack's folder; not served, so show them when you can read the pack's files). When this machine has the frames (the research archive under `$SC2_RESEARCH_DIR`, `docs/research/exemplar-maps/<id>/frames/` and `evidence/`, written as the Exemplar Maps README's "Generating the screenshots" says), show one or two; otherwise say the frame isn't available, or capture the author's own map with `capture_shots`.

## Blueprint hooks

Each lesson names a Blueprint hook. Known conflict: doodad anchors default to a random 0.85-1.15 scale, which DL-11 says should be off by default and never applied to built pieces; set `scale: 1` explicitly until the default changes (TeamAntioch/sc2-adjutant#530).

## Going deeper

- Built pieces that reshape the ground (bridges, pits, trenches, craters, elevators): [`TERRAIN-OBJECTS.md`](TERRAIN-OBJECTS.md), placed through the blueprint's `terrainObjects`.
- Numbers behind a lesson: [`data-analysis.md`](../exemplar-maps/data-analysis.md), and each map's Map Study (`exemplar-maps/<id>/study.json`).
- Frames of every place: generated, not shipped. Where they exist they're in the research archive (`docs/research/exemplar-maps/<id>/frames/`, 1000 px place tours with `stops.txt` giving camera targets); a place in [`mixtures.json`](../exemplar-maps/mixtures.json) names its frames by that path and gives its `center`.
- **Adding an Exemplar Map**: follow [`exemplar-maps/README.md`](../exemplar-maps/README.md), or start the pack's `add-exemplar-map` prompt.
