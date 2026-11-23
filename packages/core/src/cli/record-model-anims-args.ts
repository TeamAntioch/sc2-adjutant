// The Workspace's model-anims script's command line (src/cli/record-model-anims.ts):
//
//   npm run model-anims -- [--mission <id>] <model id>...

import { helpAsked, optionValue } from "./help-asked.js";

export type RecordModelAnimsArgs = { readonly help: true } | { readonly ids: string[]; readonly mission?: string };

export const RECORD_MODEL_ANIMS_USAGE = `Usage: npm run model-anims -- [--mission <id>] <model id>...
Records each model's animations in the Workspace file of its owner: a game model's in model-anims.json at the root,
the Campaign Mod's own in mods/<id>/model-anims.json, and, with --mission, that Mission's own in missions/<id>/model-anims.json.`;

const VALUED = new Set(["--mission"]);

/** The command line's model ids and Mission. */
export function recordModelAnimsArgs(args: readonly string[]): RecordModelAnimsArgs {
  if (helpAsked(args, VALUED)) return { help: true };
  const ids: string[] = [];
  let mission: string | undefined;
  for (let at = 0; at < args.length; at++) {
    const arg = args[at]!;
    if (arg === "--mission") mission = optionValue(args, at++, arg);
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else ids.push(arg);
  }
  if (ids.length === 0) throw new Error("Name at least one model");
  return { ids, ...(mission !== undefined ? { mission } : {}) };
}
