// A Style Pack's exemplar captures (#26): the place and grid tours planned from the pack's Map
// Studies and places, the tours captured through a fake Editor Broker (the `studio` fixture host,
// with a broker in the test's own process), and their 1000px frames. Run on the `studio` fixture
// Workspace, whose one Exemplar Map, plaza, gets a hand-written study and mixtures here.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { captureStylePack, makeFrames, planStylePackTours } from "../../src/capture/style-pack-captures.js";
import { exemplarCaptureDir } from "../../src/study/study-exemplars.js";
import { type Host, loadHost } from "../../src/host/host.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";
import { loadWorkspace } from "../../src/plugins/workspace.js";
import { writeMapInfo } from "../../src/terrain/write-map-info.js";
import { copyOf, tempFolder } from "../mcp/harness.js";
import { closeTestBrokers, startTestBroker } from "../support/editor-broker.js";

const studioHost = fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url));
afterEach(closeTestBrokers);

const machine = { file: "/machine.json" };
const exemplarDir = (root: string) => path.join(root, "style-pack/exemplar-maps");

/** A copy of the studio Workspace with plaza's source map (only its MapInfo), its study and, when given, its places. */
async function studio({ lightsUsed = ["Day", "Night"], places }: { lightsUsed?: string[]; places?: [number, number][] } = {}) {
  const root = await copyOf("studio");
  const source = path.join(root, "exemplar-sources/Plaza.SC2Map");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "MapInfo"), writeMapInfo({ width: 64, height: 64, tilesetId: "Shakuras", fogType: "Dark", playableBounds: [4, 4, 60, 60], players: [] }));
  await mkdir(path.join(exemplarDir(root), "plaza"), { recursive: true });
  const calls = lightsUsed.map((light, i) => ({ light, inFunction: i === 0 ? "gt_IntroCutscene_Func" : "gt_MissionStart_Func" }));
  await writeFile(path.join(exemplarDir(root), "plaza/study.json"), JSON.stringify({ lighting: { lightsUsed, calls } }));
  if (places) await writeFile(path.join(exemplarDir(root), "mixtures.json"), JSON.stringify({ maps: ["plaza"], moodRules: [], moods: {}, places: places.map((center) => ({ map: "plaza", center })) }));
  return { root, source, workspace: await loadWorkspace(root) };
}

/** A real JPEG, `width` wide, for the frames a tour writes. */
const jpeg = (width: number) => sharp({ create: { width, height: Math.round((width * 9) / 16), channels: 3, background: "#456" } }).jpeg().toBuffer();

describe("planning a Style Pack's tours", () => {
  it("plans a place tour per lighting from the pack's places, in the light the map's triggers set most outside cutscenes", async () => {
    const { workspace, source } = await studio({ places: [[31.5, 31.5], [50, 12]] });
    expect(await planStylePackTours(workspace, { tours: "places", machine })).toEqual({
      tours: [{ id: "plaza", path: source, lighting: "Night", label: "places-Night", stops: [[31.5, 31.5], [50, 12]] }],
      withoutPlaces: [],
    });
  });

  it("plans a grid tour per lighting the map's study lists, or its captureLights", async () => {
    const { workspace, source } = await studio();
    expect((await planStylePackTours(workspace, { tours: "grid", machine })).tours).toEqual([
      { id: "plaza", path: source, lighting: "Day", label: "Day" },
      { id: "plaza", path: source, lighting: "Night", label: "Night" },
    ]);

    const { root } = await studio();
    const list = path.join(exemplarDir(root), "exemplars.json");
    await writeFile(list, JSON.stringify({ exemplars: [{ id: "plaza", map: "Plaza.SC2Map", provenance: "made", captureLights: ["Dusk"] }] }));
    // captureLights needs no study.
    await rm(path.join(exemplarDir(root), "plaza/study.json"));
    expect((await planStylePackTours(await loadWorkspace(root), { tours: "grid", machine })).tours.map((tour) => tour.label)).toEqual(["Dusk"]);
  });

  it("names a map with no places rather than planning it nothing", async () => {
    const { workspace } = await studio({ places: [] });
    expect(await planStylePackTours(workspace, { tours: "places", machine })).toEqual({ tours: [], withoutPlaces: ["plaza"] });
  });

  it("refuses a map with no study, or place tours with no places found, naming the tool that makes them", async () => {
    const { root, workspace } = await studio();
    await expect(planStylePackTours(workspace, { tours: "places", machine })).rejects.toThrow(/no places yet .*find_places/);
    // A mixtures file holding only the pack's moods has no places yet either.
    await writeFile(path.join(exemplarDir(root), "mixtures.json"), JSON.stringify({ moodRules: [{ name: "wild ground" }] }));
    await expect(planStylePackTours(workspace, { tours: "places", machine })).rejects.toThrow(/no places yet .*find_places/);
    await rm(path.join(exemplarDir(root), "plaza/study.json"));
    await expect(planStylePackTours(workspace, { tours: "grid", machine })).rejects.toThrow(/No Map Study for plaza .*study_exemplar/);
  });
});

describe("where a Style Pack's tours go", () => {
  it("is the pack's Exemplar Maps folder, or the research archive when SC2_RESEARCH_DIR is set", async () => {
    const { root, workspace } = await studio();
    expect(exemplarCaptureDir(workspace, {})).toBe(exemplarDir(root));
    expect(exemplarCaptureDir(workspace, { SC2_RESEARCH_DIR: "/archive" })).toBe(path.normalize("/archive/docs/research/exemplar-maps"));
  });
});

describe("capturing a Style Pack's tours", () => {
  /** A studio host on a machine with its own cacheDir, a broker for it, and its tours' frames made real JPEGs. */
  async function studioMachine() {
    const folder = await tempFolder();
    const cacheDir = path.join(folder, "cache");
    const file = path.join(folder, "machine.json");
    await writeFile(file, JSON.stringify({ hostAdapter: studioHost, cacheDir }));
    const loaded = await loadHost(await loadMachineConfig({ file, env: {} }));
    const host: Host = {
      ...loaded,
      run: (async (name: Parameters<Host["run"]>[0], request: Parameters<Host["run"]>[1]) => {
        const result = await loaded.run(name, request as never);
        if (name === "editor.captureTour") {
          const { outputDir } = request as { outputDir: string };
          for (const frame of (await readdir(outputDir)).filter((f) => f.endsWith(".jpg"))) await writeFile(path.join(outputDir, frame), await jpeg(1600));
        }
        return result;
      }) as Host["run"],
    };
    await startTestBroker(host);
    const requests = async () =>
      (await readFile(path.join(cacheDir, "host.log"), "utf8").catch(() => ""))
        .split("\n")
        .filter((line) => line.startsWith("tour "))
        .map((line) => JSON.parse(line.slice("tour ".length)) as { mapPath: string; outputDir: string });
    return { host, cacheDir, requests };
  }

  it("captures place tours into the pack's folder from copies under the cache's capture/maps, with 1000px frames, and skips them on a rerun", async () => {
    const { root, workspace } = await studio({ places: [[31.5, 31.5]] });
    const { host, cacheDir, requests } = await studioMachine();
    const captureDir = exemplarDir(root);

    const result = await captureStylePack(workspace, host, { tours: "places", machine, captureDir });
    expect(result.outcomes).toEqual([{ id: "plaza", label: "places-Night", outcome: "done", frames: 2 }]);
    const [request] = await requests();
    expect(request!.mapPath.startsWith(path.join(cacheDir, "capture", "maps") + path.sep)).toBe(true);
    expect(request!.outputDir).toBe(path.join(captureDir, "plaza/captures/places-Night"));

    const frames = path.join(captureDir, "plaza/frames/places-Night");
    expect((await readdir(frames)).sort()).toEqual(["001.jpg", "002.jpg", "stops.txt"]);
    expect(await sharp(path.join(frames, "001.jpg")).metadata()).toMatchObject({ width: 1000, format: "jpeg" });
    expect(result.frames).toMatchObject({ made: 2, removed: 0, kept: 2, unreadable: [] });
    // Git ignores them in the pack.
    expect(await readFile(path.join(captureDir, ".gitignore"), "utf8")).toMatch(/^\*\/captures\/$[\s\S]*^\*\/frames\/$/m);

    const again = await captureStylePack(workspace, host, { tours: "places", machine, captureDir });
    expect(again.outcomes).toEqual([{ id: "plaza", label: "places-Night", outcome: "already captured", frames: 0 }]);
    expect(again.frames).toMatchObject({ made: 0, kept: 2 });
    expect(await requests()).toHaveLength(1);
  });

  it("captures only the maps asked for", async () => {
    const { workspace } = await studio();
    const { host } = await studioMachine();
    await expect(captureStylePack(workspace, host, { tours: "grid", ids: ["harbour"], machine, captureDir: "/unused" })).rejects.toThrow("no Exemplar Map harbour");
  });
});

describe("making a Style Pack's 1000px frames", () => {
  /** A capture folder with `tours` of plaza, each frame a 1600px JPEG, and stops.txt. */
  async function captures(tours: Record<string, number>) {
    const dir = await tempFolder();
    for (const [tour, count] of Object.entries(tours)) {
      const folder = path.join(dir, "plaza/captures", tour);
      await mkdir(folder, { recursive: true });
      for (let n = 1; n <= count; n++) await writeFile(path.join(folder, `${String(n).padStart(3, "0")}.jpg`), await jpeg(1600));
      await writeFile(path.join(folder, "stops.txt"), "1 10 10\n");
    }
    return dir;
  }
  const mixtures = async (dir: string, frames: string[]) => {
    const file = path.join(dir, "mixtures.json");
    await writeFile(file, JSON.stringify({ places: [{ map: "plaza", center: [10, 10], frames }] }));
    return file;
  };

  it("copies every frame of a place tour, and of a grid tour only the frames a place lists, with each tour's stops", async () => {
    const dir = await captures({ "places-Day": 2, Night: 3 });
    const result = await makeFrames(dir, await mixtures(dir, ["plaza/frames/Night/002.jpg"]));
    expect(result).toEqual({ made: 3, removed: 0, kept: 3, unreadable: [] });
    expect((await readdir(path.join(dir, "plaza/frames/places-Day"))).sort()).toEqual(["001.jpg", "002.jpg", "stops.txt"]);
    expect((await readdir(path.join(dir, "plaza/frames/Night"))).sort()).toEqual(["002.jpg", "stops.txt"]);
  });

  it("works with no mixtures file, from the place tours alone", async () => {
    const dir = await captures({ "places-Day": 1, Night: 1 });
    expect(await makeFrames(dir, path.join(dir, "mixtures.json"))).toMatchObject({ made: 1, kept: 1 });
    expect(existsSync(path.join(dir, "plaza/frames/Night"))).toBe(false);
  });

  it("removes frames no place lists any more, and a tour left without frames, but keeps frames whose captures are gone", async () => {
    const dir = await captures({ Night: 2 });
    await makeFrames(dir, await mixtures(dir, ["plaza/frames/Night/001.jpg", "plaza/frames/Night/002.jpg"]));
    const lost = path.join(dir, "plaza/frames/Lost");
    await mkdir(lost, { recursive: true });
    await writeFile(path.join(lost, "001.jpg"), await jpeg(1000));

    expect(await makeFrames(dir, await mixtures(dir, []))).toEqual({ made: 0, removed: 2, kept: 1, unreadable: [] });
    expect(existsSync(path.join(dir, "plaza/frames/Night"))).toBe(false);
    expect(existsSync(path.join(lost, "001.jpg"))).toBe(true);
  });

  it("leaves the frames of maps it isn't given alone", async () => {
    const dir = await captures({ Night: 1 });
    await makeFrames(dir, await mixtures(dir, ["plaza/frames/Night/001.jpg"]));
    expect(await makeFrames(dir, await mixtures(dir, []), { maps: ["harbour"] })).toEqual({ made: 0, removed: 0, kept: 0, unreadable: [] });
    expect(existsSync(path.join(dir, "plaza/frames/Night/001.jpg"))).toBe(true);
  });

  it("remakes a frame older than its capture, and names a capture it can't read", async () => {
    const dir = await captures({ "places-Day": 2 });
    const file = await mixtures(dir, []);
    await makeFrames(dir, file);
    const frame = path.join(dir, "plaza/frames/places-Day/001.jpg");
    const past = new Date(Date.now() - 60_000);
    await utimes(frame, past, past);
    await writeFile(path.join(dir, "plaza/captures/places-Day/002.jpg"), "not a jpeg");
    await writeFile(path.join(dir, "plaza/frames/places-Day/002.jpg"), "stale");
    await utimes(path.join(dir, "plaza/frames/places-Day/002.jpg"), past, past);

    expect(await makeFrames(dir, file)).toEqual({ made: 1, removed: 0, kept: 2, unreadable: ["plaza/captures/places-Day/002.jpg"] });
  });
});
