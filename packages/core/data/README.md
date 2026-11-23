# Core's data

Every JSON file here ships in core's package (its `files` list has `data/*.json` and `data/cinematic-sets/*.json`), and core reads it at run time. Most of it is read from the game's data; the rest is ours, measured or written by hand. This page says why each one ships.

`npm run check-packs` (and so `npm test`) fails when a JSON file here, or in `cinematic-sets/`, has no row below, or a row names a file that isn't here. A new file gets its row in the same change.

## Why core ships game data rather than extracting it on first run

The doodad catalog package extracts Blizzard's fields into each mapper's cache on first start, and ships only what we wrote (ADR-0022). Core doesn't, for four reasons:

- **A compile reads it.** Most of these files decide what a compile writes or what `check` warns about. Shipped, they're the same on every machine, so a Map Package doesn't depend on when or where a mapper's cache was filled, or on which game patch the mirror held then.
- **Some need tools a mapper doesn't have.** `trigger-libraries.json` and `catalog-schema.json` are read from the install's CASC storage with an extractor (`tools/README.md`). The model files are exported through a Host Adapter, and the fronts and descriptions are read or written by looking at renders.
- **Ours and the game's are mixed in one file.** The terrain-object catalog holds our descriptions beside the game's facts, and its generator keeps the descriptions when it refreshes the facts.
- **It's small.** All of it packs to well under the 20 MB tarball limit `check-packs` sets.

Spec #813 lets the public packages hold data read from the game. Only the catalog package keeps to ADR-0022's "nothing extracted ships".

## The files

"SC2GameData" is SC2Mapster's mirror of the game's XML on GitHub; "sc2-game-data" is the pinned mirror the UI scripts read. Each generator's header says how to run it.

| File | What it holds | From | Why it ships |
|---|---|---|---|
| `catalog-schema.json` | the game's data schema: classes, fields and types | the install's CASC storage, `scripts/build-catalog-schema.mjs` | `compile_mod` checks a Mod Blueprint's catalog entries against it; it needs the install and a CASC extractor to rebuild |
| `cliff-extracted.json` | each tileset's cliff sets in order, and each cliff set's tilesets and gallery picture | SC2GameData and the sc2-mapping-reference gallery, `npm run extract-catalog` | the compile writes a tileset's cliff sets from it, and the compile and Blueprint checks read its ids; the stock cliff catalog joins it to the catalog package's descriptions |
| `doodad-extracted.json` | each doodad's name, package and gallery picture | SC2GameData, `npm run extract-catalog` | the stock doodad catalog joins it to the catalog package's descriptions; shipped so a compile reads the same doodads on every machine with no extract step |
| `display-channels.json` | which render-to-texture channels each model in the cinematic-set catalog shows, `[]` for none | models exported through a Host Adapter, `npm run display-channels -- --catalog-sets` | says which Set pieces are screens and what each shows, for Cinematic feeds and the set catalog; needs a Host Adapter to rebuild |
| `doodad-facings.json` | which way doodads face and where they stand against a wall | our facing strip, `npm run facing-strip` | dressing turns doodads by it; measured from a compiled strip map |
| `doodad-models.json` | each doodad's model file | SC2GameData, `npm run extract-catalog` | the compile resolves a doodad's model from it; shipped with `doodads.json` |
| `doodad-outlines.json` | doodads' ground outlines, every variation | models exported through a Host Adapter, `npm run doodad-outlines` | the compile paints no-pathing under solid set-piece doodads from it; needs a Host Adapter to rebuild |
| `doodad-sheet-readings.json` | doodads' fronts read from turntable renders | read by eye, `npm run sheet-readings` | dressing turns doodads by it where no facing was measured |
| `doodads.json` | each doodad's kind, categories, tilesets, variations and whether it blocks the ground | SC2GameData, `npm run extract-catalog` | the compile and the doodad search read it; shipped so every machine compiles the same doodads |
| `game-models.json` | the storage path of every model file the game's CModels name | sc2-game-data, `scripts/build-game-models.mjs` | the compile refuses a doodad's `gameModel` that isn't here |
| `light-catalog.json` | every stock CLight, parents resolved, with a summary to choose from | SC2GameData, `scripts/build-light-catalog.mjs` | the compile copies a light's fields into a map-local CLight from it; Blueprint checks read its ids |
| `model-anims.json` | models' animations, with each one's length and movement speed | models exported through a Host Adapter, `npm run model-anims` | the compile and Cinematics time animations by it; needs a Host Adapter to rebuild |
| `model-footprints.json` | models' bounds and what their materials draw as | models exported through a Host Adapter, `npm run model-footprints` | `check` warns about overlapping Set pieces from it; needs a Host Adapter to rebuild |
| `model-guide.json` | curated guides to casting the game's models | written by hand | the catalog layer reads it beside a Workspace's own guides |
| `music-sounds.json` | the Music Sounds our maps load that play audio, with each file's length | the music catalogue, `tools/music/music_sounds.py` | trigger scenes check music cues and their lengths against it |
| `package-entries.json` | the CModel and CLight ids each of the game's packages defines, for the packages whose dependency chain is known | sc2-game-data, `scripts/build-package-entries.mjs` | the compile and `check` warn when a Cinematic's cast, Set or Light is a package's the map's dependencies don't load |
| `tech-catalog.json` | every stock unit, upgrade, behaviour and effect id | SC2GameData, `scripts/build-tech-catalog.mjs` | Blueprint `tech`, trigger scene unit changes and effect cues are checked against it |
| `terrain-object-catalog.json` | every terrain object, with its name, model, tilesets and cliff-level stamp | SC2GameData and our descriptions, `scripts/build-terrain-object-catalog.mjs` | the compile stamps terrain objects' cliff levels from it; its descriptions are ours |
| `texture-extracted.json` | each tileset's 8 blend textures in layer order, and each texture's tilesets, file, name and gallery picture | SC2GameData and the sc2-mapping-reference gallery, `npm run extract-catalog` | the compile writes a map's texture set from it, and texture painting and Blueprint checks read its ids; the stock texture catalog joins it to the catalog package's descriptions, shipped so every machine compiles the same textures |
| `tileset-lights.json` | each tileset's default CLight | SC2GameData, `scripts/build-tileset-lights.mjs` | a Mission takes its tileset's default light from it |
| `tileset-sky.json` | each tileset's skybox, hidden lowest level and fog | SC2GameData, `scripts/build-tileset-lights.mjs` | the compile writes a map's sky from it |
| `trigger-libraries.json` | the game's trigger library functions, params and presets as the Editor's Galaxy generation needs them, with their names, hints and categories and the trigger types' names | the install's CASC storage or a folder of the game's data, `scripts/build-trigger-libraries.mjs` | the compile writes a Campaign Mod's GUI library functions as Galaxy from it, and `search_trigger_functions` searches it; it needs the install and a CASC extractor, or the game's data extracted, to rebuild |
| `ui-frame-paths.json` | every frame Blizzard's layouts declare, with its template | sc2-game-data, `scripts/build-ui-frame-paths.mjs` | `check`'s frame-path warning tells a real frame path from one nothing defines by it |
| `water-types.json` | every stock CWater, parents resolved | SC2GameData, `scripts/build-water-catalog.mjs` | the compile copies a pool's water type from it |
| `cinematic-sets/catalog.json` | every set in Blizzard's Cutscene Editor files: pieces, marks, cameras, Lights | the game's Cutscene Editor files, `npm run catalog-sets` | `import_set` finds a set's source file by it, and the stock catalog takes its pieces' model files from it; rebuilding needs the game's cutscene files |
| `cinematic-sets/looks.json` | each set's written look | written by hand from renders | the Set Finder reads it for core's sets a release doesn't carry yet; written by looking |

`cinematic-sets/README.md` and `cinematic-sets/plans/` don't ship. The plans are top-down SVG diagrams of every catalogued set, with the names of its marks and cameras read from Blizzard's files, for whoever works in a checkout. Nothing reads them at run time. A mapper sees a published set's plan on its Set Finder card, from sc2-mapping-reference's gallery, and `import_set` writes its marks and cameras into the Mission. `check-packs` fails if `plans/` ships.
