// The parts of a Map Package's files that a compile record lists one by one (ADR-0010): placed
// objects and regions by id, and the keys of a localized strings file, each with its text as it
// stands in the file.

/** One element of a file: its key and where its text is. */
export type Element = { readonly key: string; readonly start: number; readonly end: number; readonly text: string };

/** The top-level elements of a document, keyed by `keyOf`: each from its indent to the end of its closing tag. */
export function topElements(xml: string, open: RegExp, keyOf: (match: RegExpMatchArray) => string): Element[] {
  const out: Element[] = [];
  for (const match of xml.matchAll(open)) {
    // From the start of its line when only indentation comes before it there, so it moves with its indent.
    const lineStart = xml.lastIndexOf("\n", match.index! - 1) + 1;
    const start = /^[ \t]*$/.test(xml.slice(lineStart, match.index!)) ? lineStart : match.index!;
    const tag = match[1]!;
    const selfClosing = match[0].endsWith("/>");
    const close = `</${tag}>`;
    const closeAt = selfClosing ? -1 : xml.indexOf(close, start);
    const end = selfClosing || closeAt < 0 ? match.index! + match[0].length : closeAt + close.length;
    out.push({ key: keyOf(match), start, end, text: xml.slice(start, end) });
  }
  return out;
}

/** Placed objects (ObjectUnit, ObjectDoodad, ObjectPoint, ObjectCamera …) by Id. */
export function objectElements(xml: string): Element[] {
  return topElements(xml, /<(Object[A-Za-z]+)\s[^>]*?\bId="(\d+)"[^>]*?\/?>/g, (match) => match[2]!);
}

/** Regions by id. */
export function regionElements(xml: string): Element[] {
  return topElements(xml, /<(region)\s[^>]*?\bid="(\d+)"[^>]*?\/?>/g, (match) => match[2]!);
}

/** A strings file's lines, each with its line ending, keyed by what comes before the first `=`. */
export function stringLines(text: string, { keyless = false }: { readonly keyless?: boolean } = {}): { bom: string; lines: { key: string; text: string }[] } {
  const bom = text.startsWith("﻿") ? "﻿" : "";
  const body = text.slice(bom.length);
  const lines = (body.match(/[^\n]*\n|[^\n]+$/g) ?? []).map((line) => {
    const equals = line.indexOf("=");
    return { key: equals < 0 ? line.trimEnd() : line.slice(0, equals), text: line };
  });
  // A line with no key (a blank one, or an old merge conflict's =======) only with keyless, keyed "".
  return { bom, lines: keyless ? lines.map((line) => (line.text.trim() === "" || line.key === "" ? { ...line, key: "" } : line)) : lines.filter((line) => line.key !== "") };
}
