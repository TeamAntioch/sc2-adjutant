import { mkdir, mkdtemp, realpath, rename, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { packageBuild, sourceDigest, writeBuiltStamp } from "../../src/plugins/built-package.js";

const made: string[] = [];
afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

const minuteAgo = () => new Date(Date.now() - 60_000);

/** A Plugin package built to dist/, its stamp a minute old, inside `under` (a path below the temp folder) when given. */
async function builtPackage(under = "pack") {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), "sc2-adjutant-built-")));
  made.push(base);
  const folder = path.join(base, under);
  await mkdir(path.join(folder, "dist"), { recursive: true });
  await mkdir(path.join(folder, "tests"), { recursive: true });
  await writeFile(path.join(folder, "package.json"), "{}");
  await writeFile(path.join(folder, "index.ts"), "export default {};\n");
  await writeFile(path.join(folder, "dist", "index.js"), "export default {};\n");
  await writeFile(path.join(folder, "dist", ".built"), "");
  for (const file of ["index.ts", "dist/index.js", "dist/.built"]) await utimes(path.join(folder, file), minuteAgo(), minuteAgo());
  return { folder, entry: path.join(folder, "dist", "index.js") };
}

describe("packageBuild", () => {
  it("is built when the stamp is no older than every source", async () => {
    const { folder, entry } = await builtPackage();
    expect(packageBuild(folder, entry)).toEqual({ built: true });
  });

  it("names the source that changed since the last build", async () => {
    const { folder, entry } = await builtPackage();
    await mkdir(path.join(folder, "rules"), { recursive: true });
    await writeFile(path.join(folder, "rules", "lips.ts"), "export {};\n");
    expect(packageBuild(folder, entry)).toEqual({ built: false, reason: "its dist/ is older than its source (rules/lips.ts changed since the last build): build its package (npm run build)" });
  });

  it("counts a source saved since the build even when its emitted file didn't change, since a build rewrites only the stamp", async () => {
    const { folder, entry } = await builtPackage();
    // Seconds apart, and in the past: Windows stamps a write from a clock that ticks every ~15 ms,
    // so a source dated `new Date()` could read as newer than a stamp written just after it.
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);
    await utimes(path.join(folder, "dist", ".built"), ago(20), ago(20));
    await utimes(path.join(folder, "index.ts"), ago(10), ago(10));
    expect(packageBuild(folder, entry).built).toBe(false);
    await writeFile(path.join(folder, "dist", ".built"), "");
    expect(packageBuild(folder, entry)).toEqual({ built: true });
  });

  it("is built when a source is newer than the stamp but its content is what the stamp's digest saw, as after a cached build", async () => {
    const { folder, entry } = await builtPackage();
    writeBuiltStamp(folder);
    const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);
    await utimes(path.join(folder, "dist", ".built"), ago(20), ago(20));
    await utimes(path.join(folder, "index.ts"), ago(10), ago(10));
    expect(packageBuild(folder, entry)).toEqual({ built: true });
  });

  it("is not built when a source newer than the stamp changed since its digest", async () => {
    const { folder, entry } = await builtPackage();
    writeBuiltStamp(folder);
    await utimes(path.join(folder, "dist", ".built"), minuteAgo(), minuteAgo());
    await writeFile(path.join(folder, "index.ts"), "export default { changed: true };\n");
    expect(packageBuild(folder, entry)).toEqual({ built: false, reason: "its dist/ is older than its source (index.ts changed since the last build): build its package (npm run build)" });
  });

  it("digests each source's path and content, so a renamed source differs", async () => {
    const { folder } = await builtPackage();
    const before = sourceDigest(folder);
    await rename(path.join(folder, "index.ts"), path.join(folder, "main.ts"));
    expect(sourceDigest(folder)).not.toBe(before);
  });

  it("ignores tests, declarations, vitest config and dist", async () => {
    const { folder, entry } = await builtPackage();
    await writeFile(path.join(folder, "tests", "pack.test.ts"), "");
    await writeFile(path.join(folder, "vitest.config.ts"), "");
    await writeFile(path.join(folder, "types.d.ts"), "");
    await writeFile(path.join(folder, "dist", "late.ts"), "");
    expect(packageBuild(folder, entry)).toEqual({ built: true });
  });

  it("is not built with no stamp", async () => {
    const { folder, entry } = await builtPackage();
    await rm(path.join(folder, "dist", ".built"));
    expect(packageBuild(folder, entry).built).toBe(false);
  });

  it("checks only the entry's presence under node_modules, as in an npm install", async () => {
    const { folder, entry } = await builtPackage("node_modules/@scope/pack");
    await writeFile(path.join(folder, "index.ts"), "export default {};\n");
    expect(packageBuild(folder, entry)).toEqual({ built: true });
  });

  it("says a missing entry isn't there", async () => {
    const { folder } = await builtPackage();
    expect(packageBuild(folder, path.join(folder, "dist", "rules.js"))).toEqual({ built: false, reason: "its entry point dist/rules.js isn't there: build its package first (npm run build)" });
  });

  it("leaves an entry outside dist/ (a local Plugin's TypeScript) alone", async () => {
    const { folder } = await builtPackage();
    await writeFile(path.join(folder, "index.ts"), "export default {};\n");
    expect(packageBuild(folder, path.join(folder, "index.ts"))).toEqual({ built: true });
  });
});
