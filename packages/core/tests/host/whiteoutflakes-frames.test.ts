// The WhiteoutFlakes frame handling behind model.render: which frames to try, and how a frame's
// background is told apart and keyed out.
import { describe, expect, it } from "vitest";

import { angleFrames, frameBackground, keyBackground, magentaShare } from "../../src/host/whiteoutflakes-frames.js";

/** A width×height RGBA image from rows of pixels. */
const image = (rows: number[][][]) => ({
  width: rows[0]!.length,
  height: rows.length,
  rgba: Uint8Array.from(rows.flat(2)),
});

describe("WhiteoutFlakes frames", () => {
  it("lists each angle's frames last first, so the untransparent first frame is a last resort", () => {
    const frames = angleFrames(["1_000.png", "0_000.png", "0_002.png", "1_002.png", "0_001.png", "log.txt"]);
    expect([...frames]).toEqual([
      [0, ["0_002.png", "0_001.png", "0_000.png"]],
      [1, ["1_002.png", "1_000.png"]],
    ]);
  });

  it("measures magenta among visible pixels only", () => {
    // Magenta, magenta, grey, and a transparent magenta that doesn't count.
    const pixels = image([
      [
        [255, 0, 255, 255],
        [255, 0, 255, 255],
        [90, 90, 90, 255],
        [255, 0, 255, 0],
      ],
    ]);
    expect(magentaShare(pixels)).toBeCloseTo(2 / 3);
  });

  const W = [255, 255, 255, 255];
  const K = [0, 0, 0, 255];
  const M = [120, 80, 40, 255];

  const G = [53, 59, 69, 255];

  it("tells white, black, garbled (tiled) and unkeyed (clear colour) backgrounds apart by the border", () => {
    expect(frameBackground(image([[W, W, W], [W, M, W], [W, W, W]]))).toBe("white");
    expect(frameBackground(image([[K, K, K], [K, M, K], [K, K, K]]))).toBe("black");
    expect(frameBackground(image([[W, K, W], [K, M, K], [W, K, W]]))).toBe("mixed");
    expect(frameBackground(image([[G, G, G], [G, M, G], [G, G, G]]))).toBe("unkeyed");
  });

  it("keys out background reaching the border, but not black inside the model on a black frame", () => {
    const keyed = keyBackground(
      image([
        [K, K, K, K],
        [K, M, M, K],
        [K, M, K, M],
        [K, M, M, M],
      ]),
      "black",
    );
    const alpha = Array.from({ length: 16 }, (_, p) => keyed.rgba[p * 4 + 3]);
    expect(alpha).toEqual([0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 255, 0, 255, 255, 255]);
  });

  it("keys out white background showing through a gap in the model, if the gap is big enough", () => {
    // A 9×9 model with a 5×5 white hole (25 pixels) and a single white speck.
    const rows = Array.from({ length: 9 }, (_, y) =>
      Array.from({ length: 9 }, (_, x) => (x >= 2 && x <= 6 && y >= 2 && y <= 6) || (x === 7 && y === 7) ? W : M),
    );
    const keyed = keyBackground(image(rows), "white");
    expect(keyed.rgba[(4 * 9 + 4) * 4 + 3]).toBe(0);
    expect(keyed.rgba[(7 * 9 + 7) * 4 + 3]).toBe(255);
    expect(keyed.rgba[(1 * 9 + 1) * 4 + 3]).toBe(255);
  });
});
