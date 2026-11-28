// The game's own files the tuner reads, made on this machine from its install and never committed
// (ADR-0027): the stock terrain catalogs, for a texture's entry, and the texture's normal map. They
// come out of the install's CASC storage through the extractor SC2_CASC_TOOL names, called as
// stormex is (tools/README.md in the sc2-adjutant repo):
//
//   $SC2_CASC_TOOL -S <install folder> -I <case-insensitive regex> -x -o <folder>

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export const CASC_TOOL_VARIABLE = "SC2_CASC_TOOL";

/** Where installing an extractor is explained. */
const INSTALL_HELP = "https://github.com/TeamAntioch/sc2-adjutant/blob/main/tools/README.md#a-casc-extractor";

/** The mods whose GameData holds the stock terrain catalogs, in load order: a later one's fields win. */
export const STOCK_MODS = ["core", "liberty", "swarm", "void"] as const;

/** The extractor SC2_CASC_TOOL names. Throws, saying how to install one, when it's unset or missing. */
export function cascTool(env: NodeJS.ProcessEnv = process.env): string {
  const tool = env[CASC_TOOL_VARIABLE];
  if (!tool) throw new Error(`${CASC_TOOL_VARIABLE} isn't set. The tuner reads the texture's normal map from your StarCraft II install with a CASC extractor: install stormex and set ${CASC_TOOL_VARIABLE} to it (${INSTALL_HELP})`);
  if (!existsSync(tool)) throw new Error(`${CASC_TOOL_VARIABLE} is ${tool}, which doesn't exist (${INSTALL_HELP})`);
  return tool;
}

/** A regex source matching a storage path ending in `parts`, any separator between them, any case. */
export const storagePattern = (...parts: string[]): string => `(^|[\\\\/])${parts.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\\\/]")}$`;

/** Extracts every storage path matching one of `patterns` into `folder`. */
export async function extract(install: string, patterns: readonly string[], folder: string, tool = cascTool()): Promise<void> {
  await mkdir(folder, { recursive: true });
  const regex = patterns.length === 1 ? patterns[0]! : `(?:${patterns.join("|")})`;
  try {
    await promisify(execFile)(tool, ["-S", install, "-I", regex, "-x", "-o", folder], { maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    const reason = (error as { stderr?: string }).stderr || (error as Error).message;
    throw new Error(`${CASC_TOOL_VARIABLE} (${tool}) couldn't extract ${regex} from ${install}: ${String(reason).trim()}`);
  }
}

/** Every file under `folder`, by its path below it lower-cased with / separators: extractors write paths in any case. */
export async function filesByLowerPath(folder: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (!existsSync(folder)) return found;
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    found.set(path.relative(folder, full).split(path.sep).join("/").toLowerCase(), full);
  }
  return found;
}

/** The storage path of a mod's terrain catalog, lower-cased. */
export const catalogPath = (mod: string, file: "terraintexdata.xml" | "terraindata.xml"): string => `mods/${mod}.sc2mod/base.sc2data/gamedata/${file}`;

/** The patterns of the stock terrain catalogs. */
export const CATALOG_PATTERNS = STOCK_MODS.flatMap((mod) => ["terraintexdata.xml", "terraindata.xml"].map((file) => storagePattern("mods", `${mod}.sc2mod`, "base.sc2data", "gamedata", file)));

/** A CTerrainTex as the game's catalogs merge it: its single-valued fields, by name. */
export type StockTexture = { readonly id: string; readonly fields: Readonly<Record<string, string>> };

type Entry = { readonly id: string; readonly parent?: string; readonly isDefault: boolean; readonly fields: Record<string, string> };

/** The entries of one catalog's `kind` (CTerrainTex, CTerrain), each with its `<Field value="…"/>` children. Fields with an index, and nested ones, are left out. */
export function catalogEntries(xml: string, kind: string): Entry[] {
  const entries: Entry[] = [];
  const opening = new RegExp(`<${kind}\\b([^>]*?)(/?)>`, "g");
  for (let match = opening.exec(xml); match; match = opening.exec(xml)) {
    const attributes = match[1]!;
    const id = /\bid="([^"]*)"/.exec(attributes)?.[1];
    const parent = /\bparent="([^"]*)"/.exec(attributes)?.[1];
    const isDefault = /\bdefault="1"/.test(attributes);
    const fields: Record<string, string> = {};
    if (match[2] !== "/") {
      const end = xml.indexOf(`</${kind}>`, opening.lastIndex);
      const body = xml.slice(opening.lastIndex, end < 0 ? xml.length : end);
      // Only the entry's own top-level single fields: <Name value="…"/> with no index, not inside another element.
      let depth = 0;
      for (const tag of body.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
        const [, closing, name, attributes, selfClosing] = tag as unknown as [string, string, string, string, string];
        if (closing) depth--;
        else if (!selfClosing) depth++;
        else if (depth === 0 && !/\bindex=/.test(attributes)) {
          const value = /\bvalue="([^"]*)"/.exec(attributes)?.[1];
          if (value !== undefined) fields[name] = value;
        }
      }
      opening.lastIndex = end < 0 ? xml.length : end;
    }
    if (id === undefined && !isDefault) continue;
    entries.push({ id: id ?? "", ...(parent !== undefined ? { parent } : {}), isDefault, fields });
  }
  return entries;
}

/**
 * The CTerrainTex `id` as the stock catalogs give it: the kind's default entry, its parent's
 * fields, then its own, each mod's over the one before. Undefined when no stock catalog has it.
 */
export function stockTexture(catalogs: readonly string[], id: string): StockTexture | undefined {
  const all = catalogs.flatMap((xml) => catalogEntries(xml, "CTerrainTex"));
  if (!all.some((entry) => entry.id === id && !entry.isDefault)) return undefined;
  const resolve = (entryId: string, seen: Set<string>): Record<string, string> => {
    if (seen.has(entryId)) return {};
    seen.add(entryId);
    const own = all.filter((entry) => entry.id === entryId && !entry.isDefault);
    const parent = own.findLast((entry) => entry.parent !== undefined)?.parent;
    return Object.assign({}, parent !== undefined ? resolve(parent, seen) : {}, ...own.map((entry) => entry.fields));
  };
  const defaults = Object.assign({}, ...all.filter((entry) => entry.isDefault).map((entry) => entry.fields));
  return { id, fields: { ...defaults, ...resolve(id, new Set()) } };
}

/** Whether the stock CTerrain `tileset` height-blends (HeightMapEnabled 1), the last catalog that sets it winning; undefined when none does. */
export function stockHeightMapEnabled(catalogs: readonly string[], tileset: string): boolean | undefined {
  let enabled: boolean | undefined;
  for (const xml of catalogs) for (const entry of catalogEntries(xml, "CTerrain")) if (entry.id === tileset && entry.fields.HeightMapEnabled !== undefined) enabled = entry.fields.HeightMapEnabled === "1";
  return enabled;
}

/** A game path (`Assets\Textures\X.dds`) as a storage path pattern and as the lower-case tail an extracted file's path ends in. */
export function gameFile(gamePath: string): { readonly pattern: string; readonly tail: string } {
  const parts = gamePath.split(/[\\/]+/).filter(Boolean);
  return { pattern: storagePattern(...parts), tail: parts.join("/").toLowerCase() };
}

/** The extracted file whose lower-case path ends in `tail`, from the last mod that has it. */
export function findExtracted(files: Map<string, string>, tail: string): string | undefined {
  const matches = [...files.keys()].filter((key) => key === tail || key.endsWith(`/${tail}`));
  const rank = (key: string): number => STOCK_MODS.findIndex((mod) => key.includes(`mods/${mod}.sc2mod/`));
  matches.sort((a, b) => rank(a) - rank(b));
  const last = matches.at(-1);
  return last === undefined ? undefined : files.get(last);
}

/** The stock terrain catalogs from an extraction folder, in load order (each mod's CTerrainTex file, then its CTerrain one). */
export async function readCatalogs(files: Map<string, string>): Promise<{ readonly textures: string[]; readonly terrains: string[] }> {
  const read = async (key: string): Promise<string[]> => {
    const file = files.get(key);
    return file === undefined ? [] : [await readFile(file, "utf8")];
  };
  const textures: string[] = [];
  const terrains: string[] = [];
  for (const mod of STOCK_MODS) {
    textures.push(...(await read(catalogPath(mod, "terraintexdata.xml"))));
    terrains.push(...(await read(catalogPath(mod, "terraindata.xml"))));
  }
  return { textures, terrains };
}
