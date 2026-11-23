// The convert step for an Asset Mod's files (ADR-0011, asset-sources.ts): it declares the Kept art
// and audio files of the package (those in its .SC2Assets folders) as Workspace-file Asset Sources
// in bulk. Each is copied into the mod's folder as assets/<path in the package> (one Git LFS object
// with the package's copy, since LFS stores a file by its SHA-256) and listed in the Blueprint's
// `assets` with its hash. The next compile-mod writes each back over its Kept original, under the
// Equivalence Check, which moves it from Kept to Compiled.
//
// Which files came from somewhere else (another game, a community pack) can't be told from the
// bytes, so the step lists the files whose names suggest another origin, for the author's
// provenance and licence check, and records the origins the author gives, by glob, on every
// Workspace-file Asset Source they match. A file a machine hasn't pulled from Git LFS stays Kept.

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { type AssetFile, isWorkspaceFile, type Origin, type WorkspaceFileSource } from "../domain/asset-source.js";
import { isLfsPointer, sha256 } from "./asset-sources.js";
import { convertTarget, ownedFiles, stageBlueprint } from "./convert-files.js";

/** Where convert-assets puts a file's Workspace copy in the mod's folder. */
export const ASSETS_DIR = "assets";

/** An Asset Mod's art and audio: what its .SC2Assets folders hold. */
const ASSET_FILE = /^[^/]+\.SC2Assets\//i;

/** Names that, in any mod, suggest a file came from another game, and why. */
export const DEFAULT_SUSPECTS: readonly { readonly match: string; readonly why: string }[] = [
  { match: "storm_*", why: "Heroes of the Storm names its assets storm_…: likely a port of a Blizzard asset from it" },
];

/** An origin the author gives to the Workspace files whose package path matches `match` (a glob). */
export type OriginRule = { readonly match: string; readonly origin: Origin };

export type ConvertAssetsOptions = {
  /** The files to convert, by path in the package; every Kept file of its .SC2Assets folders when not given. */
  readonly paths?: readonly string[];
  /** More globs whose files the author should check the provenance of, beside DEFAULT_SUSPECTS. */
  readonly suspects?: readonly string[];
  /** Origins to record, each on every Workspace-file Asset Source it matches, converted now or before. */
  readonly origins?: readonly OriginRule[];
};

export type ConvertedAssets = {
  /** Each file converted, by path in the package, in the package's order. */
  readonly converted: readonly string[];
  /** Each file left Kept, with why. */
  readonly refused: readonly { readonly path: string; readonly reason: string }[];
  /** Each Asset Source whose origin this run recorded or changed. */
  readonly origins: readonly { readonly path: string; readonly origin: Origin }[];
  /** Each Workspace file with no origin whose name suggests another, for the author's provenance and licence check. */
  readonly suspects: readonly { readonly path: string; readonly why: string }[];
};

/**
 * Whether `file` (a package path) matches `glob`, in any case, as the game reads files: `*` is any
 * run of a name, `**` any run of folders, `?` one character, and a glob without a slash matches the
 * file's name alone.
 */
export function matchesGlob(glob: string, file: string): boolean {
  const pattern = glob
    .split(/(\*\*\/?|\*|\?)/)
    .map((part) => (part === "**/" ? "(?:.*/)?" : part === "**" ? ".*" : part === "*" ? "[^/]*" : part === "?" ? "[^/]" : part.replace(/[.+^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${pattern}$`, "i").test(glob.includes("/") ? file : file.slice(file.lastIndexOf("/") + 1));
}

/** Converts the Kept art and audio files of the Asset Mod of `blueprintPath` into Workspace-file Asset Sources, as above. */
export async function convertAssets(blueprintPath: string, { paths, suspects = [], origins = [] }: ConvertAssetsOptions = {}): Promise<ConvertedAssets> {
  const { blueprint, pkg, record, dir, files } = await convertTarget(blueprintPath);
  if (blueprint.kind !== "asset") throw new Error(`${blueprint.id} is a Campaign Mod: only an Asset Mod has Asset Sources`);
  const owned = ownedFiles(blueprint, record);
  const refused: { path: string; reason: string }[] = [];

  let candidates: string[];
  if (paths) {
    const asked = new Set<string>();
    for (const name of paths) {
      const file = files.find((other) => other.toLowerCase() === name.toLowerCase());
      if (!file) throw new Error(`The mod package has no ${name}`);
      if (!ASSET_FILE.test(file)) throw new Error(`${file} isn't an art or audio file in one of the package's .SC2Assets folders`);
      asked.add(file);
    }
    // In the package's order, as without names.
    candidates = files.filter((file) => asked.has(file));
    for (const file of candidates) if (owned.has(file.toLowerCase())) refused.push({ path: file, reason: "the Blueprint already writes it" });
    candidates = candidates.filter((file) => !owned.has(file.toLowerCase()));
  } else {
    candidates = files.filter((file) => ASSET_FILE.test(file) && !owned.has(file.toLowerCase()));
  }

  // A Workspace copy already in the mod's folder is taken when it's the package's file, and refused when it isn't.
  const added: AssetFile[] = [];
  const copies: string[] = [];
  for (const file of candidates) {
    const bytes = await readFile(path.join(pkg, ...file.split("/")));
    if (isLfsPointer(bytes)) {
      refused.push({ path: file, reason: "it's a Git LFS pointer, its file not pulled on this machine (git lfs pull, then convert it)" });
      continue;
    }
    const source = `${ASSETS_DIR}/${file}`;
    const target = path.join(dir, ...source.split("/"));
    if (existsSync(target)) {
      if (!(await readFile(target)).equals(bytes)) {
        refused.push({ path: file, reason: `the mod's folder already has ${source}, with other bytes: move it, or declare it in assets yourself` });
        continue;
      }
    } else copies.push(file);
    added.push({ path: file, source: { file: source, sha256: sha256(bytes) } });
  }

  // The origins, on every Workspace file they match, the Blueprint's and the new ones.
  const recorded: { path: string; origin: Origin }[] = [];
  const assets = [...blueprint.assets, ...added].map((asset): AssetFile => {
    if (!isWorkspaceFile(asset.source)) return asset;
    const rule = origins.findLast((candidate) => matchesGlob(candidate.match, asset.path));
    if (!rule || sameOrigin(rule.origin, asset.source.origin)) return asset;
    recorded.push({ path: asset.path, origin: rule.origin });
    return { ...asset, source: { ...asset.source, origin: rule.origin } satisfies WorkspaceFileSource };
  });
  for (const rule of origins) {
    if (!assets.some((asset) => isWorkspaceFile(asset.source) && matchesGlob(rule.match, asset.path))) throw new Error(`The origin for ${rule.match} matches none of the Asset Mod's files kept in the Workspace: check the glob (a glob without a slash matches a file's name)`);
  }

  const suspected: { path: string; why: string }[] = [];
  const rules = [...DEFAULT_SUSPECTS, ...suspects.map((match) => ({ match, why: `its name matches ${match}` }))];
  for (const asset of assets) {
    if (!isWorkspaceFile(asset.source) || asset.source.origin) continue;
    const rule = rules.find((candidate) => matchesGlob(candidate.match, asset.path));
    if (rule) suspected.push({ path: asset.path, why: rule.why });
  }
  const order = <T extends { readonly path: string }>(list: T[]): T[] => list.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  if (added.length > 0 || recorded.length > 0) {
    // The Blueprint is checked before any file is copied.
    const write = await stageBlueprint(blueprintPath, (raw) => ({ ...raw, assets }));
    for (const file of copies) {
      const target = path.join(dir, ASSETS_DIR, ...file.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(pkg, ...file.split("/")), target);
    }
    await write();
  }
  return { converted: added.map((asset) => asset.path), refused, origins: order(recorded), suspects: order(suspected) };
}

/** Whether two origins say the same, whatever order their fields were given in. */
const sameOrigin = (a: Origin, b: Origin | undefined): boolean => {
  if (!b) return false;
  const fields = (origin: Origin) => JSON.stringify(Object.entries(origin).sort(([x], [y]) => (x < y ? -1 : 1)));
  return fields(a) === fields(b);
};

/** What a conversion did, for the author: what converted, each origin recorded, each file left Kept and each file to check. */
export function formatConvertedAssets({ converted, refused, origins, suspects }: ConvertedAssets): string {
  return [
    converted.length > 0 ? `Converted ${converted.length} file(s) into Workspace files in ${ASSETS_DIR}/` : "Converted no files",
    ...(origins.length > 0 ? [`Recorded the origin of ${origins.length} file(s)`] : []),
    ...refused.map((item) => `Left Kept: ${item.path}: ${item.reason}`),
    ...(suspects.length > 0 ? [`${suspects.length} file(s) whose names suggest another origin, for your provenance and licence check (record each with --origins):`, ...suspects.map((item) => `  ${item.path}: ${item.why}`)] : []),
  ].join("\n");
}
