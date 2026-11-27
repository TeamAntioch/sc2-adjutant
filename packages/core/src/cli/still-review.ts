// Builds one round of a Still Review (#124, src/capture/still-review.ts), as the MCP tool
// build_still_review does: each version's capture_shots folders (a full capture, then any
// retakes), checked frame by frame, into the round's folder: review.json, frames/ and index.html.
// A Mission's round goes in missions/<id>/output/stills/<set>/<round>/; with --folder, for any
// Map Package, in <folder>/<set>/<round>/.
//
//   npm run still-review -- <blueprint.json | --folder <dir>> --set <name> --round <name>
//     --version <label>=<capture folder>[,<retake folder>...]... [--note <label>=<text>]...
//     [--reference <capture folder>] [--previous <round folder>] [--lighting <id>]
//
// Versions go in the order given. Paths are relative to where the command was typed. It exits 1
// when a frame is left off the page (missing, late or wrong), after printing the retakes to make.

import path from "node:path";
import { parseArgs } from "node:util";

import { buildStillReview } from "../capture/still-review.js";

const USAGE =
  "Usage: still-review <blueprint.json | --folder <dir>> --set <name> --round <name> --version <label>=<folder>[,<folder>...]... [--note <label>=<text>]... [--reference <folder>] [--previous <round folder>] [--lighting <id>]";

/** `label=value`, split at the first `=`. */
const pair = (arg: string): [string, string] | undefined => {
  const at = arg.indexOf("=");
  return at > 0 ? [arg.slice(0, at), arg.slice(at + 1)] : undefined;
};

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      folder: { type: "string" },
      set: { type: "string" },
      round: { type: "string" },
      version: { type: "string", multiple: true },
      note: { type: "string", multiple: true },
      reference: { type: "string" },
      previous: { type: "string" },
      lighting: { type: "string" },
    },
  });
  const versionPairs = (values.version ?? []).map(pair);
  const notePairs = (values.note ?? []).map(pair);
  const [blueprintArg] = positionals;
  if (positionals.length > 1 || !blueprintArg === !values.folder || !values.set || !values.round || versionPairs.length === 0 || versionPairs.some((entry) => !entry) || notePairs.some((entry) => !entry)) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const resolve = (folder: string) => path.resolve(cwd, folder);
  const notes = new Map(notePairs as [string, string][]);
  const versions = (versionPairs as [string, string][]).map(([label, folders]) => ({ label, ...(notes.has(label) ? { note: notes.get(label)! } : {}), captures: folders.split(",").map(resolve) }));
  const result = await buildStillReview({
    target: blueprintArg ? { blueprintPath: resolve(blueprintArg) } : { folder: resolve(values.folder!) },
    set: values.set,
    round: values.round,
    versions,
    ...(values.reference ? { reference: resolve(values.reference) } : {}),
    ...(values.previous ? { previous: resolve(values.previous) } : {}),
    ...(values.lighting ? { lighting: values.lighting } : {}),
  });
  console.log(result.summary);
  for (const retake of result.review.retakes) console.log(`Retake ${retake.version} on ${retake.map}: ${JSON.stringify(retake.shots)}`);
  console.log(`Page: ${path.join(result.roundDir, "index.html")}`);
  if (result.review.problems.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
