// model.render and model.export with the WhiteoutFlakes viewer (this package's scripts/build-whiteoutflakes.sh)
// on its Vulkan backend, through the plugin SDK's viewer driver (core's host/whiteoutflakes.ts),
// which has the viewer facts it relies on. The viewer comes from the machine config's
// `modelViewerPath`, and its per-process homes live in `cacheDir`.
//
// The viewer keeps its Vulkan pipeline cache and PSO trace in ~/Library/Caches/WhiteoutFlakes.
// Processes sharing them corrupt them and draw magenta, so each concurrent run gets its own HOME,
// kept between runs so the caches stay warm. A mod model's textures are linked beside its copy.

import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import { exportGltfWithViewer, exportWithViewer, type HostContext, renderWithViewer, type ViewerRun, viewerRendererKey, WorkerPool } from "@team-antioch/sc2-adjutant/plugin-sdk";

/** The viewer program, checked to exist. */
function viewer(context: HostContext): string {
  const bin = context.requirePath("modelViewerPath");
  if (!existsSync(bin)) throw new Error(`No WhiteoutFlakes viewer at ${bin} (modelViewerPath); build it with packages/plugin-host-macos/scripts/build-whiteoutflakes.sh`);
  return bin;
}

/** Numbered viewer homes not in use, so concurrent renders never share one. */
const homes = new WorkerPool();

function withHome<T>(context: HostContext, use: (home: string) => Promise<T>): Promise<T> {
  return homes.use(async (index) => {
    const home = path.join(context.requirePath("cacheDir"), "whiteoutflakes", "worker-homes", String(index));
    await mkdir(home, { recursive: true });
    return use(home);
  });
}

const run = (bin: string, home: string, args: readonly string[]): ViewerRun => ({ bin, env: { ...process.env, HOME: home }, args });

/** The viewer build (its file's modification time) and the export recipe, hashed: what makes renderModel's output what it is. */
export async function rendererKey({ outputs, size }: { readonly outputs: number; readonly size: number }, context: HostContext): Promise<string> {
  return viewerRendererKey((await stat(viewer(context))).mtimeMs, outputs, size);
}

export async function renderModel(
  request: { readonly model: string; readonly outputPaths: readonly string[]; readonly size: number; readonly packages?: readonly string[] },
  context: HostContext,
): Promise<void> {
  const bin = viewer(context);
  await withHome(context, (home) =>
    renderWithViewer(request, run(bin, home, ["--backend", "vulkan"]), { workRoot: context.requirePath("cacheDir"), placement: "link" }),
  );
}

export async function exportModel(request: { readonly model: string; readonly outputPath: string; readonly textures?: boolean }, context: HostContext): Promise<void> {
  const bin = viewer(context);
  await withHome(context, (home) => exportWithViewer(request, run(bin, home, [])));
}

/** Writes a model, by game path or file path, as a .glb with its textures embedded: how Blender reads a model with its pictures. */
export async function exportModelGltf(request: { readonly model: string; readonly outputPath: string }, context: HostContext): Promise<void> {
  const bin = viewer(context);
  await withHome(context, (home) => exportGltfWithViewer(request, run(bin, home, [])));
}
