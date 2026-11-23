// stdout carries the MCP protocol, so the whole console writes to stderr: whatever core or a
// Plugin logs, at any level. main.ts imports this module first, so the redirect is in place
// before any other module is evaluated.

import { Console } from "node:console";

globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
