// The MCP server (#96): a thin layer of tools over one Workspace. Each call reloads the Workspace
// config and Plugin manifests, so config edits apply on the next call, and a Plugin the Workspace
// can't load (such as one built for another plugin API version) fails the call with the reason.
// Plugin code is imported once per process: an edit to it needs a server restart.
//
// The Workspace is the one folder given, or with followRoots the one at or above the client's
// working folder (follow-roots.ts), found at each call.
//
// The machine's Host Adapter is loaded once, when the server starts, since the tool list depends
// on it: a tool in the co-design loop hands a step the host can't do to the author as
// instructions, and a bulk tool with no manual form is only listed when the host can run it.
// capture_shots is the exception: it's always listed, and refused with the reason on a host that
// can't capture, so an agent on another machine learns to hand it to the author.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, GetPromptRequestSchema, ListPromptsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";

import { bareHost, type Host } from "../host/host.js";
import type { KnowledgeDocument } from "../plugins/plugin-api.js";
import { MANIFEST_FILE } from "../plugins/registry.js";
import { loadWorkspace, WORKSPACE_FILE, type Workspace } from "../plugins/workspace.js";
import { createCallContext, withWorkspaceInput } from "./call-context.js";
import { CAPTURE_WAIT_MS } from "./capture-jobs.js";
import { CORE_VERSION } from "./core-version.js";
import type { DoodadFinderTool } from "./find-doodads.js";
import type { SetFinderTool } from "./find-sets.js";
import type { OpenDoodadFinderTool } from "./open-doodad-finder.js";
import { BLUEPRINT_TOOLS, registerBlueprintTools } from "./tools/blueprint.js";
import { CAPTURE_TOOLS, registerCaptureTools } from "./tools/capture.js";
import { CATALOG_TOOLS, registerCatalogTools } from "./tools/catalog.js";
import { COMPILE_TOOLS, registerCompileTools } from "./tools/compile.js";
import { registerSessionTools, SESSION_TOOLS } from "./tools/session.js";
import { registerStylePackTools, STYLE_PACK_TOOLS } from "./tools/style-pack.js";

/**
 * The tools each group can register, keyed by the group createServer registers them in (#976), for the
 * generated reference to group tools by. Every tool the server can list is in exactly one group.
 */
export const TOOL_GROUPS = {
  catalog: CATALOG_TOOLS,
  compile: COMPILE_TOOLS,
  blueprint: BLUEPRINT_TOOLS,
  capture: CAPTURE_TOOLS,
  session: SESSION_TOOLS,
  stylePack: STYLE_PACK_TOOLS,
} as const;

export type ServerOptions = {
  /** The folder holding the Workspace config. */
  readonly workspaceRoot: string;
  /**
   * Serve the Workspace at or above the client's first root (see follow-roots.ts) instead,
   * with `workspaceRoot` as the one for a client with no roots. For a session whose working
   * folder moves, such as into a git worktree. By default `workspaceRoot` serves throughout.
   */
  readonly followRoots?: boolean;
  /** The machine and its Host Adapter (see `loadHost`); by default a machine with none. */
  readonly host?: Host;
  /** How long a capture_shots call waits for its job before it returns the job's id; CAPTURE_WAIT_MS by default. */
  readonly captureWaitMs?: number;
  /** The Doodad Finder's tool (find-doodads.ts), when its package loaded: find_doodads is served only with it. */
  readonly doodadFinder?: DoodadFinderTool | undefined;
  /** The Doodad Finder's launcher (open-doodad-finder.ts), when its package loaded: open_doodad_finder is served only with it. */
  readonly openDoodadFinder?: OpenDoodadFinderTool | undefined;
  /** The Set Finder's tool (find-sets.ts), when its package loaded: find_sets is served only with it. */
  readonly setFinder?: SetFinderTool | undefined;
};

export function createServer({ workspaceRoot, host = bareHost(), followRoots: following = false, captureWaitMs = CAPTURE_WAIT_MS, doodadFinder, openDoodadFinder, setFinder }: ServerOptions): McpServer {
  const server = new McpServer({ name: "sc2-adjutant", version: CORE_VERSION });
  // First, so every tool registered below takes the `workspace` input.
  const workspaceInput = withWorkspaceInput(server);
  const ctx = createCallContext(server, { workspaceRoot, following, host }, workspaceInput);

  // Grouped by what a tool is about, so `tools/list` follows the groups, not the order the single file registered them in; no client reads that order (tools are called by name).
  registerCatalogTools(server, ctx, { doodadFinder, openDoodadFinder, setFinder });
  registerCompileTools(server, ctx);
  registerBlueprintTools(server, ctx);
  registerCaptureTools(server, ctx, { captureWaitMs });
  registerSessionTools(server, ctx);
  registerStylePackTools(server, ctx, { captureWaitMs });

  const pluginsWorkspace = cachedWorkspace(ctx.root);
  registerKnowledge(server, pluginsWorkspace);
  registerPrompts(server, pluginsWorkspace);

  return server;
}

/**
 * The Workspace for resource and prompt calls, which clients make often (a list on every turn):
 * loaded again only when the Workspace folder has changed, or the Workspace config, a loaded
 * local Plugin's manifest or an Exemplar Map's study.json (which the registry serves as a document
 * only once it exists) has changed since. Tools still load it fresh at each call. A Plugin's
 * document and prompt files are read at each call either way.
 */
function cachedWorkspace(currentRoot: () => Promise<string>): () => Promise<Workspace> {
  let cached: { readonly root: string; readonly stamp: string; readonly workspace: Promise<Workspace> } | undefined;
  const stampOf = async (root: string, workspace?: Workspace): Promise<string> => {
    const files = [
      path.join(root, WORKSPACE_FILE),
      ...(workspace?.registry.plugins ?? []).flatMap((plugin) => (plugin.folder ? [path.join(plugin.folder, MANIFEST_FILE)] : [])),
      ...(workspace?.registry.contributions("exemplarMaps") ?? []).map((exemplar) => path.join(exemplar.studyDir, "study.json")),
    ];
    const times = await Promise.all(files.map((file) => stat(file).then((stats) => stats.mtimeMs, () => -1)));
    return files.map((file, index) => `${file}@${times[index]}`).join("\n");
  };
  return async () => {
    const root = await currentRoot();
    if (cached?.root === root) {
      const last = await cached.workspace.catch(() => undefined);
      if (last && (await stampOf(root, last)) === cached.stamp) return last;
    }
    const workspace = loadWorkspace(root);
    const loaded = await workspace;
    // Stamped with the Plugins it loaded, so their manifests count from now on.
    cached = { root, stamp: await stampOf(root, loaded), workspace };
    return loaded;
  };
}

/** Where a Plugin's knowledge document is served. */
export function knowledgeUri(document: Pick<KnowledgeDocument, "plugin" | "id">): string {
  return `sc2-adjutant://plugins/${encodeURIComponent(document.plugin)}/knowledge/${encodeURIComponent(document.id)}`;
}

/**
 * Every loaded Plugin's knowledge documents as MCP resources: a Style Pack's guides and Design
 * Lessons, its Exemplar Maps, their Map Studies and its Doodad Composites. Listed and read through
 * the Workspace as it stands at each call.
 */
function registerKnowledge(server: McpServer, workspace: () => Promise<Workspace>): void {
  server.registerResource(
    "plugin-knowledge",
    new ResourceTemplate("sc2-adjutant://plugins/{plugin}/knowledge/{id}", {
      list: async () => {
        const { registry } = await workspace();
        return {
          resources: registry.contributions("knowledge").map((document) => ({
            uri: knowledgeUri(document),
            name: `${document.plugin}/${document.id}`,
            title: document.title,
            ...(document.description ? { description: document.description } : {}),
            mimeType: document.mimeType,
          })),
        };
      },
    }),
    {
      title: "Plugin knowledge",
      description: "A knowledge document a loaded Plugin contributes, such as a Style Pack's Design Lessons, guides, Exemplar Maps, Map Studies or Doodad Composites.",
    },
    async (uri, variables) => {
      const plugin = decodeURIComponent(String(variables.plugin));
      const id = decodeURIComponent(String(variables.id));
      const { registry } = await workspace();
      if (!registry.plugins.some((loaded) => loaded.name === plugin)) {
        throw new McpError(ErrorCode.InvalidParams, `The Workspace loads no Plugin ${plugin} (it loads: ${registry.plugins.map((loaded) => loaded.name).join(", ") || "none"})`);
      }
      const documents = registry.contributions("knowledge").filter((document) => document.plugin === plugin);
      const document = documents.find((candidate) => candidate.id === id);
      if (!document) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Plugin ${plugin} has no knowledge document ${id} (its documents: ${documents.map((candidate) => candidate.id).join(", ") || "none"})`,
        );
      }
      return { contents: [{ uri: uri.href, mimeType: document.mimeType, text: await readFile(document.file, "utf8") }] };
    },
  );
}

/**
 * Every loaded Plugin's prompts as MCP prompts. Registered on the protocol directly rather than
 * one by one, since the Plugins (and so the prompts) are read from the Workspace at each call.
 * So this server owns prompts/list and prompts/get: don't also use `server.registerPrompt`, whose
 * handlers would clash with these.
 */
function registerPrompts(server: McpServer, workspace: () => Promise<Workspace>): void {
  server.server.registerCapabilities({ prompts: {} });
  server.server.setRequestHandler(ListPromptsRequestSchema, async () => {
    const { registry } = await workspace();
    return {
      prompts: registry.contributions("prompts").map((prompt) => ({
        name: prompt.name,
        ...(prompt.title ? { title: prompt.title } : {}),
        description: `${prompt.description} (From Plugin ${prompt.plugin}.)`,
        arguments: prompt.arguments.map((argument) => ({ ...argument })),
      })),
    };
  });
  server.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: given = {} } = request.params;
    const { registry } = await workspace();
    const prompts = registry.contributions("prompts");
    const prompt = prompts.find((candidate) => candidate.name === name);
    if (!prompt) {
      throw new McpError(ErrorCode.InvalidParams, `No prompt ${name} (the Plugins' prompts: ${prompts.map((candidate) => candidate.name).join(", ") || "none"})`);
    }
    for (const argument of prompt.arguments) {
      // Required means given; an empty string is a value the author chose.
      if (argument.required && given[argument.name] === undefined) throw new McpError(ErrorCode.InvalidParams, `Prompt ${name} needs the argument ${argument.name}`);
    }
    const known = new Set(prompt.arguments.map((argument) => argument.name));
    const unknown = Object.keys(given).filter((argument) => !known.has(argument));
    if (unknown.length) {
      throw new McpError(ErrorCode.InvalidParams, `Prompt ${name} takes no argument ${unknown.join(", ")} (its arguments: ${[...known].join(", ") || "none"})`);
    }
    const template = await readFile(prompt.file, "utf8");
    const text = template.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g, (placeholder, argument: string) => (known.has(argument) ? (given[argument] ?? "") : placeholder));
    return {
      ...(prompt.title ? { description: prompt.title } : {}),
      messages: [{ role: "user" as const, content: { type: "text" as const, text } }],
    };
  });
}
