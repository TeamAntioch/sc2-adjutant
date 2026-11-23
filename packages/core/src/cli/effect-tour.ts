// The effect tour (capture/effect-tour.ts): films the game's effect models in the game, for an
// effects gallery.
//
//   npm run effect-tour -- base [<folder>]
//     writes a flat test map's Blueprint into <folder> (by default missions/effect-tour, which git
//     ignores) and compiles it there. Every batch map is a copy of it.
//   npm run effect-tour -- make --models <folder> --base <map> --out <folder> [--batch <n>] [--only <regex>] [--limit <n>]
//     reads each Assets/Effects model core's game-models.json names from <folder> (the files
//     extracted from the install with a CASC extractor, as stormex -I 'assets\\effects\\.*\.m3$' -x
//     writes them), plans its frames from its animations and bounds, and writes batch maps of <n>
//     effects each (120 by default) into <out>/batch-NN/, with a manifest of their frames.
//     Glazes are left out: a glaze is a material laid on another model, and draws nothing alone.
//   npm run effect-tour -- make --folder <folder> --base <map> --out <folder> [--batch <n>] [--only <regex>] [--limit <n>]
//     films every .m3 under <folder>/Assets/Effects instead, models not in the game (Heroes of the
//     Storm's, converted for StarCraft II): each batch map imports its models, at their paths under
//     <folder>, and the textures they name, from <folder>/Assets/Textures.
//   npm run effect-tour -- capture <out> [--batches <a>-<b>] [--freeze] [--redo]
//     films each batch through the Editor Broker (Test Document; the game's window is
//     screenshotted at each frame), into <out>/batch-NN/frames/, and writes its index.html. A
//     batch with its index.html is skipped unless --redo, so a stopped run carries on where it was.

import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { batchRange, effectModelData, effectTourScript, batchSeconds, EFFECT_TOUR_BANK, EFFECT_TOUR_INIT, EFFECT_TOUR_SCRIPT_ID, planEffectBatch, type EffectShot, type EffectTourOptions, type TourEffect } from "../capture/effect-tour.js";
import { hideErrorsDuringTest } from "../capture/capture-copy.js";
import { runBrokeredCapture } from "../capture/editor-broker-client.js";
import { readM3Footprint } from "../catalog/m3-footprint.js";
import { readM3Sequences } from "../catalog/m3-sequences.js";
import { readM3TexturePaths } from "../catalog/m3-textures.js";
import { loadHost, requireCapability } from "../host/host.js";
import { loadMachineConfig } from "../host/machine-config.js";
import { compileMission } from "../map/compile-mission.js";
import { missionMapPackage } from "../map/mission-package.js";
import { workspaceFor } from "../plugins/workspace.js";
import { withCustomScript } from "../triggers/custom-script.js";

const USAGE = [
  "Usage: effect-tour base [<folder>]",
  "       effect-tour make --models <folder> --base <map> --out <folder> [--batch <n>] [--only <regex>] [--limit <n>]",
  "       effect-tour capture <out> [--batches <a>-<b>] [--freeze] [--redo]",
].join("\n");

/** Void (Campaign): a few effect files are only in the campaign's own assets, and it brings in Liberty's. */
const VOID_CAMPAIGN = "bnet:Void (Campaign)/0.0/999,file:Campaigns/Void.SC2Campaign";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const [value] = args.splice(index, 2).slice(1);
  return value;
}

function flag(args: string[], name: string): boolean {
  const index = args.indexOf(`--${name}`);
  if (index >= 0) args.splice(index, 1);
  return index >= 0;
}

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** The base map: 256 × 256 of flat built floor, so a far camera still sees only floor, the pad at its centre. */
export function effectTourBlueprint(campaignId: string): Record<string, unknown> {
  return {
    id: "effect-tour",
    campaignId,
    title: "Effect Tour",
    summary: "A flat floor with a pad at its centre, where npm run effect-tour films each effect model in turn.",
    setting: "test floor",
    mapSize: { width: 256, height: 256 },
    raggedCliffs: 0,
    tilesetId: "KorhalCityEx2",
    dependencies: [VOID_CAMPAIGN],
    zones: [{ id: "floor", name: "Floor", elevation: 1, landform: "flat", role: "base", surface: "built", polygon: rect(0, 0, 256, 256) }],
    anchors: [{ id: "pad", name: "Pad", zoneId: "floor", kind: "point", position: { x: 128, y: 128, z: 0 } }],
    beats: [{ id: "film", title: "Film", summary: "The tour films each effect on the pad." }],
    placements: [],
    screenplay: { title: "Effect Tour" },
  };
}

async function base(folder: string): Promise<void> {
  const blueprintPath = path.join(folder, "blueprint.json");
  const workspace = await workspaceFor(blueprintPath);
  await mkdir(folder, { recursive: true });
  await writeFile(blueprintPath, `${JSON.stringify(effectTourBlueprint(workspace.campaign.id), null, 2)}\n`);
  const compiled = await compileMission(workspace, blueprintPath, undefined, { host: await loadHost(await loadMachineConfig()) });
  for (const warning of compiled.warnings) console.warn(`Warning: ${warning}`);
  console.log(`Effect tour base map compiled: ${await missionMapPackage(blueprintPath)}`);
}

/** Every file under `folder`, by its storage path from Assets/ on, lower-cased. */
/** A file's storage path, from its last Assets/ folder on (a folder above can be called assets too), with forward slashes; undefined outside one. */
function storagePath(full: string): string | undefined {
  const slashed = full.replace(/\\/g, "/");
  const at = slashed.toLowerCase().lastIndexOf("/assets/");
  return at >= 0 ? slashed.slice(at + 1) : undefined;
}

/** A positive whole number option, or the usage message. */
function count(value: string | undefined, fallback: number | undefined, name: string): number | undefined {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} takes a whole number above 0, not ${JSON.stringify(value)}\n${USAGE}`);
  return n;
}

async function storageFiles(folder: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    const storage = storagePath(full);
    if (storage && !files.has(storage.toLowerCase())) files.set(storage.toLowerCase(), full);
  }
  return files;
}

type Manifest = { readonly batch: number; readonly map: string; readonly effects: readonly TourEffect[]; readonly shots: readonly EffectShot[]; readonly seconds: number };

async function make(args: string[]): Promise<void> {
  const models = option(args, "models");
  const folder = option(args, "folder");
  const baseMap = option(args, "base");
  const out = option(args, "out");
  if ((!models && !folder) || !baseMap || !out) throw new Error(USAGE);
  const size = count(option(args, "batch"), 120, "batch")!;
  const only = option(args, "only");
  const limit = count(option(args, "limit"), undefined, "limit");
  // A folder's models are imported into the maps; the game's are named by their storage path.
  const files = await storageFiles(folder ?? models!);
  const gameModels = folder
    ? [...files.entries()].filter(([key]) => key.startsWith("assets/effects/") && key.endsWith(".m3")).map(([, full]) => storagePath(full)!).sort()
    : (JSON.parse(await readFile(new URL("../../data/game-models.json", import.meta.url), "utf8")) as string[]);
  const effects: TourEffect[] = [];
  const missing: string[] = [];
  const unreadable: string[] = [];
  for (const file of gameModels) {
    // A folder's own spelling of the path is kept, so compared in lower case.
    if (!file.toLowerCase().startsWith("assets/effects/") || file.toLowerCase().startsWith("assets/effects/glaze/")) continue;
    if (only && !new RegExp(only, "i").test(file)) continue;
    const found = files.get(file.toLowerCase());
    if (!found) {
      missing.push(file);
      continue;
    }
    try {
      const data = new Uint8Array(await readFile(found));
      const { min, max } = readM3Footprint(data);
      effects.push({ file, sequences: readM3Sequences(data), min, max });
    } catch (error) {
      unreadable.push(`${file} (${(error as Error).message})`);
    }
  }
  const taken = limit ? effects.slice(0, limit) : effects;
  await mkdir(out, { recursive: true });
  let total = 0;
  let frames = 0;
  const missingTextures = new Set<string>();
  for (let b = 0; b * size < taken.length; b++) {
    const batch = planEffectBatch(taken.slice(b * size, (b + 1) * size));
    const name = `batch-${String(b + 1).padStart(2, "0")}`;
    const dir = path.join(out, name);
    const map = path.join(dir, `effect-tour-${String(b + 1).padStart(2, "0")}.SC2Map`);
    await rm(map, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await cp(baseMap, map, { recursive: true });
    await rm(path.join(map, "MapScript.galaxy"), { force: true });
    await writeFile(path.join(map, "MapInfo"), hideErrorsDuringTest(await readFile(path.join(map, "MapInfo"))));
    await writeFile(path.join(map, "Triggers"), withCustomScript(undefined, EFFECT_TOUR_SCRIPT_ID, effectTourScript(batch), EFFECT_TOUR_INIT));
    await mkdir(path.join(map, "Base.SC2Data", "GameData"), { recursive: true });
    await writeFile(path.join(map, "Base.SC2Data", "GameData", "ModelData.xml"), effectModelData(batch));
    if (folder) {
      // Imported at the paths they're named by: the model's own, and each texture's as the model names it.
      for (const effect of batch.effects) {
        const source = files.get(effect.file.toLowerCase())!;
        await mkdir(path.dirname(path.join(map, effect.file)), { recursive: true });
        await cp(source, path.join(map, effect.file));
        for (const texture of readM3TexturePaths(new Uint8Array(await readFile(source)))) {
          const found = files.get(texture.replace(/\\/g, "/").toLowerCase());
          if (!found) {
            missingTextures.add(texture);
            continue;
          }
          const to = path.join(map, texture.replace(/\\/g, "/"));
          await mkdir(path.dirname(to), { recursive: true });
          await cp(found, to);
        }
      }
    }
    const seconds = batchSeconds(batch);
    const manifest: Manifest = { batch: b + 1, map, effects: batch.effects, shots: batch.shots, seconds };
    await writeFile(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
    total += seconds;
    frames += batch.shots.length;
    console.log(`${name}: ${batch.effects.length} effects, ${batch.shots.length} frames, about ${Math.ceil(seconds / 60)} min in game`);
  }
  if (folder && missingTextures.size) console.log(`Textures not in ${folder} (${missingTextures.size}): ${[...missingTextures].slice(0, 12).join(", ")}${missingTextures.size > 12 ? ", …" : ""}`);
  console.log(`${taken.length} effects, ${frames} frames in ${Math.ceil(taken.length / size)} batches, about ${Math.round(total / 60)} min in game plus 1–2 min to start each batch`);
  if (missing.length) console.log(`Not in ${models} (${missing.length}): ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? ", …" : ""}`);
  if (unreadable.length) console.log(`Unreadable (${unreadable.length}): ${unreadable.join("; ")}`);
}

const html = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A batch's contact sheet: one row per effect, its frames in order, each labelled. */
function batchIndex(manifest: Manifest, framesDir: string, present: ReadonlySet<string>): string {
  const rows = manifest.effects.map((effect, n) => {
    const shots = manifest.shots.filter((shot) => shot.effect === n);
    const cells = shots.map((shot) => {
      const frame = `${String(shot.stop).padStart(4, "0")}.jpg`;
      return present.has(frame)
        ? `<figure><img loading="lazy" src="${html(path.basename(framesDir))}/${frame}"><figcaption>${shot.label}</figcaption></figure>`
        : `<figure class="missing"><div>no frame</div><figcaption>${shot.label}</figcaption></figure>`;
    });
    const anims = effect.sequences.map((sequence) => `${sequence.name} ${sequence.durationMs / 1000}s${sequence.looping ? "" : " once"}`).join(", ") || "no animations";
    return `<section><h2>${html(effect.file.replace(/^Assets\/Effects\//, ""))}</h2><p>${html(anims)}</p><div class="row">${cells.join("")}</div></section>`;
  });
  return `<!doctype html><meta charset="utf-8"><title>Effect tour, batch ${manifest.batch}</title>
<style>body{font:14px system-ui;background:#222;color:#ddd;margin:16px}h2{font-size:14px;margin:16px 0 2px}p{margin:0 0 6px;color:#999}.row{display:flex;gap:6px;flex-wrap:wrap}figure{margin:0}img{width:320px;display:block}figcaption{font-size:12px;color:#aaa}.missing div{width:320px;height:180px;background:#400;display:grid;place-items:center}</style>
<h1>Effect tour, batch ${manifest.batch}</h1>
${rows.join("\n")}
`;
}

async function capture(out: string, args: string[]): Promise<void> {
  const range = option(args, "batches");
  const freeze = flag(args, "freeze");
  const redo = flag(args, "redo");
  const [from, to] = batchRange(range);
  const host = await loadHost(await loadMachineConfig());
  requireCapability(host, "editor.captureTour", "Filming effects");
  const batches = (await readdir(out)).filter((name) => /^batch-\d+$/.test(name)).sort();
  for (const name of batches) {
    const number = Number(name.slice(6));
    if (number < from || number > to) continue;
    const dir = path.join(out, name);
    const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as Manifest;
    const framesDir = path.join(dir, "frames");
    const have = existsSync(framesDir) ? new Set((await readdir(framesDir)).filter((file) => file.endsWith(".jpg"))) : new Set<string>();
    // A batch filmed to its end has its index; a frame or two the capture missed doesn't refilm it.
    if (!redo && existsSync(path.join(dir, "index.html"))) {
      console.log(`${name}: already filmed (${have.size} of ${manifest.shots.length} frames), skipped`);
      continue;
    }
    // The batch's own map, wherever the folder now is.
    const map = path.join(dir, path.basename(manifest.map));
    // Written on every capture, so a --freeze run doesn't leave the next one frozen too.
    const options: EffectTourOptions = { freeze };
    await writeFile(path.join(map, "Triggers"), withCustomScript(undefined, EFFECT_TOUR_SCRIPT_ID, effectTourScript(planEffectBatch(manifest.effects), options), EFFECT_TOUR_INIT));
    await rm(framesDir, { recursive: true, force: true });
    const started = Date.now();
    console.log(`${name}: filming ${manifest.effects.length} effects, ${manifest.shots.length} frames (about ${Math.ceil(manifest.seconds / 60)} min once the game is up)`);
    const { frames, end } = await runBrokeredCapture(
      host,
      {
        kind: "map",
        source: map,
        label: name,
        copy: true,
        bank: EFFECT_TOUR_BANK,
        settings: { frameDigits: 4, width: 1600, quality: 85, startSeconds: 450, pressSpaceAfterSeconds: 90 },
        outputDir: framesDir,
      },
      { log: (line) => console.log(`  ${line}`) },
    );
    const present = new Set(existsSync(framesDir) ? (await readdir(framesDir)).filter((file) => file.endsWith(".jpg")) : []);
    // Only a batch filmed to its end gets its index, which marks it done: one that ended early is filmed again.
    if (end === "done") await writeFile(path.join(dir, "index.html"), batchIndex(manifest, framesDir, present));
    const missed = manifest.shots.filter((shot) => !present.has(`${String(shot.stop).padStart(4, "0")}.jpg`));
    console.log(`${name}: ${frames} frames, ${end}, ${Math.round((Date.now() - started) / 60000)} min${missed.length ? `; ${missed.length} missing` : ""}; ${path.join(dir, "index.html")}`);
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "base") return base(args[0] ?? path.resolve("missions", "effect-tour"));
  if (command === "make") return make(args);
  if (command === "capture" && args[0]) return capture(args[0], args.slice(1));
  console.error(USAGE);
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
