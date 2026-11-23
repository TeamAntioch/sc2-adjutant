// Capture copies (#112): the platform-neutral half of an Exemplar capture. A copy of the map whose
// Triggers are replaced by the camera tour, ready for the Host Adapter's editor.captureTour.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { galaxyString, makeCaptureCopy, tourScript } from "../../src/capture/capture-copy.js";
import { mapInfoIntegrityHash, writeMapInfo } from "../../src/terrain/write-map-info.js";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

/** An Exemplar Map, 96×80 with playable bounds 8,6 to 88,74, as the Editor saved it. */
async function exemplar(): Promise<{ source: string; work: string }> {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-capture-"));
  folders.push(folder);
  const source = path.join(folder, "Antioch 1-1.SC2Map");
  await mkdir(path.join(source, "Base.SC2Data", "TriggerLibs"), { recursive: true });
  await writeFile(path.join(source, "MapInfo"), writeMapInfo({ width: 96, height: 80, tilesetId: "Shakuras", fogType: "Dark", playableBounds: [8, 6, 88, 74], players: [] }));
  await writeFile(path.join(source, "Triggers"), "<TriggerData>the map's own triggers</TriggerData>");
  await writeFile(path.join(source, "MapScript.galaxy"), "// the map's own script");
  await writeFile(path.join(source, "Base.SC2Data", "TriggerLibs", "MeleeAI.galaxy"), "// an imported library");
  await writeFile(path.join(source, "Terrain.xml"), "<terrain/>");
  return { source, work: path.join(folder, "cache", "capture", "maps") };
}

const scriptOf = async (copy: string) =>
  (await readFile(path.join(copy, "Triggers"), "utf8")).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

describe("makeCaptureCopy", () => {
  it("replaces the triggers with a grid tour over the playable bounds, and drops the map's trigger libraries", async () => {
    const { source, work } = await exemplar();
    const copy = await makeCaptureCopy(source, work);
    expect(copy).toBe(path.join(work, "Antioch 1-1.SC2Map"));
    expect(await readFile(path.join(copy, "Terrain.xml"), "utf8")).toBe("<terrain/>");
    expect(existsSync(path.join(copy, "Base.SC2Data", "TriggerLibs"))).toBe(false);
    const script = await scriptOf(copy);
    expect(script).toContain('<Element Type="CustomScript" Id="E7700001">');
    expect(script).toContain("<InitFunc>ExTour_Init</InitFunc>");
    expect(script).toContain("lo = Point(8.0, 6.0);");
    expect(script).toContain("hi = Point(88.0, 74.0);");
    expect(script).toContain('const string exTourLighting = "";');
    expect(script).toContain("TriggerAddEventTimeElapsed(t, 0.5, c_timeGame);");
    expect(script).not.toMatch(/^ *exTourCount = /m);
    // The source is untouched.
    expect(await readFile(path.join(source, "Triggers"), "utf8")).toContain("the map's own triggers");
  });

  it("writes the tour into MapScript.galaxy too, in place of the map's own script, since Test Document runs that file as it is", async () => {
    const { source, work } = await exemplar();
    const copy = await makeCaptureCopy(source, work);
    const mapScript = await readFile(path.join(copy, "MapScript.galaxy"), "utf8");
    expect(mapScript).not.toContain("the map's own script");
    expect(mapScript).toContain("// Custom Script E7700001");
    expect(mapScript).toContain("lo = Point(8.0, 6.0);");
    expect(mapScript).toMatch(/void InitMap \(\) \{\r?\n    InitLibs\(\);\r?\n    ExTour_Init\(\); \/\/ E7700001/);
  });

  it("turns on Hide Errors During Test Document, keeping MapInfo's integrity hash right", async () => {
    const { source, work } = await exemplar();
    const copy = await makeCaptureCopy(source, work);
    const info = await readFile(path.join(copy, "MapInfo"));
    const original = await readFile(path.join(source, "MapInfo"));
    expect(info.length).toBe(original.length);
    const expected = mapInfoIntegrityHash({ width: 96, height: 80, descriptionLength: "Shakuras".length, bounds: [8, 6, 88, 74], gameOptionsFlags: 0x4000 | 0x20 });
    expect(info.readBigUInt64LE(8)).toBe(expected);
    // Hiding errors twice changes nothing.
    const again = await makeCaptureCopy(copy, path.join(work, "again"));
    expect((await readFile(path.join(again, "MapInfo"))).equals(info)).toBe(true);
  });

  it("names the copy, sets the lighting, visits listed stops, and can start at map init and keep errors", async () => {
    const { source, work } = await exemplar();
    const copy = await makeCaptureCopy(source, work, {
      name: "Antioch 1-1 Night.SC2Map",
      lighting: "Night",
      stops: [[10, 12.5], [40, 41]],
      startOnInit: true,
      showErrors: true,
    });
    expect(path.basename(copy)).toBe("Antioch 1-1 Night.SC2Map");
    const script = await scriptOf(copy);
    expect(script).toContain('const string exTourLighting = "Night";');
    expect(script).toContain("exTourX[0] = 10.00; exTourY[0] = 12.50;");
    expect(script).toContain("exTourX[1] = 40.00; exTourY[1] = 41.00;");
    expect(script).toContain("exTourCount = 2;");
    expect(script).toContain("TriggerAddEventMapInit(t);");
    expect((await readFile(path.join(copy, "MapInfo"))).equals(await readFile(path.join(source, "MapInfo")))).toBe(true);
  });

  it("refuses more stops than the tour holds", async () => {
    const { source, work } = await exemplar();
    const stops = Array.from({ length: 1025 }, (_, i) => [i % 80, 10] as const);
    await expect(makeCaptureCopy(source, work, { stops })).rejects.toThrow("A capture tour visits at most 1024 stops; this one has 1025");
  });

  it("refuses an empty stop list, which would fall back to a grid tour", async () => {
    const { source, work } = await exemplar();
    await expect(makeCaptureCopy(source, work, { stops: [] })).rejects.toThrow("A place tour needs at least one stop");
  });

  it("sets each stop's camera when the tour gives one: distance and pitch, and yaw from the game camera's own", () => {
    const stops = [[57, 39.25], [57, 41]] as const;
    const cameras = [
      { distance: 52, pitch: 75, yawOffset: 0 },
      { distance: 34, pitch: 56, yawOffset: -45 },
    ];
    const script = tourScript([0, 0, 256, 256], { stops, cameras });
    expect(script).toContain("exTourX[0] = 57.00; exTourY[0] = 39.25; exTourDistance[0] = 52.00; exTourPitch[0] = 75.00; exTourYaw[0] = 0.00;");
    expect(script).toContain("exTourX[1] = 57.00; exTourY[1] = 41.00; exTourDistance[1] = 34.00; exTourPitch[1] = 56.00; exTourYaw[1] = -45.00;");
    expect(script).toContain("CameraSetValue(1, c_cameraValueDistance, exTourDistance[n - 1], 0.0, -1, 10.0);");
    expect(script).toContain("CameraSetValue(1, c_cameraValuePitch, exTourPitch[n - 1], 0.0, -1, 10.0);");
    expect(script).toContain("CameraSetValue(1, c_cameraValueYaw, CameraInfoGetValue(CameraInfoDefault(), c_cameraValueYaw) + exTourYaw[n - 1], 0.0, -1, 10.0);");
    // A tour without cameras is as it was.
    expect(tourScript([0, 0, 256, 256], { stops })).not.toContain("exTourDistance");
  });

  it("sets the copy's Camera Bounds to its Playable Area when asked, so a stop at the map's edge isn't held in by any narrower ones", async () => {
    const { source, work } = await exemplar();
    const copy = await makeCaptureCopy(source, work, { stops: [[8, 6]], playableCameraBounds: true });
    const script = await scriptOf(copy);
    expect(script).toContain("CameraSetBounds(PlayerGroupAll(), RegionRect(8.0, 6.0, 88.0, 74.0), false);");
    // Before the tour's first camera.
    expect(script.indexOf("CameraSetBounds(")).toBeLessThan(script.indexOf("CameraApplyInfo("));
    expect(await scriptOf(await makeCaptureCopy(source, work, { stops: [[8, 6]] }))).not.toContain("CameraSetBounds(");
  });

  it("refuses cameras that don't match the stops one for one", async () => {
    const { source, work } = await exemplar();
    await expect(makeCaptureCopy(source, work, { stops: [[1, 1]], cameras: [] })).rejects.toThrow("A tour gives one camera per stop: 1 stops, 0 cameras");
    await expect(makeCaptureCopy(source, work, { cameras: [{ distance: 34, pitch: 56, yawOffset: 0 }] })).rejects.toThrow("A tour gives one camera per stop: 0 stops, 1 cameras");
  });

  it("escapes the lighting id in the tour's Galaxy string", () => {
    expect(galaxyString('Korhal "Night"\\')).toBe('"Korhal \\"Night\\"\\\\"');
    expect(tourScript([0, 0, 10, 10], { lighting: 'a"b' })).toContain('const string exTourLighting = "a\\"b";');
  });
});
