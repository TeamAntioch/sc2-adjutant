// Declares the Screenplay a Kept CConversation of a Campaign Mod comes from in its Mod Blueprint
// (ADR-0011, src/mods/convert-screenplay.ts): found and pulled from the Screenplay Source, its
// lines matched to the Conversation's imported ids and Sounds. Nothing in the package changes:
// compile-mod then writes the Conversation and its strings over their Kept originals, under the
// Equivalence Check. Each line whose text differs from the Kept one is listed, to name as an
// Accepted Difference or change at the Source.
//
// Only on the author's decision: --accept <reason> lets the Conversation's groups or ids differ, as
// its Accepted Difference; --renumber (with --accept) pairs the lines of a Screenplay renumbered at
// the Source in order, and makes the mod package's Kept references follow the new ids.
//
//   npm run convert-screenplay -- <mods/<id>/blueprint.json> <CConversation id> [--ref <ref>] [--source <file>] [--accept <reason> [--renumber]]
//
// Given a Mission Blueprint with Kept terrain, it converts the Map Package's own conversation, the
// one screenplay.script.conversationId names, to the pulled Screenplay
// (src/map/convert-mission-screenplay.ts): it records what each line keeps, lists every difference,
// and with --accept <reason> names each difference the first compile meets as accepted.
//
//   npm run convert-screenplay -- <missions/<id>/blueprint.json> [--accept <reason>]

import path from "node:path";
import { parseArgs } from "node:util";

import { readFile } from "node:fs/promises";

import { convertMissionScreenplay, formatConvertedMissionScreenplay, missionConversionNextStep } from "../map/convert-mission-screenplay.js";
import { convertScreenplay, formatConvertedScreenplay } from "../mods/convert-screenplay.js";

const USAGE = "Usage: convert-screenplay <mod blueprint.json> <CConversation id> [--ref <ref>] [--source <file>] [--accept <reason> [--renumber]]\n       convert-screenplay <mission blueprint.json> [--accept <reason>]";

/** Whether the Blueprint at `file` is a Mission's: it has a screenplay, which a Mod Blueprint hasn't. */
async function isMission(file: string): Promise<boolean> {
  const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
  return typeof raw === "object" && raw !== null && "screenplay" in raw;
}

async function main(): Promise<void> {
  let parsed: { positionals: string[]; values: { ref?: string | undefined; source?: string | undefined; accept?: string | undefined; renumber?: boolean | undefined } };
  try {
    parsed = parseArgs({ allowPositionals: true, options: { ref: { type: "string" }, source: { type: "string" }, accept: { type: "string" }, renumber: { type: "boolean" } } });
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const first = parsed.positionals[0];
  const blueprintPath = first === undefined ? undefined : path.resolve(process.env.INIT_CWD ?? process.cwd(), first);
  if (blueprintPath && parsed.positionals.length === 1 && (await isMission(blueprintPath))) {
    const { ref, source, accept, renumber } = parsed.values;
    if (ref || source || renumber) {
      console.error(`A Mission's conversation is converted to its screenplay.script, so it takes only --accept\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    const converted = await convertMissionScreenplay(blueprintPath, accept ? { accept } : {});
    console.log(formatConvertedMissionScreenplay(converted));
    console.log(missionConversionNextStep(converted, "npm run compile-map"));
    return;
  }
  if (!blueprintPath || parsed.positionals.length !== 2) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const conversation = parsed.positionals[1]!;
  const { ref, source, accept, renumber } = parsed.values;
  const converted = await convertScreenplay(blueprintPath, { conversation, ...(ref ? { ref } : {}), ...(source ? { source } : {}), ...(accept ? { accept } : {}), ...(renumber ? { renumber } : {}) });
  console.log(formatConvertedScreenplay(conversation, converted));
  console.log("Compile the mod (npm run compile-mod) to write it over its Kept original, under the Equivalence Check.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
