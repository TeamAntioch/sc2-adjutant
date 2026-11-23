// The WhiteoutFlakes viewer's thumbnail export, judged: the recipe the Host Adapters render with,
// and which captured frames to keep. Pure functions; whiteoutflakes.ts runs the viewer.

import type { RgbaImage } from "../preview/read-png.js";

/**
 * The viewer's export recipe (`--export-recipe`; keys in its tools/basic_viewer/capture/export_ini.cpp)
 * for `angles` turntable angles, `size` pixels square.
 * The grid and the background can only be turned off here, not by command-line flags. Pre-roll
 * gives streamed textures time to arrive; without it a first frame can render magenta.
 */
export function thumbnailRecipe(angles: number, size: number): string {
  return `[Export]
HideOverlays=true
Transparent=true
PreRollMs=500
CameraMode=orbit
Angles=${angles}
OrbitFit=true
OrbitFitMargin=1.5
OrbitPitch=35
AutoCrop=true
Width=${size}
Height=${size}
NameTemplate={angle}_{clipframe:3}
`;
}

/**
 * The frames a capture wrote for each angle (named by NameTemplate as `<angle>_<clipframe>.png`),
 * last first. Each angle is its own recording, and the very first frame of a run isn't keyed
 * transparent, so the last frame is preferred; earlier ones stand in when it is garbled.
 */
export function angleFrames(fileNames: readonly string[]): Map<number, string[]> {
  const frames = new Map<number, Array<{ frame: number; name: string }>>();
  for (const name of fileNames) {
    const match = /^(\d+)_(\d+)\.png$/.exec(name);
    if (!match) continue;
    const angle = Number(match[1]);
    frames.set(angle, [...(frames.get(angle) ?? []), { frame: Number(match[2]), name }]);
  }
  return new Map(
    [...frames]
      .sort(([a], [b]) => a - b)
      .map(([angle, list]) => [angle, list.sort((a, b) => b.frame - a.frame).map(({ name }) => name)]),
  );
}

const isMagenta = (rgba: Uint8Array, i: number): boolean => rgba[i]! > 200 && rgba[i + 1]! < 80 && rgba[i + 2]! > 200;

/**
 * Share of a frame's visible pixels that are magenta. The viewer's readback sometimes garbles a
 * frame into tiles of black, white and magenta, and a material whose pipeline failed draws
 * magenta; either way the viewer exits normally. Real doodads have next to no pure magenta.
 */
export function magentaShare({ rgba }: RgbaImage): number {
  let visible = 0;
  let magenta = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3]! < 128) continue;
    visible++;
    if (isMagenta(rgba, i)) magenta++;
  }
  return visible === 0 ? 0 : magenta / visible;
}

/** The colour the viewer wrote a frame's background in. */
export type FrameBackground = "white" | "black" | "mixed" | "unkeyed";

const isTransparent = (rgba: Uint8Array, i: number): boolean => rgba[i + 3]! < 128;
const isWhite = (rgba: Uint8Array, i: number): boolean => rgba[i]! >= 252 && rgba[i + 1]! >= 252 && rgba[i + 2]! >= 252;
const isBlack = (rgba: Uint8Array, i: number): boolean => rgba[i]! <= 3 && rgba[i + 1]! <= 3 && rgba[i + 2]! <= 3;
// The viewer's own clear colour, which the first frame of a run is drawn on.
const isClearColour = (rgba: Uint8Array, i: number): boolean =>
  Math.abs(rgba[i]! - 53) <= 2 && Math.abs(rgba[i + 1]! - 59) <= 2 && Math.abs(rgba[i + 2]! - 69) <= 2;

/**
 * The viewer is asked for a transparent background but mostly writes it as solid white (or
 * transparent), sometimes solid black, and when the readback garbles, as tiles of both. Judged
 * from the border, where the background is; a dark model reaching the border also makes a white
 * frame read as "mixed". The first frame of a run is drawn on the viewer's grey clear colour
 * instead ("unkeyed"), which can't be keyed.
 */
export function frameBackground({ width, height, rgba }: RgbaImage): FrameBackground {
  let white = 0;
  let black = 0;
  let clear = 0;
  let border = 0;
  const count = (x: number, y: number): void => {
    const i = (y * width + x) * 4;
    border++;
    if (isTransparent(rgba, i) || isWhite(rgba, i)) white++;
    else if (isBlack(rgba, i)) black++;
    else if (isClearColour(rgba, i)) clear++;
  };
  for (let x = 0; x < width; x++) {
    count(x, 0);
    count(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    count(0, y);
    count(width - 1, y);
  }
  if (clear >= border * 0.5) return "unkeyed";
  if (black <= border * 0.02) return "white";
  if (white <= border * 0.02) return "black";
  return "mixed";
}

/** Enclosed white areas at least this big are background showing through gaps in the model. */
const MIN_ENCLOSED_BACKGROUND = 24;

/**
 * Makes a frame's background (see frameBackground) transparent: every background-coloured area
 * touching the border, and on white frames also enclosed white areas of at least
 * MIN_ENCLOSED_BACKGROUND pixels, where the background shows through the model. Enclosed black is
 * never cleared, because dark models shade to pure black; that's why white frames are preferred.
 */
export function keyBackground(image: RgbaImage, background: "white" | "black"): RgbaImage {
  const { width, height } = image;
  const rgba = Uint8Array.from(image.rgba);
  const matches = background === "white" ? isWhite : isBlack;
  const isBackground = (p: number): boolean => isTransparent(rgba, p * 4) || matches(rgba, p * 4);
  const seen = new Uint8Array(width * height);
  /** The background area containing `start`, marking it seen. */
  const area = (start: number): number[] => {
    const pixels: number[] = [];
    const stack = [start];
    while (stack.length > 0) {
      const p = stack.pop()!;
      if (seen[p] || !isBackground(p)) continue;
      seen[p] = 1;
      pixels.push(p);
      const [x, y] = [p % width, Math.floor(p / width)];
      if (x > 0) stack.push(p - 1);
      if (x < width - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - width);
      if (y < height - 1) stack.push(p + width);
    }
    return pixels;
  };
  const border = new Set<number>();
  for (let x = 0; x < width; x++) border.add(x).add((height - 1) * width + x);
  for (let y = 0; y < height; y++) border.add(y * width).add(y * width + width - 1);
  for (let p = 0; p < width * height; p++) {
    if (seen[p]) continue;
    const pixels = area(p);
    const enclosedHole = background === "white" && pixels.length >= MIN_ENCLOSED_BACKGROUND;
    if (enclosedHole || pixels.some((q) => border.has(q))) for (const q of pixels) rgba[q * 4 + 3] = 0;
  }
  return { width, height, rgba };
}
