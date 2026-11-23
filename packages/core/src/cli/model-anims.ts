// Records models' animations, with the length and movement speed built into each, in
// data/model-anims.json (see src/catalog/model-anims.ts), through this machine's Host Adapter's
// model.export.
//
//   npm run model-anims -- [--mod <SC2Mod folder>]... [--into <catalog file>] <model id>...
//   npm run model-anims -- --print [--variation <n>] [--mod <SC2Mod folder>]... <model or doodad id>...
//
// --print only reads and prints, writing no catalog; it takes a doodad id (its model from
// data/doodad-models.json) and a variation too.
//
// The game's ModelData catalogs are downloaded once into the machine config's `cacheDir`. The macOS
// and Windows Host Adapters export models with the WhiteoutFlakes viewer named by `modelViewerPath`. Each --mod
// adds an unpacked mod's own CModels, loaded after the game's in the order given; a model whose file
// the mod holds is read from its Base.SC2Assets, RequiredAnims and all, without the viewer. A
// Campaign Mod's models are recorded --into its mods/<id>/model-anims.json, not core's.

import { MODEL_ANIMS_PATH, recordModelAnims } from "../catalog/model-anims.js";
import { recordModelsCli } from "./record-models-cli.js";

recordModelsCli(
  "model-anims",
  (into) => into ?? MODEL_ANIMS_PATH,
  recordModelAnims,
  ({ anims }) => {
    const moving = anims.filter((anim) => anim.moveSpeed > 0);
    return `${anims.length} animations${moving.length ? `; moving: ${moving.map((anim) => `${anim.name} ${anim.moveSpeed}`).join(", ")}` : ""}`;
  },
);
