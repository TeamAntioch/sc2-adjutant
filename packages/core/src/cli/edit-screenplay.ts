// Edits a Screenplay at the Workspace's Screenplay Source: a Mission's, or one of a Campaign Mod's
// (an interlude or hub chats); pull it again afterwards with `npm run pull-screenplay` (or
// `npm run refresh-screenplay`). The edits file is in the Source's own format (see the Campaign
// Pack's docs). Always dry-run first.
//
//   npm run edit-screenplay -- missions/<id>/blueprint.json <edits.json> [--dry-run]
//   npm run edit-screenplay -- mods/<id>/blueprint.json <edits.json> [--screenplay <name>] [--dry-run]
//
// A Mod Blueprint declares Screenplays: `--screenplay` names one by its ref (the Source's act),
// its conversation or its source file, and may be left out when the mod declares only one.

import { readFile } from "node:fs/promises";

import { editModScreenplay } from "../mods/conversations.js";
import { blueprintKind } from "../mods/workspace-mods.js";
import { readMissionBlueprint } from "../plugins/workspace.js";
import { editScreenplay } from "../script/screenplay-source.js";

const USAGE = "Usage: edit-screenplay <blueprint.json> <edits.json> [--screenplay <name>] [--dry-run]";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const named = args.indexOf("--screenplay");
  const screenplay = named >= 0 ? args[named + 1] : undefined;
  const positional = (named >= 0 ? [...args.slice(0, named), ...args.slice(named + 2)] : args).filter((arg) => arg !== "--dry-run");
  const [blueprintPath, editsPath, ...rest] = positional;
  if (!blueprintPath || !editsPath || rest.length > 0 || (named >= 0 && (!screenplay || screenplay.startsWith("--")))) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  let edits: unknown;
  try {
    edits = JSON.parse(await readFile(editsPath, "utf8"));
  } catch (error) {
    throw new Error(`Can't read the edits file ${editsPath}: ${(error as Error).message}`, { cause: error });
  }
  if ((await blueprintKind(blueprintPath)) === "mod") {
    const edited = await editModScreenplay(blueprintPath, screenplay, edits, dryRun);
    process.stdout.write(edited.report);
    return;
  }
  if (screenplay !== undefined) throw new Error(`--screenplay names one of a Mod Blueprint's Screenplays; ${blueprintPath} is a Mission Blueprint, which has one`);
  const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);
  process.stdout.write(await editScreenplay({ blueprint, workspace }, blueprintPath, edits, dryRun));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
