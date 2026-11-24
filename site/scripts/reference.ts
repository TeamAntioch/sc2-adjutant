// The tool reference (#977): writes site/.generated/reference.json (or the file given as the first
// argument) from the MCP server itself, so the Tools pages can't drift from the code. The site
// build runs it before `next build`. It reads core's built dist/, so core builds first (the root
// `workspaces` lists the site after packages/*), and it needs no network.
//
// It starts createServer() over the SDK's in-memory transport against the example Workspace and
// reads tools/list: with a bare host, with a host that has every capability plus the Finder tools,
// and once more for each capability or Finder left out, to name what a tool needs. A tool listed on
// every machine but refused without a capability is named in core's REFUSED_WITHOUT.
//
// It reads the tutorials too (#980), from site/tutorials/ or the folder given after --tutorials, and
// fails on a tool call that names a tool or input the server doesn't have (scripts/tutorials.ts).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { bareHost } from "@team-antioch/sc2-adjutant/dist/host/host.js";
import { emptyMachineConfig } from "@team-antioch/sc2-adjutant/dist/host/machine-config.js";
import { createServer, REFUSED_WITHOUT, TOOL_GROUPS, type ServerOptions } from "@team-antioch/sc2-adjutant/dist/mcp/server.js";
import { HOST_CAPABILITIES } from "@team-antioch/sc2-adjutant/dist/plugins/plugin-api.js";

import type { Command, FinderName, Field, HostAdapter, Needs, Reference, Skill, Tool, Writes } from "../lib/reference-types";
import { readTutorials } from "./tutorials.ts";

const SITE = fileURLToPath(new URL("..", import.meta.url));
const ROOT = path.join(SITE, "..");
const EXAMPLE_WORKSPACE = path.join(ROOT, "packages", "core", "examples", "example-campaign");
const PLUGIN = path.join(ROOT, "packages", "claude-plugin");
const SKILLS = path.join(PLUGIN, "skills");
const COMMANDS = path.join(PLUGIN, "commands");
const PACKAGES = path.join(ROOT, "packages");
const MANIFEST = JSON.parse(readFileSync(path.join(PLUGIN, ".claude-plugin", "plugin.json"), "utf8")) as { name: string; mcpServers: Record<string, unknown> };
/**
 * The prefix Claude Code gives the tools of the plugin's one server, mcp__plugin_<plugin>_<server>__,
 * which a command's `allowed-tools` writes before each tool's name (the plugin's tests check it).
 */
const SERVERS = Object.keys(MANIFEST.mcpServers);
if (SERVERS.length !== 1) throw new Error(`The plugin's manifest starts ${SERVERS.length} MCP servers; the reference reads allowed-tools for one`);
const TOOL_PREFIX = `mcp__plugin_${MANIFEST.name}_${SERVERS[0]}__`.replace(/[^A-Za-z0-9_-]/g, "_");

type Listed = Awaited<ReturnType<Client["listTools"]>>["tools"][number];
type Options = Omit<ServerOptions, "workspaceRoot">;

/** The tools a server for the example Workspace lists with `options`. */
async function listTools(options: Options): Promise<Listed[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ workspaceRoot: EXAMPLE_WORKSPACE, ...options });
  await server.connect(serverTransport);
  const client = new Client({ name: "sc2-adjutant-site", version: "0.0.0" });
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  await client.close();
  await server.close();
  // Through JSON, as a client receives them: fields left undefined drop out.
  return JSON.parse(JSON.stringify(tools)) as Listed[];
}

const notCalled = () => Promise.reject(new Error("not called"));

/** A host whose Host Adapter has every capability but those in `without`. */
function hostWith(without: readonly string[] = []): NonNullable<ServerOptions["host"]> {
  return { machine: emptyMachineConfig(), adapter: undefined, has: (name) => !without.includes(name), run: notCalled as never };
}

const FINDERS = {
  "Doodad Finder": { doodadFinder: { find: notCalled }, openDoodadFinder: { open: notCalled } },
  "Set Finder": { setFinder: { find: notCalled } },
} as const satisfies Record<FinderName, Options>;
const EVERY_FINDER: Options = Object.assign({}, ...Object.values(FINDERS));

const GROUP_TITLES: Record<keyof typeof TOOL_GROUPS, string> = {
  catalog: "Catalog",
  compile: "Compile",
  blueprint: "Blueprint",
  capture: "Capture",
  session: "Session",
  stylePack: "Style Pack",
};

type Schema = {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  const?: unknown;
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  properties?: Record<string, Schema>;
  required?: string[];
};

/** A short type for a field's schema. */
function typeOf(schema: Schema): string {
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(" | ");
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  const union = schema.anyOf ?? schema.oneOf;
  if (union) return [...new Set(union.map(typeOf))].join(" | ");
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  if (schema.type === "array") {
    const items = schema.items ? typeOf(schema.items) : "any";
    return items.includes(" ") ? `(${items})[]` : `${items}[]`;
  }
  return schema.type ?? "any";
}

/** A field's description: its own, or the one its union's members share. */
function descriptionOf(schema: Schema): string {
  if (schema.description) return schema.description;
  const union = schema.anyOf ?? schema.oneOf;
  return union?.map((member) => member.description).find((text) => text) ?? "";
}

/** The top-level properties of an object schema. */
function fieldsOf(schema: Schema | undefined): Field[] {
  const required = new Set(schema?.required ?? []);
  return Object.entries(schema?.properties ?? {}).map(([name, property]) => ({ name, type: typeOf(property), required: required.has(name), description: descriptionOf(property) }));
}

function writesOf(annotations: Listed["annotations"]): Writes {
  if (annotations?.readOnlyHint) return "none";
  // MCP's default: a tool that writes is destructive unless it says it isn't.
  return annotations?.destructiveHint === false ? "adds" : "overwrites";
}

/**
 * A Markdown file's frontmatter, as the plugin's files write it: one `key: value` to a line, a
 * value in double quotes or bare. Anything else (a nested or multi-line value) is an error, so a
 * new shape is read on purpose rather than misread.
 */
function frontmatter(text: string, file: string): { fields: Map<string, string>; body: string } {
  const normalized = text.replace(/^﻿/, "").replaceAll("\r\n", "\n");
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalized);
  if (!match) throw new Error(`${file} has no frontmatter`);
  const fields = new Map<string, string>();
  for (const line of match[1]!.split("\n")) {
    if (!line.trim()) continue;
    const field = /^([a-z][a-z-]*):\s*(.*)$/.exec(line);
    if (!field) throw new Error(`${file}: can't read frontmatter line ${JSON.stringify(line)}`);
    const value = field[2]!.trim();
    fields.set(field[1]!, /^".*"$/.test(value) ? (JSON.parse(value) as string) : value);
  }
  return { fields, body: normalized.slice(match[0].length) };
}

/** A Markdown file's body: the text after its frontmatter, or all of it when it has none (a skill's reference file). */
function bodyOf(file: string): string {
  const text = readFileSync(file, "utf8");
  return /^﻿?---/.test(text) ? frontmatter(text, file).body : text;
}

/** The tools the texts name as `code`, in the server's order: `names` is every tool, in that order. */
function toolsNamedIn(texts: string[], names: readonly string[]): string[] {
  const named = new Set(texts.flatMap((text) => [...text.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map(([, name]) => name!)));
  return names.filter((name) => named.has(name));
}

/** Each skill, with the tools the bodies of its SKILL.md and its reference files name: they ship and load as one. */
function readSkills(names: readonly string[]): Skill[] {
  return readdirSync(SKILLS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((slug) => {
      const folder = path.join(SKILLS, slug);
      const file = path.join(folder, "SKILL.md");
      const { fields } = frontmatter(readFileSync(file, "utf8"), file);
      if (fields.get("name") !== slug) throw new Error(`${file} names the skill ${fields.get("name")}, not its folder's name ${slug}`);
      const texts = readdirSync(folder, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => bodyOf(path.join(entry.parentPath, entry.name)));
      return { slug, invocation: `/${MANIFEST.name}:${slug}`, description: fields.get("description") ?? "", tools: toolsNamedIn(texts, names), tutorials: [] as string[] };
    });
}

/** Each command, with the tools its `allowed-tools` lets it call and the tools its text names. */
function readCommands(names: readonly string[]): Command[] {
  return readdirSync(COMMANDS)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const file = path.join(COMMANDS, name);
      const { fields, body } = frontmatter(readFileSync(file, "utf8"), file);
      const allowed = (fields.get("allowed-tools") ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      // The server's tools among them, by their server names; a Claude Code tool (Bash, Read) isn't one.
      const allowedTools = allowed.filter((entry) => entry.startsWith(TOOL_PREFIX)).map((entry) => entry.slice(TOOL_PREFIX.length));
      const claudeCodeTools = allowed.filter((entry) => !entry.startsWith(TOOL_PREFIX));
      const drives = new Set([...allowedTools, ...toolsNamedIn([body], names)]);
      const slug = path.basename(name, ".md");
      return {
        slug,
        invocation: `/${MANIFEST.name}:${slug}`,
        description: fields.get("description") ?? "",
        argumentHint: fields.get("argument-hint") || null,
        modelInvocable: fields.get("disable-model-invocation") !== "true",
        allowedTools,
        claudeCodeTools,
        tools: names.filter((tool) => drives.has(tool)),
      };
    });
}

/** The machine each Host Adapter that ships runs on, by its Plugin name, as a tutorial's step marks it. */
const HOST_LABELS: Record<string, string> = { "host-macos": "macOS", "host-windows": "Windows" };

/** The Host Adapters that ship with sc2-adjutant (packages/*: Plugins in the host-adapter role), with their capabilities. */
function readHostAdapters(): HostAdapter[] {
  return readdirSync(PACKAGES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKAGES, entry.name, "sc2-adjutant-plugin.json"))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, "utf8")) as { name: string; roles?: string[]; contributions?: { capabilities?: HostAdapter["capabilities"] } })
    .filter((manifest) => manifest.roles?.includes("host-adapter"))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((manifest) => {
      const label = HOST_LABELS[manifest.name];
      if (!label) throw new Error(`The Host Adapter ${manifest.name} has no label for the tutorials: add it to HOST_LABELS in scripts/reference.ts`);
      return { name: manifest.name, label, capabilities: manifest.contributions?.capabilities ?? [] };
    });
}

/** The root npm scripts, by name. */
function rootScripts(): Set<string> {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  return new Set(Object.keys(manifest.scripts ?? {}));
}

async function buildReference(tutorialsFolder: string): Promise<Reference> {
  const listedAll = await listTools({ host: hostWith(), ...EVERY_FINDER });
  const listedBare = new Set((await listTools({ host: bareHost() })).map((tool) => tool.name));

  // What each tool missing from the bare list needs: the Finder whose absence drops it, else each
  // capability whose absence does.
  const needs = new Map<string, Needs>();
  for (const finder of Object.keys(FINDERS) as FinderName[]) {
    const otherFinders = Object.assign({}, ...Object.entries(FINDERS).filter(([name]) => name !== finder).map(([, options]) => options)) as Options;
    const listed = new Set((await listTools({ host: hostWith(), ...otherFinders })).map((tool) => tool.name));
    for (const tool of listedAll) if (!listed.has(tool.name)) needs.set(tool.name, { kind: "finder", finder });
  }
  for (const capability of HOST_CAPABILITIES) {
    const listed = new Set((await listTools({ host: hostWith([capability]), ...EVERY_FINDER })).map((tool) => tool.name));
    for (const tool of listedAll) {
      if (listed.has(tool.name) || needs.get(tool.name)?.kind === "finder") continue;
      const known = needs.get(tool.name);
      needs.set(tool.name, { kind: "capability", capabilities: [...(known?.kind === "capability" ? known.capabilities : []), capability] });
    }
  }
  for (const tool of listedAll) {
    if (!listedBare.has(tool.name) && !needs.has(tool.name)) throw new Error(`${tool.name} is listed only on a capable host, but no one capability or Finder gates it`);
  }
  // A tool listed everywhere but refused without a capability says so in core's REFUSED_WITHOUT.
  for (const [name, capabilities] of Object.entries(REFUSED_WITHOUT)) {
    if (!listedBare.has(name)) throw new Error(`${name} is in core's REFUSED_WITHOUT, but a bare host doesn't list it`);
    needs.set(name, { kind: "refused", capabilities: [...capabilities] });
  }

  const groupOf = new Map<string, string>(Object.entries(TOOL_GROUPS).flatMap(([group, names]) => names.map((name) => [name, group] as const)));
  const scripts = rootScripts();
  const names = listedAll.map((tool) => tool.name);
  const skills = readSkills(names);
  const commands = readCommands(names);
  const hostAdapters = readHostAdapters();
  const known = {
    tools: listedAll.map((tool) => ({ name: tool.name, inputs: fieldsOf(tool.inputSchema as Schema) })),
    hostAdapters,
    finders: Object.keys(FINDERS) as FinderName[],
    skills: skills.map((skill) => skill.slug),
  };
  const tutorials = readTutorials(tutorialsFolder, known);
  for (const skill of skills) skill.tutorials = tutorials.filter((tutorial) => tutorial.skills.includes(skill.slug)).map((tutorial) => tutorial.slug);
  const tools: Tool[] = listedAll.map((tool) => {
    const group = groupOf.get(tool.name);
    if (!group) throw new Error(`${tool.name} is in none of core's TOOL_GROUPS`);
    const script = tool.name.replaceAll("_", "-");
    return {
      name: tool.name,
      title: tool.title ?? "",
      description: tool.description ?? "",
      group,
      inputs: fieldsOf(tool.inputSchema as Schema),
      outputs: fieldsOf(tool.outputSchema as Schema | undefined),
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema ?? null,
      annotations: tool.annotations ?? {},
      writes: writesOf(tool.annotations),
      needs: needs.get(tool.name) ?? { kind: "none" },
      cli: scripts.has(script) ? `npm run ${script}` : null,
      usedBy: {
        skills: skills.filter((skill) => skill.tools.includes(tool.name)).map((skill) => skill.slug),
        commands: commands.filter((command) => command.tools.includes(tool.name)).map((command) => command.slug),
        tutorials: tutorials.filter((tutorial) => tutorial.tools.includes(tool.name)).map((tutorial) => tutorial.slug),
      },
    };
  });

  return {
    groups: (Object.keys(TOOL_GROUPS) as (keyof typeof TOOL_GROUPS)[]).map((id) => ({ id, title: GROUP_TITLES[id], tools: tools.filter((tool) => tool.group === id).map((tool) => tool.name) })),
    tools,
    skills,
    commands,
    hostAdapters,
    tutorials,
  };
}

// node scripts/reference.ts [<file>] [--tutorials <folder>]
const { values, positionals } = parseArgs({ allowPositionals: true, options: { tutorials: { type: "string" } } });
const tutorialsFolder = path.resolve(values.tutorials ?? path.join(SITE, "tutorials"));
const file = path.resolve(positionals[0] ?? path.join(SITE, ".generated", "reference.json"));
const reference = await buildReference(tutorialsFolder);
mkdirSync(path.dirname(file), { recursive: true });
writeFileSync(file, `${JSON.stringify(reference, null, 2)}\n`);
console.log(`Wrote ${reference.tools.length} tools and ${reference.tutorials.length} tutorials to ${path.relative(process.cwd(), file) || file}`);
