// The cliffs of a Map Package's Kept ground, beyond the height map (src/kept-terrain/kept-ground.ts):
// t3Terrain.xml's cliff cells, cliff sets and ramps, t3SyncCliffLevel and t3CellFlags. Read from
// the package's own files and written back in place (spec #247). Only what changes is rewritten:
// a value per cell in the two binary files, and in t3Terrain.xml only the cliff cell list, the
// ramp list and the cliff set list, each regenerated in the Editor's own form, so an untouched
// list comes out byte for byte as it went in.
//
// Each cliff cell (2×2 cells) has a <cc> entry when it has a flag or a cliff set: `f` 1 a cliff
// mesh, 2 part of a ramp, 4 and 8 round and under a terrain object; `cid` the cliff set the Editor
// paints per cell, also on flat cells (a 256×256 Kept map has 4,524 flat cells with `cid="1"`); `cvar` the
// mesh variation. A cell with neither flags nor a set isn't written.

import type { Catalog } from "../catalog/catalog-layer.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { hidesLowestLevel } from "../catalog/tileset-sky.js";
import { CELL_FLAG_CLIFF } from "../terrain/cliffs.js";
import { readT3TerrainXml } from "../terrain/read-t3-terrain-xml.js";

const CLIF_HEADER = 32;
const LFCT_HEADER = 32;

/** Whether `file` is an LFCT file of `width`×`height` cells: its magic, its header's size and its length. */
const isCellFlagsOf = (file: Buffer, width: number, height: number): boolean =>
  file.length === LFCT_HEADER + width * height && file.toString("ascii", 0, 4) === "LFCT" && file.readUInt32LE(24) === width && file.readUInt32LE(28) === height;

/** The package's t3CellFlags cells ([y * width + x]), or undefined when it has none or it isn't an LFCT file of the map's size. */
export async function readCellFlagCells(mapPackage: string, width: number, height: number): Promise<Uint8Array | undefined> {
  const file = path.join(mapPackage, "t3CellFlags");
  if (!existsSync(file)) return undefined;
  const flags = await readFile(file);
  return isCellFlagsOf(flags, width, height) ? Uint8Array.from(flags.subarray(LFCT_HEADER)) : undefined;
}

export type CliffCellEntry = { readonly f: number; readonly cid: number; readonly cvar: number };

/** A <ramp> in t3Terrain.xml: its attributes and its own line, as the Editor wrote it. */
export type KeptRamp = { readonly attrs: Readonly<Record<string, string>>; readonly text: string };

export type KeptCliffs = {
  readonly width: number;
  readonly height: number;
  readonly tilesetId: string;
  readonly xml: string;
  readonly cliffSets: readonly string[];
  /** Cliff cell index (cy · width/2 + cx) -> its entry. */
  readonly cells: ReadonlyMap<number, CliffCellEntry>;
  readonly ramps: readonly KeptRamp[];
  /** Raw t3SyncCliffLevel per cell: 64 per level, in between on ramps. */
  readonly syncCliff: Uint16Array;
  /** t3CellFlags per cell. */
  readonly cellFlags: Uint8Array;
  readonly syncCliffFile: Buffer;
  readonly cellFlagsFile: Buffer;
  /** Whether the map hides its lowest level, so its sync level 0 is open sky and unpathable (DL-14): see {@link keptHidesLowestLevel}. */
  readonly hidesLowestLevel: boolean;
  /** The catalog its tileset and cliff sets are looked up in: its Workspace's. */
  readonly catalog: Catalog;
};

/** The cliff files a cliff or ramp edit writes, beside the two height maps. */
export const CLIFF_FILES = ["t3SyncCliffLevel", "t3CellFlags", "t3Terrain.xml"] as const;

/** Reads the package's cliffs, refusing files whose sizes don't match its t3Terrain.xml or a cliff cell list not in the Editor's form. */
export async function readKeptCliffs(mapPackage: string, catalog: Catalog): Promise<KeptCliffs> {
  const xml = await readFile(path.join(mapPackage, "t3Terrain.xml"), "utf8");
  const terrain = readT3TerrainXml(xml);
  const { width, height } = terrain;
  const syncCliffFile = await readFile(path.join(mapPackage, "t3SyncCliffLevel"));
  const cellFlagsFile = await readFile(path.join(mapPackage, "t3CellFlags"));
  const cells = width * height;
  if (syncCliffFile.toString("ascii", 0, 4) !== "CLIF" || syncCliffFile.readUInt32LE(8) !== width || syncCliffFile.readUInt32LE(12) !== height || syncCliffFile.length !== CLIF_HEADER + cells * 2) {
    throw new Error(`t3SyncCliffLevel isn't a CLIF file of ${width}×${height} cells, as t3Terrain.xml says, so the cliffs aren't edited`);
  }
  if (!isCellFlagsOf(cellFlagsFile, width, height)) {
    throw new Error(`t3CellFlags isn't an LFCT file of ${width}×${height} cells, as t3Terrain.xml says, so the cliffs aren't edited`);
  }
  const syncCliff = new Uint16Array(cells);
  for (let i = 0; i < cells; i++) syncCliff[i] = syncCliffFile.readUInt16LE(CLIF_HEADER + i * 2);
  const cellFlags = Uint8Array.from(cellFlagsFile.subarray(LFCT_HEADER));

  const entries = new Map<number, CliffCellEntry>();
  for (const cell of terrain.cliffCells) entries.set(cell.index, { f: cell.flags, cid: cell.cliffSet, cvar: cell.variation });
  const list = cliffCellList(xml);
  if (list && list.text !== cliffCellListText(list, entries, newlineOf(xml))) {
    throw new Error("t3Terrain.xml's cliff cells aren't in the form the Editor writes, so the cliffs aren't edited");
  }
  const ramps: KeptRamp[] = [...xml.matchAll(/<ramp\s[^>]*\/>/g)].map((match) => ({ attrs: rampAttrs(match[0]), text: match[0] }));
  // The ramp and cliff set lists are rewritten whole, so each must come back as it is from what was read.
  const newline = newlineOf(xml);
  const rampCount = Number(/<rampList\b[^>]*\bnum="(\d+)"/.exec(xml)?.[1] ?? 0);
  if (rampCount !== ramps.length || (ramps.length > 0 && withRamps(xml, ramps.map((ramp) => ramp.text), newline) !== xml)) {
    throw new Error("t3Terrain.xml's ramps aren't in the form the Editor writes, so the cliffs aren't edited");
  }
  const setList = CLIFF_SET_LIST.exec(xml);
  // An empty list may be self-closing, as the ramp list may; writing a set fills it in the Editor's form.
  const emptySetList = terrain.cliffSets.length === 0 && setList !== null && /^[ \t]*<cliffSetList\s+num="0"\s*\/>$/.test(setList[0]);
  if (setList && !emptySetList && withCliffSets(xml, terrain.cliffSets, newline) !== xml) {
    throw new Error("t3Terrain.xml's cliff sets aren't in the form the Editor writes, so the cliffs aren't edited");
  }
  const hidesLowestLevel = await keptHidesLowestLevel(mapPackage, terrain.tilesetId, entries, syncCliff, cellFlags, width, catalog);
  return { width, height, tilesetId: terrain.tilesetId, xml, cliffSets: terrain.cliffSets, cells: entries, ramps, syncCliff, cellFlags, syncCliffFile, cellFlagsFile, hidesLowestLevel, catalog };
}

/**
 * Whether a Kept map hides its lowest level. A Kept package has no Blueprint sky to ask, and the
 * setting may come from a dependency's CTerrain we can't read, so the map's own cells answer first:
 * its plain cells (no cliff mesh, ramp or terrain object) at sync level 0 all carry the cliff bit
 * where the level is hidden, and none does where it isn't. With no such cells (or a mix), the
 * map's own TerrainData.xml override of its tileset answers, then the tileset's in `catalog`
 * (data/tileset-sky.json, or the Campaign Mod's); an unknown tileset with neither is taken as showing its lowest level.
 */
export async function keptHidesLowestLevel(
  mapPackage: string,
  tilesetId: string,
  cells: ReadonlyMap<number, CliffCellEntry>,
  syncCliff: Uint16Array,
  cellFlags: Uint8Array,
  width: number,
  catalog: Catalog,
): Promise<boolean> {
  let flagged = 0;
  let open = 0;
  for (let cell = 0; cell < syncCliff.length; cell++) {
    if (syncCliff[cell] !== 0) continue;
    const x = cell % width;
    const y = Math.floor(cell / width);
    if ((cells.get((y >> 1) * (width / 2) + (x >> 1))?.f ?? 0) !== 0) continue;
    if (cellFlags[cell]! & CELL_FLAG_CLIFF) flagged++;
    else open++;
  }
  if (flagged > 0 && open === 0) return true;
  if (open > 0 && flagged === 0) return false;
  const data = path.join(mapPackage, "Base.SC2Data", "GameData", "TerrainData.xml");
  if (existsSync(data)) {
    const xml = await readFile(data, "utf8");
    const id = tilesetId.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
    const own = new RegExp(`<CTerrain\\b[^>]*\\bid="${id}"[^>]*?(?<!/)>([\\s\\S]*?)</CTerrain>`).exec(xml);
    const value = own && /<HideLowestLevel\s+value="(\d)"/.exec(own[1]!)?.[1];
    if (value) return value === "1";
  }
  return hidesLowestLevel(catalog, { tilesetId });
}

/** What a cliff or ramp edit sets; each left out stays as it is. */
export type CliffsChange = {
  readonly cliffSets?: readonly string[];
  readonly cells?: ReadonlyMap<number, CliffCellEntry>;
  /** The <ramp> lines after the edit: kept ones as they were, new ones from the generator's rampXml. */
  readonly ramps?: readonly string[];
  readonly syncCliff?: Uint16Array;
  readonly cellFlags?: Uint8Array;
};

/** The cliff files with `change` applied: only the files that differ, each rewritten only where it does. */
export function writeKeptCliffs(cliffs: KeptCliffs, change: CliffsChange): { "t3SyncCliffLevel"?: Buffer; "t3CellFlags"?: Buffer; "t3Terrain.xml"?: string } {
  const out: { "t3SyncCliffLevel"?: Buffer; "t3CellFlags"?: Buffer; "t3Terrain.xml"?: string } = {};
  if (change.syncCliff) {
    const file = Buffer.from(cliffs.syncCliffFile);
    let changed = false;
    for (let i = 0; i < change.syncCliff.length; i++) {
      if (change.syncCliff[i] === cliffs.syncCliff[i]) continue;
      file.writeUInt16LE(change.syncCliff[i]!, CLIF_HEADER + i * 2);
      changed = true;
    }
    if (changed) out["t3SyncCliffLevel"] = file;
  }
  if (change.cellFlags) {
    const file = Buffer.from(cliffs.cellFlagsFile);
    let changed = false;
    for (let i = 0; i < change.cellFlags.length; i++) {
      if (change.cellFlags[i] === cliffs.cellFlags[i]) continue;
      file[LFCT_HEADER + i] = change.cellFlags[i]!;
      changed = true;
    }
    if (changed) out["t3CellFlags"] = file;
  }
  const newline = newlineOf(cliffs.xml);
  let xml = cliffs.xml;
  if (change.cliffSets && change.cliffSets.join("\n") !== cliffs.cliffSets.join("\n")) xml = withCliffSets(xml, change.cliffSets, newline);
  if (change.ramps && change.ramps.join("\n") !== cliffs.ramps.map((ramp) => ramp.text).join("\n")) xml = withRamps(xml, change.ramps, newline);
  if (change.cells) {
    const list = cliffCellList(xml);
    if (!list) throw new Error("t3Terrain.xml has no <cliffCellList>, so the cliffs aren't edited");
    const text = cliffCellListText(list, change.cells, newline);
    xml = xml.slice(0, list.index) + text + xml.slice(list.index + list.text.length);
  }
  if (xml !== cliffs.xml) out["t3Terrain.xml"] = xml;
  return out;
}

const newlineOf = (xml: string): string => (xml.includes("\r\n") ? "\r\n" : "\n");

/** A <ramp> element's attributes, as written. */
export function rampAttrs(text: string): Record<string, string> {
  return Object.fromEntries([...text.matchAll(/([A-Za-z]+)="([^"]*)"/g)].map((match) => [match[1]!, match[2]!]));
}

// Each list as the Editor writes it, or empty and self-closing.
const CLIFF_SET_LIST = /[ \t]*<cliffSetList\b[^>]*?(?:\/>|>[\s\S]*?<\/cliffSetList>)/;
const RAMP_LIST = /[ \t]*<rampList\b[^>]*?(?:\/>|>[\s\S]*?<\/rampList>)/;

type CellList = { readonly index: number; readonly text: string; readonly indent: string; readonly num: number };

function cliffCellList(xml: string): CellList | undefined {
  const match = /([ \t]*)<cliffCellList num="(\d+)" numOccupied="\d+"(?:\/>|>[\s\S]*?<\/cliffCellList>)/.exec(xml);
  if (!match) return undefined;
  return { index: match.index, text: match[0], indent: match[1]!, num: Number(match[2]) };
}

/** The cliff cell list as the Editor writes it: ascending, one <cc> a line. */
function cliffCellListText(list: CellList, cells: ReadonlyMap<number, CliffCellEntry>, newline: string): string {
  const sorted = [...cells].sort(([a], [b]) => a - b);
  if (sorted.length === 0) return `${list.indent}<cliffCellList num="${list.num}" numOccupied="0"/>`;
  const inner = `${list.indent}    `;
  const lines = sorted.map(([i, cell]) => `${inner}<cc i="${i}" f="${cell.f}" cid="${cell.cid}" cvar="${cell.cvar}"/>`);
  return [`${list.indent}<cliffCellList num="${list.num}" numOccupied="${sorted.length}">`, ...lines, `${list.indent}</cliffCellList>`].join(newline);
}

/** The <heightMap> element's children's indentation. */
function childIndent(xml: string): string {
  const match = /\n([ \t]*)<(?:cliffSetList|rampList|cliffDoodadList|vertData)\b/.exec(xml);
  return match?.[1] ?? "        ";
}

function withCliffSets(xml: string, sets: readonly string[], newline: string): string {
  const indent = childIndent(xml);
  const block = [`${indent}<cliffSetList num="${sets.length}">`, ...sets.map((name, i) => `${indent}    <cliffSet i="${i}" name="${name}"/>`), `${indent}</cliffSetList>`].join(newline);
  const existing = CLIFF_SET_LIST.exec(xml);
  if (existing) return xml.slice(0, existing.index) + block + xml.slice(existing.index + existing[0].length);
  // The first child of <heightMap>.
  const open = /<heightMap\s[^>]*>/.exec(xml);
  if (!open) throw new Error("t3Terrain.xml has no <heightMap>");
  const at = open.index + open[0].length;
  return xml.slice(0, at) + newline + block + xml.slice(at);
}

function withRamps(xml: string, ramps: readonly string[], newline: string): string {
  const indent = childIndent(xml);
  const block = ramps.length === 0 ? "" : [`${indent}<rampList num="${ramps.length}">`, ...ramps.map((ramp) => `${indent}    ${ramp}`), `${indent}</rampList>`].join(newline);
  const existing = RAMP_LIST.exec(xml);
  if (existing) {
    if (block) return xml.slice(0, existing.index) + block + xml.slice(existing.index + existing[0].length);
    // No ramps left: the list goes, with its line, as the Editor writes none.
    const end = existing.index + existing[0].length;
    return xml.slice(0, existing.index).replace(/\r?\n$/, "") + xml.slice(end);
  }
  if (!block) return xml;
  // After the cliff sets, before the terrain objects: the Editor's order.
  const sets = CLIFF_SET_LIST.exec(xml);
  const open = /<heightMap\s[^>]*>/.exec(xml);
  const at = sets ? sets.index + sets[0].length : open ? open.index + open[0].length : -1;
  if (at < 0) throw new Error("t3Terrain.xml has no <heightMap>");
  return xml.slice(0, at) + newline + block + xml.slice(at);
}
