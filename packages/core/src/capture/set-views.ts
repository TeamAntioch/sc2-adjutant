// Neutral-light views of the cinematic sets, drawn in Blender, as a reference for finding the set
// that fits a cutscene: a plan from above with the roof cut away, a three-quarter overview from
// outside, and a frame from each camera the set's file has, with the set's real size beside them.
// The pieces come from the game as glTF through the Host Adapter's model.exportGltf (kept in the
// cache, one file per model), and blender/render-set.py draws them where the catalogue says they
// stand, turned and scaled as the Cutscene Editor file has them. The game captures (set-capture.ts)
// stay the look of the set as lit; these show its geometry and materials under even light,
// so they carry no emissive, spec, alpha layers, particles or screens.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { modelPathCandidates } from "@team-antioch/sc2-asset-catalog/catalog/doodad-thumbnails.js";

import { type M3Composite, readM3Composites, readM3Footprint, readM3Speculars } from "../catalog/m3-footprint.js";
import { modelFile, modelVariations, readModelEntries } from "../catalog/model-files.js";
import { BACKDROP, type CinematicSet, type SetOccurrence } from "../cutscene/set-catalog.js";
import type { PictureSource } from "../cutscene/set-looks.js";
import { type Host, requireCapability } from "../host/host.js";

const run = promisify(execFile);

/** Blender's script, beside core's package whether run from src or dist. */
export const RENDER_SET_SCRIPT = fileURLToPath(new URL("../../blender/render-set.py", import.meta.url));

/** The most camera frames drawn per set: a set filmed by dozens of cameras would swamp the sheet. */
const MAX_CAMERAS = 24;
const EXPORT_AT_ONCE = 3;
const BLENDER_TIMEOUT_MS = 10 * 60_000;
/** The render script's VERSION: raised with it when the drawing changes, so every set is drawn again. Views with none are version 1. */
const VIEWS_VERSION = 2;
/**
 * What a model's cached materials file was read with: raised when the reading changes, so every
 * model's materials are read again (and a set whose spec changes with them is drawn again).
 * Files with none are version 1; 2 reads the specular layer where each MAT_ version keeps it.
 */
const MATERIALS_VERSION = 2;

export type SetViewsOptions = {
  readonly host: Host;
  /** The Blender program: 4.5 or later (any version with the glTF importer). */
  readonly blender: string;
  /** Machine config's cacheDir: models are kept in <cacheDir>/set-views/models. */
  readonly cacheDir: string;
  readonly outDir: string;
  /** ModelData catalogs in load order (campaignModelData and mods'). */
  readonly modelData: readonly string[];
  /** Folders holding a mod's own model files; a model found in one is exported from there. */
  readonly assetRoots?: readonly string[];
  readonly log?: (line: string) => void;
  /** These are all the sets there are: a set drawn by an earlier run that isn't among them (its id changed, or it is gone) leaves the page. */
  readonly prune?: boolean;
};

export type RenderedSet = {
  readonly id: string;
  readonly name: string;
  readonly size: readonly [number, number, number];
  readonly cameras: readonly string[];
  /** Models that couldn't be exported, so aren't drawn. */
  readonly missing: readonly string[];
  /** How many pieces the set has, how many Cutscene Editor files it's in, and who is staged in it. */
  readonly pieces: number;
  readonly files: number;
  readonly marks: readonly string[];
  /** The source kinds of the files it is in (`blizzard`, a Campaign's own), and its distinct scenery models; a record from before these were kept has neither. */
  readonly origins?: readonly string[];
  readonly models?: readonly string[];
};

/** A drawn set's record, kept in its folder, so the page lists every set drawn there, by this run or an earlier one. */
const SET_RECORD = "set.json";

const median = (values: readonly number[]): number | undefined => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined;
};

/**
 * Where the plan cuts the set: a little over the heads of the people standing in it (the median
 * mark's height plus 3), else a little over the median camera lens, so a roof doesn't hide the room.
 */
export function cutHeight(occurrence: Pick<SetOccurrence, "marks" | "cameras">): number | undefined {
  const marks = median(occurrence.marks.map((mark) => mark.at[2]));
  if (marks !== undefined) return marks + 3;
  const lens = median(occurrence.cameras.map((camera) => camera.eyeHeight));
  return lens === undefined ? undefined : lens + 1.5;
}

const html = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * What the glTF leaves out of a model's materials, read from the model file: its composites'
 * sections, each standard material's specular map (the texture's file in the cache), and the
 * materials the game adds to or multiplies into what is behind them (glows, light shafts, shadow
 * sheets) and the ones that aren't surfaces (fog volumes, heat haze, lens flares), by material
 * reference: `add` ones are drawn as light, `hidden` ones not at all. `kinds` is every material's
 * kind, kept to tell a file written before a change to this apart.
 */
export type ModelMaterials = {
  readonly composites: readonly M3Composite[];
  readonly speculars: readonly { readonly material: number; readonly texture: string; readonly multiplier: number }[];
  readonly blends: readonly { readonly material: number; readonly blend: "add" | "hidden" }[];
  readonly kinds: readonly string[];
};

/**
 * The materials a model's cached materials file gives, or undefined when they are to be read again
 * from the model file: a file with a field missing, or one an older reading wrote. A host that can't
 * read the model file (no model.export) keeps an older reading's file, as a better drawing than none.
 */
export function keptMaterials(cached: (Partial<ModelMaterials> & { readonly version?: number }) | undefined, canRead: boolean): ModelMaterials | undefined {
  if (!cached?.composites || !cached.speculars || !cached.blends || !cached.kinds) return undefined;
  if (canRead && (cached.version ?? 1) !== MATERIALS_VERSION) return undefined;
  return { composites: cached.composites, speculars: cached.speculars, blends: cached.blends, kinds: cached.kinds };
}

/** Draws each set's views into `<outDir>/<set id>/`, and writes `<outDir>/index.html` over every set drawn there. Returns the sets this run drew. */
export async function renderSetViews(sets: readonly CinematicSet[], options: SetViewsOptions): Promise<RenderedSet[]> {
  const { host, cacheDir, outDir, modelData, assetRoots = [], log = () => undefined } = options;
  requireCapability(host, "model.exportGltf", "Drawing sets in Blender");
  const entries = readModelEntries(modelData);
  const modelsDir = path.join(cacheDir, "set-views", "models");
  await mkdir(modelsDir, { recursive: true });

  /** A model's .glb in the cache, with those materials, exported on first need; undefined when the game or mods don't have it. */
  type ExportedModel = ModelMaterials & { readonly glb: string };
  const NO_MATERIALS: ModelMaterials = { composites: [], speculars: [], blends: [], kinds: [] };
  const NOT_A_SURFACE = new Set(["mod", "mod2x", "displacement", "volume", "volumeNoise", "lensFlare"]);
  const texturesDir = path.join(modelsDir, "textures");
  const exported = new Map<string, Promise<ExportedModel | undefined>>();
  /** `modelPath` is the model's file, for a piece that names one and no model entry. */
  const glbOf = (id: string, modelPath?: string): Promise<ExportedModel | undefined> => {
    let job = exported.get(id);
    if (!job) exported.set(id, (job = exportOne(id, modelPath)));
    return job;
  };
  /** Exports the model file with its textures into a scratch folder, keeps the specular maps, and returns what it says of the materials. */
  async function readMaterials(id: string, model: string): Promise<ModelMaterials> {
    const scratch = path.join(modelsDir, `${id}.source`);
    try {
      await mkdir(scratch, { recursive: true });
      const m3 = path.join(scratch, "model.m3");
      await host.run("model.export", { model, outputPath: m3, textures: true });
      const data = await readFile(m3);
      await mkdir(texturesDir, { recursive: true });
      const speculars: ModelMaterials["speculars"][number][] = [];
      for (const specular of readM3Speculars(data)) {
        const named = specular.texture.replace(/\\/g, "/");
        const kept = path.join(texturesDir, path.basename(named).toLowerCase());
        if (!existsSync(kept)) {
          const written = path.join(scratch, named);
          if (!existsSync(written)) continue;
          await rename(written, kept);
        }
        speculars.push({ material: specular.material, texture: kept, multiplier: specular.multiplier });
      }
      const kinds = readM3Footprint(data).materials;
      const blends = kinds.flatMap((kind, material): ModelMaterials["blends"][number][] =>
        kind === "add" || kind === "addAlpha" ? [{ material, blend: "add" }] : NOT_A_SURFACE.has(kind) ? [{ material, blend: "hidden" }] : [],
      );
      return { composites: readM3Composites(data), speculars, blends, kinds };
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
  async function exportOne(id: string, modelPath?: string): Promise<ExportedModel | undefined> {
    const glb = path.join(modelsDir, `${id}.glb`);
    const materialsFile = path.join(modelsDir, `${id}.materials.json`);
    const file = modelPath ?? modelFile(entries, id);
    if (!file) return undefined;
    for (const candidate of modelPath ? [modelPath.replace(/\\/g, "/")] : modelPathCandidates(file, 0, modelVariations(entries, id))) {
      const model = assetRoots.map((root) => path.join(root, candidate)).find((found) => existsSync(found)) ?? candidate;
      try {
        if (!existsSync(glb) || (await stat(glb)).size === 0) {
          await host.run("model.exportGltf", { model, outputPath: glb });
          log(`exported ${id}`);
        }
        // Kept beside the .glb; a host that can't export the model file draws from the glTF alone.
        // A file read by an older reading is read again, where the host can.
        const cached = existsSync(materialsFile) ? (JSON.parse(await readFile(materialsFile, "utf8")) as Partial<ModelMaterials> & { version?: number }) : undefined;
        let materials = keptMaterials(cached, host.has("model.export"));
        if (!materials) {
          materials = await readMaterials(id, model);
          await writeFile(materialsFile, JSON.stringify({ version: MATERIALS_VERSION, ...materials }));
        }
        return { glb, ...materials };
      } catch {
        // The other numbering may be the file.
      }
    }
    return existsSync(glb) ? { glb, ...NO_MATERIALS } : undefined;
  }

  const rendered: RenderedSet[] = [];
  for (const set of sets) {
    const occurrence = set.occurrences[0];
    if (!occurrence) continue;
    const pieces = occurrence.pieces.filter((piece) => !piece.hidden && !BACKDROP.test(piece.model));
    const models = [...new Set(pieces.map((piece) => piece.model))];
    const paths = new Map(pieces.flatMap((piece) => (piece.modelPath ? [[piece.model, piece.modelPath] as const] : [])));
    const files = new Map<string, ExportedModel | undefined>();
    for (let at = 0; at < models.length; at += EXPORT_AT_ONCE) {
      await Promise.all(models.slice(at, at + EXPORT_AT_ONCE).map(async (model) => files.set(model, await glbOf(model, paths.get(model)))));
    }
    const missing = models.filter((model) => !files.get(model));
    const drawable = pieces.filter((piece) => files.get(piece.model));
    if (drawable.length === 0) {
      log(`${set.id}: no model could be exported, skipped`);
      continue;
    }
    const setDir = path.join(outDir, set.id);
    await mkdir(setDir, { recursive: true });
    const cut = cutHeight(occurrence);
    const cameras = occurrence.cameras.slice(0, MAX_CAMERAS);
    const spec = {
      out: setDir,
      ...(cut !== undefined ? { cutZ: cut } : {}),
      pieces: drawable.map((piece) => ({ model: piece.model, glb: files.get(piece.model)!.glb, composites: files.get(piece.model)!.composites, speculars: files.get(piece.model)!.speculars, blends: files.get(piece.model)!.blends, at: piece.at, ...(piece.rotation ? { rotation: piece.rotation } : {}), ...(piece.scale ? { scale: piece.scale } : {}) })),
      cameras: cameras.map((camera) => ({ name: camera.name, eye: [camera.eye[0], camera.eye[1], camera.eyeHeight], target: camera.target, fov: camera.fov })),
    };
    const specFile = path.join(setDir, "spec.json");
    const viewsFile = path.join(setDir, "views.json");
    const specText = JSON.stringify(spec);
    // Views drawn from this same spec, as the script draws them now, are kept.
    const current = existsSync(viewsFile) && existsSync(specFile) && (await readFile(specFile, "utf8")) === specText && ((JSON.parse(await readFile(viewsFile, "utf8")) as { version?: number }).version ?? 1) === VIEWS_VERSION;
    if (!current) {
      await writeFile(specFile, specText);
      await rm(viewsFile, { force: true });
      log(`${set.id}: drawing ${drawable.length} pieces of ${models.length - missing.length} models, ${cameras.length} cameras`);
      try {
        await run(options.blender, ["--background", "--factory-startup", "--python", RENDER_SET_SCRIPT, "--", specFile], { timeout: BLENDER_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
      } catch (error) {
        log(`${set.id}: Blender failed: ${String((error as { stderr?: string }).stderr ?? error).split("\n").slice(-6).join(" | ")}`);
        continue;
      }
    }
    const views = JSON.parse(await readFile(viewsFile, "utf8")) as { min: number[]; max: number[]; cameras: string[] };
    const record: RenderedSet = {
      id: set.id,
      name: set.name,
      size: [0, 1, 2].map((axis) => views.max[axis]! - views.min[axis]!) as unknown as [number, number, number],
      cameras: views.cameras,
      missing,
      pieces: occurrence.pieces.length,
      files: set.occurrences.length,
      marks: [...new Set(occurrence.marks.map((mark) => mark.name))],
      origins: [...new Set(set.occurrences.map((entry) => entry.origin))].sort(),
      models,
    };
    await writeFile(path.join(setDir, SET_RECORD), JSON.stringify(record));
    rendered.push(record);
  }
  const drawn: RenderedSet[] = [];
  for (const folder of (await readdir(outDir)).sort()) {
    const record = path.join(outDir, folder, SET_RECORD);
    if (!existsSync(record)) continue;
    if (options.prune && !sets.some((set) => set.id === folder)) await rm(record);
    else drawn.push(JSON.parse(await readFile(record, "utf8")) as RenderedSet);
  }
  await writeFile(path.join(outDir, "index.html"), renderIndex(drawn));
  return rendered;
}

/** The reference page: one section per set, its plan and overview first, then its cameras. */
export function renderIndex(rendered: readonly RenderedSet[]): string {
  const section = (entry: RenderedSet): string => {
    const [x, y, z] = entry.size.map((value) => value.toFixed(0));
    const marks = entry.marks.slice(0, 8).join(", ");
    const figure = (file: string, caption: string, wide = false): string => `<figure${wide ? ' class="wide"' : ""}><a href="${entry.id}/${file}"><img src="${entry.id}/${file}" loading="lazy"></a><figcaption>${html(caption)}</figcaption></figure>`;
    return `<section id="${entry.id}"><h2>${html(entry.name)} <small>${entry.id} · ${x} × ${y} × ${z} cells (x, y, height) · ${entry.pieces} pieces · in ${entry.files} file${entry.files === 1 ? "" : "s"}</small></h2>
${marks ? `<p class="marks">Staged with: ${html(marks)}</p>` : ""}${entry.missing.length ? `<p class="gap">Not drawn (no model file): ${html(entry.missing.join(", "))}</p>` : ""}
<div class="row">${figure("plan.jpg", "plan, roof cut away", true)}${figure("overview.jpg", "overview from the south-east", true)}${entry.cameras.map((name, index) => figure(`cam-${String(index + 1).padStart(2, "0")}.jpg`, name)).join("")}</div></section>`;
  };
  return `<!doctype html><meta charset="utf-8"><title>Cinematic sets in neutral light</title>
<style>body{font:14px Helvetica,Arial,sans-serif;margin:24px;background:#fafafa}h2{font-size:16px;margin:28px 0 4px}small{color:#888;font-weight:normal}
.row{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px}figure{margin:0;flex:0 0 280px}figure.wide{flex-basis:420px}img{width:100%;display:block;border:1px solid #ccc}
figcaption{font-size:12px;color:#555;margin-top:4px}.marks,.gap{margin:2px 0 8px;color:#555}.gap{color:#a55}nav a{margin-right:10px}</style>
<h1>Cinematic sets in neutral light</h1>
<p>Geometry and materials under even light, drawn in Blender from the game's models where the Cutscene Editor file puts them. For how a set looks as lit in the game, see the in-game contact sheet; glows, glass, animation and particles aren't drawn here. Sizes are in cells.</p>
<nav>${rendered.map((entry) => `<a href="#${entry.id}">${html(entry.name)}</a>`).join("")}</nav>
${rendered.map(section).join("\n")}
`;
}


/**
 * One more picture of a drawn set, asked for by whoever is describing it:
 * - a free camera (`eye`, `target`, `fov`);
 * - `compass`: four looks (north, east, south, west) from a standing point, this high over the set's floor, at the centre unless `at` says;
 * - `orbit`: from outside at a compass bearing (0 north, 90 east) and a pitch down, holding the whole set;
 * - `plan`: straight down.
 * `cut` takes the roof off first: at the request's `cutZ`, else just under the ceiling over the floor, else at the set's own cut.
 */
export type SetShot = { readonly name: string; readonly cut?: boolean; readonly fov?: number } & (
  | { readonly eye: readonly [number, number, number]; readonly target: readonly [number, number, number] }
  | { readonly compass: number; readonly at?: readonly [number, number] }
  | { readonly orbit: readonly [number, number] }
  | { readonly plan: true }
);

export type SetShotsRequest = {
  /** A drawn set's folder (`<outDir>/<set id>`), with the spec renderSetViews left there. */
  readonly setDir: string;
  readonly blender: string;
  readonly shots: readonly SetShot[];
  /** Draw only the pieces whose model matches; then leave out the ones matching `without`. For a file that stacks two rooms, or a glow sheet in the way. */
  readonly only?: RegExp;
  readonly without?: RegExp;
  readonly cutZ?: number;
  /** The floor's height, for `compass` shots, where the measured one (the result's `floor`, picked from its `levels`) is wrong. */
  readonly floor?: number;
  /** Where the pictures go: `<setDir>/shots` unless this says. */
  readonly outDir?: string;
};

type Level = { readonly z: number; readonly share: number };
export type SetShotsResult = {
  files: string[];
  /** Each picture with how it was drawn, as a set look's picture records it (`from`), so the same picture can be drawn again. */
  pictures: { file: string; from: PictureSource }[];
  min: number[];
  max: number[];
  floor: number;
  levels: Level[];
  ceiling?: number;
  ceilings: Level[];
  cutZ: number;
  models: string[];
};

/**
 * Draws the shots, and returns each picture's file with the bounds and floor height of the pieces drawn
 * (so the next request can be aimed) and their models. The floor is a guess: `levels` lists the
 * heights holding the most walkable surface. `ceiling` is the height of the ceiling over that floor
 * (left out where nothing overhead is as large as a ceiling) and `ceilings` the heights holding the most of it: a room's
 * ceiling is often well under its model's top, and a cut above it leaves it on. With no shots it only measures.
 */
export async function shootSet(request: SetShotsRequest): Promise<SetShotsResult> {
  const { setDir, blender, shots, only, without } = request;
  const out = request.outDir ?? path.join(setDir, "shots");
  const spec = JSON.parse(await readFile(path.join(setDir, "spec.json"), "utf8")) as { pieces: { model: string }[]; cutZ?: number };
  const pieces = spec.pieces.filter((piece) => (!only || only.test(piece.model)) && !(without && without.test(piece.model)));
  if (pieces.length === 0) throw new Error("No piece of the set is left to draw");
  await mkdir(out, { recursive: true });
  const specFile = path.join(out, "spec.json");
  await writeFile(specFile, JSON.stringify({ ...spec, ...(request.cutZ !== undefined ? { shotCutZ: request.cutZ } : {}), ...(request.floor !== undefined ? { floor: request.floor } : {}), out, pieces, cameras: [], shots }));
  await rm(path.join(out, "shots.json"), { force: true });
  await run(blender, ["--background", "--factory-startup", "--python", RENDER_SET_SCRIPT, "--", specFile], { timeout: BLENDER_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  const drawn = JSON.parse(await readFile(path.join(out, "shots.json"), "utf8")) as { min: number[]; max: number[]; floor: number; levels: Level[]; ceiling: number | null; ceilings: Level[]; cutZ: number; shots: string[] };
  // What each picture was drawn with, in full: the cut and floor as resolved, so a redraw doesn't depend on a later guess.
  const chosen = { ...(only ? { only: only.source } : {}), ...(without ? { without: without.source } : {}) };
  const pictures = shots.flatMap((shot): SetShotsResult["pictures"] => {
    const options = { ...(shot.fov !== undefined ? { fov: shot.fov } : {}), ...(shot.cut ? { cut: drawn.cutZ } : {}), ...chosen };
    const file = (name: string): string => path.join(out, `${name}.jpg`);
    if ("compass" in shot) return (["north", "east", "south", "west"] as const).map((way) => ({ file: file(`${shot.name}-${way}`), from: { compass: shot.compass, ...(shot.at ? { at: [...shot.at] as [number, number] } : {}), way, ...options, floor: drawn.floor } }));
    if ("orbit" in shot) return [{ file: file(shot.name), from: { orbit: [...shot.orbit] as [number, number], ...options } }];
    if ("plan" in shot) return [{ file: file(shot.name), from: { plan: true, ...options } }];
    return [{ file: file(shot.name), from: { eye: [...shot.eye] as [number, number, number], target: [...shot.target] as [number, number, number], ...options } }];
  });
  return { files: drawn.shots.map((name) => path.join(out, `${name}.jpg`)), pictures, min: drawn.min, max: drawn.max, floor: drawn.floor, levels: drawn.levels, ...(drawn.ceiling === null ? {} : { ceiling: drawn.ceiling }), ceilings: drawn.ceilings, cutZ: drawn.cutZ, models: [...new Set(pieces.map((piece) => piece.model))] };
}
