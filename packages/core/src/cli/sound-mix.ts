// The actor data that plays a sound mix: several CSounds as one sound, each from its own time
// (src/mods/sound-mix.ts, docs/reference/sound-mixes.md). Reads a mix file (one mix or a list) and
// prints its entries: Generic Entries for a Mod Blueprint's entries, or with --xml the elements to
// add to a map's ActorData.xml. Every CSound a layer plays is checked against the game's data and
// the own data given with --sounds (a SoundData.xml, a JSON file of Generic Entries, or a folder of
// them, such as a .SC2Map, a .SC2Mod or a Mod Blueprint's entries); one defined nowhere would play
// nothing, so the command refuses it.
//
//   npm run sound-mix -- <mix.json> [--xml] [--sounds <file or folder>]... [--out <file>]

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { checkSoundMixes, definedSounds, SoundMixFileSchema, soundMixEntries, soundMixWiring, soundMixXml } from "../mods/sound-mix.js";
import { helpAsked, optionValue } from "./help-asked.js";

const USAGE = "Usage: sound-mix <mix.json> [--xml] [--sounds <file or folder>]... [--out <file>]";
const VALUED = new Set(["--sounds", "--out"]);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (helpAsked(args, VALUED)) {
    console.log(USAGE);
    return;
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const sources: string[] = [];
  let xml = false;
  let out: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--xml") xml = true;
    else if (arg === "--sounds") sources.push(path.resolve(cwd, optionValue(args, i++, arg)));
    else if (arg === "--out") out = path.resolve(cwd, optionValue(args, i++, arg));
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}. ${USAGE}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) {
    console.error(USAGE);
    process.exitCode = 2;
    return;
  }
  const file = path.resolve(cwd, positional[0]!);
  const parsed = SoundMixFileSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) throw new Error(`${file} isn't a sound mix file: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(top)"}: ${issue.message}`).join("; ")}`);
  const mixes = parsed.data;
  const own = new Set<string>();
  for (const source of sources) for (const id of await definedSounds(source)) own.add(id);
  const { found, problems } = checkSoundMixes(mixes, own);
  for (const [sound, where] of found) console.error(`  ${sound}: ${where.join(", ")}`);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    process.exitCode = 1;
    return;
  }
  const entries = mixes.flatMap(soundMixEntries);
  const text = xml ? `${soundMixXml(entries)}\n` : `${JSON.stringify(entries, null, 2)}\n`;
  if (out) await writeFile(out, text);
  else process.stdout.write(text);
  console.error(`${entries.length} actor${entries.length === 1 ? "" : "s"} for ${mixes.length} mix${mixes.length === 1 ? "" : "es"}${out ? ` -> ${out}` : ""}.`);
  console.error(`Create each from the actor of the unit it's for, on the event it's for. On a death: ${soundMixWiring(mixes[0]!)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
