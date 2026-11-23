// The dependencies a Map Package or mod package lists in its DocumentInfo, as the Editor wrote
// them: what Import reads into a Mission Blueprint or a Mod Blueprint. Each is its text, its XML
// entities read (`&amp;` is `&`), as the compile writes it back escaped.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { pathInAnyCase } from "../catalog/package-files.js";
import { decodeXmlText } from "./xml-elements.js";

/**
 * The dependency strings in `packageDir`'s DocumentInfo, in its order; none when it has no
 * DocumentInfo. `anyCase` finds it in any case, as the game finds one in its own data (which holds
 * names lower-cased); a package the compile writes back is read by its exact name, as it writes it.
 */
export async function readDependencies(packageDir: string, { anyCase = false }: { readonly anyCase?: boolean } = {}): Promise<string[]> {
  const exact = path.join(packageDir, "DocumentInfo");
  const file = anyCase ? pathInAnyCase(packageDir, "DocumentInfo") : existsSync(exact) ? exact : undefined;
  if (file === undefined) return [];
  const block = /<Dependencies>([\s\S]*?)<\/Dependencies>/.exec(await readFile(file, "utf8"))?.[1] ?? "";
  return [...block.matchAll(/<Value>([^<]+)<\/Value>/g)].map((match) => decodeXmlText(match[1]!.trim()));
}
