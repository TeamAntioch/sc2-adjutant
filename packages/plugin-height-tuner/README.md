# height-tuner, an sc2-adjutant Utility

Tune a terrain texture's height map in the game. On a tileset that height-blends, how a texture shows
over the one under it depends on the red channel of its normal map: whether it covers the ground in
solid clumps, breaks up into stones with grass in the gaps, or reads as sunken. The tuner builds a
small **test map** per texture. The base texture is held at full weight, and there is one **strip** per candidate
normal map (a **variant**). Each strip's paint rises from 0 to 100% left to right. Capture the strips and
judge them on a Still Review page.

It is a Utility ([ADR-0023](../../docs/adr/0023-utility-plugin-role.md)). The normal maps it makes
come from your own install and go only into the test map under a Mission's git-ignored `output/`
([ADR-0027](../../docs/adr/0027-stock-files-made-on-each-machine.md)).

## Using it

Install the package beside sc2-adjutant and list it in the Workspace config:

```sh
npm install @team-antioch/sc2-adjutant-height-tuner
```

```json
{ "utilities": ["bundled:height-tuner"] }
```

At the next session start, its `height-tuner` skill is copied into the Workspace's `.claude/skills/`.

It reads the game's files with a **CASC extractor**, named in `SC2_CASC_TOOL`: install one as
[tools/README.md](../../tools/README.md#a-casc-extractor) says. The install is the machine config's
`sc2Path`.

```sh
node node_modules/@team-antioch/sc2-adjutant-height-tuner/dist/tune.js missions/<id>/blueprint.json ShakurasCity2 [--base BelShirGrassLightEx2] [--variants <list>] [--pitch <degrees>] [--install <StarCraft II folder>]
```

It writes `missions/<id>/output/height-tuner/<texture>/`:

| File | What it is |
|---|---|
| `HeightTune<texture>.SC2Map` | The test map, on the Mission's tileset and lighting |
| `shots.json` | One Shot a strip, for `capture_shots`, labelled `<n>. <variant> (0 to 100% left to right)` |
| `tune.json` | What each strip is: its variant, CTerrainTex id, normal map, scale and offset, mean height and share at 0; what the stock red channel holds; warnings |
| `blueprint.json` | The generated Blueprint the map is compiled from |
| `extract/` | The stock catalogs and normal map, from the install |

Capture the map with `capture_shots` (`mapPath` the map, `shots` from `shots.json`), then build a
Still Review round with `build_still_review`, one version whose capture holds every strip. The skill
runs all of it, with one subagent per texture when there are several.

## Variants

A variant is a word: `<kind>[:<% at 0>][*<HeightMapScale>][+<HeightMapOffset>]`. The default list is
`stock,crush:15,crush:25,crush:40,inverted-crush:15,inverted-crush:25,inverted-crush:40`. A map holds 7
strips: its texture set's 8 textures, less the base. `stock` is always the first strip.

| Kind | Its red channel |
|---|---|
| `stock` | The texture's own normal map. With a scale or offset, a copy with only those changed |
| `crush:<n>` | The source height with the tile's broad bands flattened, then the lowest *n*% of the tile at 0 and the rest stretched up to the stock top. The base texture grows in the gaps between the stones |
| `inverted-crush:<n>` | The same, upside down: the highest *n*% (the stone tops) at 0. The base sits on the tops and the stone reads as sunken, with deep crevices |
| `flat` | The source height with the broad bands flattened, at the stock top |
| `relevel` | The source height stretched to 0..1 |

**The source height** is the stock normal map's red channel when that is a height. When it is flat,
or a copy of the normal's Y (86 Liberty textures), the source is integrated from the normal's slopes
instead (Frankot-Chellappa, periodic edges), and the command warns. For a texture whose red channel is a
height, the command checks the sign of the integrated height against it: on ShakurasCity2 they agree at 0.93. It
warns below 0.5.

**The share at 0** is found from each texture's own height, so `crush:25` puts a quarter of the tile
at 0 on any texture. On ShakurasCity2, `crush:25` reproduces the research's `scrush` (ImageMagick
`-level 28%,100%`; correlation 0.997) and `crush:43` its `scrush2` (`-level 34%`).

Each non-stock variant is a map-local `CTerrainTex` named `<texture>_Ht<Variant>`, for example
`ShakurasCity2_HtCrush25`. It is a copy of the stock entry's Texture, EditorIcon, PhysicsMaterial,
TilingFreq, POMScale and HeightMapScale/Offset (but not its DoodadEntry), with its own normal map at
`Assets\Textures\HeightTune_<texture>_<Variant>.dds`. That normal map is the stock file with only its red channel
rewritten at every mip level. Its alpha (the normal's X) is kept byte for byte, and its green (Y)
is re-encoded with the red, in the same DXT colour block (core's `recolourDdsAt`).

## How the map is made

The command compiles a generated Mission Blueprint with core: the Mission's tileset and `lighting`,
one flat Zone painted with the base, and the textures `[base, texture]`. Then it dresses the package:

- texture slots 2-7 get the variants' ids in `t3Terrain.xml`, `t3SyncTextureInfo` and the
  tileset's map-local `CTerrain` override in `TerrainData.xml`, which also gets
  `HeightMapEnabled 1`;
- `t3TextureMasks` gets the strips: layer 0 (the base) at 15 everywhere, and strip *i* on layer
  *i* + 1, from 0 to 15 in 16 steps of 2 cells along its 32 cells;
- `Base.SC2Data/GameData/TerrainTexData.xml` and `Assets/Textures/` get the variants.

Each strip is 6 cells wide, with 10 cells of base between strips and a 24-cell margin. A Shot is 40×12
cells around its strip, so its 16:9 frame shows no other strip.

## What it's built on

These facts are in [terrain-height-maps.md](../../docs/reference/terrain-height-maps.md):

- A layer's height is the red channel of its `Normalmap`. The `Heightmap` field does nothing on this build.
- A map-local `CTerrainTex` entry, with a normal map shipped in the package, works in the game.
- Only layers painted at a texel compete there, so the base must be painted under the test texture.

## Files

| Path | What it is |
|---|---|
| `tune.ts` | The command |
| `build.ts` | The test map: the Blueprint, the compile, the slots, masks and data |
| `heights.ts` | The heights: reading the red channel, integrating a normal, flattening, crushing |
| `variants.ts` | The variant words and what each makes |
| `stock.ts` | The extractor, and reading the stock catalogs |
| `skills/height-tuner/` | The skill |
