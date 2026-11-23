# Choosing textures

How to fill the blueprint's `texturePalette` for steps 2 and 3 of [`GUIDE.md`](GUIDE.md). The lessons decide what the ground should look like; this file is how to find the textures and write them down. The fields are defined on `texturePalette` in `packages/core/src/domain/mission-blueprint.ts`; the compiler paints them (`packages/core/src/terrain/paint-textures.ts`), following this pack's rules in [`rules.ts`](../rules.ts) for DL-01's patches, DL-02's advice and DL-03's blends.

## The palette

- `main`: the main level's base texture (the cliff level with the most ground).
- `low` and `high`: the levels below and above it, each falling back to `main`. Each is a band, or a list of bands, one per level away from the main level (the last repeats). A band is a texture name, or `{ "texture": …, "variety": [ … ] }` with up to 3 variety textures of its own. Set them whenever the map has those levels, so every cliff changes texture (DL-02); `npm run compile-map` warns where a cliff joins two levels with the same texture.
- `variety`: up to 3 textures patched into the main level as patchwork, so natural ground is never one texture (DL-01). High and low ground for play gets its band's own variety at full strength, or light touches (about an eighth) of these. Keep variety near its base in tone: the compiler blends same-toned textures wide and meets different tones at a narrow seam (DL-03, by the catalog's `tone`).
- `built`: paints Zones whose `surface` is `built`, as a single-texture floor with a thin seam (DL-01, DL-03).
- A Zone's own `texture` wins over all of it.
- A Zone with `backdrop: true` (ground units never walk on: a pit floor, a void, a distant height) wears its band's texture alone, with no touches (DL-01). If it's larger than a small pit, plan its cover and silhouettes too (DL-01; DRESSING.md).

Any texture can go in any palette, whatever the tileset; the compiler writes the mix as a map-local `CTerrain` override (the start of DL-14's map-local tileset). A palette holds at most 8 textures.

**More than 8.** A map with several looks, such as one per depth of a cave, gives each look past the first a texture set of its own (the `texture-sets` skill), up to 16 textures across the map. Give each set a `palette` of the same fields, from its own textures, so its natural ground gets variety (DL-01) and its levels their bands (DL-02); without one its Zones wear one texture each. A set's `levels` picks the looks by depth: `"levels": [1, 2]`.

**Pads.** Built ground is pads, plazas, roads and platforms: small Zones of `surface: "built"` at the elevation of the Zone around them, set inside its natural ground, each joined to it by an `open` connection both ways (so the layout checks see one walkable space). Layout Zones keep their natural ground; only the pad Zones are built. A whole base in one built texture reads as a flat slab (Editor review of Zero Hour, 2026-10-26).

**Height follows the texture.** Ground gets gentle rolls (±0.3, smooth over about 8 cells, not a random height per vertex), but only where natural textures are painted. Man-made textures (catalog `kind: "built"`: paving, plating, grating) lie flat wherever they go, including a zone's own `texture` on natural ground, and the rolls ease in across a blended seam (the author, 2026-10-29). Pick a man-made texture for a zone only where flat ground fits.

## Finding textures

The catalog holds every texture the tilesets use. Its descriptions are the published [`@team-antioch/sc2-asset-catalog`](https://github.com/TeamAntioch/sc2-asset-catalog)'s, written from each texture's picture: `look`, `kind` (natural or built), `tone` (light, mid, dark) and `suits` (base, variety, high, low, path, accent). Entries with `"seen": false` were described from their name alone; prefer ones with pictures. Core's [`packages/core/data/texture-extracted.json`](../../../packages/core/data/texture-extracted.json) adds each texture's English `name`, the `tilesets` that list it and its gallery picture, and each tileset's 8 blend textures. Search it by words rather than reading it whole, with the `texture_sheet` tool's `search`, which lists the matches and shows their pictures, or from a shell:

```sh
npm run texture-sheet -- --out sheet.png --words sand --suits variety
```

Core's extracted fields are regenerated with `npm run extract-catalog`. A description is changed by pull request on sc2-asset-catalog and reaches here with a release (`docs/agents/asset-catalog.md`).

## Steps

1. **Ask the author** whether they have a tileset or specific textures in mind. One question, then wait. Use what they name, found in the catalog by `name`, and fill only the open slots.
2. **Suggest the rest** from the catalog for the story's world and builders: a calm `main`, `high` and `low` that differ from their neighbours (a band per level when there are several), 2-3 `variety` textures in `main`'s tone, a band's own variety where its ground for play would clash with the main variety, and a `built` texture of the story's builders if it has pads. Mark backdrop Zones. Present a table (slot, texture, its `look`, the lesson or story reason). Done when the author approves it or names changes.
3. **Write it**: `texturePalette`, the pad Zones, `backdrop` marks, and a Zone `texture` only where the story singles one out. Drop `textures` unless the author wants a fixed list. Done when the blueprint parses and `npm run compile-map` succeeds without texture warnings (or the author has chosen to keep one).
4. **Look at it.** Have the author open the compiled map in the Editor (see `packages/plugin-host-macos/docs/macos-host.md`) and adjust from what they see. Done when they're happy with the ground.
