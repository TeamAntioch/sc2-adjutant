// Host Adapters and manual hand-offs (#111), through the MCP server: the machine config names a
// Host Adapter Plugin, and each tool either uses its capabilities or hands the step to the author.
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { bareHost, loadHost } from "../../src/host/host.js";
import { defaultMachineConfigFile, loadMachineConfig } from "../../src/host/machine-config.js";
import { DEFAULT_VOICE, writePlaceholderVoices } from "../../src/host/placeholder-voices.js";
import { createServer } from "../../src/mcp/server.js";
import { readMissionBlueprint } from "../../src/plugins/workspace.js";
import { readMissionScript } from "../../src/script/name-script.js";

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}/`, import.meta.url));

const clients: Client[] = [];
const folders: string[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function tempFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-host-"));
  folders.push(folder);
  return folder;
}

/** A copy of a fixture Workspace, for tools that write into it. */
async function copyOf(workspace: string): Promise<string> {
  const root = await tempFolder();
  await cp(fixture(`workspaces/${workspace}`), root, { recursive: true });
  return root;
}

/** The `field` Workspace, with the Lava Field Mission. */
const field = () => copyOf("field");

/** The `radio` Workspace: a Mission with a Screenplay, whose Campaign Pack gives Nova a voice and Zeratul none. */
const radio = () => copyOf("radio");

/** A machine config file with these settings, in its own folder. */
async function machineConfig(settings: Record<string, string>): Promise<string> {
  const file = path.join(await tempFolder(), "machine.json");
  await writeFile(file, JSON.stringify(settings));
  return file;
}

/** A client connected to a server for `root`, on a machine with this config file and environment. */
async function connect(root: string, file: string, env: Record<string, string> = {}): Promise<Client> {
  const host = await loadHost(await loadMachineConfig({ file, env }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ workspaceRoot: root, host }).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

const text = (reply: Awaited<ReturnType<Client["callTool"]>>) =>
  (reply.content as { type: string; text?: string }[]).map((part) => part.text ?? "").join("\n");

/** A WAV file's length in seconds, from its header. */
const wavSeconds = (wav: Buffer) => wav.readUInt32LE(40) / wav.readUInt32LE(28);

// Core's default naming: the Mission id, scene and line.
const NOVA = "radio_field-1-1";
const ZERATUL = "radio_field-1-2";

describe("a Host Adapter with no capabilities", () => {
  it("makes test_mission compile the Mission and return the steps to test it by hand", async () => {
    const root = await field();
    const client = await connect(root, await machineConfig({ hostAdapter: fixture("hosts/bare") }));

    const reply = await client.callTool({ name: "test_mission", arguments: { mission: "lava-field" } });
    const mapPath = path.join(root, "missions", "lava-field", "Lava-Field.SC2Map");
    expect(reply.isError).toBeFalsy();
    const { automated, steps } = reply.structuredContent as { mapPath: string; automated: string[]; steps: string[] };
    expect(reply.structuredContent).toMatchObject({ mapPath });
    expect(automated).toEqual([]);
    expect(steps).toHaveLength(4);
    expect(steps[0]).toContain(`choose ${path.join(mapPath, "ComponentList.SC2Components")}`);
    expect(steps[2]).toBe("Choose File > Test Document. The game starts on the map.");
    expect(text(reply)).toContain(`Compiled Lava Field to ${mapPath}\nOver to the author:\n1. Open the Map Package`);
    expect(await readdir(mapPath)).toContain("MapScript.galaxy");
  });

  it("runs the Blueprint's route tests after the compile and reports each in test_mission's reply", async () => {
    const root = await field();
    const file = path.join(root, "missions", "lava-field", "blueprint.json");
    const blueprint = JSON.parse(await readFile(file, "utf8"));
    blueprint.tests = { routes: [{ id: "cross", from: "field", to: "cave", expect: "arrive" }, { id: "sealed", from: "field", to: "cave", expect: "blocked" }] };
    await writeFile(file, JSON.stringify(blueprint));
    const client = await connect(root, await machineConfig({ hostAdapter: fixture("hosts/bare") }));

    const reply = await client.callTool({ name: "test_mission", arguments: { mission: "lava-field" } });
    expect(reply.isError).toBeFalsy();
    const { routeTests } = reply.structuredContent as { routeTests: { id: string; passed: boolean }[] };
    expect(routeTests.map(({ id, passed }) => [id, passed])).toEqual([["cross", true], ["sealed", false]]);
    expect(text(reply)).toContain("Route tests (static, from the terrain; not read back from the game): 1 of 2 passed");
    expect(text(reply)).toContain("FAIL sealed:");
  });

  it("gives every Transmission a silent placeholder voice line of the line's length", async () => {
    const root = await radio();
    const client = await connect(root, await machineConfig({ hostAdapter: fixture("hosts/bare") }));

    const reply = await client.callTool({ name: "compile_map", arguments: { mission: "radio-field" } });
    const mission = path.join(root, "missions", "radio-field");
    expect(reply.isError).toBeFalsy();
    expect(text(reply)).toContain(`Wrote 2 silent placeholder voice line(s) in ${path.join(mission, "audio")}`);
    const nova = await readFile(path.join(mission, "audio", `${NOVA}.wav`));
    expect(nova.subarray(0, 4).toString()).toBe("RIFF");
    expect(wavSeconds(nova)).toBe(3);
    expect(wavSeconds(await readFile(path.join(mission, "audio", `${ZERATUL}.wav`)))).toBe(11);
    // At their final paths in the Map Package too.
    const conversations = path.join(mission, "Radio-Field.SC2Map", "Assets", "Sounds", "Conversations");
    expect((await readdir(conversations)).sort()).toEqual([`${NOVA}.wav`, `${ZERATUL}.wav`]);

    // A recompile keeps them.
    const again = await client.callTool({ name: "compile_map", arguments: { mission: "radio-field" } });
    expect(text(again)).not.toContain("placeholder");
  });

  it("doesn't list bulk tools it can't run", async () => {
    const client = await connect(fixture("workspaces/field"), await machineConfig({ hostAdapter: fixture("hosts/bare") }));
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("test_mission");
    expect(names).not.toContain("speak_placeholder_voices");
  });

  it("is listed after the Workspace's Plugins", async () => {
    const client = await connect(fixture("workspaces/field"), await machineConfig({ hostAdapter: fixture("hosts/bare") }));
    const reply = await client.callTool({ name: "list_plugins", arguments: {} });
    expect((reply.structuredContent as { plugins: unknown[] }).plugins.at(-1)).toEqual({
      name: "bare-host",
      version: "0.1.0",
      source: fixture("hosts/bare"),
      roles: ["host-adapter"],
      contributions: {
        mechanics: [],
        naming: [],
        screenplaySource: [],
        knowledge: [],
        exemplarMaps: [],
        composites: [],
        prompts: [],
        styleRules: [],
        capabilities: [],
        cutsceneSources: [],
        lights: [],
        skills: [],
      },
    });
  });
});

describe("a Host Adapter that can test and speak", () => {
  it("runs Test Document itself, with the Editor path and cache folder from the machine config and environment", async () => {
    const root = await field();
    const cache = await tempFolder();
    const file = await machineConfig({ hostAdapter: fixture("hosts/scripted"), editorPath: "Editor.app" });
    const client = await connect(root, file, { SC2_ADJUTANT_CACHE_DIR: cache });

    const reply = await client.callTool({ name: "test_mission", arguments: { mission: "lava-field" } });
    const mapPath = path.join(root, "missions", "lava-field", "Lava-Field.SC2Map");
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toEqual({
      mapPath,
      automated: ["Opened it in the Editor and ran Test Document: the game is starting on it."],
      steps: ["Play the Mission, then quit the game and say what you saw."],
      routeTests: [],
    });
    // A relative path in the machine config is relative to the config file.
    expect(await readFile(path.join(cache, "host.log"), "utf8")).toBe(`${path.join(path.dirname(file), "Editor.app")} tested ${mapPath}\n`);
  });

  it("hands Test Document to the author, with the reason, when the capability fails", async () => {
    const root = await field();
    const file = await machineConfig({ hostAdapter: fixture("hosts/scripted") });
    const client = await connect(root, file);

    const reply = await client.callTool({ name: "test_mission", arguments: { mission: "lava-field" } });
    expect(reply.isError).toBeFalsy();
    expect((reply.structuredContent as { steps: string[] }).steps).toHaveLength(4);
    expect(text(reply)).toContain(
      `The Host Adapter couldn't run Test Document: No editorPath is set: add "editorPath" to the machine config ${file}, or set SC2_ADJUTANT_EDITOR_PATH`,
    );
  });

  it("speaks missing voice lines when compiling, in each character's voice, and lists the bulk speaking tool", async () => {
    const root = await radio();
    const client = await connect(root, await machineConfig({ hostAdapter: fixture("hosts/scripted") }));
    const audio = path.join(root, "missions", "radio-field", "audio");

    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("speak_placeholder_voices");
    const reply = await client.callTool({ name: "compile_map", arguments: { mission: "radio-field" } });
    expect(text(reply)).toContain(`Wrote 2 spoken placeholder voice line(s) in ${audio}`);
    // Nova's voice is her character's; Zeratul's character gives none, so he gets the default.
    expect(await readFile(path.join(audio, `${NOVA}.wav`), "utf8")).toBe("spoken by Samantha: Zeratul, do you read me?\n");
    expect(await readFile(path.join(audio, `${ZERATUL}.wav`), "utf8")).toMatch(new RegExp(`^spoken by ${DEFAULT_VOICE.replace(/[()]/g, "\\$&")}: Loud and clear`));
  });

  it("replaces silent placeholders with spoken ones, keeping real recordings", async () => {
    const root = await radio();
    const audio = path.join(root, "missions", "radio-field", "audio");
    const silentClient = await connect(root, await machineConfig({ hostAdapter: fixture("hosts/bare") }));
    await silentClient.callTool({ name: "compile_map", arguments: { mission: "radio-field" } });
    // The author drops a recording of Zeratul's line over its placeholder.
    await writeFile(path.join(audio, `${ZERATUL}.wav`), "recorded\n");

    const client = await connect(root, await machineConfig({ hostAdapter: fixture("hosts/scripted") }));
    const reply = await client.callTool({ name: "speak_placeholder_voices", arguments: { mission: "radio-field" } });
    expect(reply.structuredContent).toEqual({ audioDir: audio, spoken: [NOVA], unhashed: [] });
    expect(await readFile(path.join(audio, `${NOVA}.wav`), "utf8")).toBe("spoken by Samantha: Zeratul, do you read me?\n");
    expect(await readFile(path.join(audio, `${ZERATUL}.wav`), "utf8")).toBe("recorded\n");

    const again = await client.callTool({ name: "speak_placeholder_voices", arguments: { mission: "radio-field" } });
    expect(again.structuredContent).toEqual({ audioDir: audio, spoken: [], unhashed: [] });
  });

  it("speaks a placeholder again when its line's text changes", async () => {
    const root = await radio();
    const audio = path.join(root, "missions", "radio-field", "audio");
    const client = await connect(root, await machineConfig({ hostAdapter: fixture("hosts/scripted") }));
    await client.callTool({ name: "compile_map", arguments: { mission: "radio-field" } });
    const scriptPath = path.join(root, "missions", "radio-field", "radio-field.md");
    await writeFile(scriptPath, (await readFile(scriptPath, "utf8")).replace("do you read me?", "come in."));

    const reply = await client.callTool({ name: "speak_placeholder_voices", arguments: { mission: "radio-field" } });
    expect(reply.structuredContent).toEqual({ audioDir: audio, spoken: [NOVA], unhashed: [] });
    expect(await readFile(path.join(audio, `${NOVA}.wav`), "utf8")).toBe("spoken by Samantha: Zeratul, come in.\n");
  });

  it("refuses speak_placeholder_voices for a Mission with no Screenplay script", async () => {
    const client = await connect(fixture("workspaces/field"), await machineConfig({ hostAdapter: fixture("hosts/scripted") }));
    const reply = await client.callTool({ name: "speak_placeholder_voices", arguments: { mission: "lava-field" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toMatch(/^Lava Field has no Screenplay script/);
  });
});

describe("the machine config", () => {
  it("is optional at its default location, and then names no Host Adapter on any platform", async () => {
    const config = await tempFolder();
    const linux = await loadMachineConfig({ env: { XDG_CONFIG_HOME: config }, platform: "linux" });
    expect(linux).toMatchObject({ file: path.join(config, "sc2-adjutant", "machine.json") });
    expect(linux.hostAdapter).toBeUndefined();
    expect((await loadHost(linux)).has("tts.speak")).toBe(false);
    expect((await loadMachineConfig({ env: { XDG_CONFIG_HOME: config }, platform: "darwin" })).hostAdapter).toBeUndefined();
    expect((await loadMachineConfig({ env: { APPDATA: config }, platform: "win32" })).hostAdapter).toBeUndefined();
  });

  it("loads the Host Adapter a config names, and none for hostAdapter none", async () => {
    for (const platform of ["darwin", "win32"] as const) {
      expect((await loadMachineConfig({ file: await machineConfig({ hostAdapter: "none" }), env: {}, platform })).hostAdapter).toBeUndefined();
    }
    const named = await loadMachineConfig({ file: await machineConfig({ hostAdapter: "bundled:host-windows" }), env: {}, platform: "win32" });
    expect(named).toMatchObject({ hostAdapter: "bundled:host-windows" });
  });

  it("treats an empty env var as unset", async () => {
    const file = await machineConfig({ hostAdapter: fixture("hosts/bare"), editorPath: "/Games/Editor.app" });
    const machine = await loadMachineConfig({ file, env: { SC2_ADJUTANT_HOST_ADAPTER: "", SC2_ADJUTANT_EDITOR_PATH: "" } });
    // A file's paths resolve from its folder, the environment's from the working one: on Windows, each takes its drive.
    expect(machine).toMatchObject({ hostAdapter: fixture("hosts/bare"), editorPath: path.resolve(path.dirname(file), "/Games/Editor.app") });
    expect(path.isAbsolute(defaultMachineConfigFile({ XDG_CONFIG_HOME: "" }, "linux"))).toBe(true);
  });

  it("must exist when it's named", async () => {
    const file = path.join(await tempFolder(), "missing.json");
    await expect(loadMachineConfig({ env: { SC2_ADJUTANT_MACHINE_CONFIG: file } })).rejects.toThrow(`Can't read the machine config ${file}`);
  });

  it("names the file and the setting when it's invalid", async () => {
    const file = await machineConfig({ editorPth: "/Applications/Editor.app" });
    await expect(loadMachineConfig({ file, env: {} })).rejects.toThrow(`Invalid machine config ${file}: (config): Unrecognized key: "editorPth"`);
  });

  it("takes each setting from the environment over the file", async () => {
    const file = await machineConfig({ sc2Path: "/Games/StarCraft II", editorPath: "/Games/Editor.app" });
    const machine = await loadMachineConfig({ file, env: { SC2_ADJUTANT_EDITOR_PATH: "/Other/Editor.app", SC2_ADJUTANT_HOST_ADAPTER: "bundled:host-macos" } });
    expect(machine).toMatchObject({ sc2Path: path.resolve(path.dirname(file), "/Games/StarCraft II"), editorPath: path.resolve("/Other/Editor.app"), hostAdapter: "bundled:host-macos" });
  });

  it("refuses a Host Adapter that isn't one", async () => {
    const plugin = path.join(await tempFolder(), "not-a-host");
    await mkdir(plugin);
    await writeFile(path.join(plugin, "sc2-adjutant-plugin.json"), JSON.stringify({ name: "not-a-host", version: "1.0.0", pluginApi: 2 }));
    await expect(loadHost(await loadMachineConfig({ file: await machineConfig({ hostAdapter: plugin }), env: {} }))).rejects.toThrow(
      `Plugin not-a-host (${plugin}) is named as the host-adapter but its manifest doesn't declare that role`,
    );
  });
});

/** A Host Adapter written for one test: its capabilities' code, as an ES module's default export body. */
async function adapter(capabilities: Record<string, string>): Promise<string> {
  const plugin = path.join(await tempFolder(), "made-host");
  await mkdir(plugin);
  const manifest = { name: "made-host", version: "1.0.0", pluginApi: 2, roles: ["host-adapter"], contributions: { capabilities: Object.keys(capabilities) }, entry: "./index.mjs" };
  await writeFile(path.join(plugin, "sc2-adjutant-plugin.json"), JSON.stringify(manifest));
  const body = Object.entries(capabilities).map(([name, code]) => `${JSON.stringify(name)}: ${code}`);
  await writeFile(path.join(plugin, "index.mjs"), `export default { capabilities: { ${body.join(", ")} } };\n`);
  return plugin;
}

/**
 * The `radio` Workspace compiled on a host that speaks, and `oldManifest`, which rewrites its
 * manifest as an older npm run tts wrote it: bare keys, with Zeratul's from before his line changed.
 */
async function radioWithOldManifest() {
  const root = await radio();
  const audio = path.join(root, "missions", "radio-field", "audio");
  const client = await connect(root, await machineConfig({ hostAdapter: fixture("hosts/scripted") }));
  await client.callTool({ name: "compile_map", arguments: { mission: "radio-field" } });
  const manifestPath = path.join(audio, "manifest.json");
  const oldManifest = async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ [NOVA]: manifest[NOVA].from, [ZERATUL]: "a key for his old line" }));
  };
  return { audio, client, manifestPath, oldManifest };
}

describe("review regressions", () => {
  it("doesn't compile when the Editor has the map open", async () => {
    const root = await field();
    const plugin = await adapter({ "editor.checkClosed": 'async () => { throw new Error("the Editor has lava-field.SC2Map open"); }', "editor.testDocument": "async () => {}" });
    const client = await connect(root, await machineConfig({ hostAdapter: plugin }));

    const reply = await client.callTool({ name: "test_mission", arguments: { mission: "lava-field" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toMatch(/^Not compiled: the Editor has lava-field\.SC2Map open\nOver to the author:\n1\. Close the map/);
    // No Map Package is written beside the Blueprint.
    expect(await readdir(path.join(root, "missions", "lava-field"))).not.toContain("Lava-Field.SC2Map");
  });

  it("compile_map doesn't rewrite a map the Editor has open", async () => {
    const root = await field();
    const plugin = await adapter({ "editor.checkClosed": 'async () => { throw new Error("the Editor has lava-field.SC2Map open"); }' });
    const client = await connect(root, await machineConfig({ hostAdapter: plugin }));

    const reply = await client.callTool({ name: "compile_map", arguments: { mission: "lava-field" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toMatch(/^Not compiled: the Editor has lava-field\.SC2Map open\nOver to the author:\n1\. Close the map[^\n]*\n2\. Ask for compile_map again\./);
    expect(await readdir(path.join(root, "missions", "lava-field"))).not.toContain("Lava-Field.SC2Map");
  });

  describe("compile_map with refresh (#739)", () => {
    /** An Editor that has the map open: checkClosed refuses until refresh closes it; each call is logged. */
    async function openEditor(log: string, refresh: string) {
      const code = (name: string, body: string) => `async () => { await (await import("node:fs/promises")).appendFile(${JSON.stringify(log)}, ${JSON.stringify(`${name}\n`)}); ${body} }`;
      return adapter({
        "editor.checkClosed": `async () => { const fs = await import("node:fs/promises"); const calls = await fs.readFile(${JSON.stringify(log)}, "utf8").catch(() => ""); await fs.appendFile(${JSON.stringify(log)}, "checkClosed\\n"); if (!calls.includes("refresh")) throw new Error("the Editor has it open"); }`,
        "editor.refresh": code("refresh", refresh),
        "editor.open": code("open", ""),
      });
    }

    it("closes the open map, compiles, and opens it again", async () => {
      const root = await field();
      const log = path.join(await tempFolder(), "calls.log");
      const plugin = await openEditor(log, "");
      const client = await connect(root, await machineConfig({ hostAdapter: plugin }));

      const reply = await client.callTool({ name: "compile_map", arguments: { mission: "lava-field", refresh: true } });
      expect(reply.isError).toBeFalsy();
      expect(text(reply)).toContain("closed before the compile and opened again");
      expect(await readdir(path.join(root, "missions", "lava-field"))).toContain("Lava-Field.SC2Map");
      expect((await readFile(log, "utf8")).trim().split("\n")).toEqual(["checkClosed", "refresh", "checkClosed", "open"]);
    });

    it("compiles nothing when the refresh refuses, such as for unsaved changes", async () => {
      const root = await field();
      const log = path.join(await tempFolder(), "calls.log");
      const plugin = await openEditor(log, 'throw new Error("the Editor shows unsaved changes in Lava-Field.SC2Map");');
      const client = await connect(root, await machineConfig({ hostAdapter: plugin }));

      const reply = await client.callTool({ name: "compile_map", arguments: { mission: "lava-field", refresh: true } });
      expect(reply.isError).toBe(true);
      expect(text(reply)).toMatch(/^Not compiled: the Editor shows unsaved changes[^\n]*\nOver to the author:\n1\. Close the map/);
      expect(await readdir(path.join(root, "missions", "lava-field"))).not.toContain("Lava-Field.SC2Map");
      expect((await readFile(log, "utf8")).trim().split("\n")).toEqual(["checkClosed", "refresh"]);
    });

    it("neither closes nor opens a map the Editor doesn't have open", async () => {
      const root = await field();
      const log = path.join(await tempFolder(), "calls.log");
      // Closed from the start: the check passes.
      const closedAtStart = await adapter({
        "editor.checkClosed": "async () => {}",
        "editor.refresh": `async () => { (await import("node:fs/promises")).appendFile(${JSON.stringify(log)}, "refresh\\n"); }`,
        "editor.open": `async () => { (await import("node:fs/promises")).appendFile(${JSON.stringify(log)}, "open\\n"); }`,
      });
      const client = await connect(root, await machineConfig({ hostAdapter: closedAtStart }));

      const reply = await client.callTool({ name: "compile_map", arguments: { mission: "lava-field", refresh: true } });
      expect(reply.isError).toBeFalsy();
      expect(existsSync(log)).toBe(false);
    });

    it("says so when the Host Adapter can't refresh", async () => {
      const root = await field();
      const plugin = await adapter({ "editor.checkClosed": 'async () => { throw new Error("open"); }' });
      const client = await connect(root, await machineConfig({ hostAdapter: plugin }));
      const reply = await client.callTool({ name: "compile_map", arguments: { mission: "lava-field", refresh: true } });
      expect(reply.isError).toBe(true);
      expect(text(reply)).toContain("can't close and reopen a map");
    });
  });

  it("compile_map goes ahead when the Editor doesn't have the map open", async () => {
    const root = await field();
    const plugin = await adapter({ "editor.checkClosed": "async () => {}" });
    const client = await connect(root, await machineConfig({ hostAdapter: plugin }));
    expect((await client.callTool({ name: "compile_map", arguments: { mission: "lava-field" } })).isError).toBeFalsy();
    expect(await readdir(path.join(root, "missions", "lava-field"))).toContain("Lava-Field.SC2Map");
  });

  it("doesn't write a cutscene into a map the Editor has open", async () => {
    const root = await field();
    // The map is compiled on a host with no check, since compile_map refuses a map the Editor has open.
    const compiler = await connect(root, await machineConfig({ hostAdapter: fixture("hosts/scripted") }));
    expect((await compiler.callTool({ name: "compile_map", arguments: { mission: "lava-field" } })).isError).toBeFalsy();
    const plugin = await adapter({ "editor.checkClosed": 'async () => { throw new Error("the Editor has lava-field.SC2Map open"); }', "editor.testDocument": "async () => {}" });
    const client = await connect(root, await machineConfig({ hostAdapter: plugin }));
    const shots = { origin: [20, 30, 0], shots: [{ name: "Wide", durationMs: 2000, from: { target: [16, 32, 1], distance: 20, pitch: 30, yaw: 180, fov: 40 } }] };
    await writeFile(path.join(root, "missions", "lava-field", "intro.json"), JSON.stringify(shots));

    const reply = await client.callTool({ name: "compile_cutscene", arguments: { mission: "lava-field", shotList: "missions/lava-field/intro.json", play: true } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toMatch(/^Not written: the Editor has lava-field\.SC2Map open\nOver to the author:\n1\. Close the map[^\n]*\n2\. Ask for compile_cutscene again\./);
    expect(existsSync(path.join(root, "missions", "lava-field", "Lava-Field.SC2Map", "Base.SC2Data", "Cutscenes"))).toBe(false);
  });

  it("gives a line silence, with a warning, when the Host Adapter fails to speak it in a compile", async () => {
    const root = await radio();
    const plugin = await adapter({ "tts.speak": 'async () => { throw new Error("say is busy"); }' });
    const client = await connect(root, await machineConfig({ hostAdapter: plugin }));

    const reply = await client.callTool({ name: "compile_map", arguments: { mission: "radio-field" } });
    expect(reply.isError).toBeFalsy();
    expect(text(reply)).toContain(`Warning: The Host Adapter couldn't speak ${NOVA}, so it got a silent placeholder: say is busy`);
    expect(wavSeconds(await readFile(path.join(root, "missions", "radio-field", "audio", `${NOVA}.wav`)))).toBeGreaterThan(0);
  });

  it("on a host that can't speak, reports only spoken placeholders whose text changed, and never replaces an old unhashed one", async () => {
    const root = await radio();
    const audio = path.join(root, "missions", "radio-field", "audio");
    await (await connect(root, await machineConfig({ hostAdapter: fixture("hosts/scripted") }))).callTool({ name: "compile_map", arguments: { mission: "radio-field" } });
    const blueprintPath = path.join(root, "missions", "radio-field", "blueprint.json");
    const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);
    const { script, voiceFormat } = (await readMissionScript(blueprint, blueprintPath, workspace))!;

    expect((await writePlaceholderVoices(bareHost(), script, audio, "stale", { format: voiceFormat })).outdated).toEqual([]);

    // An entry as the old npm run tts wrote it: just a key, no hash of the file.
    const manifestPath = path.join(audio, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, [ZERATUL]: "an old key" }));
    await writeFile(path.join(audio, `${ZERATUL}.wav`), "recorded\n");
    const result = await writePlaceholderVoices(bareHost(), script, audio, "stale", { format: voiceFormat });
    expect(result).toMatchObject({ outdated: [], unhashed: [ZERATUL] });
    expect(await readFile(path.join(audio, `${ZERATUL}.wav`), "utf8")).toBe("recorded\n");
  });

  it("on a host that can speak, reports an old unhashed voice file whose line changed as unhashed, and keeps it", async () => {
    const { audio, client, oldManifest } = await radioWithOldManifest();
    await oldManifest();
    await writeFile(path.join(audio, `${ZERATUL}.wav`), "recorded\n");

    const reply = await client.callTool({ name: "speak_placeholder_voices", arguments: { mission: "radio-field" } });
    expect(reply.structuredContent).toMatchObject({ spoken: [], unhashed: [ZERATUL] });
    expect(text(reply)).toContain(`Kept 1 voice file(s) whose line changed, since an older version recorded no hash of them`);
    expect(text(reply)).not.toContain("can't speak");
    expect(await readFile(path.join(audio, `${ZERATUL}.wav`), "utf8")).toBe("recorded\n");
  });

  it("speaks an old unhashed placeholder again once the author adopts it, and hashes the unchanged ones", async () => {
    const { audio, client, manifestPath, oldManifest } = await radioWithOldManifest();
    await oldManifest();

    const reply = await client.callTool({ name: "speak_placeholder_voices", arguments: { mission: "radio-field", adoptUnhashed: true } });
    expect(reply.structuredContent).toMatchObject({ spoken: [ZERATUL], unhashed: [] });
    expect(await readFile(path.join(audio, `${ZERATUL}.wav`), "utf8")).toMatch(/^spoken by .*: Loud and clear/);
    // Nova's line was unchanged, so it isn't spoken again, but its entry now has the file's hash.
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest[NOVA]).toMatchObject({ sha1: expect.any(String), text: expect.any(String) });

    // A later change to Nova's line is now spoken again without adopting.
    const scriptPath = path.join(audio, "..", "radio-field.md");
    await writeFile(scriptPath, (await readFile(scriptPath, "utf8")).replace("do you read me?", "come in."));
    const again = await client.callTool({ name: "speak_placeholder_voices", arguments: { mission: "radio-field" } });
    expect(again.structuredContent).toMatchObject({ spoken: [NOVA], unhashed: [] });
  });

  it("rejects, rather than throws, when a capability throws before it returns a promise", async () => {
    const plugin = await adapter({ "editor.open": '() => { throw new Error("no Editor"); }' });
    const host = await loadHost(await loadMachineConfig({ file: await machineConfig({ hostAdapter: plugin }), env: {} }));
    const running = host.run("editor.open", { mapPath: "/tmp/Mission.SC2Map" });
    await expect(running).rejects.toThrow("no Editor");
  });

  it("loads no Host Adapter for hostAdapter none on a Mac", async () => {
    const machine = await loadMachineConfig({ file: await machineConfig({ hostAdapter: "none" }), env: {}, platform: "darwin" });
    expect(machine.hostAdapter).toBeUndefined();
    expect((await loadHost(machine)).adapter).toBeUndefined();
  });
});
