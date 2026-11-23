// The call context (#718): the shapes every tool group builds its replies and refusals with, held
// in one place so a change to them fails here, and the `workspace` input every tool takes from the
// server. The tool-list snapshot covers the listed schemas; this covers what a call answers with.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import type { Host } from "../../src/host/host.js";
import { bareHost } from "../../src/host/host.js";
import { emptyMachineConfig } from "../../src/host/machine-config.js";
import { createCallContext, withWorkspaceInput } from "../../src/mcp/call-context.js";
import { editorHasOpen } from "../../src/mcp/tools/editor-handoff.js";
import { fixture } from "./harness.js";

const clients: Client[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

const contextFor = (server: McpServer) => createCallContext(server, { workspaceRoot: fixture("crossing"), following: false, host: bareHost() }, withWorkspaceInput(server));

describe("the replies a tool builds", () => {
  const ctx = contextFor(new McpServer({ name: "test", version: "0.0.0" }));

  it("reply is its text, and the structured result only when given", () => {
    expect(ctx.reply("Done.")).toEqual({ content: [{ type: "text", text: "Done." }] });
    expect(ctx.reply("Done.", { saved: true })).toEqual({ content: [{ type: "text", text: "Done." }], structuredContent: { saved: true } });
  });

  it("fail is a reply with isError set", () => {
    expect(ctx.fail("No.")).toEqual({ isError: true, content: [{ type: "text", text: "No." }] });
    expect(ctx.fail("No.", { reason: "x" })).toEqual({ isError: true, content: [{ type: "text", text: "No." }], structuredContent: { reason: "x" } });
  });

  it("refused names the Blueprint it left unchanged, lists each issue, and says saved: false", () => {
    const issues = [{ path: "zones.0.name", message: "must be a string" }];
    const refused = ctx.refused("/w/missions/m/blueprint.json", issues, { extra: 1 }, ["A note."]);
    expect(refused.isError).toBe(true);
    expect(refused.content).toEqual([{ type: "text", text: "Refused; /w/missions/m/blueprint.json is unchanged:\n- zones.0.name: must be a string\nA note." }]);
    expect(refused.structuredContent).toEqual({ saved: false, notes: [], extra: 1, issues });
  });

  it("refused's own structured fields win over the defaults", () => {
    expect(ctx.refused("b.json", [], { saved: false, notes: ["n"] }).structuredContent).toEqual({ saved: false, notes: ["n"], issues: [] });
  });
});

describe("a Map Package the Editor has open", () => {
  const openHost: Host = {
    machine: emptyMachineConfig(),
    adapter: undefined,
    has: (capability) => capability === "editor.checkClosed",
    run: () => Promise.reject(new Error("the Editor has it open")) as never,
  };

  it("is refused with the reason and the author's steps, which ctx.fail makes a failure", async () => {
    const open = await editorHasOpen(openHost, "/w/m.SC2Map", "compile_cutscene", "Not written");
    expect(open).toEqual({
      text: "Not written: the Editor has it open\nOver to the author:\n1. Close the map in the StarCraft II Editor without saving.\n2. Ask for compile_cutscene again.",
      steps: ["Close the map in the StarCraft II Editor without saving.", "Ask for compile_cutscene again."],
    });
    const ctx = contextFor(new McpServer({ name: "test", version: "0.0.0" }));
    expect(ctx.fail(open!.text)).toEqual({ isError: true, content: [{ type: "text", text: open!.text }] });
    expect(ctx.fail(open!.text, { mapPath: "/w/m.SC2Map", automated: [], steps: open!.steps }).structuredContent).toEqual({ mapPath: "/w/m.SC2Map", automated: [], steps: open!.steps });
  });

  it("is no refusal when the host can't tell, or the Editor doesn't have it", async () => {
    expect(await editorHasOpen(bareHost(), "/w/m.SC2Map", "t", "r")).toBeUndefined();
    expect(await editorHasOpen({ ...openHost, run: () => Promise.resolve(undefined) as never }, "/w/m.SC2Map", "t", "r")).toBeUndefined();
  });
});

describe("the workspace input", () => {
  async function connected(server: McpServer) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
    clients.push(client);
    return client;
  }

  it("is given to every tool registered after withWorkspaceInput, with or without inputs of its own", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    withWorkspaceInput(server);
    server.registerTool("with_inputs", { inputSchema: { n: z.number() } }, async ({ n }) => ({ content: [{ type: "text", text: String(n) }] }));
    server.registerTool("no_inputs", {}, async () => ({ content: [{ type: "text", text: "ok" }] }));
    const { tools } = await (await connected(server)).listTools();
    for (const tool of tools) expect(Object.keys(tool.inputSchema.properties ?? {})).toContain("workspace");
  });

  it("refuses a relative folder as a failure reply", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    withWorkspaceInput(server);
    server.registerTool("no_inputs", {}, async () => ({ content: [{ type: "text", text: "ok" }] }));
    const reply = await (await connected(server)).callTool({ name: "no_inputs", arguments: { workspace: "relative/folder" } });
    expect(reply.isError).toBe(true);
    expect(reply.content).toHaveLength(1);
  });

  it("can't be taken after a tool is registered, which would leave that tool without it", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    server.registerTool("early", {}, async () => ({ content: [{ type: "text", text: "ok" }] }));
    expect(() => withWorkspaceInput(server)).toThrow(/before any tool is registered/);
  });

  it("is declared by the server alone: a tool with its own workspace input is refused", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    withWorkspaceInput(server);
    expect(() => server.registerTool("own", { inputSchema: { workspace: z.string() } }, async () => ({ content: [] }))).toThrow(/declares its own workspace input/);
  });
});
