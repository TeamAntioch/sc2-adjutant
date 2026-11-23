// Doodad density per tileset and vegetation-to-texture pairs over a folder of unpacked maps, as input to
// a Style Pack's knowledge (issue #747, docs/reference/placement-stats.md). Reads only; prints counts.
//
//   npm run placement-stats -- <folder of unpacked maps> [--json] [--out <file>]
//
// With no folder it reads SC2_PLACEMENT_MAPS. Blizzard's maps are not in the repo and are not kept by
// this tool: point it at an extract on your own disk.

import { writeFileSync } from "node:fs";

import { formatPlacementStats, placementStatsFor } from "../study/placement-stats.js";
import { helpAsked, optionValue } from "./help-asked.js";

const VALUED = new Set(["--out"]);

function main(): void {
  const args = process.argv.slice(2);
  if (helpAsked(args, VALUED)) {
    console.log("Usage: placement-stats <folder of unpacked maps> [--json] [--out <file>]   (default folder: SC2_PLACEMENT_MAPS)");
    return;
  }
  let out: string | undefined;
  const folders: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--out") out = optionValue(args, i++, arg);
    else if (arg === "--json") continue;
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else folders.push(arg);
  }
  const root = folders[0] ?? process.env.SC2_PLACEMENT_MAPS;
  if (!root) throw new Error("Give a folder of unpacked maps, or set SC2_PLACEMENT_MAPS");
  const stats = placementStatsFor(root);
  if (stats.maps === 0) throw new Error(`No readable map folders under ${root} (a map folder holds Objects, t3Terrain.xml and MapInfo)`);
  const text = args.includes("--json") ? JSON.stringify(stats, null, 2) : formatPlacementStats(stats);
  if (out) writeFileSync(out, text + "\n");
  else console.log(text);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
