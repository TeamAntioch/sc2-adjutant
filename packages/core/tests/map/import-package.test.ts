// Import's shared cleanup: every undo step runs even after one fails, and the failure that called
// for them is the one given back.
import { describe, expect, it } from "vitest";

import { undoing } from "../../src/map/import-package.js";

describe("undoing", () => {
  it("runs every step and gives back the first failure as it was", async () => {
    const failure = new Error("the config is read-only");
    const ran: string[] = [];
    const result = await undoing(failure, async () => void ran.push("attributes"), async () => void ran.push("folder"));
    expect(result).toBe(failure);
    expect(ran).toEqual(["attributes", "folder"]);
  });

  it("still runs the other steps when one fails, and names what couldn't be undone", async () => {
    const failure = new Error("the config is read-only");
    let removed = false;
    const result = await undoing(
      failure,
      async () => {
        throw new Error(".gitattributes is locked");
      },
      async () => {
        removed = true;
      },
    );
    expect(removed).toBe(true);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("the config is read-only (and it couldn't be undone: .gitattributes is locked)");
    expect((result as Error).cause).toBe(failure);
  });
});
