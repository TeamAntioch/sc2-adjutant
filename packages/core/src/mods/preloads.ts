// DocumentInfo's preloads, kept honest as entries convert (ADR-0011: generated, never authored).
// The game reads a mod's <Preload> list at load and streams what it names before play:
// `AssetFile;<path>` a file, `GameLink:<Catalog>;<id>` an entry and what it uses, `Bank;<name>` a
// bank. It's a loading-time hint, not something a load needs (docs/reference/data-loading-and-dependencies.md).
//
//   carried   each preload the package's DocumentInfo has stays, in its place, except
//   dropped   an AssetFile nothing names any more: the entries that named its file are all owned
//             and none of them names it now, nor does any Kept entry, any other file in the
//             package (a cutscene, a layout, a script) or any file this compile writes
//   added     none. A file an owned entry names newly isn't preloaded: preloading every file the
//             entries name would grow one Campaign Mod's 13 preloads to about 1,555, untried in game
//             (#333 settles what the game wants)
//
// A GameLink stays: what its entry uses isn't always named by path, so dropping it could stop a
// preload unseen. A preload nothing in the catalogs names, such as a Bank, stays. So a mod whose
// Blueprint owns nothing keeps its preloads as they are, and converting an entry whose files the
// package preloads keeps them preloaded.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { catalogEntries } from "../map/catalog-entries.js";
import { decodeXml, type XmlNode, xmlTree } from "../util/xml.js";
import { GAME_DATA_DIR } from "../domain/mod-blueprint.js";

/** A model, sound or texture file named in a catalog. */
const ASSET = /[\\/][^\\/]*\.(m3|dds|tga|ogg|wav|mp3)$/i;
const sameFile = (value: string): string => value.replace(/\//g, "\\").toLowerCase();
/** The package's other files that can name an asset: cutscenes, layouts, styles, scripts, Triggers. */
const OTHER_TEXT = /\.(sc2cutscene|sc2layout|sc2style|galaxy|xml|txt)$|^Triggers$/i;

/** The asset files `xml` (catalog entries) names, each once, the same file however it's spelled. */
function assetsIn(xml: string): Set<string> {
  const out = new Set<string>();
  const visit = (node: XmlNode): void => {
    for (const [, value] of node.attributes) if (ASSET.test(value) && !value.includes("##")) out.add(sameFile(value));
    node.children.forEach(visit);
  };
  xmlTree(xml).forEach(visit);
  return out;
}

/** The preload values of `pkg`'s DocumentInfo, in order. */
export async function readPreloads(pkg: string): Promise<string[]> {
  const file = path.join(pkg, "DocumentInfo");
  if (!existsSync(file)) return [];
  const block = /<Preload>([\s\S]*?)<\/Preload>/.exec(await readFile(file, "utf8"))?.[1] ?? "";
  return [...block.matchAll(/<Value>([^<]*)<\/Value>/g)].map((match) => decodeXml(match[1]!.trim()));
}

/**
 * The preloads for a compile, as above: `owned` holds the catalog entries the Blueprint writes, by
 * GameData file, each entry's text; `files` every file in the package; `written` the other files
 * this compile writes, by path, as written.
 */
export async function modPreloads(pkg: string, files: readonly string[], owned: ReadonlyMap<string, readonly string[]>, written: ReadonlyMap<string, string | Uint8Array> = new Map()): Promise<string[]> {
  const carried = await readPreloads(pkg);
  if (!carried.some((value) => value.startsWith("AssetFile;"))) return carried;
  const ownedKeys = new Set<string>();
  const stillNamed = new Set<string>();
  for (const [file, texts] of owned) {
    for (const text of texts) {
      for (const entry of catalogEntries(`<Catalog>\n${text}\n</Catalog>`)) ownedKeys.add(`${file}:${entry.key}`);
      for (const asset of assetsIn(text)) stillNamed.add(asset);
    }
  }
  // Which files the package's entries name as it stands: its Kept entries, and those the Blueprint now owns.
  const ownedNames = new Set<string>();
  const catalogFiles = new Set(files.filter((name) => name.startsWith(GAME_DATA_DIR) && name.toLowerCase().endsWith(".xml")));
  for (const file of catalogFiles) {
    for (const entry of catalogEntries(await readFile(path.join(pkg, ...file.split("/")), "utf8"))) {
      const isOwned = ownedKeys.has(`${file}:${entry.key}`);
      for (const asset of assetsIn(entry.text)) (isOwned ? ownedNames : stillNamed).add(asset);
    }
  }
  /** Whether a text file outside the catalogs names `name`, as the package has it or as this compile writes it (read only when an AssetFile might go). */
  const otherFiles = files.filter((name) => !catalogFiles.has(name) && OTHER_TEXT.test(name));
  let otherText: string | undefined;
  const namedElsewhere = async (name: string): Promise<boolean> => {
    if (otherText === undefined) {
      const onDisk = await Promise.all(otherFiles.map((file) => readFile(path.join(pkg, ...file.split("/")), "latin1")));
      const now = [...written].flatMap(([file, content]) => (OTHER_TEXT.test(file) ? [typeof content === "string" ? content : Buffer.from(content).toString("latin1")] : []));
      otherText = sameFile([...onDisk, ...now].join("\n"));
    }
    return otherText.includes(name);
  };

  const out: string[] = [];
  for (const value of carried) {
    const asset = /^AssetFile;(.+)$/.exec(value)?.[1];
    if (asset !== undefined) {
      const name = sameFile(asset);
      // Named only by entries the Blueprint now owns, and nothing names it any more.
      if (!stillNamed.has(name) && ownedNames.has(name) && !(await namedElsewhere(name))) continue;
    }
    out.push(value);
  }
  return out;
}
