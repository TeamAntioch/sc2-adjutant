// The facing strip (docs/reference/doodad-facings.md): measures which way doodads face and where
// they stand against a wall, for core's data/doodad-facings.json.
//
//   npm run facing-strip -- <folder> <doodad>... [--tileset <id>] [--spacing <cells>] [--dependency <dep>]...
//     writes the strip's Blueprint into <folder> (a Mission's git-ignored output/, such as
//     missions/<id>/output/facing-strip) and compiles its Map Package there. Open it in the Editor,
//     turn, move and raise each doodad until it looks right against its wall, and save.
//   npm run facing-strip -- --read <folder> [--write] [--by <who>]
//     reads the saved strip back: each doodad's front and placement. --write merges them into
//     core's doodad-facings.json, marked measured by <who> (default "author") today.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { bundledDoodadFacings, DOODAD_FACINGS_PATH } from "../catalog/stock-catalog.js";
import { facingStripBlueprint, formatDoodadFacings, mergeFacings, readFacingStrip } from "../dressing/facing-strip.js";
import { loadHost } from "../host/host.js";
import { loadMachineConfig } from "../host/machine-config.js";
import { compileMission } from "../map/compile-mission.js";
import { missionMapPackage } from "../map/mission-package.js";
import { readObjectsXml } from "../map/read-objects-xml.js";
import { readMissionBlueprint, workspaceFor } from "../plugins/workspace.js";
import { rasterizeTerrain, terrainHeightAt } from "../terrain/rasterize.js";

const USAGE = [
  "Usage: facing-strip <folder> <doodad>... [--tileset <id>] [--spacing <cells>] [--dependency <dep>]...",
  "       facing-strip --read <folder> [--write] [--by <who>]",
].join("\n");

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

async function make(folder: string, args: string[]): Promise<void> {
  const tilesetId = option(args, "tileset");
  const spacing = option(args, "spacing");
  // A Campaign Mod's doodads need the mod as a dependency, written as a Mission's Blueprint names it.
  const dependencies: string[] = [];
  for (let dependency = option(args, "dependency"); dependency !== undefined; dependency = option(args, "dependency")) dependencies.push(dependency);
  // What's left once the options are taken out: the doodads.
  const types = args.filter((arg) => !arg.startsWith("--"));
  const blueprintPath = path.join(folder, "blueprint.json");
  const workspace = await workspaceFor(blueprintPath);
  const blueprint = facingStripBlueprint(types, { campaignId: workspace.campaign.id, ...(tilesetId ? { tilesetId } : {}), ...(spacing ? { spacing: Number(spacing) } : {}), dependencies });
  await mkdir(folder, { recursive: true });
  await writeFile(blueprintPath, `${JSON.stringify(blueprint, null, 2)}\n`);
  const compiled = await compileMission(workspace, blueprintPath, undefined, { host: await loadHost(await loadMachineConfig()) });
  console.log(`Facing strip of ${types.length} doodads compiled in ${compiled.outputDir}`);
  console.log("Open it in the Editor; set each doodad as it should stand against its wall (turn it, move it out or onto the wall, raise it); save; then run facing-strip --read.");
  for (const warning of compiled.warnings) console.warn(`Warning: ${warning}`);
}

async function read(folder: string, args: string[]): Promise<void> {
  const write = flag(args, "write");
  const by = option(args, "by") ?? "author";
  const blueprintPath = path.join(folder, "blueprint.json");
  const { blueprint } = await readMissionBlueprint(blueprintPath);
  const mapPath = await missionMapPackage(blueprintPath);
  const { doodads } = readObjectsXml(await readFile(path.join(mapPath, "Objects"), "utf8"));
  const terrain = rasterizeTerrain(blueprint);
  const facings = bundledDoodadFacings();
  const { readings, missing } = readFacingStrip(blueprint, doodads, (x, y) => terrainHeightAt(terrain, blueprint.mapSize.width, x, y), facings.placements);
  for (const { type, facing, saved } of readings) {
    const known = facings.doodads[type];
    const was = known ? ` (was front ${known.front}, ${known.placement})` : "";
    console.log(`${type}: front ${facing.front}, ${facing.placement}${facing.standOff !== undefined ? `, stand-off ${facing.standOff}` : ""}${facing.height !== undefined ? `, height ${facing.height}` : ""}  [saved at rotation ${saved.rotation}°, ${saved.standOff} out, ${saved.height} up]${was}`);
  }
  if (missing.length > 0) console.log(`Not on the saved map, so left unmeasured: ${missing.join(", ")}`);
  if (!write) {
    console.log(`Read ${readings.length} doodads. Run again with --write to record them in ${DOODAD_FACINGS_PATH}.`);
    return;
  }
  const today = new Date().toISOString().slice(0, 10);
  await writeFile(DOODAD_FACINGS_PATH, formatDoodadFacings(mergeFacings(facings, readings, `${by}, ${today}, facing strip`)));
  console.log(`Recorded ${readings.length} doodads in ${DOODAD_FACINGS_PATH}.`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const reading = flag(args, "read");
  const [folder, ...rest] = args;
  if (!folder || (!reading && rest.filter((arg) => !arg.startsWith("--")).length === 0)) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  if (reading) await read(path.resolve(folder), rest);
  else await make(path.resolve(folder), rest);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
