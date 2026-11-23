// Compares a Map Package before and after an Editor open-and-save, for the three load-and-save claims of
// issue #744 (docs/reference/editor-saves.md). Copy the package first, open the original in the Editor,
// make the edit being tested, save, close, then:
//
//   npm run compare-saves -- <package before> <package after> [--touched <id,id,...>] [--json]

import { compareSaves, formatSaveComparison } from "../map/save-comparison.js";
import { helpAsked, optionValue } from "./help-asked.js";

const VALUED = new Set(["--touched"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (helpAsked(args, VALUED)) {
    console.log("Usage: compare-saves <package before> <package after> [--touched <id,id,...>] [--json]");
    return;
  }
  const folders: string[] = [];
  let touched: string[] | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--touched") touched = optionValue(args, i++, arg).split(",").map((id) => id.trim()).filter(Boolean);
    else if (arg === "--json") continue;
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else folders.push(arg);
  }
  if (folders.length !== 2) throw new Error("Give the package before and the package after");
  const result = await compareSaves(folders[0]!, folders[1]!, touched);
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : formatSaveComparison(result, touched !== undefined));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
