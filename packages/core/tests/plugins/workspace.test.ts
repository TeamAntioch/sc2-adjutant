import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import { loadMachineConfig } from "../../src/host/machine-config.js";
import { exemplarMapSources, loadWorkspace, stylePackFiles } from "../../src/plugins/workspace.js";

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/workspaces/${name}/`, import.meta.url));

describe("loadWorkspace", () => {
  it("loads only the Plugins its config names, in order", async () => {
    const workspace = await loadWorkspace(fixture("basic"));
    expect(workspace.campaign).toEqual({ id: "fixtures", name: "Fixture Campaign" });
    expect(workspace.registry.plugins.map(({ name, version, source, roles }) => ({ name, version, source, roles }))).toEqual([
      { name: "hazard", version: "1.0.0", source: "bundled:hazard", roles: [] },
      { name: "beacon", version: "0.1.0", source: "./plugins/beacon", roles: [] },
    ]);
    expect(workspace.registry.contributions("mechanics").map((mechanic) => mechanic.type)).toEqual(["hazard", "beacon"]);
    expect(workspace.registry.mechanic("lantern")).toBeUndefined();
  });

  it("names the setting and the file when the config is invalid", async () => {
    const root = await workspace({ campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: "bundled:hazard" });
    await expect(loadWorkspace(root)).rejects.toThrow(`Invalid Workspace config ${path.join(root, "sc2-adjutant.workspace.json")}: plugins: Invalid input: expected array, received string`);
  });

  it("refuses a Plugin built for another plugin API version, naming both", async () => {
    const root = await workspace({ campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["./old"] }, { old: { ...manifest, pluginApi: 1, contributions: { prompts: ["tour"] } } });
    await expect(loadWorkspace(root)).rejects.toThrow(/^Plugin old \(\.\/old .*\) is built for plugin API version 1, but this sc2-adjutant provides version 2$/);
  });

  it("refuses a Plugin whose code doesn't contribute the Mechanics its manifest declares", async () => {
    const root = await workspace({ campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["./old"] }, { old: { ...manifest, contributions: { mechanics: ["tide"] } } });
    await expect(loadWorkspace(root)).rejects.toThrow("Plugin old (./old) declares the Mechanics [tide] but its code contributes []");
  });

  it("refuses a Plugin named for a role its manifest doesn't declare", async () => {
    const root = await workspace({ campaign: { id: "fixtures", name: "Fixture Campaign" }, campaignPack: "./old" }, { old: manifest });
    await expect(loadWorkspace(root)).rejects.toThrow("Plugin old (./old) is named as the campaign-pack but its manifest doesn't declare that role");
  });

  it("lets one Plugin fill several roles", async () => {
    const root = await workspace(
      { campaign: { id: "fixtures", name: "Fixture Campaign" }, campaignPack: "./pack", stylePack: "./pack" },
      { pack: { ...manifest, name: "pack", roles: ["campaign-pack", "style-pack"] } },
    );
    const { registry } = await loadWorkspace(root);
    expect(registry.plugins.map(({ name, roles }) => ({ name, roles }))).toEqual([{ name: "pack", roles: ["campaign-pack", "style-pack"] }]);
  });

  it("loads a local Plugin only from a ./ path, as the README says", async () => {
    const root = await workspace({ campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["old"] }, { old: manifest });
    await expect(loadWorkspace(root)).rejects.toThrow("for a folder in the Workspace, write ./old");
  });

  it("finds only Plugins core really bundles", async () => {
    const root = await workspace({ campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["bundled:constructor"] });
    await expect(loadWorkspace(root)).rejects.toThrow("No bundled Plugin bundled:constructor; core bundles bundled:hazard");
  });

  it("indexes a Plugin's cutscene source kinds, with their mark-name hooks", async () => {
    const root = await workspace(
      { campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["./old"] },
      { old: { ...manifest, contributions: { cutsceneSources: ["studio"] }, entry: "./index.mjs" } },
      { "old/index.mjs": 'export default { cutsceneSources: [{ id: "studio", label: "Studio", description: "the studio\'s files", markName: (name) => name.replace(/^Cast: /, "") }] };' },
    );
    const { registry } = await loadWorkspace(root);
    expect(registry.plugins[0]!.contributions).toMatchObject({ mechanics: [], cutsceneSources: ["studio"] });
    const [studio] = registry.contributions("cutsceneSources");
    expect(studio).toMatchObject({ id: "studio", label: "Studio", description: "the studio's files" });
    expect(studio!.markName!("Cast: Raynor")).toBe("Raynor");
  });

  it("refuses cutscene source kinds the manifest and code disagree on, or that core already has", async () => {
    const mismatch = await workspace(
      { campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["./old"] },
      { old: { ...manifest, contributions: { cutsceneSources: ["studio"] }, entry: "./index.mjs" } },
      { "old/index.mjs": "export default {};" },
    );
    await expect(loadWorkspace(mismatch)).rejects.toThrow("Plugin old (./old) declares the cutscene sources [studio] but its code contributes []");
    const core = await workspace(
      { campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["./old"] },
      { old: { ...manifest, contributions: { cutsceneSources: ["blizzard"] }, entry: "./index.mjs" } },
      { "old/index.mjs": 'export default { cutsceneSources: [{ id: "blizzard", label: "B", description: "b" }] };' },
    );
    await expect(loadWorkspace(core)).rejects.toThrow("Plugin old (./old) contributes the cutscene source blizzard, which core already provides");
  });

  it("refuses a Plugin whose code isn't shaped like a Plugin, naming it", async () => {
    const root = await workspace(
      { campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["./old"] },
      { old: { ...manifest, contributions: { mechanics: ["tide"] }, entry: "./index.mjs" } },
      { "old/index.mjs": 'export default { mechanics: [{ type: "tide", paramsSchema: {} }] };' },
    );
    await expect(loadWorkspace(root)).rejects.toThrow(
      "Plugin old (./old): its code's default export isn't a Plugin: mechanics.0.paramsSchema: Expected a zod schema; mechanics.0.buildTriggers: Expected a function",
    );
  });

  describe("a Mechanic's trigger primitives", () => {
    const withPrimitives = (primitives: string, more = "") =>
      workspace(
        { campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["./old"] },
        { old: { ...manifest, contributions: { mechanics: ["tide", ...(more ? ["ebb"] : [])] }, entry: "./index.mjs" } },
        {
          "old/index.mjs": `const schema = { safeParse: (value) => ({ success: true, data: value }) };
const galaxy = () => "";
export default { mechanics: [{ type: "tide", paramsSchema: schema, buildTriggers: () => [], primitives: ${primitives} }${more}] };`,
        },
      );

    it("checks their shape when the Plugin loads", async () => {
      await expect(loadWorkspace(await withPrimitives('{ functions: { rise: { library: "Tide", id: "T1", kind: "action", galaxy } } }'))).rejects.toThrow(
        "mechanics.0.primitives.functions.rise.params",
      );
    });

    it("accepts one defined as core defines it, as a Plugin built before core had it does", async () => {
      const sameAsCore = '{ functions: { init: { library: "Ntve", id: "00000120", kind: "event", params: {}, galaxy } } }';
      await expect(loadWorkspace(await withPrimitives(sameAsCore))).resolves.toBeDefined();
    });

    it("takes a function with no galaxy of its own that the game's library data defines, and refuses one the data doesn't", async () => {
      // Unit Height (Ntve/B9B1D01B), which core doesn't wrap.
      const fromData = '{ functions: { height: { library: "Ntve", id: "B9B1D01B", kind: "function", params: { unit: { id: "AB32278E" } } } } }';
      await expect(loadWorkspace(await withPrimitives(fromData))).resolves.toBeDefined();
      const unknown = '{ functions: { rise: { library: "Tide", id: "T1", kind: "action", params: {} } } }';
      await expect(loadWorkspace(await withPrimitives(unknown))).rejects.toThrow(
        "Plugin old (./old)'s Mechanic tide contributes the trigger function Tide/T1 with no galaxy of its own, and the game's library data doesn't define it: give it a galaxy",
      );
    });

    it("refuses a function with no galaxy of its own whose parameter ids aren't the game's library data's", async () => {
      // Unit Height (Ntve/B9B1D01B) takes one parameter, AB32278E.
      const height = (params: string) => `{ functions: { height: { library: "Ntve", id: "B9B1D01B", kind: "function", params: { ${params} } } } }`;
      const refusal = (ids: string) =>
        `Plugin old (./old)'s Mechanic tide contributes the trigger function Ntve/B9B1D01B with no galaxy of its own, whose parameter ids (${ids}) aren't those the game's library data gives it (AB32278E)`;
      await expect(loadWorkspace(await withPrimitives(height('unit: { id: "00000001" }')))).rejects.toThrow(refusal("00000001"));
      await expect(loadWorkspace(await withPrimitives(height("")))).rejects.toThrow(refusal("none"));
      await expect(loadWorkspace(await withPrimitives(height('unit: { id: "AB32278E" }, more: { id: "00000001" }')))).rejects.toThrow(refusal("AB32278E, 00000001"));
    });

    it("refuses a function with both a block and a galaxy of its own, which would drop the calls in its block", async () => {
      const both = '{ functions: { loop: { library: "Tide", id: "T1", kind: "action", params: {}, block: "while", galaxy } } }';
      await expect(loadWorkspace(await withPrimitives(both))).rejects.toThrow(
        "Plugin old (./old)'s Mechanic tide contributes the trigger function Tide/T1 as a block with a galaxy of its own, which can't write the calls its block holds: leave out the galaxy, so its template writes it",
      );
    });

    it("refuses one that redefines core's, or that another Mechanic contributes differently", async () => {
      const coreId = '{ functions: { init: { library: "Ntve", id: "00000120", kind: "action", params: {}, galaxy } } }';
      await expect(loadWorkspace(await withPrimitives(coreId))).rejects.toThrow("Plugin old (./old)'s Mechanic tide contributes the trigger function Ntve/00000120, which core provides differently");
      const rise = (param: string) => `{ functions: { rise: { library: "Tide", id: "T1", kind: "action", params: { height: { id: "${param}" } }, galaxy } } }`;
      const ebb = `, { type: "ebb", paramsSchema: schema, buildTriggers: () => [], primitives: ${rise("P2")} }`;
      await expect(loadWorkspace(await withPrimitives(rise("P1"), ebb))).rejects.toThrow(
        "Plugin old (./old)'s Mechanic ebb contributes the trigger function Tide/T1, which Plugin old (./old)'s Mechanic tide contributes differently",
      );
    });
  });

  it("refuses a Plugin that contributes characters, in its manifest or its code: they're declared in the Campaign Mod's Blueprint", async () => {
    const pack = { ...manifest, name: "pack", roles: ["campaign-pack"], entry: "./index.mjs" };
    const inManifest = await workspace(
      { campaign: { id: "fixtures", name: "Fixture Campaign" }, campaignPack: "./pack" },
      { pack: { ...pack, contributions: { characters: ["RAYNOR"] } } },
      { "pack/index.mjs": "export default {};" },
    );
    await expect(loadWorkspace(inManifest)).rejects.toThrow("A Plugin no longer contributes characters: declare them in the characters of the Campaign Mod's Mod Blueprint");
    const inCode = await workspace(
      { campaign: { id: "fixtures", name: "Fixture Campaign" }, campaignPack: "./pack" },
      { pack: { ...pack, contributions: {} } },
      { "pack/index.mjs": 'export default { characters: [{ speaker: "RAYNOR" }] };' },
    );
    await expect(loadWorkspace(inCode)).rejects.toThrow("characters: A Plugin no longer contributes characters");
  });

  it("refuses a naming template with a hook core doesn't know, rather than ignore it", async () => {
    const root = await workspace(
      { campaign: { id: "fixtures", name: "Fixture Campaign" }, campaignPack: "./pack" },
      { pack: { ...manifest, name: "pack", roles: ["campaign-pack"], contributions: { naming: ["ids"] }, entry: "./index.mjs" } },
      { "pack/index.mjs": 'export default { naming: { name: "ids", soundID: () => "x" } };' },
    );
    await expect(loadWorkspace(root)).rejects.toThrow("Plugin pack (./pack): its code's default export isn't a Plugin: naming: Unrecognized key");
  });

  it("finds the Campaign Pack's Screenplay Source", async () => {
    const root = await workspace(
      { campaign: { id: "fixtures", name: "Fixture Campaign" }, campaignPack: "./pack" },
      { pack: { ...manifest, name: "pack", roles: ["campaign-pack"], contributions: { screenplaySource: ["drive"] }, entry: "./index.mjs" } },
      { "pack/index.mjs": 'export default { screenplaySource: { name: "drive", fetch: async () => "" } };' },
    );
    const { registry } = await loadWorkspace(root);
    expect(registry.screenplaySource()?.name).toBe("drive");
    expect(registry.plugins[0]?.contributions.screenplaySource).toEqual(["drive"]);
  });

  it("refuses a Screenplay Source from a Plugin that isn't the Campaign Pack", async () => {
    const root = await workspace(
      { campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["./pack"] },
      { pack: { ...manifest, name: "pack", contributions: { screenplaySource: ["drive"] }, entry: "./index.mjs" } },
      { "pack/index.mjs": 'export default { screenplaySource: { name: "drive", fetch: async () => "" } };' },
    );
    await expect(loadWorkspace(root)).rejects.toThrow(
      "Plugin pack (./pack) contributes a naming template, a Screenplay Source or a Campaign Mod name, which only the Workspace's Campaign Pack can: name it as the campaignPack",
    );
  });

  it("refuses a Campaign Pack whose code doesn't contribute the Screenplay Source its manifest declares", async () => {
    const root = await workspace(
      { campaign: { id: "fixtures", name: "Fixture Campaign" }, campaignPack: "./pack" },
      { pack: { ...manifest, name: "pack", roles: ["campaign-pack"], contributions: { screenplaySource: ["drive"] }, entry: "./index.mjs" } },
      { "pack/index.mjs": "export default {};" },
    );
    await expect(loadWorkspace(root)).rejects.toThrow("Plugin pack (./pack) declares the Screenplay Sources [drive] but its code contributes []");
  });

  it("refuses a Screenplay Source with no fetch hook", async () => {
    const root = await workspace(
      { campaign: { id: "fixtures", name: "Fixture Campaign" }, campaignPack: "./pack" },
      { pack: { ...manifest, name: "pack", roles: ["campaign-pack"], contributions: { screenplaySource: ["drive"] }, entry: "./index.mjs" } },
      { "pack/index.mjs": 'export default { screenplaySource: { name: "drive", pull: async () => "" } };' },
    );
    await expect(loadWorkspace(root)).rejects.toThrow("Plugin pack (./pack): its code's default export isn't a Plugin: screenplaySource.fetch: Expected a function; screenplaySource: Unrecognized key");
  });

  it("refuses Host Adapter capabilities from a Plugin the Workspace names", async () => {
    const root = await workspace(
      { campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["./old"] },
      { old: { ...manifest, roles: ["host-adapter"], contributions: { capabilities: ["tts.speak"] }, entry: "./index.mjs" } },
      { "old/index.mjs": 'export default { capabilities: { "tts.speak": async () => {} } };' },
    );
    await expect(loadWorkspace(root)).rejects.toThrow(
      "Plugin old (./old) contributes Host Adapter capabilities, so it can only be named as the machine's Host Adapter (hostAdapter in the machine config)",
    );
  });

  it("refuses a Plugin whose declared and contributed capabilities differ, or that names an unknown one", async () => {
    const differ = await workspace(
      { campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["./old"] },
      { old: { ...manifest, contributions: { capabilities: ["tts.speak"] }, entry: "./index.mjs" } },
      { "old/index.mjs": 'export default { capabilities: { "editor.open": async () => {} } };' },
    );
    await expect(loadWorkspace(differ)).rejects.toThrow("Plugin old (./old) declares the capabilities [tts.speak] but its code contributes [editor.open]");

    const unknown = await workspace({ campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["./old"] }, { old: { ...manifest, contributions: { capabilities: ["kettle.boil"] } } });
    await expect(loadWorkspace(unknown)).rejects.toThrow(/Plugin \.\/old .* has an invalid manifest: contributions\.capabilities\.0: Invalid option/);
  });
});

describe("a Plugin's Lights", () => {
  const config = { campaign: { id: "fixtures", name: "Fixture Campaign" }, plugins: ["./sun"] };
  const sun = { ...manifest, name: "sun", contributions: { lights: "lights.json" } };
  const noon = { id: "DuneNoon", from: "ArcadeCityLight", key: { color: [1, 0.6, 0.3], direction: [0, -0.4, -0.9] }, fill: { color: [1, 0.6, 0.3], scale: 2 }, exposure: 1.2 };
  const withLights = (lights: unknown[]) => workspace(config, { sun }, { "sun/lights.json": JSON.stringify({ lights }) });

  it("loads the Lights its lights file holds, each by its id", async () => {
    const { registry } = await loadWorkspace(await withLights([noon]));
    expect(registry.light("DuneNoon")).toEqual({ light: noon, plugin: "sun" });
    expect(registry.light("ArcadeCityLight")).toBeUndefined();
    expect(registry.plugins[0]!.contributions.lights).toEqual(["DuneNoon"]);
  });

  it("refuses a Light whose values are invalid, naming the file and the field", async () => {
    await expect(loadWorkspace(await withLights([{ ...noon, exposure: -1 }]))).rejects.toThrow("Plugin sun (./sun): its Lights lights.json is invalid: lights.0.exposure: Too small: expected number to be >0");
  });

  it("refuses a Light copied from a Light the stock catalog lacks, one named as a stock Light, and one held twice", async () => {
    await expect(loadWorkspace(await withLights([{ ...noon, from: "NoSuchLight" }]))).rejects.toThrow("Plugin sun (./sun): its Light DuneNoon copies NoSuchLight, which isn't a stock Light (data/light-catalog.json)");
    await expect(loadWorkspace(await withLights([{ ...noon, id: "ArcadeCityLight" }]))).rejects.toThrow("Plugin sun (./sun): its Light ArcadeCityLight has a stock Light's id, which it would replace in every map");
    await expect(loadWorkspace(await withLights([noon, noon]))).rejects.toThrow("Plugin sun (./sun): its Lights hold DuneNoon twice");
  });

  it("refuses a Light another Plugin already contributes", async () => {
    const root = await workspace({ ...config, plugins: ["./sun", "./moon"] }, { sun, moon: { ...sun, name: "moon" } }, { "sun/lights.json": JSON.stringify({ lights: [noon] }), "moon/lights.json": JSON.stringify({ lights: [noon] }) });
    await expect(loadWorkspace(root)).rejects.toThrow("Plugin moon (./moon) contributes the Light DuneNoon, which Plugin sun already contributes");
  });
});

describe("style rules", () => {
  const config = { campaign: { id: "fixtures", name: "Fixture Campaign" } };
  const stylePack = (rules: string[]) => ({ ...manifest, name: "taste", roles: ["style-pack"], contributions: { styleRules: rules }, entry: "./index.mjs" });
  const code = (rules: string) => ({ "taste/index.mjs": `export default { styleRules: ${rules} };` });

  it("applies the rules of the Plugin named as the stylePack", async () => {
    const rules = '[{ id: "level", lesson: "DL-99", yaw: () => 0 }, { id: "pebbles", lipScale: [0.5, 0.5] }]';
    const root = await workspace({ ...config, stylePack: "./taste" }, { taste: stylePack(["level", "pebbles"]) }, code(rules));
    const { registry } = await loadWorkspace(root);
    expect(Object.keys(registry.styleRules())).toEqual(["yaw", "lipScale"]);
    expect(registry.styleRules().yaw!({ turn: 1, built: false })).toBe(0);
    expect(registry.contributions("styleRules").map((rule) => rule.id)).toEqual(["level", "pebbles"]);
    expect(registry.plugins[0]!.contributions.styleRules).toEqual(["level", "pebbles"]);
  });

  it("ignores a Plugin's rules when the Workspace doesn't name it as its stylePack, and doesn't list them", async () => {
    const root = await workspace({ ...config, plugins: ["./taste"] }, { taste: stylePack(["level"]) }, code('[{ id: "level", yaw: () => 0 }]'));
    const { registry } = await loadWorkspace(root);
    expect(registry.styleRules()).toEqual({});
    expect(registry.contributions("styleRules")).toEqual([]);
  });

  it("calls a hook on its rule, and names the rule when it throws or returns the wrong shape", async () => {
    const rules =
      '[{ id: "level", lesson: "DL-99", yaw() { return this.lesson === "DL-99" ? 0.5 : Number.NaN; } }, { id: "broken", blendGroup: () => { throw new Error("no tones"); } }, { id: "wrong", compositeWarnings: () => "one warning" }]';
    const root = await workspace({ ...config, stylePack: "./taste" }, { taste: stylePack(["level", "broken", "wrong"]) }, code(rules));
    const { registry } = await loadWorkspace(root);
    expect(() => registry.styleRules().blendGroup!({ name: "Dirt", tone: undefined })).toThrow("Plugin taste (./taste): style rule broken: its blendGroup slot threw: no tones");
    expect(() => registry.styleRules().compositeWarnings!([])).toThrow("Plugin taste (./taste): style rule wrong: its compositeWarnings slot returned (result): Invalid input");
    expect(registry.styleRules().yaw!({ turn: 1, built: false })).toBe(0.5);
  });

  it("refuses a scale range whose min is over its max", async () => {
    const root = await workspace({ ...config, stylePack: "./taste" }, { taste: stylePack(["pebbles"]) }, code('[{ id: "pebbles", lipScale: [1.2, 0.8] }]'));
    await expect(loadWorkspace(root)).rejects.toThrow("A scale range is [min, max], with min no more than max");
  });

  it("refuses two rules that fill one slot, naming both", async () => {
    const root = await workspace({ ...config, stylePack: "./taste" }, { taste: stylePack(["a", "b"]) }, code('[{ id: "a", yaw: () => 0 }, { id: "b", yaw: () => 1 }]'));
    await expect(loadWorkspace(root)).rejects.toThrow("Plugin taste (./taste): its style rules a and b both fill the yaw slot");
  });

  it("refuses rules the manifest doesn't declare, a slot core doesn't have, and rules without the style-pack role", async () => {
    const undeclared = await workspace({ ...config, stylePack: "./taste" }, { taste: stylePack([]) }, code('[{ id: "level", yaw: () => 0 }]'));
    await expect(loadWorkspace(undeclared)).rejects.toThrow("Plugin taste (./taste) declares the style rules [] but its code contributes [level]");
    const unknown = await workspace({ ...config, stylePack: "./taste" }, { taste: stylePack(["level"]) }, code('[{ id: "level", sparkle: 1 }]'));
    await expect(loadWorkspace(unknown)).rejects.toThrow("Plugin taste (./taste): its code's default export isn't a Plugin: styleRules.0: Unrecognized key: \"sparkle\"");
    const roleless = await workspace({ ...config, plugins: ["./taste"] }, { taste: { ...stylePack(["level"]), roles: [] } }, code('[{ id: "level", yaw: () => 0 }]'));
    await expect(loadWorkspace(roleless)).rejects.toThrow("Plugin taste (./taste) contributes style rules, but its manifest doesn't declare the style-pack role");
  });
});

describe("exemplarMapSources", () => {
  /** A machine config with these settings, as `loadMachineConfig` gives it. */
  const machine = (settings: { readonly exemplarMaps?: string } = {}) => ({ file: "/home/author/.config/sc2-adjutant/machine.json", ...settings });

  it("finds the Style Pack's Exemplar Maps in the folder the machine config names", async () => {
    const workspace = await loadWorkspace(fixture("field"));
    const sources = await exemplarMapSources(workspace, machine({ exemplarMaps: "/maps" }));
    expect(sources.map(({ id, provenance, source, studyDir }) => ({ id, provenance, source, studyDir }))).toEqual([
      { id: "ridge", provenance: "made", source: path.resolve("/maps/Ridge.SC2Map"), studyDir: path.join(fixture("field"), "plugins/example-pack/exemplars/ridge") },
      { id: "dunes", provenance: "approved", source: path.resolve("/maps/Dunes.SC2Map"), studyDir: path.join(fixture("field"), "plugins/example-pack/exemplars/dunes") },
    ]);
  });

  it("takes the folder from SC2_ADJUTANT_EXEMPLAR_MAPS over the machine config file, and expands ~/", async () => {
    const config = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-machine-"));
    roots.push(config);
    const file = path.join(config, "machine.json");
    await writeFile(file, JSON.stringify({ exemplarMaps: "maps" }));
    const workspace = await loadWorkspace(fixture("field"));
    const first = async (env: Record<string, string>) => (await exemplarMapSources(workspace, await loadMachineConfig({ file, env })))[0]!.source;
    // A relative folder in the file is relative to the file; in the variable, to where it was set.
    expect(await first({})).toBe(path.join(config, "maps/Ridge.SC2Map"));
    expect(await first({ SC2_ADJUTANT_EXEMPLAR_MAPS: "~/maps" })).toBe(path.join(os.homedir(), "maps/Ridge.SC2Map"));
    expect(await first({ SC2_ADJUTANT_EXEMPLAR_MAPS: "maps" })).toBe(path.resolve("maps/Ridge.SC2Map"));
  });

  it("falls back to a Workspace config's folder, relative to the Workspace root, under the machine config's", async () => {
    const workspace = { ...(await loadWorkspace(fixture("field"))), exemplarMaps: "../exemplar-sources" };
    expect((await exemplarMapSources(workspace, machine()))[0]!.source).toBe(path.resolve(fixture("field"), "../exemplar-sources/Ridge.SC2Map"));
    expect((await exemplarMapSources(workspace, machine({ exemplarMaps: "/maps" })))[0]!.source).toBe(path.resolve("/maps/Ridge.SC2Map"));
  });

  it("gives the active Style Pack's Exemplar Maps folder and Doodad Composites file, for the scripts that regenerate them", async () => {
    const field = await loadWorkspace(fixture("field"));
    const pack = path.join(fixture("field"), "plugins/example-pack");
    expect(stylePackFiles(field)).toEqual({ exemplarDir: path.join(pack, "exemplars"), compositesFile: path.join(pack, "composites.json") });
  });

  it("names the setting when no folder is set, and the Style Pack slot when there's no pack", async () => {
    const field = await loadWorkspace(fixture("field"));
    await expect(exemplarMapSources(field, machine())).rejects.toThrow(
      "No folder for the Exemplar Maps' source maps: set exemplarMaps in the machine config /home/author/.config/sc2-adjutant/machine.json, or SC2_ADJUTANT_EXEMPLAR_MAPS",
    );
    const basic = await loadWorkspace(fixture("basic"));
    await expect(exemplarMapSources(basic, machine({ exemplarMaps: "/maps" }))).rejects.toThrow(
      `The Workspace names no Style Pack (stylePack in ${path.join(fixture("basic"), "sc2-adjutant.workspace.json")}), so it has no Exemplar Maps`,
    );
  });

  it("takes the Exemplar Maps of the Plugin named as the stylePack, not another that could fill the role", async () => {
    const exemplars = (id: string) => JSON.stringify({ exemplars: [{ id, map: `${id}.SC2Map`, provenance: "made" }] });
    const pack = (name: string, roles: string[]) => ({ ...manifest, name, roles, contributions: { exemplarMaps: "exemplars.json" } });
    const root = await workspace(
      { campaign: { id: "fixtures", name: "Fixture Campaign" }, campaignPack: "./a", stylePack: "./b", plugins: ["./c"] },
      { a: pack("a", ["campaign-pack", "style-pack"]), b: pack("b", ["style-pack"]), c: pack("c", ["style-pack"]) },
      { "a/exemplars.json": exemplars("from-a"), "b/exemplars.json": exemplars("from-b"), "c/exemplars.json": exemplars("from-c") },
    );
    expect((await exemplarMapSources(await loadWorkspace(root), machine({ exemplarMaps: "/maps" }))).map((exemplar) => exemplar.id)).toEqual(["from-b"]);
  });

  it("reads the folder from the Workspace config", async () => {
    const root = await workspace({ campaign: { id: "fixtures", name: "Fixture Campaign" }, stylePack: "./pack", exemplarMaps: "/maps" }, { pack: { ...manifest, roles: ["style-pack"] } });
    expect(await exemplarMapSources(await loadWorkspace(root), machine())).toEqual([]);
    expect((await loadWorkspace(root)).exemplarMaps).toBe("/maps");
  });
});

const manifest = { name: "old", version: "0.1.0", pluginApi: 2 };

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** A Workspace in a temporary folder, with Plugin folders' manifests keyed by name, and any other files by path. */
async function workspace(config: object, plugins: Record<string, object> = {}, files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-workspace-"));
  roots.push(root);
  await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify(config));
  for (const [name, pluginManifest] of Object.entries(plugins)) {
    await mkdir(path.join(root, name));
    await writeFile(path.join(root, name, "sc2-adjutant-plugin.json"), JSON.stringify(pluginManifest));
  }
  for (const [file, text] of Object.entries(files)) await writeFile(path.join(root, file), text);
  return root;
}
