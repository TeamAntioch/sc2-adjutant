// Writes a card sheet's kept in-game frames into the set looks (core's
// data/cinematic-sets/looks.json, or a Workspace's with --looks) as each card picture's `game`
// counterpart: see capture/game-cards.ts. Then `npm run set-cards` copies them beside the
// pictures, from the frames' folder (its --game).
//
//   npm run game-cards -- <lighting.json> [--leave-out <set>[/<n>],...] [--looks <file>]
//
// lighting.json is the one capture-sets wrote with the frames. --leave-out names the sets, or a
// set's card picture n, whose frames are unusable: they get no counterpart, and lose one they had.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { adoptGameCards, type LightingRecord } from "../capture/game-cards.js";
import { parseSetLooks, type SetLook } from "../cutscene/set-looks.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const option = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const lightingFile = args.find((arg, at) => !arg.startsWith("--") && !["--leave-out", "--looks"].includes(args[at - 1] ?? ""));
  if (!lightingFile) throw new Error("Give the lighting.json capture-sets wrote with the frames");
  const looksFile = option("looks") ?? fileURLToPath(new URL("../../data/cinematic-sets/looks.json", import.meta.url));
  // The file as written, checked: parsing reorders a picture source's keys, which would rewrite lines nothing changed.
  const raw = JSON.parse(await readFile(looksFile, "utf8")) as Record<string, SetLook>;
  parseSetLooks(raw);
  const looks = raw;
  const record = JSON.parse(await readFile(lightingFile, "utf8")) as LightingRecord;
  const leaveOut = (option("leave-out") ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const unknown = leaveOut.filter((entry) => !looks[entry.split("/")[0]!]);
  if (unknown.length) throw new Error(`No look for ${unknown.join(", ")}`);
  const result = adoptGameCards(looks, record, leaveOut);
  parseSetLooks(result.looks);
  await writeFile(looksFile, `${JSON.stringify(result.looks, null, 2)}\n`);
  console.log(`${result.adopted.length} pictures given their in-game frame, ${result.leftOut.length} left out`);
  for (const name of result.unmatched) console.log(`  no such picture in the looks: ${name}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
