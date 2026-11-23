A 128×128 BelShirEx1 map with a second texture set, CharDunes, painted over blocks 7-9 × 6-8 (cells 56-79 × 48-71). Made in StarCraft II Editor 5.0.17 and saved on 2026-11-02 (`terrain-sets.SC2Map`).

- This folder holds the first save.
- `boundary/` holds the second save, from the same map. In it, `BelShirGrassLight` (set 0) is painted across the square's west edge, where the Editor cut it off at the boundary. `CharDunes_4` is added to set 1 and painted just inside that edge.
- `block-move/` holds the third save. Grass is painted south of the square, then the Texture Set brush moves 8 blocks there onto set 1.
- `ours/` is our own edit of the third save, made by `paint-brushes.ts`. The Editor opened it and saved it on 2026-11-02 with `t3Terrain.xml`, `t3TextureMasks` and `t3SyncTextureInfo` byte-identical. It moves block 154 (cells 80-87 × 72-79) onto set 1, then paints `CharDunes_6` over cells 74-91 × 74-79, feathered 3 cells. The stroke runs over into set-0 blocks, which it leaves alone.

The files are byte-for-byte as the Editor wrote them, except that `t3TextureMasks` is gzipped (4,194,368 B raw, mostly one layer). They're decoded in `docs/reference/terrain-file-formats.md`, under "Texture sets".
