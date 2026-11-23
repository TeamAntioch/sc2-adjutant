// Imports a mod built outside the Workspace as a new Workspace mod (ADR-0011): copies it to
// mods/<id>/<Name>.SC2Mod, never writing to the source, writes a minimal Mod Blueprint and an
// empty compile record, so everything in it starts as Kept Content, and names it in the Workspace
// config; an Asset Mod's binaries go in Git LFS (src/mods/import-mod.ts).
//
//   npm run import-mod -- <source.SC2Mod> <modId> [--kind campaign|asset]
//
// Paths are relative to where the command was typed; the Workspace is the one above it.

import path from "node:path";
import { parseArgs } from "node:util";

import { MOD_KINDS, type ModKind } from "../domain/mod-blueprint.js";
import { importMod } from "../mods/import-mod.js";
import { loadWorkspace, WORKSPACE_FILE, workspaceRootFor } from "../plugins/workspace.js";

const USAGE = "Usage: import-mod <source.SC2Mod> <modId> [--kind campaign|asset]";

async function main(): Promise<void> {
  let parsed: { positionals: string[]; values: { kind?: string | undefined } };
  try {
    parsed = parseArgs({ allowPositionals: true, options: { kind: { type: "string" } } });
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : error}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const { positionals, values } = parsed;
  const [source, modId] = positionals;
  const cwd = process.env.INIT_CWD ?? process.cwd();
  if (!source || !modId || positionals.length > 2 || (values.kind !== undefined && !(MOD_KINDS as readonly string[]).includes(values.kind))) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const root = workspaceRootFor(path.join(cwd, WORKSPACE_FILE));
  if (!root) {
    console.error(`${cwd} isn't in a Workspace (no ${WORKSPACE_FILE} in any folder above it)`);
    process.exitCode = 2;
    return;
  }
  const imported = await importMod(await loadWorkspace(root), path.resolve(cwd, source), modId, values.kind ? { kind: values.kind as ModKind } : {});
  for (const note of imported.notes) console.log(note);
  console.log(`Wrote ${imported.blueprintPath} and its empty compile record`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
