// The testbed as a Workspace names it: bundled:anim-testbed, a Utility core resolves beside itself.
import { realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { bareHost } from "@team-antioch/sc2-adjutant/src/host/host.js";
import { createServer } from "@team-antioch/sc2-adjutant/src/mcp/server.js";
import { copyWorkspaceSkills } from "@team-antioch/sc2-adjutant/src/plugins/plugin-skills.js";
import { afterEach, describe, expect, it } from "vitest";

const PACKAGE = realpathSync(fileURLToPath(new URL("..", import.meta.url)));

const clients: Client[] = [];
const folders: string[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-testbed-"));
  folders.push(root);
  await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixtures" }, utilities: ["bundled:anim-testbed"] }));
  return root;
}

describe("bundled:anim-testbed", () => {
  it("loads the package as a Utility with its skill", async () => {
    const root = await workspace();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer({ workspaceRoot: root, host: bareHost() }).connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
    clients.push(client);
    const reply = await client.callTool({ name: "list_plugins", arguments: {} });
    expect(reply.isError).toBeFalsy();
    const { plugins } = reply.structuredContent as { plugins: { name: string; source: string; roles: string[] }[] };
    expect(plugins).toEqual([expect.objectContaining({ name: "anim-testbed", source: "bundled:anim-testbed", roles: ["utility"] })]);
  });

  it("copies its skill into the Workspace with the package's folder filled in", async () => {
    const root = await workspace();
    await copyWorkspaceSkills(root);
    const skill = await readFile(path.join(root, ".claude", "skills", "anim-testbed", "SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\nname: anim-testbed\n/);
    expect(skill).toContain(`node ${PACKAGE}/dist/testbed.js`);
    expect(skill).not.toContain("{{PLUGIN_FOLDER}}");
  });
});
