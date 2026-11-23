// Imports a cinematic set into a Mission or a mod as data: <its folder>/sets/<set id>.json, with its
// pieces, marks, named cameras, base Lights and lamps in the set's own frame and where it came from.
// The set is found by its catalog name (data/cinematic-sets/README.md) among the `--source
// <kind>=<dir>` folders, as catalog-sets takes them, and read from its richest occurrence there
// unless --file names another (its path in its source, or its file name). The Workspace is the one
// --workspace names, else the one holding the folder npm was started from.
//
//   npm run import-set -- --mission <id> --source <kind>=<Campaign repo> "<set name>" [--file "<file>"]
//   npm run import-set -- --mod <id> --source <kind>=mods/<id> "<set name>" --file "<cutscene>"

import path from "node:path";

import { importSetIntoMission, importSetIntoMod } from "../cutscene/import-set.js";
import { cutsceneSourceKinds, sourceOptions } from "../cutscene/source-kinds.js";
import { loadWorkspace, WORKSPACE_FILE, workspaceRootFor } from "../plugins/workspace.js";

const USAGE = 'Usage: import-set (--mission <id> | --mod <id>) --source <kind>=<dir> [--source <kind>=<dir> ...] [--file <file>] [--workspace <dir>] "<set name>"';
const VALUED = new Set(["--mission", "--mod", "--source", "--file", "--workspace"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const option = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const names = args.filter((arg, index) => !VALUED.has(arg) && !VALUED.has(args[index - 1] ?? ""));
  const mission = option("mission");
  const mod = option("mod");
  if ((mission === undefined) === (mod === undefined) || names.length !== 1 || !args.includes("--source")) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const named = option("workspace");
  const root = named ? path.resolve(cwd, named) : workspaceRootFor(path.join(cwd, WORKSPACE_FILE));
  if (!root) throw new Error(`${cwd} isn't in a Workspace: run from one, or name it with --workspace`);
  const workspace = await loadWorkspace(root);
  const roots = sourceOptions(args, cutsceneSourceKinds(workspace.registry)).map(({ origin, root: dir }) => ({ origin, root: path.resolve(cwd, dir) }));
  const file = option("file");
  const options = file ? { file } : {};
  const imported = mod !== undefined ? await importSetIntoMod(workspace, mod, names[0]!, roots, options) : await importSetIntoMission(workspace, mission!, names[0]!, roots, options);
  const { provenance, pieces, marks, cameras, lamps } = imported.set;
  console.log(`Imported ${imported.set.name} (${pieces.length} pieces, ${marks.length} marks, ${cameras.length} cameras, ${lamps.length} lamps) from ${provenance!.kind}:${provenance!.file} to ${imported.path}`);
  for (const note of imported.notes) console.log(note);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
