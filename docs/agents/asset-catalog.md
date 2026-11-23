# sc2-asset-catalog and sc2-adjutant

The doodad, texture, decal and cliff catalogs, the Doodad Finder and the Set Finder live in the public repo [TeamAntioch/sc2-asset-catalog](https://github.com/TeamAntioch/sc2-asset-catalog) (ADR-0022, #796). sc2-adjutant depends on its published npm packages, all pinned to one exact version, since they're released together:

- `@team-antioch/sc2-asset-catalog`: the doodad, texture, decal and cliff set descriptions and the Doodad Uses (core reads them from the installed package and keeps no copy), the extractors, the keyword search and narrowing, the facings, the sheet builder, the texture search, lookup and picture sheet, and the decal search. Core imports it as `@team-antioch/sc2-asset-catalog/catalog/<module>.js`.
- `@team-antioch/sc2-doodad-finder`: the page, the Jev ranker, `startFinder` and the public CLI. sc2-adjutant's wrapper imports it as `@team-antioch/sc2-doodad-finder/<module>.js`.
- `@team-antioch/sc2-set-finder`: the public cinematic sets' cards (their looks are the catalog's `data/set-looks.json`, their pictures linked from sc2-mapping-reference's gallery), their narrowing and Jev ranking, the page, `startSetFinder`, `openSetFinder` and the public CLI. sc2-adjutant's wrapper imports its main export, `@team-antioch/sc2-set-finder`.
- `@team-antioch/sc2-finder-kit`: what the finders share (the embeddings model, payload log, spend cap, ranker types). The Set Finder's wrapper imports it as `@team-antioch/sc2-finder-kit/<module>.js`.

## What stays here

- **Core's data.** `packages/core/data/` commits its own copy of the extracted fields a compile reads (`doodads.json`, `doodad-models.json`, `doodad-extracted.json`; `texture-extracted.json`, each tileset's blend textures and each texture's tilesets, file, name and gallery picture; and `cliff-extracted.json`, each tileset's cliff sets and each set's tilesets and gallery picture), so a compile reads the same doodads, textures and cliff sets on every machine. `npm run extract-catalog` regenerates them with the package's extractors (`-- --check` lists the differences). It also keeps its own terrain objects, measured facings and sheet readings. The descriptions and Doodad Uses aren't here: `contribute_doodad_notes` adds to them by pull request on sc2-asset-catalog (see [campaign-catalog.md](../reference/campaign-catalog.md#doodad-uses)), and a Workspace's uncontributed or unreleased Doodad Uses are laid over the package's until a release carries them.
- **The binding.** `packages/core/src/catalog/stock-catalog.ts` points the package's code at those files (`stockTextures()` and `stockCliffs()` are the texture and cliff catalogs; `tileset-textures.ts` and `tileset-cliff-sets.ts` lay a Campaign Mod's over them). Core code that reads the stock catalog goes through it; the package's own functions (the search, uses, notes, `searchTextures`, `lookUpTextures`) are imported straight from the package. `texture_sheet` draws the package's picture sheet to PNG (`src/catalog/texture-sheet.ts`), keeping the pictures in the machine's cache folder's `texture-pictures/`. A compile reads the decals' descriptions alone (`stockDecals()`, for `src/dressing/decal-variations.ts`); `decal_variations` also reads each variation's texture and size, and its doodad's sheet, from the package's cache once its `extract-decals` has read this machine's install ([decal-catalog.md](../reference/decal-catalog.md#pictures)).
- **The Doodad Finder's wrapper.** `packages/doodad-finder` is sc2-adjutant's Finder: `src/adjutant/` passes `startFinder` the Workspace's sources, Mission badges, Doodad Searches and look closer. It also holds the `find_doodads` and `open_doodad_finder` MCP tools and the test command. Its README says how.
- **The Set Finder's wrapper.** `packages/set-finder` is sc2-adjutant's Set Finder: `src/sets.ts` lays this machine's own sets over the published ones as the package's layers, with their pictures in the cache folder's `set-views/`. Those are the Workspace's own sets (its `cinematic-sets/` folder holds their looks and catalog; `publicSets` in core's `capture/export-sets.ts` leaves them out of the public catalog), and any public set a release doesn't carry yet (core's `data/cinematic-sets/looks.json`, Blizzard's sets alone). A published set keeps its published card. The package also holds the `find_sets` MCP tool. Its README says how. `npm run export-sets` writes the public sets' looks into a catalog checkout for a release. Core's `tests/capture/published-set-looks.test.ts` (in `npm test` and CI) fails when the pinned package's `data/set-looks.json` isn't what the export would write from core's `looks.json` and set catalog, naming the sets that differ: re-export and release, or bump the pin when a release already carries the change. A public set no release carries yet is listed but passes, since the Set Finder lays it over the published ones. The check takes each set's size and camera count from the published file, since only the machine's cache measures them, and counts every picture a look names as drawn.

`scripts/check-catalog-moved.mjs` (in `npm run lint` and `npm test`) lists the modules that moved and fails if one comes back. It also fails if a pin isn't exact, or if the packages are pinned at different versions.

## Changing the catalog or the Finder

A change to the moved code is made in sc2-asset-catalog, by pull request there, and reaches sc2-adjutant with a release:

1. Clone sc2-asset-catalog beside this checkout, at `../sc2-asset-catalog` (beside the main checkout when working in a linked worktree).
2. `npm run link-catalog` builds it and links its four packages (the catalog, the finder kit, the Doodad Finder and the Set Finder) into `node_modules` in place of the published ones. Rebuild there (`npm run build`) after each change. sc2-adjutant runs its `dist/`.
3. Make the change there, with its tests, and check sc2-adjutant's suite against it here.
4. `npm run unlink-catalog` puts the published packages back. `node scripts/link-catalog.mjs status` says which are installed. Linking never touches `package.json` or `package-lock.json`, and neither does `npm ci`, which also undoes a link.
5. Once sc2-asset-catalog has released the change (Changesets publishes the packages together), bump the pin here in its own pull request, in `packages/core/package.json`, `packages/doodad-finder/package.json` and `packages/set-finder/package.json`:

   ```sh
   npm install --save-exact -w @team-antioch/sc2-adjutant @team-antioch/sc2-asset-catalog@<version>
   npm install --save-exact -w @team-antioch/sc2-adjutant-doodad-finder @team-antioch/sc2-asset-catalog@<version> @team-antioch/sc2-doodad-finder@<version>
   npm install --save-exact -w @team-antioch/sc2-adjutant-set-finder @team-antioch/sc2-asset-catalog@<version> @team-antioch/sc2-finder-kit@<version> @team-antioch/sc2-set-finder@<version>
   ```

   A release that changes the catalog's data or API may need core's binding or tests changed in the same pull request. If the extracted fields changed, `npm run extract-catalog` regenerates core's copy, and the golden shows whether any compile output moved.

CI (`.github/workflows/ci.yml`) always installs the pinned, published packages and refuses a link. It lints and tests every package against them on Linux, macOS and Windows, so a pull request bumping the pin is checked before it merges.

Never patch `node_modules`. A bug in a published package is reported, or fixed, in sc2-asset-catalog.
