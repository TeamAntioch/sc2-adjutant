// The tool list the MCP server serves, snapshotted whole: every tool's name, title, description,
// input and output JSON Schemas and annotations. Moving a tool between modules must not change any
// of it, so drift fails here. Sorted by name, since the order tools are registered in is no part of
// the contract. The snapshot is taken with a Host that has every capability and both Doodad Finder
// tools, and the Set Finder's, so every conditionally listed tool is in it, and again on a bare machine.
import { describe, expect, it } from "vitest";

import { everyTool, listTools } from "./harness.js";

describe("the tool list", () => {
  it("is the same on a machine that can do everything, with both Doodad Finder tools", async () => {
    expect(await listTools(everyTool)).toMatchSnapshot();
  });

  it("is the same on a bare machine", async () => {
    expect(await listTools({})).toMatchSnapshot();
  });
});
