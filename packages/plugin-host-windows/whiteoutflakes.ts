// model.render, model.export and model.rendererKey with the WhiteoutFlakes viewer (this package's
// scripts/build-whiteoutflakes.ps1) on its D3D11 backend, through the plugin SDK's viewer driver
// (core's host/whiteoutflakes.ts), which has the viewer facts it relies on. The viewer comes from
// the machine config's `modelViewerPath`; the workers' copies of it and the GPU or WARP verdict live
// in `cacheDir` (whiteoutflakes-windows.ts). A mod model's textures are copied beside its staged
// copy, since symbolic links need Developer Mode on Windows.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { exportGltfWithViewer, exportWithViewer, type HostContext, renderWithViewer, type ViewerRun, viewerRendererKey } from "@team-antioch/sc2-adjutant/plugin-sdk";

import { cachedVerdict, claimWorker, decideWarp, prepareWorker, removeStaleProbes, TestSetupFailed, viewerEnv } from "./whiteoutflakes-windows.ts";

const run = promisify(execFile);

/** As long as the build script gives the same test: a first run on WARP, on a loaded machine, can be slow. */
const HEADLESS_TIMEOUT_MS = 300_000;
const BACKEND = ["--backend", "d3d11"];

/** The viewer program and its build (the exe's modification time), checked to exist. */
async function viewer(context: HostContext): Promise<{ bin: string; builtMs: number }> {
  const bin = context.requirePath("modelViewerPath");
  if (!existsSync(bin)) throw new Error(`No WhiteoutFlakes viewer at ${bin} (modelViewerPath); build it with packages\\plugin-host-windows\\scripts\\build-whiteoutflakes.ps1`);
  return { bin, builtMs: (await stat(bin)).mtimeMs };
}

const whiteoutflakesDir = (context: HostContext) => path.join(context.requirePath("cacheDir"), "whiteoutflakes");

/** Runs `use` with a copy of the viewer no other worker, in this process or another, is using. */
async function withWorker<T>(context: HostContext, { bin, builtMs }: { bin: string; builtMs: number }, use: (exe: string) => Promise<T>): Promise<T> {
  const { folder, release } = await claimWorker(path.join(whiteoutflakesDir(context), "workers"));
  try {
    return await use(await prepareWorker(bin, builtMs, folder));
  } finally {
    await release();
  }
}

/**
 * Per viewer build, whether it needs WARP: decided by one smoke test per build, shared by concurrent
 * callers. Each test runs in a fresh copy of its own (`probe-<pid>-gpu`, `-warp`), removed after, so
 * the caches a GPU run that lost its device leaves beside the exe reach neither the WARP test nor a
 * worker. A build neither passes on keeps failing for this process without testing again; it isn't
 * kept on disk, so the next process tests again.
 */
const verdicts = new Map<string, Promise<boolean>>();

function needsWarp(context: HostContext, build: { bin: string; builtMs: number }): Promise<boolean> {
  const key = `${build.bin}\n${build.builtMs}`;
  let verdict = verdicts.get(key);
  if (!verdict) {
    verdict = cachedVerdict(path.join(whiteoutflakesDir(context), "backend.json"), key, async () => {
      await removeStaleProbes(whiteoutflakesDir(context));
      return decideWarp(async (warp) => {
        const probe = path.join(whiteoutflakesDir(context), `probe-${process.pid}-${warp ? "warp" : "gpu"}`);
        try {
          // A copy that fails says nothing about the GPU: it fails the probe rather than pick WARP.
          const exe = await rm(probe, { recursive: true, force: true })
            .then(() => prepareWorker(build.bin, build.builtMs, probe))
            .catch((error: unknown) => {
              throw new TestSetupFailed(`couldn't copy the WhiteoutFlakes viewer to test it: ${(error as Error).message}`, { cause: error });
            });
          const { stdout, stderr } = await run(exe, [...BACKEND, "--headless-test"], { timeout: HEADLESS_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env: viewerEnv(warp), cwd: path.dirname(exe), windowsHide: true });
          return `${stdout}\n${stderr}`;
        } finally {
          await rm(probe, { recursive: true, force: true }).catch(() => undefined);
        }
      });
    });
    verdicts.set(key, verdict);
    verdict.catch(() => undefined);
  }
  return verdict;
}

/** Runs `use` with a free worker's viewer, on the GPU or on WARP as its build needs. */
async function withViewer<T>(context: HostContext, use: (viewer: ViewerRun) => Promise<T>): Promise<T> {
  const build = await viewer(context);
  const warp = await needsWarp(context, build);
  return withWorker(context, build, (exe) => use({ bin: exe, env: viewerEnv(warp), args: BACKEND, cwd: path.dirname(exe) }));
}

/** The viewer build (its file's modification time) and the export recipe, hashed: what makes renderModel's output what it is. */
export async function rendererKey({ outputs, size }: { readonly outputs: number; readonly size: number }, context: HostContext): Promise<string> {
  return viewerRendererKey((await viewer(context)).builtMs, outputs, size);
}

export async function renderModel(
  request: { readonly model: string; readonly outputPaths: readonly string[]; readonly size: number; readonly packages?: readonly string[] },
  context: HostContext,
): Promise<void> {
  const workRoot = context.requirePath("cacheDir");
  await withViewer(context, (viewerRun) => renderWithViewer(request, viewerRun, { workRoot, placement: "copy" }));
}

/** --save-m3 opens no device (it exported on this VM's GPU, which can't render), so an export needs no backend or verdict. */
export async function exportModel(request: { readonly model: string; readonly outputPath: string; readonly textures?: boolean }, context: HostContext): Promise<void> {
  const build = await viewer(context);
  await withWorker(context, build, (exe) => exportWithViewer(request, { bin: exe, env: viewerEnv(false), args: [], cwd: path.dirname(exe) }));
}

/** Writes a model, by game path or file path, as a .glb with its textures embedded, for Blender. Draws nothing, so it needs no GPU. */
export async function exportModelGltf(request: { readonly model: string; readonly outputPath: string }, context: HostContext): Promise<void> {
  const build = await viewer(context);
  await withWorker(context, build, (exe) => exportGltfWithViewer(request, { bin: exe, env: viewerEnv(false), args: [], cwd: path.dirname(exe) }));
}
