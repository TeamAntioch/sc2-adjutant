// Converts Kept whole files of a mod (by default its Galaxy scripts, UI layouts and font styles)
// into files its Mod Blueprint owns (ADR-0011, src/mods/convert-files.ts): each copied into the
// mod's folder and listed in its `files`. Nothing in the package changes: compile-mod then writes
// them over their Kept originals under the Equivalence Check.
//
//   npm run convert-files -- <mods/<id>/blueprint.json> [--path <file in the package>]...

import path from "node:path";
import { parseArgs } from "node:util";

import { convertFiles, formatConvertedFiles } from "../mods/convert-files.js";

const USAGE = "Usage: convert-files <blueprint.json> [--path <file in the package>]...";

async function main(): Promise<void> {
  let parsed: { positionals: string[]; values: { path?: string[] | undefined } };
  try {
    parsed = parseArgs({ allowPositionals: true, options: { path: { type: "string", multiple: true } } });
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
  const converted = await convertFiles(blueprintPath, parsed.values.path ? { paths: parsed.values.path } : {});
  console.log(formatConvertedFiles(converted));
  if (converted.converted.length > 0) console.log("Compile the mod (npm run compile-mod) to write them over their Kept originals, under the Equivalence Check.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
