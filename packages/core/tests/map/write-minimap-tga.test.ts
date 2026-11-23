import { describe, expect, it } from "vitest";

import { writeMinimapTga } from "../../src/map/write-minimap-tga.js";

describe("writeMinimapTga", () => {
  const width = 16;
  const height = 16;
  const dominantLayers = new Uint32Array(width * height);
  const tga = writeMinimapTga({ width, height, dominantLayers, playableBounds: [2, 1, 14, 12] });
  const pixel = (x: number, y: number): string => {
    const offset = 18 + ((height - 1 - y) * width + x) * 3;
    return tga.subarray(offset, offset + 3).toString("hex");
  };

  it("uses the Editor's header and footer", () => {
    expect(tga.subarray(0, 18).toString("hex")).toBe("000002000000000000000000100010001820");
    expect(tga.length).toBe(18 + width * height * 3 + 26);
    expect(tga.subarray(-18).toString("ascii")).toBe("TRUEVISION-XFILE.\0");
  });

  it("colours the camera bounds and leaves the rest black", () => {
    expect(pixel(2, 1)).toBe("4b5950");
    expect(pixel(13, 11)).toBe("4b5950");
    expect(pixel(1, 5)).toBe("000000");
    expect(pixel(14, 5)).toBe("000000");
    expect(pixel(5, 0)).toBe("000000");
    expect(pixel(5, 12)).toBe("000000");
  });
});
