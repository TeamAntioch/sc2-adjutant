Terrain objects placed by hand in StarCraft II Editor 5.0.17 on our generated
terrain-objects map (`blueprint.json` here) (2026-10-28), saved as the Editor wrote them.

- Top level: two Korhal Holes (`rot` 0 and 3) on level-1 ground, Castanar Bridge Vertical Small
  (Bridge6x10) at (67, 63) across the east-west chasm, Castanar Bridge Horizontal Small
  (Bridge10x6) at (95, 93) across the north-south chasm, and a Zerg Hole Small (Height 2) on the
  level-2 plateau. `blueprint.json` asks for the same placements. Both chasms are two cells wider than
  the bridges span, so each stamp fills one end (the compiler warns); the committed mission
  blueprint narrows the chasms to fit.
- `rotation/`: four Space Platform Destructible Cliff (Large) at `rot` 0-3. The `rot` 1 and 3
  copies left a stray strip of level 0 beside their stamps (they were probably placed unrotated
  first); only the stamps themselves are compared.
- `row-direction/`: one Castanar Bridge Diagonal (Height 1) at (60, 53), `rot` 0, on a flat
  level-1 Castanar field (`t3Terrain.xml` and `t3HeightMap` only). Its stamp is asymmetric, so
  it settles that a HeightCodes row runs west to east; its deck runs north-west to south-east.

The Editor re-quantised the whole height map on save, so only levels, sync levels, cell flags,
cliff cells and the cliffDoodadList are compared, not heights.
