// Minimal scanner for the Editor's machine-written XML: one element per tag,
// double-quoted attributes, standard entities. Not a general XML parser.

export type XmlElement = {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  /** Raw text between the open and close tags; "" for self-closing elements. */
  readonly body: string;
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXmlText(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name]!);
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([A-Za-z_][\w.:-]*)="([^"]*)"/g)) attrs[match[1]!] = decodeXmlText(match[2]!);
  return attrs;
}

/** Every element named `tag` in document order, with its attributes and body. */
export function xmlElements(xml: string, tag: string): XmlElement[] {
  const out: XmlElement[] = [];
  const open = new RegExp(`<${tag}(\\s[^>]*?)?(/?)>`, "g");
  for (const match of xml.matchAll(open)) {
    const attrs = parseAttrs(match[1] ?? "");
    if (match[2] === "/") {
      out.push({ tag, attrs, body: "" });
      continue;
    }
    const start = match.index! + match[0].length;
    const end = xml.indexOf(`</${tag}>`, start);
    out.push({ tag, attrs, body: end < 0 ? "" : xml.slice(start, end) });
  }
  return out;
}

export function xmlElement(xml: string, tag: string): XmlElement | undefined {
  return xmlElements(xml, tag)[0];
}
