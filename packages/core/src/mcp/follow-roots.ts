// Lets the server follow the session's working folder. An MCP client lists the folders it works in
// (`roots/list`); Claude Code puts the session's working folder first and moves it when the
// session enters or leaves a git worktree, without sending `roots/list_changed`. So the server
// asks at each call, and serves the Workspace at or above that folder.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { WORKSPACE_FILE } from "../plugins/workspace.js";

/** How long to wait for the client's roots before serving the Workspace it last had. */
const ROOTS_TIMEOUT_MS = 2000;

/** The nearest folder at or above `start` holding a Workspace config, or undefined when there is none. */
export function findWorkspaceRoot(start: string): string | undefined {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, WORKSPACE_FILE))) return dir;
    if (path.dirname(dir) === dir) return undefined;
  }
}

/**
 * The Workspace folder a tool call's `workspace` input names: the Workspace at or above it, so a
 * folder inside a git worktree of a Workspace (or a Mission's folder) serves that worktree. It
 * fails, naming the folder, when no Workspace is at or above it.
 */
export function explicitWorkspaceRoot(folder: string): string {
  // A relative folder would resolve against the server's own folder, not the session's.
  if (!path.isAbsolute(folder)) throw new Error(`workspace must be an absolute path, but got ${folder}.`);
  const resolved = path.resolve(folder);
  const found = findWorkspaceRoot(resolved);
  if (!found) throw new Error(`${resolved} isn't in a Workspace: no ${WORKSPACE_FILE} in it or any folder above it. Pass the Workspace's folder (or a git worktree of it, or a folder inside one) as workspace.`);
  return found;
}

export type FollowRootsOptions = {
  /** Called with the new Workspace folder when a call resolves to a different one than the call before. */
  readonly onChange?: (workspaceRoot: string) => void;
  readonly timeoutMs?: number;
};

/**
 * A function giving the Workspace folder to serve now. It is the one at or above the client's
 * first root, the session's working folder, so `fallback` (the Workspace the server started with)
 * serves when no root has a Workspace above it, and also when the client lists no roots.
 * When the client doesn't answer, the Workspace of the last call serves, so a hiccup never moves a
 * write to another Workspace.
 */
export function followRoots(server: Server, fallback: string, { onChange, timeoutMs = ROOTS_TIMEOUT_MS }: FollowRootsOptions = {}): () => Promise<string> {
  let last = path.resolve(fallback);
  return async () => {
    let resolved: string;
    if (!server.getClientCapabilities()?.roots) {
      resolved = path.resolve(fallback);
    } else {
      let uris: string[];
      try {
        uris = (await server.listRoots(undefined, { timeout: timeoutMs })).roots.map((root) => root.uri);
      } catch {
        return last;
      }
      const first = uris.find((uri) => uri.startsWith("file:"));
      resolved = (first && findWorkspaceRoot(fileURLToPath(first))) ?? path.resolve(fallback);
    }
    if (resolved !== last) {
      last = resolved;
      onChange?.(resolved);
    }
    return resolved;
  };
}
