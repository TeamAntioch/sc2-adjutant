// Records doodads' ground outlines (doodad-outlines.ts) in data/doodad-outlines.json: each variation's
// .m3, pulled from the game by the Host Adapter's model.export (or read from a mod's assets) as
// model-footprints reads them, cut and filled.

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

import { EMPTY_CATALOG } from "./catalog-layer.js";
import { getDoodad, getDoodadModel } from "./stock-catalog.js";
import { DOODAD_OUTLINES_PATH, type DoodadOutline, type DoodadOutlinesFile, formatDoodadOutlines, groundOutline, OUTLINE_SLICES, OUTLINE_STEP, type StoredDoodadOutlines, storeOutline } from "./doodad-outlines.js";
import { readM3SolidMesh } from "./m3-mesh.js";
import type { Host } from "../host/host.js";
import { recordModels, type RecordModelsOptions } from "./record-models.js";

/** Failures a second try can't mend: no such variation, no model file, no ModelData entry, a host without model.export. */
const DETERMINED = /^has \d+ variation|^no ModelData entry|^no model file to try|needs the model\.export capability/;

export type RecordedOutlines = { readonly id: string; readonly model: string; readonly variations: readonly (DoodadOutline | null)[] };

/**
 * Each doodad's outline at every variation it has. `catalogPath` (core's data file unless given; none
 * to only read) gains them, keeping the doodads it has, unless they were made at another step or
 * with other cuts: those are dropped, and named, to record again. A doodad any of whose variations fails isn't
 * written, and is named with why. Each variation is tried twice: the viewer that exports a model
 * now and then fails on one it reads the next time (CreepPods_00, 2026-11-11).
 */
export async function recordDoodadOutlines(
  host: Host,
  ids: readonly string[],
  { modelData, assetRoots, catalogPath = DOODAD_OUTLINES_PATH }: Pick<RecordModelsOptions, "modelData" | "assetRoots"> & { readonly catalogPath?: string | null | undefined },
): Promise<{ readonly recorded: readonly RecordedOutlines[]; readonly failed: readonly { readonly id: string; readonly reason: string }[]; readonly dropped: readonly string[] }> {
  // The game's ModelData is fetched once, for every variation of every doodad (and parsed once: record-models.ts keeps it by the array).
  let catalogs: Promise<readonly string[]> | undefined;
  const data = typeof modelData === "function" ? () => (catalogs ??= modelData()) : modelData;
  const recorded: RecordedOutlines[] = [];
  const failed: { id: string; reason: string }[] = [];
  for (const id of ids) {
    const model = getDoodadModel(id);
    const info = getDoodad(EMPTY_CATALOG, id);
    if (!model || !info) {
      failed.push({ id, reason: "no doodad of that id in the game's catalog" });
      continue;
    }
    const found = { model, variations: info.variations };
    const variations: (DoodadOutline | null)[] = [];
    let reason: string | undefined;
    for (let variation = 0; variation < info.variations && !reason; variation++) {
      const read = () => recordModels(host, [id], {
        modelData: data,
        ...(assetRoots ? { assetRoots } : {}),
        doodadModel: () => found,
        variation,
        what: "Recording doodad outlines",
        read: (_file, own) => groundOutline(readM3SolidMesh(own)),
      });
      let result = await read();
      // Only the viewer's export is tried again: a variation the model hasn't, or no Host Adapter, fails the same twice.
      if (result.failed.length > 0 && !DETERMINED.test(result.failed[0]!.reason)) result = await read();
      if (result.failed.length > 0) reason = `variation ${variation}: ${result.failed[0]!.reason}`;
      else variations.push(result.catalog[id] ?? null);
    }
    if (reason) failed.push({ id, reason });
    else recorded.push({ id, model, variations });
  }
  const dropped: string[] = [];
  if (catalogPath && recorded.length > 0) {
    const file = existsSync(catalogPath) ? (JSON.parse(await readFile(catalogPath, "utf8")) as DoodadOutlinesFile) : undefined;
    // Outlines made at another step or with other cuts would be read at this one's scale: they go, to be recorded again.
    const current = file !== undefined && file.step === OUTLINE_STEP && JSON.stringify(file.slices) === JSON.stringify(OUTLINE_SLICES);
    const doodads: Record<string, StoredDoodadOutlines> = current ? { ...file.doodads } : {};
    if (file && !current) dropped.push(...Object.keys(file.doodads).filter((id) => !recorded.some((entry) => entry.id === id)));
    for (const { id, model, variations } of recorded) doodads[id] = { model, variations: variations.map((outline) => (outline ? storeOutline(outline) : null)) };
    await writeFile(catalogPath, formatDoodadOutlines(doodads));
  }
  return { recorded, failed, dropped };
}

/** An outline drawn in text, north up: # solid, . clear, a character per pixel. */
export function drawOutline(outline: DoodadOutline): string {
  const rows: string[] = [];
  for (let y = outline.height - 1; y >= 0; y--) rows.push(Array.from({ length: outline.width }, (_, x) => (outline.bits[y * outline.width + x] ? "#" : ".")).join(""));
  return rows.join("\n");
}
