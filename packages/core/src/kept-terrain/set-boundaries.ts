// The stretches of a boundary between texture sets that need cover (#539, ADR-0016). A boundary
// between sets is never clean: where different textures meet, the game draws a hard, straight cut
// along the 8-cell block edge, and where a texture meets itself, whatever slot it has in each set,
// the Editor renders an artifact. Authors hide both under walls, cliffs or doodads, so each is
// listed as a run of cells along a block edge, with the texture on each side.
//
// - **Which pairs.** Each pair of cells either side of a block edge whose blocks are on different
//   sets. The textures are read from the texels nearest the edge, SEAM_DEPTH deep, in each set.
// - **Artifact or cut.** A texture with weight on both sides near the edge meets itself: an
//   artifact, listed as one even where the sides' main textures differ, since it shows either way.
//   Otherwise the two sides' textures differ: a hard cut. Each side's texture is the layer with the
//   most weight there (the lower layer on a tie), in its block's set.
// - **Under a cliff.** A pair with a cliff cell (t3CellFlags' cliff bit) on either side is under the
//   cliff mesh, needs no cover and is left out, only counted.
// - **Stretches.** Neighbouring pairs along one edge line with the same kind, sets and textures are
//   one stretch, across block corners too.

import { CELL_FLAG_CLIFF } from "../terrain/cliffs.js";
import { cellSet, type KeptTextures, SEAM_DEPTH, setTextures } from "./paint-brushes.js";
import { CELLS_PER_BLOCK, LAYERS, TEXELS_PER_CELL } from "../terrain/texture-grid.js";

export type StretchSide = { readonly set: number; readonly texture: string };

export type BoundaryStretch = {
  readonly kind: "cut" | "artifact";
  /**
   * The block edge: "x" is the line x = at between cell columns at - 1 and at, running in y; "y"
   * the line y = at between cell rows at - 1 and at, running in x.
   */
  readonly line: "x" | "y";
  readonly at: number;
  /** The first and last cell along the line. */
  readonly from: number;
  readonly to: number;
  /** The cells before the line (column or row at - 1) and after it (at). */
  readonly sides: readonly [StretchSide, StretchSide];
  /** The textures with weight on both sides, which an artifact shows; none for a cut. */
  readonly shared: readonly string[];
};

export type SetBoundaries = {
  readonly stretches: readonly BoundaryStretch[];
  /** Pairs of cells on a boundary left out as under a cliff. */
  readonly underCliff: number;
};

/**
 * Every stretch of boundary between sets that needs cover, as above, ordered by line and position.
 * `cellFlags` is t3CellFlags' cells ([y * width + x]); without it no cell is under a cliff.
 */
export function setBoundaryStretches(textures: KeptTextures, { cellFlags }: { readonly cellFlags?: Uint8Array | undefined } = {}): SetBoundaries {
  const { stretches, cliffPairs } = scanBoundaries(textures, cellFlags);
  return { stretches, underCliff: cliffPairs.length };
}

/** The stretches, as above, and the sets either side of each pair of cells left out under a cliff. */
function scanBoundaries(textures: KeptTextures, cellFlags: Uint8Array | undefined): { stretches: BoundaryStretch[]; cliffPairs: [number, number][] } {
  const { width, height } = textures;
  const stretches: BoundaryStretch[] = [];
  const cliffPairs: [number, number][] = [];
  const cliff = (x: number, y: number) => cellFlags !== undefined && (cellFlags[y * width + x]! & CELL_FLAG_CLIFF) !== 0;
  for (const line of ["x", "y"] as const) {
    // Along x = at the cells run in y, and along y = at in x.
    const [across, along] = line === "x" ? [width, height] : [height, width];
    for (let at = CELLS_PER_BLOCK; at < across; at += CELLS_PER_BLOCK) {
      let open: { stretch: BoundaryStretch; key: string } | undefined;
      const close = () => {
        if (open) stretches.push(open.stretch);
        open = undefined;
      };
      for (let i = 0; i < along; i++) {
        const [lowX, lowY, highX, highY] = line === "x" ? [at - 1, i, at, i] : [i, at - 1, i, at];
        const lowSet = cellSet(textures, lowX, lowY);
        const highSet = cellSet(textures, highX, highY);
        if (lowSet === highSet) {
          close();
          continue;
        }
        if (cliff(lowX, lowY) || cliff(highX, highY)) {
          cliffPairs.push([lowSet, highSet]);
          close();
          continue;
        }
        const pair = meeting(textures, line, at, i, lowSet, highSet);
        const key = JSON.stringify(pair);
        if (open && open.key === key && open.stretch.to === i - 1) {
          open.stretch = { ...open.stretch, to: i };
          continue;
        }
        close();
        open = { key, stretch: { ...pair, line, at, from: i, to: i } };
      }
      close();
    }
  }
  return { stretches, cliffPairs };
}

/** What meets across the edge at cell `i` of the line: each side's texture, and any texture on both. */
function meeting(textures: KeptTextures, line: "x" | "y", at: number, i: number, lowSet: number, highSet: number): Pick<BoundaryStretch, "kind" | "sides" | "shared"> {
  const { masks } = textures;
  const low = new Array<number>(LAYERS).fill(0);
  const high = new Array<number>(LAYERS).fill(0);
  const edge = at * TEXELS_PER_CELL;
  for (let t = i * TEXELS_PER_CELL; t < (i + 1) * TEXELS_PER_CELL; t++) {
    for (let d = 0; d < SEAM_DEPTH; d++) {
      const [lowTexel, highTexel] = line === "x" ? [t * masks.maskWidth + edge - 1 - d, t * masks.maskWidth + edge + d] : [(edge - 1 - d) * masks.maskWidth + t, (edge + d) * masks.maskWidth + t];
      for (let layer = 0; layer < LAYERS; layer++) {
        low[layer]! += masks.layers[layer]![lowTexel]!;
        high[layer]! += masks.layers[layer]![highTexel]!;
      }
    }
  }
  const lowNames = setTextures(textures, lowSet);
  const highNames = setTextures(textures, highSet);
  // An empty slot with weight shows nothing, so it meets nothing.
  const present = (names: readonly string[], weights: readonly number[]) => new Set(names.filter((name, layer) => name !== "" && weights[layer]! > 0));
  const onHigh = present(highNames, high);
  const shared = [...present(lowNames, low)].filter((name) => onHigh.has(name)).sort();
  // No weight at all shows nothing, as an empty slot does.
  const top = (names: readonly string[], weights: readonly number[]) => (Math.max(...weights) > 0 ? (names[weights.indexOf(Math.max(...weights))] ?? "") : "");
  const sides: [StretchSide, StretchSide] = [
    { set: lowSet, texture: top(lowNames, low) },
    { set: highSet, texture: top(highNames, high) },
  ];
  return { kind: shared.length > 0 ? "artifact" : "cut", sides, shared };
}

/** The cells a stretch runs along, on each side. */
export const stretchCells = (stretches: readonly BoundaryStretch[]): number => stretches.reduce((sum, stretch) => sum + stretch.to - stretch.from + 1, 0);

/** "1 stretch", "2 stretches". */
export const stretchCount = (count: number): string => `${count} stretch${count === 1 ? "" : "es"}`;

/** One line a stretch, for texture_usage and the compile. */
export function describeStretches(stretches: readonly BoundaryStretch[]): string[] {
  return stretches.map((stretch) => {
    const cells = stretch.to - stretch.from + 1;
    const runs = stretch.line === "x" ? "y" : "x";
    const where = `along ${stretch.line} = ${stretch.at}, ${runs} ${stretch.from === stretch.to ? stretch.from : `${stretch.from}-${stretch.to}`} (${cells} cell${cells === 1 ? "" : "s"})`;
    const side = (s: StretchSide, at: number) => `${s.texture || "(empty slot)"} (set ${s.set}, cells at ${stretch.line} ${at})`;
    const both = `${side(stretch.sides[0], stretch.at - 1)} | ${side(stretch.sides[1], stretch.at)}`;
    return stretch.kind === "cut" ? `Hard cut ${where}: ${both}` : `Artifact ${where}, ${stretch.shared.join(" and ")} meeting ${stretch.shared.length === 1 ? "itself" : "themselves"}: ${both}`;
  });
}

/** Shown in a set's boundary warning; texture_usage lists every one. */
const STRETCHES_SHOWN = 8;

/** "1 pair", "12 pairs" of cells on a boundary left out as under a cliff, as a sentence; "" for none. */
export const underCliffNote = (underCliff: number): string => (underCliff ? ` ${underCliff} pair${underCliff === 1 ? "" : "s"} of cells under a cliff left out.` : "");

/**
 * A warning for each set the compile wrote whose boundary needs cover: its stretches of hard cut and
 * artifact (above), and how many pairs of cells were left out under a cliff (`cellFlags`, after the
 * Zones' cliffs). A stretch between two of them is in the first's warning only.
 */
export function setBoundaryWarnings(plan: { readonly written: readonly { readonly set: { readonly id: string }; readonly index: number }[] }, after: KeptTextures, cellFlags: Uint8Array): string[] {
  const { stretches: all, cliffPairs } = scanBoundaries(after, cellFlags);
  // Each stretch touching a written set goes to the first of plan.written it touches; a set keeps its stretches in scan order.
  const owned = new Map<number, BoundaryStretch[]>(plan.written.map(({ index }) => [index, []]));
  for (const stretch of all) {
    const first = plan.written.find(({ index }) => stretch.sides[0].set === index || stretch.sides[1].set === index);
    if (first) owned.get(first.index)!.push(stretch);
  }
  return plan.written.flatMap(({ set, index }) => {
    const stretches = owned.get(index)!;
    if (stretches.length === 0) return [];
    // Each set counts every pair under a cliff on its own boundary, shared ones too.
    const underCliff = cliffPairs.filter(([low, high]) => low === index || high === index).length;
    const artifacts = stretches.filter((stretch) => stretch.kind === "artifact").length;
    const shown = describeStretches(stretches.slice(0, STRETCHES_SHOWN));
    const more = stretches.length > STRETCHES_SHOWN ? `; and ${stretches.length - STRETCHES_SHOWN} more` : "";
    return [
      `Texture set ${set.id}'s boundary needs cover along ${stretchCount(stretches.length)} of block edge (${stretchCells(stretches)} cells), ${artifacts} of them an artifact where a texture meets itself and the rest a hard cut: hide each under a wall, a cliff or doodads (texture_usage lists them all and renders them).${underCliffNote(underCliff)} ${shown.join("; ")}${more}`,
    ];
  });
}
