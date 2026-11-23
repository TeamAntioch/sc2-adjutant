# Lighting regions

A map can paint up to three extra lights onto its ground, each blending into the others, in place of trigger-driven light changes. The light under a unit changes as it walks, and backtracking needs nothing. A Mission Blueprint declares them in `lightRegions` and each Zone names its region in `lightRegion`. The compile paints the mask and writes the regions into the map's Light (`packages/core/src/map/light-regions.ts`).

## In the Blueprint

```json
"lighting": "BelShirSunset",
"lights": [{ "id": "Deep", "from": "StarshipDark", "ambient": { "scale": 0.9 } }],
"lightRegions": {
  "regions": {
    "2": { "from": "BelShirSunset", "ambient": { "scale": 0.6 }, "key": { "scale": 0.6 } },
    "3": { "ambient": { "color": [0.2, 0.19, 0.2] }, "key": { "scale": 0.45 } },
    "4": { "from": "Deep" }
  },
  "blend": 8
},
"zones": [
  { "id": "surface", ... },
  { "id": "ledge", "lightRegion": [1, 2], ... },
  { "id": "deep", "lightRegion": 4, ... }
]
```

- **Region 1** is the map's Light as it is: the Blueprint's `lighting`, else the tileset's own. A Zone with no `lightRegion` is region 1.
- **`regions`** declares regions `"2"`, `"3"` and `"4"`, any of them. Each is a light with the same knobs as a `lights` entry, but without `direction` and `exposure`, because a region has neither.
  - `from` copies a Light's ambient and its key, fill and back colours and multipliers. It can be one of `lights` with its knobs already turned, a Plugin's Light or a stock one. Without `from`, the region starts from the map's Light.
  - `ambient` and `key`, `fill` and `back` each take a `color` and/or a `scale`. A scale multiplies the ambient's brightness, or a directional light's multiplier.
  - `specular` (`color`, `scale`) starts from the key: its specular colour, else its colour, at the key's multiplier times its specular multiplier.
  - `environment` is the region's `AmbientEnvironmentMultiplier`. `fog` is its fog colour (0-1). By default both follow the region's ambient, dimmed by its brightness against the map Light's (at most 1): environment is the map Light's own multiplier (1 when it has none) dimmed, and fog is the mission's fog colour (`sky.fog.color`, else its fog tileset's or its own tileset's) dimmed. These defaults are first guesses. The hand-made prototype under [In game](#in-game) set its own.
- **A Zone's `lightRegion`** is one region (`2`) or a list shared equally (`[1, 2]` is half and half; up to four). Seven steps of a descent fit in four regions this way: 1, 1/2, 2, 2/3, 3, 3/4, 4.
- **`blend`** is about how many cells an edge blends across, 8 when left out (a Gaussian of 3 cells' sigma), 0 for hard edges.

**How the mask is painted.**
- Every cell takes the region of its nearest walkable Zone, so rock between two Zones splits down the middle.
- Inside a Zone the distance is 0, and where two overlap the later Zone wins, as it does for the ground.
- Backdrop Zones aren't painted: they take their nearest walkable Zone's region, and a `lightRegion` on one is warned of.
- Each region is then blurred over `blend`. Every pixel's four weights add to 255.

**What the compile warns of:**
- a Zone that names a region `regions` doesn't declare (it's painted as region 1);
- a declared region no walkable Zone paints;
- a `from` that is none of `lights`, a Plugin's or stock (it is written as the map's Light);
- a map Light the compile can't read;
- a transition that switches to another Light. The regions belong to the map's Light, so they vanish while another is on. Drop light-ladder transitions when moving to regions.

Beside Kept terrain, regions aren't painted yet. The compile warns and leaves the package's own `LightingMap.tga` and LightData as they are.

## The mask file

`LightingMap.tga` in the map package's root, picked up by name. No ComponentList entry or catalog field names it. Checked on Antioch 3-10 (`tac-arcade/Maps/Episode 3/Antioch 3-10`) and the 14 Antioch maps that have one:

- 4 pixels per terrain cell each way: 1024×1024 for a 256 map, smaller for smaller maps.
- Uncompressed true-colour (image type 2), 32 bits, descriptor byte `0x28`: 8 alpha bits, top-left origin. The top row is the map's north edge (high y), checked against 3-10's minimap.
- Pixels are stored B, G, R, A. Each holds four region weights adding to 255: R is region 1, G region 2, B region 3, A region 4, so `LightRegions` index 0-3. Unpainted ground is R = 255. The order is inferred: 3-10 overrides indices 1 and 2, and its G and B cover exactly what it painted.
- The weights blend, so soft edges give gradients.
- Every Editor-saved mask ends in the TGA 2.0 footer (8 zero bytes, then `TRUEVISION-XFILE.` and a NUL). The compile writes it the same way.
- A map without regions has no mask. Of the 35 Antioch maps, 14 have one.

## The regions in LightData

Each region's light is in the Light itself, as `ToDInfoArray/<n>/LightRegions index="0..3"`, with these fields:
- `UseDefault` (0 for a region of its own);
- `AmbientColor` and `AmbientEnvironmentMultiplier`;
- `SpecularColor` and `SpecularMultiplier`;
- `FogColor`;
- `DiffuseColor` and `DiffuseMultiplier`, each indexed `Key`, `Fill` and `Back`.

There is no exposure or light direction per region: those stay the Light's own.

The Light that holds the regions:
- Is set by the terrain's `<CTerrain><Lighting value=...>` in TerrainData.xml (the Blueprint's `lighting`).
- When it's stock, the compile writes a map-level `<CLight id="<stock light>">` holding only the `LightRegions`, which merges with the stock Light. 3-10 does exactly this with `AiurCity`.
- When it's one of the Blueprint's `lights` (or a Plugin's), the regions go into that Light's full copy.
- Only the first time of day (`ToDInfoArray/0`) gets regions, as the light catalog holds only the first.

A trigger that swaps Lights needs regions on the new Light too: they are part of a Light, not of the map.

## The Editor and compile's change detection

Checked on 2026-11-10 with a compiled copy of a Kept Mission with seven blended regions. A plain Editor save rewrote ComponentList, DocumentHeader, BankList and the Preload files. It left `LightingMap.tga` and `LightData.xml` byte for byte as compiled.

The compile records the mask as a whole file (`file:LightingMap.tga`). A recompile over the Editor-saved package reports no change. The compile compares the mask with its footer added when it lacks one, so a mask written without the footer (as hand-made masks often are) isn't a change either. One repainted pixel is: the compile stops with `file:LightingMap.tga: changed in the Editor`, for `--keep` or `--discard` like any whole file.

Not yet seen: a save after painting regions in the Editor's Lighting window. The footer and header the Editor writes there are those of the 14 masks in the Antioch Style Pack's Exemplar Maps, which the compile matches.

## In game

A hand-made prototype of a Mission's regions was looked at in game, and the author chose it over the trigger ladder. Painted from the same Zones, the compile's mask matches that prototype's within 0.2/255 on average and 16/255 at most, along a few blend edges (a 3-pass box blur against PIL's). Its ambient and directional colours are the prototype's exactly. Specular, environment and fog differ, because both are first guesses.
