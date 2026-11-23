// The texture grid's geometry, shared by the generator, the Kept-ground paint brushes and the
// texture-set code: t3TextureMasks' texels per cell and layers, and the 8×8-cell blocks each of
// which draws on one of a map's texture sets (docs/reference/terrain-file-formats.md, "Texture sets").

/** t3TextureMasks' texels along a cell's side. */
export const TEXELS_PER_CELL = 8;
/** The layers of t3TextureMasks, and the textures of a texture set. */
export const LAYERS = 8;
/** The most texture sets a map has. */
export const SETS = 8;
/** A texture set covers 8×8-cell blocks. */
export const CELLS_PER_BLOCK = 8;

/** The 8×8-cell block a cell is in: [blockY * blocksPerRow + blockX]. */
export const blockOf = (blocksPerRow: number, cellX: number, cellY: number): number => Math.floor(cellY / CELLS_PER_BLOCK) * blocksPerRow + Math.floor(cellX / CELLS_PER_BLOCK);
/** A block's south-west cell. */
export const blockOrigin = (block: number, blocksPerRow: number): { readonly x: number; readonly y: number } => ({ x: (block % blocksPerRow) * CELLS_PER_BLOCK, y: Math.floor(block / blocksPerRow) * CELLS_PER_BLOCK });
/** A block's cells, as warnings and refusals name them: "16-23 × 40-47". */
export const blockLabel = (block: number, blocksPerRow: number): string => {
  const { x, y } = blockOrigin(block, blocksPerRow);
  return `${x}-${x + CELLS_PER_BLOCK - 1} × ${y}-${y + CELLS_PER_BLOCK - 1}`;
};
