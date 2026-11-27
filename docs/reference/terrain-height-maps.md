# Terrain height maps: what decides a layer's height, and tuning one

On a tileset that height-blends, a terrain texture's paint weight is cut by its height. A lightly
painted texture then shows in patches where it stands higher than its neighbours, not as an even tint. This note
covers where that height comes from, what changes it, and the recipes the `height-tuner` Utility
([packages/plugin-height-tuner](../../packages/plugin-height-tuner/README.md)) makes from it.

Sources: in-game captures on copies of an author's Mission map (tileset AiurTempleJungle, which height-blends),
2026-11-27, each frame compared against the unchanged map; the game data mirror's
`mods/core.sc2mod/base.sc2data/Shaders/TerrainBlend.fx`; and measurements of every stock normal
map, read from the install. **[game]** marks what was seen in game, **[data]** what was read in a
file, and **[inferred]** a reading with its reason.

The draft `docs/reference/height-blending.md` on the Paint Regions stack (#146, ADR-0028) came
before these tests. Where it disagrees with this note, this note is right: the height does not
need the `Heightmap` field, and a texture with no `Heightmap` field still height-blends (below).

## What decides what shows

Per texel and per layer *i*, with paint weight *wᵢ* (0..1, the `t3TextureMasks` nibble over 15),
height *hᵢ* (0..1) and the texture's `HeightMapScale` *Sᵢ* and `HeightMapOffset` *Oᵢ*:

1. *mᵢ = wᵢ · (hᵢ·Sᵢ + Oᵢ)*
2. *mᵢ ← mᵢ · (1 − clamp(max(m) − mᵢ, 0, 1))*: a layer more than 1.0 below the strongest is cut out
3. normalise the 8 to sum to 1. **[data]** `TerrainBlend.fx`, `TerrainBlend_BlendTerrainNormalHeight`.

The layers' weights are independent: layer 0 isn't implicit, and the file doesn't normalise them. So:

- **Only layers painted at a texel compete there.** A base texture can show through the gaps of the
  texture over it only where it has paint weight of its own. Paint the base under the texture you
  tune. **[data]**, and **[game]** on that map.
- At equal weights the height alone decides. A high scale (3-5 on the Bel'Shir Ex2 textures and
  Slayn7, 25-35 on Slayn) makes the cut nearly binary. **[data]**

## Where the height comes from

- **The height is the red channel of the layer's `Normalmap`.** A DXT5 terrain normal map holds
  the normal in green (Y) and alpha (X), and the height in red. **[data]** (the shader samples each
  layer's normal map once and takes `.r` as its height). **[game]**: changing only R of a map-local copy of
  the normal changed the look.
- **The `Heightmap` field does nothing on this build.** Pointing ShakurasCity2's `Heightmap` at its
  own normal, or at Zerus3's flat (R = 255) one, changed nothing: 0.7% and 0.1% against the
  unchanged frames, the noise floor. **[game]** So a texture with no `Heightmap` field height-blends
  from its normal's red channel, and the way to change a texture's height is a new `Normalmap`.
- **`HeightMapScale` and `HeightMapOffset` work.** Slayn7 (stock scale 5, offset 0.3) at scale 2
  covered about half the ground, and at scale 1 with offset 0 it nearly vanished into the grass.
  ShakurasCity2 at scale 0.5 made its clumps smaller and sparser. **[game]** Their defaults when
  unset are presumably 1 and 0 **[inferred]**: 53 of 108 stock entries that set `Heightmap` set no
  scale, and the data doesn't say.
- **A map-local entry with a normal map in the package works.** `Assets/Textures/<name>.dds` inside
  the `.SC2Map`, with `<Normalmap value="Assets\Textures\<name>.dds"/>` in the map's own
  `Base.SC2Data/GameData/TerrainTexData.xml`, needs no include list. A partial entry over a stock id
  merges, and so does a full copy under a new id. **[game]**
- **The tileset must height-blend**: `HeightMapEnabled 1` on the map's `CTerrain`, from stock data
  or a map-local override. 27 stock tilesets turn it on, all LotV ones. **[data]**

## Which stock textures have a height

All 699 stock `CTerrainTex` (Void 379, Liberty 192, Swarm 128), their normal maps' top mip measured
(standard deviation of R; correlation of R with G). **[data]**

| What the red channel holds | Count | Notes |
|---|---|---|
| A real height (LotV layout, R uncorrelated with the normal) | 393 | Void 337, Swarm 39, Liberty 17. 102 of them set `Heightmap`, which changes nothing |
| Flat (sd ≤ 3/255, nearly always 255) | 207 | Never height-blends. `ShakurasCity1` and `TarsonisInterior2` are flat at 0 |
| A copy of the normal's Y (WoL layout, R = G = B, corr > 0.85) | 86 | All Liberty. A lighting-shaped pattern, not a height: keep these out of height-blended sets, or give them a height |
| No normal map in the install | 13 | `BlackOpsLabB1-8`, `Generic_4-8` |

Some textures share one normal map: ShakurasCity2's is byte-identical to AiurTempleJungle4's, and
Slayn7 and BelShirDirtLightEx2 measure the same. The tuner reads the red channel itself on every
run, so this table is background only.

## Making a height

Edit only R. Keep G and A, or the lighting changes as well as the height. Re-encoding DXT5 keeps A byte for byte (its own block half), but G
is re-encoded with R in the same colour block, so it comes back close to the original, not identical. The tuner does this with core's
`recolourDdsAt`, at every mip level. ImageMagick 7 does it too:
`magick normal.dds height.png -compose CopyRed -composite -define dds:compression=dxt5 -define dds:mipmaps=10 out.dds`.

**The source.** Start from the texture's own red channel when it is a height. It already puts the
stones in the right place: a height integrated from the normal's slopes (Frankot-Chellappa,
periodic edges, Y not flipped) agrees with ShakurasCity2's at 0.93. For a flat red channel or a
normal-Y copy, use the integrated height.

**Check the sign against something independent.** The first "fromcolor" and "crush" heights made on
that map were upside down. ImageMagick's `-compose Mathematics -define compose:args=0,1,-1,0.5` computes
*blur − image*, because Mathematics' Sc is the second image, so the "high-pass" inverted the height:
it correlated −0.48 with Blizzard's own, and the crush put the grass on the stone tops. The author
caught it on a recording. The right order is `compose:args=0,-1,1,0.5`. A height made one way is
checked against another source (the red channel against the integrated height), never against a second
height made the same way.

**Flatten the broad bands.** A tile carries light and dark bands about 500 texels wide on 1024 (its
stones are 40-160). Subtract a wide blur that wraps round the tile's edges (σ ≈ 120 on 1024), add
0.5, and stretch to 0..1. The result correlates 0.99 with the stock height. Some banding remains, so watch for
the base texture showing in stripes.

**Crush** a share of the tile to 0 and stretch the rest up to the stock top. Under a texture painted
over a base, the zeroed part is where the base shows. Give the share as a quantile of the flattened
height: a level percentage doesn't carry across textures, since heights spread differently. On
ShakurasCity2, `-level 28%,100%` zeroes a quarter of the tile, while the same 28% on the inverted
height zeroes almost nothing. The research's `scrush` (level 28%) is the tuner's `crush:25`, and
`scrush2` (level 34%) is `crush:43`.

## Taste: what the author picked (that map, 2026-11-27)

- **Crush, for a texture the ground should grow through.** ShakurasCity2 over BelShirGrassLightEx2
  at the stock scale, with a quarter of the tile crushed: whole stones standing in the grass, and grass
  filling the gaps. The author: "exactly what I'm looking for here. This slaps." 43% left fewer,
  smaller stones. At HeightMapScale 3 the crush went too far, leaving a few dark lumps. So the dial is the curve first (how
  much goes to 0), then the scale.
- **Inverted crush, for depth.** The stone tops go to 0 and the gaps stay high, so the base
  sits on the tops and the stone reads as sunken, with deep, dark crevices. The author: "we can
  do cool things with the inverted crush, though. That actually gives us a ton of depth to a
  texture." It is a look of its own, not a fix.
- The hard clump outlines ShakurasCity2 first showed on that map came from the variety painter's
  rules (small patches, full-strength cores, short fades), not from its height. Most of its texels
  were painted at 3-7/15, with the grass under them.

## What sc2-adjutant can't do yet

- A Mission Blueprint has no catalog entries and no height declaration. A tuned texture reaches a
  Mission only through a hand-made map-local `TerrainTexData.xml` entry and normal map, or a Campaign
  Mod Generic Entry with the normal map in the Asset Mod.
- A tuned normal map is derived from Blizzard's file, so it isn't committed (ADR-0027), and the
  `game` Asset Source takes only a model's member. A declared height would need a derived step
  that makes the normal map on each machine from the stock one.
