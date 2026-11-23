// Makes the card pictures the set looks record (each picture's `from`, in core's
// data/cinematic-sets/looks.json, or a Workspace's cinematic-sets/looks.json with --looks), for the
// Set Finder's cards: see capture/set-cards.ts. The sets must have been drawn by render-set-views
// first. A picture already made from the same record is kept.
//
//   npm run set-cards -- [<set id>...] [--force] [--blender <program>] [--views <dir>]
//     [--captures <dir>] [--game <dir>] [--looks <file>]
//
// With no set id it makes every set's. --captures is the folder of in-game captures (capture-sets),
// a folder a set: the machine's cache by default. --game is the folder of in-game card frames
// (capture-sets on a card sheet, issue #790), a folder a set, each picture's `game` counterpart
// copied from it: the cache's set-shots/cards by default. A picture that can't be made is listed with why.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { drawSetCards } from "../capture/set-cards.js";
import { parseSetLooks } from "../cutscene/set-looks.js";
import { hostContext, loadMachineConfig } from "../host/machine-config.js";

const VALUED = new Set(["--blender", "--views", "--captures", "--game", "--looks"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const ids = args.filter((arg, at) => !arg.startsWith("--") && !VALUED.has(args[at - 1] ?? ""));
  // The machine's cache folder holds both by default; with --views given and no cache folder set, there are no captures.
  const cache = option("views") && option("captures") ? undefined : hostContext(await loadMachineConfig()).machine.cacheDir;
  const views = option("views") ?? (cache ? path.join(cache, "set-views") : undefined);
  if (!views) throw new Error("No cache folder is set on this machine: give --views <dir>");
  const captures = option("captures") ?? (cache ? path.join(cache, "set-shots", "story") : undefined);
  const game = option("game") ?? (cache ? path.join(cache, "set-shots", "cards") : undefined);
  const looksFile = option("looks") ?? fileURLToPath(new URL("../../data/cinematic-sets/looks.json", import.meta.url));
  const looks = parseSetLooks(JSON.parse(await readFile(looksFile, "utf8")));
  const unknown = ids.filter((id) => !looks[id]);
  if (unknown.length) throw new Error(`No look for ${unknown.join(", ")} in ${looksFile}`);

  let made = 0;
  let kept = 0;
  const missing: string[] = [];
  for (const id of ids.length ? ids : Object.keys(looks)) {
    const setDir = path.join(views, id);
    if (!existsSync(path.join(setDir, "spec.json"))) {
      missing.push(`${id}: not drawn (render-set-views draws it)`);
      continue;
    }
    const capturesDir = captures ? path.join(captures, id) : undefined;
    const gameDir = game ? path.join(game, id) : undefined;
    const result = await drawSetCards({
      setDir,
      look: looks[id]!,
      blender: option("blender") ?? "blender",
      force: args.includes("--force"),
      ...(capturesDir && existsSync(capturesDir) ? { capturesDir } : {}),
      ...(gameDir && existsSync(gameDir) ? { gameDir } : {}),
    });
    made += result.made.length;
    kept += result.kept.length;
    missing.push(...result.missing.map((entry) => `${id}/${entry.file}: ${entry.why}`));
    if (result.made.length) console.log(`${id}: made ${result.made.join(", ")}`);
  }
  console.log(`${made} made, ${kept} kept, ${missing.length} not made`);
  for (const line of missing) console.log(`  ${line}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
