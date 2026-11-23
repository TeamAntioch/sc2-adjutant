// Blizzard's frames are read once for a long-running server's every check, but a read that fails
// isn't kept: the next check reads the snapshot again, rather than saying frame paths weren't checked.
import type * as fs from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

const failNext = vi.hoisted(() => ({ reads: 0 }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof fs>();
  return {
    ...actual,
    readFile: ((...args: Parameters<typeof actual.readFile>) => {
      if (failNext.reads > 0 && String(args[0]).endsWith("ui-frame-paths.json")) {
        failNext.reads -= 1;
        return Promise.reject(new Error("EMFILE: too many open files"));
      }
      return actual.readFile(...args);
    }) as typeof actual.readFile,
  };
});

const { bundledFrameSnapshot } = await import("../../src/ui/frame-path-check.js");

describe("bundledFrameSnapshot", () => {
  it("reads the snapshot again after a read that failed, and keeps one that read", async () => {
    failNext.reads = 1;
    await expect(bundledFrameSnapshot()).rejects.toThrow(/EMFILE/);
    const snapshot = await bundledFrameSnapshot();
    expect(Object.keys(snapshot)).toContain("GameUI");
    failNext.reads = 1;
    expect(await bundledFrameSnapshot()).toBe(snapshot);
  });
});
