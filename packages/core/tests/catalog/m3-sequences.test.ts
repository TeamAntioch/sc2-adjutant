import { describe, expect, it } from "vitest";

import { readM3Sequences } from "../../src/catalog/m3-sequences.js";
import { m3 } from "../fixtures/m3.js";

describe("readM3Sequences", () => {
  it("reads each animation's length, built-in move speed and looping", () => {
    const sequences = readM3Sequences(
      m3([
        { name: "Stand", start: 0, end: 6666, speed: 0, flags: 0 },
        { name: "Walk A", start: 10000, end: 12567, speed: 38, flags: 0 },
        { name: "Fidget 07", start: 20000, end: 25000, speed: 0, flags: 1 },
      ]),
    );
    expect(sequences).toEqual([
      { name: "Stand", durationMs: 6666, moveSpeed: 0, looping: true },
      { name: "Walk A", durationMs: 2567, moveSpeed: 38, looping: true },
      { name: "Fidget 07", durationMs: 5000, moveSpeed: 0, looping: false },
    ]);
  });

  it("reads SEQS version 2's shorter records, whatever padding ends the block", () => {
    const sequences = readM3Sequences(
      m3(
        [
          { name: "Stand", start: 0, end: 2667, speed: 0, flags: 0 },
          { name: "Talk", start: 3000, end: 6000, speed: 0, flags: 0 },
        ],
        { seqsVersion: 2 },
      ),
    );
    expect(sequences.map(({ name, durationMs }) => [name, durationMs])).toEqual([
      ["Stand", 2667],
      ["Talk", 3000],
    ]);
  });

  it("refuses a file that isn't an MD34", () => {
    expect(() => readM3Sequences(new Uint8Array(16))).toThrow(/MD34/);
  });
});
