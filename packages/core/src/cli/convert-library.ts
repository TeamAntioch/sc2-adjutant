// Converts Kept functions of a Campaign Mod's GUI trigger library into its Mod Blueprint's library
// interface (ADR-0011, src/mods/convert-library.ts), keeping their ids. Nothing in the package
// changes: compile-mod then writes them over their Kept originals under the Equivalence Check.
//
//   npm run convert-library -- <mods/<id>/blueprint.json> [--function <name or id>]...

import path from "node:path";
import { parseArgs } from "node:util";

import { convertLibrary, formatConvertedLibrary } from "../mods/convert-library.js";

const USAGE = "Usage: convert-library <blueprint.json> [--function <name or id>]...";

async function main(): Promise<void> {
  let parsed: { positionals: string[]; values: { function?: string[] | undefined } };
  try {
    parsed = parseArgs({ allowPositionals: true, options: { function: { type: "string", multiple: true } } });
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
  const converted = await convertLibrary(blueprintPath, parsed.values.function ? { functions: parsed.values.function } : {});
  console.log(formatConvertedLibrary(converted));
  if (converted.converted.length > 0) console.log("Compile the mod (npm run compile-mod) to write them over their Kept originals, under the Equivalence Check.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
