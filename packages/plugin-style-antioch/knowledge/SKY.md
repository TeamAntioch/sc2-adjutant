# Sky

How to set a mission's sky and fog through the blueprint's `sky` (DL-14). Everything here is written into the map-local tileset override, so it holds from the first frame and the Editor shows it too.

## Fields

- **`from`**: a stock tileset whose two sky layers to copy (`packages/core/data/tileset-sky.json`): the fixed `skybox` and the `parallax` layer that pans with the camera.
- **`skybox`**, **`parallax`**: either layer's model by name, over what `from` copied.
- **`hideLowestLevel`**: level-0 pits (`elevation: 0`) become open sky, the floating-platform look. Without it, the tileset's own setting holds (Starship, SpearOfAdun, TheVoid, Ulnar and 20 others already hide it). The hidden level is unpathable and gets no dressing, and its cliffs get no piles.
- **`fog`**: `from` copies a stock tileset's fog, then `enabled`, `color` (0-1 per channel), `density`, `falloff` and `startingHeight` override it.

## Steps

1. **Decide whether the sky shows.** From the gameplay camera the sky only shows through a hidden lowest level; elsewhere it's a cutscene backdrop. A mission on platforms over space or the void hides its lowest level and makes its pits the backdrop. Done when every level-0 zone is either ground for play (level kept) or open sky.
2. **Pick the sky** from the mood, often another planet's (DL-14: the exemplars put Shakuras, BelShir, Void and Zerus skies over other tilesets). What a sky looks like through a hidden level, checked in game:
   - `StarshipSkyBox`: an orange nebula with stars.
   - `Void_Skybox` (with or without `Void_Skybox_Parallax`): black, as on 3-11.

   Any other sky is unchecked from above: build a test and look before relying on it.
3. **Pick the fog.** The exemplars copy one of three stock presets: cyan (`Starship`, `Zerus`: 121,214,244 at 0.10), dark blue-grey (`ShakurasEx1`: 45,68,86 at 0.06), or 3-11's bright blue (0,172,255 at 0.20, falloff 0.10). Fog fills low ground: it shows in pits and on the backdrop more than on the plateaus.
4. **Check it in game.** A hidden level shows only in Test Document, or in the Editor where the view has been redrawn.

The compiler warns about a sky model no stock tileset uses, a hidden level with no pits, and an anchor standing over the void.
