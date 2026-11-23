// A set's card pictures made again from its look's records (capture/set-cards.ts), with a stand-in
// for Blender: views and captures are copied, shots are drawn together when they share their
// options, and a picture whose record hasn't changed isn't made again.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { drawSetCards } from "../../src/capture/set-cards.js";
import type { SetShotsRequest, SetShotsResult } from "../../src/capture/set-views.js";
import { parseSetLooks } from "../../src/cutscene/set-looks.js";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

/** A drawn set's folder with a plan, two camera frames and one in-game capture beside it. */
async function drawnSet(): Promise<{ setDir: string; capturesDir: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "set-cards-"));
  folders.push(root);
  const setDir = path.join(root, "views", "control-room");
  const capturesDir = path.join(root, "captures", "control-room");
  await mkdir(setDir, { recursive: true });
  await mkdir(capturesDir, { recursive: true });
  await writeFile(path.join(setDir, "views.json"), JSON.stringify({ cameras: ["Wide", "Console Close"] }));
  for (const name of ["plan", "cam-01", "cam-02"]) await writeFile(path.join(setDir, `${name}.jpg`), name);
  await writeFile(path.join(capturesDir, "03-looking-north.jpg"), "capture");
  return { setDir, capturesDir };
}

/** Writes each shot's pictures as its request in text, and keeps the requests. */
function fakeBlender() {
  const requests: SetShotsRequest[] = [];
  const shoot = async (request: SetShotsRequest): Promise<SetShotsResult> => {
    requests.push(request);
    await mkdir(request.outDir!, { recursive: true });
    for (const shot of request.shots) {
      const names = "compass" in shot ? ["north", "east", "south", "west"].map((way) => `${shot.name}-${way}`) : [shot.name];
      for (const name of names) await writeFile(path.join(request.outDir!, `${name}.jpg`), JSON.stringify({ name, shot, cutZ: request.cutZ, floor: request.floor, only: request.only?.source }));
    }
    return { files: [], pictures: [], min: [], max: [], floor: 0, levels: [], ceilings: [], cutZ: 0, models: [] };
  };
  return { shoot, requests };
}

const look = (pictures: unknown[]) =>
  parseSetLooks({
    "control-room": { kind: "room", look: "A small round room about 6 cells across with a console in the middle.", facets: ["interior", "round", "small"], standsInFor: [], basis: "Its pictures.", confidence: "high", problems: [], pictures },
  })["control-room"]!;

describe("drawSetCards", () => {
  it("copies views and captures, and draws shots that share their options in one go", async () => {
    const { setDir, capturesDir } = await drawnSet();
    const { shoot, requests } = fakeBlender();
    const result = await drawSetCards({
      setDir,
      capturesDir,
      blender: "blender",
      shoot,
      look: look([
        { file: "card/1.jpg", shows: "from above", from: { orbit: [135, 45], cut: 9.5, without: "Box" } },
        { file: "card/2.jpg", shows: "the plan", from: { view: "plan" } },
        { file: "card/3.jpg", shows: "the console", from: { camera: "Console Close" } },
        { file: "card/4.jpg", shows: "in the game", from: { capture: "03-looking-north.jpg" } },
        { file: "card/5.jpg", shows: "looking east", from: { compass: 1.2, at: [1, 0], way: "east", floor: 8 } },
        { file: "card/6.jpg", shows: "straight down", from: { plan: true, cut: 9.5, without: "Box" } },
      ]),
    });
    expect(result).toEqual({ made: ["card/2.jpg", "card/3.jpg", "card/4.jpg", "card/1.jpg", "card/6.jpg", "card/5.jpg"], kept: [], missing: [] });
    const read = (file: string) => readFile(path.join(setDir, file), "utf8");
    expect([await read("card/2.jpg"), await read("card/3.jpg"), await read("card/4.jpg")]).toEqual(["plan", "cam-02", "capture"]);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ cutZ: 9.5, shots: [{ orbit: [135, 45], cut: true }, { plan: true, cut: true }] });
    expect(requests[0]!.without?.source).toBe("Box");
    expect(requests[1]).toMatchObject({ floor: 8, shots: [{ compass: 1.2, at: [1, 0] }] });
    expect(JSON.parse(await read("card/5.jpg"))).toMatchObject({ name: "card-0-east", floor: 8 });
    expect(JSON.parse(await read("card/1.jpg"))).toMatchObject({ shot: { orbit: [135, 45] }, cutZ: 9.5 });
  });

  it("keeps a picture whose record hasn't changed, and makes one again when it has or its file is gone", async () => {
    const { setDir } = await drawnSet();
    const { shoot, requests } = fakeBlender();
    const pictures = [
      { file: "card/1.jpg", shows: "from above", from: { orbit: [135, 45] } },
      { file: "card/2.jpg", shows: "the plan", from: { view: "plan" } },
    ];
    await drawSetCards({ setDir, blender: "blender", shoot, look: look(pictures) });
    expect(await drawSetCards({ setDir, blender: "blender", shoot, look: look(pictures) })).toEqual({ made: [], kept: ["card/1.jpg", "card/2.jpg"], missing: [] });
    expect(requests).toHaveLength(1);

    await rm(path.join(setDir, "card/2.jpg"));
    const turned = [{ ...pictures[0]!, from: { orbit: [200, 45] } }, pictures[1]!];
    expect(await drawSetCards({ setDir, blender: "blender", shoot, look: look(turned) })).toEqual({ made: ["card/2.jpg", "card/1.jpg"], kept: [], missing: [] });
    expect(requests).toHaveLength(2);
  });

  it("makes the cards again when the set is drawn again, and takes a camera by its frame where two share a name", async () => {
    const { setDir } = await drawnSet();
    await writeFile(path.join(setDir, "views.json"), JSON.stringify({ cameras: ["Wide", "Wide"] }));
    const { shoot } = fakeBlender();
    const pictures = [
      { file: "card/1.jpg", shows: "the second wide", from: { camera: "Wide", frame: 2 } },
      { file: "card/2.jpg", shows: "the first wide", from: { camera: "Wide" } },
    ];
    await drawSetCards({ setDir, blender: "blender", shoot, look: look(pictures) });
    const read = (file: string) => readFile(path.join(setDir, file), "utf8");
    expect([await read("card/1.jpg"), await read("card/2.jpg")]).toEqual(["cam-02", "cam-01"]);

    await writeFile(path.join(setDir, "cam-02.jpg"), "cam-02 drawn again");
    await writeFile(path.join(setDir, "spec.json"), JSON.stringify({ pieces: [{ model: "NewWall" }] }));
    expect((await drawSetCards({ setDir, blender: "blender", shoot, look: look(pictures) })).made).toEqual(["card/1.jpg", "card/2.jpg"]);
    expect(await read("card/1.jpg")).toBe("cam-02 drawn again");
  });

  it("takes away a picture made from another record when the one the look names now can't be made", async () => {
    const { setDir } = await drawnSet();
    const { shoot } = fakeBlender();
    await drawSetCards({ setDir, blender: "blender", shoot, look: look([{ file: "card/1.jpg", shows: "the plan", from: { view: "plan" } }]) });
    const result = await drawSetCards({ setDir, blender: "blender", shoot, look: look([{ file: "card/1.jpg", shows: "in the game", from: { capture: "03-looking-north.jpg" } }]) });
    expect(result.missing.map((entry) => entry.file)).toEqual(["card/1.jpg"]);
    await expect(readFile(path.join(setDir, "card/1.jpg"))).rejects.toThrow(/ENOENT/);
  });

  it("says why a picture can't be made, and leaves one made earlier as it is", async () => {
    const { setDir } = await drawnSet();
    await mkdir(path.join(setDir, "card"));
    await writeFile(path.join(setDir, "card/2.jpg"), "chosen on this machine before records were kept");
    const result = await drawSetCards({
      setDir,
      blender: "blender",
      shoot: () => Promise.reject(new Error("Blender isn't installed\nat spawn")),
      look: look([
        { file: "card/1.jpg", shows: "in the game", from: { capture: "03-looking-north.jpg" } },
        { file: "card/2.jpg", shows: "old", from: { camera: "Gone" } },
        { file: "card/3.jpg", shows: "no record" },
        { file: "card/4.jpg", shows: "a shot", from: { eye: [0, 0, 2], target: [1, 0, 2] } },
      ]),
    });
    expect(result.made).toEqual([]);
    expect(result.missing).toEqual([
      { file: "card/3.jpg", why: "the look doesn't record where it comes from" },
      { file: "card/1.jpg", why: "an in-game capture, which this machine doesn't have (capture-sets makes them)" },
      { file: "card/2.jpg", why: "the set has no camera called Gone" },
      { file: "card/4.jpg", why: "the shot couldn't be drawn: Blender isn't installed" },
    ]);
    expect(await readFile(path.join(setDir, "card/2.jpg"), "utf8")).toMatch(/chosen on this machine/);
  });

  it("copies each picture's in-game counterpart beside it, and takes one the look no longer names away", async () => {
    const { setDir } = await drawnSet();
    const gameDir = path.join(path.dirname(path.dirname(setDir)), "game", "control-room");
    await mkdir(gameDir, { recursive: true });
    await writeFile(path.join(gameDir, "card-1.jpg"), "in game");
    const game = { capture: "card-1.jpg", lighting: "closest shot: shot \"Wide\", 2 lamps, RoomLight" };
    const first = await drawSetCards({ setDir, gameDir, blender: "blender", look: look([{ file: "card/1.jpg", shows: "the room", from: { view: "plan" }, game }]) });
    expect(first.made).toEqual(["card/1-game.jpg", "card/1.jpg"]);
    expect(await readFile(path.join(setDir, "card/1-game.jpg"), "utf8")).toBe("in game");

    const again = await drawSetCards({ setDir, gameDir, blender: "blender", look: look([{ file: "card/1.jpg", shows: "the room", from: { view: "plan" }, game }]) });
    expect(again.kept).toEqual(["card/1.jpg", "card/1-game.jpg"]);

    // Without the frames, a counterpart is missing; once the look drops it, it goes.
    const elsewhere = await drawSetCards({ setDir: setDir, blender: "blender", force: true, look: look([{ file: "card/1.jpg", shows: "the room", from: { view: "plan" }, game }]) });
    expect(elsewhere.missing.map((entry) => entry.file)).toEqual(["card/1-game.jpg"]);
    expect(await readFile(path.join(setDir, "card/1-game.jpg"), "utf8")).toBe("in game");
    await drawSetCards({ setDir, blender: "blender", look: look([{ file: "card/1.jpg", shows: "the room", from: { view: "plan" } }]) });
    await expect(readFile(path.join(setDir, "card/1-game.jpg"))).rejects.toThrow(/ENOENT/);
  });
});
