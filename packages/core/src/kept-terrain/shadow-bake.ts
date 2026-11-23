// The Editor's static shadow bake in t3VertCol (docs/reference/terrain-file-formats.md, "t3VertCol"):
// Data > Generate Static Shadows (Cmd-Shift-L) darkens the ground at cliff feet and every cliff and
// ramp model's vertices, and any later cliff edit in the Editor resets every byte of it to 255. A
// cliff or ramp edit on Kept ground does the same (spec #247), and the author rebakes in the Editor.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { missionMapPackage, readCompileRecord } from "../map/mission-package.js";
import { readT3VertCol, readT3VertColHeader } from "../terrain/read-t3-vert-col.js";

/** What the report and the check say while a map with cliffs has no bake. */
export const REBAKE = "static shadows need a rebake: Data > Generate Static Shadows (Cmd-Shift-L) in the Editor";
/** The same, as a sentence of its own. */
export const REBAKE_SENTENCE = `${REBAKE[0]!.toUpperCase()}${REBAKE.slice(1)}`;

/** Whether `buffer` (a t3VertCol) holds a bake: any value below 255. */
export function hasShadowBake(buffer: Buffer): boolean {
  return readT3VertCol(buffer).some((entry) => entry.data.some((value) => value !== 255));
}

/**
 * t3VertCol as the Editor leaves it after a cliff edit: every entry's values 255, the entries and
 * their layout as they were. Undefined when it already is.
 */
export function resetShadowBake(buffer: Buffer): Buffer | undefined {
  const { entryCount } = readT3VertColHeader(buffer);
  // Parsed first, so a file of another layout is refused rather than half rewritten.
  readT3VertCol(buffer);
  const out = Buffer.from(buffer);
  let offset = 32;
  let changed = false;
  for (let i = 0; i < entryCount; i++) {
    const size = out.readUInt32LE(offset + 32);
    for (let at = offset + 36; at < offset + 36 + size; at++) {
      if (out[at] === 255) continue;
      out[at] = 255;
      changed = true;
    }
    offset += 36 + size;
  }
  return changed ? out : undefined;
}

/**
 * The check's warning for a Mission whose Kept ground has cliffs and no bake: its package's
 * t3VertCol missing or all 255. Generated terrain (t3Terrain.xml on the compile record) can't carry
 * a bake through the next compile, so it isn't warned about here.
 */
export async function shadowBakeWarning(blueprintPath: string): Promise<{ readonly file: string; readonly message: string } | undefined> {
  const mapPackage = await missionMapPackage(blueprintPath);
  const terrainFile = path.join(mapPackage, "t3Terrain.xml");
  if (!existsSync(terrainFile)) return undefined;
  const record = await readCompileRecord(blueprintPath);
  if (!record || record.entries.some((entry) => entry.kind === "file" && entry.path === "t3Terrain.xml")) return undefined;
  const xml = await readFile(terrainFile, "utf8");
  const cliffs = [...xml.matchAll(/<cc\s[^>]*\bf="(\d+)"/g)].some((match) => Number(match[1]) & 1);
  if (!cliffs) return undefined;
  const vertColFile = path.join(mapPackage, "t3VertCol");
  if (existsSync(vertColFile) && hasShadowBake(await readFile(vertColFile))) return undefined;
  return { file: vertColFile, message: `${REBAKE_SENTENCE}: ${path.basename(mapPackage)} has cliffs and no bake in t3VertCol` };
}
