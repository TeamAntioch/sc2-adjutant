// Display channels: the render-to-texture channels each model shows, read from its .m3 and recorded
// in data/display-channels.json, as model-footprints records footprints, so a Cinematic's feed can
// find the channel its Set's screen shows and `check` can warn of a feed no screen shows (#1052).
// Core records every model in the cinematic-set catalog: `npm run display-channels -- --catalog-sets`.
// A model the file doesn't list is unknown, which isn't the same as one that shows nothing ([]).

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Host } from "../host/host.js";
import { readM3DisplayChannels } from "./m3-display-channels.js";
import { recordModels, type RecordModelsOptions, type RecordModelsResult } from "./record-models.js";

/** A model's channels, from the .m3 at `file`: none for a model that isn't a screen. */
export type DisplayChannel = { readonly file: string; readonly channels: readonly number[] };
export type DisplayChannels = Readonly<Record<string, DisplayChannel>>;

/** Where core keeps the catalog that `display-channels` writes. */
export const DISPLAY_CHANNELS_PATH = fileURLToPath(new URL("../../data/display-channels.json", import.meta.url));

let bundled: Promise<DisplayChannels> | undefined;
/** Core's catalog, data/display-channels.json, read once. */
export function bundledDisplayChannels(): Promise<DisplayChannels> {
  bundled ??= readFile(DISPLAY_CHANNELS_PATH, "utf8").then((text) => JSON.parse(text) as DisplayChannels);
  return bundled;
}

/** The channels a model shows, or undefined when the catalog doesn't know the model. */
export function displayChannels(catalog: DisplayChannels, model: string): readonly number[] | undefined {
  return Object.hasOwn(catalog, model) ? catalog[model]!.channels : undefined;
}

/** Records the models' channels in the catalog, sorted by model id. */
export function recordDisplayChannels(host: Host, ids: readonly string[], options: RecordModelsOptions): Promise<RecordModelsResult<DisplayChannel>> {
  return recordModels(host, ids, { ...options, what: "Reading which channels models show", read: (file, own) => ({ file, channels: readM3DisplayChannels(own) }) });
}
