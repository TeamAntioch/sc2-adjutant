// A small XML reader for the files the Editor writes: enough to find a document's top-level
// elements where they stand, skipping comments, and to put a fragment in a canonical form for
// comparing two of them as the Editor reads them (src/mods/equivalence.ts).

/** One markup or text token of a document, with where it is. */
export type XmlToken =
  | { readonly type: "open" | "self"; readonly name: string; readonly attributes: readonly (readonly [string, string])[]; readonly start: number; readonly end: number }
  | { readonly type: "close"; readonly name: string; readonly start: number; readonly end: number }
  | { readonly type: "text" | "comment" | "other"; readonly text: string; readonly start: number; readonly end: number };

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/** The attributes written in `markup` (a tag's after its name, or a processing instruction's), values as written. */
const attributesIn = (markup: string): [string, string][] => [...markup.matchAll(ATTRIBUTE)].map((match) => [match[1]!, match[3] ?? match[4] ?? ""]);

/** The document's tokens in order. Refuses markup it can't read (an unclosed tag or comment). */
export function xmlTokens(xml: string): XmlToken[] {
  const out: XmlToken[] = [];
  let at = 0;
  while (at < xml.length) {
    const open = xml.indexOf("<", at);
    if (open < 0) {
      out.push({ type: "text", text: xml.slice(at), start: at, end: xml.length });
      break;
    }
    if (open > at) out.push({ type: "text", text: xml.slice(at, open), start: at, end: open });
    const ending = (marker: string): number => {
      const close = xml.indexOf(marker, open);
      if (close < 0) throw new Error(`Unclosed markup at character ${open}: ${xml.slice(open, open + 40)}`);
      return close + marker.length;
    };
    if (xml.startsWith("<!--", open)) {
      const end = ending("-->");
      out.push({ type: "comment", text: xml.slice(open, end), start: open, end });
      at = end;
    } else if (xml.startsWith("<![CDATA[", open)) {
      const end = ending("]]>");
      out.push({ type: "text", text: xml.slice(open + 9, end - 3), start: open, end });
      at = end;
    } else if (xml.startsWith("<?", open) || xml.startsWith("<!", open)) {
      const end = ending(">");
      out.push({ type: "other", text: xml.slice(open, end), start: open, end });
      at = end;
    } else {
      // A tag ends at the first > outside a quoted attribute value.
      let end = open + 1;
      let quote: string | undefined;
      for (; end < xml.length; end++) {
        const char = xml[end]!;
        if (quote) {
          if (char === quote) quote = undefined;
        } else if (char === '"' || char === "'") quote = char;
        else if (char === ">") break;
      }
      if (end >= xml.length) throw new Error(`Unclosed tag at character ${open}: ${xml.slice(open, open + 40)}`);
      end += 1;
      const tag = xml.slice(open, end);
      if (tag.startsWith("</")) {
        out.push({ type: "close", name: tag.slice(2, -1).trim(), start: open, end });
      } else {
        const name = /^<([^\s/>]+)/.exec(tag)?.[1] ?? "";
        const attributes = attributesIn(tag.slice(1 + name.length));
        out.push({ type: tag.endsWith("/>") ? "self" : "open", name, attributes, start: open, end });
      }
      at = end;
    }
  }
  return out;
}

/** A top-level element of a document's root: its tag, its attributes and where it is. */
export type XmlChild = {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  /** From the start of its line when only indentation comes before it there, so it moves with its indent. */
  readonly start: number;
  readonly end: number;
  readonly text: string;
};

/** The root element's name and its children, each where it stands. Comments and text between them aren't elements. */
export function rootChildren(xml: string): { readonly root: string | undefined; readonly children: XmlChild[]; readonly rootClose: number | undefined } {
  const tokens = xmlTokens(xml);
  const children: XmlChild[] = [];
  let depth = 0;
  let root: string | undefined;
  let rootClose: number | undefined;
  let current: { name: string; attributes: ReadonlyMap<string, string>; start: number } | undefined;
  for (const token of tokens) {
    if (token.type === "open" || token.type === "self") {
      if (depth === 0) {
        root = token.name;
        if (token.type === "open") depth = 1;
        continue;
      }
      if (depth === 1) {
        const lineStart = xml.lastIndexOf("\n", token.start - 1) + 1;
        const start = /^[ \t]*$/.test(xml.slice(lineStart, token.start)) ? lineStart : token.start;
        current = { name: token.name, attributes: new Map(token.attributes), start };
        if (token.type === "self") {
          children.push({ ...current, end: token.end, text: xml.slice(start, token.end) });
          current = undefined;
          continue;
        }
      }
      if (token.type === "open") depth += 1;
    } else if (token.type === "close") {
      depth -= 1;
      if (depth === 1 && current) {
        children.push({ ...current, end: token.end, text: xml.slice(current.start, token.end) });
        current = undefined;
      } else if (depth === 0) {
        rootClose = token.start;
      }
    }
  }
  return { root, children, rootClose };
}

/** An element of a document read as a tree: its attributes (values as written, entities decoded), children and text. */
export type XmlNode = { readonly name: string; readonly attributes: [string, string][]; readonly children: XmlNode[]; text: string };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** An attribute of a node, decoded, or undefined. */
export const xmlAttribute = (node: Pick<XmlNode, "attributes">, name: string): string | undefined => node.attributes.find(([key]) => key === name)?.[1];

/** `text` with its character and entity references resolved. */
export const decodeXml = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) =>
    name.startsWith("#x") || name.startsWith("#X") ? String.fromCodePoint(parseInt(name.slice(2), 16)) : name.startsWith("#") ? String.fromCodePoint(Number(name.slice(1))) : (ENTITIES[name] ?? whole),
  );

/** The name of a comment's node, in a tree read keeping comments: its text is the comment's, between `<!--` and `-->`, as written. */
export const XML_COMMENT = "#comment";

/**
 * The name of a token declaration's node (`<?token id="abil" type="CAbilLink"?>`, a template's
 * declaration of a `##token##` its children fill in), in a tree read keeping tokens: its attributes are the declaration's.
 */
export const XML_TOKEN = "?token";

const TOKEN = /^<\?token(\s[\s\S]*)?\?>$/;

/**
 * `xml` (a document or a run of elements) as its top-level elements, each a tree; the declaration
 * dropped, and comments too unless `comments` asks for them, as XML_COMMENT nodes where they stand,
 * and token declarations unless `tokens` does, as XML_TOKEN nodes.
 */
export function xmlTree(xml: string, { comments = false, tokens = false }: { readonly comments?: boolean; readonly tokens?: boolean } = {}): XmlNode[] {
  const top: XmlNode = { name: "", attributes: [], children: [], text: "" };
  const stack: XmlNode[] = [top];
  for (const token of xmlTokens(xml)) {
    const parent = stack[stack.length - 1]!;
    if (token.type === "open" || token.type === "self") {
      const node: XmlNode = { name: token.name, attributes: token.attributes.map(([key, raw]) => [key, decodeXml(raw)] as [string, string]), children: [], text: "" };
      parent.children.push(node);
      if (token.type === "open") stack.push(node);
    } else if (token.type === "close") {
      if (stack.length > 1) stack.pop();
    } else if (token.type === "text" && token.text.trim() !== "") {
      parent.text += decodeXml(token.text);
    } else if (token.type === "comment" && comments) {
      parent.children.push({ name: XML_COMMENT, attributes: [], children: [], text: token.text.slice(4, -3) });
    } else if (token.type === "other" && tokens) {
      const declaration = TOKEN.exec(token.text);
      if (declaration) parent.children.push({ name: XML_TOKEN, attributes: attributesIn(declaration[1] ?? "").map(([key, raw]) => [key, decodeXml(raw)]), children: [], text: "" });
    }
  }
  return top.children;
}

/**
 * A decimal number as the game reads it, so `400.000000` and `400` are one value; ids such as
 * `00000001` keep their digits. A vector (`1.000000,1.000000,1.000000`) is read number by number,
 * when each of its parts is a number.
 */
const NUMBER = /^-?(\d+\.\d*|\.\d+)(e[-+]?\d+)?$/i;
const INTEGER = /^-?\d+$/;
const number = (part: string): string => (NUMBER.test(part) ? String(Number(part)) : part);
const value = (decoded: string): string => {
  const parts = decoded.trim().split(",");
  if (parts.length > 1 && parts.every((part) => NUMBER.test(part) || INTEGER.test(part))) return parts.map(number).join(",");
  return NUMBER.test(decoded.trim()) ? number(decoded.trim()) : decoded;
};

/**
 * `xml` (a document or a run of elements) in a canonical form, one element per line: without
 * comments, the declaration or whitespace between elements, keeping token declarations (an
 * entry's `<?token?>`s, as `<?token …?>` lines before its fields, in their order, wherever they stood), each element's attributes sorted,
 * numbers as their value, line breaks in text as LF, and its children in order by tag name, keeping the order of children of
 * one name (an array's entries).
 */
export function canonicalXml(xml: string): string {
  const byName = ([a]: [string, string], [b]: [string, string]) => (a < b ? -1 : a > b ? 1 : 0);
  const lines: string[] = [];
  const print = (node: XmlNode, depth: number): void => {
    const attributes = node.attributes
      .map(([key, raw]) => [key, value(raw)] as [string, string])
      .sort(byName)
      .map(([key, raw]) => ` ${key}="${raw}"`)
      .join("");
    // A text's line breaks as an XML reader takes them (XML 1.0 §2.11), so CRLF and LF are one text.
    const text = node.text.trim() === "" ? "" : ` ${JSON.stringify(value(node.text.trim().replace(/\r\n?/g, "\n")))}`;
    lines.push(node.name === XML_TOKEN ? `${"  ".repeat(depth)}<${XML_TOKEN}${attributes}?>` : `${"  ".repeat(depth)}<${node.name}${attributes}>${text}`);
    const tokens = node.children.filter((child) => child.name === XML_TOKEN);
    const fields = node.children.filter((child) => child.name !== XML_TOKEN).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const child of [...tokens, ...fields]) print(child, depth + 1);
  };
  for (const node of xmlTree(xml, { tokens: true })) print(node, 0);
  return lines.join("\n");
}
