// Records doodads' ground outlines, every variation, in data/doodad-outlines.json (see
// src/catalog/doodad-outlines.ts), through this machine's Host Adapter's model.export. The compile
// paints no-pathing under a solid set-piece doodad from them, and warns about one with none.
//
//   npm run doodad-outlines -- [--mod <SC2Mod folder>]... [--print] [--draw] <doodad id>...
//
// --print only reads and prints, leaving the data file as it is; --draw draws each outline in text.

import { campaignModelData, modModelData } from "../catalog/model-anims.js";
import { OUTLINE_STEP } from "../catalog/doodad-outlines.js";
import { drawOutline, recordDoodadOutlines } from "../catalog/record-doodad-outlines.js";
import { loadHost } from "../host/host.js";
import { hostContext, loadMachineConfig } from "../host/machine-config.js";
import { helpAsked, optionValue } from "./help-asked.js";
import path from "node:path";

const USAGE = "Usage: doodad-outlines [--mod <SC2Mod folder>]... [--print] [--draw] <doodad id>...\n--print reads and prints, writing nothing; --draw draws each outline in text (# solid).";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (helpAsked(args, new Set(["--mod"]))) {
    console.log(USAGE);
    return;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const ids: string[] = [];
  const modDirs: string[] = [];
  let print = false;
  let draw = false;
  for (let at = 0; at < args.length; at++) {
    const arg = args[at]!;
    if (arg === "--mod") modDirs.push(path.resolve(cwd, optionValue(args, at++, arg)));
    else if (arg === "--print") print = true;
    else if (arg === "--draw") draw = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}\n${USAGE}`);
    else ids.push(arg);
  }
  if (ids.length === 0) throw new Error(USAGE);
  const machine = await loadMachineConfig();
  const host = await loadHost(machine);
  const mods = await Promise.all(modDirs.map(modModelData));
  const modelData = async () => [...(await campaignModelData(hostContext(machine).requirePath("cacheDir"))), ...mods.flatMap((mod) => mod.catalogs)];
  const { recorded, failed, dropped } = await recordDoodadOutlines(host, ids, { modelData, assetRoots: mods.map((mod) => mod.assetRoot), catalogPath: print ? null : undefined });
  for (const { id, variations } of recorded) {
    variations.forEach((outline, variation) => {
      const size = outline ? `${(outline.width * OUTLINE_STEP).toFixed(2)} × ${(outline.height * OUTLINE_STEP).toFixed(2)} from (${outline.x}, ${outline.y}), ${outline.bits.reduce((sum, bit) => sum + bit, 0) * OUTLINE_STEP * OUTLINE_STEP} cells² solid` : "nothing solid at a unit's height";
      console.log(`${id} ${String(variation).padStart(2, "0")}: ${size}`);
      if (draw && outline) console.log(drawOutline(outline));
    });
  }
  for (const { id, reason } of failed) console.error(`${id}: ${reason}`);
  if (dropped.length > 0) console.error(`Dropped, as made at another step or with other cuts, to record again: ${dropped.join(" ")}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
