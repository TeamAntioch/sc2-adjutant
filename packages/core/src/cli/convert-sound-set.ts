// Writes a Campaign Mod conversation's sound set, and its voices in the Asset Mod that holds its
// voice files, from each line's Kept CSound and voice file (ADR-0011, src/mods/convert-sound-set.ts).
// Nothing in either package changes: compile-mod on the Asset Mod, then on the Campaign Mod, writes
// them over their Kept originals under the Equivalence Check.
//
//   npm run convert-sound-set -- <mods/<campaign mod>/blueprint.json> <conversation>

import path from "node:path";

import { convertSoundSet, formatConvertedSoundSet } from "../mods/convert-sound-set.js";

const USAGE = "Usage: convert-sound-set <blueprint.json> <conversation>";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args.some((arg) => arg.startsWith("--"))) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const blueprintPath = path.resolve(process.env.INIT_CWD ?? process.cwd(), args[0]!);
  const converted = await convertSoundSet(blueprintPath, { conversation: args[1]! });
  console.log(formatConvertedSoundSet(converted));
  console.log("Compile the Asset Mod, then the Campaign Mod (npm run compile-mod), to write them over their Kept originals, under the Equivalence Check.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
