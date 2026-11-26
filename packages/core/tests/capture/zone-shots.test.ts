// Shots from Zones (#124): one Shot per Zone, a rect centred on the Zone's pole of inaccessibility
// (the point inside it farthest from its outline), clipped to the Playable Area, written as the
// set's shots.json under the Mission's output/stills/<set>/. The map is synthetic: a 96×80 MapInfo
// with playable bounds 20,20 to 76,60.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { containsPoint, distanceToPolygon } from "../../src/terrain/polygon.js";
import { shotsForZones } from "../../src/capture/zone-shots.js";
import { writeMapInfo } from "../../src/terrain/write-map-info.js";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const square = (left: number, bottom: number, right: number, top: number) => [
  { x: left, y: bottom },
  { x: right, y: bottom },
  { x: right, y: top },
  { x: left, y: top },
];
// A U open to the north: its centroid (50, 38.3) lies in the notch, outside it.
const U = [
  { x: 20, y: 20 },
  { x: 80, y: 20 },
  { x: 80, y: 60 },
  { x: 60, y: 60 },
  { x: 60, y: 30 },
  { x: 40, y: 30 },
  { x: 40, y: 60 },
  { x: 20, y: 60 },
];

async function mission(zones: { id: string; name: string; polygon: { x: number; y: number }[] }[]) {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-zone-shots-"));
  folders.push(folder);
  const missionDir = path.join(folder, "missions", "yard");
  const mapPackage = path.join(missionDir, "Yard.SC2Map");
  await mkdir(mapPackage, { recursive: true });
  await writeFile(path.join(mapPackage, "MapInfo"), writeMapInfo({ width: 96, height: 80, tilesetId: "Shakuras", fogType: "Dark", playableBounds: [20, 20, 76, 60], players: [] }));
  const blueprintPath = path.join(missionDir, "blueprint.json");
  await writeFile(blueprintPath, JSON.stringify({ zones: zones.map((zone) => ({ elevation: 1, landform: "plain", role: "combat", ...zone })) }));
  return { missionDir, blueprintPath };
}

const centre = ([left, bottom, right, top]: readonly number[]) => ({ x: (left! + right!) / 2, y: (bottom! + top!) / 2 });

describe("shotsForZones", () => {
  it("centres a 30×17 Shot on a convex Zone's middle, labelled by the Zone, and writes the set's shots.json", async () => {
    const { missionDir, blueprintPath } = await mission([{ id: "yard", name: "The Yard", polygon: square(40, 30, 60, 50) }]);
    const result = await shotsForZones(blueprintPath, ["yard"], { set: "washes" });

    expect(result.shots).toEqual([{ rect: [35, 31.5, 65, 48.5], label: "yard" }]);
    expect(result.file).toBe(path.join(missionDir, "output", "stills", "washes", "shots.json"));
    const written = JSON.parse(await readFile(result.file, "utf8"));
    expect(written.shots).toEqual(result.shots);
  });

  it("puts a concave Zone's Shot on ground inside it, where the centroid would miss it", async () => {
    const { blueprintPath } = await mission([{ id: "u", name: "U", polygon: U }]);
    const { shots } = await shotsForZones(blueprintPath, ["u"], { set: "s", size: [20, 10] });
    const point = centre(shots[0]!.rect);
    expect(containsPoint(U, point)).toBe(true);
    expect(distanceToPolygon(U, point)).toBeGreaterThanOrEqual(9.5);
  });

  it("keeps a Shot inside the Playable Area, at its size when it fits, and takes a pitch", async () => {
    const { blueprintPath } = await mission([
      { id: "edge", name: "Edge", polygon: square(20, 40, 30, 50) },
      { id: "wide", name: "Wide", polygon: square(10, 10, 90, 70) },
    ]);
    const { shots } = await shotsForZones(blueprintPath, ["edge"], { set: "s", pitch: 60 });
    // Edge's pole is (25, 45): a 30-wide rect round it would start at 10, left of the Playable Area's 20.
    expect(shots).toEqual([{ rect: [20, 36.5, 50, 53.5], pitch: 60, label: "edge" }]);
    // A 100×60 rect is bigger than the Playable Area, so it is cut to it.
    const wide = await shotsForZones(blueprintPath, ["wide"], { set: "t", size: [100, 60] });
    expect(wide.shots).toEqual([{ rect: [20, 20, 76, 60], label: "wide" }]);
  });

  it("refuses to overwrite a set's shots.json, and names an unknown Zone", async () => {
    const { blueprintPath } = await mission([{ id: "yard", name: "The Yard", polygon: square(40, 30, 60, 50) }]);
    await shotsForZones(blueprintPath, ["yard"], { set: "washes" });
    await expect(shotsForZones(blueprintPath, ["yard"], { set: "washes" })).rejects.toThrow(/already has its Shots/);
    await expect(shotsForZones(blueprintPath, ["moat"], { set: "other" })).rejects.toThrow(/No Zone moat.*yard/);
  });
});
