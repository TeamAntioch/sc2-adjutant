// The numbered workers the Host Adapters run WhiteoutFlakes in (a HOME on macOS, a copy of the
// viewer's folder on Windows): concurrent runs never share one, and a free one is reused.
import { describe, expect, it } from "vitest";

import { WorkerPool } from "../../src/host/whiteoutflakes.js";

describe("the worker pool", () => {
  it("gives concurrent runs their own workers and reuses a free one", async () => {
    const pool = new WorkerPool();
    const seen: number[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const first = pool.use(async (index) => {
      seen.push(index);
      await held;
    });
    await pool.use(async (index) => void seen.push(index));
    release();
    await first;
    await pool.use(async (index) => void seen.push(index));
    expect(seen[0]).not.toBe(seen[1]);
    expect([seen[0], seen[1]]).toContain(seen[2]);
  });

  it("frees a worker whose run failed", async () => {
    const pool = new WorkerPool();
    await expect(pool.use(async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await pool.use(async (index) => index)).toBe(0);
  });
});
