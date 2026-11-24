// Every tool's MCP hints, and the groups the server registers its tools in (#976): the generated
// reference reads its "writes to your Workspace" flag from the hints, and groups tools by TOOL_GROUPS.
import { describe, expect, it } from "vitest";

import { TOOL_GROUPS } from "../../src/mcp/server.js";
import { everyTool, listTools } from "./harness.js";

describe("tool annotations", () => {
  it("give every tool both readOnlyHint and destructiveHint", async () => {
    for (const tool of await listTools(everyTool)) {
      expect(typeof tool.annotations?.readOnlyHint, `${tool.name}'s readOnlyHint`).toBe("boolean");
      expect(typeof tool.annotations?.destructiveHint, `${tool.name}'s destructiveHint`).toBe("boolean");
    }
  });

  it("never mark a read-only tool destructive", async () => {
    const both = (await listTools(everyTool)).filter((tool) => tool.annotations?.readOnlyHint && tool.annotations.destructiveHint);
    expect(both.map((tool) => tool.name)).toEqual([]);
  });
});

describe("the tool groups", () => {
  it("hold every listed tool exactly once, and only listed tools", async () => {
    const listed = (await listTools(everyTool)).map((tool) => tool.name);
    const grouped = Object.values(TOOL_GROUPS).flat();
    for (const name of listed) expect(grouped.filter((other) => other === name), `${name}'s groups`).toHaveLength(1);
    expect([...grouped].sort()).toEqual([...listed].sort());
  });

  it("are the server's six register functions", () => {
    expect(Object.keys(TOOL_GROUPS).sort()).toEqual(["blueprint", "capture", "catalog", "compile", "session", "stylePack"]);
  });
});
