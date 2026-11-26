// The Still Review frame check (#124), on generated frames (tests/support/generated-frames.ts).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { checkFrames } from "../../src/capture/frame-check.js";
import { frame, ground, PLACES } from "../support/generated-frames.js";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

let groundImage: Buffer;
beforeAll(async () => {
  groundImage = await ground(7);
});

async function referenceFrames(folder: string): Promise<Map<number, string>> {
  const frames = new Map<number, string>();
  for (const [i, place] of PLACES.entries()) frames.set(i + 1, await frame(groundImage, place, path.join(folder, `ref-${i + 1}.jpg`)));
  return frames;
}

describe("checkFrames", () => {
  it("passes frames of their own place, and calls a frame of another Shot's place wrong", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-frame-check-"));
    folders.push(folder);
    const reference = await referenceFrames(folder);
    // Shot 1 is its own place, a little off; Shot 2 shows Shot 3's place; Shot 4 shows Shot 5's, shifted a little.
    const checks = await checkFrames(reference, [
      { shot: 1, file: await frame(groundImage, [12, 8], path.join(folder, "1.jpg")) },
      { shot: 2, file: await frame(groundImage, PLACES[2], path.join(folder, "2.jpg")) },
      { shot: 4, file: await frame(groundImage, [790, 910], path.join(folder, "4.jpg")) },
    ]);
    expect(checks.map(({ shot, status }) => ({ shot, status }))).toEqual([
      { shot: 1, status: "ok" },
      { shot: 2, status: "wrong" },
      { shot: 4, status: "wrong" },
    ]);
    expect(checks[1]!.match?.shot).toBe(3);
    expect(checks[2]!.match?.shot).toBe(5);
  });

  it("doesn't call a recoloured or repainted frame of the right place wrong", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-frame-check-"));
    folders.push(folder);
    const reference = await referenceFrames(folder);
    const repainted = await ground(99);
    const checks = await checkFrames(reference, [
      // Darker, warmer light on the same ground.
      { shot: 1, file: await frame(groundImage, PLACES[0], path.join(folder, "1.jpg"), (image) => image.modulate({ brightness: 0.7, hue: 40, saturation: 1.4 })) },
      // The ground under Shot 2 painted afresh: nothing matches it.
      { shot: 2, file: await frame(repainted, PLACES[1], path.join(folder, "2.jpg")) },
    ]);
    expect(checks.map(({ shot, status }) => ({ shot, status }))).toEqual([
      { shot: 1, status: "ok" },
      { shot: 2, status: "unconfirmed" },
    ]);
  });

  it("can't confirm a frame whose Shot the reference lacks, unless it matches another Shot", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-frame-check-"));
    folders.push(folder);
    const reference = await referenceFrames(folder);
    reference.delete(1);
    reference.delete(2);
    const checks = await checkFrames(reference, [
      { shot: 1, file: await frame(groundImage, PLACES[0], path.join(folder, "1.jpg")) },
      { shot: 2, file: await frame(groundImage, PLACES[3], path.join(folder, "2.jpg")) },
    ]);
    expect(checks.map(({ shot, status }) => ({ shot, status }))).toEqual([
      { shot: 1, status: "unconfirmed" },
      { shot: 2, status: "wrong" },
    ]);
  });
});
