import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildMixtures, findPlaces, moodRuleOf, readCaptureStops } from "../../src/study/find-places.js";
import type { StudiedDoodad } from "../../src/study/measure-doodads.js";

let nextId = 1;
function doodad(type: string, x: number, y: number, extra: Partial<StudiedDoodad> = {}): StudiedDoodad {
  return {
    id: nextId++,
    type,
    position: { x, y, z: 8 },
    yaw: 0.3,
    pitch: 0,
    roll: 0,
    scale: { x: 1, y: 1, z: 1 },
    flags: [],
    kind: "doodad",
    aboveTerrain: 0,
    manipulations: [],
    ...extra,
  };
}

/** `count` doodads of `type` in a row along x, one cell apart, starting at (x, y). */
const row = (type: string, count: number, x: number, y: number) => Array.from({ length: count }, (_, i) => doodad(type, x + i, y));

describe("findPlaces", () => {
  it("makes a place of 8 doodads within 2.5 cells of each other, with no mood when given no mood rules", () => {
    const places = findPlaces("m", row("Rock", 8, 10, 10));
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({ map: "m", center: [13.5, 10], size: [8, 1], visible: 8, distinctTypes: 1 });
    expect(places[0]!.mood).toBeUndefined();
  });

  it("drops a group under 8 members", () => {
    expect(findPlaces("m", row("Rock", 7, 10, 10))).toEqual([]);
  });

  it("keeps groups more than 2.5 cells apart as separate places, and chains members within 2.5 cells into one", () => {
    const places = findPlaces("m", [...row("Rock", 8, 10, 10), ...row("Crate", 8, 10, 13), ...row("Tree", 4, 30, 10), ...row("Tree", 4, 35.5, 10), ...row("Tree", 4, 50, 10)]);
    expect(places.map((p) => [p.center, p.distinctTypes])).toEqual([
      [[13.5, 10], 1],
      [[13.5, 13], 1],
      [[34.25, 10], 1],
    ]);
  });

  it("leaves hidden helpers out, and keeps point lights without counting them toward the minimum", () => {
    const group = [...row("Rock", 7, 10, 10), doodad("LightOmniOrange", 11, 11), doodad("LightOmni", 12, 11), doodad("PathingBlocker2x2", 13, 11)];
    expect(findPlaces("m", group)).toEqual([]);
    const [place] = findPlaces("m", [...group, doodad("Crate", 17, 10)]);
    expect(place).toMatchObject({ visible: 8, distinctTypes: 2, lights: { count: 2, colours: { Orange: 1, White: 1 } } });
  });

  it("splits a cluster wider than one capture frame into 16x16-cell tiles, dropping tiles under 8", () => {
    // 30 doodads from x=1 to x=30 on one row: one cluster 30 cells wide.
    const places = findPlaces("m", row("Rock", 30, 1, 20));
    // Tiles x 0..15 (x=1..15: 15 members) and x 16..31 (x=16..30: 15 members).
    expect(places.map((p) => [p.center, p.visible])).toEqual([
      [[8, 20], 15],
      [[23, 20], 15],
    ]);
    // 20 wide: tile x 0..15 holds 15, tile 16..31 holds 5 and is dropped.
    expect(findPlaces("m", row("Rock", 20, 1, 20)).map((p) => p.visible)).toEqual([15]);
  });

  it("keeps a cluster up to 18 cells across whole", () => {
    expect(findPlaces("m", row("Rock", 19, 1, 20)).map((p) => p.visible)).toEqual([19]);
  });

  describe("with the caller's mood rules", () => {
    const lab = [...row("Console", 4, 10, 10), ...row("Rock", 4, 14, 10)];
    const wild = row("Rock", 8, 10, 30);
    const moods = [
      { name: "lab", test: (motifs: Readonly<Record<string, number>>) => (motifs.lab ?? 0) >= 0.5 },
      { name: "rocky", test: (motifs: Readonly<Record<string, number>>) => (motifs.rock ?? 0) >= 0.5 },
    ];

    it("gives each place the first mood whose rule its motifs meet", () => {
      expect(findPlaces("m", [...lab, ...wild], { moods }).map((p) => [p.center, p.motifs, p.mood])).toEqual([
        [[13.5, 10], { lab: 0.5, rock: 0.5 }, "lab"],
        [[13.5, 30], { rock: 1 }, "rocky"],
      ]);
    });

    it("leaves a place no rule matches without a mood", () => {
      expect(findPlaces("m", wild, { moods: moods.slice(0, 1) })[0]!.mood).toBeUndefined();
    });
  });

  describe("with capture stops", () => {
    const places = [...row("Rock", 8, 10, 10), ...row("Rock", 8, 10, 40)];

    it("takes the place tour's stop on the place's centre, within a cell", () => {
      const stops = { placeTours: true, stops: [{ tour: "places", n: 1, x: 13, y: 10.5 }, { tour: "places", n: 2, x: 13.5, y: 42 }] };
      expect(findPlaces("m", places, { stops }).map((p) => p.frames)).toEqual([["m/frames/places/001.jpg"], []]);
    });

    it("takes the two nearest grid-tour stops within 8 cells", () => {
      const stops = { placeTours: false, stops: [{ tour: "grid", n: 1, x: 10, y: 10 }, { tour: "grid", n: 2, x: 20, y: 10 }, { tour: "grid", n: 3, x: 13, y: 16 }, { tour: "grid", n: 12, x: 40, y: 40 }] };
      expect(findPlaces("m", places, { stops }).map((p) => p.frames)).toEqual([["m/frames/grid/001.jpg", "m/frames/grid/003.jpg"], []]);
    });

    it("lists no frames without stops", () => {
      expect(findPlaces("m", places)[0]!.frames).toBeUndefined();
    });
  });
});

describe("moodRuleOf", () => {
  // Antioch's ruin: wreck >= 15%, or masonry >= 15% with vegetation and rock >= 30%.
  const ruin = moodRuleOf({
    name: "ruin",
    when: [[{ motifs: ["wreck"], atLeast: 0.15 }], [{ motifs: ["masonry"], atLeast: 0.15 }, { motifs: ["vegetation", "rock"], atLeast: 0.3 }]],
  });

  it("passes when every condition of one alternative holds, adding up the motifs a condition names", () => {
    expect(ruin.test({ wreck: 0.2 })).toBe(true);
    expect(ruin.test({ masonry: 0.15, vegetation: 0.2, rock: 0.1 })).toBe(true);
  });

  it("fails when no alternative holds whole", () => {
    expect(ruin.test({ masonry: 0.15, vegetation: 0.2 })).toBe(false);
    expect(ruin.test({ wreck: 0.1, rock: 0.5 })).toBe(false);
  });

  it("passes every place when it has no conditions", () => {
    expect(moodRuleOf({ name: "wild ground" }).test({})).toBe(true);
  });
});

describe("readCaptureStops", () => {
  const tour = (dir: string, name: string, lines: string) => {
    mkdirSync(path.join(dir, name), { recursive: true });
    writeFileSync(path.join(dir, name, "stops.txt"), lines);
  };

  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "capture-stops-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("skips blank, short and indented-blank lines, and reads indented ones", () => {
    tour(path.join(root, "a", "captures"), "grid", "1 5 6\n\n  2 7 8\n3 9\n   \n");
    expect(readCaptureStops(root, "a")!.stops).toEqual([
      { tour: "grid", n: 1, x: 5, y: 6 },
      { tour: "grid", n: 2, x: 7, y: 8 },
    ]);
  });

  it("reads every place tour of a map's captures, else its first grid tour, else its frames", () => {
    tour(path.join(root, "a", "captures"), "places-night", "1 10 20\n");
    tour(path.join(root, "a", "captures"), "places", "1 5 6\n2 7 8\n");
    tour(path.join(root, "a", "captures"), "grid", "1 0 0\n");
    tour(path.join(root, "b", "captures"), "grid-b", "1 3 3\n");
    tour(path.join(root, "b", "captures"), "grid-a", "1 1 1\n");
    tour(path.join(root, "c", "frames"), "grid", "4 2 2\n");

    expect(readCaptureStops(root, "a")).toEqual({
      placeTours: true,
      stops: [
        { tour: "places", n: 1, x: 5, y: 6 },
        { tour: "places", n: 2, x: 7, y: 8 },
        { tour: "places-night", n: 1, x: 10, y: 20 },
      ],
    });
    expect(readCaptureStops(root, "b")).toEqual({ placeTours: false, stops: [{ tour: "grid-a", n: 1, x: 1, y: 1 }] });
    expect(readCaptureStops(root, "c")).toEqual({ placeTours: false, stops: [{ tour: "grid", n: 4, x: 2, y: 2 }] });
    expect(readCaptureStops(root, "d")).toBeUndefined();
  });
});

describe("buildMixtures", () => {
  const moods = [{ name: "lab", test: (motifs: Readonly<Record<string, number>>) => (motifs.lab ?? 0) >= 0.5 }];
  const places = [
    ...findPlaces("a", [...row("Console", 4, 10, 10), ...row("Rock", 4, 14, 10)], { moods }),
    ...findPlaces("b", row("Console", 8, 10, 10), { moods }),
    ...findPlaces("b", row("Rock", 8, 10, 30), { moods }),
  ];

  it("summarises each mood that has places, in the order given, leaving places without a mood out", () => {
    const { moods: library } = buildMixtures(places, ["empty", "lab"]);
    expect(Object.keys(library)).toEqual(["lab"]);
    expect(library.lab).toMatchObject({
      places: 2,
      maps: ["a", "b"],
      motifs: { lab: [0.5, 1, 1], rock: [0, 0.5, 0.5] },
      visible: [8, 8, 8],
      pools: { lab: { a: ["Console 4"], b: ["Console 8"] }, rock: { a: ["Rock 4"] } },
    });
    expect(Object.keys(library.lab!.motifs)).toEqual(["lab", "rock"]);
  });

  it("lists every place with its top types, and no mood for a place without one", () => {
    expect(buildMixtures(places, ["lab"]).places).toEqual([
      { map: "a", mood: "lab", center: [13.5, 10], size: [8, 1], visible: 8, motifs: { lab: 0.5, rock: 0.5 }, top: ["Console 4", "Rock 4"] },
      { map: "b", mood: "lab", center: [13.5, 10], size: [8, 1], visible: 8, motifs: { lab: 1 }, top: ["Console 8"] },
      { map: "b", center: [13.5, 30], size: [8, 1], visible: 8, motifs: { rock: 1 }, top: ["Rock 8"] },
    ]);
  });
});
