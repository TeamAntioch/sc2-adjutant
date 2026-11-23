// The Antioch Style Pack's Design Lessons as code: the rules core's dresser and texture painter
// apply while this pack is the Workspace's stylePack. Each rule fills slots of the plugin API's
// `StyleRuleSlots`, and names the lesson in `exemplar-maps/LESSONS.md` it puts into code.
//
// Core loads this file built, as dist/rules.js. Core comes from "@team-antioch/sc2-adjutant/plugin-sdk", and only
// its types, so the import is erased and the pack loads without sc2-adjutant installed.

import type { PluginCode, StyleRandom, StyleRule } from "@team-antioch/sc2-adjutant/plugin-sdk";

/** One or two large pieces. */
const largeCount = (key: string, random: StyleRandom): number => 1 + (random(`${key}#large-count`) < 0.4 ? 1 : 0);

/**
 * DL-05: on ground with cliffs, dress the cliffs first, with piles, not single rocks. One or two
 * large pieces against the cliff, two to four small ones heaped in front and to the sides,
 * sometimes a ground decal under it and an accent. A natural pile heaps right against the rock,
 * pushed into the wall with "ignore placement" (the author's review); a built pile stands off the
 * wall on flat ground.
 */
const cliffPiles: StyleRule = {
  id: "cliff-piles",
  lesson: "DL-05",
  cliffPile: ({ key, kind, pile, random, choose }) => {
    const snug = kind === "natural";
    const smallCount = pile.small.length === 0 ? 0 : 2 + Math.floor(random(`${key}#small-count`) * 3);
    const chosen = [
      ...choose("large", largeCount(key, random)),
      ...choose("small", smallCount),
      ...(pile.ground.length > 0 && random(`${key}#ground`) < 0.6 ? choose("ground", 1) : []),
      ...(pile.accent.length > 0 && random(`${key}#accent`) < 0.25 ? choose("accent", 1) : []),
    ];
    return {
      snug,
      pieces: chosen.map((piece) =>
        piece.role === "large"
          ? { ...piece, along: 1.5, outward: { base: 0, reach: snug ? 0.3 : 0.6 } }
          : { ...piece, along: 3, outward: { base: snug ? 0.2 : 0.4, reach: snug ? 1.2 : 1.4 } },
      ),
    };
  },
};

/**
 * DL-11: rotate natural props freely; snap built props and decals, and built Composites, to 45°.
 * Piles and clutter vary in size on purpose (the author's piles): large pieces a little, small ones
 * a lot, and lip plants a little.
 */
const yawAndScale: StyleRule = {
  id: "yaw-and-scale",
  lesson: "DL-11",
  yaw: ({ turn, built }) => (built ? Math.round(turn / (Math.PI / 4)) * (Math.PI / 4) : turn),
  pileScale: { large: [0.8, 1.15], small: [0.45, 0.9], ground: [0.8, 1.2], accent: [0.6, 1] },
  lipScale: [0.8, 1.15],
};

/** DL-07: a landmark Composite is meant to be rare: past this many copies, or two within this many cells in different set pieces, it reads as repetition. */
const LANDMARK_COPIES = 3;
const LANDMARK_APART = 20;

const landmarkRepetition: StyleRule = {
  id: "landmark-repetition",
  lesson: "DL-07",
  compositeWarnings: (copies) => {
    const warnings: string[] = [];
    for (const [compositeId, stamped] of Map.groupBy(copies, (copy) => copy.compositeId)) {
      if (stamped[0]!.kind !== "landmark") continue;
      if (stamped.length > LANDMARK_COPIES) warnings.push(`Landmark composite ${compositeId} is used ${stamped.length} times; more than ${LANDMARK_COPIES} reads as repetition (DL-07).`);
      for (const [i, a] of stamped.entries()) {
        for (const b of stamped.slice(i + 1)) {
          if (a.setPieceId !== b.setPieceId && Math.hypot(a.x - b.x, a.y - b.y) < LANDMARK_APART) {
            warnings.push(`Landmark composite ${compositeId} stands in both ${a.setPieceId} and ${b.setPieceId}, within ${LANDMARK_APART} cells: one screen shows it twice (DL-07).`);
          }
        }
      }
    }
    return warnings;
  },
};

/** DL-13: a shore pile heaped round its waterline cell: large pieces at it, three to six small ones scattered either side, sometimes an accent. */
const shorePiles: StyleRule = {
  id: "shore-piles",
  lesson: "DL-13",
  shorePile: ({ key, pile, random, choose }) => {
    const smallCount = pile.small.length === 0 ? 0 : 3 + Math.floor(random(`${key}#small-count`) * 4);
    const chosen = [
      ...choose("large", largeCount(key, random)),
      ...choose("small", smallCount),
      ...(pile.accent.length > 0 && random(`${key}#accent`) < 0.25 ? choose("accent", 1) : []),
    ];
    return { pieces: chosen.map((piece) => ({ ...piece, reach: piece.role === "large" ? 0.6 : 1.8 })) };
  },
};

/**
 * DL-18: let natural lips grow wild, in dense clumps with bare stretches between (the author's
 * reviews, 2026-10-28): the clump noise's period and how sharply a clump thins at its ends, and how
 * quickly a clump's reach inward wanders along the edge (cells). And a broken built run's wear,
 * shrunk until it reads as noise, not as the model it is: two bits of wreckage over each cut end,
 * and one to three finer bits of debris strewn in the gap.
 */
const wildLipsAndWear: StyleRule = {
  id: "wild-lips-and-wear",
  lesson: "DL-18",
  lipClumps: { period: 3, edge: 0.12, reachPeriod: 2 },
  breakWear: { capsPerEnd: 2, capScale: [0.08, 0.16], maxDebris: 3, debrisScale: [0.12, 0.3] },
};

/**
 * DL-01: natural ground for play is never one texture. Patches of variety texture, at a feature
 * size of 14 cells: at full strength (the main level, or a band with its own variety) the main
 * texture keeps about half the ground; as light touches (a band borrowing the palette's variety)
 * the variety takes about an eighth.
 */
const neverOneTexture: StyleRule = {
  id: "never-one-texture",
  lesson: "DL-01",
  varietyPatches: { period: 14, threshold: 0.15, touchThreshold: 0.5 },
};

/**
 * DL-02: elevation reads best with a texture change at the cliff. Advice on each cliff where most
 * of the ground on both sides wears the same texture, with what to change in the palette.
 */
const cliffTextureChange: StyleRule = {
  id: "cliff-texture-change",
  lesson: "DL-02",
  cliffTextureWarnings: ({ pairs, mainLevel, lowBands, highBands }) =>
    pairs.flatMap(({ lower, upper, total, same }) => {
      const shared = same.reduce((sum, { pairs: count }) => sum + count, 0);
      if (shared * 2 <= total) return [];
      const texture = [...same].sort((a, b) => b.pairs - a.pairs)[0]!.texture;
      const side = upper <= mainLevel ? "low" : lower >= mainLevel ? "high" : "low and high";
      const bands = side === "low" ? lowBands : side === "high" ? highBands : Math.min(lowBands, highBands);
      const touchesMain = lower === mainLevel || upper === mainLevel;
      const fix =
        bands === 0
          ? `set the palette's ${side}${touchesMain ? "" : ", a band per level"}`
          : `give the two levels different textures (a ${side} band per level, or a zone's own texture)`;
      return [`Levels ${lower} and ${upper} mostly both wear ${texture}, so the cliff between them doesn't change texture (DL-02): ${fix}.`];
    }),
};

/**
 * DL-03: blend at borders, widely between textures of one tone; textures of different tones keep
 * a narrow seam. Textures the catalog has no tone for blend together.
 */
const blendByTone: StyleRule = {
  id: "blend-by-tone",
  lesson: "DL-03",
  blendGroup: ({ tone }) => tone ?? "?",
};

const plugin: PluginCode = {
  styleRules: [neverOneTexture, cliffTextureChange, blendByTone, cliffPiles, landmarkRepetition, yawAndScale, shorePiles, wildLipsAndWear],
};

export default plugin;
