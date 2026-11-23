// The server following the client's working folder (follow-roots.ts): a session that moves into a
// git worktree serves that worktree's Workspace, with the Workspace it started with otherwise.
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { explicitWorkspaceRoot, findWorkspaceRoot, followRoots } from "../../src/mcp/follow-roots.js";
import { connect, fixture, tempFolder, text } from "./harness.js";

/** A main checkout of the field Workspace, a worktree of it that also holds a Mission `wt-only`, and a folder in no Workspace. */
async function checkouts() {
  const parent = await tempFolder();
  const [main, worktree, elsewhere] = ["main", "worktree", "elsewhere"].map((name) => path.join(parent, name));
  await cp(fixture("field"), main!, { recursive: true });
  await cp(fixture("field"), worktree!, { recursive: true });
  await cp(path.join(worktree!, "missions", "lava-field"), path.join(worktree!, "missions", "wt-only"), { recursive: true });
  await mkdir(elsewhere!);
  return { main: main!, worktree: worktree!, elsewhere: elsewhere! };
}

const blueprint = (client: Awaited<ReturnType<typeof connect>>, mission: string) => client.callTool({ name: "get_blueprint", arguments: { mission, pointer: "/id" } });

describe("findWorkspaceRoot", () => {
  it("is the nearest folder at or above the start with a Workspace config", async () => {
    const { main, elsewhere } = await checkouts();
    expect(findWorkspaceRoot(main)).toBe(main);
    expect(findWorkspaceRoot(path.join(main, "missions", "lava-field"))).toBe(main);
    expect(findWorkspaceRoot(elsewhere)).toBeUndefined();
  });
});

describe("a server following roots", () => {
  it("serves the Workspace at the client's first root, and moves with it between calls", async () => {
    const { main, worktree } = await checkouts();
    let roots = [main];
    const client = await connect(main, { followRoots: true, roots: () => roots });

    expect((await blueprint(client, "wt-only")).isError).toBe(true);
    roots = [worktree];
    const reply = await blueprint(client, "wt-only");
    expect(reply.isError).toBeFalsy();
    roots = [main];
    expect((await blueprint(client, "wt-only")).isError).toBe(true);
    expect((await blueprint(client, "lava-field")).isError).toBeFalsy();
  });

  it("finds the Workspace above a root inside it, and ignores the roots after the first", async () => {
    const { main, worktree, elsewhere } = await checkouts();
    const client = await connect(main, { followRoots: true, roots: () => [path.join(worktree, "missions", "lava-field"), main, elsewhere] });
    expect((await blueprint(client, "wt-only")).isError).toBeFalsy();
  });

  it("serves the Workspace it started with when no root has a Workspace above it", async () => {
    const { main, elsewhere } = await checkouts();
    const client = await connect(main, { followRoots: true, roots: () => [elsewhere] });
    expect((await blueprint(client, "lava-field")).isError).toBeFalsy();
    expect(text(await client.callTool({ name: "check_workspace", arguments: {} }))).toContain(main);
  });

  it("serves the Workspace it started with for a client with no roots, or listing none", async () => {
    const { main } = await checkouts();
    expect((await blueprint(await connect(main, { followRoots: true }), "lava-field")).isError).toBeFalsy();
    expect((await blueprint(await connect(main, { followRoots: true, roots: () => [] }), "lava-field")).isError).toBeFalsy();
  });

  it("keeps the Workspace of the last call when the client fails to answer", async () => {
    const { main, worktree } = await checkouts();
    let fail = false;
    let roots = [worktree];
    const client = await connect(main, {
      followRoots: true,
      roots: () => {
        if (fail) throw new Error("no roots");
        return roots;
      },
    });
    expect((await blueprint(client, "wt-only")).isError).toBeFalsy();
    fail = true;
    expect((await blueprint(client, "wt-only")).isError).toBeFalsy();
    roots = [main];
    fail = false;
    expect((await blueprint(client, "wt-only")).isError).toBe(true);
  });

  it("writes into the Workspace the roots name", async () => {
    const { main, worktree } = await checkouts();
    const client = await connect(main, { followRoots: true, roots: () => [worktree] });
    const reply = await client.callTool({ name: "patch_blueprint", arguments: { mission: "wt-only", patch: [{ op: "replace", path: "/title", value: "Edited" }] } });
    expect(reply.isError).toBeFalsy();
    expect(text(reply)).toContain(path.join(worktree, "missions", "wt-only"));
  });

  it("lists the Plugin knowledge of the Workspace it serves now", async () => {
    const { main, worktree } = await checkouts();
    // The worktree's branch has no Style Pack, so it has no knowledge documents.
    const config = path.join(worktree, "sc2-adjutant.workspace.json");
    const { campaignPack, stylePack, ...rest } = JSON.parse(await readFile(config, "utf8"));
    await writeFile(config, JSON.stringify(rest));
    let roots = [main];
    const client = await connect(main, { followRoots: true, roots: () => roots });
    expect((await client.listResources()).resources.length).toBeGreaterThan(0);
    roots = [worktree];
    expect((await client.listResources()).resources).toEqual([]);
    roots = [main];
    expect((await client.listResources()).resources.length).toBeGreaterThan(0);
  });
});

describe("a tool's workspace input", () => {
  const blueprintIn = (client: Awaited<ReturnType<typeof connect>>, workspace: string | undefined, mission = "wt-only") =>
    client.callTool({ name: "get_blueprint", arguments: { mission, pointer: "/id", ...(workspace ? { workspace } : {}) } });

  it("is the Workspace at or above the folder, and fails naming a folder with none", async () => {
    const { worktree, elsewhere } = await checkouts();
    expect(explicitWorkspaceRoot(path.join(worktree, "missions", "wt-only"))).toBe(worktree);
    expect(() => explicitWorkspaceRoot(elsewhere)).toThrow(elsewhere);
  });

  it("is on every tool, optional", async () => {
    const { main } = await checkouts();
    const { tools } = await connect(main).then((client) => client.listTools());
    expect(tools.length).toBeGreaterThan(20);
    for (const tool of tools) {
      expect(tool.inputSchema.properties, tool.name).toHaveProperty("workspace");
      expect(tool.inputSchema.required ?? [], tool.name).not.toContain("workspace");
    }
  });

  it("serves a worktree the session hasn't moved its roots into, over a server that started in main", async () => {
    const { main, worktree } = await checkouts();
    for (const client of [await connect(main), await connect(main, { followRoots: true, roots: () => [main] })]) {
      expect((await blueprintIn(client, undefined)).isError).toBe(true);
      expect((await blueprintIn(client, worktree)).isError).toBeFalsy();
      expect((await blueprintIn(client, path.join(worktree, "missions", "wt-only"))).isError).toBeFalsy();
      // For that call alone.
      expect((await blueprintIn(client, undefined)).isError).toBe(true);
    }
  });

  it("serves the main checkout over roots that name a worktree", async () => {
    const { main, worktree } = await checkouts();
    const client = await connect(main, { followRoots: true, roots: () => [worktree] });
    expect((await blueprintIn(client, main, "lava-field")).isError).toBeFalsy();
    expect((await blueprintIn(client, main, "wt-only")).isError).toBe(true);
  });

  it("writes into the worktree it names, not the main checkout", async () => {
    const { main, worktree } = await checkouts();
    const client = await connect(main);
    const reply = await client.callTool({ name: "patch_blueprint", arguments: { workspace: worktree, mission: "wt-only", patch: [{ op: "replace", path: "/title", value: "Edited" }] } });
    expect(reply.isError).toBeFalsy();
    expect(text(reply)).toContain(path.join(worktree, "missions", "wt-only"));
    expect(JSON.parse(await readFile(path.join(worktree, "missions", "wt-only", "blueprint.json"), "utf8")).title).toBe("Edited");
  });

  it("reaches a tool that takes no other input", async () => {
    const { main, worktree } = await checkouts();
    expect(text(await (await connect(main)).callTool({ name: "check_workspace", arguments: { workspace: worktree } }))).toContain(worktree);
  });

  it("refuses a relative folder, which would resolve against the server's own", async () => {
    const { main } = await checkouts();
    const reply = await blueprintIn(await connect(main), "../worktree");
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain("absolute");
  });

  it("fails the call, naming the folder, when no Workspace is at or above it", async () => {
    const { main, elsewhere } = await checkouts();
    const reply = await blueprintIn(await connect(main), elsewhere, "lava-field");
    expect(reply.isError).toBe(true);
    expect(text(reply)).toContain(elsewhere);
  });
});

describe("a server not following roots", () => {
  it("serves the Workspace it was given whatever the client's roots", async () => {
    const { main, worktree } = await checkouts();
    const client = await connect(main, { roots: () => [worktree] });
    expect((await blueprint(client, "wt-only")).isError).toBe(true);
  });
});

describe("followRoots", () => {
  const serverWith = (roots: () => string[] | undefined) =>
    ({ getClientCapabilities: () => (roots() ? { roots: {} } : {}), listRoots: async () => ({ roots: (roots() ?? []).map((folder) => ({ uri: pathToFileURL(folder).href })) }) }) as unknown as Server;

  it("reports each change of Workspace once, and not the Workspace it started with", async () => {
    const { main, worktree, elsewhere } = await checkouts();
    let roots: string[] = [main];
    const changes: string[] = [];
    const current = followRoots(serverWith(() => roots), main, { onChange: (root) => changes.push(root) });
    await current();
    roots = [worktree];
    await current();
    await current();
    roots = [elsewhere];
    expect(await current()).toBe(main);
    expect(changes).toEqual([worktree, main]);
  });
});
