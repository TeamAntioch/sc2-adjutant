import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { loadPlugins, localPluginFolder } from "../../src/plugins/registry.js";

const made: string[] = [];
afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A main checkout with a sibling Plugin folder, and a linked worktree two folders deeper, as git lays them out. */
async function layout() {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "sc2-adjutant-worktree-")));
  made.push(base);
  const main = path.join(base, "campaign");
  const worktree = path.join(base, "campaign-worktrees", "branch");
  const gitdir = path.join(main, ".git", "worktrees", "branch");
  await mkdir(gitdir, { recursive: true });
  await mkdir(worktree, { recursive: true });
  await mkdir(path.join(base, "plugins", "pack"), { recursive: true });
  await writeFile(path.join(worktree, ".git"), `gitdir: ${gitdir}\n`);
  await writeFile(path.join(gitdir, "commondir"), "../..\n");
  return { base, main, worktree };
}

describe("localPluginFolder", () => {
  it("resolves a relative source against the Workspace root when it is there", async () => {
    const { base, main } = await layout();
    expect(localPluginFolder(main, "../plugins/pack")).toBe(path.join(base, "plugins", "pack"));
  });

  it("resolves it from the main working tree when a linked worktree sits elsewhere", async () => {
    const { base, worktree } = await layout();
    expect(localPluginFolder(worktree, "../plugins/pack")).toBe(path.join(base, "plugins", "pack"));
  });

  it("prefers the worktree's own copy when it has one", async () => {
    const { worktree } = await layout();
    await mkdir(path.join(worktree, "plugins", "pack"), { recursive: true });
    expect(localPluginFolder(worktree, "./plugins/pack")).toBe(path.join(worktree, "plugins", "pack"));
  });

  it("leaves a missing source at the Workspace root for the loader to report", async () => {
    const { worktree } = await layout();
    expect(localPluginFolder(worktree, "../plugins/missing")).toBe(path.resolve(worktree, "../plugins/missing"));
  });
});

describe("a Plugin folder whose entry isn't built", () => {
  it("says the entry isn't there and to build the package", async () => {
    const root = await realpath(await mkdtemp(path.join(tmpdir(), "sc2-adjutant-unbuilt-")));
    made.push(root);
    const folder = path.join(root, "plugins", "pack");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "package.json"), JSON.stringify({ name: "pack", type: "module" }));
    await writeFile(path.join(folder, "sc2-adjutant-plugin.json"), JSON.stringify({ name: "pack", version: "0.1.0", pluginApi: 2, roles: [], entry: "./dist/index.js" }));
    await expect(loadPlugins(root, [{ source: "./plugins/pack" }])).rejects.toThrow("Plugin pack (./plugins/pack): its entry point dist/index.js isn't there: build its package first (npm run build)");
  });
});
