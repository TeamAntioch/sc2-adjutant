// Records models' footprints, their bounds and what their materials draw as, in
// data/model-footprints.json (see src/catalog/model-footprints.ts), for `check`'s overlap warnings
// on a Set's pieces, through this machine's Host Adapter's model.export. Each line gives the size
// as w × d × h, the model's x × y × z extents in game units.
//
//   npm run model-footprints -- [--mod <SC2Mod folder>]... <model id>...
//   npm run model-footprints -- --print [--variation <n>] [--mod <SC2Mod folder>]... <model or doodad id>...
//
// --print only reads and prints, leaving the tracked catalog as it is: a Doodad Search sizes its
// candidates this way, by doodad id (resolved through data/doodad-models.json) and variation.
// The game's ModelData and the mods are read as model-anims reads them (src/cli/model-anims.ts).

import { MODEL_FOOTPRINTS_PATH, recordModelFootprints } from "../catalog/model-footprints.js";
import { describeFootprint } from "./model-footprints-format.js";
import { recordModelsCli } from "./record-models-cli.js";

recordModelsCli(
  "model-footprints",
  (into) => {
    // A Campaign Mod's footprints aren't read from the mod yet: only core's catalog is checked against.
    if (into) throw new Error("model-footprints records into core's data/model-footprints.json only; --into is model-anims'");
    return MODEL_FOOTPRINTS_PATH;
  },
  recordModelFootprints,
  describeFootprint,
);
