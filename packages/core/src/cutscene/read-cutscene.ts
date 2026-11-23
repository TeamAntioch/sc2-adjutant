// Reads a Cutscene Editor file (.SC2Cutscene, a `CutsceneState` XML tree) into nested nodes.
// The files are machine-written: double-quoted attributes, no CDATA, no mixed text that matters.
// xml-elements.ts scans flat elements; cutscenes nest folders and actors, so they need a tree.

import { decodeXmlText } from "../map/xml-elements.js";

export type CutsceneNode = {
  /** Element name with the `CCutsceneNode` / `CCutsceneElement` prefix kept, e.g. "CCutsceneNodeActor". */
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly CutsceneNode[];
};

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*="[^"]*")*)\s*(\/?)>/g;

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([A-Za-z_][\w.:-]*)="([^"]*)"/g)) attrs[match[1]!] = decodeXmlText(match[2]!);
  return attrs;
}

/** The document's root element (`CutsceneState`). Throws on unbalanced tags. */
export function readCutscene(xml: string): CutsceneNode {
  const body = xml.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  type Open = { tag: string; attrs: Record<string, string>; children: CutsceneNode[] };
  const stack: Open[] = [{ tag: "#document", attrs: {}, children: [] }];
  for (const match of body.matchAll(TAG)) {
    const [, closing, tag, attrSource, selfClosing] = match;
    if (closing) {
      const done = stack.pop()!;
      if (done.tag !== tag || stack.length === 0) throw new Error(`Unbalanced </${tag}> in cutscene`);
      stack.at(-1)!.children.push(done);
    } else if (selfClosing) {
      stack.at(-1)!.children.push({ tag: tag!, attrs: parseAttrs(attrSource!), children: [] });
    } else {
      stack.push({ tag: tag!, attrs: parseAttrs(attrSource!), children: [] });
    }
  }
  if (stack.length !== 1) throw new Error(`Unclosed <${stack.at(-1)!.tag}> in cutscene`);
  const root = stack[0]!.children[0];
  if (!root) throw new Error("Empty cutscene");
  return root;
}

const encode = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Writes a node tree back out in the Editor's layout: four-space indents, self-closing leaves. */
export function writeCutscene(root: CutsceneNode): string {
  const lines: string[] = ['<?xml version="1.0" encoding="utf-8"?>'];
  const write = (node: CutsceneNode, depth: number): void => {
    const pad = "    ".repeat(depth);
    const attrs = Object.entries(node.attrs)
      .map(([name, value]) => ` ${name}="${encode(value)}"`)
      .join("");
    if (node.children.length === 0) {
      lines.push(`${pad}<${node.tag}${attrs}/>`);
      return;
    }
    lines.push(`${pad}<${node.tag}${attrs}>`);
    for (const child of node.children) write(child, depth + 1);
    lines.push(`${pad}</${node.tag}>`);
  };
  write(root, 0);
  return `${lines.join("\n")}\n`;
}

/** A vector attribute like position="1.0,2.0,3.0", or undefined when it's absent or malformed. */
export function vectorAttr(node: CutsceneNode, name: string): readonly [number, number, number] | undefined {
  const parts = node.attrs[name]?.split(",").map(Number);
  return parts && parts.length === 3 && parts.every(Number.isFinite) ? [parts[0]!, parts[1]!, parts[2]!] : undefined;
}
