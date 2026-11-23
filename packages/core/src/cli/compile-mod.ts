// Compiles a Mod Blueprint into its committed mod package in place (ADR-0011, src/mods/compile-mod.ts):
// each writer replaces only what compile-record.json lists, every Kept byte stays as the Editor
// wrote it, and each part converted from Kept passes the Equivalence Check or the compile stops.
// When the Editor has changed Compiled Content, the compile stops and lists each change: --keep or
// --discard each one, or all of them. Each Accepted Removal it removed is listed. An Asset Mod's placeholder voices are listed, each line's.
// Ends with the mod's Kept report, by component.
//
//   npm run compile-mod -- <mods/<id>/blueprint.json> [--keep <entry>]... [--discard <entry>]... [--keep-all | --discard-all]

import path from "node:path";

import { EditorChangesError } from "../map/editor-changes.js";
import { formatPlaceholder } from "../mods/asset-sources.js";
import { CatalogSchemaError, compileMod } from "../mods/compile-mod.js";
import { EquivalenceError } from "../mods/equivalence.js";
import { formatKeptReport, keptReport } from "../mods/kept-report.js";
import { parseDecisionArgs } from "./compile-map-args.js";

const USAGE = "Usage: compile-mod <blueprint.json> [--keep <entry>]... [--discard <entry>]... [--keep-all | --discard-all]";

async function main(): Promise<void> {
  let parsed: ReturnType<typeof parseDecisionArgs>;
  try {
    parsed = parseDecisionArgs(process.argv.slice(2), USAGE);
    if (parsed.positional.length !== 1) throw new Error(USAGE);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 2;
    return;
  }
  const blueprintPath = path.resolve(process.env.INIT_CWD ?? process.cwd(), parsed.positional[0]!);
  const compiled = await compileMod(blueprintPath, { decisions: parsed.decisions });
  console.log(`Mod compiled in ${compiled.modPackage}`);
  for (const conversion of compiled.conversions) console.log(`Converted ${conversion.item}${conversion.accepted ? ` (Accepted Difference: ${conversion.accepted})` : ""}`);
  for (const removal of compiled.removed) console.log(`Removed ${removal.item} (Accepted Removal: ${removal.reason})`);
  for (const warning of compiled.warnings) console.warn(`Warning: ${warning}`);
  for (const placeholder of compiled.placeholders) console.log(formatPlaceholder(placeholder));
  console.log(formatKeptReport(await keptReport(blueprintPath)));
}

main().catch((error: unknown) => {
  // A compile stopped on the author's Editor changes, a failed Equivalence Check or entries the schema refuses says so plainly.
  console.error(error instanceof EditorChangesError || error instanceof EquivalenceError || error instanceof CatalogSchemaError ? error.message : error);
  process.exitCode = 1;
});
