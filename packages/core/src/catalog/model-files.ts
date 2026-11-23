// Where a model's .m3 lives, from the game's ModelData catalogs. A CModel names its file in
// <Model value=...> or inherits it from its parent; later catalogs (a mod loaded after another)
// override earlier ones. An inherited path is often a template the game fills in for each model,
// "Assets\##Prefix####Race##\##id##\##id##.m3": ##id## is the model's own id, and any other token
// the nearest value up its parents, an attribute on an entry (Race="Protoss") or a template's
// <?token id="Race" value="Neutral"?> default.

type ModelEntry = {
  readonly parent?: string | undefined;
  readonly file?: string | undefined;
  readonly requiredAnims?: readonly string[] | undefined;
  /** Its VariationCount: with more than one, its files are numbered <name>_00.m3, <name>_01.m3, … */
  readonly variations?: number | undefined;
  /** Its token values: its attributes past id and parent, then its <?token?> defaults where it has no attribute. */
  readonly tokens?: Readonly<Record<string, string>> | undefined;
};

/** Attributes of a CModel's own that aren't tokens. */
const NOT_TOKENS = new Set(["id", "parent", "default"]);

/** Every CModel in the catalogs, later catalogs overriding earlier ones field by field. */
export function readModelEntries(catalogs: readonly string[]): Map<string, ModelEntry> {
  const entries = new Map<string, ModelEntry>();
  for (const xml of catalogs) {
    for (const match of xml.matchAll(/<CModel\b([^>]*?)(\/>|>([\s\S]*?)<\/CModel>)/g)) {
      const attrs = match[1]!;
      const id = /\bid="([^"]+)"/.exec(attrs)?.[1];
      if (!id) continue;
      const parent = /\bparent="([^"]+)"/.exec(attrs)?.[1];
      const file = /<Model value="([^"]+)"/.exec(match[3] ?? "")?.[1];
      const requiredAnims = [...(match[3] ?? "").matchAll(/<RequiredAnims value="([^"]+)"/g)].map((anims) => anims[1]!);
      const declared = [...(match[3] ?? "").matchAll(/<\?token\s+id="([^"]+)"\s+value="([^"]*)"/g)].map((token) => [token[1]!, token[2]!] as const);
      const set = [...attrs.matchAll(/\b(\w+)="([^"]*)"/g)].filter((attr) => !NOT_TOKENS.has(attr[1]!)).map((attr) => [attr[1]!, attr[2]!] as const);
      const count = /<VariationCount value="(\d+)"/.exec(match[3] ?? "")?.[1];
      const known = entries.get(id) ?? {};
      // A null-prototype record, so a token named like an Object key ("constructor") is only ever a token.
      const tokens: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, known.tokens, Object.fromEntries(declared), Object.fromEntries(set));
      entries.set(id, {
        parent: parent ?? known.parent,
        file: file ?? known.file,
        requiredAnims: requiredAnims.length ? requiredAnims : known.requiredAnims,
        ...(count !== undefined ? { variations: Number(count) } : known.variations !== undefined ? { variations: known.variations } : {}),
        ...(Object.keys(tokens).length ? { tokens } : {}),
      });
    }
  }
  return entries;
}

/** The .m3a files a model loads beside its own (RequiredAnims), with forward slashes, from it or its nearest parent that names any. */
export function requiredAnimFiles(entries: ReadonlyMap<string, ModelEntry>, id: string): string[] {
  const seen = new Set<string>();
  for (let current: string | undefined = id; current !== undefined && !seen.has(current); current = entries.get(current)?.parent) {
    seen.add(current);
    const files = entries.get(current)?.requiredAnims;
    if (files?.length) return files.map((file) => file.replace(/\\/g, "/"));
  }
  return [];
}

/** The model's VariationCount, from it or its nearest parent that gives one; 1 when none does. */
export function modelVariations(entries: ReadonlyMap<string, ModelEntry>, id: string): number {
  const seen = new Set<string>();
  for (let current: string | undefined = id; current !== undefined && !seen.has(current); current = entries.get(current)?.parent) {
    seen.add(current);
    const count = entries.get(current)?.variations;
    if (count !== undefined) return count;
  }
  return 1;
}

/**
 * The model's .m3 storage path with forward slashes, following parents, its template's tokens filled
 * in as the game does (a token no entry gives a value is left as it is); undefined when unknown.
 */
export function modelFile(entries: ReadonlyMap<string, ModelEntry>, id: string): string | undefined {
  const seen = new Set<string>();
  const tokens = new Map<string, string>();
  let file: string | undefined;
  for (let current: string | undefined = id; current !== undefined && !seen.has(current); current = entries.get(current)?.parent) {
    seen.add(current);
    const entry = entries.get(current);
    // The nearest value wins: the model's own, then its parent's, and so on up.
    for (const [token, value] of Object.entries(entry?.tokens ?? {})) if (!tokens.has(token)) tokens.set(token, value);
    file ??= entry?.file;
  }
  if (!file) return undefined;
  return file.replace(/##(\w+)##/g, (whole, token: string) => (token === "id" ? id : (tokens.get(token) ?? whole))).replace(/\\/g, "/");
}
