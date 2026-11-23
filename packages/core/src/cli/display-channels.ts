// Records which render-to-texture channels models show, in data/display-channels.json (see
// src/catalog/display-channels.ts), through this machine's Host Adapter's model.export, as
// model-footprints records footprints. `--catalog-sets` stands for every model in the cinematic-set
// catalog, which is how core's file is made: run it again when the catalog changes, from an empty
// file (`{}`), since a run keeps every model already recorded. It exits 1 with the models it couldn't
// read listed: about 40 of the catalog's have no ModelData entry or don't open in the viewer.
//
//   npm run display-channels -- [--mod <SC2Mod folder>]... (--catalog-sets | <model id>...)
//   npm run display-channels -- --print [--mod <SC2Mod folder>]... <model id>...

import { DISPLAY_CHANNELS_PATH, recordDisplayChannels } from "../catalog/display-channels.js";
import { setCatalogModelIds } from "../catalog/stock-catalog.js";
import { recordModelsCli } from "./record-models-cli.js";

recordModelsCli(
  "display-channels",
  (into) => {
    if (into) throw new Error("display-channels records into core's data/display-channels.json only");
    return DISPLAY_CHANNELS_PATH;
  },
  recordDisplayChannels,
  ({ channels }) => (channels.length ? `shows channel${channels.length > 1 ? "s" : ""} ${channels.join(", ")}` : "no channel"),
  { "--catalog-sets": setCatalogModelIds },
);
