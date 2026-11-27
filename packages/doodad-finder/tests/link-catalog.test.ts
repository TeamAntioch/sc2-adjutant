// `pnpm run link-catalog` / `unlink-catalog` (scripts/link-catalog.mjs): sc2-adjutant runs against a
// sibling sc2-asset-catalog checkout for cross-repo work, then goes back to the published pin,
// with package.json and pnpm-lock.yaml never touched. Run here on a fake repo and sibling.
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../../scripts/link-catalog.mjs", import.meta.url));
const run = promisify(execFile);
const PACKAGES = ["sc2-asset-catalog", "sc2-finder-kit", "sc2-doodad-finder", "sc2-set-finder"];

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const put = async (file: string, text: string) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
};

/** A repo with the published packages installed, and a sibling checkout beside it. */
async function layout() {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "link-catalog-")));
  const repo = path.join(dir, "sc2-adjutant");
  const sibling = path.join(dir, "sc2-asset-catalog");
  await put(path.join(repo, "package.json"), '{ "name": "sc2-adjutant-monorepo" }\n');
  await put(path.join(repo, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await put(path.join(repo, "packages/core/package.json"), JSON.stringify({ dependencies: { "@team-antioch/sc2-asset-catalog": "0.1.1" } }));
  await put(path.join(repo, "packages/doodad-finder/package.json"), JSON.stringify({ dependencies: { "@team-antioch/sc2-asset-catalog": "0.1.1", "@team-antioch/sc2-doodad-finder": "0.1.1" } }));
  await put(path.join(repo, "packages/set-finder/package.json"), JSON.stringify({ dependencies: { "@team-antioch/sc2-finder-kit": "0.1.1", "@team-antioch/sc2-set-finder": "0.1.1" } }));
  for (const name of PACKAGES) {
    await put(path.join(repo, "node_modules/@team-antioch", name, "package.json"), JSON.stringify({ name: `@team-antioch/${name}`, version: "0.1.1" }));
    await put(path.join(repo, "node_modules/@team-antioch", name, "dist/index.js"), "// published\n");
    await put(path.join(sibling, "packages", name, "package.json"), JSON.stringify({ name: `@team-antioch/${name}`, version: "0.2.0" }));
  }
  await mkdir(path.join(sibling, "node_modules"), { recursive: true });
  return { repo, sibling };
}

const script = (repo: string, ...args: string[]) => run(process.execPath, [SCRIPT, ...args, "--root", repo, "--no-build"]);

describe("link-catalog", () => {
  it("links every package to the sibling checkout, and unlink puts the published ones back, leaving package.json and the lockfile as they were", async () => {
    const { repo, sibling } = await layout();
    const before = await Promise.all(["package.json", "pnpm-lock.yaml"].map((file) => readFile(path.join(repo, file), "utf8")));

    const linked = await script(repo, "link");
    expect(linked.stdout).toMatch(/@team-antioch\/sc2-asset-catalog 0\.2\.0 linked from .*sc2-asset-catalog.*pinned 0\.1\.1/);
    for (const name of PACKAGES) {
      const at = path.join(repo, "node_modules/@team-antioch", name);
      expect((await lstat(at)).isSymbolicLink()).toBe(true);
      expect(await realpath(at)).toBe(path.join(sibling, "packages", name));
    }
    // Linking again is harmless: the published copies kept aside aren't lost.
    await script(repo, "link");
    expect((await script(repo, "status")).stdout).toMatch(/sc2-doodad-finder: linked/);

    await script(repo, "unlink");
    for (const name of PACKAGES) {
      const at = path.join(repo, "node_modules/@team-antioch", name);
      expect((await lstat(at)).isDirectory()).toBe(true);
      expect(await readFile(path.join(at, "dist/index.js"), "utf8")).toBe("// published\n");
    }
    expect(await Promise.all(["package.json", "pnpm-lock.yaml"].map((file) => readFile(path.join(repo, file), "utf8")))).toEqual(before);
    expect((await script(repo, "status")).stdout).toMatch(/sc2-asset-catalog: published 0\.1\.1/);
  });

  it("refuses a sibling that isn't an sc2-asset-catalog checkout, and changes nothing", async () => {
    const { repo, sibling } = await layout();
    await rm(path.join(sibling, "packages/sc2-doodad-finder"), { recursive: true });
    await expect(script(repo, "link")).rejects.toThrow(/isn't an sc2-asset-catalog checkout/);
    expect((await lstat(path.join(repo, "node_modules/@team-antioch/sc2-asset-catalog"))).isSymbolicLink()).toBe(false);
  });

  it("takes a .git file with no commondir (a submodule's) for a checkout of its own, and links its own sibling", async () => {
    const { repo, sibling } = await layout();
    await put(path.join(dir!, "modules", "sc2-adjutant", "HEAD"), "ref: refs/heads/main\n");
    await put(path.join(repo, ".git"), `gitdir: ${path.join(dir!, "modules", "sc2-adjutant")}\n`);
    await script(repo, "link");
    expect(await realpath(path.join(repo, "node_modules/@team-antioch/sc2-asset-catalog"))).toBe(path.join(sibling, "packages/sc2-asset-catalog"));
  });

  it("links from a linked worktree to the sibling of its main checkout", async () => {
    const { repo, sibling } = await layout();
    // The worktree lives elsewhere; its .git file points into the main checkout's .git.
    const worktree = path.join(dir!, "worktrees", "branch");
    const gitdir = path.join(repo, ".git", "worktrees", "branch");
    await put(path.join(gitdir, "commondir"), "../..\n");
    await put(path.join(worktree, ".git"), `gitdir: ${gitdir}\n`);
    await put(path.join(worktree, "package.json"), "{}\n");
    for (const name of PACKAGES) await put(path.join(worktree, "node_modules/@team-antioch", name, "package.json"), JSON.stringify({ name: `@team-antioch/${name}`, version: "0.1.1" }));
    await script(worktree, "link");
    expect(path.resolve(path.dirname(path.join(worktree, "node_modules/@team-antioch/x")), await readlink(path.join(worktree, "node_modules/@team-antioch/sc2-asset-catalog")))).toBe(
      path.join(sibling, "packages/sc2-asset-catalog"),
    );
  });
});
