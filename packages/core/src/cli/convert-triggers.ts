// Converts Kept triggers and globals of a Campaign Mod's GUI trigger library into its Mod
// Blueprint's triggers, with their names (src/mods/convert-triggers.ts), keeping their ids. Nothing
// in the package changes: compile-mod then writes them over their Kept originals under the
// Equivalence Check.
//
//   npm run convert-triggers -- <mods/<id>/blueprint.json> [--item <name or id>]...
//
// Given a Mission Blueprint, it reads chosen Kept triggers of the Mission's Map Package into the
// Blueprint's own trigger elements, one file each in triggers/ (src/map/convert-mission-triggers.ts,
// ADR-0026). Nothing in the package changes: compile-map, in place, then writes them over their Kept
// originals under the Equivalence Check.
//
//   npm run convert-triggers -- <missions/<id>/blueprint.json> [--item <name or id>]...

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { convertMissionTriggers, formatConvertedMissionTriggers } from "../map/convert-mission-triggers.js";
import { convertTriggers, formatConvertedTriggers } from "../mods/convert-triggers.js";
import { workspaceFor } from "../plugins/workspace.js";

const USAGE = "Usage: convert-triggers <mod or mission blueprint.json> [--item <name or id>]...";

/** Whether the Blueprint at `file` is a Mission's: it has a screenplay, which a Mod Blueprint hasn't. */
async function isMission(file: string): Promise<boolean> {
  const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  return typeof raw === "object" && raw !== null && "screenplay" in raw;
}

async function main(): Promise<void> {
  let parsed: { positionals: string[]; values: { item?: string[] | undefined } };
  try {
    parsed = parseArgs({ allowPositionals: true, options: { item: { type: "string", multiple: true } } });
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (parsed.positionals.length !== 1) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const blueprintPath = path.resolve(process.env.INIT_CWD ?? process.cwd(), parsed.positionals[0]!);
  const items = parsed.values.item;
  if (await isMission(blueprintPath)) {
    const converted = await convertMissionTriggers(await workspaceFor(blueprintPath), blueprintPath, items ? { triggers: items } : {});
    console.log(formatConvertedMissionTriggers(converted));
    if (converted.converted.length > 0) console.log("Compile the Mission in place (npm run compile-map) to write them over their Kept originals, under the Equivalence Check.");
    return;
  }
  const converted = await convertTriggers(blueprintPath, items ? { items } : {});
  console.log(formatConvertedTriggers(converted));
  if (converted.converted.length > 0) console.log("Compile the mod (npm run compile-mod) to write them over their Kept originals, under the Equivalence Check.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
