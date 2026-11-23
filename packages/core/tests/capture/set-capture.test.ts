// Cinematic set captures (#112): the contact-sheet map is screenshotted through the Host Adapter's
// editor.captureTour, then core collates the frames by set. Run through the `studio` fixture.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { captureSets, collateSheet } from "../../src/capture/set-capture.js";
import { bareHost, loadHost } from "../../src/host/host.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";
import { closeTestBrokers, startTestBroker } from "../support/editor-broker.js";

const studio = fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url));
const folders: string[] = [];
afterEach(async () => {
  await closeTestBrokers();
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function sheet() {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-sets-"));
  folders.push(folder);
  const cacheDir = path.join(folder, "cache");
  const map = path.join(folder, "built", "cinematic-set-sheet.SC2Map");
  await mkdir(map, { recursive: true });
  await writeFile(path.join(map, "Triggers"), "<TriggerData/>");
  const manifest = path.join(folder, "built", "cinematic-set-sheet.manifest.json");
  const shots = [
    { stop: 1, setId: "corvette-bridge", setName: "Corvette Bridge", shot: 1, camera: "Wide Shot" },
    { stop: 2, setId: "corvette-bridge", setName: "Corvette Bridge", shot: 2, camera: "Close <Up>" },
    { stop: 3, setId: "warden-s-office", setName: "Warden's Office", shot: 1, camera: "Desk" },
  ];
  await writeFile(manifest, JSON.stringify({ map, shots }));
  const file = path.join(folder, "machine.json");
  await writeFile(file, JSON.stringify({ hostAdapter: studio, cacheDir }));
  const host = await loadHost(await loadMachineConfig({ file, env: {} }));
  await startTestBroker(host);
  const requests = async () =>
    (await readFile(path.join(cacheDir, "host.log"), "utf8")).split("\n").filter((line) => line.startsWith("tour ")).map((line) => JSON.parse(line.slice(5)));
  return { host, manifest, map, cacheDir, out: path.join(folder, "sheet"), requests };
}

describe("captureSets", () => {
  it("captures the sheet map from the machine's capture folder and collates the frames by set", async () => {
    const { host, manifest, cacheDir, out, requests } = await sheet();
    const result = await captureSets(host, manifest, out);
    expect(result).toEqual({ end: "done", frames: 2, sets: 2, collated: 2, usable: 0 });
    // Copied under the broker job's own name, and removed once the tour is done.
    const copy = (await requests())[0].mapPath as string;
    expect(path.dirname(copy)).toBe(path.join(cacheDir, "capture", "maps"));
    expect(path.basename(copy)).toMatch(/^cinematic-set-sheet sheet-\w+\.SC2Map$/);
    expect(existsSync(copy)).toBe(false);
    expect(await requests()).toEqual([
      { mapPath: copy, bank: "CsSheet", outputDir: path.join(out, "frames"), frameDigits: 4, width: 1600, quality: 85, startSeconds: 450, pressSpaceAfterSeconds: 90 },
    ]);
    expect(await readFile(path.join(out, "corvette-bridge", "02-close-up.jpg"), "utf8")).toBe("frame 2\n");
    expect(existsSync(path.join(out, "warden-s-office"))).toBe(false);
    const index = await readFile(path.join(out, "index.html"), "utf8");
    expect(index).toContain("2 sets, 2 of 3 shots captured, 0 usable");
    expect(index).toContain("Close &lt;Up&gt;");
    expect(index).toContain('<div class="gap">not captured</div>');
  });

  it("only watches a game the author already started on the sheet", async () => {
    const { host, manifest, map, cacheDir, out, requests } = await sheet();
    await captureSets(host, manifest, out, { attach: true });
    expect(await requests()).toEqual([expect.objectContaining({ mapPath: map, attach: true })]);
    expect(existsSync(path.join(cacheDir, "capture", "maps"))).toBe(false);
  });

  it("is a bulk job a host without editor.captureTour can't run", async () => {
    await expect(captureSets(bareHost(), "unused.json", "unused")).rejects.toThrow("Capturing cinematic sets needs the editor.captureTour capability");
  });

  it("pairs each card shot's frame with the card picture Blender drew, when the sheet films cards", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-cards-"));
    folders.push(folder);
    const out = path.join(folder, "set-shots", "cards");
    const views = path.join(folder, "set-views");
    await mkdir(path.join(out, "frames"), { recursive: true });
    await writeFile(path.join(out, "frames", "0001.jpg"), "x".repeat(60_000));
    await writeFile(path.join(out, "frames", "0002.jpg"), "dark");
    const shots = [
      { stop: 1, setId: "bar", setName: "Bar", shot: 0, camera: "card 2", card: "card/2.jpg" },
      { stop: 2, setId: "bar", setName: "Bar", shot: 1, camera: "card 3", card: "card/3.jpg" },
    ];
    await collateSheet(shots, out, { views });
    const pairs = await readFile(path.join(out, "pairs.html"), "utf8");
    expect(pairs).toContain('src="bar/00-card-2.jpg"');
    expect(pairs).toContain('src="../../set-views/bar/card/2.jpg"');
    expect(pairs).toContain("1 of 2 usable");
    expect(pairs).toMatch(/dark[^]*card\/3\.jpg/);
  });

  it("keeps each card's frame nearest the target brightness, when the sheet films each card under several lightings", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-picks-"));
    folders.push(folder);
    const out = path.join(folder, "set-shots", "cards");
    await mkdir(path.join(out, "frames"), { recursive: true });
    // Each frame's text is its brightness, read back by the brightness stand-in.
    const frames = ["0.71", "0.02", "0.15", "0.05", "0.12"];
    await Promise.all(frames.map((value, at) => writeFile(path.join(out, "frames", `000${at + 1}.jpg`), value.padEnd(60_000))));
    const shot = (stop: number, card: string, lighting: string) => ({ stop, setId: "bar", setName: "Bar", shot: stop - 1, camera: `${lighting}: card`, card, lighting });
    const shots = [shot(1, "card/2.jpg", "all lamps"), shot(2, "card/2.jpg", "closest shot"), shot(3, "card/2.jpg", "wide shots standing near"), shot(4, "card/3.jpg", "all lamps"), shot(5, "card/3.jpg", "closest shot")];
    const result = await collateSheet(shots, out, { views: path.join(folder, "set-views"), brightness: async (file) => Number((await readFile(file, "utf8")).trim()) });
    expect(result.picked).toBe(2);
    expect((await readFile(path.join(out, "bar", "card-2.jpg"), "utf8")).trim()).toBe("0.15");
    expect((await readFile(path.join(out, "bar", "card-3.jpg"), "utf8")).trim()).toBe("0.12");
    const record = JSON.parse(await readFile(path.join(out, "lighting.json"), "utf8"));
    expect(record.target).toBe(0.14);
    expect(record.sets.bar["card/2.jpg"]).toEqual({
      lighting: "wide shots standing near",
      brightness: 0.15,
      file: "bar/card-2.jpg",
      tried: [
        { lighting: "all lamps", brightness: 0.71 },
        { lighting: "closest shot", brightness: 0.02 },
        { lighting: "wide shots standing near", brightness: 0.15 },
      ],
    });
    const page = await readFile(path.join(out, "picks.html"), "utf8");
    expect(page).toContain('src="bar/card-2.jpg"');
    expect(page).toContain('<li class="kept">0.15 wide shots standing near</li>');
  });
});
