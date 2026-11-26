// The compile-map CLI's arguments (compile-map.ts): the Blueprint, an optional output folder (with
// --copy, a copy of the committed package to compile into), and the author's decisions on Compiled Content changed in the Editor (src/map/editor-changes.ts).

import { type EditorDecisions, editorDecisions } from "../map/editor-changes.js";

export const COMPILE_MAP_USAGE = "Usage: compile-map <blueprint.json> [<output-dir> [--copy]] [--keep <entry>]... [--discard <entry>]... [--keep-all | --discard-all]";

/** `copy`: compile into a copy of the Mission's committed package at the output folder (compileMission's `copy`). */
export type CompileMapArgs = { readonly blueprintPath: string; readonly outputDir?: string; readonly copy?: true; readonly decisions: EditorDecisions };

/** The positional arguments and the author's decisions (--keep, --discard, --keep-all, --discard-all), shared with compile-mod. */
export function parseDecisionArgs(argv: readonly string[], usage: string): { readonly positional: readonly string[]; readonly decisions: EditorDecisions } {
  const positional: string[] = [];
  const keep: string[] = [];
  const discard: string[] = [];
  let keepAll = false;
  let discardAll = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--keep" || arg === "--discard") {
      const entry = argv[++index];
      if (entry === undefined || entry.startsWith("--")) throw new Error(`${arg} needs an entry, such as object:1234 (the compile lists them when it stops)`);
      (arg === "--keep" ? keep : discard).push(entry);
    } else if (arg === "--keep-all") {
      keepAll = true;
    } else if (arg === "--discard-all") {
      discardAll = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option ${arg}. ${usage}`);
    } else {
      positional.push(arg);
    }
  }
  return { positional, decisions: editorDecisions({ keep, discard, keepAll, discardAll }) };
}

export function parseCompileMapArgs(argv: readonly string[]): CompileMapArgs {
  const copy = argv.includes("--copy");
  const { positional, decisions } = parseDecisionArgs(
    argv.filter((arg) => arg !== "--copy"),
    COMPILE_MAP_USAGE,
  );
  const [blueprintPath, outputDir] = positional;
  if (!blueprintPath || positional.length > 2) throw new Error(COMPILE_MAP_USAGE);
  if (copy && !outputDir) throw new Error(`--copy needs an output folder, the copy of the Mission's Map Package to compile into. ${COMPILE_MAP_USAGE}`);
  return { blueprintPath, ...(outputDir ? { outputDir } : {}), ...(copy ? { copy: true as const } : {}), decisions };
}
