# Test Fields

A Workspace of small test maps for core's features, each a flat field built to show one thing in the
Editor. They use stock units and no custom mod, so any author can compile them.

- `missions/lighting-preview/`: a Bel'Shir field that `npm run lighting-preview` compiles with a
  trigger cycling candidate flare lights against the tileset's baseline (the CLI's default Blueprint).
- `missions/terrain-objects/`: a Castanar field with chasms sized to the Castanar bridges that cross
  them, two Korhal Holes and a Height 2 zerg hole on a plateau: the worked example of `terrainObjects`.
- `missions/bridge-connections/`: four Castanar islands over a chasm joined by compiled bridges, one
  of each case: an exact fit, bridgeheads, the long bridge, and a gap narrower than any bridge.

Compile one from the repo root, into its own `output/` (which `.gitignore` keeps out of commits):

```sh
npm run compile-map -- packages/core/examples/test-fields/missions/terrain-objects/blueprint.json \
  packages/core/examples/test-fields/missions/terrain-objects/output/terrain-objects.SC2Map
```
