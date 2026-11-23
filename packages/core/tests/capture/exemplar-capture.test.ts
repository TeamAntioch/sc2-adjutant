// Exemplar captures (#112): core plans the camera tours and builds the capture copies; the Host
// Adapter's editor.captureTour drives the Editor and the game. Run through the `studio` fixture.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { captureExemplarTours, gridTours, placeTours, type ExemplarStudy } from "../../src/capture/exemplar-capture.js";
import { bareHost, loadHost } from "../../src/host/host.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";
import { writeMapInfo } from "../../src/terrain/write-map-info.js";
import { closeTestBrokers, startTestBroker } from "../support/editor-broker.js";

const studio = fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url));
const folders: string[] = [];
afterEach(async () => {
  await closeTestBrokers();
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const study = (lightsUsed: string[], calls: { light: string; inFunction: string }[] = []): ExemplarStudy => ({ lighting: { lightsUsed, calls } });

describe("planning Exemplar tours", () => {
  it("tours each map once per lighting its triggers use, or a chosen few, or the default", () => {
    const exemplars = [
      { id: "1-1", path: "~/maps/1-1.SC2Map" },
      { id: "2-9.5", path: "/maps/2-9.5.SC2Map", captureLights: ["Night"] },
      { id: "3-0", path: "/maps/3-0.SC2Map" },
    ];
    const studies: Record<string, ExemplarStudy> = { "1-1": study(["Dusk", "Night"]), "2-9.5": study(["A", "B", "Night"]), "3-0": study([]) };
    expect(gridTours(exemplars, (id) => studies[id]!)).toEqual([
      { id: "1-1", path: "~/maps/1-1.SC2Map", lighting: "Dusk", label: "Dusk" },
      { id: "1-1", path: "~/maps/1-1.SC2Map", lighting: "Night", label: "Night" },
      { id: "2-9.5", path: "/maps/2-9.5.SC2Map", lighting: "Night", label: "Night" },
      { id: "3-0", path: "/maps/3-0.SC2Map", lighting: "default", label: "default" },
    ]);
  });

  it("tours a map's dressed places in the lighting its triggers set most outside cutscenes, or by zone", () => {
    const exemplars = [
      { id: "1-1", path: "/maps/1-1.SC2Map" },
      { id: "3-2", path: "/maps/3-2.SC2Map", placeLight: "Day", placeZones: [{ light: "Cave", rect: [0, 0, 20, 20] as [number, number, number, number] }] },
      { id: "3-5", path: "/maps/3-5.SC2Map" },
    ];
    const studies: Record<string, ExemplarStudy> = {
      "1-1": study(["Dusk", "Night"], [
        { light: "Night", inFunction: "gt_MissionStart_Func" },
        { light: "Dusk", inFunction: "gt_IntroCutscene_Func" },
        { light: "Dusk", inFunction: "gt_CameraBooms_Func" },
      ]),
      "3-2": study([]),
      "3-5": study([]),
    };
    const mixtures = {
      maps: ["1-1", "3-2", "3-5"],
      places: [
        { map: "1-1", center: [30, 40] as [number, number] },
        { map: "1-1", center: [50.5, 60] as [number, number] },
        { map: "3-2", center: [10, 10] as [number, number] },
        { map: "3-2", center: [70, 10] as [number, number] },
        { map: "3-5", center: [5, 5] as [number, number] },
      ],
    };
    expect(placeTours(exemplars, mixtures, (id) => studies[id]!)).toEqual([
      { id: "1-1", path: "/maps/1-1.SC2Map", lighting: "Night", label: "places-Night", stops: [[30, 40], [50.5, 60]] },
      { id: "3-2", path: "/maps/3-2.SC2Map", lighting: "Cave", label: "places-Cave", stops: [[10, 10]] },
      { id: "3-2", path: "/maps/3-2.SC2Map", lighting: "Day", label: "places-Day", stops: [[70, 10]] },
      { id: "3-5", path: "/maps/3-5.SC2Map", lighting: "default", label: "places-default", stops: [[5, 5]] },
    ]);
  });
});

describe("captureExemplarTours", () => {
  async function studioMachine() {
    const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-tours-"));
    folders.push(folder);
    const cacheDir = path.join(folder, "cache");
    const source = path.join(folder, "Antioch 1-1.SC2Map");
    await mkdir(source);
    await writeFile(path.join(source, "MapInfo"), writeMapInfo({ width: 64, height: 64, tilesetId: "Shakuras", fogType: "Dark", playableBounds: [4, 4, 60, 60], players: [] }));
    const file = path.join(folder, "machine.json");
    await writeFile(file, JSON.stringify({ hostAdapter: studio, cacheDir }));
    const host = await loadHost(await loadMachineConfig({ file, env: {} }));
    await startTestBroker(host);
    const requests = async () =>
      (await readFile(path.join(cacheDir, "host.log"), "utf8").catch(() => ""))
        .split("\n")
        .filter((line) => line.startsWith("tour "))
        .map((line) => JSON.parse(line.slice("tour ".length)));
    return { host, source, cacheDir, captures: path.join(folder, "captures"), requests };
  }

  it("captures each tour from a copy in the machine's capture folder, and skips tours that have frames", async () => {
    const { host, source, cacheDir, captures, requests } = await studioMachine();
    const tours = [
      { id: "1-1", path: source, lighting: "default", label: "default" },
      { id: "1-1", path: source, lighting: "Night", label: "places-Night", stops: [[30, 40]] as [number, number][] },
    ];
    const lines: string[] = [];
    const results = await captureExemplarTours(host, tours, { capturesRoot: captures, log: (line) => lines.push(line) });
    expect(results).toEqual([
      { id: "1-1", label: "default", outcome: "done", frames: 2 },
      { id: "1-1", label: "places-Night", outcome: "done", frames: 2 },
    ]);
    expect(await requests()).toEqual([
      {
        // Each tour's copy is named for its label and the broker's job.
        mapPath: expect.stringMatching(/[\\/]capture[\\/]maps[\\/]Antioch 1-1 default-\w+\.SC2Map$/),
        bank: "ExTour",
        outputDir: path.join(captures, "1-1", "captures", "default"),
        frameDigits: 3,
        recordKeys: ["x", "y"],
        width: 1600,
        quality: 80,
        startSeconds: 300,
        pressSpaceAfterSeconds: 30,
      },
      expect.objectContaining({ mapPath: expect.stringMatching(/[\\/]capture[\\/]maps[\\/]Antioch 1-1 places-Night-\w+\.SC2Map$/), outputDir: path.join(captures, "1-1", "captures", "places-Night") }),
    ]);
    expect((await readdir(path.join(captures, "1-1", "captures", "default"))).sort()).toEqual(["001.jpg", "002.jpg", "stops.txt"]);
    expect(await readFile(path.join(captures, "1-1", "captures", "default", "stops.txt"), "utf8")).toBe("1 1.5 1.5\n2 1.5 1.5\n");
    expect(lines).toContain("1-1/default: stop 1");

    expect(await captureExemplarTours(host, tours, { capturesRoot: captures })).toEqual([
      { id: "1-1", label: "default", outcome: "already captured", frames: 0 },
      { id: "1-1", label: "places-Night", outcome: "already captured", frames: 0 },
    ]);
    expect(await requests()).toHaveLength(2);
  });

  it("reports a map it can't copy and goes on with the next", async () => {
    const { host, source, captures } = await studioMachine();
    const gone = path.resolve("/nowhere/Gone.SC2Map");
    const results = await captureExemplarTours(host, [{ id: "9-9", path: gone, lighting: "default", label: "default" }, { id: "1-1", path: source, lighting: "default", label: "default" }], { capturesRoot: captures });
    expect(results[0]).toMatchObject({ id: "9-9", outcome: "failed", frames: 0 });
    expect((results[0] as { reason: string }).reason).toContain(gone);
    expect(results[1]).toMatchObject({ id: "1-1", outcome: "done" });
  });

  it("is a bulk job a host without editor.captureTour can't run", async () => {
    await expect(captureExemplarTours(bareHost(), [], { capturesRoot: "unused" })).rejects.toThrow("Capturing Exemplar tours needs the editor.captureTour capability");
  });
});
