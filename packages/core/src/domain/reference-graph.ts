// The Blueprint's reference graph: which lists of the Blueprint hold ids, and which fields name an
// Anchor. One table, asked by validation (duplicate and unknown ids, in mission-blueprint.ts) and by
// sync (is this Anchor still named by anything, in sync/sync-anchors.ts and sync-doodads.ts). Everything here reads a
// Blueprint as plain JSON, parsed or raw, so it is tested without a full Blueprint parse.
//
// What the table does not hold: the rules that need more than "is this id there" (a Wave unit's
// variable names, editorId collisions, Kept Reference namespaces, which kind of Anchor a field wants)
// stay with the validator.

/** A list of the Blueprint whose entries carry an `id` that must be unique. */
export type Collection =
  | "zones"
  | "anchors"
  | "kept"
  | "placements"
  | "regions"
  | "composites"
  | "beats"
  | "objectives"
  | "encounters"
  | "waves"
  | "ramps"
  | "terrainObjects"
  | "mechanics"
  | "scenes";

/** Where a collection's entries sit in the Blueprint (the path of its list). */
export const COLLECTION_LISTS: Readonly<Record<Collection, readonly string[]>> = {
  zones: ["zones"],
  anchors: ["anchors"],
  kept: ["kept"],
  placements: ["placements"],
  regions: ["regions"],
  composites: ["composites"],
  beats: ["beats"],
  objectives: ["objectives"],
  encounters: ["encounters"],
  waves: ["waves"],
  ramps: ["ramps"],
  terrainObjects: ["terrainObjects"],
  mechanics: ["mechanics"],
  scenes: ["screenplay", "scenes"],
};

/** The collections an "Unknown <noun> id" issue is raised for, and what one entry is called. */
const NOUNS = { zones: "zone", anchors: "anchor", beats: "beat", encounters: "encounter", mechanics: "mechanic" } as const;

/** A path through a Blueprint's JSON: a key, or `*` for every key or index at that level. */
type Pattern = readonly string[];

/** Every id in a collection, in order, with the path of the `id` field that holds it. */
export function idEntries(blueprint: unknown, collection: Collection): { readonly id: string; readonly path: (string | number)[] }[] {
  const entries: { id: string; path: (string | number)[] }[] = [];
  walk(blueprint, [...COLLECTION_LISTS[collection], "*", "id"], [], (value, path) => {
    if (typeof value === "string") entries.push({ id: value, path });
  });
  return entries;
}

/** The ids of a collection. */
export const idsOf = (blueprint: unknown, collection: Collection): string[] => idEntries(blueprint, collection).map((entry) => entry.id);

/** The issue for an id no entry of `collection` has: `Unknown <noun> id: <id>` at `path`. */
export function unknownIdIssue(collection: keyof typeof NOUNS, id: string, path: (string | number)[]): { code: "custom"; message: string; path: (string | number)[] } {
  return { code: "custom", message: `Unknown ${NOUNS[collection]} id: ${id}`, path };
}

/** A cue names an Anchor by `anchorId` (an anchorNears cue also by `targetId`); a condition by `anchorId`. */
const CUE_ANCHOR_FIELDS = ["anchorId", "targetId"] as const;
const CUE_HOLDERS: readonly Pattern[] = [
  ["screenplay", "script", "cues", "*", "cue"],
  ["transitions", "*", "cue"],
  ["uiActions", "*", "cue"],
  ["screenplay", "scenes", "*", "cue"],
  ["kept", "*", "hold", "until"],
];
const CONDITION_HOLDERS: readonly Pattern[] = [["beats", "*", "startsWhen", "*"], ["objectives", "*", "completeWhen"], ["encounters", "*", "startsWhen"], ["outcomes", "victory", "*"], ["outcomes", "defeat", "*"]];

/** Every field of the Blueprint's schema that names an Anchor (a test walks the schema to keep this whole). */
export const ANCHOR_FIELD_PATTERNS: readonly Pattern[] = [
  ["beats", "*", "anchorIds", "*"],
  ["beats", "*", "reveals", "*", "at"],
  ["encounters", "*", "behavior", "anchorId"],
  ["encounters", "*", "attackerAnchorIds", "*"],
  ["waves", "*", "spawnAnchorId"],
  // A placed doodad, by its Anchor's id or a set piece's `<set piece>/<type>/<n>`.
  ["pathingPaint", "*", "doodad"],
  ["waves", "*", "units", "*", "anchorId"],
  ["screenplay", "script", "speakerAnchors", "*"],
  ["screenplay", "scenes", "*", "lines", "*", "speakerAnchorId"],
  ...CONDITION_HOLDERS.map((holder) => [...holder, "anchorId"]),
  ...CUE_HOLDERS.flatMap((holder) => CUE_ANCHOR_FIELDS.map((field) => [...holder, field])),
];

/**
 * Free-form blobs the schema leaves to Plugins and Placements: whatever they hold, an Anchor's id may
 * be named in it, as a value or as a key, at any depth.
 */
export const FREE_FORM_PATTERNS: readonly Pattern[] = [
  ["placements", "*", "params"],
  ["mechanics", "*", "params"],
  ["uiActions", "*", "params"],
];

/** Every place a Blueprint's JSON names an Anchor: the id and the path of the field that holds it. */
export function anchorReferences(blueprint: unknown): { readonly id: string; readonly path: (string | number)[] }[] {
  const references: { id: string; path: (string | number)[] }[] = [];
  for (const pattern of ANCHOR_FIELD_PATTERNS) {
    walk(blueprint, pattern, [], (value, path) => {
      if (typeof value === "string") references.push({ id: value, path });
    });
  }
  for (const pattern of FREE_FORM_PATTERNS) {
    walk(blueprint, pattern, [], (blob, path) => deepStrings(blob, path, (id, at) => references.push({ id, path: at })));
  }
  return references;
}

/** The ids the Blueprint names as Anchors (an Anchor's own entry doesn't count), found in one pass. */
export function namedAnchorIds(blueprint: unknown): Set<string> {
  return new Set(anchorReferences(blueprint).map((reference) => reference.id));
}

/** Calls `visit` with each value `pattern` reaches in `node`. */
function walk(node: unknown, pattern: Pattern, at: (string | number)[], visit: (value: unknown, path: (string | number)[]) => void): void {
  if (pattern.length === 0) return visit(node, at);
  if (typeof node !== "object" || node === null) return;
  const [head, ...rest] = pattern as [string, ...string[]];
  if (head !== "*") {
    if (!Array.isArray(node) && Object.hasOwn(node, head)) walk((node as Record<string, unknown>)[head], rest, [...at, head], visit);
    return;
  }
  if (Array.isArray(node)) node.forEach((child, index) => walk(child, rest, [...at, index], visit));
  else for (const [key, child] of Object.entries(node)) walk(child, rest, [...at, key], visit);
}

/** Every string a JSON value holds, keys of its objects included. */
function deepStrings(node: unknown, at: (string | number)[], visit: (text: string, path: (string | number)[]) => void): void {
  if (typeof node === "string") visit(node, at);
  else if (Array.isArray(node)) node.forEach((child, index) => deepStrings(child, [...at, index], visit));
  else if (typeof node === "object" && node !== null) {
    for (const [key, child] of Object.entries(node)) {
      visit(key, [...at, key]);
      deepStrings(child, [...at, key], visit);
    }
  }
}
