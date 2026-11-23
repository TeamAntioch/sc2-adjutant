// record_model_anims (ADR-0026): records models' animations in the Workspace, each in its owner's
// file, and tells the session which stock models core could carry, through the MCP server.
import { readFile, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";

import { CAMPAIGN_CATALOGS } from "../../src/catalog/model-anims.js";
import { bareHost, type Host, loadHost } from "../../src/host/host.js";
import { loadMachineConfig } from "../../src/host/machine-config.js";
import { createServer } from "../../src/mcp/server.js";
import { m3 } from "../fixtures/m3.js";
import { put } from "../mods/mod-fixture.js";
import { copyOf, text } from "./harness.js";
import { cleanupLantern, lanternWorkspace } from "../mods/lantern-fixture.js";

const studio = fileURLToPath(new URL("../fixtures/hosts/studio/", import.meta.url));
const clients: Client[] = [];
const folders: string[] = [];
afterEach(async () => {
  await cleanupLantern();
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

/** The studio Host Adapter, its game install holding the Trooper, and the game's ModelData already in its cache, as campaignModelData keeps it. */
async function studioHost(): Promise<Host> {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-record-tool-"));
  folders.push(folder);
  const cacheDir = path.join(folder, "cache");
  await put(path.join(cacheDir, "game", "Assets/Units/Trooper/Trooper.m3"), m3([{ name: "Stand", start: 0, end: 2000, speed: 0, flags: 0 }]));
  for (const [index, mod] of CAMPAIGN_CATALOGS.entries()) {
    const data = index === 0 ? `<Catalog>\n    <CModel id="TestTrooper"><Model value="Assets\\Units\\Trooper\\Trooper.m3"/></CModel>\n</Catalog>` : "<Catalog/>";
    await put(path.join(cacheDir, "game-data", mod, "ModelData.xml"), data);
  }
  const machine = path.join(folder, "machine.json");
  await writeFile(machine, JSON.stringify({ hostAdapter: studio, cacheDir }));
  return loadHost(await loadMachineConfig({ file: machine, env: {} }));
}

async function connectWith(root: string, host: Host): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createServer({ workspaceRoot: root, host }).connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  clients.push(client);
  return client;
}

describe("record_model_anims", () => {
  it("records a stock model at the Workspace root and says to offer a Missing-Feature Report", async () => {
    const root = await copyOf("cinematic");
    const client = await connectWith(root, await studioHost());
    const reply = await client.callTool({ name: "record_model_anims", arguments: { models: ["TestTrooper"] } });
    expect(reply.isError).toBeFalsy();
    expect(reply.structuredContent).toEqual({ written: [{ file: "model-anims.json", models: ["TestTrooper"] }], failed: [], stock: ["TestTrooper"] });
    expect(text(reply)).toContain("model-anims.json: TestTrooper");
    expect(text(reply)).toContain("offer a Missing-Feature Report (the report-missing-feature skill)");
    expect(Object.keys(JSON.parse(await readFile(path.join(root, "model-anims.json"), "utf8")))).toEqual(["TestTrooper"]);
  });

  it("is listed on a host that can't export models, and refuses each game model naming the capability", async () => {
    const root = await copyOf("cinematic");
    const client = await connectWith(root, bareHost());
    const reply = await client.callTool({ name: "record_model_anims", arguments: { models: ["TestTrooper"] } });
    expect(reply.structuredContent).toMatchObject({ written: [], stock: [], failed: [{ id: "TestTrooper", reason: expect.stringContaining("needs the model.export capability") }] });
    expect(text(reply)).toContain("needs the model.export capability");
  });

  it("records a named Mission's own model from its Map Package, on a host with no Host Adapter", async () => {
    const { root, blueprintPath } = await lanternWorkspace();
    const mission = path.dirname(blueprintPath);
    await put(path.join(mission, "Ashen.SC2Map/Base.SC2Data/GameData/ModelData.xml"), `<Catalog>\n    <CModel id="AshenSignal"><Model value="Assets\\Signal\\Signal.m3"/></CModel>\n</Catalog>\n`);
    await put(path.join(mission, "Ashen.SC2Map/Assets/Signal/Signal.m3"), m3([{ name: "Stand", start: 0, end: 2000, speed: 0, flags: 0 }]));
    await put(path.join(mission, "compile-record.json"), JSON.stringify({ version: 1, entries: [] }));
    const client = await connectWith(root, bareHost());
    const reply = await client.callTool({ name: "record_model_anims", arguments: { models: ["AshenSignal"], mission: "ashen-crossing" } });
    expect(reply.structuredContent).toEqual({ written: [{ file: "missions/ashen-crossing/model-anims.json", models: ["AshenSignal"] }], failed: [], stock: [] });
    expect(text(reply)).not.toContain("Missing-Feature Report");
  });

  it("refuses a Mission the Workspace doesn't have", async () => {
    const root = await copyOf("cinematic");
    const client = await connectWith(root, await studioHost());
    const reply = await client.callTool({ name: "record_model_anims", arguments: { models: ["TestTrooper"], mission: "nowhere" } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("No Mission nowhere in the Workspace");
  });
});
