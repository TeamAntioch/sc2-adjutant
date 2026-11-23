// Refreshes Screenplays from the Workspace's Screenplay Source. For a Mission Blueprint, writes the
// Screenplay that `screenplay.script.ref` names over `screenplay.script.source`; for a Campaign
// Mod's Blueprint (mods/<id>/blueprint.json), each of its Screenplays over its `source` (ADR-0011).
// Edits are made at the Source (`npm run edit-screenplay`), never in the pulled copy. A Workspace
// whose Campaign Pack has no Screenplay Source keeps its Screenplays as files, so there is nothing
// to pull.
//
//   npm run pull-screenplay -- missions/<id>/blueprint.json
//   npm run pull-screenplay -- mods/<id>/blueprint.json

import path from "node:path";

import { pullModScreenplays } from "../mods/conversations.js";
import { blueprintKind } from "../mods/workspace-mods.js";
import { readMissionBlueprint } from "../plugins/workspace.js";
import { pullScreenplay } from "../script/screenplay-source.js";
import { staysInside } from "../util/inside.js";

/** Where the author ran the command: npm runs a script from the package, and says where it was run from in INIT_CWD. */
const ranFrom = process.env.INIT_CWD ?? process.cwd();

/** A path as the author ran from: relative when it is under where they are. Only for display, so compared as written. */
function shown(file: string): string {
  const relative = path.relative(ranFrom, file);
  return staysInside(relative) ? relative : file;
}

async function main(): Promise<void> {
  const [given] = process.argv.slice(2);
  if (!given) {
    console.error("Usage: pull-screenplay <blueprint.json>");
    process.exitCode = 2;
    return;
  }
  const blueprintPath = path.resolve(ranFrom, given);
  if ((await blueprintKind(blueprintPath)) === "mod") {
    const { sourceName, pulled } = await pullModScreenplays(blueprintPath);
    if (!sourceName) console.log("The Workspace's Campaign Pack has no Screenplay Source, so each Screenplay file is the Screenplay itself: nothing to pull");
    else if (pulled.length === 0) console.log("The Mod Blueprint declares no Screenplays: nothing to pull");
    for (const { ref, path: file } of pulled) console.log(`Pulled ${ref} from ${sourceName} to ${shown(file)}`);
    return;
  }
  const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);
  const result = await pullScreenplay({ blueprint, workspace }, blueprintPath);
  console.log(
    result.sourceName
      ? `Pulled ${blueprint.screenplay.script?.ref} from ${result.sourceName} to ${shown(result.path)}`
      : `The Workspace's Campaign Pack has no Screenplay Source, so ${shown(result.path)} is the Screenplay itself: nothing to pull`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
