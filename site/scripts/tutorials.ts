// The tutorials (#980): reads each site/tutorials/<number>-<slug>.mdx for the reference script,
// which puts what it finds in reference.json. It parses the MDX, without running it, for the
// tutorial's `meta`, its <Objective>s and its <ToolCall>s. Each tool call must name a tool the
// server lists, give only inputs that tool takes, and give every input it needs. Each objective's
// `needs` must be capabilities some Host Adapter has, or Finders. Anything else throws. The site
// build runs the reference script first, so it fails the build.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { createProcessor } from "@mdx-js/mdx";
import { HOST_CAPABILITIES, type HostCapabilityName } from "@team-antioch/sc2-adjutant/dist/plugins/plugin-api.js";

import type { FinderName, HostAdapter, Objective, Tool, Tutorial } from "../lib/reference-types";
import { objectiveId } from "../lib/slug.ts";

/** What a tutorial is checked against: the server's tools, the Host Adapters that ship and the Finders. */
export interface Known {
  tools: Pick<Tool, "name" | "inputs">[];
  hostAdapters: HostAdapter[];
  finders: readonly FinderName[];
}

/** A tutorial's file name: its number, then its slug. */
const FILE_NAME = /^(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)\.mdx$/;

// The few shapes of the MDX syntax tree (mdast with the MDX nodes) and of estree read here.
type Estree = { type: string; [key: string]: unknown };
type Program = { body: Estree[] };
type AttributeValue = string | null | undefined | { type: "mdxJsxAttributeValueExpression"; value: string; data?: { estree?: Program } };
type Attribute = { type: "mdxJsxAttribute"; name: string; value?: AttributeValue } | { type: "mdxJsxExpressionAttribute"; value: string };
type Node = {
  type: string;
  name?: string | null;
  attributes?: Attribute[];
  children?: Node[];
  value?: string;
  data?: { estree?: Program };
  position?: { start: { line: number } };
};

class TutorialError extends Error {}

/** The value a literal expression writes: objects, arrays, strings, numbers, booleans and null, nothing computed. */
function literal(node: Estree, what: string): unknown {
  switch (node.type) {
    case "ObjectExpression":
      return Object.fromEntries(
        (node.properties as Estree[]).map((property) => {
          const key = property.key as Estree | undefined;
          if (property.type !== "Property" || property.computed || property.kind !== "init" || !key) throw new TutorialError(`${what} must be written out: no spreads, computed keys or methods`);
          const name = key.type === "Identifier" ? (key.name as string) : key.type === "Literal" && typeof key.value === "string" ? key.value : undefined;
          if (name === undefined) throw new TutorialError(`${what} must be written out: a key is neither a name nor a string`);
          return [name, literal(property.value as Estree, what)];
        }),
      );
    case "ArrayExpression":
      return (node.elements as (Estree | null)[]).map((element) => {
        if (!element || element.type === "SpreadElement") throw new TutorialError(`${what} must be written out: no holes or spreads in an array`);
        return literal(element, what);
      });
    case "Literal":
      if (node.regex || node.bigint !== undefined) throw new TutorialError(`${what} must be written out as JSON values`);
      return node.value;
    case "UnaryExpression": {
      const argument = node.argument as Estree;
      if (node.operator === "-" && argument.type === "Literal" && typeof argument.value === "number") return -argument.value;
      break;
    }
    case "TemplateLiteral":
      if ((node.expressions as unknown[]).length === 0) return (node.quasis as { value: { cooked: string } }[])[0]!.value.cooked;
      break;
  }
  throw new TutorialError(`${what} must be written out as JSON values, not computed (found ${node.type})`);
}

/** The value of an MDX expression, such as an attribute's `{…}`. */
function expressionValue(program: Program | undefined, what: string): unknown {
  const statement = program?.body[0];
  if (!program || program.body.length !== 1 || statement?.type !== "ExpressionStatement") throw new TutorialError(`${what} must be one expression`);
  return literal(statement.expression as Estree, what);
}

/** An element's attributes, by name: a string, the literal value of an expression, or true for a bare name. */
function attributesOf(node: Node): Map<string, unknown> {
  const attributes = new Map<string, unknown>();
  for (const attribute of node.attributes ?? []) {
    if (attribute.type !== "mdxJsxAttribute") throw new TutorialError(`<${node.name}> can't spread attributes ({...})`);
    const { name, value } = attribute;
    if (value === null || value === undefined) attributes.set(name, true);
    else if (typeof value === "string") attributes.set(name, value);
    else attributes.set(name, expressionValue(value.data?.estree, `<${node.name}>'s ${name}`));
  }
  return attributes;
}

/** Every node of the tree, depth first, in document order. */
function* walk(node: Node): Generator<Node> {
  yield node;
  for (const child of node.children ?? []) yield* walk(child);
}

const isElement = (node: Node, name: string) => (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") && node.name === name;

/** The tutorial's `export const meta = { title, summary, minutes }`. */
function metaOf(tree: Node): Pick<Tutorial, "title" | "summary" | "minutes"> {
  for (const node of walk(tree)) {
    if (node.type !== "mdxjsEsm") continue;
    for (const statement of node.data?.estree?.body ?? []) {
      const declaration = statement.declaration as Estree | undefined;
      if (statement.type !== "ExportNamedDeclaration" || declaration?.type !== "VariableDeclaration") continue;
      for (const declarator of declaration.declarations as Estree[]) {
        if ((declarator.id as Estree).name !== "meta" || !declarator.init) continue;
        const meta = literal(declarator.init as Estree, "meta") as Record<string, unknown>;
        const { title, summary, minutes } = meta;
        if (typeof title !== "string" || !title.trim()) throw new TutorialError("meta needs a title");
        if (typeof summary !== "string" || !summary.trim()) throw new TutorialError("meta needs a summary");
        if (typeof minutes !== "number" || !(minutes > 0)) throw new TutorialError("meta needs minutes, a number above 0");
        return { title, summary, minutes };
      }
    }
  }
  throw new TutorialError("it has no `export const meta = { title, summary, minutes }`");
}

function objectiveOf(node: Node, known: Known): Objective {
  const attributes = attributesOf(node);
  const title = attributes.get("title");
  if (typeof title !== "string" || !title.trim()) throw new TutorialError("<Objective> needs a title");
  const id = objectiveId(attributes.get("id"), title);
  if (typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new TutorialError(`<Objective title="${title}">'s id must be a lowercase slug`);
  const given = attributes.get("needs") ?? [];
  const needs = typeof given === "string" ? [given] : given;
  if (!Array.isArray(needs) || needs.some((need) => typeof need !== "string")) throw new TutorialError(`<Objective title="${title}">'s needs must be a capability or a Finder, or a list of them`);
  const isFinder = (need: string): need is FinderName => (known.finders as readonly string[]).includes(need);
  const isCapability = (need: string): need is HostCapabilityName => (HOST_CAPABILITIES as readonly string[]).includes(need);
  for (const need of needs as string[]) {
    if (!isFinder(need) && !isCapability(need)) {
      throw new TutorialError(`<Objective title="${title}"> needs ${need}, which is neither a Host Adapter capability (${HOST_CAPABILITIES.join(", ")}) nor a Finder (${known.finders.join(", ")})`);
    }
  }
  const finders = (needs as string[]).filter(isFinder);
  const capabilities = (needs as string[]).filter(isCapability);
  const hostAdapters = capabilities.length ? known.hostAdapters.filter((adapter) => capabilities.every((need) => adapter.capabilities.includes(need))).map((adapter) => adapter.label) : [];
  if (capabilities.length && !hostAdapters.length) throw new TutorialError(`<Objective title="${title}"> needs ${capabilities.join(" and ")}, which no Host Adapter has`);
  return { id, title, needs: capabilities, finders, hostAdapters };
}

/** Checks a tool call against its tool, and gives the tool's name. */
function toolCallOf(node: Node, known: Known): string {
  const attributes = attributesOf(node);
  const name = attributes.get("name");
  if (typeof name !== "string" || !name) throw new TutorialError("<ToolCall> needs a name, the tool's");
  const tool = known.tools.find((candidate) => candidate.name === name);
  if (!tool) throw new TutorialError(`<ToolCall name="${name}">: ${name} isn't a tool the server lists`);
  const args = attributes.get("args") ?? {};
  if (typeof args !== "object" || args === null || Array.isArray(args)) throw new TutorialError(`<ToolCall name="${name}">'s args must be an object, as args={{ mission: "…" }}`);
  const inputs = new Set(tool.inputs.map((input) => input.name));
  for (const input of Object.keys(args)) {
    if (!inputs.has(input)) throw new TutorialError(`<ToolCall name="${name}">: ${name} takes no input ${input} (it takes ${[...inputs].join(", ") || "none"})`);
  }
  for (const input of tool.inputs) {
    if (input.required && !(input.name in args)) throw new TutorialError(`<ToolCall name="${name}">: ${name} needs ${input.name}`);
  }
  return name;
}

/** A tutorial from its MDX source; `file` is its file's name, as site/tutorials/ holds it. */
export function parseTutorial(source: string, file: string, known: Known): Tutorial {
  const match = FILE_NAME.exec(path.basename(file));
  if (!match) throw new Error(`${file}: a tutorial's file is named <number>-<slug>.mdx, such as 01-first-mission.mdx`);
  let line: number | undefined;
  try {
    const tree = createProcessor().parse(source) as Node;
    const meta = metaOf(tree);
    const objectives: Objective[] = [];
    const tools: string[] = [];
    for (const node of walk(tree)) {
      line = node.position?.start.line;
      if (isElement(node, "Objective")) {
        const objective = objectiveOf(node, known);
        if (objectives.some((other) => other.id === objective.id)) throw new TutorialError(`two objectives have the id ${objective.id}`);
        objectives.push(objective);
      } else if (isElement(node, "ToolCall")) {
        const tool = toolCallOf(node, known);
        if (!tools.includes(tool)) tools.push(tool);
      }
    }
    return { slug: match[2]!, number: Number(match[1]), file: path.basename(file), ...meta, objectives, tools };
  } catch (error) {
    // The MDX parser's own errors (a tag left open, say) say where they are.
    const where = error instanceof TutorialError && line !== undefined ? `${file}:${line}` : file;
    throw new Error(`${where}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/** Every tutorial in `folder`, by number. */
export function readTutorials(folder: string, known: Known): Tutorial[] {
  const tutorials = readdirSync(folder)
    .filter((name) => name.endsWith(".mdx"))
    .map((name) => parseTutorial(readFileSync(path.join(folder, name), "utf8"), `${path.basename(folder)}/${name}`, known))
    .sort((a, b) => a.number - b.number);
  const slugs = new Set<string>();
  for (const [index, tutorial] of tutorials.entries()) {
    const before = tutorials[index - 1];
    if (before?.number === tutorial.number) throw new Error(`${folder}: ${before.slug} and ${tutorial.slug} have the same number, ${tutorial.number}`);
    if (slugs.has(tutorial.slug)) throw new Error(`${folder}: two tutorials have the slug ${tutorial.slug}`);
    slugs.add(tutorial.slug);
  }
  return tutorials;
}
