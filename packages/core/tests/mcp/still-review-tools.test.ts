// The Still Review tools (#124) over MCP: shots_for_zones, build_still_review and
// record_still_feedback, on the `field` Workspace's Lava Field (two 32×64 Zones side by side) with
// a synthetic 64×64 MapInfo and generated capture folders (tests/support/generated-frames.ts).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { writeMapInfo } from "../../src/terrain/write-map-info.js";
import { frame, ground, PLACES } from "../support/generated-frames.js";
import { connect, copyOf, text } from "./harness.js";

async function setup() {
  const root = await copyOf("field");
  const missionDir = path.join(root, "missions", "lava-field");
  const mapPackage = path.join(missionDir, "Lava-Field.SC2Map");
  await mkdir(mapPackage, { recursive: true });
  await writeFile(path.join(mapPackage, "MapInfo"), writeMapInfo({ width: 64, height: 64, tilesetId: "Shakuras", fogType: "Dark", playableBounds: [0, 0, 64, 64], players: [] }));
  return { root, missionDir, client: await connect(root) };
}

/** A capture_shots folder of these Shots, frame i showing place `places[i]`. */
async function capture(dir: string, shots: readonly { rect: readonly number[]; label: string }[], places: readonly number[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  const groundImage = await ground(7);
  const listed = [];
  for (const [i, shot] of shots.entries()) {
    const name = `${String(i + 1).padStart(2, "0")}-${shot.label}.jpg`;
    await frame(groundImage, PLACES[places[i]! - 1]!, path.join(dir, name));
    listed.push({ shot: i + 1, frame: name, rect: shot.rect, pitch: 75, yaw: 0, label: shot.label, camera: {}, whole: true });
  }
  await writeFile(path.join(dir, "shots.json"), JSON.stringify({ map: "Lava-Field.SC2Map", end: "done", shots: listed }));
}

describe("the Still Review tools", () => {
  it("picks a set's Shots from Zones, builds a round from captures of them, and records the page's feedback", async () => {
    const { root, missionDir, client } = await setup();

    const picked = await client.callTool({ name: "shots_for_zones", arguments: { mission: "lava-field", zones: ["field", "cave"], set: "ground" } });
    expect(picked.isError).toBeFalsy();
    const { file, shots } = picked.structuredContent as { file: string; shots: { rect: number[]; label: string }[] };
    expect(file).toBe(path.join(missionDir, "output", "stills", "ground", "shots.json"));
    // Each Zone's Shot sits midway along it.
    expect(shots).toEqual([
      { rect: [1, 23.5, 31, 40.5], label: "field" },
      { rect: [33, 23.5, 63, 40.5], label: "cave" },
    ]);

    const before = path.join(missionDir, "output", "shots", "before");
    const after = path.join(missionDir, "output", "shots", "after");
    await capture(before, shots, [1, 2]);
    await capture(after, shots, [1, 1]);
    const built = await client.callTool({
      name: "build_still_review",
      arguments: {
        mission: "lava-field",
        set: "ground",
        round: "r1",
        versions: [
          { label: "before", captures: [path.relative(root, before)] },
          { label: "after", note: "new washes", captures: [after] },
        ],
      },
    });
    expect(built.isError).toBeFalsy();
    const roundDir = path.join(missionDir, "output", "stills", "ground", "r1");
    expect(built.structuredContent).toMatchObject({
      roundDir,
      page: path.join(roundDir, "index.html"),
      problems: [{ shot: 2, label: "cave", version: "after", status: "wrong", shows: 1 }],
      retakes: [{ version: "after", shots: [{ rect: [33, 23.5, 63, 40.5], pitch: 75, yaw: 0, label: "cave" }] }],
    });
    expect(text(built)).toContain("after: Shot 2 (cave) shows Shot 1 (field)'s place");

    const recorded = await client.callTool({
      name: "record_still_feedback",
      arguments: { round: roundDir, rows: [{ path: "shots/1", data: { best: "after", tags: ["good"], note: "" } }, { path: "review/status", data: { done: true } }] },
    });
    expect(recorded.isError).toBeFalsy();
    expect(recorded.structuredContent).toEqual({ files: [path.join(roundDir, "feedback.json"), path.join(roundDir, "feedback.md")], done: true, shots: 1 });
    expect(JSON.parse(await readFile(path.join(roundDir, "feedback.json"), "utf8")).shots).toEqual([{ shot: 1, label: "field", best: "after", tags: ["good"], note: "" }]);
  });

  it("refuses a capture folder outside the Workspace and the machine's cache", async () => {
    const { client } = await setup();
    const reply = await client.callTool({ name: "build_still_review", arguments: { mission: "lava-field", set: "ground", round: "r1", versions: [{ label: "before", captures: ["/elsewhere/shots"] }] } });
    expect(reply.isError).toBe(true);
    expect(text(reply)).toMatch(/capture folder \/elsewhere\/shots must be inside the Workspace/);
  });
});
