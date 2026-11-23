// This machine's sets laid over the published ones (src/sets.ts, #802, #856): the Workspace's own
// sets, and core's public ones a release doesn't carry yet, become layers with their pictures in the views folder; a
// published set keeps its published card.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { setCards } from "@team-antioch/sc2-set-finder";

import { adjutantSetCards, ownSets } from "../src/sets.ts";
import { drawnSets, PUBLISHED } from "./fixtures.ts";

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await close?.();
  close = undefined;
});

async function sets() {
  const drawn = await drawnSets();
  close = drawn.close;
  return { drawn, options: { viewsDir: drawn.viewsDir, looksFile: drawn.looksFile, catalogFile: drawn.catalogFile, workspaceRoot: drawn.workspaceRoot, published: PUBLISHED } };
}

describe("ownSets", () => {
  it("lays the private sets, by source, and the public sets not yet published over the published ones, never a published one", async () => {
    const { drawn, options } = await sets();
    const { layers } = await ownSets(options);
    expect(layers.map((layer) => [layer.source, Object.keys(layer.looks)])).toEqual([
      ["Blizzard campaign, studio", ["ship-bridge"]],
      ["studio", ["pilot-den"]],
      ["Blizzard campaign", ["night-street"]],
    ]);
    for (const layer of layers) expect(layer.pictures).toEqual({ dir: drawn.viewsDir });
  });

  it("never lays a set over a published one, even one since found in another source's files", async () => {
    const { options } = await sets();
    const published = new Map([...PUBLISHED, ["pilot-den", PUBLISHED.get("dive-bar")!]]);
    const { layers } = await ownSets({ ...options, published });
    expect(layers.flatMap((layer) => Object.keys(layer.looks))).toEqual(["ship-bridge", "night-street"]);
  });

  it("names a set's sources in one order, Blizzard's first, so sets from the same sources share a layer", async () => {
    const { drawn, options } = await sets();
    const file = path.join(drawn.viewsDir, "pilot-den", "set.json");
    await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, "utf8")), origins: ["studio", "atelier"] }));
    const { layers } = await ownSets(options);
    expect(layers.map((layer) => [layer.source, Object.keys(layer.looks)])).toContainEqual(["atelier, studio", ["pilot-den"]]);
  });

  it("names a source by the label the Workspace's Plugins give it, and by its id where none does", async () => {
    const { drawn, options } = await sets();
    const plugin = path.join(drawn.workspaceRoot, "studio-pack");
    await mkdir(plugin, { recursive: true });
    await writeFile(path.join(plugin, "sc2-adjutant-plugin.json"), JSON.stringify({ name: "studio-pack", version: "1.0.0", pluginApi: 2, roles: [], contributions: { cutsceneSources: ["studio"] }, entry: "./index.mjs" }));
    await writeFile(path.join(plugin, "index.mjs"), 'export default { cutsceneSources: [{ id: "studio", label: "Studio Pictures", description: "the studio\'s files" }] };\n');
    await writeFile(path.join(drawn.workspaceRoot, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["./studio-pack"] }));
    const { layers } = await ownSets(options);
    expect(layers.map((layer) => layer.source)).toEqual(["Blizzard campaign, Studio Pictures", "Studio Pictures", "Blizzard campaign"]);
    const named = await ownSets({ ...options, sourceNames: { studio: "Other Studio" } });
    expect(named.layers.map((layer) => layer.source)).toEqual(["Blizzard campaign, Other Studio", "Other Studio", "Blizzard campaign"]);
  });

  it("names the sources by their ids, and says why, when the Workspace doesn't load", async () => {
    const { drawn, options } = await sets();
    await writeFile(path.join(drawn.workspaceRoot, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["./missing-pack"] }));
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const { layers } = await ownSets(options);
    expect(layers.map((layer) => layer.source)).toEqual(["Blizzard campaign, studio", "studio", "Blizzard campaign"]);
    expect(said).toHaveBeenCalledWith(expect.stringMatching(/^Set Finder: sources named by their ids, since the Workspace at .* didn't load: /));
  });

  it("gives the published sets alone, and says why, on a machine with no cache folder set", async () => {
    const { drawn, options } = await sets();
    const config = path.join(drawn.dir, "machine.json");
    await writeFile(config, "{}");
    vi.stubEnv("SC2_ADJUTANT_MACHINE_CONFIG", config);
    vi.stubEnv("SC2_ADJUTANT_CACHE_DIR", "");
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const rest = { looksFile: options.looksFile, catalogFile: options.catalogFile, workspaceRoot: options.workspaceRoot, published: options.published };
    const own = await ownSets(rest);
    expect(own.layers).toEqual([]);
    expect(own.viewsDir).toBeUndefined();
    expect(said.mock.calls[0]![0]).toMatch(/published sets alone.*cacheDir/);
    const { cards } = await adjutantSetCards(rest);
    expect(cards.map((card) => card.id)).toEqual(["dive-bar"]);
  });

  it("gives a laid-over set the catalog's look, with the card facts from its drawing and the files it was found in", async () => {
    const { options } = await sets();
    const { layers } = await ownSets(options);
    const bridge = (layers[0]!.looks as Record<string, unknown>)["ship-bridge"];
    expect(bridge).toMatchObject({
      name: "Ship Bridge",
      kind: "room",
      pictures: [{ file: "card/1.jpg", shows: "the whole place", inGame: true }],
      size: [8.2, 12.6, 4.1],
      cameras: 2,
      files: ["Cutscenes/ship-bridge-0.SC2Cutscene", "Cutscenes/ship-bridge-1.SC2Cutscene"],
    });
  });
});

describe("the Workspace's own sets", () => {
  it("are none without a Workspace, or in one with no cinematic-sets folder", async () => {
    const { drawn, options } = await sets();
    for (const workspaceRoot of [undefined, drawn.dir]) {
      const { layers, looks } = await ownSets({ ...options, workspaceRoot });
      expect(layers.map((layer) => [layer.source, Object.keys(layer.looks)])).toEqual([["Blizzard campaign", ["night-street"]]]);
      expect(Object.keys(looks).sort()).toEqual(["dive-bar", "night-street"]);
    }
  });

  it("win over core's where both have a set, and say so", async () => {
    const { drawn, options } = await sets();
    const looks = JSON.parse(await readFile(drawn.looksFile, "utf8"));
    await writeFile(drawn.looksFile, JSON.stringify({ ...looks, "pilot-den": { ...looks["night-street"], look: "Core's own look of the same crew den, which the Workspace's replaces." } }));
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    const own = await ownSets(options);
    expect(own.looks["pilot-den"]!.look).toMatch(/^A cramped crew den/);
    expect(said.mock.calls[0]![0]).toMatch(/pilot-den is in core's sets and the Workspace's/);
  });
});

describe("adjutantSetCards", () => {
  it("has a card for the published sets and for each of this machine's drawn ones, its pictures served from the views folder", async () => {
    const { drawn, options } = await sets();
    const { cards } = await adjutantSetCards(options);
    expect(cards.map((card) => [card.id, card.source])).toEqual([
      ["dive-bar", "Blizzard campaign"],
      ["night-street", "Blizzard campaign"],
      ["pilot-den", "studio"],
      ["ship-bridge", "Blizzard campaign, studio"],
    ]);
    const bar = cards.find((card) => card.id === "dive-bar")!;
    expect(bar.look.look).toMatch(/^The published look/);
    expect(bar.pictures[0]!.url).toMatch(/^https:\/\/.*\/dive-bar\/card\/1\.jpg$/);
    expect(bar.pictureDir).toBeUndefined();
    const bridge = cards.find((card) => card.id === "ship-bridge")!;
    expect(bridge.pictureDir).toBe(drawn.viewsDir);
    expect(bridge.pictures[0]).toMatchObject({ url: "/pictures/ship-bridge/card/1.jpg", path: path.join(drawn.viewsDir, "ship-bridge/card/1.jpg"), inGame: { path: path.join(drawn.viewsDir, "ship-bridge/card/1-game.jpg") } });
  });

  it("are the package's cards with the layers laid over them", async () => {
    const { options } = await sets();
    const { cards, layers } = await adjutantSetCards(options);
    expect(cards.map((card) => card.id)).toEqual(setCards(PUBLISHED, { extra: layers }).map((card) => card.id));
  });
});
