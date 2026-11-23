// What every tool call shares (#718): the Workspace folder it is about, the machine's Host, and
// the shape of a refusal. The tool groups (tools/*.ts) take it instead of reaching into
// createServer's closure, so each is a module of its own.
//
// The Workspace is the one folder given, or with followRoots the one at or above the client's
// working folder (follow-roots.ts), found at each call. A call's own `workspace` input names the
// Workspace for that call alone, over what the roots say (a worktree the session reaches without
// moving its roots, such as an added folder). withWorkspaceInput gives every tool registered on the
// server that input, so createServer takes it before registering any tool group.

import { AsyncLocalStorage } from "node:async_hooks";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Host } from "../host/host.js";
import { type BlueprintIssue, formatIssue, loadWorkspace, type Workspace } from "../plugins/workspace.js";
import { explicitWorkspaceRoot, followRoots } from "./follow-roots.js";

/** Every tool's optional `workspace` input: a folder in the Workspace (or git worktree of it) the call is about. */
const WorkspaceInputSchema = z
  .string()
  .min(1)
  .optional()
  .describe(
    "The Workspace this call is about, when it isn't the one the session is in: its folder, a git worktree of it, or any folder inside either (such as a Mission's), absolute. The nearest folder at or above it that holds the Workspace config serves, so a Mission that exists only in a worktree is read and written there, not in the main checkout. Without it the session's working folder serves (the MCP roots), else the Workspace the server started with",
  );

/** A tool's reply: its text, and the structured result its output schema describes. */
export type Reply<S extends object | undefined = undefined> = { content: { type: "text"; text: string }[] } & (S extends object ? { structuredContent: S } : unknown);

/** A tool's refusal or failure: a reply the client reads as an error. */
export type Failure<S extends object | undefined = undefined> = Reply<S> & { isError: true };

/** A tool's reply as `reply` builds it. */
function replyOf(text: string, structuredContent?: object) {
  return { content: [{ type: "text" as const, text }], ...(structuredContent !== undefined ? { structuredContent } : {}) };
}

/** A tool's refusal or failure as `fail` builds it. */
function failOf(text: string, structuredContent?: object) {
  return { isError: true as const, ...replyOf(text, structuredContent) };
}

export type CallContext = {
  /** The machine and its Host Adapter. */
  readonly host: Host;
  /** The Workspace folder for this call. */
  root(): Promise<string>;
  /** The Workspace for this call, loaded fresh, so config edits apply on the next call. */
  workspace(): Promise<Workspace>;
  /** A reply of `text`, with the structured result when the tool has an output schema. */
  reply(text: string): Reply;
  reply<S extends object>(text: string, structuredContent: S): Reply<S>;
  /** A refusal or failure with the reason, and the structured result when the tool's output schema asks for one. */
  fail(text: string): Failure;
  fail<S extends object>(text: string, structuredContent: S): Failure<S>;
  /** A dressing or sync edit's reply when its result doesn't validate: nothing was saved. `said` follows the issues, such as sync's notes. */
  refused(
    blueprintPath: string,
    issues: readonly BlueprintIssue[],
    structured: Record<string, unknown>,
    said?: readonly string[],
  ): {
    isError: true;
    content: { type: "text"; text: string }[];
    structuredContent: Record<string, unknown>;
  };
};

/** What `withWorkspaceInput` set up on a server: the folder a call's own `workspace` input named, for the call alone. */
export type WorkspaceInput = { readonly explicitRoot: AsyncLocalStorage<string | undefined> };

type Handler = (...args: unknown[]) => unknown;
type ToolConfig = { inputSchema?: z.ZodRawShape };

/**
 * Gives every tool registered on `server` from now on an optional `workspace` input, and runs the
 * call with the folder it names (see the top of this file). It must be the first thing done to a
 * fresh server: a tool registered before it would silently lack the input, so it throws when the
 * server already has one. createCallContext takes the result, so no context exists without it.
 */
export function withWorkspaceInput(server: McpServer): WorkspaceInput {
  const registered = (server as unknown as { _registeredTools?: object })._registeredTools;
  if (registered === undefined || Object.keys(registered).length > 0) {
    throw new Error("withWorkspaceInput must run on a fresh server, before any tool is registered: a tool registered earlier would have no workspace input");
  }
  const explicitRoot = new AsyncLocalStorage<string | undefined>();
  const register = server.registerTool.bind(server) as unknown as (name: string, config: ToolConfig, handler: Handler) => unknown;
  server.registerTool = ((name: string, config: ToolConfig, handler: Handler) => {
    if (config.inputSchema && "workspace" in config.inputSchema) throw new Error(`${name} declares its own workspace input, which every tool takes from the server`);
    return register(name, { ...config, inputSchema: { ...config.inputSchema, workspace: WorkspaceInputSchema } }, async (...call: unknown[]) => {
      // The wrapper's schema gives every tool inputs, so the SDK calls each with (input, extra), a tool declared with none included.
      const [input, extra] = call;
      const { workspace, ...rest } = input as { workspace?: string };
      let folder: string | undefined;
      try {
        folder = workspace === undefined ? undefined : explicitWorkspaceRoot(workspace);
      } catch (error) {
        return failOf(error instanceof Error ? error.message : String(error));
      }
      return explicitRoot.run(folder, () => (config.inputSchema ? handler(rest, extra) : handler(extra)));
    });
  }) as unknown as typeof server.registerTool;
  return { explicitRoot };
}

export type CallContextOptions = {
  /** The folder holding the Workspace config. */
  readonly workspaceRoot: string;
  readonly following: boolean;
  readonly host: Host;
};

/** The context for `server`'s tool calls. `input` is what `withWorkspaceInput` gave the server. */
export function createCallContext(server: McpServer, { workspaceRoot, following, host }: CallContextOptions, { explicitRoot }: WorkspaceInput): CallContext {
  /** The Workspace folder for this call. */
  const sessionRoot: () => Promise<string> = following
    ? followRoots(server.server, workspaceRoot, {
        // Resources and prompts come from the Workspace's Plugins, so a client that cached their lists should ask again.
        onChange: () => {
          if (!server.isConnected()) return;
          server.sendResourceListChanged();
          server.sendPromptListChanged();
        },
      })
    : async () => workspaceRoot;
  const root = async (): Promise<string> => explicitRoot.getStore() ?? (await sessionRoot());

  return {
    host,
    root,
    workspace: async () => loadWorkspace(await root()),
    reply: replyOf as CallContext["reply"],
    fail: failOf as CallContext["fail"],
    refused: (blueprintPath, issues, structured, said = []) =>
      failOf([`Refused; ${blueprintPath} is unchanged:`, ...issues.map((issue) => `- ${formatIssue(issue)}`), ...said].join("\n"), { saved: false, notes: [], ...structured, issues: [...issues] }) as ReturnType<CallContext["refused"]>,
  };
}
