// Writes a compile into a Map Package and keeps its compile record (ADR-0010).
//
// With no previous record (a first compile) every file is written whole, as the compiler always
// has. With one, the merging writers replace exactly what the record lists and leave the rest of
// each file byte for byte as it was: objects in Objects, regions in Regions and keys of the
// localized strings files. Triggers and MapScript.galaxy are spliced when the package has Kept
// triggers: the compile's own triggers, variables and Galaxy blocks go in beside the Editor's,
// which stay byte for byte (splice-triggers.ts, splice-map-script.ts). Every other file is written
// whole, and a recorded file the compile no longer writes is removed. A GameData catalog file is
// merged by entry (a mod's, src/mods/compile-mod.ts): its Compiled entries replaced where they
// stand, every Kept entry, comment and line as it was. Nothing touches the disk until every merge
// has succeeded, so a refused compile leaves the package as it was.
//
// Compiled Content written over Kept Content (a part converted from Kept) must come out the same,
// byte for byte, unless the compile gives a check of its own: a mod's is the Equivalence Check
// (src/mods/equivalence.ts), which compares them as the Editor reads them.

import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { PLAY_SCRIPT_ID } from "../cutscene/compile-cutscene.js";
import { type CompileRecord, type CompileRecordEntry, entryName, fingerprint, type KeptEntry } from "../domain/compile-record.js";
import { type Removal, removalOfLine } from "../domain/mod-blueprint.js";
import { LIBRARY_ITEM_TYPES } from "../domain/library-interface.js";
import { libraryStringKey } from "../mods/library-xml.js";
import { editorGlobalName, editorTriggerName, galaxyIdentifier } from "../triggers/trigger-model.js";
import { packageModes } from "../util/package-file-mode.js";
import { withoutCustomScriptInMapScript } from "../triggers/custom-script.js";
import { editorForm, scriptBlocks, sharedBlocks, spliceMapScript } from "../triggers/splice-map-script.js";
import { isSplicedKind, itemKind, keptItems, recordedItemKey, recordedItemKeys, spliceTriggers, triggerItems, triggerItemTexts, type TriggersScope } from "../triggers/splice-triggers.js";
import { DERIVED_TERRAIN_FILES, type EditorChange, type EditorDecisions, EditorChangesError, editorChanges, editorDecision, keptEntryOf, TRIGGER_STRINGS, triggerStringName } from "./editor-changes.js";
import { catalogEntries } from "./catalog-entries.js";
import { triggerTreeScriptNames } from "./kept-references.js";
import { withPackageLock } from "./package-lock.js";
import { onlyStockWater, WATER_DATA } from "./write-water.js";
import { type Element, objectElements, regionElements, stringLines } from "./package-elements.js";
import { rootChildren } from "../util/xml.js";

/** What a compiled file is called until it is renamed over the old one. */
const COMPILE_PENDING = ".compile-pending";

/** compile_cutscene's play-from-start script, by its element key: the compile drops it as its own. */
const PLAY_SCRIPT_KEY = recordedItemKey({ kind: "custom-script", id: PLAY_SCRIPT_ID });

/** How a file's content is merged with the package's copy. */
export type PackageFileKind = "file" | "objects" | "regions" | "strings" | "triggers" | "mapscript" | "catalog" | "version" | "components" | "kept-components" | "generated";

/** How a file the previous compile wrote is merged when this one doesn't write it ("file": removed whole). */
type MergedKind = "objects" | "regions" | "strings" | "triggers" | "mapscript" | "catalog";

/**
 * Whether the record lists `entry` as a file the compile writes whole: a fingerprinted one, or an
 * uncommitted one each machine makes for itself (a mod's, which has no fingerprint, so the Editor
 * changes nothing in it that a compile asks about).
 */
const wholeFile = (entry: CompileRecordEntry): entry is Extract<CompileRecordEntry, { kind: "file" | "uncommitted" }> => entry.kind === "file" || entry.kind === "uncommitted";

/** A file's content, or a file to copy it from (a voice file), read only to fingerprint it. */
export type PackageContent = string | Uint8Array | { readonly copyFrom: string };

/**
 * Told of each Kept part the compile writes `compiled` over: `name` (an entry name, such as
 * `catalog-entry:<file>:<Class>:<id>`), whose text or bytes are `kept`, a part converted from Kept
 * to Compiled. It checks the conversion; it refuses one by throwing from finish's beforeWrite,
 * which then writes nothing.
 */
export type ReplaceKept = (name: string, kept: string | Uint8Array, compiled: string | Uint8Array) => void;

/** A merged file and the entries it adds to the record. */
type Written = { readonly content: PackageContent | undefined; readonly entries: readonly CompileRecordEntry[] };

export class PackageOutput {
  private readonly files = new Map<string, { content: PackageContent; kind: PackageFileKind }>();
  private recordedFiles: ReadonlySet<string>;
  private readonly kept = new Set<string>();
  private splicingTriggers: Promise<boolean> | undefined;
  /** The last compile's record less what the author has kept: what this compile replaces. */
  private previous: CompileRecord | undefined;
  /** Compiled Content the author kept (compile-map --keep), by entry name: Kept, and not written while the Blueprint declares it. */
  private keptEntries: KeptEntry[] = [];
  private keptNames = new Set<string>();
  /** The Galaxy names (gt_, gv_) of kept triggers and globals. */
  private keptScript = new Set<string>();
  /** The spliced Triggers, once merged: MapScript.galaxy's splice places its blocks by its tree. */
  private splicedTriggers: string | undefined;
  /** Kept entries the Blueprint still declares, found by finish: each a declaration now unused. */
  unusedKept: readonly KeptEntry[] = [];
  /** Kept files the compile writes into cell by cell (a generating Zone's terrain), with their record entries. */
  private readonly cellFiles = new Map<string, { content: string | Uint8Array; entries: readonly CompileRecordEntry[] }>();
  /** Changes the Editor made that the compile found itself (a generating Zone's cells), decided with the rest. */
  private readonly foundChanges: EditorChange[] = [];
  /** Kept items the compile drops on purpose (a mod's Accepted Removals), by entry name. */
  private removals: readonly Removal[] = [];
  /** The Kept items finish removed, by entry name (string:, line:, file:). */
  readonly removedKept = new Set<string>();
  /** Changes to Kept Content the compile makes as it merges (Kept doodads moving with the ground), by file. */
  private readonly amendments = new Map<string, (text: string) => string>();
  /** The Kept files amendKept changes, which the compile doesn't write. */
  private readonly keptAmendments = new Set<string>();
  /** Those of keptAmendments the compile may merge as well (Triggers, MapScript.galaxy), whose merge then reads them amended. */
  private readonly mergedAmendments = new Set<string>();
  /** Entries for the record that no file's merge makes: the Kept calls a hold switched off (recordEntries). */
  private readonly extraEntries: CompileRecordEntry[] = [];
  /** Kept objects the Blueprint has taken over (an adopted doodad Anchor's editorId), by Id: written over where they stand. */
  private readonly adopted = new Set<string>();
  /** Triggers items written where the package has them (a Mission Blueprint's own elements), by element key. */
  private readonly placed = new Set<string>();

  private readonly root: string;
  /** The last compile's record; undefined for a first compile, which writes every file whole. */
  private readonly original: CompileRecord | undefined;
  /** What the author decided for each Compiled entry the Editor changed. */
  private readonly decisions: EditorDecisions;
  /** The check for Compiled Content written over Kept Content; by default it must be byte for byte the same. */
  private readonly replaceKept: ReplaceKept | undefined;
  /** The trigger list Triggers is spliced in: a Mission's own (the default), or a mod's library. */
  private readonly triggersScope: TriggersScope;
  /**
   * The Kept parts `replaceKept` checks, by entry name, when only some may be converted (a
   * Mission's converted conversation): any other Kept part the compile writes must come out the
   * same, as with no check. Every part, by default.
   */
  private readonly convertsKept: (name: string) => boolean;

  constructor(
    root: string,
    original?: CompileRecord,
    decisions: EditorDecisions = {},
    replaceKept?: ReplaceKept,
    triggersScope: TriggersScope = {},
    convertsKept: (name: string) => boolean = () => true,
  ) {
    this.root = root;
    this.original = original;
    this.decisions = decisions;
    this.replaceKept = replaceKept;
    this.triggersScope = triggersScope;
    this.convertsKept = convertsKept;
    this.previous = original;
    this.recordedFiles = new Set((original?.entries ?? []).flatMap((entry) => (wholeFile(entry) ? [entry.path] : [])));
  }

  /**
   * Kept objects the Blueprint now writes (doodads sync adopted, each an Anchor with the Editor's
   * Id): the compile writes over each where it stands, as if the last compile had written it.
   */
  adoptObjects(ids: Iterable<number>): void {
    for (const id of ids) this.adopted.add(String(id));
  }

  /**
   * Triggers items, by element key, that the splice writes where the package has them, their Root
   * lines and elements in place, rather than at the ends (a Mission Blueprint's own elements,
   * ADR-0026): one converted from Kept stays where the Editor had it.
   */
  placeTriggers(keys: Iterable<string>): void {
    for (const key of keys) this.placed.add(key);
  }

  /** What is queued at `file`, and how it merges: undefined when nothing is (or the file is kept). */
  queued(file: string): { readonly content: PackageContent; readonly kind: PackageFileKind } | undefined {
    return this.files.get(file);
  }

  /** The files queued so far, by their path in the package. */
  queuedFiles(): string[] {
    return [...this.files.keys()];
  }

  /** Queues `content` at `file` (a path inside the package, forward slashes), merged as `kind` says. */
  write(file: string, content: PackageContent, kind: PackageFileKind = "file"): void {
    if (this.kept.has(file)) return;
    this.files.set(file, { content, kind });
  }

  /**
   * Writes a Kept file in which the compile owns some cells (a generating Zone's terrain): `content`
   * is the whole file, changed only in those cells, and `entries` list them on the record.
   */
  writeCells(file: string, content: string | Uint8Array, entries: readonly CompileRecordEntry[]): void {
    this.cellFiles.set(file, { content, entries });
  }

  /**
   * Writes the Kept file `file` changed in place, whole, though the compile keeps it (a Kept MapInfo
   * whose playable area the Blueprint sets): it stays Kept Content, so the file isn't on the record,
   * and the caller records what it changed (recordEntries).
   */
  patchKept(file: string, content: Uint8Array): void {
    this.cellFiles.set(file, { content, entries: [] });
  }

  /** Adds changes the Editor made that the compile found itself, decided with the rest (finish). */
  addChanges(changes: readonly EditorChange[]): void {
    this.foundChanges.push(...changes);
  }

  /** Changes `file`'s Kept Content as it is merged: the compile moving what it doesn't own, such as a Kept doodad with the ground. */
  amend(file: string, change: (text: string) => string): void {
    const before = this.amendments.get(file);
    this.amendments.set(file, before ? (text) => change(before(text)) : change);
  }

  /** Lists `entries` on the record as they are: what the compile changed in Kept Content and must undo once the Blueprint no longer asks (a held Kept call). */
  recordEntries(entries: readonly CompileRecordEntry[]): void {
    this.extraEntries.push(...entries);
  }

  /**
   * Changes the Kept file `file`, which the compile doesn't write, in place: written changed on
   * finish, and off the record, as it stays Kept Content (a Kept cutscene whose links follow a
   * converted line). With `merged`, the file is one the compile may merge as well, such as
   * Triggers beside a held Kept trigger's (ADR-0014): then its merge, which reads it amended, writes it.
   */
  amendKept(file: string, change: (text: string) => string, { merged = false }: { readonly merged?: boolean } = {}): void {
    this.amend(file, change);
    this.keptAmendments.add(file);
    if (merged) this.mergedAmendments.add(file);
  }

  /** Removes a file the compile doesn't write this time; with a record, only a recorded one goes (on finish). */
  async remove(file: string): Promise<void> {
    if (!this.previous && !this.kept.has(file)) await rm(this.full(file), { force: true });
  }

  /** Leaves `files` as the package has them, whatever the compile writes or removes there: Kept Content the compile has no say in. */
  keep(files: Iterable<string>): void {
    for (const file of files) {
      this.kept.add(file);
      this.files.delete(file);
    }
  }

  /**
   * Drops these Kept items on finish (Accepted Removals, or a converted conversation's orphans), as
   * well as any named before: a strings file's key or line with no key, from its file as it merges,
   * or a file. One the compile writes isn't dropped: the caller refuses that first. What finish
   * dropped is in removedKept.
   */
  removeKept(removals: readonly Removal[]): void {
    this.removals = [...this.removals, ...removals];
  }

  /**
   * Merges and writes everything queued, removes what the previous record lists and nothing
   * replaced, and returns the new record. With `saveRecord`, the record is saved twice: first with
   * the previous record's entries as well, before any file is written, so a compile cut short
   * leaves a record that still lists everything it may have written; then as it is, at the end.
   */
  finish(
    saveRecord?: (record: CompileRecord) => Promise<void>,
    options: {
      readonly dryRun?: boolean;
      /** Run once every file is merged and before anything is written: a throw there writes nothing. */
      readonly beforeWrite?: () => void;
    } = {},
  ): Promise<CompileRecord> {
    // Holds the package's cross-process lock from the first read (the Editor's changes) to the last write.
    return withPackageLock(this.root, () => this.finishLocked(saveRecord, options));
  }

  private async finishLocked(
    saveRecord: ((record: CompileRecord) => Promise<void>) | undefined,
    { dryRun = false, beforeWrite }: { readonly dryRun?: boolean; readonly beforeWrite?: () => void },
  ): Promise<CompileRecord> {
    await this.decide(dryRun);
    if (dryRun) return { version: 1, entries: [] };
    const results = new Map<string, Written>();
    // MapScript.galaxy last: its splice follows the spliced Triggers' tree.
    const merging = [...this.files].filter(([, { kind }]) => kind !== "kept-components");
    for (const [file, { content, kind }] of [...merging.filter(([, { kind }]) => kind !== "mapscript"), ...merging.filter(([, { kind }]) => kind === "mapscript")]) results.set(file, await this.merge(file, content, kind));
    for (const [file, written] of this.cellFiles) results.set(file, written);
    // What the last compile wrote and this one doesn't: its objects, regions and keys come out of
    // their files, and its whole files go.
    for (const file of this.previouslyWritten()) {
      // A kept file stays, even one the last compile wrote: it drops off the record, Kept Content now.
      if (results.has(file.path) || this.kept.has(file.path)) continue;
      results.set(file.path, file.merged ? await this.merge(file.path, undefined, file.merged) : { content: undefined, entries: [] });
    }
    // A Kept file the compile changes in place (amendKept): written changed, off the record.
    for (const file of this.keptAmendments) {
      if (results.has(file)) {
        if (this.mergedAmendments.has(file)) continue;
        throw new Error(`The compile writes ${file}, so it can't change it in place as Kept Content`);
      }
      if (this.kept.has(file)) continue;
      const full = this.full(file);
      if (!existsSync(full)) continue;
      const before = await readFile(full, "utf8");
      const after = await this.existing(file);
      if (after !== undefined && after !== before) results.set(file, { content: after, entries: [] });
    }
    // Accepted Removals: a strings file nothing else merges is merged for them, and a Kept file goes.
    // The game reads a file in any case, so one written in another spelling isn't removed.
    const handled = (file: string): boolean => [...results.keys(), ...this.kept].some((other) => other.toLowerCase() === file.toLowerCase());
    for (const removal of this.removals) {
      const file = removal.kind === "file" ? removal.path : removal.file;
      if (handled(file) || !existsSync(this.full(file))) continue;
      if (removal.kind !== "file") results.set(file, await this.merge(file, undefined, "strings"));
      else {
        results.set(file, { content: undefined, entries: [] });
        this.removedKept.add(`file:${file}`);
      }
    }
    // A Kept ComponentList goes last: it gains only the components whose files this compile writes.
    const written = [...results].flatMap(([file, result]) => (result.content === undefined ? [] : [file]));
    for (const [file, { content, kind }] of this.files) if (kind === "kept-components") results.set(file, await this.keptComponents(file, content as string, written));
    // A kept entry the Blueprint no longer declares has nothing left to say: it is plain Kept Content.
    const declared = await this.freshNames();
    // Cells kept from a generating Zone (their ground or their hidden bit) stay kept while a Zone still covers them, and a kept texture set while it is in the map (finish can't tell): the warning says so.
    const kept = this.keptEntries.filter((entry) => entry.kind === "terrain-cells" || entry.kind === "hidden-cells" || entry.kind === "texture-set" || declared.has(entryName(entry)));
    this.unusedKept = kept;
    const record: CompileRecord = { version: 1, entries: [...[...results.values()].flatMap((result) => result.entries), ...this.extraEntries], ...(kept.length ? { kept } : {}) };
    beforeWrite?.();
    if (saveRecord && this.previous) await saveRecord({ ...record, entries: [...this.previous.entries, ...record.entries] });
    const modes = packageModes(this.root);
    for (const [file, { content }] of results) {
      const full = this.full(file);
      if (content === undefined) {
        await rm(full, { force: true });
        continue;
      }
      await mkdir(path.dirname(full), { recursive: true });
      // Written beside the old file and renamed over it, so a reader (the Editor, a git status) never sees a half-written one.
      const pending = `${full}${COMPILE_PENDING}`;
      try {
        if (isCopy(content)) await copyFile(content.copyFrom, pending);
        else await writeFile(pending, content);
        // The old file's mode, or the package's for a new one: the Editor saves every file 755, and a compile mustn't flip them.
        await chmod(pending, await modes.modeFor(full));
        await rename(pending, full);
      } catch (error) {
        await rm(pending, { force: true });
        throw error;
      }
    }
    if (saveRecord) await saveRecord(record);
    return record;
  }

  /**
   * Compares the record with the package (editor-changes.ts) and applies the author's decisions:
   * a kept change leaves the record and is left alone, a discarded one is overwritten. Throws,
   * before anything is written, when a change has no decision.
   */
  private async decide(dryRun: boolean): Promise<void> {
    const original = this.original;
    if (!original) return;
    const { keep, discard } = this.decisions;
    const listed = (list: readonly string[] | "all" | undefined, name: string): boolean => Array.isArray(list) && list.includes(name);
    for (const name of Array.isArray(keep) ? keep : []) if (listed(discard, name)) throw new Error(`${name} is both kept and discarded: choose one`);
    const decision = (name: string): "keep" | "discard" | undefined => editorDecision(this.decisions, name);

    const changes = [...(await editorChanges(this.root, original, (file) => this.files.get(file)?.content, this.kept, this.triggersScope)), ...this.foundChanges];
    const undecided = changes.filter((change) => decision(change.name) === undefined);
    if (undecided.length > 0) throw new EditorChangesError(undecided);
    // A name that is neither is a mistake (a dry run, after sync, has fewer changes to name).
    const known = new Set([...changes.map((change) => change.name), ...(original.kept ?? []).map(entryName)]);
    const stray = [...(Array.isArray(keep) ? keep : []), ...(Array.isArray(discard) ? discard : [])].filter((name) => !known.has(name));
    if (stray.length > 0 && !dryRun) {
      throw new Error(`${stray.join(", ")} ${stray.length === 1 ? "is" : "are"} neither a change the Editor made nor kept: nothing is compiled. The changes are ${changes.map((change) => change.name).join(", ") || "none"}`);
    }

    // Discarding a kept entry by name has the Blueprint write it again.
    const reowned = (original.kept ?? []).filter((entry) => listed(discard, entryName(entry)));
    const kept = [
      ...(original.kept ?? []).filter((entry) => !reowned.includes(entry)),
      ...changes.flatMap((change) => (decision(change.name) === "keep" ? [keptEntryOf(change.entry)].filter((entry) => entry !== undefined) : [])),
    ];
    // A kept terrain file keeps the files the Editor computes from it, as it saved them.
    if (kept.some((entry) => entry.kind === "file" && entry.path.startsWith("t3"))) {
      for (const entry of original.entries) {
        if (entry.kind === "file" && DERIVED_TERRAIN_FILES.has(entry.path) && !kept.some((other) => other.kind === "file" && other.path === entry.path)) kept.push({ kind: "file", path: entry.path });
      }
    }
    this.keptEntries = kept;
    this.keptNames = new Set(kept.map(entryName));
    // A kept trigger or global keeps its name string (unless that change is discarded on its own)
    // and its Galaxy: the blocks under the name the Blueprint gives it, which the compile would
    // write, and under the one the package gives it.
    const strings = await this.existing(TRIGGER_STRINGS);
    const freshStrings = this.files.get(TRIGGER_STRINGS)?.content;
    const library = this.triggersScope.library;
    for (const entry of kept) {
      // A mod library's kept item keeps its name too, keyed lib_<library>_<id>.
      if (library !== undefined && isSplicedKind(entry.kind) && entry.kind !== "trigger" && entry.kind !== "variable") {
        const key = libraryStringKey(library, LIBRARY_ITEM_TYPES[entry.kind], "Name", (entry as { id: string }).id);
        if (!listed(discard, `string:${TRIGGER_STRINGS}:${key}`)) this.keptNames.add(`name:${key}`);
      }
      // A map's own function (a Mission Blueprint's, ADR-0026) keeps its name and Galaxy as a trigger does.
      if (entry.kind !== "trigger" && entry.kind !== "variable" && !(entry.kind === "function" && library === undefined)) continue;
      const type = SCRIPT_TYPES[entry.kind];
      const key = library === undefined ? `${type}/Name/${entry.id}` : libraryStringKey(library, type, "Name", entry.id);
      if (!listed(discard, `string:${TRIGGER_STRINGS}:${key}`)) this.keptNames.add(`name:${key}`);
      // A mod library's Galaxy isn't MapScript's: it has no blocks to keep.
      if (library !== undefined) continue;
      for (const source of [strings, typeof freshStrings === "string" ? freshStrings : undefined]) {
        const name = triggerStringName(source, type, entry.id);
        if (name !== undefined) this.keptScript.add(scriptNameOf(entry.kind, name));
      }
    }
    const keptScript = new Set([...this.keptScript].map(editorForm));
    const entries = original.entries.filter((entry) => {
      if (this.keptNames.has(entryName(entry))) return false;
      if (entry.kind === "string" && this.keptNames.has(`name:${entry.key}`)) return false;
      if (entry.kind === "galaxy-block") return !keptScript.has(editorForm(entry.id.split(/:(.*)/s)[1] ?? ""));
      return true;
    });
    // A reowned one is replaced as if the last compile had written it, a trigger or global with its name string and Galaxy.
    const unknown = "0".repeat(16);
    for (const entry of reowned) {
      entries.push({ ...entry, fingerprint: unknown } as CompileRecordEntry);
      if (entry.kind !== "trigger" && entry.kind !== "variable" && !(entry.kind === "function" && library === undefined)) continue;
      const type = SCRIPT_TYPES[entry.kind];
      entries.push({ kind: "string", file: TRIGGER_STRINGS, key: library === undefined ? `${type}/Name/${entry.id}` : libraryStringKey(library, type, "Name", entry.id), fingerprint: unknown });
      if (library !== undefined) continue;
      const name = triggerStringName(strings, type, entry.id);
      if (name === undefined) continue;
      const blocks = entry.kind === "trigger" ? ["trigger-variable", "trigger", "trigger-init"] : entry.kind === "function" ? ["function-declaration", "function"] : ["variable", "variable-init"];
      const script = scriptNameOf(entry.kind, name);
      for (const block of blocks) entries.push({ kind: "galaxy-block", id: `${block}:${script}`, fingerprint: unknown });
    }
    this.previous = { version: 1, entries };
    this.recordedFiles = new Set(entries.flatMap((entry) => (wholeFile(entry) ? [entry.path] : [])));
  }

  /** Whether the compile leaves this entry as the package has it: Compiled Content the author kept. */
  private keptHere(entry: KeptEntry): boolean {
    return this.keptNames.has(entryName(entry));
  }

  /** The entry names of what this compile would write, to tell which kept entries the Blueprint still declares. */
  private async freshNames(): Promise<Set<string>> {
    const names = new Set<string>();
    for (const [file, { content, kind }] of this.files) {
      if (typeof content !== "string") {
        names.add(`file:${file}`);
        continue;
      }
      if (kind === "objects") for (const element of objectElements(content)) names.add(`object:${element.key}`);
      else if (kind === "regions") for (const element of regionElements(content)) names.add(`region:${element.key}`);
      else if (kind === "strings") for (const line of stringLines(content).lines) names.add(`string:${file}:${line.key}`);
      else if (kind === "triggers") for (const item of triggerItems(content, this.triggersScope)) names.add(`${item.kind}:${item.id}`);
      else if (kind === "catalog") for (const entry of catalogEntries(content)) names.add(`catalog-entry:${file}:${entry.key}`);
      else names.add(`file:${file}`);
    }
    return names;
  }

  /** Tells the check of a converted part; it refuses one from finish's beforeWrite. */
  private convert(name: string, kept: string | Uint8Array, compiled: string | Uint8Array): void {
    this.replaceKept!(name, kept, compiled);
  }

  /** Whether the check may convert the Kept part `name`: with none, or out of its scope, it must come out the same. */
  private converts(name: string): boolean {
    return this.replaceKept !== undefined && this.convertsKept(name);
  }

  private full(file: string): string {
    return path.join(this.root, ...file.split("/"));
  }

  /** Every file the previous record touched, with how its entries are merged (a file it wrote whole is removed whole). */
  private previouslyWritten(): { path: string; merged?: MergedKind }[] {
    const out = new Map<string, MergedKind | undefined>();
    const merged = (file: string, kind: MergedKind): void => {
      if (!this.recordedFile(file)) out.set(file, kind);
    };
    for (const entry of this.previous?.entries ?? []) {
      // Triggers and MapScript.galaxy written whole still go through their merge: the Editor may have added Kept triggers since.
      if (entry.kind === "file" && entry.path === "Triggers") out.set(entry.path, "triggers");
      else if (entry.kind === "file" && entry.path === "MapScript.galaxy") out.set(entry.path, "mapscript");
      else if (wholeFile(entry)) out.set(entry.path, undefined);
      else if (entry.kind === "object") out.set("Objects", "objects");
      else if (entry.kind === "region") out.set("Regions", "regions");
      else if (entry.kind === "string") out.set(entry.file, "strings");
      else if (isSplicedKind(entry.kind)) merged("Triggers", "triggers");
      else if (entry.kind === "galaxy-block") merged("MapScript.galaxy", "mapscript");
      else if (entry.kind === "catalog-entry") out.set(entry.file, "catalog");
    }
    return [...out].map(([file, kind]) => (kind ? { path: file, merged: kind } : { path: file }));
  }

  /** The items the previous compile wrote in Triggers, by element key (recordedItemKey), and compile_cutscene's play-from-start script. */
  private previousTriggerKeys(): Set<string> {
    return recordedItemKeys(this.previous?.entries ?? []).add(PLAY_SCRIPT_KEY);
  }

  /**
   * Whether Triggers and MapScript.galaxy are spliced: the package's Triggers has items the record
   * doesn't list (Kept triggers, variables, categories), or is Kept Content itself, a file no
   * compile has written into (an imported map's, even with an empty Root). compile_cutscene's
   * play-from-start script isn't a Kept item: the compile drops it, as it always has.
   */
  private splicing(): Promise<boolean> {
    this.splicingTriggers ??= (async () => {
      if (!this.previous) return false;
      const existing = await this.existing("Triggers");
      if (existing === undefined) return false;
      if (!this.recordedFile("Triggers") && !this.splicedBefore("Triggers")) return true;
      // A mod's library the package had Kept stays spliced: the Editor may add to it, and writing it whole would reorder what the splice placed.
      if (this.triggersScope.library !== undefined && !this.recordedFile("Triggers")) return true;
      // A kept trigger or global stays as the Editor has it, even one the author deleted there.
      if (this.keptEntries.some((entry) => isSplicedKind(entry.kind))) return true;
      return keptItems(existing, this.previousTriggerKeys(), this.triggersScope).length > 0;
    })();
    return this.splicingTriggers;
  }

  /** Whether the previous compile spliced (it recorded triggers or Galaxy blocks, but not their files whole). */
  private splicedBefore(file: string): boolean {
    return !this.recordedFile(file) && (this.previous?.entries ?? []).some((entry) => (file === "MapScript.galaxy" ? entry.kind === "galaxy-block" : isSplicedKind(entry.kind)));
  }

  private recordedFile(file: string): boolean {
    return this.recordedFiles.has(file);
  }

  private async existingBytes(file: string): Promise<Uint8Array | undefined> {
    const full = this.full(file);
    return existsSync(full) ? readFile(full) : undefined;
  }

  private async existing(file: string): Promise<string | undefined> {
    const full = this.full(file);
    if (!existsSync(full)) return undefined;
    const text = await readFile(full, "utf8");
    return this.amendments.get(file)?.(text) ?? text;
  }

  private async merge(file: string, content: PackageContent | undefined, kind: PackageFileKind): Promise<Written> {
    switch (kind) {
      case "objects":
        return this.mergeElements(file, content as string | undefined, objectElements, (key, text) => ({ kind: "object", id: Number(key), fingerprint: fingerprint(text) }), "object", "PlacedObjects");
      case "regions":
        return this.mergeElements(file, content as string | undefined, regionElements, (key, text) => ({ kind: "region", id: Number(key), fingerprint: fingerprint(text) }), "region", "Regions");
      case "strings":
        return this.mergeStrings(file, content as string | undefined);
      case "triggers":
        return this.mergeTriggers(file, content as string | undefined);
      case "mapscript":
        return this.mergeMapScript(file, content as string | undefined);
      case "catalog":
        return this.mergeCatalog(file, content as string | undefined);
      case "generated":
        return this.whole(file, content!, true);
      case "version":
        return this.version(file, content as string | Uint8Array);
      case "components":
        return this.components(file, content as string);
      case "kept-components":
        throw new Error(`${file} is merged last, in finish`);
      case "file":
        if (this.keptHere({ kind: "file", path: file })) return { content: await this.existingBytes(file), entries: [] };
        return this.whole(file, content!);
    }
  }

  private async whole(file: string, content: PackageContent, overwrite = false): Promise<Written> {
    const bytes = isCopy(content) ? await readFile(content.copyFrom) : Buffer.from(content);
    const entries: CompileRecordEntry[] = [{ kind: "file", path: file, fingerprint: fingerprint(bytes) }];
    if (!this.previous || this.recordedFile(file) || overwrite) return { content, entries };
    // A file the package has that the last compile didn't write is Kept Content: written over only
    // when it would come out the same.
    const full = this.full(file);
    if (existsSync(full)) {
      const kept = await readFile(full);
      if (this.converts(`file:${file}`)) this.convert(`file:${file}`, kept, bytes);
      else if (!kept.equals(bytes) && !this.editorStockWater(file, kept)) throw new Error(`The compile would overwrite ${file}, which is Kept Content (not on the compile record)`);
    }
    return { content, entries };
  }

  /**
   * Whether `kept` is the WaterData.xml the Editor saves once the author draws water, holding only
   * its entries for stock types (map/write-water.ts onlyStockWater), and the compile writes the
   * water areas that use them: then the Mission's pools, which sync brought back with their heights,
   * replace it. With t3Water kept, the Editor's heights stay with its areas.
   */
  private editorStockWater(file: string, kept: Uint8Array): boolean {
    return file === WATER_DATA && this.files.has("t3Water") && !this.kept.has("t3Water") && !this.keptHere({ kind: "file", path: "t3Water" }) && onlyStockWater(Buffer.from(kept).toString("utf8"));
  }

  /**
   * ComponentList.SC2Components, written whole but keeping each component the package lists and
   * the compile doesn't write, such as the cutscenes compile_cutscene adds.
   */
  private async components(file: string, generated: string): Promise<Written> {
    const existing = this.previous ? await this.existing(file) : undefined;
    if (existing === undefined) return this.whole(file, generated);
    const line = /^[ \t]*<DataComponent\b[^>]*>([^<]*)<\/DataComponent>[ \t]*\r?$/gm;
    const written = new Set([...generated.matchAll(line)].map((match) => match[1]));
    const kept = [...existing.matchAll(line)].filter((match) => !written.has(match[1])).map((match) => match[0].replace(/\r$/, ""));
    const content = kept.length ? generated.replace("</Components>", `${kept.join("\n")}\n</Components>`) : generated;
    return { content, entries: [{ kind: "file", path: file, fingerprint: fingerprint(content) }] };
  }

  /**
   * A Kept ComponentList (Kept terrain): the package's own, byte for byte, with a line added for
   * each component the compile writes that it doesn't list, so the Editor and game load that file.
   * It stays off the record: what it lists is the package's to say.
   */
  private async keptComponents(file: string, generated: string, written: readonly string[]): Promise<Written> {
    const existing = await this.existing(file);
    if (existing === undefined) return this.components(file, generated);
    const line = /^([ \t]*)<DataComponent\b[^>]*>([^<]*)<\/DataComponent>[ \t]*\r?$/gm;
    const listed = [...existing.matchAll(line)];
    const have = new Set(listed.map((match) => match[2]));
    const missing = [...generated.matchAll(line)]
      .filter((match) => !have.has(match[2]) && written.some((path) => inComponent(path, match[2]!)))
      .map((match) => match[0].trim());
    if (missing.length === 0) return { content: existing, entries: [] };
    const newline = newlineOf(existing);
    const indent = listed[0]?.[1] ?? "    ";
    const close = existing.lastIndexOf("</Components>");
    if (close < 0) throw new Error(`${file} has no </Components>, so the compile can't list ${missing.join(", ")} in it`);
    const head = existing.slice(0, close);
    const content = `${head}${head.endsWith("\n") ? "" : newline}${missing.map((item) => `${indent}${item}${newline}`).join("")}${existing.slice(close)}`;
    return { content, entries: [] };
  }

  /** A component's .version: the Editor rewrites it on every save, so with a record an existing one is left as it is. */
  private async version(file: string, content: string | Uint8Array): Promise<Written> {
    const full = this.full(file);
    if (!this.previous || !existsSync(full)) return { content, entries: [{ kind: "file", path: file, fingerprint: fingerprint(content) }] };
    const kept = await readFile(full);
    return { content: kept, entries: this.recordedFile(file) ? [{ kind: "file", path: file, fingerprint: fingerprint(kept) }] : [] };
  }

  /**
   * Triggers: spliced beside Kept triggers (splice-triggers.ts), else written whole. Either way the
   * record lists each Compiled trigger and variable, by its kind and element Id, with a fingerprint of its XML.
   */
  private async mergeTriggers(file: string, content: string | undefined): Promise<Written> {
    if (await this.splicing()) {
      const previous = this.previousTriggerKeys();
      const skip = recordedItemKeys(this.keptEntries);
      const existing = (await this.existing(file))!;
      if (this.replaceKept && content !== undefined) {
        // A Kept trigger or global the compile now writes is converted: checked, then replaced like a Compiled one.
        const kept = triggerItemTexts(existing, this.triggersScope);
        // Only an item the compile writes: a category of the compile's may file a Kept one, by its line alone.
        const written = new Set(triggerItems(content, this.triggersScope).map(recordedItemKey));
        for (const [key, item] of triggerItemTexts(content, this.triggersScope)) {
          const was = kept.get(key);
          const name = `${itemKind(item.type)}:${item.id}`;
          if (!was || !written.has(key) || previous.has(key) || skip.has(key) || !this.convertsKept(name)) continue;
          this.convert(name, was.text, item.text);
          previous.add(key);
        }
      }
      const { content: spliced, items } = spliceTriggers(existing, content, previous, skip, this.triggersScope, this.placed);
      this.splicedTriggers = spliced;
      return { content: spliced, entries: items };
    }
    if (content === undefined) return { content: undefined, entries: [] };
    // Written whole over a file the last compile spliced, now that no Kept trigger is left in it.
    const whole = await this.whole(file, content, this.splicedBefore(file));
    return { content: whole.content, entries: [...whole.entries, ...triggerItems(content, this.triggersScope)] };
  }

  /**
   * MapScript.galaxy: spliced when Triggers is (splice-map-script.ts), keeping the Editor's Galaxy
   * for every Kept trigger, else written whole. Either way the record lists the Compiled triggers'
   * and variables' blocks, so a later splice finds them even in a script the Editor has saved since.
   */
  private async mergeMapScript(file: string, content: string | undefined): Promise<Written> {
    // A script the author kept (the Editor's change to the whole file) stays as the Editor saved it.
    if (this.keptHere({ kind: "file", path: file })) return { content: await this.existing(file), entries: [] };
    if (await this.splicing()) {
      const existing = withoutCustomScriptInMapScript((await this.existing(file)) ?? "", PLAY_SCRIPT_ID);
      if (!existing) throw new Error("The Map Package has Kept triggers but no MapScript.galaxy: save the map in the Editor so it writes one, then compile again");
      const previous = (this.previous?.entries ?? []).flatMap((entry) => (entry.kind === "galaxy-block" ? [entry.id] : []));
      if (this.replaceKept && content !== undefined) {
        // A Kept trigger's or global's Galaxy the compile now writes is converted: checked, then replaced like a Compiled block.
        for (const block of sharedBlocks(existing, content)) {
          const name = `galaxy:${file}:${block.id}`;
          if (previous.includes(block.id) || !this.convertsKept(name)) continue;
          this.convert(name, block.kept, block.compiled);
          previous.push(block.id);
        }
      }
      const { content: spliced, blocks } = spliceMapScript(existing, content, previous, this.keptScript, await this.triggerTreeOrder());
      return { content: spliced, entries: blocks.map((block) => ({ kind: "galaxy-block", ...block })) };
    }
    if (content === undefined) return { content: undefined, entries: [] };
    const whole = await this.whole(file, content, this.splicedBefore(file));
    return { content: whole.content, entries: [...whole.entries, ...scriptBlocks(content).map((block) => ({ kind: "galaxy-block" as const, ...block }))] };
  }

  /**
   * The spliced Triggers' globals and triggers, each by every script name it may have, in tree
   * order: from the compile's TriggerStrings, then the package's, enUS first and then each other
   * locale, where the Editor writes a new item's name when it is set to that language.
   */
  private async triggerTreeOrder(): Promise<string[][]> {
    if (this.splicedTriggers === undefined) return [];
    const fresh = this.files.get(TRIGGER_STRINGS)?.content;
    const locales = existsSync(this.full("")) ? (await readdir(this.full(""))).filter((name) => name.endsWith(".SC2Data") && name !== "Base.SC2Data").sort() : [];
    const files = [TRIGGER_STRINGS, ...locales.map((locale) => `${locale}/LocalizedData/TriggerStrings.txt`).filter((file) => file !== TRIGGER_STRINGS)];
    const strings = [typeof fresh === "string" ? fresh : "", ...(await Promise.all(files.map(async (file) => (await this.existing(file)) ?? "")))];
    return triggerTreeScriptNames(this.splicedTriggers, strings);
  }

  private async mergeElements(
    file: string,
    generated: string | undefined,
    scan: (xml: string) => Element[],
    entry: (key: string, text: string) => CompileRecordEntry,
    noun: string,
    rootTag: string,
  ): Promise<Written> {
    // A kept one is left as the package has it.
    const fresh = (generated === undefined ? [] : scan(generated)).filter((element) => !this.keptNames.has(`${noun}:${element.key}`));
    const entries = fresh.map((element) => entry(element.key, element.text));
    const found = this.previous ? await this.existing(file) : undefined;
    // With a record, a file the package lacks is made only when there is something to put in it.
    if (found === undefined) return { content: this.previous && fresh.length === 0 ? undefined : generated, entries };
    const previousCount = this.previous!.entries.filter((item) => item.kind === noun).length;
    // Nothing compiled into it, then or now: the file is the package's, left byte for byte.
    if (fresh.length === 0 && previousCount === 0) return { content: found, entries };
    // A list the Editor saved empty closes itself: opened up, so elements can go in it.
    const existing = found.replace(new RegExp(`<(${rootTag})(\\s[^>]*?)?\\s*/>`), (_, tag: string, attrs = "") => `<${tag}${attrs}>${newlineOf(found)}</${tag}>`);
    const newline = newlineOf(existing);

    const previousKeys = new Set(
      this.previous!.entries.flatMap((item) => ((item.kind === "object" && noun === "object") || (item.kind === "region" && noun === "region") ? [String(item.id)] : [])),
    );
    const byKey = new Map(fresh.map((element) => [element.key, element]));
    const placed = new Set<string>();
    let out = "";
    let cursor = 0;
    let lastCompiledEnd: number | undefined;
    for (const element of scan(existing)) {
      const replacement = byKey.get(element.key);
      // An adopted Id takes over a Kept doodad only: a Kept unit, point or camera there stays the package's.
      const adopted = noun === "object" && this.adopted.has(element.key) && /^\s*<ObjectDoodad\b/.test(element.text);
      if (!previousKeys.has(element.key) && !adopted) {
        // Kept: a compiled one may take its place only when it would write the same bytes.
        if (replacement && replacement.text !== element.text) {
          throw new Error(`The compile would overwrite ${noun} ${element.key} in ${file}, which is Kept Content (not on the compile record)`);
        }
        if (replacement) placed.add(element.key);
        continue;
      }
      // Compiled last time: replaced where it stands, or removed with its line.
      if (replacement) {
        out += existing.slice(cursor, element.start) + replacement.text;
        placed.add(element.key);
        cursor = element.end;
        lastCompiledEnd = out.length;
      } else {
        out += existing.slice(cursor, lineBefore(existing, element.start));
        cursor = element.end;
      }
    }
    out += existing.slice(cursor);
    // New ones go after the last compiled one, or at the end of the list.
    const added = fresh.filter((element) => !placed.has(element.key)).map((element) => `${newline}${element.text}`).join("");
    if (added) {
      const at = lastCompiledEnd ?? lineBefore(out, out.lastIndexOf(`</${rootTag}>`));
      out = out.slice(0, at) + added + out.slice(at);
    }
    return { content: out, entries };
  }

  /**
   * A GameData catalog file, by entry: each Compiled entry replaced where it stands or removed with
   * its line, a new one after the last Compiled one or at the end of the catalog, and every Kept
   * entry, comment and line left as it was. A Kept entry the compile writes is converted, in its
   * place, when the check allows it.
   */
  private async mergeCatalog(file: string, generated: string | undefined): Promise<Written> {
    const existing = this.previous ? await this.existing(file) : undefined;
    const newline = existing === undefined ? "\n" : newlineOf(existing);
    const lines = (text: string): string => text.replace(/\r?\n/g, newline);
    const all = generated === undefined ? [] : catalogEntries(generated);
    const twice = all.find((entry, index) => all.findIndex((other) => other.key === entry.key) !== index);
    if (twice) throw new Error(`The compile writes ${twice.key} twice in ${file}: an entry is written once`);
    const fresh = all.filter((entry) => !this.keptNames.has(`catalog-entry:${file}:${entry.key}`)).map((entry) => ({ ...entry, text: lines(entry.text) }));
    const entries: CompileRecordEntry[] = fresh.map((entry) => ({ kind: "catalog-entry", file, id: entry.key, fingerprint: fingerprint(entry.text) }));
    if (existing === undefined) {
      if (fresh.length === 0) return { content: undefined, entries };
      return { content: emptyCatalog("\n").replace("</Catalog>", `${fresh.map((entry) => `${entry.text}\n`).join("")}</Catalog>`), entries };
    }
    const previousKeys = new Set(this.previous!.entries.flatMap((item) => (item.kind === "catalog-entry" && item.file === file ? [item.id] : [])));
    if (fresh.length === 0 && previousKeys.size === 0) return { content: existing, entries };
    // A catalog the Editor saved empty closes itself: opened up, so entries can go in it.
    const opened = existing.replace(/<Catalog(\s[^>]*?)?\s*\/>/, (_, attrs = "") => `<Catalog${attrs}>${newline}</Catalog>`);
    const byKey = new Map(fresh.map((entry) => [entry.key, entry]));
    const placed = new Set<string>();
    let out = "";
    let cursor = 0;
    let lastCompiledEnd: number | undefined;
    const found = catalogEntries(opened);
    for (const entry of found) {
      const replacement = byKey.get(entry.key);
      if (replacement && found.filter((other) => other.key === entry.key).length > 1) throw new Error(`${file} has ${entry.key} more than once, so the compile can't tell which one it writes: remove the extra one in the Editor`);
      const compiled = previousKeys.has(entry.key);
      if (!compiled && !replacement) continue;
      if (!compiled) {
        // Kept: a compiled one may take its place only when the check allows it.
        if (this.converts(`catalog-entry:${file}:${entry.key}`)) this.convert(`catalog-entry:${file}:${entry.key}`, entry.text, replacement!.text);
        else if (replacement!.text !== entry.text) throw new Error(`The compile would overwrite catalog entry ${entry.key} in ${file}, which is Kept Content (not on the compile record)`);
      }
      if (replacement) {
        out += opened.slice(cursor, entry.start) + replacement.text;
        placed.add(entry.key);
        cursor = entry.end;
        lastCompiledEnd = out.length;
      } else {
        out += opened.slice(cursor, lineBefore(opened, entry.start));
        cursor = entry.end;
      }
    }
    out += opened.slice(cursor);
    const added = fresh.filter((entry) => !placed.has(entry.key));
    if (added.length > 0) {
      const close = rootChildren(out).rootClose;
      if (close === undefined) throw new Error(`${file} has no closing </Catalog> for the compile's entries to go before`);
      const at = lastCompiledEnd ?? lineBefore(out, close);
      out = out.slice(0, at) + added.map((entry) => `${newline}${entry.text}`).join("") + out.slice(at);
    }
    // Emptied, a catalog the compile made (as it writes one, with nothing left in it) goes; one the Editor saved stays, an empty catalog.
    if (out === emptyCatalog("\n")) return { content: undefined, entries };
    return { content: out, entries };
  }

  private async mergeStrings(file: string, generated: string | undefined): Promise<Written> {
    const fresh = (generated === undefined ? [] : stringLines(generated).lines).filter((line) => !this.keptNames.has(`string:${file}:${line.key}`) && !this.keptNames.has(`name:${line.key}`));
    const entries: CompileRecordEntry[] = fresh.map((line) => ({ kind: "string", file, key: line.key, fingerprint: fingerprint(line.text) }));
    const existing = this.previous ? await this.existing(file) : undefined;
    if (existing === undefined) return { content: generated, entries };

    const previousKeys = new Set(this.previous!.entries.flatMap((item) => (item.kind === "string" && item.file === file ? [item.key] : [])));
    const byKey = new Map(fresh.map((line) => [line.key, line]));
    const placed = new Set<string>();
    // Kept lines that hold no key stay where they are, as every Kept byte does.
    const { bom, lines } = stringLines(existing, { keyless: true });
    const out: string[] = [];
    let lastCompiled: number | undefined;
    for (const line of lines) {
      // An Accepted Removal drops a Kept line; a Compiled one, or one the compile writes, is the Blueprint's.
      const removal = removalOfLine(file, line, this.removals);
      if (removal && (line.key === "" || (!previousKeys.has(line.key) && !byKey.has(line.key)))) {
        this.removedKept.add(removal);
        continue;
      }
      if (line.key === "") {
        out.push(line.text);
        continue;
      }
      const replacement = byKey.get(line.key);
      if (!previousKeys.has(line.key)) {
        if (replacement && this.converts(`string:${file}:${line.key}`)) {
          // Converted: the compile's line takes the Kept one's place.
          this.convert(`string:${file}:${line.key}`, line.text, replacement.text);
          out.push(replacement.text);
          placed.add(line.key);
          lastCompiled = out.length;
          continue;
        }
        if (replacement && replacement.text.trimEnd() !== line.text.trimEnd()) {
          throw new Error(`The compile would overwrite string ${line.key} in ${file}, which is Kept Content (not on the compile record)`);
        }
        if (replacement) placed.add(line.key);
        out.push(line.text);
        continue;
      }
      if (replacement) {
        out.push(replacement.text);
        placed.add(line.key);
        lastCompiled = out.length;
      }
    }
    const added = fresh.filter((line) => !placed.has(line.key)).map((line) => line.text);
    out.splice(lastCompiled ?? out.length, 0, ...added);
    // A strings file left with no keys goes, as the compiler writes none.
    return { content: out.length === 0 ? undefined : bom + out.join(""), entries };
  }
}

/** A catalog file as the compile makes one, with no entries in it. */
const emptyCatalog = (newline: string): string => ["<?xml version=\"1.0\" encoding=\"utf-8\"?>", "<Catalog>", "</Catalog>", ""].join(newline);

/** Where the line ending before `index` starts (its CR, if it has one), so text cut or inserted there keeps whole lines. */
function lineBefore(text: string, index: number): number {
  const newline = text.lastIndexOf("\n", index - 1);
  if (newline < 0) return index;
  return text[newline - 1] === "\r" ? newline - 1 : newline;
}

/** The file's line ending: CRLF when it has one, as the Editor writes some files. */
function newlineOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function isCopy(content: PackageContent): content is { readonly copyFrom: string } {
  return typeof content === "object" && "copyFrom" in content;
}

/** Whether `file`, a path in the package, belongs to the component at `component` (a ComponentList entry's path). */
function inComponent(file: string, component: string): boolean {
  if (component === "GameData") return file.startsWith("Base.SC2Data/GameData/");
  if (component === "GameText") return /^[a-z]{2}[A-Z]{2}\.SC2Data\/LocalizedData\//.test(file);
  return file === component;
}

/** The Triggers element type of a record kind with a script name: a trigger, a global or a map function. */
const SCRIPT_TYPES = { trigger: "Trigger", variable: "Variable", function: "FunctionDef" } as const;

/** The Galaxy name the Editor gives an element of `kind` named `name` (gt_, gv_, gf_). */
const scriptNameOf = (kind: keyof typeof SCRIPT_TYPES, name: string): string => (kind === "trigger" ? editorTriggerName(name) : kind === "function" ? `gf_${galaxyIdentifier(name)}` : editorGlobalName(name));
