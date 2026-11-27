// paint_region (#136, ADR-0028): adds or edits a Paint Region in a Mission's Blueprint, its outline
// from a Zone, a rectangle of cells or a box on a Still Review frame, turned into cells through the
// Shot's camera. The mix is checked against the region's texture set before anything is written.
// The field Workspace's Mission is a 64×64 generated map: Field west of x 32, Cave east of it, both
// on the map's textures (set 0: KorhalCityEx2_1, …).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { connect, copyOf, text } from "./harness.js";

const blueprintFile = (root: string) => path.join(root, "missions", "lava-field", "blueprint.json");
const stored = async (root: string) => JSON.parse(await readFile(blueprintFile(root), "utf8"));
const MIX = [{ texture: "KorhalCityEx2_3", weight: 0.15 }, { texture: "KorhalCityEx2_2" }];

describe("paint_region", () => {
  it("adds a region over a Zone, which follows the Zone", async () => {
    const root = await copyOf("field");
    const client = await connect(root);
    const reply = await client.callTool({ name: "paint_region", arguments: { mission: "lava-field", id: "worn", zone: "cave", mix: MIX } });
    expect(reply.isError).toBeFalsy();
    expect(text(reply)).toContain("Added Paint Region worn over Zone cave.");
    expect((await stored(root)).paintRegions).toEqual([{ id: "worn", zone: "cave", mix: MIX }]);
  });

  it("adds a region over a rectangle of cells, then edits its mix and falloff and keeps its outline", async () => {
    const root = await copyOf("field");
    const client = await connect(root);
    const added = await client.callTool({ name: "paint_region", arguments: { mission: "lava-field", id: "wall", rect: [4, 10, 12, 30], mix: MIX, falloff: 1 } });
    expect(added.isError).toBeFalsy();
    const rect = [{ x: 4, y: 10 }, { x: 12, y: 10 }, { x: 12, y: 30 }, { x: 4, y: 30 }];
    expect((await stored(root)).paintRegions).toEqual([{ id: "wall", polygon: rect, mix: MIX, falloff: 1 }]);

    const mix = [{ texture: "KorhalCityEx2_3", share: 0.3 }];
    const edited = await client.callTool({ name: "paint_region", arguments: { mission: "lava-field", id: "wall", mix, falloff: null, levels: [1] } });
    expect(edited.isError).toBeFalsy();
    expect(edited.structuredContent).toEqual({ saved: true, notes: ["Updated Paint Region wall: its mix replaced; its falloff back to the default; levels 1."], issues: [] });
    expect((await stored(root)).paintRegions).toEqual([{ id: "wall", polygon: rect, mix, levels: [1] }]);
  });

  it("turns a box on a Still Review frame into cells through its Shot's camera, clipped to the map", async () => {
    const root = await copyOf("field");
    const capture = path.join(root, "missions", "lava-field", "output", "shots", "review");
    await mkdir(capture, { recursive: true });
    // Looking straight down on (20, 50) from 40 cells: the frame spans 17.6 cells each side across and 9.9 up and down.
    const camera = { target: [20, 50], distance: 40, pitch: 90, yawOffset: 0, fov: 27.7995 };
    const shot = { shot: 1, frame: "01-ridge.jpg", rect: [10, 45, 30, 55], pitch: 90, yaw: 0, label: "ridge", camera, whole: true };
    await writeFile(path.join(capture, "shots.json"), JSON.stringify({ mission: "lava-field", shots: [shot, { ...shot, shot: 2, frame: "02.jpg", label: undefined, camera: { ...camera, target: [5, 50] } }] }));
    const client = await connect(root);

    // The frame's top-left quarter: x 2.4 to 20, y 50 to 59.9.
    const reply = await client.callTool({ name: "paint_region", arguments: { mission: "lava-field", id: "ridge", frame: { capture: "review", shot: "ridge", box: [0, 0, 0.5, 0.5] }, mix: MIX } });
    expect(reply.isError).toBeFalsy();
    expect((await stored(root)).paintRegions[0].polygon).toEqual([{ x: 2.4, y: 59.9 }, { x: 20, y: 59.9 }, { x: 20, y: 50 }, { x: 2.4, y: 50 }]);
    expect(text(reply)).toContain("Added Paint Region ridge over the box on shot 1 (ridge)'s frame, through its camera: (2.4, 59.9), (20, 59.9), (20, 50), (2.4, 50).");

    // Shot 2, on (5, 50), reaches past the map's west edge (5 - 17.6 < 0): its whole frame is cut at x 0.
    const whole = await client.callTool({ name: "paint_region", arguments: { mission: "lava-field", id: "ridge", frame: { capture: "review", shot: 2, box: [0, 0, 1, 1] } } });
    expect(whole.isError).toBeFalsy();
    expect((await stored(root)).paintRegions[0].polygon).toEqual([{ x: 0, y: 59.9 }, { x: 22.6, y: 59.9 }, { x: 22.6, y: 40.1 }, { x: 0, y: 40.1 }]);

    const missing = await client.callTool({ name: "paint_region", arguments: { mission: "lava-field", id: "ridge", frame: { capture: "review", shot: 4, box: [0, 0, 1, 1] } } });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain("has no Shot 4: its Shots are 1 (ridge), 2");
  });

  it("checks the mix before writing, and refuses a new region without an outline or a mix", async () => {
    const root = await copyOf("field");
    const before = await readFile(blueprintFile(root), "utf8");
    const client = await connect(root);
    const wrong = await client.callTool({ name: "paint_region", arguments: { mission: "lava-field", id: "worn", zone: "cave", mix: [{ texture: "AiurRock", weight: 0.2 }] } });
    expect(wrong.isError).toBe(true);
    expect(text(wrong)).toContain("paintRegions.0.mix.0.texture: Paint Region worn paints cells on the map's textures (set 0), which don't hold AiurRock: KorhalCityEx2_1");
    const over = await client.callTool({ name: "paint_region", arguments: { mission: "lava-field", id: "worn", zone: "cave", mix: [{ texture: "KorhalCityEx2_3", weight: 0.7 }, { texture: "KorhalCityEx2_2", share: 0.5 }] } });
    expect(text(over)).toContain("add up to 1.2");
    const bare = await client.callTool({ name: "paint_region", arguments: { mission: "lava-field", id: "worn", zone: "cave" } });
    expect(text(bare)).toContain("There's no Paint Region worn yet: give it a mix");
    const both = await client.callTool({ name: "paint_region", arguments: { mission: "lava-field", id: "worn", zone: "cave", rect: [0, 0, 4, 4], mix: MIX } });
    expect(text(both)).toContain("Give a Paint Region's outline one way: zone, rect or frame");
    expect(await readFile(blueprintFile(root), "utf8")).toBe(before);
  });
});
