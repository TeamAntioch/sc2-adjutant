// The Kept report of a Workspace mod (ADR-0011, src/mods/kept-report.ts): the Kept Content left in
// it, by component and file, with a count; --items lists every item.
//
//   npm run kept-report -- <mods/<id>/blueprint.json> [--items]

import path from "node:path";
import { parseArgs } from "node:util";

import { formatKeptReport, keptReport } from "../mods/kept-report.js";

const USAGE = "Usage: kept-report <blueprint.json> [--items]";

async function main(): Promise<void> {
  let parsed: { positionals: string[]; values: { items?: boolean | undefined } };
  try {
    parsed = parseArgs({ allowPositionals: true, options: { items: { type: "boolean" } } });
  } catch (error) {
    console.error(`${(error as Error).message}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (parsed.positionals.length !== 1) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const blueprintPath = path.resolve(process.env.INIT_CWD ?? process.cwd(), parsed.positionals[0]!);
  console.log(formatKeptReport(await keptReport(blueprintPath), { items: parsed.values.items ?? false }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
