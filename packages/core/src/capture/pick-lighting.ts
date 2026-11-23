// Picking a card camera's lighting by its frame's brightness. A card sheet made with --pick-light
// films each card under several lightings (cutscene/light-test.ts lightings); no one rule lights
// every set well, but the frames that look right sit in a narrow band of mean brightness. In the
// pilot (issue #790) the frames judged right by eye measured 0.12 to 0.15 (0 black, 1 white); the
// blown-out ones measured 0.56 and more, and the black ones 0.06 and less.

import sharp from "sharp";

/** The mean brightness a well-lit card frame has. */
export const TARGET_BRIGHTNESS = 0.14;

/** A frame's mean brightness, 0 (black) to 1 (white), read as greyscale. */
export async function frameBrightness(file: string): Promise<number> {
  const { channels } = await sharp(file).greyscale().stats();
  return channels[0]!.mean / 255;
}

/** The candidate nearest TARGET_BRIGHTNESS (the first of equals); undefined when there are none. */
export function nearestBrightness<T extends { readonly brightness: number }>(candidates: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const candidate of candidates) {
    if (!best || Math.abs(candidate.brightness - TARGET_BRIGHTNESS) < Math.abs(best.brightness - TARGET_BRIGHTNESS)) best = candidate;
  }
  return best;
}
