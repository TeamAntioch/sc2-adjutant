// The trigger functions in reach, searched and resolved in the Editor's terms (#1029): the game's
// libraries (data/trigger-libraries.json) and those a package's dependency mods put in reach
// (librariesInReach), each function by its name, library, category, kind, parameters' names and
// types, return type and hint, as the Editor's function list shows them.
//
// searchFunctions finds them by words of the name or identifier, category, kind, parameter type
// and return type, for the search tool. resolveFunction finds the one a name, identifier or
// `<library>/<id>` stands for, optionally in one library, for the authoring tool (#1033): a name
// two libraries share is ambiguous until a library is given.
//
// A type is named as the Editor names it: the trigger type's name (unitgroup: Unit Group), a
// preset's type by its preset's name, a game link by its catalog. A query's type is matched by
// either name, in any case and spacing.

import type { LibraryFunction } from "../domain/library-interface.js";
import { galaxyIdentifier } from "../triggers/trigger-model.js";
import { type GameFunction, type GameLibrary, gameTriggerTypeNames } from "./library-galaxy.js";
import { KIND_FLAGS } from "./library-reach.js";

export type FunctionKind = LibraryFunction["kind"];

/** A function in reach, in the Editor's terms, with its Ids (`<library>/<id>`) for the authoring tool. */
export type FunctionEntry = {
  /** `<library>/<id>`, as a call names it. */
  readonly id: string;
  readonly name: string;
  readonly library: string;
  /** Its library's name, as the Editor shows it (Built-In, Swarm). */
  readonly libraryName?: string;
  readonly category?: string;
  readonly kind: FunctionKind;
  /** Its Galaxy name, as the Editor's identifier (or its name's) gives it. */
  readonly identifier: string;
  readonly parameters: readonly FunctionParameterEntry[];
  /** Its return type, in the Editor's terms. */
  readonly returns?: string;
  readonly hint?: string;
};
export type FunctionParameterEntry = {
  /** `<library>/<id>` of its ParamDef. */
  readonly id: string;
  readonly name: string;
  /** Its type, in the Editor's terms. */
  readonly type: string;
};

/** A search hit: a FunctionEntry without its Ids unless they were asked for. */
export type FunctionHit = Omit<FunctionEntry, "id" | "parameters"> & {
  readonly id?: string;
  readonly parameters: readonly (Omit<FunctionParameterEntry, "id"> & { readonly id?: string })[];
};

export type FunctionQuery = {
  /** Words each found in its name or identifier, in any case. */
  readonly text?: string | undefined;
  /** Words found in its category. */
  readonly category?: string | undefined;
  readonly kind?: FunctionKind | undefined;
  /** Types it takes a parameter of, each: the Editor's name (Unit Group) or the type's (unitgroup). */
  readonly takes?: readonly string[] | undefined;
  readonly returns?: string | undefined;
  /** Its library, by id (Ntve) or name (Built-In). */
  readonly library?: string | undefined;
  /** Hits returned at most (25 by default); `total` counts them all. */
  readonly limit?: number | undefined;
  /** Give each hit's and parameter's Id. */
  readonly ids?: boolean | undefined;
};

export type FunctionSearch = {
  readonly hits: readonly FunctionHit[];
  /** Every function the query matches, beyond the limit too. */
  readonly total: number;
  /** What in reach can't be searched, with why: a library every call into is refused, or a mod's function whose definition can't be read. */
  readonly refused: readonly { readonly library: string; readonly why: string }[];
};

/** What a name stands for in reach (resolveFunction). */
export type FunctionResolution = { readonly status: "found"; readonly fn: FunctionEntry } | { readonly status: "ambiguous"; readonly candidates: readonly FunctionEntry[] } | { readonly status: "none" };

const DEFAULT_LIMIT = 25;

/** A parameter's or return value's type, as functionEntries names it. */
type TypeShown = { readonly type?: string | undefined; readonly element?: string | undefined; readonly gameType?: string | undefined };

/** The function kind of each of the game data's kind flags (KIND_FLAGS turned round). */
const KIND_OF_FLAG: ReadonlyMap<string, FunctionKind> = new Map(Object.entries(KIND_FLAGS).map(([kind, flag]) => [flag, kind as FunctionKind]));

/** A name or type as a query compares it: lower case, without spaces. */
const folded = (text: string): string => text.toLowerCase().replace(/\s+/g, "");
const words = (text: string): string[] => text.toLowerCase().split(/\s+/).filter(Boolean);

/** A function in reach as a search reads it: its entry, and the names each of its types answers to (its return type's first, then each parameter's). */
type Indexed = { readonly entry: FunctionEntry; readonly types: readonly (readonly string[])[] };

/**
 * A parameter's, variable's or return value's type as the Editor names it: the trigger type's name
 * (unitgroup: Unit Group), a preset's type by its preset's name, a game link by its catalog.
 */
export function editorTypeName(libraries: Readonly<Record<string, GameLibrary>>, spec: TypeShown): string {
  const types = gameTriggerTypeNames();
  const type = spec.type ?? "";
  if (type === "preset" && spec.element) {
    const [presetLibrary, presetId] = spec.element.split("/") as [string, string];
    const preset = libraries[presetLibrary]?.presets[presetId];
    if (preset?.name) return preset.name;
  }
  if (type === "gamelink" && spec.gameType) return `${types["gamelink"] ?? "Game Link"} - ${spec.gameType}`;
  return types[type] ?? type;
}

/** Every function in reach, indexed for search, library by library in reach order. */
function indexed(libraries: Readonly<Record<string, GameLibrary>>): Indexed[] {
  const typeName = (spec: TypeShown): string => editorTypeName(libraries, spec);
  // A type answers to the name the Editor shows and to its own (unitgroup), folded.
  const answers = (spec: TypeShown | undefined): string[] => (spec === undefined ? [] : [...new Set([folded(typeName(spec)), ...(spec.type ? [folded(spec.type)] : [])])]);
  const out: Indexed[] = [];
  for (const [library, lib] of Object.entries(libraries)) {
    for (const [id, fn] of Object.entries(lib.functions)) {
      out.push({ entry: entryOf(library, lib, id, fn, typeName), types: [answers(fn.returns), ...fn.params.map((param) => answers(lib.params[param]))] });
    }
  }
  return out;
}

/** Every function in reach, in the Editor's terms, library by library in reach order. */
export const functionEntries = (libraries: Readonly<Record<string, GameLibrary>>): FunctionEntry[] => indexed(libraries).map(({ entry }) => entry);

function entryOf(library: string, lib: GameLibrary, id: string, fn: GameFunction, typeName: (spec: TypeShown) => string): FunctionEntry {
  const kind = fn.flags.map((flag) => KIND_OF_FLAG.get(flag)).find((found) => found !== undefined) ?? "function";
  const name = fn.name ?? fn.identifier ?? id;
  return {
    id: `${library}/${id}`,
    name,
    library,
    ...(lib.name !== undefined ? { libraryName: lib.name } : {}),
    ...(fn.category !== undefined ? { category: fn.category } : {}),
    kind,
    identifier: fn.identifier ?? galaxyIdentifier(name),
    parameters: fn.params.map((param) => {
      const def = lib.params[param];
      return { id: `${library}/${param}`, name: def?.name ?? def?.identifier ?? param, type: def ? typeName(def) : "" };
    }),
    ...(fn.returns ? { returns: typeName(fn.returns) } : {}),
    // The Editor's line break (<n/>) as a new line.
    ...(fn.hint !== undefined ? { hint: fn.hint.replace(/<n\/>/g, "\n") } : {}),
  };
}

const inLibrary = (entry: FunctionEntry, library: string): boolean => folded(entry.library) === folded(library) || (entry.libraryName !== undefined && folded(entry.libraryName) === folded(library));

/** How well `entry`'s name matches `text`: an exact name or identifier first, then a name it starts, then one holding it, then the rest. */
const rank = (entry: FunctionEntry, text: string | undefined): number => {
  if (!text) return 0;
  const name = entry.name.toLowerCase();
  const wanted = text.trim().toLowerCase();
  if (name === wanted || entry.identifier.toLowerCase() === wanted) return 0;
  if (name.startsWith(wanted)) return 1;
  if (name.includes(wanted)) return 2;
  return 3;
};

/** The functions in reach `query` matches, best match first, in the Editor's terms. */
export function searchFunctions(libraries: Readonly<Record<string, GameLibrary>>, query: FunctionQuery): FunctionSearch {
  const text = query.text ? words(query.text) : [];
  const category = query.category ? words(query.category) : [];
  const returns = query.returns === undefined ? undefined : folded(query.returns);
  const takes = (query.takes ?? []).map(folded);
  const matched = indexed(libraries).flatMap(({ entry, types: [returned = [], ...taken] }) => {
    if (query.kind && entry.kind !== query.kind) return [];
    if (query.library && !inLibrary(entry, query.library)) return [];
    const named = `${entry.name} ${entry.identifier}`.toLowerCase();
    if (!text.every((word) => named.includes(word))) return [];
    const filed = (entry.category ?? "").toLowerCase();
    if (!category.every((word) => filed.includes(word))) return [];
    if (returns !== undefined && !returned.includes(returns)) return [];
    return takes.every((type) => taken.some((names) => names.includes(type))) ? [entry] : [];
  });
  // A stable sort keeps reach order within a rank: the game's libraries before the mods'.
  const sorted = matched.map((entry, order) => ({ entry, order, rank: rank(entry, query.text) })).sort((a, b) => a.rank - b.rank || a.order - b.order);
  const hits = sorted.slice(0, query.limit ?? DEFAULT_LIMIT).map(({ entry }) => (query.ids ? entry : withoutIds(entry)));
  const refused = Object.entries(libraries).flatMap(([library, lib]) => [
    ...(lib.refused !== undefined ? [{ library, why: lib.refused }] : []),
    ...Object.entries(lib.unreadable ?? {}).map(([id, reason]) => ({ library, why: `its function ${id} can't be read: ${reason}` })),
  ]);
  return { hits, total: matched.length, refused };
}

const withoutIds = ({ id: _id, parameters, ...rest }: FunctionEntry): FunctionHit => ({ ...rest, parameters: parameters.map(({ id: _param, ...parameter }) => parameter) });

/**
 * The function in reach `name` stands for: its name or identifier in any case, or its
 * `<library>/<id>`, in `library` (by id or name) when one is given. A name more than one function
 * has is ambiguous, each candidate given with its library; one none has is none.
 */
export function resolveFunction(libraries: Readonly<Record<string, GameLibrary>>, name: string, options: { readonly library?: string | undefined } = {}): FunctionResolution {
  const wanted = name.trim().toLowerCase();
  const candidates = functionEntries(libraries).filter(
    (entry) => (options.library === undefined || inLibrary(entry, options.library)) && (entry.id.toLowerCase() === wanted || entry.name.toLowerCase() === wanted || entry.identifier.toLowerCase() === wanted),
  );
  if (candidates.length === 0) return { status: "none" };
  if (candidates.length === 1) return { status: "found", fn: candidates[0]! };
  return { status: "ambiguous", candidates };
}

/**
 * A search's hits as lines, each as the Editor's function list shows it:
 * `Center Of Unit Group (Built-In, Unit Group > Groups): function (Unit Group: Unit Group) returns Point`,
 * its Id after its name when given, its hint indented under it.
 */
export function formatFunctionSearch({ hits, total, refused }: FunctionSearch): string {
  const lines = hits.length === 0 ? ["No function in reach matches."] : [hits.length < total ? `${hits.length} of ${total} matching functions:` : `${total} matching function${total === 1 ? "" : "s"}:`];
  for (const hit of hits) {
    const where = [hit.libraryName ?? hit.library, ...(hit.category !== undefined ? [hit.category] : [])].join(", ");
    const parameters = hit.parameters.map((parameter) => `${parameter.name}: ${parameter.type}${parameter.id !== undefined ? ` [${parameter.id}]` : ""}`).join(", ");
    lines.push(`${hit.name}${hit.id !== undefined ? ` [${hit.id}]` : ""} (${where}): ${hit.kind} (${parameters})${hit.returns !== undefined ? ` returns ${hit.returns}` : ""}`);
    if (hit.hint) lines.push(...hit.hint.split("\n").map((line) => `    ${line}`));
  }
  for (const { library, why } of refused) lines.push(`Not searched in ${library}: ${why}.`);
  return lines.join("\n");
}
