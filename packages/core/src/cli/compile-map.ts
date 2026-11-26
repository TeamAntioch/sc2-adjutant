import { loadHost } from "../host/host.js";
import { loadMachineConfig } from "../host/machine-config.js";
import { compileMission, describePlaceholders } from "../map/compile-mission.js";
import { EditorChangesError } from "../map/editor-changes.js";
import { workspaceFor } from "../plugins/workspace.js";
import { parseCompileMapArgs } from "./compile-map-args.js";

async function main(): Promise<void> {
  let args: ReturnType<typeof parseCompileMapArgs>;
  try {
    args = parseCompileMapArgs(process.argv.slice(2));
  } catch (error) {
    console.error((error as Error).message);
    console.error("By default the Mission compiles in place, into the Map Package beside its Blueprint, and rewrites its compile-record.json.");
    console.error("Any other output folder is written whole, or with --copy gets a copy of that package, compiled as in place, its record beside it; the committed package is left alone.");
    console.error("When the Editor has changed Compiled Content, the compile stops and lists each change: --keep or --discard each one, or all of them.");
    process.exit(1);
  }
  const { blueprintPath, outputDir, copy, decisions } = args;

  const host = await loadHost(await loadMachineConfig());
  const compiled = await compileMission(await workspaceFor(blueprintPath), blueprintPath, outputDir, { host, decisions, ...(copy ? { copy } : {}) });
  const { warnings, placeholders } = compiled;

  console.log(`Map compiled in ${compiled.outputDir}`);
  const voices = describePlaceholders(placeholders);
  if (voices) console.log(voices);
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
}

main().catch((error) => {
  // A compile stopped on the author's Editor changes says so plainly.
  console.error(error instanceof EditorChangesError ? error.message : error);
  process.exit(1);
});
