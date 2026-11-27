// Where a Mission's committed Map Package and its compile record live (ADR-0010):
// missions/<id>/<Name>.SC2Map and missions/<id>/compile-record.json, beside its Blueprint.

import { existsSync } from "node:fs";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { type CompileRecord, parseCompileRecord, writeCompileRecord } from "../domain/compile-record.js";
import { isInside } from "../util/inside.js";

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
  return readCompileRecordAt(compileRecordPath(blueprintPath));
}

export async function saveCompileRecord(blueprintPath: string, record: CompileRecord): Promise<void> {
  await saveCompileRecordAt(compileRecordPath(blueprintPath), record);
}

/** The compile record in `file`, or undefined when there is none. */
export async function readCompileRecordAt(file: string): Promise<CompileRecord | undefined> {
  return existsSync(file) ? parseCompileRecord(await readFile(file, "utf8"), file) : undefined;
}

export async function saveCompileRecordAt(file: string, record: CompileRecord): Promise<void> {
  await writeFile(file, writeCompileRecord(record));
}

/**
 * A copy of a Mission's committed Map Package (prepareMissionCopy): the copy, and its own compile
 * record beside it. Once the compile into it is done, `keep` drops the earlier copy it replaced;
 * when the compile stops, `undo` removes it and puts the earlier copy back, if there was one.
 */
export type MissionCopy = { readonly mapPackage: string; readonly record: string; readonly keep: () => Promise<void>; readonly undo: () => Promise<void> };

/** The files of a copy `<dir>/<base>.SC2Map`: its compile record and the note naming the Mission it copies, both beside it. */
export function missionCopyFiles(copy: string): { readonly mapPackage: string; readonly record: string; readonly note: string } {
  const base = path.join(path.dirname(copy), path.basename(copy).replace(/\.SC2Map$/i, ""));
  return { mapPackage: copy, record: `${base}.${COMPILE_RECORD_FILE}`, note: `${base}.copy.json` };
}

/**
 * Copies the Mission's committed Map Package to `copy`, its compile record to
 * `<base>.compile-record.json` beside it, and writes `<base>.copy.json` naming the Mission, so a
 * compile into the copy merges by record as an in-place compile does and leaves the committed
 * package and record alone. The copy goes under the Mission's own git-ignored `output/`, where it
 * can't become this Mission's package or another's. An earlier copy of the same Mission there is
 * replaced, fresh from the committed package, so whatever changed in it since is gone (unless the
 * compile stops: `undo`). Refused, touching nothing, for a folder outside `output/`, one holding
 * anything but a copy of this Mission, or a Mission with no committed package to copy.
 */
export async function prepareMissionCopy(blueprintPath: string, missionId: string, copy: string): Promise<MissionCopy> {
  const missionDir = path.dirname(blueprintPath);
  const output = path.join(missionDir, "output");
  const committed = await missionMapPackage(blueprintPath);
  if (!existsSync(path.join(committed, "MapInfo"))) {
    throw new Error(`${missionId} has no committed Map Package at ${committed} to copy: compile it in place first (no output folder), or import a map for it (import-map)`);
  }
  if (!/\.SC2Map$/i.test(copy)) throw new Error(`A copy of ${missionId}'s Map Package is a .SC2Map folder, which ${copy} isn't`);
  // Under the Mission's own git-ignored output/, a copy is never the package of this Mission or another.
  if (!(await isInside(output, copy))) throw new Error(`${copy} isn't under ${missionId}'s output folder ${output}: copy the Mission's Map Package there, as ${path.join(output, "<round>", path.basename(committed))}`);
  const files = missionCopyFiles(copy);
  const earlier = existsSync(files.mapPackage) || existsSync(files.record) || existsSync(files.note);
  if (earlier) {
    const copied = await copyNoteMission(files.note);
    if (copied !== missionId) {
      throw new Error(`${copy} ${copied === undefined ? "holds something that isn't a copy of a Mission's Map Package" : `is a copy of the Mission ${copied}, not ${missionId}`}: copy into a new folder, or remove it first`);
    }
  }
  // The earlier copy is set aside, to come back if this compile stops.
  const aside = { mapPackage: `${files.mapPackage}.previous`, record: `${files.record}.previous` };
  const move = async (from: string, to: string) => {
    await rm(to, { recursive: true, force: true });
    if (existsSync(from)) await rename(from, to);
  };
  if (earlier) await Promise.all([move(files.mapPackage, aside.mapPackage), move(files.record, aside.record)]);
  await mkdir(path.dirname(copy), { recursive: true });
  await cp(committed, files.mapPackage, { recursive: true });
  const record = compileRecordPath(blueprintPath);
  if (existsSync(record)) await cp(record, files.record);
  await writeFile(files.note, `${JSON.stringify({ mission: missionId, copyOf: path.relative(path.dirname(copy), committed).split(path.sep).join("/") }, null, 2)}\n`);
  return {
    mapPackage: files.mapPackage,
    record: files.record,
    keep: async () => {
      await Promise.all([rm(aside.mapPackage, { recursive: true, force: true }), rm(aside.record, { force: true })]);
    },
    undo: async () => {
      await Promise.all([rm(files.mapPackage, { recursive: true, force: true }), rm(files.record, { force: true })]);
      if (earlier) await Promise.all([move(aside.mapPackage, files.mapPackage), move(aside.record, files.record)]);
      else await rm(files.note, { force: true });
    },
  };
}

/** The Mission a copy's note names, or undefined when there is no note or it can't be read. */
async function copyNoteMission(note: string): Promise<string | undefined> {
  try {
    const parsed = JSON.parse(await readFile(note, "utf8")) as { readonly mission?: unknown };
    return typeof parsed.mission === "string" ? parsed.mission : undefined;
  } catch {
    return undefined;
  }
}
