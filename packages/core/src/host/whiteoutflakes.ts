// model.render and model.export with the WhiteoutFlakes viewer, shared by the Host Adapters that
// run it (macOS on Vulkan, Windows on D3D11). The viewer reads models straight from the game's
// CASC storage. Each adapter says how to run it (ViewerRun): the program, its environment and the
// arguments that pick its backend, with a worker's own caches, since processes sharing them corrupt
// them (on macOS they live under HOME, on Windows beside the exe).
//
// Viewer facts it relies on (docs/reference/related-repos.md has the rest):
// - A frame can come out garbled, and the background white, black or unkeyed, at random; a model is
//   rendered again (up to RENDER_ATTEMPTS times) while some angle has no clean white frame.
// - It exits normally whatever happened; a missing model is told by its log.
// - Given a model by its file path, it reads a texture the model names (`Assets/Textures/x.dds`)
//   from that path under the model's folder, else from the game (its src/io/file_resolver.cpp); it
//   never looks in a mod package. So a model from a Workspace mod is staged: copied into the work
//   folder beside the textures it names, from the packages (stageModel).

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { readM3TexturePaths } from "../catalog/m3-textures.js";
import { findPackageFile } from "../catalog/package-files.js";
import { readPng, type RgbaImage } from "../preview/read-png.js";
import { writeRgbaPng } from "../preview/write-png.js";
import { modelNotFound } from "../plugins/plugin-api.js";
import { angleFrames, frameBackground, keyBackground, magentaShare, thumbnailRecipe, type FrameBackground } from "./whiteoutflakes-frames.js";

const run = promisify(execFile);

const RENDER_TIMEOUT_MS = 120_000;
const EXPORT_TIMEOUT_MS = 180_000;
// A frame with more than this share of its visible pixels magenta is garbled (see magentaShare).
const MAX_MAGENTA_SHARE = 0.0005;
const RENDER_ATTEMPTS = 3;
const BACKGROUND_RANK: Record<Exclude<FrameBackground, "unkeyed">, number> = { white: 2, black: 1, mixed: 0 };
type KeyableFrame = { image: RgbaImage; background: Exclude<FrameBackground, "unkeyed"> };

/**
 * How a Host Adapter runs the viewer: one worker's program, environment and working folder (where
 * the viewer writes its imgui.ini; else the caller's), and the arguments put before every other.
 */
export interface ViewerRun {
  readonly bin: string;
  readonly env: NodeJS.ProcessEnv;
  readonly args: readonly string[];
  readonly cwd?: string;
}

/**
 * Numbered viewer workers not in use, so concurrent runs in one process never share one (a worker
 * is a HOME on macOS, a copy of the viewer's folder on Windows). The numbers are per process.
 */
export class WorkerPool {
  readonly #free: number[] = [];
  #made = 0;

  async use<T>(run: (index: number) => Promise<T>): Promise<T> {
    const index = this.#free.pop() ?? this.#made++;
    try {
      return await run(index);
    } finally {
      this.#free.push(index);
    }
  }
}

/** How a staged model's textures are placed beside it: linked, or copied where links need privileges (Windows). */
export type TexturePlacement = "link" | "copy";

const runViewer = (viewer: ViewerRun, args: readonly string[], timeout: number) =>
  run(viewer.bin, [...viewer.args, ...args], { timeout, maxBuffer: 16 * 1024 * 1024, env: viewer.env, cwd: viewer.cwd, windowsHide: true });

/** The viewer build (its file's modification time) and the export recipe, hashed: what makes a render what it is. */
export function viewerRendererKey(builtMs: number, outputs: number, size: number): string {
  return createHash("sha1").update(`${builtMs}\n${thumbnailRecipe(outputs, size)}`).digest("hex");
}

/**
 * Renders `model` (a game storage path, or a model in one of `packages`) at `outputPaths.length`
 * turntable angles, `size` pixels square, each to its PNG with the background keyed out. Work files
 * go in a folder under `workRoot`, removed afterwards.
 */
export async function renderWithViewer(
  { model, outputPaths, size, packages = [] }: { readonly model: string; readonly outputPaths: readonly string[]; readonly size: number; readonly packages?: readonly string[] },
  viewer: ViewerRun,
  { workRoot, placement }: { readonly workRoot: string; readonly placement: TexturePlacement },
): Promise<void> {
  await mkdir(workRoot, { recursive: true });
  const work = await mkdtemp(path.join(workRoot, "whiteoutflakes-render-"));
  try {
    const recipePath = path.join(work, "recipe.ini");
    await writeFile(recipePath, thumbnailRecipe(outputPaths.length, size));
    const found = findPackageFile(packages, model);
    const viewerModel = found ? await stageModel(path.join(work, "stage"), found.file, packages, placement) : model;
    const best = new Map<number, KeyableFrame>();
    let attempts = 0;
    for (let attempt = 1; attempt <= RENDER_ATTEMPTS; attempt++) {
      const captureDir = path.join(work, `attempt-${attempt}`);
      await mkdir(captureDir, { recursive: true });
      let frames: ReturnType<typeof angleFrames>;
      try {
        const { stdout, stderr } = await runViewer(
          viewer,
          // --export-anim enables the capture (clip 0 at 30 fps); 100 ms gives every angle a few frames.
          [viewerModel, "--export-recipe", recipePath, "--export-anim", "0", "30", captureDir, "--export-duration", "100"],
          RENDER_TIMEOUT_MS,
        );
        frames = angleFrames(await readdir(captureDir));
        if (frames.size === 0) throw /SpawnUnit FAILED|file not found/.test(stdout + stderr) ? modelNotFound(model) : new Error(`the viewer wrote no frames for ${model}`);
      } catch (error) {
        // A retry that fails keeps what earlier attempts drew; only a first failure is the model's.
        if (best.size === 0) throw error;
        break;
      }
      attempts = attempt;
      // Per angle, the best frame over all attempts: white background, then black, then mixed (a
      // dark model reaching the border also reads as mixed; garbled tiles carry magenta, and
      // unkeyed frames the viewer's grey clear colour).
      for (const [angle, names] of frames) {
        for (const name of names) {
          if (best.get(angle)?.background === "white") break;
          const image = readPng(await readFile(path.join(captureDir, name)));
          if (magentaShare(image) > MAX_MAGENTA_SHARE) continue;
          const background = frameBackground(image);
          if (background === "unkeyed") continue;
          const current = best.get(angle);
          if (!current || BACKGROUND_RANK[background] > BACKGROUND_RANK[current.background]) best.set(angle, { image, background });
        }
      }
      if ([...frames.keys()].every((angle) => best.get(angle)?.background === "white")) break;
    }
    if (outputPaths.some((_, angle) => !best.has(angle))) throw new Error(`garbled frames of ${model} after ${attempts} attempts`);
    for (const [angle, outputPath] of outputPaths.entries()) {
      const { image, background } = best.get(angle)!;
      await writeFile(outputPath, writeRgbaPng(keyBackground(image, background === "black" ? "black" : "white")));
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Writes `model` (a game storage path) to `outputPath` as one .m3 with its animations merged in. */
export async function exportWithViewer(
  { model, outputPath, textures = false }: { readonly model: string; readonly outputPath: string; readonly textures?: boolean },
  viewer: ViewerRun,
): Promise<void> {
  await rm(outputPath, { force: true });
  // Its exit status says little; whether the file appeared is what counts.
  await runViewer(viewer, [model, "--save-m3", outputPath, "--save-m3-merge-anims", ...(textures ? ["--save-m3-textures"] : [])], EXPORT_TIMEOUT_MS).catch(() => undefined);
  if (!existsSync(outputPath)) throw new Error(`the viewer couldn't open ${model}`);
}

/** Writes a model, by game path or file path, as a .glb with its textures embedded: how Blender reads a model with its pictures. */
export async function exportGltfWithViewer({ model, outputPath }: { readonly model: string; readonly outputPath: string }, viewer: ViewerRun): Promise<void> {
  await rm(outputPath, { force: true });
  await runViewer(viewer, [model, "--export-gltf", outputPath], EXPORT_TIMEOUT_MS).catch(() => undefined);
  if (!existsSync(outputPath)) throw new Error(`the viewer couldn't open ${model}`);
}

/**
 * A copy of a mod package's model file in `dir`, with the textures it names placed beside it
 * (linked or copied), so the viewer reads them from the packages before the game: each texture at
 * its path under `dir`, from the newest package that holds it (findPackageFile), and each texture
 * file kept beside the model in its package beside the copy too. A texture no package holds comes
 * from the game. A path with `.`, `..` or drive (`C:`) parts isn't placed at its path, though a
 * file of its name beside the model still is; a model whose textures can't be read (not an MD34) is
 * copied with none. Returns the copy's path. Nothing is written into the packages.
 */
export async function stageModel(dir: string, modelFile: string, packages: readonly string[], placement: TexturePlacement = "link"): Promise<string> {
  await mkdir(dir, { recursive: true });
  const data = await readFile(modelFile);
  let textures: string[];
  try {
    textures = readM3TexturePaths(data);
  } catch {
    textures = [];
  }
  const beside = await readdir(path.dirname(modelFile)).catch((): string[] => []);
  const place = async (source: string, target: string) => {
    await mkdir(path.dirname(target), { recursive: true });
    await rm(target, { force: true });
    await (placement === "link" ? symlink(source, target) : copyFile(source, target));
  };
  for (const texture of textures) {
    const parts = texture.split(/[\\/]+/).filter((part) => part.length > 0);
    const last = parts.at(-1);
    if (last === undefined || last === "." || last === "..") continue;
    // A path that climbs out (`..`) would place a file outside `dir`, and a drive (`C:`) is no
    // folder name on Windows; the game reads none such, so only its file name is used, below.
    if (!parts.some((part) => part === "." || part === ".." || part.includes(":"))) {
      const found = findPackageFile(packages, texture);
      if (found) await place(found.file, path.join(dir, ...parts));
    }
    const sibling = beside.find((entry) => entry.toLowerCase() === last.toLowerCase());
    if (sibling !== undefined) await place(path.join(path.dirname(modelFile), sibling), path.join(dir, last));
  }
  const copy = path.join(dir, path.basename(modelFile));
  await writeFile(copy, data);
  return copy;
}
