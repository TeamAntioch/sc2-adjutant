import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseSetLooks } from "../../src/cutscene/set-looks.js";

const look = {
  kind: "room",
  look: "A small round room about 6 cells across with a console in the middle and one door to the south.",
  facets: ["interior", "round", "small"],
  standsInFor: ["a control room"],
  basis: "The overview and two compass shots.",
  confidence: "high",
  problems: [],
};

describe("parseSetLooks", () => {
  it("reads looks by set id, with the pictures chosen for the card", () => {
    const looks = parseSetLooks({ "control-room": { ...look, pictures: [{ file: "card/1.jpg", shows: "the whole room from the south-east" }] } });
    expect(looks["control-room"]?.pictures?.[0]?.file).toBe("card/1.jpg");
  });

  it("reads where each picture comes from: a view, a camera, a capture or a shot with what it was drawn with", () => {
    const from = [{ view: "plan" }, { camera: "Wide" }, { capture: "03-looking-north.jpg" }, { compass: 1.2, at: [1, 0], way: "east", floor: 8 }, { orbit: [135, 45], cut: 9.55, without: "Box" }, { plan: true, cut: 9.55 }, { eye: [0, 0, 2], target: [1, 0, 2], fov: 50 }];
    const pictures = from.map((source, index) => ({ file: `card/${index + 1}.jpg`, shows: "the room", from: source }));
    expect(parseSetLooks({ "control-room": { ...look, pictures } })["control-room"]?.pictures?.map((picture) => picture.from)).toEqual(from);
    expect(() => parseSetLooks({ "control-room": { ...look, pictures: [{ ...pictures[0]!, from: { view: "side" } }] } })).toThrow(/pictures/);
    expect(() => parseSetLooks({ "control-room": { ...look, pictures: [{ ...pictures[0]!, from: { capture: "../other/03.jpg" } }] } })).toThrow(/pictures/);
  });

  it("names the entry and field that is wrong", () => {
    expect(() => parseSetLooks({ "control-room": { ...look, kind: "corridor" } })).toThrow(/control-room\.kind/);
    expect(() => parseSetLooks({ "control-room": { ...look, mood: "dark" } })).toThrow(/control-room/);
    expect(() => parseSetLooks({ "control-room": { ...look, pictures: [{ file: "../plan.jpg", shows: "the plan" }] } })).toThrow(/pictures/);
  });

  it("reads the committed looks file", async () => {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data/cinematic-sets/looks.json");
    const looks = parseSetLooks(JSON.parse(await readFile(file, "utf8")));
    expect(Object.keys(looks).length).toBeGreaterThan(70);
  });

  it("has a look only for sets the committed set catalogue lists, by the id import_set takes", async () => {
    const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data/cinematic-sets");
    const looks = parseSetLooks(JSON.parse(await readFile(path.join(folder, "looks.json"), "utf8")));
    const catalogue = JSON.parse(await readFile(path.join(folder, "catalog.json"), "utf8")) as { sets: { id: string }[] };
    const listed = new Set(catalogue.sets.map((set) => set.id));
    // A set id here and not there means catalog.json is stale: regenerate it with `npm run catalog-sets`.
    expect(Object.keys(looks).filter((id) => !listed.has(id))).toEqual([]);
  });

  it("holds Blizzard's sets alone: every file in the committed catalogue is Blizzard's", async () => {
    const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../data/cinematic-sets");
    const catalogue = JSON.parse(await readFile(path.join(folder, "catalog.json"), "utf8")) as { sets: { id: string; occurrences: { origin: string }[] }[] };
    expect(catalogue.sets.filter((set) => set.occurrences.some((occurrence) => occurrence.origin !== "blizzard")).map((set) => set.id)).toEqual([]);
  });
});
