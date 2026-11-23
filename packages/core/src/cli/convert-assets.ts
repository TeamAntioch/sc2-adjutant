// Declares an Asset Mod's Kept art and audio files as Workspace-file Asset Sources in bulk
// (ADR-0011, src/mods/convert-assets.ts): each copied into the mod's folder (assets/…) with its
// SHA-256. Lists the files whose names suggest another origin, for the author's provenance and
// licence check, and records the origins given in an origins file: a JSON array of
// { "match": <glob>, "origin": <origin> }. Nothing in the package changes: compile-mod then writes
// them over their Kept originals under the Equivalence Check.
//
//   npm run convert-assets -- <mods/<id>/blueprint.json> [--path <file>]... [--suspect <glob>]... [--origins <origins.json>]

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { OriginSchema } from "../domain/asset-source.js";
import { convertAssets, formatConvertedAssets } from "../mods/convert-assets.js";

const USAGE = "Usage: convert-assets <blueprint.json> [--path <file in the package>]... [--suspect <glob>]... [--origins <origins.json>]";

const OriginRulesSchema = z.array(z.object({ match: z.string().min(1), origin: OriginSchema }).strict());

async function main(): Promise<void> {
  let parsed: { positionals: string[]; values: { path?: string[] | undefined; suspect?: string[] | undefined; origins?: string | undefined } };
  try {
    parsed = parseArgs({ allowPositionals: true, options: { path: { type: "string", multiple: true }, suspect: { type: "string", multiple: true }, origins: { type: "string" } } });
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
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const blueprintPath = path.resolve(cwd, parsed.positionals[0]!);
  const origins = parsed.values.origins ? OriginRulesSchema.parse(JSON.parse(await readFile(path.resolve(cwd, parsed.values.origins), "utf8"))) : undefined;
  const converted = await convertAssets(blueprintPath, {
    ...(parsed.values.path ? { paths: parsed.values.path } : {}),
    ...(parsed.values.suspect ? { suspects: parsed.values.suspect } : {}),
    ...(origins ? { origins } : {}),
  });
  console.log(formatConvertedAssets(converted));
  if (converted.converted.length > 0 || converted.origins.length > 0) console.log("Compile the mod (npm run compile-mod) to write them over their Kept originals, under the Equivalence Check.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
