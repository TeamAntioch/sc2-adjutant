// A mod package's files, and which of its GameData catalog files the game loads: each directly in
// GameData named by its catalog (UnitData.xml, WaterData.xml …), and any other once the package's
// includes list (Base.SC2Data/GameData.xml) names it. Shared by the compile and the catalog layer;
// kept free of the compile's modules, since the catalog layer loads with every Workspace.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { GAME_DATA_DIR } from "../domain/mod-blueprint.js";
import { decodeXml } from "../util/xml.js";
import { catalogOfFile } from "./catalog-schema.js";

/** Every file in the package, by its path inside it with forward slashes; none when there's no package. */
export async function packageFiles(root: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  return (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

/** Where a package's includes list is, as the game reads it: in any case. */
export const INCLUDES_FILE = "Base.SC2Data/GameData.xml";

/** The package's includes list as `files` (the package's) spell it, if it has one. */
export const includesFile = (files: readonly string[]): string | undefined => files.find((file) => file.toLowerCase() === INCLUDES_FILE.toLowerCase());

/** The catalog files the includes list `text` names, as package paths with forward slashes, in its order. */
export const listedCatalogs = (text: string): string[] => [...text.matchAll(/<Catalog\s+path="([^"]+)"/gi)].map((match) => `Base.SC2Data/${decodeXml(match[1]!).replace(/\\/g, "/")}`);

/** The catalog files the package's includes list names, as package paths in its order; none when it has no list. `files` are the package's. */
export async function readIncludes(pkg: string, files: readonly string[]): Promise<string[]> {
  const list = includesFile(files);
  return list ? listedCatalogs(await readFile(path.join(pkg, ...list.split("/")), "utf8")) : [];
}

/** The catalog files the package's includes list names, as package paths in lower case; `files` are the package's. */
export async function includedCatalogs(pkg: string, files: readonly string[]): Promise<Set<string>> {
  return new Set((await readIncludes(pkg, files)).map((file) => file.toLowerCase()));
}

/** Whether the game loads the GameData file `file` (a package path) without an includes list: one directly in GameData named for its catalog. */
export function standardCatalogFile(file: string): boolean {
  const name = file.slice(GAME_DATA_DIR.length);
  return file.toLowerCase().startsWith(GAME_DATA_DIR.toLowerCase()) && !name.includes("/") && catalogOfFile(name) !== undefined;
}

/**
 * The includes list naming `files` (package paths in GameData) in their order, as the Editor
 * writes it: `kept`'s XML declaration and line endings when given (the package's own list), else
 * UTF-8 and LF.
 */
export function includesList(files: readonly string[], kept?: string): string {
  const eol = kept?.includes("\r\n") ? "\r\n" : "\n";
  const declaration = (kept && /^﻿?<\?xml[^>]*\?>/.exec(kept)?.[0]) ?? `<?xml version="1.0" encoding="utf-8"?>`;
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return [declaration, "<Includes>", ...files.map((file) => `    <Catalog path="${escape(file.slice("Base.SC2Data/".length))}"/>`), "</Includes>", ""].join(eol);
}

/** The package's catalog files the game loads, as package paths in path order: its folders matched in any case, as the game reads them. */
export async function loadedCatalogFiles(pkg: string): Promise<string[]> {
  const files = await baseDataFiles(pkg);
  const included = await includedCatalogs(pkg, files);
  const dir = GAME_DATA_DIR.toLowerCase();
  return files.filter((file) => {
    const lower = file.toLowerCase();
    if (!lower.startsWith(dir) || !lower.endsWith(".xml")) return false;
    return included.has(lower) || standardCatalogFile(file);
  });
}

/**
 * The files in the package's Base.SC2Data folder (in any case), as package paths: all the catalog
 * files and the includes list live there, so the rest of the package (its sounds, models,
 * terrain) isn't listed.
 */
async function baseDataFiles(pkg: string): Promise<string[]> {
  if (!existsSync(pkg)) return [];
  const base = GAME_DATA_DIR.split("/")[0]!.toLowerCase();
  const dirs = (await readdir(pkg, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.toLowerCase() === base);
  const nested = await Promise.all(dirs.map(async (dir) => (await packageFiles(path.join(pkg, dir.name))).map((file) => `${dir.name}/${file}`)));
  return nested.flat().sort();
}
