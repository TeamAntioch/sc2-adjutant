// A mod package's own files, generated and never authored (ADR-0011): DocumentInfo and
// DocumentHeader, whose dependencies come from the Mod Blueprint, the ComponentList, which names
// each component the package holds, and each component's .version stamp. Each is made from the
// package's own copy where it has one, changed only where the Blueprint or the package's
// components call for it, so a mod whose dependencies and components haven't changed keeps them
// byte for byte. DocumentInfo's preloads are derived from what the Blueprint's entries name
// (preloads.ts).

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { INDEX_VERSION } from "../cutscene/compile-cutscene.js";
import { writeDocumentHeader } from "../map/write-document-header.js";
import { writeComponentVersion } from "../map/write-component-version.js";
import { readDependencies } from "../map/read-dependencies.js";
import { readDocumentHeader, withDocumentHeaderDependencies } from "../map/read-document-header.js";
import { sameList } from "../util/same-list.js";
import { stringTable } from "./library-xml.js";
import { readPreloads } from "./preloads.js";
import type { PackageContent, PackageFileKind } from "../map/package-output.js";

export { packageFiles } from "./game-data-files.js";

/** The keys and texts of the package's strings file `stringsFile`, however the package spells it, of its `files`; none when it doesn't have it. */
export async function packageStringTable(pkg: string, files: readonly string[], stringsFile: string): Promise<Map<string, string>> {
  const file = files.find((name) => name.toLowerCase() === stringsFile.toLowerCase());
  return file ? stringTable(await readFile(path.join(pkg, ...file.split("/")), "utf8")) : new Map();
}

export const PACKAGE_FILES = ["DocumentInfo", "DocumentHeader", "ComponentList.SC2Components"] as const;

/** The DescIndex, which the compile generates from the Blueprint's layouts (ADR-0019). */
export const DESC_INDEX = "Base.SC2Data/UI/Layout/DescIndex.SC2Layout";

/** Whether `file` is the DescIndex, in any case (the game reads its files in any case). */
export const isDescIndex = (file: string): boolean => file.toLowerCase() === DESC_INDEX.toLowerCase();

/** Whether `file` is a UI layout (.SC2Layout), in any case. */
export const isLayout = (file: string): boolean => /\.sc2layout$/i.test(file);

/** Whether `file` is a layout the DescIndex loads: one in Base.SC2Data (a locale's, in enUS.SC2Data, overrides one there). */
export const isBaseLayout = (file: string): boolean => isLayout(file) && file.toLowerCase().startsWith("base.sc2data/");

/** The layouts of `files` (package paths) the DescIndex loads, in order. */
export const descIndexLayouts = (files: readonly string[]): string[] => files.filter((file) => isBaseLayout(file) && !isDescIndex(file));

/** Whether the compile generates the DescIndex for `blueprint`: while it turns a UI Component on (each has a layout) or its files have a layout it loads. */
export const generatesDescIndex = (blueprint: { readonly files: readonly { readonly path: string }[]; readonly ui?: Readonly<Record<string, unknown>> | undefined }): boolean =>
  Object.keys(blueprint.ui ?? {}).length > 0 || descIndexLayouts(blueprint.files.map(({ path: file }) => file)).length > 0;

/** A component of a mod, in the order the Editor lists them, and whether the package has it. */
type Component = { readonly type: string; readonly path: string; readonly locale?: string; readonly has: (files: readonly string[]) => boolean };

const COMPONENTS: readonly Component[] = [
  { type: "gada", path: "GameData", has: (files) => files.some((file) => file.startsWith("Base.SC2Data/GameData/") || file === "Base.SC2Data/GameData.xml") },
  { type: "text", path: "GameText", locale: "enUS", has: (files) => files.some((file) => file.startsWith("enUS.SC2Data/LocalizedData/") && file.endsWith(".txt")) },
  { type: "info", path: "DocumentInfo", has: () => true },
  { type: "trig", path: "Triggers", has: (files) => files.includes("Triggers") },
  { type: "uiui", path: "UI/Layout/DescIndex.SC2Layout", has: (files) => files.some(isDescIndex) },
  { type: "font", path: "UI/FontStyles.SC2Style", has: (files) => files.includes("Base.SC2Data/UI/FontStyles.SC2Style") },
  { type: "cuts", path: "Cutscenes/Index", has: (files) => files.some((file) => file.startsWith("Base.SC2Data/Cutscenes/") && file.toLowerCase().endsWith(".sc2cutscene")) },
];

const descIndex = COMPONENTS.find((component) => component.type === "uiui")!;
/** The ComponentList's line for the DescIndex, with its line ending. */
const DESC_INDEX_LINE = /^[ \t]*<DataComponent\b[^>]*>UI\/Layout\/DescIndex\.SC2Layout<\/DataComponent>[ \t]*(\r?\n)?/gm;

/** A component's .version stamp, beside it: at the package's root for the root components, else in Base.SC2Data. */
const versionFile = (component: string): string => {
  const stem = component.replace(/\.[^./]+$/, "");
  return ["GameData", "GameText", "DocumentInfo", "Triggers"].includes(component) ? `${stem}.version` : `Base.SC2Data/${stem}.version`;
};



const escapeXml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A DocumentInfo list block (`Dependencies`, `Preload`) holding `values`, or nothing when there are none. */
const listBlock = (name: string, values: readonly string[], eol: string): string =>
  values.length ? `    <${name}>${eol}${values.map((value) => `        <Value>${escapeXml(value)}</Value>${eol}`).join("")}    </${name}>${eol}` : "";

/** `existing` with its `name` list block replaced by `values`, or that block added (after `after`, else as the first in DocInfo). */
function replaceList(existing: string, name: string, values: readonly string[], after?: string): string {
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const list = listBlock(name, values, eol);
  const block = new RegExp(`^[ \\t]*<${name}\\s*/>[ \\t]*\\r?\\n|^[ \\t]*<${name}>[\\s\\S]*?</${name}>[ \\t]*\\r?\\n`, "m");
  if (block.test(existing)) return existing.replace(block, list);
  const anchor = after && new RegExp(`^[ \\t]*<${after}>[\\s\\S]*?</${after}>[ \\t]*\\r?\\n`, "m").exec(existing);
  if (anchor) return existing.slice(0, anchor.index + anchor[0].length) + list + existing.slice(anchor.index + anchor[0].length);
  return existing.replace(/^([ \t]*<DocInfo>[ \t]*\r?\n)/m, `$1${list}`);
}

/** DocumentInfo with `dependencies` and `preloads`: the package's own with each list rewritten where it differs. */
async function documentInfo(pkg: string, dependencies: readonly string[], preloads: readonly string[]): Promise<string> {
  const file = path.join(pkg, "DocumentInfo");
  if (!existsSync(file)) return `<?xml version="1.0" encoding="utf-8"?>\n<DocInfo>\n${listBlock("Dependencies", dependencies, "\n")}${listBlock("Preload", preloads, "\n")}</DocInfo>\n`;
  let out = await readFile(file, "utf8");
  if (!sameList(await readDependencies(pkg), dependencies)) out = replaceList(out, "Dependencies", dependencies);
  if (!sameList(await readPreloads(pkg), preloads)) out = replaceList(out, "Preload", preloads, "Dependencies");
  return out;
}

/**
 * DocumentHeader with `dependencies`: the package's own with its dependency list rewritten, when
 * the header's own list differs (so a stale header is repaired even when DocumentInfo is right);
 * a new one, named for the mod, when the package has none.
 */
async function documentHeader(pkg: string, name: string, dependencies: readonly string[]): Promise<Uint8Array> {
  const file = path.join(pkg, "DocumentHeader");
  if (!existsSync(file)) return writeDocumentHeader({ dependencies, attributes: { "DocInfo/Name": name }, documentId: idFor(name) });
  const existing = await readFile(file);
  let header: ReturnType<typeof readDocumentHeader>;
  try {
    header = readDocumentHeader(existing);
  } catch (error) {
    throw new Error(`${file} isn't a DocumentHeader the compile can read (${error instanceof Error ? error.message : String(error)}), so it can't write the Blueprint's dependencies into it: save the mod in the Editor, then compile again`);
  }
  if (sameList(header.dependencies, dependencies)) return existing;
  return withDocumentHeaderDependencies(existing, dependencies);
}

/** A stable 32-bit id for a new header, from the mod's name. */
function idFor(name: string): number {
  let hash = 2166136261;
  for (const char of name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

/**
 * The ComponentList: the package's own, gaining a line for each component the compile writes a
 * file of and it doesn't list (what else it lists is the package's to say); a new one listing every
 * component the package has, when it has none.
 */
async function componentList(pkg: string, files: readonly string[], written: readonly string[]): Promise<{ readonly content: string; readonly components: readonly Component[] }> {
  const present = COMPONENTS.filter((component) => component.has(files));
  const file = path.join(pkg, "ComponentList.SC2Components");
  const line = (component: Component, indent: string) => `${indent}<DataComponent Type="${component.type}"${component.locale ? ` Locale="${component.locale}"` : ""}>${component.path}</DataComponent>`;
  if (!existsSync(file)) {
    return { content: `<?xml version="1.0" encoding="utf-8"?>\n<Components>\n    <Optimized/>\n${present.map((component) => `${line(component, "    ")}\n`).join("")}</Components>\n`, components: present };
  }
  // The DescIndex's line goes once the package won't have it (the compile wrote it last time and doesn't now): a Kept one stays listed.
  const existing = descIndex.has(files) ? await readFile(file, "utf8") : (await readFile(file, "utf8")).replace(DESC_INDEX_LINE, "");
  const listed = [...existing.matchAll(/^([ \t]*)<DataComponent\b[^>]*>([^<]*)<\/DataComponent>/gm)];
  const have = new Set(listed.map((match) => match[2]));
  const missing = COMPONENTS.filter((component) => component.has(written) && !have.has(component.path));
  const components = COMPONENTS.filter((component) => have.has(component.path) || missing.includes(component));
  if (missing.length === 0) return { content: existing, components };
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const close = existing.lastIndexOf("</Components>");
  if (close < 0) throw new Error(`${file} has no </Components>, so the compile can't list ${missing.map((component) => component.path).join(", ")} in it`);
  const head = existing.slice(0, close);
  const indent = listed[0]?.[1] ?? "    ";
  return { content: `${head}${head.endsWith("\n") ? "" : eol}${missing.map((component) => `${line(component, indent)}${eol}`).join("")}${existing.slice(close)}`, components };
}

/**
 * The package files for a compile of a mod named `name` with `dependencies` and `preloads`, given every file the
 * package will hold (`files`) and those the compile writes (`written`): each with how PackageOutput
 * writes it.
 */
export async function modPackageFiles(
  pkg: string,
  {
    name,
    dependencies,
    preloads,
    files,
    written,
    savedAt = new Date(),
  }: { readonly name: string; readonly dependencies: readonly string[]; readonly preloads: readonly string[]; readonly files: readonly string[]; readonly written: readonly string[]; readonly savedAt?: Date },
): Promise<{ readonly file: string; readonly content: PackageContent; readonly kind: PackageFileKind }[]> {
  const { content, components } = await componentList(pkg, files, written);
  return [
    { file: "DocumentInfo", content: await documentInfo(pkg, dependencies, preloads), kind: "generated" },
    { file: "DocumentHeader", content: await documentHeader(pkg, name, dependencies), kind: "generated" },
    { file: "ComponentList.SC2Components", content, kind: "generated" },
    // A stamp the package has stays as the Editor wrote it, now the compile's.
    ...(await Promise.all(
      components.map(async (component) => {
        const file = versionFile(component.path);
        const existing = path.join(pkg, ...file.split("/"));
        const content = existsSync(existing) ? await readFile(existing) : component.type === "cuts" ? INDEX_VERSION : writeComponentVersion({ type: component.type, savedAt });
        return { file, content, kind: "generated" as const };
      }),
    )),
  ];
}
