// sc2-adjutant's Finder (src/adjutant/): where its Doodad Searches go, the tick log per Mission,
// and the options its CLI passes the public start function, which still offer the Missions, the
// Campaign Mod's doodads, its Doodad Searches as objects and look closer. The Finder run with them
// is adjutant-finder.test.ts.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MOD_DOODAD_INDEX_FILE } from "@team-antioch/sc2-adjutant/dist/catalog/mod-doodad-index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type SearchPlaces, searchFolder, slugOf, tickLogFor } from "../src/adjutant/doodad-searches.ts";
import { adjutantOptions } from "../src/adjutant/options.ts";
import { tickLogCases, tickLogFiles } from "../src/test-cases.ts";

const WORKSPACES = fileURLToPath(new URL("../../core/tests/fixtures/workspaces/", import.meta.url));

let dir: string;
let places: SearchPlaces;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "doodad-finder-look-closer-"));
  places = { missionsDir: path.join(dir, "missions"), researchDir: path.join(dir, "research"), cacheDir: path.join(dir, "cache") };
  await mkdir(path.join(places.missionsDir!, "ashen-crossing"), { recursive: true });
  await writeFile(path.join(places.missionsDir!, "ashen-crossing", "blueprint.json"), "{}");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Doodad Search folders", () => {
  it("slugs a title for its folder, beside none another has, in the Mission's output or the research archive", async () => {
    expect(slugOf("  Crushing Préss, over a conveyor! ")).toBe("crushing-press-over-a-conveyor");
    expect(searchFolder("Crates", "ashen-crossing", places)).toBe(path.join(places.missionsDir!, "ashen-crossing", "output", "doodad-search", "crates"));
    await mkdir(path.join(places.researchDir!, "doodad-search", "crates"), { recursive: true });
    expect(searchFolder("Crates", undefined, places)).toBe(path.join(places.researchDir!, "doodad-search", "crates-2"));
    expect(() => searchFolder("!!", undefined, places)).toThrow(/letter or a digit/);
    expect(() => searchFolder("Crates", "elsewhere", places)).toThrow(/No Mission elsewhere/);
  });

  it("needs the research archive for no Mission, and goes on for a Mission without it", () => {
    const noArchive: SearchPlaces = { ...places, researchDir: undefined };
    expect(() => searchFolder("Crates", undefined, noArchive)).toThrow(/choose a Mission, or set SC2_RESEARCH_DIR/);
    expect(searchFolder("Crates", "ashen-crossing", noArchive)).toBe(path.join(places.missionsDir!, "ashen-crossing", "output", "doodad-search", "crates"));
  });
});

describe("the tick log per Mission", () => {
  it("is the Mission's output, else the research archive's, where the test command reads it", async () => {
    const logFor = tickLogFor(places);
    expect(logFor("ashen-crossing")).toBe(path.join(places.missionsDir!, "ashen-crossing", "output", "doodad-finder", "ticks.jsonl"));
    expect(logFor(undefined)).toBe(path.join(places.researchDir!, "doodad-finder", "ticks.jsonl"));
    await mkdir(path.dirname(logFor("ashen-crossing")), { recursive: true });
    await writeFile(logFor("ashen-crossing"), `${JSON.stringify({ ask: "press head", tags: [], ticked: ["FoundryStamperHead"], ranker: "jev", at: "2026-11-11T00:00:00Z" })}\n`);
    const { cases } = await tickLogCases(await tickLogFiles(places.missionsDir, places.researchDir));
    expect(cases).toMatchObject([{ ask: "press head", mission: "ashen-crossing", targets: ["FoundryStamperHead"] }]);
  });

  it("for no Mission is the cache folder's without a research archive", () => {
    expect(tickLogFor({ ...places, researchDir: undefined })(undefined)).toBe(path.join(places.cacheDir, "doodad-finder", "ticks.jsonl"));
  });
});

describe("sc2-adjutant's options for the start function", () => {
  it("offers a Workspace's Missions as badges, look closer on the tray, and says the Workspace at /status", async () => {
    const root = path.join(WORKSPACES, "crossing");
    const options = await adjutantOptions(root, { researchDir: places.researchDir, copy: undefined, cacheDir: dir });
    expect(options.badges).toMatchObject({ label: "Mission", choices: ["ashen-crossing"], provided: "in this Mission" });
    expect(options.trayActions?.map(({ label }) => label)).toEqual(["Look closer"]);
    expect(options.objects?.label).toBe("Object");
    expect(options.status).toEqual({ workspace: root });
    expect(typeof options.tickLog === "function" && options.tickLog("ashen-crossing")).toBe(path.join(root, "missions", "ashen-crossing", "output", "doodad-finder", "ticks.jsonl"));
  });

  it("searches a Workspace's Campaign Mod doodads, watching its doodad index", async () => {
    const root = path.join(WORKSPACES, "bell");
    const options = await adjutantOptions(root, { researchDir: places.researchDir, copy: undefined, cacheDir: dir });
    expect(options.sources?.watch).toContain(path.join(root, "mods", "bell-story", MOD_DOODAD_INDEX_FILE));
  });

  it("with no Workspace, offers no Missions and keeps look closer for the research archive", async () => {
    const options = await adjutantOptions(undefined, { researchDir: places.researchDir, copy: undefined, cacheDir: dir });
    expect(options.badges).toBeUndefined();
    expect(options.status).toEqual({ workspace: null });
    expect(options.trayActions?.map(({ label }) => label)).toEqual(["Look closer"]);
  });
});
