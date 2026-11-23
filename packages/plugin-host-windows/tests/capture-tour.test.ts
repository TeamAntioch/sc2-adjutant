// The capture tour's world on Windows: a helper that fails for a moment neither ends the tour nor
// loses the bank, and one that keeps failing ends it rather than watch forever.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { CaptureTourRequest } from "@team-antioch/sc2-adjutant/plugin-sdk";
import { afterEach, describe, expect, it } from "vitest";

import { gameWorld, WATCH_FAILED_CHECKS } from "../capture-tour.ts";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A world whose helpers can't run: every game check fails. */
async function brokenWorld(leftover?: string) {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-tour-"));
  folders.push(folder);
  const lines: string[] = [];
  const missing = path.join(folder, "no-such-helper.exe");
  const bank = path.join(folder, "Tour.SC2Bank");
  const request = { outputDir: folder, quality: 90, width: 1280 } as unknown as CaptureTourRequest;
  return { world: gameWorld(request, { exe: missing }, missing, bank, leftover, (line) => lines.push(line)), bank, lines };
}

describe("the capture tour's world", () => {
  it("takes the game as still running while its check fails, warning once, and gives up after so many in a row", async () => {
    const { world, lines } = await brokenWorld();
    for (let check = 1; check < WATCH_FAILED_CHECKS; check++) expect(await world.gameRunning()).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^couldn't tell whether the game is still running: /);
    await expect(world.gameRunning()).rejects.toThrow(`(${WATCH_FAILED_CHECKS} checks in a row)`);
  });

  it("keeps the bank as last read when a read fails, and the leftover until then", async () => {
    const { world, bank, lines } = await brokenWorld("leftover");
    expect(await world.readBank()).toBe("");
    // A folder in the bank's place can't be read as a file.
    await mkdir(bank);
    expect(await world.readBank()).toBe("");
    expect(lines.some((line) => line.startsWith("couldn't read the bank: "))).toBe(true);
    const kept = await brokenWorld("leftover");
    await mkdir(kept.bank);
    expect(await kept.world.readBank()).toBe("leftover");
  });
});
