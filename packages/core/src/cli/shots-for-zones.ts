// Picks a Still Review set's Shots from a Mission's Zones (#124, src/capture/zone-shots.ts), as the
// MCP tool shots_for_zones does: one Shot per Zone, centred on its pole of inaccessibility, in
// missions/<id>/output/stills/<set>/shots.json, which capture-shots takes as its shots file.
//
//   npm run shots-for-zones -- <blueprint.json> <zone id>... --set <name> [--size <width>,<height>] [--pitch <degrees>]
//
// Paths are relative to where the command was typed.

import path from "node:path";
import { parseArgs } from "node:util";

import { shotsForZones } from "../capture/zone-shots.js";

const USAGE = "Usage: shots-for-zones <blueprint.json> <zone id>... --set <name> [--size <width>,<height>] [--pitch <degrees>]";

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { set: { type: "string" }, size: { type: "string" }, pitch: { type: "string" } } });
  const [blueprintArg, ...zones] = positionals;
  const size = values.size?.split(",").map(Number);
  if (!blueprintArg || zones.length === 0 || !values.set || (size && (size.length !== 2 || size.some((n) => !(n > 0)))) || (values.pitch !== undefined && !Number.isFinite(Number(values.pitch)))) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const { file, shots } = await shotsForZones(path.resolve(cwd, blueprintArg), zones, {
    set: values.set,
    ...(size ? { size: [size[0]!, size[1]!] as const } : {}),
    ...(values.pitch !== undefined ? { pitch: Number(values.pitch) } : {}),
  });
  for (const shot of shots) console.log(`${shot.label}: [${shot.rect.join(", ")}]`);
  console.log(`Wrote ${shots.length} Shot(s) to ${file}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
