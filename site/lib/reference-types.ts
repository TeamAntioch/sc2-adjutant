// The shape of site/.generated/reference.json, which scripts/reference.ts writes from the MCP
// server itself (#977) and the Tools pages read. Types only, so the build script (run by Node with
// its types stripped) and the pages share them.
import type { HostCapabilityName } from "@team-antioch/sc2-adjutant/dist/plugins/plugin-api.js";

/** One field of a tool's input or output: a top-level property of its JSON Schema. */
export interface Field {
  name: string;
  /** A short type, from the JSON Schema: "string", "number[]", "object", "\"a\" | \"b\"". */
  type: string;
  required: boolean;
  /** The field's description from its schema; empty when it has none. */
  description: string;
}

/**
 * What a tool writes, from its MCP hints (tool-group.ts in core): "none" for readOnlyHint,
 * "adds" for destructiveHint false, "overwrites" otherwise (MCP's default).
 */
export type Writes = "none" | "adds" | "overwrites";

/** A Finder package, which core loads when it's installed: the server lists its tools only then. */
export type FinderName = "Doodad Finder" | "Set Finder";

/** What a machine needs before the server lists the tool, or before it runs a tool it always lists. */
export type Needs =
  | { kind: "none" }
  /** Listed only when the Host Adapter has each of these capabilities. */
  | { kind: "capability"; capabilities: HostCapabilityName[] }
  /** Listed on every machine, but refused where the Host Adapter lacks one of these capabilities. */
  | { kind: "refused"; capabilities: HostCapabilityName[] }
  /** Listed only when this Finder package loaded. */
  | { kind: "finder"; finder: FinderName };

/**
 * Where a tool is used: the skills and commands that name it in backticks or allow it (#978), and
 * the tutorials whose tool calls name it (#980). Each entry is the slug of the page that names the tool.
 */
export interface UsedBy {
  skills: string[];
  commands: string[];
  tutorials: string[];
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  /** The id of the group the server registers it in (TOOL_GROUPS in core). */
  group: string;
  inputs: Field[];
  outputs: Field[];
  /** The raw JSON Schemas, as tools/list gives them, for anything the fields leave out. */
  inputSchema: unknown;
  outputSchema: unknown;
  annotations: Record<string, unknown>;
  writes: Writes;
  needs: Needs;
  /** The root npm script of the same name, as "npm run compile-map", or null. */
  cli: string | null;
  usedBy: UsedBy;
}

export interface Group {
  id: string;
  title: string;
  /** Its tools' names, in the order the server lists them. */
  tools: string[];
}

/** A skill the Claude Code plugin ships: packages/claude-plugin/skills/<slug>/SKILL.md (#978). */
export interface Skill {
  /** Its folder's name, which its frontmatter's `name` matches: the page's slug. */
  slug: string;
  /** What the author types to load it by name: "/sc2-adjutant:level-design". */
  invocation: string;
  /** Its frontmatter's description: what it does, then when Claude reaches for it. */
  description: string;
  /** The tools its Markdown files' bodies name in backticks, in the server's order. */
  tools: string[];
}

/** A slash command the Claude Code plugin ships: packages/claude-plugin/commands/<slug>.md (#978). */
export interface Command {
  /** Its file's name less `.md`: the page's slug, and the command's name after the plugin's. */
  slug: string;
  /** What the author types, the plugin's name before the command's: "/sc2-adjutant:compile". */
  invocation: string;
  /** Its frontmatter's description: what it does. */
  description: string;
  /** What to type after the command, from its frontmatter's `argument-hint`; null when it has none. */
  argumentHint: string | null;
  /** Whether Claude may run it on its own, not only when the author types it (no `disable-model-invocation`). */
  modelInvocable: boolean;
  /** The tools its frontmatter's `allowed-tools` lets it call without asking, by their server names. */
  allowedTools: string[];
  /** The rest of its `allowed-tools`: Claude Code's own tools, as written there, such as "Bash(node --version)". */
  claudeCodeTools: string[];
  /** Every tool it drives: its allowed tools and the tools its text names in backticks, in the server's order. */
  tools: string[];
}

/** A Host Adapter that ships with sc2-adjutant: packages/plugin-host-<os>/ (#980). */
export interface HostAdapter {
  /** Its Plugin name, as its sc2-adjutant-plugin.json gives it: "host-macos". */
  name: string;
  /** The machine it runs on, as a tutorial's step marks it: "macOS". */
  label: string;
  /** The capabilities its manifest contributes. */
  capabilities: HostCapabilityName[];
}

/** One step of a tutorial: an `<Objective>` in its MDX (#980). */
export interface Objective {
  /** The step's anchor on the tutorial's page: its `id`, else its title as a slug. */
  id: string;
  title: string;
  /** The Host Adapter capabilities in its `needs`, such as editor.testDocument; empty for most. */
  needs: HostCapabilityName[];
  /** The Finders in its `needs`, such as the Doodad Finder, for a step whose tools only a Finder serves; empty for most. */
  finders: FinderName[];
  /** The labels of the Host Adapters that have every capability in `needs`; empty when it needs none. */
  hostAdapters: string[];
}

/** A tutorial: site/tutorials/<number>-<slug>.mdx (#980). */
export interface Tutorial {
  /** Its file's name less the number and `.mdx`: its page is /tutorials/<slug>/. */
  slug: string;
  /** The number its file's name starts with: its place in the Tutorials index. */
  number: number;
  /** Its file's name in site/tutorials/, such as 01-first-mission.mdx. */
  file: string;
  /** From its MDX's `export const meta`. */
  title: string;
  summary: string;
  /** About how long it takes, in minutes. */
  minutes: number;
  objectives: Objective[];
  /** The tools its `<ToolCall>`s name, each once, in the order they're first called. */
  tools: string[];
}

export interface Reference {
  groups: Group[];
  tools: Tool[];
  skills: Skill[];
  commands: Command[];
  hostAdapters: HostAdapter[];
  tutorials: Tutorial[];
}
