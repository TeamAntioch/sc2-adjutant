// How the Windows Host Adapter runs WhiteoutFlakes, short of the viewer itself: whether a viewer
// build renders on the GPU or needs WARP (decided once per build), and the copies of the viewer's
// folder each concurrent worker runs from (the viewer keeps its caches beside its exe).
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cachedVerdict, claimWorker, decideWarp, headlessPassed, prepareWorker, removeStaleProbes, TestSetupFailed, viewerEnv } from "../whiteoutflakes-windows.ts";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function tempFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-wf-"));
  folders.push(folder);
  return folder;
}

async function put(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

const PASS = "[headless] backend=d3d11\n[headless] readback OK 256x256 mean RGB=(118,92,77)\n[headless] PASS\n";
const FAIL = "[headless] backend=d3d11\n[d3d11] device removed\n[headless] FAIL: init\n";

describe("the viewer's smoke test", () => {
  it("passes only on its PASS line", () => {
    expect(headlessPassed(PASS)).toBe(true);
    expect(headlessPassed(PASS.replace(/\n/g, "\r\n"))).toBe(true);
    expect(headlessPassed(FAIL)).toBe(false);
    expect(headlessPassed("")).toBe(false);
  });

  it("keeps the GPU when it passes there, without trying WARP", async () => {
    const tried: boolean[] = [];
    expect(await decideWarp(async (warp) => (tried.push(warp), PASS))).toBe(false);
    expect(tried).toEqual([false]);
  });

  it("takes WARP when the GPU fails and WARP passes", async () => {
    const tried: boolean[] = [];
    expect(await decideWarp(async (warp) => (tried.push(warp), warp ? PASS : FAIL))).toBe(true);
    expect(tried).toEqual([false, true]);
  });

  it("counts a test the viewer crashed or hung in as failed", async () => {
    expect(await decideWarp(async (warp) => {
      if (!warp) throw new Error("timed out");
      return PASS;
    })).toBe(true);
  });

  it("says what both runs printed when neither passes", async () => {
    await expect(decideWarp(async () => {
      throw new TestSetupFailed("couldn't copy");
    })).rejects.toThrow("couldn't copy");
    await expect(decideWarp(async (warp) => (warp ? "[headless] FAIL: warp\n" : FAIL))).rejects.toThrow(
      /fails --headless-test on the GPU \(\[headless\] FAIL: init\) and on WARP \(\[headless\] FAIL: warp\)/,
    );
  });
});

describe("the cached verdict", () => {
  it("is decided once per viewer build and kept on disk", async () => {
    const file = path.join(await tempFolder(), "whiteoutflakes", "backend.json");
    let decided = 0;
    const decide = async () => (decided++, true);
    expect(await cachedVerdict(file, "C:\\wf\\WhiteoutFlakes.exe\n1000", decide)).toBe(true);
    expect(await cachedVerdict(file, "C:\\wf\\WhiteoutFlakes.exe\n1000", decide)).toBe(true);
    expect(decided).toBe(1);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ build: "C:\\wf\\WhiteoutFlakes.exe\n1000", warp: true });
  });

  it("is decided again for another build", async () => {
    const file = path.join(await tempFolder(), "backend.json");
    await cachedVerdict(file, "old", async () => true);
    expect(await cachedVerdict(file, "new", async () => false)).toBe(false);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ build: "new", warp: false });
  });

  it("isn't kept when it can't be decided, or read from a file that's not one", async () => {
    const file = path.join(await tempFolder(), "backend.json");
    await expect(cachedVerdict(file, "a", async () => Promise.reject(new Error("no backend")))).rejects.toThrow("no backend");
    await writeFile(file, "not json");
    expect(await cachedVerdict(file, "a", async () => false)).toBe(false);
  });
});

describe("the viewer's environment", () => {
  it("sets the WARP switch only for WARP, whatever the caller's environment had", () => {
    expect(viewerEnv(true, { PATH: "x" })).toEqual({ PATH: "x", WF_D3D11_WARP: "1" });
    expect(viewerEnv(false, { PATH: "x", WF_D3D11_WARP: "1" })).toEqual({ PATH: "x" });
  });
});

describe("a worker's copy of the viewer", () => {
  async function viewerFolder(): Promise<{ viewer: string; exe: string }> {
    const viewer = path.join(await tempFolder(), "stage");
    const exe = path.join(viewer, "WhiteoutFlakes.exe");
    await put(exe, "exe 1");
    await put(path.join(viewer, "shaders", "d3d11", "vs.bls"), "vs");
    await put(path.join(viewer, "lang", "en.ini"), "en");
    return { viewer, exe };
  }

  it("is the viewer's whole folder, copied into the worker's", async () => {
    const { exe } = await viewerFolder();
    const worker = path.join(await tempFolder(), "workers", "0");
    const copy = await prepareWorker(exe, 1000, worker);
    expect(copy).toBe(path.join(worker, "WhiteoutFlakes.exe"));
    expect(await readFile(copy, "utf8")).toBe("exe 1");
    expect(await readFile(path.join(worker, "shaders", "d3d11", "vs.bls"), "utf8")).toBe("vs");
    expect(await readFile(path.join(worker, "lang", "en.ini"), "utf8")).toBe("en");
  });

  it("keeps the caches the viewer wrote beside its copy while the build is the same", async () => {
    const { exe } = await viewerFolder();
    const worker = path.join(await tempFolder(), "worker");
    await prepareWorker(exe, 1000, worker);
    await writeFile(path.join(worker, "pso_trace.bin"), "warm");
    await prepareWorker(exe, 1000, worker);
    expect(await readFile(path.join(worker, "pso_trace.bin"), "utf8")).toBe("warm");
  });

  it("is copied afresh for a new build, dropping the old build's caches", async () => {
    const { viewer, exe } = await viewerFolder();
    const worker = path.join(await tempFolder(), "worker");
    await prepareWorker(exe, 1000, worker);
    await writeFile(path.join(worker, "pso_trace.bin"), "stale");
    await writeFile(exe, "exe 2");
    await prepareWorker(exe, 2000, worker);
    expect(await readFile(path.join(worker, "WhiteoutFlakes.exe"), "utf8")).toBe("exe 2");
    expect((await readdir(worker)).sort()).toEqual((await readdir(viewer)).concat(".viewer-build").sort());
  });
});

describe("claiming a worker's folder", () => {
  it("gives each worker a folder no other holds, in this process or another, and frees it on release", async () => {
    const dir = path.join(await tempFolder(), "workers");
    const first = await claimWorker(dir);
    const second = await claimWorker(dir);
    expect([first.folder, second.folder]).toEqual([path.join(dir, "0"), path.join(dir, "1")]);
    expect(await readFile(path.join(dir, "0.lock"), "utf8")).toMatch(new RegExp(`^${process.pid} `));
    await first.release();
    expect((await claimWorker(dir)).folder).toBe(path.join(dir, "0"));
  });

  it("releases only a lock that is still its own", async () => {
    const dir = path.join(await tempFolder(), "workers");
    const claimed = await claimWorker(dir);
    // Taken over meanwhile, as if this process had been thought gone.
    await writeFile(path.join(dir, "0.lock"), "4242 other");
    await claimed.release();
    expect(await readFile(path.join(dir, "0.lock"), "utf8")).toBe("4242 other");
  });

  it("takes over a lock with no pid only once it's too old to be one being written", async () => {
    const dir = path.join(await tempFolder(), "workers");
    await put(path.join(dir, "0.lock"), "");
    expect((await claimWorker(dir)).folder).toBe(path.join(dir, "1"));
    const old = new Date(Date.now() - 60_000);
    await utimes(path.join(dir, "0.lock"), old, old);
    expect((await claimWorker(dir)).folder).toBe(path.join(dir, "0"));
    // Nothing is left aside from the takeover.
    expect((await readdir(dir)).sort()).toEqual(["0.lock", "1.lock"]);
  });

  it("skips a folder another running process holds, and takes over one whose process has gone", async () => {
    const dir = path.join(await tempFolder(), "workers");
    await put(path.join(dir, "0.lock"), "4242");
    await put(path.join(dir, "1.lock"), "4343");
    const claimed = await claimWorker(dir, (pid) => pid === 4242);
    expect(claimed.folder).toBe(path.join(dir, "1"));
    expect(await readFile(path.join(dir, "1.lock"), "utf8")).toMatch(new RegExp(`^${process.pid} `));
    expect(await readFile(path.join(dir, "0.lock"), "utf8")).toBe("4242");
  });
});

describe("the WARP probe's leftovers", () => {
  it("removes probe folders whose process has gone, and no others", async () => {
    const dir = await tempFolder();
    for (const name of ["probe-4242-gpu", "probe-4343-warp", `probe-${process.pid}-gpu`, "workers", "probe-notes"]) await mkdir(path.join(dir, name));
    await removeStaleProbes(dir, (pid) => pid === 4242);
    expect((await readdir(dir)).sort()).toEqual(["probe-4242-gpu", `probe-${process.pid}-gpu`, "probe-notes", "workers"].sort());
  });
});
