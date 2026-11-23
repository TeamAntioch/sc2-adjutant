// Reads every Cutscene Editor file under a folder (a Campaign's repo, or the downloaded Blizzard data).

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { EMPTY_REGISTRY } from "../plugins/plugin-api.js";
import { loadWorkspace, WORKSPACE_FILE, workspaceRootFor } from "../plugins/workspace.js";
import type { CutsceneSource } from "./set-catalog.js";
import { cutsceneSourceKinds, type CutsceneSourceKinds, sourceOptions } from "./source-kinds.js";

export async function loadCutsceneSources(root: string, origin: CutsceneSource["origin"]): Promise<CutsceneSource[]> {
  const entries = await readdir(root, { recursive: true });
  const files = entries.filter((entry) => /\.sc2cutscene$/i.test(entry)).sort();
  return Promise.all(files.map(async (file) => ({ origin, path: file.split(path.sep).join("/"), xml: await readFile(path.join(root, file), "utf8") })));
}

/**
 * The sources a catalog command's `--source <kind>=<dir>` options name, read in order. The kinds
 * are core's and those of the Workspace `--workspace <dir>` names, or else the one holding `cwd`,
 * or core's alone outside a Workspace. `cwd`, where the Workspace is looked for, defaults to the
 * folder `npm run` was started from (INIT_CWD), since npm runs scripts from the package root;
 * source folders are read as given. A Workspace that fails to load (a
 * broken Plugin) doesn't stop a run that reads only core's kinds; a Plugin kind then fails with
 * the reason.
 */
export async function loadCatalogSources(
  args: readonly string[],
  cwd = process.env.INIT_CWD ?? process.cwd(),
): Promise<{ readonly kinds: CutsceneSourceKinds; readonly roots: readonly { readonly origin: string; readonly root: string }[]; readonly sources: CutsceneSource[] }> {
  const named = args.indexOf("--workspace");
  const workspaceRoot = named >= 0 ? path.resolve(cwd, args[named + 1] ?? "") : workspaceRootFor(path.join(cwd, WORKSPACE_FILE));
  let registry = EMPTY_REGISTRY;
  let broken: string | undefined;
  if (workspaceRoot) {
    try {
      registry = (await loadWorkspace(workspaceRoot)).registry;
    } catch (error) {
      if (named >= 0) throw error;
      broken = (error as Error).message;
    }
  }
  const kinds = cutsceneSourceKinds(registry);
  let roots: ReturnType<typeof sourceOptions>;
  try {
    roots = sourceOptions(args, kinds);
  } catch (error) {
    if (!broken) throw error;
    throw new Error(`${(error as Error).message}. The Workspace at ${workspaceRoot} didn't load: ${broken}`, { cause: error });
  }
  const sources = (await Promise.all(roots.map(({ root, origin }) => loadCutsceneSources(root, origin)))).flat();
  return { kinds, roots, sources };
}
