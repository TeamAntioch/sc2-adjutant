# Decal catalog

The decal catalog says what every variation of every decal doodad shows, so dressing picks decal variations on purpose. It is the published [`@team-antioch/sc2-asset-catalog`](https://github.com/TeamAntioch/sc2-asset-catalog)'s (its `data/decal-descriptions.json` and `catalog/decal-catalog.js`, its ADR-0006), used here through the pinned package ([asset-catalog.md](../agents/asset-catalog.md)). Each decal doodad (`kind: "decal"` in `doodads.json`, 21 of them, 363 variations) has one entry per variation, by variation number.

The catalog exists because a painted number, letter or word promises that it labels something, such as a bay or a lane. Scattered at random it reads as noise. A Kept map's factory interior was first dressed with random decal variations, and the author cut most of them in the Editor: "The use of numbers didn't make much sense."

## A variation's entry

| Field | What it holds |
|---|---|
| `look` | What it shows, in a few words: "yellow-and-black hazard stripe, a quarter curve", "faint grey stencil DO NOT ENTER". |
| `shows` | What it draws, from a fixed list: `stripe`, `curve`, `corner`, `hazard-stripes`, `arrow`, `frame`, `hazard-sign`, `symbol`, `emblem`, `text`, `number`, `ornament`, `glow-line`, `light-strip`. |
| `glyphs` | The key field: `none`, `number`, `letter`, `words`, or `script` for Protoss and Xel'Naga inscriptions, which read as ornament rather than writing. |
| `text` | The number, letter or words it reads, as painted, for any glyphs but `none` and `script`. |
| `shape` | `line` (a run of paint), `corner` (a turn or bend in one) or `patch` (self-contained). |
| `tiles` | Whether copies laid end to end make a longer run, as a stripe and its corners do. |
| `use` | `marking` (a plain floor marking) or `ornament` (Protoss and Xel'Naga trim). Both can go anywhere. Or `label` (it names a place or a bay's job), `sign` (it warns of a hazard) or `emblem` (a faction's). These three go only where they mean something. |
| `texture` | The texture its projector paints. For a localized text decal, it's the enUS copy. |
| `size` | Its box in cells, x by y, at scale 1, when the model gives one. Most un-baked decals (`Decal`, `DecalSpace`, `DecalProtoss`) give none. Their `_Baked` twins paint the same textures and do give one. |
| `drawn` | `"geometry"` for a decal drawn as a model panel instead of projected: `SpacePlatformCliffDecal`'s cliff-face panels and `SpacePlatformGroundDecals`' light strips (09, 10). |

The `look` to `use` fields are written by hand, by looking at each variation's picture, and ship in the package. `texture`, `size` and `drawn` are read from the decals' model files in your own install by the package's `extract-decals` (below), into the cache. No compile reads them.

A few things worth knowing when choosing:

- `DecalSpace` 22 and 23 are the Warcraft Horde and Alliance crests, an in-joke that reads wrong in a StarCraft setting.
- The `Decal` numbers (4-13) and stencilled words (23-28) are faint grey in their pictures; how they read on the ground hasn't been checked in the Editor. `BattleStation_Number_Decals` and `DOM_Decals`' numbers are the bold ones.
- `BattleStation_Symbol_Decals` 4-10 are hexagonal bay badges: repair, missiles, refuelling, fighters, vehicles and mechs. They label a bay's job as surely as words do.
- The Protoss, Purifier, Aiur and Xel'Naga decals are additive: the black in their pictures adds nothing in the game.

## How dressing uses it

`packages/core/src/catalog/stock-catalog.ts` binds it (`stockDecals()`: the descriptions alone, so every machine picks the same), and `src/dressing/decal-variations.ts` picks from it.

- **Random picks** (`randomVariations`): when the dresser picks a variation at random, for a decal the catalog describes it picks only from those that can go anywhere. Those are the ones with no number, letter or words whose `use` is `marking` or `ornament`. This covers set-piece members, edge lines, a broken run's debris, and a Doodad Composite member whose variation is `any`. If a doodad has none, such as `BattleStation_Number_Decals`, every variation stays in play, since the doodad was asked for by name. A doodad whose model the Workspace's Campaign Mod replaces isn't described, so it keeps all its variations.
- **On purpose**: a set-piece or dressing member, or an edge line, can name its `variations`, for example `{ "type": "BattleStation_Number_Decals", "count": 1, "variations": [3] }` for bay 3. That's how a number or a word goes where it labels something.
- **Looking up**: the MCP `decal_variations` tool filters the catalog by doodad, words, `shows`, `glyphs`, `shape`, `tiles`, `use` or `scatterable`. For example, `glyphs: ["none"], use: ["marking"], shows: ["stripe"], tiles: true` gives the plain lane lines. Each match carries its texture and size, and the path of its doodad's sheet, once `extract-decals` has run on this machine.

## Pictures

Most decals are projectors. Their `.m3` has no geometry, only a projector (`PROJ`) box that paints one texture onto the ground beneath it, and the WhiteoutFlakes viewer doesn't draw projectors: it logs `no geometry and no emitters`. That's why `npm run thumbnails` fails on 20 of the 21 decal doodads. So a variation's picture is its texture, squeezed to its box's proportions, on mid-grey. Each variation has its own model file and almost always its own texture. The text decals' textures are localized, one per language under `<locale>.sc2assets`.

The package's `extract-decals` reads each variation's texture and box from a folder of the decals' model files and textures that you extracted from your own install with a CASC extractor ([tools/README.md](../../tools/README.md)), and writes them to `extracted/decal-extracted.json` in the package's cache folder (`~/Library/Caches/sc2-asset-catalog` on macOS, `%LOCALAPPDATA%\sc2-asset-catalog` on Windows, or `SC2_ASSET_CATALOG_CACHE`). With ImageMagick it also writes one PNG per variation to the cache's `thumbnails/decals/` and one numbered sheet per doodad to `catalog-sheets/decals/<doodad>.jpg`. They're rendered game assets, kept on your machine and never committed. `extract` comes first: it says which doodads are decals, how many variations each has and where its model is.

Extract each decal doodad's folder under `Assets/Doodads` and every texture with "decal" in its name under `Assets/Textures`, with the extractor's `-I <regex> -x -o <folder>`, then:

```sh
npx @team-antioch/sc2-asset-catalog extract
npx @team-antioch/sc2-asset-catalog extract-decals <folder>   # names any texture it couldn't find
```

Some textures don't have "decal" in their names (`Stripe_*`, `NumbersTextDecal1`, `Light_Strip1`, and the text decals under each locale). `extract-decals` names any it couldn't find: extract those too, and run it again.

`SpacePlatformCliffDecal`'s variations are geometry: each one shows its own region of a shared atlas, so its sheet shows the whole atlas. Picture it with the turntable renders instead: `npm run thumbnails -- SpacePlatformCliffDecal --all-variations`.

A new decal doodad, or a game patch that changes one, needs its new variations described by eye, by pull request on sc2-asset-catalog. Core's test (`tests/dressing/decal-variations.test.ts`) fails until every decal doodad in core's `doodads.json` has an entry for each of its variations.
