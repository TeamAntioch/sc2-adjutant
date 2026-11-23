// In-game capture of an edited area (#254): plan the tour of the area, build a capture copy of the
// Mission's own Map Package in the machine's cache, and run it through the Host Adapter's
// editor.captureTour, with frames in the research archive under the Mission. The package is the
// synthetic Kept-ground Mission (tests/support/kept-ground.ts); the host is the `studio` fixture.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { EMPTY_CATALOG } from "../../src/catalog/catalog-layer.js";
import { areasOf, captureKeptAreas } from "../../src/capture/edit-capture.js";
import { defaultName } from "../../src/capture/stop-tour.js";
import { readKeptCliffs } from "../../src/kept-terrain/kept-cliffs.js";
import { editKeptTerrain } from "../../src/map/edit-kept-terrain.js";
import { bareHost, loadHost } from "../../src/host/host.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";
import { closeTestBrokers, startTestBroker } from "../support/editor-broker.js";
import { type KeptGroundFixture, keptGround, removeKeptGround } from "../support/kept-ground.js";

const studio = fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url));
const YARD = { rect: { x: 16, y: 60, width: 8, height: 8 } };

let fixture: KeptGroundFixture | undefined;
const folders: string[] = [];
afterEach(async () => {
  await closeTestBrokers();
  await removeKeptGround(fixture);
  fixture = undefined;
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function hashTree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out[path.relative(dir, full)] = createHash("sha256").update(await readFile(full)).digest("hex");
  }
  return out;
}

async function machine({ adapter = true, stops = 4 } = {}) {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-edit-capture-"));
  folders.push(folder);
  const cacheDir = path.join(folder, "cache");
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path.join(cacheDir, "tour-stops.txt"), Array.from({ length: stops }, (_, i) => `${i + 1}\n`).join(""));
  const file = path.join(folder, "machine.json");
  await writeFile(file, JSON.stringify({ ...(adapter ? { hostAdapter: studio } : { hostAdapter: "none" }), cacheDir }));
  const config = await loadMachineConfig({ file, env: {} });
  const loaded = adapter ? await loadHost(config) : bareHost(config);
  // Reads the capture copy's Triggers while the tour runs: a finished capture removes the copy.
  const seen: { triggers?: string } = {};
  const host: typeof loaded = {
    ...loaded,
    run: (async (name: Parameters<typeof loaded.run>[0], request: Parameters<typeof loaded.run>[1]) => {
      const result = await loaded.run(name, request as never);
      if (name === "editor.captureTour") seen.triggers = (await readFile(path.join((request as { mapPath: string }).mapPath, "Triggers"), "utf8")).replace(/&quot;/g, '"');
      return result;
    }) as typeof loaded.run,
  };
  if (adapter) await startTestBroker(host);
  const requests = async () =>
    (await readFile(path.join(cacheDir, "host.log"), "utf8").catch(() => ""))
      .split("\n")
      .filter((line) => line.startsWith("tour "))
      .map((line) => JSON.parse(line.slice("tour ".length)) as Record<string, unknown>);
  return { host, cacheDir, researchDir: path.join(folder, "sc2-research"), requests, seen };
}

describe("captureKeptAreas", () => {
  it("tours the area from a capture copy in the machine's cache, frames to the research archive under the Mission, leaving the package byte-identical", async () => {
    fixture = await keptGround();
    const { host, cacheDir, researchDir, requests, seen } = await machine();
    const before = await hashTree(fixture.mapPackage);

    const result = await captureKeptAreas(fixture.workspace, fixture.blueprintPath, [YARD], { host, researchDir, name: "yard" });

    expect(await hashTree(fixture.mapPackage)).toEqual(before);
    const outputDir = path.join(researchDir, "missions", "quarry", "captures", "yard");
    // The copy is named for the capture and the broker's job.
    const { copy } = result;
    expect(result.outputDir).toBe(outputDir);
    expect(path.dirname(copy)).toBe(path.join(cacheDir, "capture", "maps"));
    expect(path.basename(copy)).toMatch(/^Quarry yard-\w+\.SC2Map$/);
    expect(result.end).toBe("done");
    expect(result.views.map((view) => view.label)).toEqual(["high", "player", "player-yaw-45", "player-yaw+45"]);
    expect(result.frames.map((frame) => path.basename(frame))).toEqual(["01-high.jpg", "02-player.jpg", "03-player-yaw-45.jpg", "04-player-yaw+45.jpg"]);
    expect((await readdir(outputDir)).sort()).toEqual(["01-high.jpg", "02-player.jpg", "03-player-yaw-45.jpg", "04-player-yaw+45.jpg", "stops.txt", "views.json"]);
    expect(result.summary).toBe(`Captured 4 views of the 8×8 cells at (16, 60) in ${outputDir}`);

    const [request] = await requests();
    expect(request).toMatchObject({ mapPath: copy, bank: "ExTour", outputDir, frameDigits: 2, recordKeys: ["x", "y"] });
    // The copy carried the tour, each stop with its camera, and is gone once the tour is done.
    const triggers = seen.triggers!;
    const high = result.views[0]!;
    expect(triggers).toContain(`exTourX[0] = ${high.target[0].toFixed(2)}; exTourY[0] = ${high.target[1].toFixed(2)}; exTourDistance[0] = ${high.distance.toFixed(2)}; exTourPitch[0] = 75.00;`);
    expect(triggers).toContain("exTourCount = 4;");
    expect(triggers).not.toContain("the map's own");
    expect(existsSync(copy)).toBe(false);
    expect(result.partial).toEqual([]);

    const views = JSON.parse(await readFile(path.join(outputDir, "views.json"), "utf8")) as { mission: string; mapPackage: string; areas: { label: string }[]; views: { stop: number; frame: string; area: number }[] };
    expect(views.mission).toBe("quarry");
    expect(views.mapPackage).toBe(fixture.mapPackage);
    expect(views.areas.map((area) => area.label)).toEqual(["the 8×8 cells at (16, 60)"]);
    expect(views.views.map((view) => [view.stop, view.frame, view.area])).toEqual([
      [1, "01-high.jpg", 1],
      [2, "02-player.jpg", 1],
      [3, "03-player-yaw-45.jpg", 1],
      [4, "04-player-yaw+45.jpg", 1],
    ]);
  });

  it("captures a batch of edits in one game, frames named by area", async () => {
    fixture = await keptGround();
    const { host, researchDir } = await machine({ stops: 8 });
    const result = await captureKeptAreas(fixture.workspace, fixture.blueprintPath, [YARD, { point: "Well", radius: 4 }], { host, researchDir, name: "batch" });
    expect(result.frames.map((frame) => path.basename(frame))).toEqual([
      "01-a1-high.jpg",
      "02-a1-player.jpg",
      "03-a1-player-yaw-45.jpg",
      "04-a1-player-yaw+45.jpg",
      "05-a2-high.jpg",
      "06-a2-player.jpg",
      "07-a2-player-yaw-45.jpg",
      "08-a2-player-yaw+45.jpg",
    ]);
    expect(result.summary).toContain("Captured 8 views of 2 areas");
  });

  it("says so when the game stopped before every view was captured", async () => {
    fixture = await keptGround();
    const { host, researchDir } = await machine({ stops: 2 });
    const result = await captureKeptAreas(fixture.workspace, fixture.blueprintPath, [YARD], { host, researchDir, name: "short" });
    expect(result.frames.map((frame) => path.basename(frame))).toEqual(["01-high.jpg", "02-player.jpg"]);
    expect(result.missing).toEqual(["player-yaw-45", "player-yaw+45"]);
  });

  it("refuses a host without editor.captureTour, before writing anything", async () => {
    fixture = await keptGround();
    const { host, cacheDir, researchDir } = await machine({ adapter: false });
    const before = await hashTree(fixture.mapPackage);
    await expect(captureKeptAreas(fixture.workspace, fixture.blueprintPath, [YARD], { host, researchDir, name: "yard" })).rejects.toThrow(
      "Capturing an edited area in game needs the editor.captureTour capability, and the machine's Host Adapter (none) doesn't have it",
    );
    expect(existsSync(researchDir)).toBe(false);
    expect(existsSync(path.join(cacheDir, "capture"))).toBe(false);
    expect(await hashTree(fixture.mapPackage)).toEqual(before);
  });

  it("won't capture over frames already there, and refuses a bad name or no area", async () => {
    fixture = await keptGround();
    const { host, researchDir } = await machine();
    await captureKeptAreas(fixture.workspace, fixture.blueprintPath, [YARD], { host, researchDir, name: "yard" });
    await expect(captureKeptAreas(fixture.workspace, fixture.blueprintPath, [YARD], { host, researchDir, name: "yard" })).rejects.toThrow(
      /already holds a capture: name this capture something else/,
    );
    await expect(captureKeptAreas(fixture.workspace, fixture.blueprintPath, [YARD], { host, researchDir, name: "../out" })).rejects.toThrow(/A capture name is letters/);
    await expect(captureKeptAreas(fixture.workspace, fixture.blueprintPath, [], { host, researchDir })).rejects.toThrow("A capture needs at least one area");
    // A folder from a run that captured nothing still holds its stops.txt, which the host appends to.
    const empty = path.join(researchDir, "missions", "quarry", "captures", "empty");
    await mkdir(empty, { recursive: true });
    await writeFile(path.join(empty, "stops.txt"), "1 1.5 1.5\n");
    await expect(captureKeptAreas(fixture.workspace, fixture.blueprintPath, [YARD], { host, researchDir, name: "empty" })).rejects.toThrow(/already holds a capture/);
  });

  it("frames an edit as its brush does: a ramp by its footprint, a cliff or pathing edit sharp", async () => {
    fixture = await keptGround();
    const { host, researchDir } = await machine({ stops: 12 });
    const ramp = { brush: { op: "add-ramp" as const, at: { x: 40, y: 40 }, uphill: "north" as const, low: 1, high: 2 } };
    const result = await captureKeptAreas(
      fixture.workspace,
      fixture.blueprintPath,
      [ramp, { area: YARD, brush: { op: "block-pathing" } }, { area: YARD, brush: { op: "flatten" } }],
      { host, researchDir, name: "brushes" },
    );
    const views = JSON.parse(await readFile(path.join(result.outputDir, "views.json"), "utf8")) as { areas: { label: string; reach: { width: number } }[] };
    expect(views.areas[0]!.label).toMatch(/^the polygon of \d+ corners$/);
    // The pathing edit has no falloff; the flatten has the soft one, 3 cells each side.
    expect(views.areas[2]!.reach.width - views.areas[1]!.reach.width).toBe(6);
  });

  it("frames a removed ramp round its point, though the ramp is gone by the time it captures", async () => {
    fixture = await keptGround();
    const { host, researchDir } = await machine({ stops: 8 });
    const base = /c=\(([^,]+), ([^)]+)\)/.exec((await readKeptCliffs(fixture.mapPackage, EMPTY_CATALOG)).ramps[0]!.attrs.base!)!;
    const at = { x: Math.round(Number(base[1])), y: Math.round(Number(base[2])) };
    const edit = { brush: { op: "remove-ramp" as const, at } };
    await editKeptTerrain(fixture.workspace, fixture.blueprintPath, edit, { name: "remove" });
    expect((await readKeptCliffs(fixture.mapPackage, EMPTY_CATALOG)).ramps).toEqual([]);
    const result = await captureKeptAreas(fixture.workspace, fixture.blueprintPath, [edit], { host, researchDir, name: "removed" });
    const views = JSON.parse(await readFile(path.join(result.outputDir, "views.json"), "utf8")) as { areas: { reach: { x: number; y: number; width: number; height: number } }[] };
    const { reach } = views.areas[0]!;
    expect(reach.x).toBeLessThanOrEqual(at.x - 6);
    expect(reach.x + reach.width).toBeGreaterThanOrEqual(at.x + 6);
    expect(reach.y).toBeLessThanOrEqual(at.y - 6);
    expect(reach.y + reach.height).toBeGreaterThanOrEqual(at.y + 6);
  });

  it("says which views show only part of their ground", async () => {
    fixture = await keptGround();
    const { host, researchDir } = await machine();
    const result = await captureKeptAreas(fixture.workspace, fixture.blueprintPath, [{ rect: { x: 2, y: 30, width: 124, height: 6 }, falloff: "sharp" }], { host, researchDir, name: "strip" });
    expect(result.partial).toEqual(["player-1", "player-2", "player-3"]);
    expect(result.summary).toContain("; player-1, player-2, player-3 show only part of their ground (too big for the views, or at the map's edge)");
  });
});

describe("areasOf", () => {
  it("takes an edit, a bare area or a list of either, and refuses what isn't one, naming the file", () => {
    // An edit stays whole, so its brush can shape the area; { area } alone is the area.
    expect(areasOf("a.json", { area: YARD, brush: { op: "flatten" } })).toEqual([{ area: YARD, brush: { op: "flatten" } }]);
    expect(areasOf("a.json", YARD)).toEqual([YARD]);
    expect(areasOf("a.json", [{ area: YARD }, { point: "Well", radius: 4 }])).toEqual([YARD, { point: "Well", radius: 4 }]);
    const ramp = { brush: { op: "add-ramp", at: { x: 40, y: 40 }, uphill: "north", low: 1, high: 2 } };
    expect(areasOf("ramp.json", ramp)).toEqual([ramp]);
    expect(() => areasOf("ramp.json", { brush: { op: "add-ramp" } })).toThrow(/^ramp\.json: /);
    expect(() => areasOf("batch.json", [YARD, 3])).toThrow("batch.json [1] isn't an edit or an area");
    expect(() => areasOf("batch.json", [[YARD]])).toThrow("batch.json [0] isn't an edit or an area");
    expect(() => areasOf("typo.json", { rectangle: { x: 1 } })).toThrow(/^typo\.json: /);
    expect(() => areasOf("swap.json", { brush: { op: "swap-slot", slot: 1, texture: "X" } })).toThrow('swap.json is a slot swap, which changes the whole map: give the area to look at instead, as { "area": ... }');
  });
});

describe("a capture's default name", () => {
  it("is stamped in UTC, as the renders' folders are, whatever the machine's time zone", () => {
    const zone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(defaultName(new Date("2026-01-02T03:04:05Z"))).toBe("capture-20260102-030405");
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});
