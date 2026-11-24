// How a tool group (tools/*.ts) registers its tools (#976). Each group exports the names of the
// tools it registers, which the generated reference groups tools by, and registers through
// `toolGroup`, which takes only those names: a tool missing from its group's list doesn't compile.
// It also makes every tool give its MCP hints, readOnlyHint and destructiveHint, which the
// reference's "writes to your Workspace" flag and every MCP client read.

import type { McpServer, RegisteredTool, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AnySchema, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import type { HostCapabilityName } from "../../plugins/plugin-api.js";

/** A tool's two hints. A read-only tool is never destructive. */
export type ToolHints = { readonly readOnlyHint: true; readonly destructiveHint: false } | { readonly readOnlyHint: false; readonly destructiveHint: boolean };

/** Writes nothing to the Workspace or the disk, beyond the machine's caches. */
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false } as const satisfies ToolHints;
/** Writes only new files, or adds to files without changing what they hold. */
export const ADDITIVE = { readOnlyHint: false, destructiveHint: false } as const satisfies ToolHints;
/** May overwrite or remove what the author's files hold: a Blueprint edited in place, a Map Package compiled over. */
export const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const satisfies ToolHints;

/**
 * A group's tools that are listed on every machine, so an agent on one that can't run them hears
 * why, and refused where the Host Adapter lacks these capabilities. A tool listed only on a capable
 * host needs no entry: the reference finds what it needs from the listing.
 */
export type RefusedWithout<N extends string> = { readonly [Name in N]?: readonly HostCapabilityName[] };

/** `server.registerTool` for one group's tools: `name` is one of the group's, and the hints are required. */
export type GroupRegistrar<N extends string> = <OutputArgs extends ZodRawShapeCompat | AnySchema, InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined>(
  name: N,
  config: {
    title?: string;
    description?: string;
    inputSchema?: InputArgs;
    outputSchema?: OutputArgs;
    annotations: ToolAnnotations & ToolHints;
  },
  cb: ToolCallback<InputArgs>,
) => RegisteredTool;

/** Registers the tools named in `names` on `server`. */
export function toolGroup<N extends string>(server: McpServer, names: readonly N[]): GroupRegistrar<N> {
  return (name, config, cb) => {
    // The type keeps other names out; this keeps out a cast that slipped one past it.
    if (!names.includes(name)) throw new Error(`${name} isn't in its group's tool names (${names.join(", ")})`);
    return server.registerTool(name, config, cb);
  };
}
