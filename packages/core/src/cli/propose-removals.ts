// Proposes Accepted Removals for a Workspace mod (ADR-0011, src/mods/removals.ts): the Kept
// leftovers that look safe to drop (conversation strings nothing names, old merge conflicts'
// lines, an empty asset-key table), each with a reason. Nothing is applied: the author confirms
// each one before it goes in the Mod Blueprint's removals.
//
//   npm run propose-removals -- <mods/<id>/blueprint.json>

import path from "node:path";

import { formatProposedRemovals, proposeRemovals } from "../mods/removals.js";

const USAGE = "Usage: propose-removals <blueprint.json>";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0]!.startsWith("-")) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const blueprintPath = path.resolve(process.env.INIT_CWD ?? process.cwd(), args[0]!);
  console.log(formatProposedRemovals(await proposeRemovals(blueprintPath)));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
