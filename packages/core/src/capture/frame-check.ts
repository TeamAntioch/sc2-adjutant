// The Still Review frame check (#124): does a frame show its own Shot's place? A capture on a
// loaded machine can save a frame after the camera has moved on, so it shows another Shot's place.
// Each frame is compared with every Shot's frame in a reference capture by normalised correlation
// of a small signature; it is wrong when its best match is another Shot, clearly, and unconfirmed
// when nothing matches it well (a big repaint of the ground does that).
//
// The signature is edges, not the greyscale picture: the frame, greyscale, at 96×54, its gradient
// magnitude, less its mean, scaled to length 1. On real captures of a 256×256 cave Mission it
// separated better than the 48×27 greyscale one: right-place frames scored 0.68-0.98 against their
// own Shot and at most 0.17 against any other (greyscale: up to 0.42); wrong-place frames 0.74-0.97
// against the place they show and about 0 against their own. A same-place Shot whose ground was
// repainted scored about 0.1 against its own and nothing else, so it is unconfirmed, not wrong.

import sharp from "sharp";

const [WIDTH, HEIGHT] = [96, 54];
/** A wrong frame's match to another Shot scores at least this... */
export const WRONG_MATCH = 0.6;
/** ...and at least this much more than its own Shot. */
export const WRONG_MARGIN = 0.2;
/** A frame scoring below this against its own Shot, and not wrong, is unconfirmed. */
export const CONFIRMED = 0.4;

export type FrameStatus = "ok" | "wrong" | "unconfirmed";

export type FrameCheck = {
  readonly shot: number;
  readonly status: FrameStatus;
  /** Its score against its own Shot's reference frame; absent when the reference has none. */
  readonly own?: number;
  /** Its best match among the other Shots' reference frames. */
  readonly match?: { readonly shot: number; readonly score: number };
};

/** A frame's edge signature, as above. */
export async function frameSignature(file: string): Promise<Float64Array> {
  const pixels = await sharp(file).greyscale().resize(WIDTH, HEIGHT, { fit: "fill" }).raw().toBuffer();
  const at = (x: number, y: number) => pixels[y * WIDTH + x]!;
  const edges = new Float64Array((WIDTH - 2) * (HEIGHT - 2));
  for (let y = 1; y < HEIGHT - 1; y++) {
    for (let x = 1; x < WIDTH - 1; x++) edges[(y - 1) * (WIDTH - 2) + x - 1] = Math.hypot(at(x + 1, y) - at(x - 1, y), at(x, y + 1) - at(x, y - 1));
  }
  const mean = edges.reduce((sum, value) => sum + value, 0) / edges.length;
  let length = 0;
  for (let i = 0; i < edges.length; i++) {
    edges[i]! -= mean;
    length += edges[i]! ** 2;
  }
  length = Math.sqrt(length) || 1;
  for (let i = 0; i < edges.length; i++) edges[i]! /= length;
  return edges;
}

const correlation = (a: Float64Array, b: Float64Array): number => a.reduce((sum, value, i) => sum + value * b[i]!, 0);

/** Checks each frame against the reference's frames, by Shot number. */
export async function checkFrames(reference: ReadonlyMap<number, string>, frames: readonly { readonly shot: number; readonly file: string }[]): Promise<FrameCheck[]> {
  const signatures = new Map<number, Float64Array>();
  for (const [shot, file] of reference) signatures.set(shot, await frameSignature(file));
  const checks: FrameCheck[] = [];
  for (const { shot, file } of frames) {
    const signature = await frameSignature(file);
    const ownSignature = signatures.get(shot);
    const own = ownSignature ? correlation(signature, ownSignature) : undefined;
    let match: { shot: number; score: number } | undefined;
    for (const [other, otherSignature] of signatures) {
      if (other === shot) continue;
      const score = correlation(signature, otherSignature);
      if (!match || score > match.score) match = { shot: other, score };
    }
    const wrong = match !== undefined && match.score >= WRONG_MATCH && match.score - (own ?? 0) >= WRONG_MARGIN;
    const status: FrameStatus = wrong ? "wrong" : own !== undefined && own >= CONFIRMED ? "ok" : "unconfirmed";
    const round = (score: number) => Math.round(score * 100) / 100;
    checks.push({ shot, status, ...(own !== undefined ? { own: round(own) } : {}), ...(match ? { match: { shot: match.shot, score: round(match.score) } } : {}) });
  }
  return checks;
}
