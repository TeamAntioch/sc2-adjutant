import { describe, expect, it } from "vitest";

import { readM3DisplayChannels } from "../../src/catalog/m3-display-channels.js";
import { m3, m3Layers } from "../fixtures/m3.js";

describe("readM3DisplayChannels", () => {
  it("reads the channels a model's layers show, once each, in order, as the Hyperion briefing holo's three layers show 2, 1 and 0", () => {
    expect(readM3DisplayChannels(m3Layers([{ version: 22, channels: [2, -1, 1, 0, 0] }]))).toEqual([0, 1, 2]);
  });

  it("reads a version 24 and later layer's channel after its noise floats, as the Nova main screen's version 26 layers and the SMX1 models' version 25", () => {
    expect(readM3DisplayChannels(m3Layers([{ version: 26, channels: [-1, 6] }]))).toEqual([6]);
    expect(readM3DisplayChannels(m3Layers([{ version: 25, channels: [-1, -1] }]))).toEqual([]);
    expect(readM3DisplayChannels(m3Layers([{ version: 23, channels: [0] }, { version: 24, channels: [3] }]))).toEqual([0, 3]);
  });

  it("gives a model whose layers show no channel none", () => {
    expect(readM3DisplayChannels(m3([], { bounds: { min: [0, 0, 0], max: [1, 1, 1] } }))).toEqual([]);
  });

  it("refuses a LAYR version it doesn't know the layout of", () => {
    expect(() => readM3DisplayChannels(m3Layers([{ version: 26, channels: [0] }]).map((byte, at, all) => (at === all.length - 4 ? 27 : byte)))).toThrow(/LAYR version 27/);
  });
});
