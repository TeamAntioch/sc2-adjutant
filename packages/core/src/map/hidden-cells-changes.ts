// The hidden bit's Editor changes (zone.hiddenCells, #595, #597). The compile records the cells it
// writes t3CellFlags' hidden bit on and which it hid (a `hidden-cells` entry), so the next compile
// tells, cell by cell, where the package's bit differs from what it wrote: the Editor's Hide
// Terrain brush. Such a cell, or one the record doesn't list yet that the package hides and the
// Blueprint doesn't, is a change to sync into hiddenCells, keep (the bit stays as the package has it)
// or discard (the Blueprint's is written).

import { type CompileRecord, type CompileRecordEntry, entryName, HIDDEN_CELLS_ENTRY_NAME } from "../domain/compile-record.js";
import { cellRects, cellsOfRects } from "../kept-terrain/generating-zones.js";
import { CELL_FLAG_HIDDEN } from "../terrain/cliffs.js";
import { type EditorChange, type EditorDecisions, editorDecision } from "./editor-changes.js";

export type HiddenCellsEntry = Extract<CompileRecordEntry, { kind: "hidden-cells" }>;

export type HiddenCells = {
  /** The cells the compile writes the hidden bit on: those it may, less those the author keeps. */
  readonly writable: Uint8Array;
  /** The bit to write on each, 1 for hidden: the Blueprint's. */
  readonly hidden: Uint8Array;
  /** The Editor's changes, at most one: decided with the compile's others. */
  readonly changes: readonly EditorChange[];
  /** The record's entry for what is written; undefined with no cell to write. */
  readonly entry: HiddenCellsEntry | undefined;
};

/**
 * Which cells the compile writes the hidden bit on, and what: `field` (the Zones' hiddenCells) on
 * the cells it may (`may`, every cell when undefined), except those kept from earlier compiles
 * (unless discarded by name) and those whose Editor change `decisions` keep. `packageFlags` is the
 * package's t3CellFlags as the Editor left it; undefined, as on a first compile, nothing is a change.
 */
export function hiddenCells({
  width,
  height,
  field,
  may,
  packageFlags,
  record,
  decisions = {},
}: {
  readonly width: number;
  readonly height: number;
  readonly field: Uint8Array;
  readonly may?: Uint8Array | undefined;
  readonly packageFlags?: Uint8Array | undefined;
  readonly record?: CompileRecord | undefined;
  readonly decisions?: EditorDecisions | undefined;
}): HiddenCells {
  const count = width * height;
  const discarded = Array.isArray(decisions.discard) ? decisions.discard : [];
  // Kept from earlier compiles; those the author now discards by name the Blueprint writes again, without asking.
  const kept = new Uint8Array(count);
  const reowned = new Uint8Array(count);
  for (const entry of record?.kept ?? []) {
    if (entry.kind !== "hidden-cells") continue;
    const into = discarded.includes(entryName(entry)) ? reowned : kept;
    const cells = cellsOfRects(entry.cells, width, height);
    for (let cell = 0; cell < count; cell++) into[cell] ||= cells[cell]!;
  }
  const previous = record?.entries.find((entry): entry is HiddenCellsEntry => entry.kind === "hidden-cells");
  const written = previous && cellsOfRects(previous.cells, width, height);
  const wroteHidden = previous && cellsOfRects(previous.hidden, width, height);

  // A cell whose bit the package has otherwise than the Blueprint, where the Editor changed it from what was written.
  const changed = new Uint8Array(count);
  let shown = 0;
  let hid = 0;
  if (packageFlags) {
    for (let cell = 0; cell < count; cell++) {
      if ((may && !may[cell]) || kept[cell] || reowned[cell]) continue;
      const now = packageFlags[cell]! & CELL_FLAG_HIDDEN ? 1 : 0;
      if (now === field[cell]) continue;
      // On the record: the Editor changed it if it isn't what was written. Off it, only a hide the
      // Blueprint doesn't list would be lost; one the Blueprint adds is its own.
      if (written?.[cell] ? now === wroteHidden![cell] : !now) continue;
      changed[cell] = 1;
      if (now) hid++;
      else shown++;
    }
  }
  const changes: EditorChange[] = [];
  if (hid + shown > 0) {
    const first = changed.indexOf(1);
    const hiddenNow = Uint8Array.from(changed, (value, cell) => (value && packageFlags![cell]! & CELL_FLAG_HIDDEN ? 1 : 0));
    const entry: HiddenCellsEntry = { kind: "hidden-cells", cells: cellRects(changed, width, height), hidden: cellRects(hiddenNow, width, height) };
    const parts = [hid > 0 && `${hid} hidden`, shown > 0 && `${shown} shown`].filter(Boolean).join(" and ");
    changes.push({ entry, name: HIDDEN_CELLS_ENTRY_NAME, change: "changed in the Editor", label: `${parts} in the package, unlike the Zones' hiddenCells, the first at (${first % width}, ${Math.floor(first / width)})` });
    if (editorDecision(decisions, HIDDEN_CELLS_ENTRY_NAME) === "keep") for (let cell = 0; cell < count; cell++) kept[cell] ||= changed[cell]!;
  }

  const writable = Uint8Array.from({ length: count }, (_, cell) => ((!may || may[cell]) && !kept[cell] ? 1 : 0));
  const hidden = Uint8Array.from(field, (value, cell) => (writable[cell] ? value : 0));
  const entry: HiddenCellsEntry | undefined = writable.includes(1) ? { kind: "hidden-cells", cells: cellRects(writable, width, height), hidden: cellRects(hidden, width, height) } : undefined;
  return { writable, hidden, changes, entry };
}
