// A sheet of terrain texture pictures, to choose textures by sight (src/catalog/texture-sheet.ts,
// ADR-0016). Name the textures, each with an optional label after "=", or search the catalog's
// descriptions; the sheet is a PNG. Pictures come from the sc2-mapping-reference gallery, fetched
// once into the machine's cache, or from a local copy of it with --gallery.
//
//   npm run texture-sheet -- --out sheet.png BraxisAlphaPlatesEx2 "MarSaraPanels=trim" ...
//   npm run texture-sheet -- --out sheet.png --words metal,grat --kind built --tones dark,mid [--suits path] [--without Aiur] [--limit 24]

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { lookUpTextures, searchTextures, type TextureKind, type TextureSuit, type TextureTone } from "@team-antioch/sc2-asset-catalog/catalog/texture-catalog.js";

import { stockTextures } from "../catalog/stock-catalog.js";
import { describeTexture, renderTextureSheet } from "../catalog/texture-sheet.js";
import { loadMachineConfig } from "../host/machine-config.js";

const USAGE =
  "Usage: texture-sheet --out <sheet.png> (<texture>[=label] ... | --words a,b [--without c,d] [--kind built|natural] [--tones dark,mid] [--suits base,path] [--tilesets X,Y] [--limit n]) [--columns n] [--gallery <sc2-mapping-reference/public/tilesets>]";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const valued = new Set(["--out", "--words", "--without", "--kind", "--tones", "--suits", "--tilesets", "--limit", "--columns", "--gallery"]);
  const options = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (valued.has(arg) && args[i + 1] !== undefined) options.set(arg, args[++i]!);
    else if (arg.startsWith("--")) return fail(`Unknown option ${arg}`);
    else positional.push(arg);
  }
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const out = options.get("--out");
  const list = (name: string) => options.get(name)?.split(",").filter(Boolean);
  const searching = ["--words", "--without", "--kind", "--tones", "--suits", "--tilesets"].some((name) => options.has(name));
  if (!out || (positional.length > 0) === searching || (positional.length === 0 && !searching)) return fail();
  const matches = searching
    ? searchTextures(stockTextures(), { words: list("--words"), without: list("--without"), kind: options.get("--kind") as TextureKind | undefined, tones: list("--tones") as TextureTone[] | undefined, suits: list("--suits") as TextureSuit[] | undefined, tilesets: list("--tilesets") })
    : [];
  const picked = searching
    ? matches.slice(0, Number(options.get("--limit") ?? 24)).map((texture) => ({ texture }))
    : positional.map((item) => {
        const [id, label] = item.split("=");
        return { texture: lookUpTextures(stockTextures(), [id!])[0]!, label };
      });
  if (picked.length === 0) return fail("No texture in the catalog matches");
  const machine = await loadMachineConfig();
  const gallery = options.get("--gallery");
  const { png, missing } = await renderTextureSheet(picked, {
    cacheDir: machine.cacheDir,
    ...(gallery ? { gallery: path.resolve(cwd, gallery) } : {}),
    columns: Number(options.get("--columns") ?? (searching ? 6 : 4)),
    size: 200,
  });
  const file = path.resolve(cwd, out);
  await writeFile(file, png);
  for (const { texture } of searching ? matches.map((texture) => ({ texture })) : picked) console.log(describeTexture(texture));
  if (searching && matches.length > picked.length) console.log(`${matches.length} matches, the first ${picked.length} on the sheet`);
  if (missing.length) console.log(`No picture: ${missing.join(", ")}`);
  console.log(`Wrote ${file}`);
}

function fail(message?: string): void {
  console.error(message ? `${message}\n${USAGE}` : USAGE);
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
