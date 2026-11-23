// The layout writer (ADR-0019): .SC2Layout XML as the Editor saves it. Every line ends in CRLF,
// which is what the Editor writes when it saves a layout or the DescIndex (tested in game,
// 2026-11-09), so a generated file the author opens and saves
// in the Editor doesn't read as an edit. Elements are indented four spaces a level, with their
// attributes in the order given.

/** An element of a layout: a Frame, an Anchor, an Include, …, with its attributes in order. */
export type LayoutElement = {
  readonly tag: string;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly children?: readonly LayoutElement[];
};

/** An element with its attributes, and its children when it has any. */
export const layoutElement = (tag: string, attributes: Record<string, string> = {}, children: LayoutElement[] = []): LayoutElement => ({ tag, attributes, ...(children.length ? { children } : {}) });
/** An element holding one value, as `<Width val="316"/>`. */
export const layoutValue = (tag: string, value: string | number): LayoutElement => layoutElement(tag, { val: String(value) });

const CRLF = "\r\n";
const DECLARATION = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>`;

/** The data folder whose root a DescIndex names its layouts from. */
const DATA_ROOT = "Base.SC2Data/";

/** `text` with every line ending CRLF, whatever it had. */
export const withCrlf = (text: string): string => text.replace(/\r?\n/g, CRLF);

/**
 * A layout file's `bytes` with CRLF endings, when they're UTF-8 text (a UTF-8 BOM stays); bytes
 * that aren't, such as UTF-16 (with its BOM) or invalid UTF-8, are the file's as they are.
 */
export function layoutWithCrlf(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) return new Uint8Array(bytes);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return new Uint8Array(bytes);
  }
  return new TextEncoder().encode(withCrlf(text));
}

const escapeAttribute = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `element` and its children as lines, indented `depth` levels. */
function element({ tag, attributes = {}, children = [] }: LayoutElement, depth: number): string {
  const indent = "    ".repeat(depth);
  const open = `${indent}<${tag}${Object.entries(attributes)
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("")}`;
  if (children.length === 0) return `${open}/>${CRLF}`;
  return `${open}>${CRLF}${children.map((child) => element(child, depth + 1)).join("")}${indent}</${tag}>${CRLF}`;
}

/** A layout file holding `elements` in its Desc. */
export const writeLayout = (elements: readonly LayoutElement[]): string => `${DECLARATION}${CRLF}${element({ tag: "Desc", children: elements }, 0)}`;

/**
 * The DescIndex (UI/Layout/DescIndex.SC2Layout) that loads `layouts`, each a package path in
 * Base.SC2Data, in the order given: a layout loads after those above it, so templates and
 * constants come before the files that use them.
 */
export function descIndex(layouts: readonly string[]): string {
  // The game reads its files in any case.
  const outside = layouts.filter((file) => !file.toLowerCase().startsWith(DATA_ROOT.toLowerCase()));
  if (outside.length > 0) throw new Error(`${outside.join(", ")} ${outside.length === 1 ? "is" : "are"} outside Base.SC2Data, so the DescIndex can't load ${outside.length === 1 ? "it" : "them"}: a mod's layouts go in Base.SC2Data/UI/Layout/`);
  return writeLayout(layouts.map((file) => ({ tag: "Include", attributes: { path: file.slice(DATA_ROOT.length) } })));
}
