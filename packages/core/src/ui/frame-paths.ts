// The frame-path check (ADR-0019, spec decision 7). A hookup or a create-from-template call names
// a frame by its path, and when no layout has that frame the call is likely to find nothing (not
// yet confirmed in game). This reads the frames a set of layouts declares, finds the literal paths
// Galaxy passes to the four natives that take one, and says which of them no layout has.
//
// A frame's path is its layout file's name (the .SC2Layout file's stem) and its names from the
// file's top: `HarbourUI/Dock/Title`. A frame declared with `file="X"` is X's, in the nested form
// (`<Frame name="GameUI" file="GameUI">…`) and the flat one (`name="GameUI/UIContainer/…"`). A
// frame made from a template (`template="X/Y"`) has the template's frames too, found when a path
// is looked up rather than copied, since Blizzard's templates of templates would copy out to
// hundreds of thousands of paths. Templates go by the same paths, so
// `DialogControlCreateFromTemplate(…, "HarbourTemplates/CrateTemplate")` names one. Paths compare
// in any case, and `\` reads as `/`, as the game takes either.
//
// Blizzard's own frames come from a snapshot (data/ui-frame-paths.json,
// scripts/build-ui-frame-paths.mjs), the same tree written out.

import { xmlAttribute, type XmlNode, xmlTree } from "../util/xml.js";

/** How a native reads the path it's given: relative to a panel it's given, from GameUI's top frame, or as a template. */
export type FramePathReading = "relative" | "gameUI" | "template";

/**
 * The natives that take a frame path: which of their arguments it is, the id of its ParamDef in
 * the game's library Ntve (data/trigger-libraries.json), which a Kept trigger's GUI call gives it
 * under, and how the native reads it.
 */
export const FRAME_PATH_NATIVES = {
  DialogControlHookup: { argument: 2, typeArgument: 1, paramDef: "2147B27F", reading: "relative" },
  DialogControlHookupStandard: { argument: 1, typeArgument: 0, paramDef: "AEF92396", reading: "gameUI" },
  DialogControlCreateFromTemplate: { argument: 2, typeArgument: 1, paramDef: "B68F0E3F", reading: "template" },
  DialogControlCreateInPanelFromTemplate: { argument: 2, typeArgument: 1, paramDef: "3CC77352", reading: "template" },
} as const satisfies Record<string, { readonly argument: number; readonly typeArgument: number; readonly paramDef: string; readonly reading: FramePathReading }>;
export type FramePathNative = keyof typeof FRAME_PATH_NATIVES;

/**
 * A literal frame path passed to one of the natives, the line the call starts on, the function
 * it's in (none at the top level) and the control-type constant it's given, when it's one name
 * (`c_triggerControlTypeImage`) rather than an expression.
 */
export type FramePathCall = { readonly native: FramePathNative; readonly path: string; readonly line: number; readonly function?: string; readonly controlType?: string };

type GalaxyToken = { readonly kind: "name" | "string" | "punctuation"; readonly text: string; readonly line: number };

const NAME = /[A-Za-z_]\w*/y;
/** A control-type constant: c_triggerControlTypeImage. */
const CONTROL_TYPE = /^c_triggerControlType\w+$/;

/** `galaxy`'s names, strings (their values) and punctuation, without its comments. */
function galaxyTokens(galaxy: string): GalaxyToken[] {
  const tokens: GalaxyToken[] = [];
  let line = 1;
  for (let at = 0; at < galaxy.length; ) {
    const char = galaxy[at]!;
    if (char === "\n") {
      line += 1;
      at += 1;
    } else if (galaxy.startsWith("//", at)) {
      const end = galaxy.indexOf("\n", at);
      at = end < 0 ? galaxy.length : end;
    } else if (galaxy.startsWith("/*", at)) {
      const end = galaxy.indexOf("*/", at + 2);
      const stop = end < 0 ? galaxy.length : end + 2;
      line += (galaxy.slice(at, stop).match(/\n/g) ?? []).length;
      at = stop;
    } else if (char === '"') {
      const start = line;
      let text = "";
      at += 1;
      // A string ends at its closing quote, or unclosed at the line's end, which is left to count.
      while (at < galaxy.length && galaxy[at] !== '"' && galaxy[at] !== "\n") {
        if (galaxy[at] === "\\" && at + 1 < galaxy.length && galaxy[at + 1] !== "\n") {
          const next = galaxy[at + 1]!;
          text += next === "n" ? "\n" : next === "t" ? "\t" : next;
          at += 2;
        } else text += galaxy[at++];
      }
      if (galaxy[at] === '"') at += 1;
      tokens.push({ kind: "string", text, line: start });
    } else if (/[A-Za-z_]/.test(char)) {
      NAME.lastIndex = at;
      const name = NAME.exec(galaxy)![0];
      tokens.push({ kind: "name", text: name, line });
      at += name.length;
    } else {
      if (!/\s/.test(char)) tokens.push({ kind: "punctuation", text: char, line });
      at += 1;
    }
  }
  return tokens;
}

/** The literal string an argument is, as written or through ConvertStringToUILayoutFrameName, in any parentheses. */
function literalOf(argument: readonly GalaxyToken[]): string | undefined {
  let tokens = argument;
  const punctuation = (token: GalaxyToken | undefined, text: string): boolean => token?.kind === "punctuation" && token.text === text;
  while (tokens.length >= 2 && punctuation(tokens[0], "(") && punctuation(tokens.at(-1), ")")) tokens = tokens.slice(1, -1);
  if (tokens.length === 1 && tokens[0]!.kind === "string") return tokens[0]!.text;
  if (tokens[0]?.text === "libNtve_gf_ConvertStringToUILayoutFrameName" && tokens[1]?.text === "(" && tokens.at(-1)?.text === ")") return literalOf(tokens.slice(2, -1));
  return undefined;
}

/** The literal frame path a Galaxy expression is (`"X/Y"`, or one through ConvertStringToUILayoutFrameName), `\` read as `/`. */
export function literalFramePath(expression: string): string | undefined {
  const literal = literalOf(galaxyTokens(expression));
  return literal === undefined ? undefined : pathSegments(literal).join("/");
}

/**
 * The literal frame paths `galaxy` passes to the natives that take one, in the order the calls
 * start, `\` read as `/`. A path built at run time ("CheckBox_" + IntToString(i)) or held in a
 * variable isn't one, and a call in a comment isn't a call.
 */
export function framePathCalls(galaxy: string): FramePathCall[] {
  const tokens = galaxyTokens(galaxy);
  const calls: FramePathCall[] = [];
  // The function each call is in: the last name before a `(` at the top level names the one a top-level `{` opens.
  let braces = 0;
  let named: string | undefined;
  let inFunction: string | undefined;
  tokens.forEach((token, index) => {
    if (token.kind === "punctuation" && token.text === "{" && braces++ === 0) inFunction = named;
    if (token.kind === "punctuation" && token.text === "}" && braces > 0 && --braces === 0) inFunction = undefined;
    if (braces === 0 && token.kind === "name" && tokens[index + 1]?.text === "(") named = token.text;
    if (token.kind !== "name" || !Object.hasOwn(FRAME_PATH_NATIVES, token.text) || tokens[index + 1]?.text !== "(") return;
    const native = token.text as FramePathNative;
    // Its arguments, split at the commas outside any parentheses.
    const args: GalaxyToken[][] = [[]];
    let depth = 0;
    for (let at = index + 2; at < tokens.length; at++) {
      const next = tokens[at]!;
      if (next.kind === "punctuation" && (next.text === "(" || next.text === "[")) depth += 1;
      if (next.kind === "punctuation" && (next.text === ")" || next.text === "]")) {
        if (depth === 0) break;
        depth -= 1;
      }
      if (next.kind === "punctuation" && next.text === "," && depth === 0) args.push([]);
      else args.at(-1)!.push(next);
    }
    const path = literalOf(args[FRAME_PATH_NATIVES[native].argument] ?? []);
    const typeArgument = args[FRAME_PATH_NATIVES[native].typeArgument] ?? [];
    const controlType = typeArgument.length === 1 && typeArgument[0]!.kind === "name" && CONTROL_TYPE.test(typeArgument[0]!.text) ? typeArgument[0]!.text : undefined;
    if (path !== undefined) calls.push({ native, path: pathSegments(path).join("/"), line: token.line, ...(inFunction ? { function: inFunction } : {}), ...(controlType ? { controlType } : {}) });
  });
  return calls;
}

/** A layout file: its name, the .SC2Layout file's stem, and its XML. */
export type LayoutFile = { readonly name: string; readonly xml: string };

/**
 * Frames as the snapshot stores them: each by its name, holding its own frames, and under
 * TEMPLATE_KEY the template (or templates) it is made from. The top level is the layout files.
 */
export type FrameSnapshotTree = { readonly [name: string]: FrameSnapshotTree | string | readonly string[] };
/** The key a snapshot node's template is under: `@` is in no frame's name. */
export const TEMPLATE_KEY = "@template";

/** A frame: its names, its frames, its templates and the `type`s (Label, Image, …, in lower case) layouts gave it; the snapshot keeps none. */
type FrameNode = { readonly name: string; readonly children: Map<string, FrameNode>; readonly templates: string[]; readonly types: string[] };

const key = (name: string): string => name.toLowerCase();
/** A path's names, `\` read as `/`. */
export const pathSegments = (path: string): string[] => path.replace(/\\/g, "/").split("/").filter((segment) => segment !== "");
const newNode = (name: string): FrameNode => ({ name, children: new Map(), templates: [], types: [] });

/**
 * The frames of layout files, looked up by path. A tree made `over` another has that one's frames
 * as well as its own, and adds layouts to its own alone, so one built tree of Blizzard's frames
 * serves every mod's check, each with its own layouts.
 */
export class FrameTree {
  readonly #root = newNode("");
  /** Every frame (not a file) by its name, for a path relative to a frame nobody named. */
  readonly #byName = new Map<string, FrameNode[]>();
  /** The tree whose frames this one has too, left as it is. */
  readonly #base: FrameTree | undefined;
  /** The roots of this tree's frames: its base's, then its own. */
  readonly #roots: readonly FrameNode[];

  constructor(base?: FrameTree) {
    this.#base = base;
    this.#roots = base ? [...base.#roots, this.#root] : [this.#root];
  }

  /** A tree with `base`'s frames, to add layouts to without changing `base`. */
  static over(base: FrameTree): FrameTree {
    return new FrameTree(base);
  }

  /** The frames named `name` (in lower case), in the base and this tree. */
  #named(name: string): readonly FrameNode[] {
    const own = this.#byName.get(name) ?? [];
    return this.#base ? [...this.#base.#named(name), ...own] : own;
  }

  /** A tree of the frames `snapshot` stores. */
  static fromSnapshot(snapshot: FrameSnapshotTree): FrameTree {
    const tree = new FrameTree();
    const add = (node: FrameNode, stored: FrameSnapshotTree, depth: number): void => {
      for (const [name, value] of Object.entries(stored)) {
        if (name === TEMPLATE_KEY) node.templates.push(...(typeof value === "string" ? [value] : (value as readonly string[])));
        else add(tree.#child(node, name, depth), value as FrameSnapshotTree, depth + 1);
      }
    };
    add(tree.#root, snapshot, 0);
    return tree;
  }

  #child(node: FrameNode, name: string, depth: number): FrameNode {
    let child = node.children.get(key(name));
    if (!child) {
      node.children.set(key(name), (child = newNode(name)));
      if (depth > 0) {
        const named = this.#byName.get(key(name));
        if (named) named.push(child);
        else this.#byName.set(key(name), [child]);
      }
    }
    return child;
  }

  #ensure(names: readonly string[]): { readonly node: FrameNode; readonly depth: number } {
    let node = this.#root;
    names.forEach((name, depth) => (node = this.#child(node, name, depth)));
    return { node, depth: names.length };
  }

  /** A Frame element's own frames, into `node`, recording each one's template. */
  #addFrame(node: FrameNode, depth: number, frame: XmlNode): void {
    const template = xmlAttribute(frame, "template");
    if (template && !node.templates.includes(template)) node.templates.push(template);
    const type = xmlAttribute(frame, "type")?.toLowerCase();
    if (type && !node.types.includes(type)) node.types.push(type);
    for (const child of frame.children) {
      const name = child.name === "Frame" ? xmlAttribute(child, "name") : undefined;
      if (!name) continue;
      let at = node;
      let level = depth;
      for (const each of pathSegments(name)) at = this.#child(at, each, level++);
      this.#addFrame(at, level, child);
    }
  }

  /** The frames `layouts` declare, beside those the tree has. */
  addLayouts(layouts: readonly LayoutFile[]): this {
    for (const file of layouts) {
      const desc = xmlTree(file.xml).find((node) => node.name === "Desc");
      for (const frame of desc?.children ?? []) {
        const name = frame.name === "Frame" ? xmlAttribute(frame, "name") : undefined;
        if (!name) continue;
        const { node, depth } = this.#ensure([xmlAttribute(frame, "file") ?? file.name, ...pathSegments(name)]);
        this.#addFrame(node, depth, frame);
      }
    }
    this.#sources.clear();
    return this;
  }

  /** Each frame's sources, itself and the frames its templates come from (theirs too), found once until more layouts are added. */
  readonly #sources = new Map<FrameNode, readonly FrameNode[]>();
  /** The frames whose sources are being found, each at its depth in that search. */
  readonly #open = new Map<FrameNode, number>();
  /** The shallowest open frame the search so far has cycled back to. */
  #cycledTo = Number.POSITIVE_INFINITY;

  /**
   * `node` and every frame it has frames from through its templates, each once; a template cycle
   * stops where it closes. A cycle back to a frame still being searched finds just that frame, so
   * the sources of a frame inside the cycle are partial until the cycle's first frame has all of
   * them: those aren't kept, and are found again when next asked for, from the first frame's.
   */
  #sourcesOf(node: FrameNode): readonly FrameNode[] {
    const known = this.#sources.get(node);
    if (known) return known;
    const open = this.#open.get(node);
    if (open !== undefined) {
      this.#cycledTo = Math.min(this.#cycledTo, open);
      return [node];
    }
    const depth = this.#open.size;
    const outer = this.#cycledTo;
    this.#open.set(node, depth);
    this.#cycledTo = Number.POSITIVE_INFINITY;
    const out = new Set<FrameNode>([node]);
    try {
      for (const template of node.templates) for (const source of this.#walk(this.#roots, pathSegments(template))) for (const each of this.#sourcesOf(source)) out.add(each);
    } finally {
      this.#open.delete(node);
    }
    const cycledTo = this.#cycledTo;
    this.#cycledTo = Math.min(outer, cycledTo);
    const sources = [...out];
    // Kept unless a cycle reached a frame searched before it, whose sources it may lack.
    if (cycledTo >= depth) this.#sources.set(node, sources);
    return sources;
  }

  /** The frames at `names` below `from`, each step through every source's frames. */
  #walk(from: readonly FrameNode[], names: readonly string[]): FrameNode[] {
    let nodes = from;
    for (const name of names) {
      const next = new Set<FrameNode>();
      for (const node of nodes) for (const source of this.#sourcesOf(node)) {
        const child = source.children.get(key(name));
        if (child) next.add(child);
      }
      nodes = [...next];
      if (nodes.length === 0) break;
    }
    return [...nodes];
  }

  /** Whether a frame is at `path`, its file's name first: `HarbourUI/Dock/Title`. */
  has(path: string): boolean {
    const names = pathSegments(path);
    return names.length >= 2 && this.#walk(this.#roots, names).length > 0;
  }

  /** Whether some frame's path ends in `path`, as a path relative to a frame not known here must. */
  endsWith(path: string): boolean {
    const [first, ...rest] = pathSegments(path);
    if (first === undefined) return false;
    return this.#walk(this.#named(key(first)), rest).length > 0;
  }

  /**
   * The frames at `path` (its file's name first), each with its `type`s as layouts gave them: a
   * frame none gave a type, a snapshot's among them, has none listed.
   */
  find(path: string): { readonly types: readonly string[] }[] {
    const names = pathSegments(path);
    return names.length >= 2 ? this.#walk(this.#roots, names) : [];
  }

  /** The frames some frame's path ends in `path`, as `endsWith` reads it, with their types as `find` gives them. */
  findEndingWith(path: string): { readonly types: readonly string[] }[] {
    const [first, ...rest] = pathSegments(path);
    return first === undefined ? [] : this.#walk(this.#named(key(first)), rest);
  }

  /** The tree's own frames (not its base's) as the snapshot stores them, names and templates in a stable order. */
  toSnapshot(): FrameSnapshotTree {
    const write = (node: FrameNode): FrameSnapshotTree => {
      const out: Record<string, FrameSnapshotTree | string | readonly string[]> = {};
      const templates = [...new Set(node.templates)];
      if (templates.length > 0) out[TEMPLATE_KEY] = templates.length === 1 ? templates[0]! : templates;
      for (const child of [...node.children.values()].sort((a, b) => (key(a.name) < key(b.name) ? -1 : key(a.name) > key(b.name) ? 1 : 0))) out[child.name] = write(child);
      return out;
    };
    return write(this.#root);
  }
}
