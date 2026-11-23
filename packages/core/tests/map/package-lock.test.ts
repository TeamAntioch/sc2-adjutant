// The cross-process lock on a Map Package's writes (src/map/package-lock.ts): one writer at a time
// across sessions, a dead owner's lock taken over, and the lock freed when the task fails.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lockFileFor, withPackageLock } from "../../src/map/package-lock.js";

let root: string;
let pack: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-lock-"));
  pack = path.join(root, "Harbour.SC2Map");
  await mkdir(pack);
});
afterEach(() => rm(root, { recursive: true, force: true }));

const options = { waitMs: 400, pollMs: 10 };

/** A pid that is not running: a child that has exited. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", ""]);
  await new Promise((resolve) => child.on("exit", resolve));
  return child.pid!;
}

async function plant(owner: object): Promise<string> {
  const lock = await lockFileFor(pack);
  await mkdir(path.dirname(lock), { recursive: true });
  await writeFile(lock, typeof owner === "string" ? owner : JSON.stringify(owner));
  return lock;
}

describe("withPackageLock", () => {
  it("runs the task and frees the lock", async () => {
    expect(await withPackageLock(pack, async () => 7, options)).toBe(7);
    await expect(readFile(await lockFileFor(pack))).rejects.toThrow(/ENOENT/);
  });

  it("frees the lock when the task throws", async () => {
    await expect(withPackageLock(pack, () => Promise.reject(new Error("boom")), options)).rejects.toThrow("boom");
    await expect(readFile(await lockFileFor(pack))).rejects.toThrow(/ENOENT/);
    expect(await withPackageLock(pack, async () => "again", options)).toBe("again");
  });

  it("is re-entrant within one process", async () => {
    expect(await withPackageLock(pack, () => withPackageLock(pack, async () => "inner", options), options)).toBe("inner");
  });

  it("refuses with the owner's pid and time when another live process holds it", async () => {
    // pid 1 is always alive and isn't ours.
    const lock = await plant({ pid: 1, startedAt: new Date().toISOString(), token: "other" });
    await expect(withPackageLock(pack, async () => "no", options)).rejects.toThrow(/Harbour\.SC2Map is being written by process 1 since \d{4}-/);
    // The other owner's lock is left alone.
    expect(JSON.parse(await readFile(lock, "utf8")).token).toBe("other");
  });

  it("takes over the lock of a process that has died", async () => {
    await plant({ pid: await deadPid(), startedAt: new Date().toISOString(), token: "dead" });
    expect(await withPackageLock(pack, async () => "taken", options)).toBe("taken");
  });

  it("takes over a lock older than the stale age, and a torn one", async () => {
    await plant({ pid: 1, startedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(), token: "old" });
    expect(await withPackageLock(pack, async () => "old taken", { ...options, staleMs: 3_600_000 })).toBe("old taken");
    await plant("{ half a wri");
    expect(await withPackageLock(pack, async () => "torn taken", { ...options, tornMs: 0 })).toBe("torn taken");
  });

  it("waits for a lock that is freed in time", async () => {
    const lock = await plant({ pid: 1, startedAt: new Date().toISOString(), token: "other" });
    setTimeout(() => void rm(lock), 80);
    expect(await withPackageLock(pack, async () => "got it", { waitMs: 2000, pollMs: 10 })).toBe("got it");
  });

  it("keeps two processes from running one package's tasks at once", async () => {
    const log = path.join(root, "log");
    const script = path.join(root, "worker.mjs");
    const lockModule = new URL("../../src/map/package-lock.ts", import.meta.url).href;
    await writeFile(
      script,
      `import { appendFile } from "node:fs/promises";
import { withPackageLock } from ${JSON.stringify(lockModule)};
const [pack, log, name] = process.argv.slice(2);
await withPackageLock(pack, async () => {
  await appendFile(log, "start " + name + "\\n");
  await new Promise((r) => setTimeout(r, 150));
  await appendFile(log, "end " + name + "\\n");
}, { waitMs: 10000, pollMs: 10 });
`,
    );
    const run = (name: string) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [script, pack, log, name], { stdio: "inherit" });
        child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${name} exited ${code}`))));
      });
    await Promise.all([run("a"), run("b")]);
    const lines = (await readFile(log, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]!.replace("start", "end")).toBe(lines[1]);
    expect(lines[2]!.replace("start", "end")).toBe(lines[3]);
  });
});
