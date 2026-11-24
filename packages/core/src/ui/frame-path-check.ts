// The frame-path check on a mod (ADR-0019, spec decision 7): `check` warns about every literal
// path the mod passes to DialogControlHookup*, or DialogControlCreate*FromTemplate, that is a
// frame or template in neither the layouts the mod loads nor Blizzard's (data/ui-frame-paths.json). It
// reads the package's Galaxy files and its Kept triggers (the Triggers file's custom script and
// the path parameters of its GUI calls), and the layouts its DescIndex loads with those the compile
// generates, its UI Components' (their functions' Galaxy too).
//
// It is a warning, not an error: a path can be built at run time, or come from a dependency the
// check doesn't read. Paths are judged by the native they're passed to:
//
//   DialogControlHookupStandard              a frame of the game's UI, from GameUI's top
//   DialogControlCreate(InPanel)FromTemplate a template, by its file and path
//   DialogControlHookup                      a frame relative to a panel the check can't follow,
//                                            so one some frame's path ends in
//
// Two more warnings come from the layouts the mod loads, for pitfalls that otherwise show only in
// game (docs/reference/editor-and-engine.md, "UI layout pitfalls"):
//
//   template order  a frame made from a template its own file declares further down, which the game
//                   fails to find
//   control type    a literal hookup whose control-type constant (c_triggerControlTypeImage) is a
//                   different basic type from the frame's `type` in the mod's layouts. Only the
//                   basic types are compared: Blizzard's own code hooks a Panel to frames of any
//                   type and a Button, an Image or a Label to a plain Frame, so those pass. A
//                   frame whose layout gave it no type (Blizzard's, from the snapshot, until it
//                   records them) isn't compared.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { decodeXml, xmlAttribute, type XmlNode, xmlTree } from "../util/xml.js";
import { componentContext, componentLayouts, type UiComponentOn } from "./components.js";
import {
  FRAME_PATH_NATIVES,
  type FramePathCall,
  framePathCalls,
  type FramePathNative,
  type FramePathReading,
  type FrameSnapshotTree,
  FrameTree,
  type LayoutFile,
  literalFramePath,
  pathSegments,
} from "./frame-paths.js";

/** Where core keeps Blizzard's frames, written by scripts/build-ui-frame-paths.mjs. */
export const UI_FRAME_PATHS_PATH = fileURLToPath(new URL("../../data/ui-frame-paths.json", import.meta.url));

let bundled: Promise<FrameSnapshotTree> | undefined;
/** Blizzard's frames, from data/ui-frame-paths.json, read once it reads: a read that fails is tried again next time. */
export function bundledFrameSnapshot(): Promise<FrameSnapshotTree> {
  const reading = (bundled ??= readFile(UI_FRAME_PATHS_PATH, "utf8").then((text) => (JSON.parse(text) as { frames: FrameSnapshotTree }).frames));
  reading.catch(() => {
    if (bundled === reading) bundled = undefined;
  });
  return reading;
}

let bundledTree: Promise<FrameTree> | undefined;
/** Blizzard's frames as a tree, built once, for each mod's layouts to go `over`: it's never added to. */
function bundledFrameTree(): Promise<FrameTree> {
  const building = (bundledTree ??= bundledFrameSnapshot().then((snapshot) => FrameTree.fromSnapshot(snapshot)));
  building.catch(() => {
    if (bundledTree === building) bundledTree = undefined;
  });
  return building;
}

/**
 * What the mod's compile generates beside the package: its layouts, by their paths in the package,
 * which its DescIndex loads, and Galaxy, each with where it's from.
 */
export type GeneratedUi = {
  readonly layouts?: readonly { readonly file: string; readonly content: string }[];
  /**
   * `file` is a path in the package or an absolute one, `where` what in it the Galaxy is from
   * (ui.bossBar), and `function` the Galaxy function it's the body of, if it's one. A call in a
   * function so generated, the body's or one the Galaxy defines, isn't counted again in the
   * package's compiled copy of that function.
   */
  readonly galaxy?: readonly { readonly file: string; readonly where: string; readonly text: string; readonly function?: string }[];
};

/**
 * What the UI Components `on` generate in the library `library`: their layouts, and their
 * functions' and scripts' Galaxy, from the Mod Blueprint at `blueprintPath`. Without a library the
 * compile generates nothing of theirs (it refuses them, modUi), so nothing.
 */
export function componentUi(on: readonly UiComponentOn[], blueprintPath: string, library: string | undefined): GeneratedUi {
  if (library === undefined) return {};
  return {
    layouts: componentLayouts(on),
    galaxy: on.flatMap(({ component, look }) => {
      const context = componentContext(library, component, on);
      const where = `ui.${component.id}`;
      // A script defines its helpers itself, so its calls are in functions of their own names.
      const script = component.script?.(look, context);
      return [
        ...(script !== undefined ? [{ file: blueprintPath, where, text: script }] : []),
        ...component.functions(look, context).map((fn) => ({ file: blueprintPath, where, text: fn.galaxy, function: context.galaxyName(fn.name) })),
      ];
    }),
  };
}

/** A path no layout has: the native it's first passed to, the file and where in it (line 12, ui.bossBar), and in how many places in all. */
export type MissingFramePath = {
  readonly kind: "missing";
  readonly native: FramePathNative;
  readonly path: string;
  readonly file: string;
  readonly where: string;
  readonly places: number;
  readonly message: string;
};

/** A hookup whose control type isn't the type of the frame it names, at its first place. */
export type ControlTypeMismatch = {
  readonly kind: "controlType";
  readonly native: FramePathNative;
  readonly path: string;
  readonly controlType: string;
  readonly file: string;
  readonly where: string;
  readonly places: number;
  readonly message: string;
};

/** A frame made from a template that its own layout file declares further down. */
export type TemplateOutOfOrder = {
  readonly kind: "templateOrder";
  /** The layout file: its path in the package, or the generated layout's. */
  readonly file: string;
  /** The frame, by its path from the file's top. */
  readonly frame: string;
  readonly template: string;
  readonly where: string;
  readonly message: string;
};

export type FramePathWarning = MissingFramePath | ControlTypeMismatch | TemplateOutOfOrder;

type Found = { readonly native: FramePathNative; readonly path: string; readonly file: string; readonly where: string; readonly controlType?: string };

/** The basic control types, each by its layout type in lower case, as its c_triggerControlType constant names it. */
const BASIC_CONTROLS: ReadonlyMap<string, string> = new Map(
  ["Label", "Image", "Button", "CheckBox", "EditBox", "ListBox", "ProgressBar", "Slider", "Pulldown", "Portrait"].map((name) => [name.toLowerCase(), name]),
);

/**
 * The layout types of the frames at a path when `controlType` can't be what they are: every frame
 * has a basic type, and none is `controlType`'s. Nothing for a control that isn't a basic one, a
 * frame with no type or one that isn't basic (Frame, or Blizzard's own: Panel hooks them all), or
 * no frames.
 */
export function mismatchedTypes(controlType: string, frames: readonly { readonly types: readonly string[] }[]): string[] | undefined {
  const control = controlType.replace(/^c_triggerControlType/, "").toLowerCase();
  if (!BASIC_CONTROLS.has(control) || frames.length === 0) return undefined;
  if (frames.some((frame) => frame.types.length === 0 || frame.types.some((type) => !BASIC_CONTROLS.has(type)) || frame.types.includes(control))) return undefined;
  return [...new Set(frames.flatMap((frame) => frame.types))];
}

/** The frames of `xml`, a layout file's text, made from a template of their own file (`stem`) that the file declares below them. */
export function templatesOutOfOrder(file: string, stem: string, xml: string): TemplateOutOfOrder[] {
  const declared = new Map<string, number>();
  const uses: { readonly frame: string[]; readonly template: string; readonly index: number }[] = [];
  let index = 0;
  const visit = (frame: XmlNode, above: readonly string[]): void => {
    const names = [...above, ...pathSegments(xmlAttribute(frame, "name") ?? "")];
    const at = index++;
    const key = names.join("/").toLowerCase();
    if (!declared.has(key)) declared.set(key, at);
    const template = xmlAttribute(frame, "template");
    if (template) uses.push({ frame: names, template, index: at });
    for (const child of frame.children) if (child.name === "Frame" && xmlAttribute(child, "name")) visit(child, names);
  };
  const desc = xmlTree(xml).find((node) => node.name === "Desc");
  for (const frame of desc?.children ?? []) if (frame.name === "Frame" && xmlAttribute(frame, "name")) visit(frame, [xmlAttribute(frame, "file") ?? stem]);
  const out: TemplateOutOfOrder[] = [];
  for (const use of uses) {
    const names = pathSegments(use.template);
    // Only the file's own templates: another file's load before or after it as the DescIndex orders them.
    if (names[0]?.toLowerCase() !== stem.toLowerCase()) continue;
    const at = declared.get(names.join("/").toLowerCase());
    if (at === undefined || at <= use.index) continue;
    const frame = use.frame.join("/");
    const template = names.join("/");
    out.push({
      kind: "templateOrder",
      file,
      frame,
      template,
      where: `frame "${frame}"`,
      message: `The frame "${frame}" is made from the template "${template}", which ${path.basename(file)} declares further down. A template has to come before the frames that use it in the same file, or the game logs "Failed to locate specified Desc" and builds the frame without it. Move the template above "${frame}"`,
    });
  }
  return out;
}

const LAYOUT = /\.sc2layout$/i;
const GALAXY = /\.galaxy$/i;
const WHAT: Record<FramePathReading, string> = {
  relative: "a frame (relative to the panel it's given)",
  gameUI: "a frame of the game's UI (from GameUI)",
  template: "a template",
};

/** Whether `tree` has the frame `native` names by `framePath`, as it reads a path. */
function known(tree: FrameTree, native: FramePathNative, framePath: string): boolean {
  const reading = FRAME_PATH_NATIVES[native].reading;
  if (reading === "gameUI") return tree.has(`GameUI/GameUI/${framePath}`);
  if (reading === "relative") return tree.endsWith(framePath);
  return tree.has(framePath);
}

/** The frames `native` names by `framePath`, as `known` reads it, with the types layouts gave them. */
function framesAt(tree: FrameTree, native: FramePathNative, framePath: string): { readonly types: readonly string[] }[] {
  const reading = FRAME_PATH_NATIVES[native].reading;
  if (reading === "gameUI") return tree.find(`GameUI/GameUI/${framePath}`);
  if (reading === "relative") return tree.findEndingWith(framePath);
  return tree.find(framePath);
}

/** Where each of `text`'s lines starts. */
function lineStarts(text: string): number[] {
  const starts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  return starts;
}

/** The line (from 1) the character at `index` is on, from its text's `starts`. */
function lineAt(starts: readonly number[], index: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (starts[middle]! <= index) low = middle;
    else high = middle - 1;
  }
  return low + 1;
}
const BY_PARAM_DEF = new Map<string, FramePathNative>(Object.entries(FRAME_PATH_NATIVES).map(([native, { paramDef }]) => [paramDef, native as FramePathNative]));

/**
 * The paths a Triggers file passes: its custom script's calls, and each GUI call's path parameter
 * given as a literal (a layoutframe's script, or a value), at their lines in the file.
 */
function triggerCalls(xml: string): FramePathCall[] {
  const calls: FramePathCall[] = [];
  const starts = lineStarts(xml);
  for (const match of xml.matchAll(/<ScriptCode>([\s\S]*?)<\/ScriptCode>/g)) {
    const before = lineAt(starts, match.index! + "<ScriptCode>".length) - 1;
    for (const call of framePathCalls(decodeXml(match[1]!))) calls.push({ ...call, line: call.line + before });
  }
  for (const match of xml.matchAll(/<Element Type="Param"[^>]*>([\s\S]*?)<\/Element>/g)) {
    const body = match[1]!;
    const def = /<ParameterDef Type="ParamDef" Library="Ntve" Id="([0-9A-F]{8})"\/>/.exec(body);
    const native = def ? BY_PARAM_DEF.get(def[1]!) : undefined;
    if (!native) continue;
    const script = /<ScriptCode>([\s\S]*?)<\/ScriptCode>/.exec(body);
    const value = /<Value>([\s\S]*?)<\/Value>/.exec(body);
    const framePath = script ? literalFramePath(decodeXml(script[1]!)) : value ? pathSegments(decodeXml(value[1]!)).join("/") : undefined;
    if (framePath) calls.push({ native, path: framePath, line: lineAt(starts, match.index!) });
  }
  return calls.sort((one, other) => one.line - other.line);
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name)).sort();
}

/** A data folder's path: Base.SC2Data/, enUS.SC2Data/, …, in lower case. */
const DATA_FOLDER = /^[^/]+\.sc2data\//;

/**
 * The package's layouts the game loads, of `files` (each file by its package path in lower case): those its
 * DescIndex includes, the one its ComponentList names as its uiui component, from any data folder
 * (a locale's overrides Base.SC2Data's). The game reads its files in any case. A package without a
 * DescIndex loads none of its own.
 */
async function loadedLayouts(files: ReadonlyMap<string, string>): Promise<Set<string>> {
  const loaded = new Set<string>();
  const at = (lower: string): string | undefined => (files.has(lower) ? lower : undefined);
  const componentList = at("componentlist.sc2components");
  if (!componentList) return loaded;
  const component = /<DataComponent\b[^>]*\bType="uiui"[^>]*>([^<]*)<\/DataComponent>/i.exec(await readFile(files.get(componentList)!, "utf8"));
  const index = component ? at(`base.sc2data/${pathSegments(component[1]!.trim()).join("/").toLowerCase()}`) : undefined;
  if (!index) return loaded;
  const desc = xmlTree(await readFile(files.get(index)!, "utf8")).find((node) => node.name === "Desc");
  const included = new Set((desc?.children ?? []).filter((node) => node.name === "Include").map((node) => pathSegments(xmlAttribute(node, "path") ?? "").join("/").toLowerCase()));
  for (const file of files.keys()) if (LAYOUT.test(file) && included.has(file.replace(DATA_FOLDER, ""))) loaded.add(file);
  return loaded;
}

/**
 * The frame-path check's warnings on the mod at `modPackage`. The literal frame paths it passes
 * that no layout has: one warning per path and the way it's read, at the first place it's passed.
 * A hookup whose control type isn't its frame's: one per path and type. A template its own file
 * declares below a frame that uses it, in the layouts it loads. The layouts are those its DescIndex loads
 * and Blizzard's. A path its Kept triggers pass is counted from the package's Galaxy, which the
 * Editor writes them into, and from its Triggers file only when no Galaxy passes it. `generated`
 * is what its compile adds: a generated layout loads, standing in for the package's file of that
 * path, and a generated function's Galaxy is counted there rather than in the package's copy.
 */
export async function modFrameWarnings(modPackage: string, generated: GeneratedUi = {}, snapshot?: FrameSnapshotTree): Promise<FramePathWarning[]> {
  const files = await filesUnder(modPackage);
  const relative = (file: string): string => path.relative(modPackage, file).split(path.sep).join("/").toLowerCase();
  const replaced = new Set((generated.layouts ?? []).map((layout) => layout.file.toLowerCase()));
  // Read by their own paths: the lower-case one finds nothing on a case-sensitive file system.
  const loaded = await loadedLayouts(new Map(files.map((file) => [relative(file), file])));
  const stem = (file: string): string => path.posix.basename(file.split(path.sep).join("/")).replace(LAYOUT, "");
  const layouts: LayoutFile[] = [];
  const outOfOrder: TemplateOutOfOrder[] = [];
  for (const file of files.filter((each) => loaded.has(relative(each)) && !replaced.has(relative(each)))) {
    const xml = await readFile(file, "utf8");
    layouts.push({ name: stem(file), xml });
    outOfOrder.push(...templatesOutOfOrder(file, stem(file), xml));
  }
  for (const layout of generated.layouts ?? []) {
    layouts.push({ name: stem(layout.file), xml: layout.content });
    outOfOrder.push(...templatesOutOfOrder(path.resolve(modPackage, layout.file), stem(layout.file), layout.content));
  }
  const tree = FrameTree.over(snapshot ? FrameTree.fromSnapshot(snapshot) : await bundledFrameTree()).addLayouts(layouts);

  const id = (native: FramePathNative, framePath: string): string => `${FRAME_PATH_NATIVES[native].reading}\n${framePath.toLowerCase()}`;
  // Each call once: a generated function's from its source (ui.bossBar), not the package's compiled copy of it.
  const fromGenerated = (generated.galaxy ?? []).flatMap((source) => framePathCalls(source.text).map((call): Found => ({ native: call.native, path: call.path, file: path.resolve(modPackage, source.file), where: source.where, ...(call.controlType ? { controlType: call.controlType } : {}) })));
  const generatedFunctions = new Set((generated.galaxy ?? []).flatMap((source) => framePathCalls(source.text).flatMap((call) => call.function ?? source.function ?? [])));
  const found: Found[] = [];
  const fromTriggers: Found[] = [];
  for (const file of files) {
    if (GALAXY.test(file)) {
      for (const call of framePathCalls(await readFile(file, "utf8"))) if (!call.function || !generatedFunctions.has(call.function)) found.push({ native: call.native, path: call.path, file, where: `line ${call.line}`, ...(call.controlType ? { controlType: call.controlType } : {}) });
    } else if (relative(file) === "triggers") for (const call of triggerCalls(await readFile(file, "utf8"))) fromTriggers.push({ native: call.native, path: call.path, file, where: `line ${call.line}` });
  }
  const inGalaxy = new Set([...found, ...fromGenerated].map((call) => id(call.native, call.path)));
  found.push(...fromTriggers.filter((call) => !inGalaxy.has(id(call.native, call.path))), ...fromGenerated);

  const warnings = new Map<string, Found & { places: number }>();
  const mismatches = new Map<string, Found & { places: number; types: string[] }>();
  for (const call of found) {
    if (known(tree, call.native, call.path)) {
      const types = call.controlType ? mismatchedTypes(call.controlType, framesAt(tree, call.native, call.path)) : undefined;
      if (types) {
        const mismatch = `${id(call.native, call.path)}\n${call.controlType}`;
        const first = mismatches.get(mismatch);
        mismatches.set(mismatch, first ? { ...first, places: first.places + 1 } : { ...call, places: 1, types });
      }
      continue;
    }
    const first = warnings.get(id(call.native, call.path));
    warnings.set(id(call.native, call.path), first ? { ...first, places: first.places + 1 } : { ...call, places: 1 });
  }
  const elsewhere = (places: number): string => (places > 1 ? ` (and ${places - 1} other place${places > 2 ? "s" : ""})` : "");
  const missing = [...warnings.values()].map((warning): MissingFramePath => {
    const message = `"${warning.path}", passed to ${warning.native}${elsewhere(warning.places)}, is ${WHAT[FRAME_PATH_NATIVES[warning.native].reading]} that neither the layouts the mod loads nor the game's define, so the call is likely to find nothing. Add the frame to a layout the mod's DescIndex includes, or fix the path; a path that comes from a dependency the check doesn't read is fine`;
    return { kind: "missing", native: warning.native, path: warning.path, file: warning.file, where: warning.where, places: warning.places, message };
  });
  const controlType = [...mismatches.values()].map((warning): ControlTypeMismatch => {
    const types = warning.types.map((type) => BASIC_CONTROLS.get(type)!);
    const use = types.length === 1 ? ` Pass c_triggerControlType${types[0]} for it, or change the frame's type.` : "";
    const message = `"${warning.path}", passed to ${warning.native}${elsewhere(warning.places)} as ${warning.controlType}, is a frame of type ${types.join(" or ")} in the layouts the mod loads, so the hookup is likely to find nothing or the wrong control.${use}`;
    return { kind: "controlType", native: warning.native, path: warning.path, controlType: warning.controlType!, file: warning.file, where: warning.where, places: warning.places, message };
  });
  return [...missing, ...controlType, ...outOfOrder];
}

/** Just the paths no layout has, of `modFrameWarnings`. */
export async function modFramePathWarnings(modPackage: string, generated: GeneratedUi = {}, snapshot?: FrameSnapshotTree): Promise<MissingFramePath[]> {
  return (await modFrameWarnings(modPackage, generated, snapshot)).filter((warning): warning is MissingFramePath => warning.kind === "missing");
}
