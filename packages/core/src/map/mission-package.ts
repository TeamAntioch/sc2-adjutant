// Where a Mission's committed Map Package and its compile record live (ADR-0010):
// missions/<id>/<Name>.SC2Map and missions/<id>/compile-record.json, beside its Blueprint.

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { type CompileRecord, parseCompileRecord, writeCompileRecord } from "../domain/compile-record.js";

export const COMPILE_RECORD_FILE = "compile-record.json";

/** The compile record beside a Mission's Blueprint. */
export function compileRecordPath(blueprintPath: string): string {
  return path.join(path.dirname(blueprintPath), COMPILE_RECORD_FILE);
}

/** A package name from a Mission's id: each hyphenated word capitalized, so desert-outpost-01 is Desert-Outpost-01. */
export function packageNameFor(missionId: string): string {
  return missionId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("-");
}

/**
 * The Mission's Map Package: the one `.SC2Map` folder beside its Blueprint, or, before its first
 * compile, `<Name>.SC2Map` named from the Mission's folder.
 */
export async function missionMapPackage(blueprintPath: string): Promise<string> {
  const missionDir = path.dirname(blueprintPath);
  const packages = existsSync(missionDir)
    ? (await readdir(missionDir, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name.endsWith(".SC2Map")).map((entry) => entry.name).sort()
    : [];
  if (packages.length > 1) throw new Error(`${missionDir} holds ${packages.length} Map Packages (${packages.join(", ")}): a Mission has one; move the others out`);
  return path.join(missionDir, packages[0] ?? `${packageNameFor(path.basename(missionDir))}.SC2Map`);
}

/** The Mission's compile record, or undefined before its first compile. */
export async function readCompileRecord(blueprintPath: string): Promise<CompileRecord | undefined> {
  const file = compileRecordPath(blueprintPath);
  return existsSync(file) ? parseCompileRecord(await readFile(file, "utf8"), file) : undefined;
}

export async function saveCompileRecord(blueprintPath: string, record: CompileRecord): Promise<void> {
  await writeFile(compileRecordPath(blueprintPath), writeCompileRecord(record));
}
