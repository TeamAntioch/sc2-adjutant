// Converts Kept entries of a mod's GameData file into generic typed catalog entries in its Mod
// Blueprint (ADR-0011, src/mods/convert-entries.ts), keeping their ids. Nothing in the package
// changes: compile-mod then writes them over their Kept originals under the Equivalence Check.
//
//   npm run convert-entries -- <mods/<id>/blueprint.json> <Base.SC2Data/GameData/<file>.xml> [--entry <Class>:<id>]...

import path from "node:path";
import { parseArgs } from "node:util";

import { convertEntries, formatConvertedEntries } from "../mods/convert-entries.js";

const USAGE = "Usage: convert-entries <blueprint.json> <Base.SC2Data/GameData/<file>.xml> [--entry <Class>:<id>]...";

async function main(): Promise<void> {
  let parsed: { positionals: string[]; values: { entry?: string[] | undefined } };
  try {
    parsed = parseArgs({ allowPositionals: true, options: { entry: { type: "string", multiple: true } } });
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (parsed.positionals.length !== 2) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const blueprintPath = path.resolve(process.env.INIT_CWD ?? process.cwd(), parsed.positionals[0]!);
  const converted = await convertEntries(blueprintPath, { file: parsed.positionals[1]!, ...(parsed.values.entry ? { keys: parsed.values.entry } : {}) });
  console.log(formatConvertedEntries(converted));
  if (converted.converted.length > 0) console.log("Compile the mod (npm run compile-mod) to write them over their Kept originals, under the Equivalence Check.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
