// Reads a map's `Triggers` file as the Editor writes it: a Root list, then one `<Element>` per
// trigger, function, variable, call, parameter and comment, each pointing at the others by Id.
// Every element keeps where it lies in the file, so an edit can rewrite one element and leave every
// other byte as the Editor wrote it. An element is known by its type and Id together: older Editor
// saves number each type apart, so one Id can be a Trigger, a Variable and a FunctionCall at once
// (Liberty's thanson01), and every reference names its element's type. Not a general XML parser: it reads only the Editor's own layout
// (four-space indented elements, double-quoted attributes, the standard entities).

import { decodeXmlText } from "../map/xml-elements.js";

/** A tag inside an element: `<Parameter Type="Param" Id="..."/>`, `<Value>3</Value>`, `<VariableType>...</VariableType>`. */
export type TriggerXmlNode = {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  /** Its text, decoded; "" for a self-closing tag or one holding only tags. */
  readonly text: string;
  readonly children: readonly TriggerXmlNode[];
};

/** One `<Element Type Id>` of the file, with where it lies. */
export type TriggerXmlElement = {
  readonly type: string;
  readonly id: string;
  readonly children: readonly TriggerXmlNode[];
  /** From the start of its line to past its closing line's end. */
  readonly start: number;
  readonly end: number;
};

export type TriggersFile = {
  readonly text: string;
  readonly eol: string;
  /** Map-local elements by elementKey (type and Id), in file order. */
  readonly elements: ReadonlyMap<string, TriggerXmlElement>;
  /** Every Id an element has, of any type: a new element's Id must be none of them, as the Editor numbers every type from one count. */
  readonly ids: ReadonlySet<string>;
};

/** An element's key in `elements`: `<type>/<id>`, as TriggerStrings.txt names it (`Trigger/00000029`). */
export const elementKey = (type: string, id: string): string => `${type}/${id}`;

/** The map-local element of `type` with `id`. */
export const elementOf = (file: TriggersFile, type: string, id: string): TriggerXmlElement | undefined => file.elements.get(elementKey(type, id));

/**
 * The element a reference names by its Type and Id (`<Parameter Type="Param" Id="…"/>`,
 * `<Variable Type="Variable" Id="…"/>`); undefined for a library's element, which the file
 * doesn't hold, or one it lacks.
 */
export const referenced = (file: TriggersFile, node: TriggerXmlNode): TriggerXmlElement | undefined =>
  node.attrs.Library || !node.attrs.Type || !node.attrs.Id ? undefined : elementOf(file, node.attrs.Type, node.attrs.Id);

function attrsOf(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([A-Za-z_][\w.:-]*)="([^"]*)"/g)) attrs[match[1]!] = decodeXmlText(match[2]!);
  return attrs;
}

/** The tags of an element's body, nested. */
function parseNodes(body: string): TriggerXmlNode[] {
  type Open = { tag: string; attrs: Record<string, string>; text: string; children: TriggerXmlNode[] };
  const root: Open = { tag: "", attrs: {}, text: "", children: [] };
  const stack: Open[] = [root];
  const token = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (const match of body.matchAll(token)) {
    const [, closing, tag, attrs, selfClosing, text] = match;
    const top = stack.at(-1)!;
    if (text !== undefined) {
      if (text.trim()) top.text += decodeXmlText(text);
      continue;
    }
    if (closing) {
      if (stack.length > 1 && top.tag === tag) {
        stack.pop();
        stack.at(-1)!.children.push(top);
      }
      continue;
    }
    const node: Open = { tag: tag!, attrs: attrsOf(attrs ?? ""), text: "", children: [] };
    if (selfClosing) top.children.push(node);
    else stack.push(node);
  }
  return root.children;
}

/** Reads `text`, a whole Triggers file. */
export function readTriggersFile(text: string): TriggersFile {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const elements = new Map<string, TriggerXmlElement>();
  const ids = new Set<string>();
  const open = /^    <Element Type="(\w+)"((?: \w+="[^"]*")*)( ?\/?)>\r?$/gm;
  for (const match of text.matchAll(open)) {
    const attrs = attrsOf(match[2] ?? "");
    const id = attrs.Id;
    if (!id) continue;
    const type = match[1]!;
    ids.add(id);
    const start = match.index;
    const lineEnd = text.indexOf("\n", start) + 1;
    if (match[3]!.includes("/")) {
      elements.set(elementKey(type, id), { type, id, children: [], start, end: lineEnd });
      continue;
    }
    const close = text.indexOf(`${eol}    </Element>`, lineEnd - eol.length);
    if (close < 0) throw new Error(`Triggers: ${type} ${id} has no closing tag`);
    const closeEnd = text.indexOf("\n", close + eol.length);
    const end = closeEnd < 0 ? text.length : closeEnd + 1;
    elements.set(elementKey(type, id), { type, id, children: parseNodes(text.slice(lineEnd, close)), start, end });
  }
  return { text, eol, elements, ids };
}

/** The first child named `tag`. */
export const child = (node: { readonly children: readonly TriggerXmlNode[] }, tag: string): TriggerXmlNode | undefined => node.children.find((item) => item.tag === tag);

/** Every child named `tag`. */
export const children = (node: { readonly children: readonly TriggerXmlNode[] }, tag: string): TriggerXmlNode[] => node.children.filter((item) => item.tag === tag);

/** A reference's key, `<Library>/<Id>` for a library's element, or the bare Id for a map-local one. */
export const refKey = (node: TriggerXmlNode): string => (node.attrs.Library ? `${node.attrs.Library}/${node.attrs.Id}` : node.attrs.Id ?? "");

/** The map's names for its elements, from TriggerStrings.txt (`Trigger/Name/<id>=...`). */
export function triggerStringNames(triggerStrings: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const match of triggerStrings.replace(/^﻿/, "").matchAll(/^(\w+)\/Name\/(\w+)=([^\r\n]*)$/gm)) {
    names.set(`${match[1]}/${match[2]}`, match[3]!);
  }
  return names;
}
