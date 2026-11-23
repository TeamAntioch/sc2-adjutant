// Model animation lookup: each model's animations, with the length and movement speed built into
// each, recorded in data/model-anims.json, so a generated cutscene gives an actor the same values
// the Cutscene Editor would when its animation is picked (a walker stands still on its path without
// the move speed). Core finds the model's file in the game's ModelData catalogs and reads the
// animations; the Host Adapter's model.export pulls the model, with its required animation files
// merged in, out of the game.

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import type { Host } from "../host/host.js";
import type { Catalog, ModelAnimsLayer } from "./catalog-layer.js";
import { readM3Sequences, type M3Sequence } from "./m3-sequences.js";
import { recordModels, type RecordModelsOptions, type RecordModelsResult } from "./record-models.js";

export type ModelAnims = Record<string, { readonly file: string; readonly anims: readonly M3Sequence[] }>;

/** A model-anims.json: each model's file and its animations, as core's and a Workspace's are written. */
export const ModelAnimsSchema = z.record(
  z.string().min(1),
  z.object({ file: z.string(), anims: z.array(z.object({ name: z.string().min(1), durationMs: z.number(), moveSpeed: z.number(), looping: z.boolean() }).strict()) }).strict(),
);

/** The file a Workspace keeps recorded animations in (ADR-0026): at its root for game models, beside a Mod Blueprint for the mod's, beside a Mission Blueprint for the Mission's. */
export const MODEL_ANIMS_FILE = "model-anims.json";

/** The recorded animations of a model-anims.json's text, `file` naming it in the error when they don't read. */
export function parseModelAnims(text: string, file: string): ModelAnims {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} isn't JSON: ${(error as Error).message}`);
  }
  const parsed = ModelAnimsSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${file} isn't recorded model animations: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(file)"}: ${issue.message}`).join("; ")}`);
  return parsed.data;
}

/**
 * The layer a Workspace's model-anims.json at `absolute` makes, `file` its Workspace-relative path;
 * none when there's no file. One that doesn't read records nothing and says why, so the rest stands.
 */
export async function readModelAnimsLayer(absolute: string, file: string, owner: ModelAnimsLayer["owner"]): Promise<ModelAnimsLayer | undefined> {
  if (!existsSync(absolute)) return undefined;
  try {
    return { owner, file, anims: parseModelAnims(await readFile(absolute, "utf8"), file) };
  } catch (error) {
    return { owner, file, anims: {}, error: (error as Error).message };
  }
}

/** Which Workspace file recorded each model whose entry the compile uses, by model: the top layer that has it. */
export function modelAnimsFiles(catalog: Pick<Catalog, "modelAnimsLayers">): Readonly<Record<string, string>> {
  return Object.fromEntries(catalog.modelAnimsLayers.flatMap((layer) => Object.keys(layer.anims).map((model) => [model, layer.file])));
}

/** Where core keeps the catalog that `model-anims` writes. */
export const MODEL_ANIMS_PATH = fileURLToPath(new URL("../../data/model-anims.json", import.meta.url));

let bundled: Promise<ModelAnims> | undefined;
/** Core's catalog, data/model-anims.json, read once: the game's models only. */
export function bundledModelAnims(): Promise<ModelAnims> {
  bundled ??= readFile(MODEL_ANIMS_PATH, "utf8").then((text) => JSON.parse(text) as ModelAnims);
  return bundled;
}

/** The animations core records and the Workspace's layers, each layer's entry for a model replacing the one below (ADR-0026). */
export async function catalogModelAnims(catalog: Pick<Catalog, "modelAnimsLayers">): Promise<ModelAnims> {
  return Object.assign({}, await bundledModelAnims(), ...catalog.modelAnimsLayers.map((layer) => layer.anims)) as ModelAnims;
}

/** The sc2-game-data mirror of the game's GameData, at a fixed commit. */
const MIRROR = "https://raw.githubusercontent.com/sc2-arcade-watcher/sc2-game-data/7be894538d6eac77a9583acfeb5f721e273beee4";
/**
 * ModelData in the order a Mission on Void Story (with the Nova Covert Ops assets) loads it, later
 * entries overriding earlier ones: the race mods and the NCO assets, then the campaign mods Void
 * Story builds on, each on the one before (Wings, then Heart, then Legacy: each campaign's own
 * models, such as the star map's planet icons, and its variants of melee models), then the story
 * mods. Wings' story mod isn't one of them.
 */
export const CAMPAIGN_CATALOGS: readonly string[] = [
  "mods/core.sc2mod",
  "mods/liberty.sc2mod",
  "mods/swarm.sc2mod",
  "mods/void.sc2mod",
  "mods/novastoryassets.sc2mod",
  "campaigns/liberty.sc2campaign",
  "campaigns/swarm.sc2campaign",
  "campaigns/void.sc2campaign",
  "campaigns/swarmstory.sc2campaign",
  "campaigns/voidstory.sc2campaign",
];

/** The campaigns' ModelData catalogs in load order, downloaded once into `<cacheDir>/game-data`. */
export async function campaignModelData(cacheDir: string): Promise<string[]> {
  return Promise.all(
    CAMPAIGN_CATALOGS.map(async (mod) => {
      const cached = path.join(cacheDir, "game-data", mod, "ModelData.xml");
      if (!existsSync(cached)) {
        const response = await fetch(`${MIRROR}/${mod}/base.sc2data/GameData/ModelData.xml`);
        if (!response.ok) throw new Error(`${mod} ModelData: HTTP ${response.status}`);
        await mkdir(path.dirname(cached), { recursive: true });
        await writeFile(cached, await response.text());
      }
      return readFile(cached, "utf8");
    }),
  );
}

/**
 * A mod's own model data, for models a campaign defines: every GameData catalog in its folder (the
 * CModels sit in ModelData.xml and in files such as Heroes/<Hero>Data.xml; none in an assets-only
 * mod), and its assets folder.
 */
export async function modModelData(modDir: string): Promise<{ readonly catalogs: readonly string[]; readonly assetRoot: string }> {
  if (!existsSync(modDir)) throw new Error(`No mod folder ${modDir}`);
  const gameData = path.join(modDir, "Base.SC2Data", "GameData");
  // An assets-only mod has no GameData.
  const files = (existsSync(gameData) ? await readdir(gameData, { recursive: true, withFileTypes: true }) : [])
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".xml"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
  return { catalogs: await Promise.all(files.map((file) => readFile(file, "utf8"))), assetRoot: path.join(modDir, "Base.SC2Assets") };
}

export type RecordModelAnimsOptions = RecordModelsOptions;

export type RecordModelAnimsResult = RecordModelsResult<ModelAnims[string]>;

/** Records the models' animations in the catalog, sorted by model id. */
export function recordModelAnims(host: Host, ids: readonly string[], options: RecordModelAnimsOptions): Promise<RecordModelAnimsResult> {
  return recordModels(host, ids, {
    ...options,
    what: "Looking up model animations",
    // The model's own clips first, then each RequiredAnims file's new ones, as the game merges them
    // (an exported model has them merged in already).
    read: async (file, own, requiredAnims) => {
      const anims = new Map<string, M3Sequence>();
      for (const part of [own, ...(await requiredAnims())]) for (const anim of readM3Sequences(part)) if (!anims.has(anim.name)) anims.set(anim.name, anim);
      return { file, anims: [...anims.values()] };
    },
  });
}
