// scaffold_style_pack and add_exemplar_map (#29): a Style Pack started in the Workspace, laid out
// as the Antioch package is, and its Exemplar Maps recorded one at a time. Through the MCP server,
// on copies of the studio fixture Workspace.
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkWorkspace, isError } from "../../src/plugins/check-workspace.js";
import { connect, copyOf, text } from "./harness.js";

const CONFIG = "sc2-adjutant.workspace.json";

async function readConfig(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(root, CONFIG), "utf8")) as Record<string, unknown>;
}

/** A copy of the studio fixture with no Style Pack: no folder, and none named. */
async function bare(): Promise<string> {
  const root = await copyOf("studio");
  await rm(path.join(root, "style-pack"), { recursive: true });
  const { stylePack: _, ...rest } = await readConfig(root);
  await writeFile(path.join(root, CONFIG), JSON.stringify(rest, null, 2));
  return root;
}

describe("scaffold_style_pack", () => {
  it("makes a Style Pack in style-pack/ that list_plugins loads with the style-pack role and the Workspace check passes", async () => {
    const root = await bare();
    const client = await connect(root);

    const reply = await client.callTool({ name: "scaffold_style_pack", arguments: {} });
    expect(reply.isError, text(reply)).toBeFalsy();

    expect((await readConfig(root)).stylePack).toBe("./style-pack");
    const plugins = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(plugins.structuredContent).toMatchObject({ plugins: [{ name: "style-studio", source: "./style-pack", roles: ["style-pack"] }] });

    const check = await checkWorkspace(root, { sc2Path: undefined });
    expect(check.problems.filter(isError)).toEqual([]);
  });

  it("lays the pack out as the Antioch package is, ignoring what captures write", async () => {
    const root = await bare();
    const client = await connect(root);
    await client.callTool({ name: "scaffold_style_pack", arguments: {} });

    const pack = path.join(root, "style-pack");
    const manifest = JSON.parse(await readFile(path.join(pack, "sc2-adjutant-plugin.json"), "utf8")) as { contributions: { exemplarMaps: string; knowledge: { id: string; file: string }[] } };
    expect(manifest.contributions.exemplarMaps).toBe("exemplar-maps/exemplars.json");
    expect(manifest.contributions.knowledge.map(({ id, file }) => [id, file])).toEqual([
      ["guide", "knowledge/GUIDE.md"],
      ["lessons", "exemplar-maps/LESSONS.md"],
      ["candidate-lessons", "exemplar-maps/candidate-lessons.md"],
    ]);
    expect(JSON.parse(await readFile(path.join(pack, "exemplar-maps/exemplars.json"), "utf8"))).toEqual({ exemplars: [] });
    expect(await readFile(path.join(pack, "exemplar-maps/LESSONS.md"), "utf8")).toMatch(/^# Design Lessons\n[\s\S]*\*\*Blueprint hook\.\*\*[\s\S]*\*\*Ratified\.\*\*/);
    expect(await readFile(path.join(pack, "exemplar-maps/candidate-lessons.md"), "utf8")).toMatch(/^# Candidate Design Lessons\n[\s\S]*\*\*Frames\.\*\*/);
    const ignored = (await readFile(path.join(pack, "exemplar-maps/.gitignore"), "utf8")).split("\n");
    expect(ignored).toEqual(expect.arrayContaining(["*/captures/", "*/frames/", "*/evidence/", "*/minimap.png"]));

    // Served as the pack's knowledge, with the Exemplar Maps list.
    const uris = (await client.listResources()).resources.map((resource) => resource.uri);
    expect(uris).toEqual(expect.arrayContaining(["guide", "lessons", "candidate-lessons", "exemplar-maps"].map((id) => `sc2-adjutant://plugins/style-studio/knowledge/${id}`)));
  });

  it("makes the pack in the folder and under the name given", async () => {
    const root = await bare();
    const client = await connect(root);

    const reply = await client.callTool({ name: "scaffold_style_pack", arguments: { folder: "packs/mine", name: "style-mine" } });
    expect(reply.isError, text(reply)).toBeFalsy();
    expect((await readConfig(root)).stylePack).toBe("./packs/mine");
    expect(existsSync(path.join(root, "packs/mine/sc2-adjutant-plugin.json"))).toBe(true);
    const plugins = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(plugins.structuredContent).toMatchObject({ plugins: [{ name: "style-mine", source: "./packs/mine" }] });
  });

  it("is refused when the folder exists and isn't empty, and writes nothing", async () => {
    const root = await bare();
    await mkdir(path.join(root, "style-pack"));
    await writeFile(path.join(root, "style-pack/notes.md"), "mine\n");
    const client = await connect(root);

    const reply = await client.callTool({ name: "scaffold_style_pack", arguments: {} });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain(`${path.join(root, "style-pack")} already exists and isn't empty`);
    expect(existsSync(path.join(root, "style-pack/sc2-adjutant-plugin.json"))).toBe(false);
    expect((await readConfig(root)).stylePack).toBeUndefined();
  });

  it("makes the pack in an empty folder that exists", async () => {
    const root = await bare();
    await mkdir(path.join(root, "style-pack"));
    const client = await connect(root);

    const reply = await client.callTool({ name: "scaffold_style_pack", arguments: {} });
    expect(reply.isError, text(reply)).toBeFalsy();
  });

  it("is refused for a folder outside the Workspace", async () => {
    const root = await bare();
    const client = await connect(root);

    const reply = await client.callTool({ name: "scaffold_style_pack", arguments: { folder: "../elsewhere" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("outside the Workspace");
    expect((await readConfig(root)).stylePack).toBeUndefined();
  });

  it("is refused for the Workspace's root as the folder", async () => {
    const root = await bare();
    const client = await connect(root);

    const reply = await client.callTool({ name: "scaffold_style_pack", arguments: { folder: "." } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("is the Workspace's root");
  });

  it("is refused, naming the current pack, when the Workspace names a Style Pack, until the mapper confirms replace", async () => {
    const root = await copyOf("studio");
    const client = await connect(root);

    const refused = await client.callTool({ name: "scaffold_style_pack", arguments: { folder: "new-pack" } });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain("already names a Style Pack, studio-style (./style-pack)");
    expect(text(refused)).toContain("replace: true");
    expect(existsSync(path.join(root, "new-pack"))).toBe(false);
    expect((await readConfig(root)).stylePack).toBe("./style-pack");

    const replaced = await client.callTool({ name: "scaffold_style_pack", arguments: { folder: "new-pack", replace: true } });
    expect(replaced.isError, text(replaced)).toBeFalsy();
    expect(replaced.structuredContent).toMatchObject({ source: "./new-pack", replaced: "./style-pack" });
    const config = await readConfig(root);
    // The rest of the config is kept.
    expect(config).toMatchObject({ stylePack: "./new-pack", exemplarMaps: "exemplar-sources", campaign: { id: "studio" } });
  });
});

describe("add_exemplar_map", () => {
  /** A Workspace with a scaffolded pack, and a source map in its exemplarMaps folder. */
  async function scaffolded() {
    const root = await bare();
    await mkdir(path.join(root, "exemplar-sources/Harbour.SC2Map"), { recursive: true });
    const client = await connect(root);
    await client.callTool({ name: "scaffold_style_pack", arguments: {} });
    return { root, client, list: path.join(root, "style-pack/exemplar-maps/exemplars.json") };
  }

  it("records the map's id, path and provenance, and the pack lists it", async () => {
    const { client, list } = await scaffolded();

    const reply = await client.callTool({ name: "add_exemplar_map", arguments: { id: "harbour", map: "Harbour.SC2Map", provenance: "edited" } });
    expect(reply.isError, text(reply)).toBeFalsy();
    expect(JSON.parse(await readFile(list, "utf8"))).toEqual({ exemplars: [{ id: "harbour", map: "Harbour.SC2Map", provenance: "edited" }] });
    const uris = (await client.listResources()).resources.map((resource) => resource.uri);
    expect(uris).toContain("sc2-adjutant://plugins/style-studio/knowledge/exemplar-maps");
  });

  it("is refused for a source map that isn't there, naming it, and writes nothing", async () => {
    const { root, client, list } = await scaffolded();

    const reply = await client.callTool({ name: "add_exemplar_map", arguments: { id: "dock", map: "Dock.SC2Map", provenance: "made" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain(`No source map ${path.join(root, "exemplar-sources/Dock.SC2Map")}`);
    expect(JSON.parse(await readFile(list, "utf8"))).toEqual({ exemplars: [] });
  });

  it("is refused for an id the pack already lists, and writes nothing", async () => {
    const { client, list } = await scaffolded();
    await client.callTool({ name: "add_exemplar_map", arguments: { id: "harbour", map: "Harbour.SC2Map", provenance: "made" } });

    const reply = await client.callTool({ name: "add_exemplar_map", arguments: { id: "harbour", map: "Harbour.SC2Map", provenance: "approved" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("already has an Exemplar Map harbour");
    expect(JSON.parse(await readFile(list, "utf8"))).toEqual({ exemplars: [{ id: "harbour", map: "Harbour.SC2Map", provenance: "made" }] });
  });

  it("keeps every map added by calls made at once, and refuses a second of the same id", async () => {
    const { root, client, list } = await scaffolded();
    for (const name of ["Dock", "Quay", "Pier"]) await mkdir(path.join(root, `exemplar-sources/${name}.SC2Map`), { recursive: true });
    const add = (id: string, map: string) => client.callTool({ name: "add_exemplar_map", arguments: { id, map, provenance: "made" } });

    const replies = await Promise.all([add("harbour", "Harbour.SC2Map"), add("dock", "Dock.SC2Map"), add("quay", "Quay.SC2Map"), add("pier", "Pier.SC2Map"), add("dock", "Dock.SC2Map")]);
    expect(replies.filter((reply) => reply.isError).map(text)).toEqual([expect.stringContaining("already has an Exemplar Map dock")]);
    const ids = (JSON.parse(await readFile(list, "utf8")) as { exemplars: { id: string }[] }).exemplars.map((exemplar) => exemplar.id);
    expect(ids.sort()).toEqual(["dock", "harbour", "pier", "quay"]);
  });

  it("takes an absolute source map without an exemplarMaps folder set", async () => {
    const { root, client, list } = await scaffolded();
    const { exemplarMaps: _, ...rest } = await readConfig(root);
    await writeFile(path.join(root, CONFIG), JSON.stringify(rest));
    const map = path.join(root, "exemplar-sources/Harbour.SC2Map");

    const reply = await client.callTool({ name: "add_exemplar_map", arguments: { id: "harbour", map, provenance: "made" } });
    expect(reply.isError, text(reply)).toBeFalsy();
    expect(JSON.parse(await readFile(list, "utf8"))).toEqual({ exemplars: [{ id: "harbour", map, provenance: "made" }] });
  });

  it("is refused when the Workspace's Style Pack isn't a folder in it", async () => {
    const root = await bare();
    const config = await readConfig(root);
    await writeFile(path.join(root, CONFIG), JSON.stringify({ ...config, stylePack: "bundled:style-antioch" }));
    const client = await connect(root);

    const reply = await client.callTool({ name: "add_exemplar_map", arguments: { id: "harbour", map: "Harbour.SC2Map", provenance: "made" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("not a folder in the Workspace");
  });
});
