// Counts the node and element kinds in a folder of Cutscene Editor files and shows which our own code
// never names (issue #750, docs/reference/cutscene-coverage.md).
//
//   npm run cutscene-census -- <folder of .SC2Cutscene files> [--code <folder of our .ts>] [--json]
//
// Without --code it searches this package's src/cutscene, src/triggers, src/script, src/map and src/mods folders.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cutsceneFiles, formatCensus, sourceFiles, tagCensus } from "../cutscene/tag-census.js";
import { helpAsked, optionValue } from "./help-asked.js";

const VALUED = new Set(["--code"]);

function main(): void {
  const args = process.argv.slice(2);
  if (helpAsked(args, VALUED)) {
    console.log("Usage: cutscene-census <folder of .SC2Cutscene files> [--code <folder of our .ts>] [--json]");
    return;
  }
  const folders: string[] = [];
  const code: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--code") code.push(optionValue(args, i++, arg));
    else if (arg === "--json") continue;
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else folders.push(arg);
  }
  if (folders.length !== 1) throw new Error("Give one folder of .SC2Cutscene files");
  // dist/cli -> the package's src, which holds the sources the compile is written in.
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");
  const searched = code.length ? code.map((dir) => ({ dir, label: path.basename(dir) })) : ["cutscene", "triggers", "script", "map", "mods"].map((name) => ({ dir: path.join(src, name), label: name }));
  const files = cutsceneFiles(folders[0]!);
  if (files.length === 0) throw new Error(`No .SC2Cutscene files under ${folders[0]}`);
  const census = tagCensus(files.map((file) => ({ name: path.relative(folders[0]!, file), xml: readFileSync(file, "utf8") })), searched.flatMap(({ dir, label }) => sourceFiles(dir, label)));
  console.log(args.includes("--json") ? JSON.stringify(census, null, 2) : formatCensus(census));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
