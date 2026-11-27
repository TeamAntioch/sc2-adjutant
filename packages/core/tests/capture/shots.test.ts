// Shots (#638): rectangles of a map, each framed whole in one in-game frame. captureShots fits a
// camera to each, builds a capture copy with them as the tour's stops in the machine's cache, runs
// it through the Host Adapter's editor.captureTour (the `studio` fixture), and names each frame for
// its Shot, beside a shots.json. The map is synthetic: a 96×80 MapInfo with playable bounds 20,20 to 76,60.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { fitRect } from "../../src/capture/area-tour.js";
import { captureShots } from "../../src/capture/shots.js";
import { bareHost, loadHost } from "../../src/host/host.js";
import { captureStaleness, staleShotCaptures } from "../../src/session/evidence-coverage.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";
import { writeMapInfo } from "../../src/terrain/write-map-info.js";
import { closeTestBrokers, startTestBroker } from "../support/editor-broker.js";

const studio = fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url));
const PLAYABLE = [20, 20, 76, 60] as const;

const folders: string[] = [];
afterEach(async () => {
  await closeTestBrokers();
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function setup({ adapter = true, stops = 2, late = [] as number[] } = {}) {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-shots-"));
  folders.push(folder);
  const cacheDir = path.join(folder, "cache");
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path.join(cacheDir, "tour-stops.txt"), Array.from({ length: stops }, (_, i) => `${i + 1}${late.includes(i + 1) ? " late" : ""}\n`).join(""));
  const file = path.join(folder, "machine.json");
  await writeFile(file, JSON.stringify({ hostAdapter: adapter ? studio : "none", cacheDir }));
  const config = await loadMachineConfig({ file, env: {} });
  const loaded = adapter ? await loadHost(config) : bareHost(config);
  // Reads the capture copy's Triggers while the tour runs: a finished capture removes the copy.
  const seen: { triggers?: string; holdSeconds?: number } = {};
  const host: typeof loaded = {
    ...loaded,
    run: (async (name: Parameters<typeof loaded.run>[0], request: Parameters<typeof loaded.run>[1]) => {
      const result = await loaded.run(name, request as never);
      if (name === "editor.captureTour") {
        seen.triggers = (await readFile(path.join((request as { mapPath: string }).mapPath, "Triggers"), "utf8")).replace(/&quot;/g, '"');
        seen.holdSeconds = (request as { holdSeconds?: number }).holdSeconds;
      }
      return result;
    }) as typeof loaded.run,
  };
  if (adapter) await startTestBroker(host);
  const missionDir = path.join(folder, "workspace", "missions", "yard");
  const mapPackage = path.join(missionDir, "Yard.SC2Map");
  await mkdir(mapPackage, { recursive: true });
  await writeFile(path.join(mapPackage, "MapInfo"), writeMapInfo({ width: 96, height: 80, tilesetId: "Shakuras", fogType: "Dark", playableBounds: [...PLAYABLE], players: [] }));
  await writeFile(path.join(mapPackage, "Triggers"), "<TriggerData>the map's own triggers</TriggerData>");
  const blueprintPath = path.join(missionDir, "blueprint.json");
  await writeFile(blueprintPath, "{}");
  return { host, cacheDir, missionDir, mapPackage, blueprintPath, seen };
}

const SHOTS = [
  { rect: [40, 30, 60, 44] as const, label: "North gate" },
  { rect: [0, 0, 12, 12] as const, yaw: 30 },
];

describe("captureShots", () => {
  it("frames each Shot in one frame of a tour on a capture copy, and names the frames and shots.json under the Mission's output", async () => {
    const { host, cacheDir, missionDir, blueprintPath, mapPackage, seen } = await setup();
    const result = await captureShots({ blueprintPath }, SHOTS, { host, name: "gate" });

    const outputDir = path.join(missionDir, "output", "shots", "gate");
    expect(result.outputDir).toBe(outputDir);
    expect(result.end).toBe("done");
    expect(result.frames.map((frame) => path.basename(frame))).toEqual(["01-north-gate.jpg", "02.jpg"]);
    expect((await readdir(outputDir)).sort()).toEqual(["01-north-gate.jpg", "02.jpg", "shots.json", "stops.txt"]);
    // The copy, named for the job, carried each Shot's camera and Camera Bounds at the Playable Area, and is gone.
    expect(path.dirname(result.copy)).toBe(path.join(cacheDir, "capture", "maps"));
    expect(path.basename(result.copy)).toMatch(/^Yard shots-gate-\w+\.SC2Map$/);
    expect(existsSync(result.copy)).toBe(false);
    const gate = fitRect({ x: 40, y: 30, width: 20, height: 14 }, { pitch: 75, yawOffset: 0 }, PLAYABLE);
    expect(seen.triggers).toContain(`exTourX[0] = ${gate.target[0].toFixed(2)}; exTourY[0] = ${gate.target[1].toFixed(2)}; exTourDistance[0] = ${gate.distance.toFixed(2)}; exTourPitch[0] = 75.00; exTourYaw[0] = 0.00;`);
    expect(seen.triggers).toContain("exTourPitch[1] = 75.00; exTourYaw[1] = 30.00;");
    expect(seen.triggers).toContain("CameraSetBounds(PlayerGroupAll(), RegionRect(20.0, 20.0, 76.0, 60.0), false);");
    expect(seen.triggers).not.toContain("the map's own");

    const json = JSON.parse(await readFile(path.join(outputDir, "shots.json"), "utf8"));
    expect(json).toMatchObject({ mission: "yard", map: mapPackage, end: "done" });
    expect(json.shots).toEqual([
      { shot: 1, frame: "01-north-gate.jpg", rect: [40, 30, 60, 44], pitch: 75, yaw: 0, label: "North gate", camera: { target: gate.target, distance: gate.distance, pitch: 75, yawOffset: 0, fov: gate.fov }, whole: true },
      expect.objectContaining({ shot: 2, frame: "02.jpg", rect: [0, 0, 12, 12], pitch: 75, yaw: 30, whole: false }),
    ]);
    // At the map's corner the target is held inside the Camera Bounds, so the second shows only part of its rectangle.
    expect(result.partial).toEqual(["2"]);
    expect(result.summary).toBe(`Captured 2 Shots in ${outputDir}; 2 shows only part of its rectangle (too big for the camera, or at the map's edge)`);
  });

  it("records the Blueprint and Map Package a Mission's capture covers, and reports it stale once one changes (#748)", async () => {
    const { host, missionDir, blueprintPath, mapPackage } = await setup();
    await captureShots({ blueprintPath }, SHOTS, { host, name: "gate" });
    const manifest = path.join(missionDir, "output", "shots", "gate", "shots.json");
    const json = JSON.parse(await readFile(manifest, "utf8"));
    expect(json.covers.map((file: { path: string }) => file.path)).toEqual(["Yard.SC2Map/MapInfo", "Yard.SC2Map/Triggers", "blueprint.json"]);
    expect(await staleShotCaptures(blueprintPath)).toEqual([]);

    await writeFile(path.join(mapPackage, "Triggers"), "<TriggerData>edited</TriggerData>");
    expect(await captureStaleness(blueprintPath, manifest)).toEqual({ changed: ["Yard.SC2Map/Triggers"], missing: [], added: [] });
    expect(await staleShotCaptures(blueprintPath)).toEqual([{ name: "gate", changed: ["Yard.SC2Map/Triggers"], missing: [], added: [] }]);
  });

  it("never calls a capture without covers stale", async () => {
    const { missionDir, blueprintPath } = await setup();
    const dir = path.join(missionDir, "output", "shots", "old");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "shots.json"), JSON.stringify({ mission: "yard", shots: [] }));
    await writeFile(blueprintPath, '{"changed":true}');
    expect(await staleShotCaptures(blueprintPath)).toEqual([]);
  });

  it("puts a map that isn't a Mission's under the cache's shots folder, and names a frame it never got", async () => {
    const { host, cacheDir, mapPackage } = await setup({ stops: 1 });
    const result = await captureShots({ mapPath: mapPackage }, SHOTS, { host, name: "any" });
    const outputDir = path.join(cacheDir, "shots", "any");
    expect(result.outputDir).toBe(outputDir);
    expect(result.missing).toEqual(["2"]);
    const json = JSON.parse(await readFile(path.join(outputDir, "shots.json"), "utf8"));
    expect(json.mission).toBeUndefined();
    expect(json.shots.map((shot: { frame: string | null }) => shot.frame)).toEqual(["01-north-gate.jpg", null]);
  });

  it("asks the host to time each frame against the hold the tour's trigger gives each stop", async () => {
    const { host, blueprintPath, seen } = await setup();
    await captureShots({ blueprintPath }, SHOTS, { host, name: "hold" });
    const hold = /const fixed exTourHold = ([\d.]+);/.exec(seen.triggers ?? "")?.[1];
    expect(Number(hold)).toBe(2.5);
    expect(seen.holdSeconds).toBe(Number(hold));
  });

  it("reports a Shot the host captured late apart from missing ones: in shots.json, the result and the summary", async () => {
    const { host, missionDir, blueprintPath } = await setup({ stops: 3, late: [1] });
    const three = [...SHOTS, { rect: [30, 30, 40, 40] as const, label: "tunnel" }];
    const result = await captureShots({ blueprintPath }, three, { host, name: "late" });
    const outputDir = path.join(missionDir, "output", "shots", "late");
    expect(result.late).toEqual(["1 (North gate)"]);
    expect(result.missing).toEqual([]);
    expect(result.frames.map((frame) => path.basename(frame))).toEqual(["02.jpg", "03-tunnel.jpg"]);
    const json = JSON.parse(await readFile(path.join(outputDir, "shots.json"), "utf8"));
    expect(json.shots.map((shot: { frame: string | null; late?: boolean }) => [shot.frame, shot.late])).toEqual([
      [null, true],
      ["02.jpg", undefined],
      ["03-tunnel.jpg", undefined],
    ]);
    expect(result.summary).toBe(
      `Captured 2 Shots in ${outputDir}; Shot 1 (North gate) was captured late, after the camera moved on: retake it; 2 shows only part of its rectangle (too big for the camera, or at the map's edge)`,
    );
  });

  it("refuses a host without editor.captureTour, a bad Shot, and a folder that already holds Shots", async () => {
    const bare = await setup({ adapter: false });
    await expect(captureShots({ blueprintPath: bare.blueprintPath }, SHOTS, { host: bare.host })).rejects.toThrow("editor.captureTour");
    const { host, blueprintPath } = await setup();
    await expect(captureShots({ blueprintPath }, [], { host })).rejects.toThrow("at least one Shot");
    await expect(captureShots({ blueprintPath }, [{ rect: [20, 20, 10, 30] }], { host })).rejects.toThrow("Shot 1");
    await captureShots({ blueprintPath }, SHOTS, { host, name: "twice" });
    await expect(captureShots({ blueprintPath }, SHOTS, { host, name: "twice" })).rejects.toThrow("already holds Shots");
  });
});
