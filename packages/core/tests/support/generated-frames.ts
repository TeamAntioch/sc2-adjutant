// Generated in-game frames for the Still Review tests (#124): each "place" is a crop of one large
// smooth-noise ground, so a frame of the wrong place is one cut from somewhere else on it.
import sharp from "sharp";

/** A seeded generator, so the ground is the same every run. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A 2400×1350 smooth-noise ground: random 30×17 colours, scaled up smoothly. */
export async function ground(seed: number): Promise<Buffer> {
  const next = random(seed);
  const [w, h] = [30, 17];
  const raw = Buffer.from(Array.from({ length: w * h * 3 }, () => Math.floor(next() * 256)));
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).resize(2400, 1350, { kernel: "cubic" }).png().toBuffer();
}

/** The frame of the place at `x, y` on the ground: a 640×360 crop, as a JPEG file. */
export async function frame(groundImage: Buffer, [x, y]: readonly [number, number], file: string, edit?: (image: sharp.Sharp) => sharp.Sharp): Promise<string> {
  const image = sharp(groundImage).extract({ left: x, top: y, width: 640, height: 360 });
  await (edit ? edit(image) : image).jpeg().toFile(file);
  return file;
}

/** Five places on the ground, apart. */
export const PLACES = [
  [0, 0],
  [800, 0],
  [1600, 0],
  [0, 900],
  [800, 900],
] as const;
