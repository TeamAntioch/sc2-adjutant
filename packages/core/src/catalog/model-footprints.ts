// Model footprints: each model's bounds and what its materials draw as, read from its .m3 and
// recorded in data/model-footprints.json, as model-anims records animations, so `check` can find
// a Set's flat pieces that z-fight and see-through decals that re-sort (set-checks.ts).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Host } from "../host/host.js";
import { readM3Footprint, type M3Footprint } from "./m3-footprint.js";
import { recordModels, type RecordModelsOptions, type RecordModelsResult } from "./record-models.js";

/** A model's footprint, from the .m3 at `file` (its first numbered file when it has variations). */
export type ModelFootprint = M3Footprint & { readonly file: string };
export type ModelFootprints = Readonly<Record<string, ModelFootprint>>;

/** Where core keeps the catalog that `model-footprints` writes. */
export const MODEL_FOOTPRINTS_PATH = fileURLToPath(new URL("../../data/model-footprints.json", import.meta.url));

let bundled: Promise<ModelFootprints> | undefined;
/** Core's catalog, data/model-footprints.json, read once. */
export function bundledModelFootprints(): Promise<ModelFootprints> {
  bundled ??= readFile(MODEL_FOOTPRINTS_PATH, "utf8").then((text) => JSON.parse(text) as ModelFootprints);
  return bundled;
}

/** Records the models' footprints in the catalog, sorted by model id. */
export function recordModelFootprints(host: Host, ids: readonly string[], options: RecordModelsOptions): Promise<RecordModelsResult<ModelFootprint>> {
  return recordModels(host, ids, { ...options, what: "Looking up model footprints", read: (file, own) => ({ file, ...readM3Footprint(own) }) });
}
