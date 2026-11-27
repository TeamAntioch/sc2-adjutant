// The texture grid's geometry, shared by the generator, the Kept-ground paint brushes and the
// texture-set code: t3TextureMasks' texels per cell and layers, and the 8×8-cell blocks each of
// which draws on one of a map's texture sets (docs/reference/terrain-file-formats.md, "Texture sets").

/** t3TextureMasks' texels along a cell's side. */
export const TEXELS_PER_CELL = 8;
/** The layers of t3TextureMasks, and the textures of a texture set. */
export const LAYERS = 8;
/** What a texel's 8 layer weights sum to. */
export const FULL_WEIGHT = 15;
/** The most texture sets a map has. */
export const SETS = 8;
/** A texture set covers 8×8-cell blocks. */
export const CELLS_PER_BLOCK = 8;

/** The 8×8-cell block a cell is in: [blockY * blocksPerRow + blockX]. */
export const blockOf = (blocksPerRow: number, cellX: number, cellY: number): number => Math.floor(cellY / CELLS_PER_BLOCK) * blocksPerRow + Math.floor(cellX / CELLS_PER_BLOCK);
/** A block's south-west cell. */
export const blockOrigin = (block: number, blocksPerRow: number): { readonly x: number; readonly y: number } => ({ x: (block % blocksPerRow) * CELLS_PER_BLOCK, y: Math.floor(block / blocksPerRow) * CELLS_PER_BLOCK });
/**
 * The set a block of a fully generated map goes to (ADR-0016): the one whose Zones cover most of its
 * cells, a tie to the lowest index (set 0, then the order of the Blueprint's `textureSets`), and set
 * 0 when no Zone covers any. `cellSets` are the covered cells' own sets, each below `setCount`.
 */
export function blockSet(cellSets: Iterable<number>, setCount: number): number {
  const counts = new Array<number>(setCount).fill(0);
  for (const set of cellSets) counts[set]!++;
  return counts.indexOf(Math.max(...counts));
}
/**
 * A paint stroke's feather (docs/reference/terrain-file-formats.md, "Paint"): its strength `d` cells
 * from where it is whole, `1 − smoothstep(d / falloff)`, 0 from the falloff on. The Kept-ground
 * brush fades out past its area with it, and a Paint Region fades in from its outline (ADR-0028).
 */
export function feather(d: number, falloff: number): number {
  if (d >= falloff) return 0;
  const s = d / falloff;
  return 1 - s * s * (3 - 2 * s);
}
/** The distance (cells) from a point to the nearest point of the cell (ix, iy), 0 inside it. */
export const distanceToCell = (px: number, py: number, ix: number, iy: number): number => Math.hypot(Math.max(ix - px, 0, px - ix - 1), Math.max(iy - py, 0, py - iy - 1));
/** A block's cells, as warnings and refusals name them: "16-23 × 40-47". */
export const blockLabel = (block: number, blocksPerRow: number): string => {
  const { x, y } = blockOrigin(block, blocksPerRow);
  return `${x}-${x + CELLS_PER_BLOCK - 1} × ${y}-${y + CELLS_PER_BLOCK - 1}`;
};
