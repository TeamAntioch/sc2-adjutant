// A facing in a model's own frame turned into the engine's world-axis triple, and a turn between two
// such facings keyed finely enough that the engine, turning each world axis on its own, stays close
// to the true rotation. The checks compose the engine's R = Rx·Ry·Rz themselves.
import { describe, expect, it } from "vitest";

import { pathFacing, turnKeys, worldFacing } from "../../src/cutscene/turns.js";
import { apart, between, engine, own } from "../support/rotations.js";

describe("worldFacing", () => {
  it("gives the triple the engine turns into the facing, for any heading, pitch and roll", () => {
    for (const facing of [{ heading: 100, roll: -28 }, { heading: 37, pitch: 20, roll: 50 }, { heading: -150, pitch: -70, roll: 10 }]) {
      expect(apart(engine(worldFacing(facing)), own(facing))).toBeLessThan(1e-6);
    }
  });

  it("handles a nose straight up or down, where the engine's y is ±90 and x and z turn about one axis", () => {
    for (const facing of [{ heading: 0, pitch: 90 }, { heading: 0, pitch: -90 }, { heading: 180, pitch: 90, roll: 30 }, { heading: 90, roll: 90 }, { heading: 0, pitch: 90, roll: 25 }]) {
      const triple = worldFacing(facing);
      expect(triple.every(Number.isFinite)).toBe(true);
      expect(apart(engine(triple), own(facing))).toBeLessThan(1e-6);
    }
  });
});

describe("pathFacing", () => {
  // Down 40° along +x: the path pitches the nose (y 40), and an offset turns it before that pitch,
  // in the path's level frame, so a bank about x swings the nose off the path (TestBankOrder).
  const dive: [number, number, number] = [1, 0, -Math.tan((40 * Math.PI) / 180)];

  it("points the nose down its path, heading and pitch, with no offset", () => {
    expect(apart(engine(pathFacing(dive, [0, 0, 0])), engine([0, 40, 0]))).toBeLessThan(1e-4);
  });

  it("turns it by the offset before the path's pitch", () => {
    expect(apart(engine(pathFacing(dive, [30, 0, 0])), engine([30, 40, 0]))).toBeLessThan(1e-4);
    expect(apart(engine(pathFacing(dive, [30, 0, 0])), own({ heading: 0, pitch: -40, roll: 30 }))).toBeGreaterThan(1e-2);
  });
});

describe("turnKeys", () => {
  type Own = { heading: number; pitch?: number; roll?: number };
  const keyed = (from: Own, to: Own) => {
    const { between: keys, end } = turnKeys(worldFacing(from), worldFacing(to));
    return [{ share: 0, rotation: worldFacing(from) }, ...keys, { share: 1, rotation: end }];
  };
  /** How far, at its worst, a turn keyed at `keys` (each axis straight from key to key) is from the true turn at the same share of it, 20 to a span. */
  const worst = (keys: ReturnType<typeof keyed>, from: Own, to: Own) =>
    Math.max(
      ...keys.slice(1).flatMap((key, at) =>
        Array.from({ length: 21 }, (_, step) => {
          const before = keys[at]!;
          const pose = engine(key.rotation.map((value, axis) => before.rotation[axis]! + ((value - before.rotation[axis]!) * step) / 20));
          return apart(pose, between(own(from), own(to), before.share + ((key.share - before.share) * step) / 20));
        }),
      ),
    );

  it("keys a turn about one world axis as the engine makes it, with no keys between", () => {
    expect(turnKeys([0, 0, 10], worldFacing({ heading: 100 }))).toEqual({ between: [], end: [0, 0, 100] });
    // The short way round, past 360.
    expect(turnKeys([0, 0, 350], worldFacing({ heading: 20 })).end).toEqual([0, 0, 380]);
  });

  it("keys a banked turn, a dive to straight down, a climb over the top, turns from straight up and turns near it, staying on the true turn at its pace", () => {
    for (const [from, to] of [
      [{ heading: 0, roll: -30 }, { heading: 90, roll: -30 }],
      [{ heading: 0 }, { heading: 0, pitch: -90 }],
      [{ heading: 0, pitch: 45 }, { heading: 0, pitch: 135 }],
      [{ heading: 30, pitch: 60, roll: 20 }, { heading: 200, pitch: 80, roll: -40 }],
      [{ heading: 0, pitch: 90 }, { heading: 90, pitch: 90 }],
      [{ heading: 0, pitch: 90 }, { heading: 0, pitch: 45, roll: 20 }],
      [{ heading: 90, roll: 90 }, { heading: 120, roll: 60 }],
      [{ heading: 77, pitch: -85, roll: -100 }, { heading: -6, pitch: -44 }],
    ] as const) {
      const keys = keyed(from, to);
      expect(keys.flatMap(({ rotation }) => rotation).every(Number.isFinite)).toBe(true);
      expect(worst(keys, from, to), JSON.stringify([from, to])).toBeLessThan(0.5);
      expect(apart(engine(keys.at(-1)!.rotation), own(to))).toBeLessThan(1e-4);
    }
  });

  it("keys a short turn from straight up with a few keys, not dozens", () => {
    expect(keyed({ heading: 0, pitch: 90 }, { heading: 0, pitch: 45, roll: 20 }).length).toBeLessThan(10);
    expect(keyed({ heading: 90, roll: 90 }, { heading: 120, roll: 60 }).length).toBeLessThan(10);
  });
});
