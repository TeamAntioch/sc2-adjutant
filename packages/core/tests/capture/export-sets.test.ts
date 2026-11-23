// The public sets (capture/export-sets.ts): only sets whose every file is Blizzard's leave, with
// their looks, card facts and resized pictures; a second export changes nothing.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { publicSets, publishedDrift, publishedFiles, SET_LOOKS_ABOUT, writeSetPictures } from "../../src/capture/export-sets.js";
import type { RenderedSet } from "../../src/capture/set-views.js";
import type { CinematicSet } from "../../src/cutscene/set-catalog.js";
import { parseSetLooks } from "../../src/cutscene/set-looks.js";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const look = (pictures: unknown[]) => ({ kind: "room", look: "A small round room about 6 cells across with a console in the middle.", facets: ["interior", "round", "small"], standsInFor: ["a control room"], basis: "Its pictures.", confidence: "high", problems: [], pictures });
const looks = parseSetLooks({
  "control-room": look([
    { file: "card/1.jpg", shows: "the room", from: { view: "plan" }, game: { capture: "card-1.jpg", lighting: "closest shot" } },
    { file: "card/2.jpg", shows: "the console", from: { eye: [0, 0, 2], target: [1, 0, 2] } },
    { file: "card/3.jpg", shows: "never drawn", from: { eye: [0, 0, 2], target: [-1, 0, 2] } },
  ]),
  "studio-room": look([{ file: "card/1.jpg", shows: "the room", from: { view: "plan" } }]),
  "mixed-room": look([{ file: "card/1.jpg", shows: "the room", from: { view: "plan" } }]),
  "undrawn-room": look([{ file: "card/1.jpg", shows: "the room", from: { view: "plan" } }]),
});
const set = (id: string, origins: string[]) => ({ id, name: "Control Room", kind: "story", models: [{ model: "RoomA", uses: 1 }], occurrences: origins.map((origin, n) => ({ origin, file: `mods/story.sc2mod/base.sc2data/Cutscenes/${id}-${n}.SC2Cutscene` })) }) as unknown as CinematicSet;
const catalog = [set("control-room", ["blizzard", "blizzard"]), set("studio-room", ["studio"]), set("mixed-room", ["blizzard", "studio"]), set("undrawn-room", ["blizzard"])];
const record = (id: string): RenderedSet => ({ id, name: "Control Room", size: [6.04, 6.26, 3.2], cameras: ["Wide", "Close"], missing: [], pieces: 3, files: 2, marks: ["Pilot"], origins: ["blizzard"], models: ["RoomA", "RoomB"] });
const records = new Map(["control-room", "studio-room", "mixed-room"].map((id) => [id, record(id)]));
const drawn = new Set(["control-room/card/1.jpg", "control-room/card/1-game.jpg", "control-room/card/2.jpg", "control-room/plan.jpg", "control-room/overview.jpg"]);
const has = (id: string, file: string) => drawn.has(`${id}/${file}`);

describe("publicSets", () => {
  const { sets, leftOut } = publicSets(looks, catalog, records, has);

  it("keeps only the drawn sets catalogued from Blizzard's files alone, and says why the rest stay", () => {
    expect(Object.keys(sets)).toEqual(["control-room"]);
    expect(leftOut).toEqual([
      { id: "mixed-room", why: "has files from studio" },
      { id: "studio-room", why: "has files from studio" },
      { id: "undrawn-room", why: "not drawn" },
    ]);
  });

  it("gives the look without where its pictures come from, the pictures there are, and the card's facts, but not the marks or models read from the files", () => {
    expect(sets["control-room"]).toEqual({
      name: "Control Room",
      kind: "room",
      look: looks["control-room"]!.look,
      facets: ["interior", "round", "small"],
      standsInFor: ["a control room"],
      pictures: [
        { file: "card/1.jpg", shows: "the room", inGame: true },
        { file: "card/2.jpg", shows: "the console" },
      ],
      basis: "Its pictures.",
      confidence: "high",
      problems: [],
      size: [6, 6.3, 3.2],
      cameras: 2,
      files: ["mods/story.sc2mod/base.sc2data/Cutscenes/control-room-0.SC2Cutscene", "mods/story.sc2mod/base.sc2data/Cutscenes/control-room-1.SC2Cutscene"],
    });
    expect(publishedFiles(sets["control-room"]!)).toEqual(["card/1.jpg", "card/1-game.jpg", "card/2.jpg", "plan.jpg", "overview.jpg"]);
  });
});

describe("publishedDrift", () => {
  // The drawn sets alone, as the export wrote them, with every picture drawn: card/3.jpg too.
  const { "undrawn-room": _, ...described } = looks;
  const exported = publicSets(described, catalog, records, () => true).sets;
  const file = (sets: typeof exported, about = SET_LOOKS_ABOUT) => ({ about, sets });

  it("finds nothing when the published file is what the export writes", () => {
    expect(publishedDrift(described, catalog, file(exported))).toEqual({ drift: [], unreleased: [] });
  });

  it("names each set whose fields differ, and sets on one side only", () => {
    const room = exported["control-room"]!;
    const published = file({ "control-room": { ...room, look: "Another look.", pictures: room.pictures.slice(0, 2) }, "gone-room": room }, "Older words.");
    expect(publishedDrift(described, catalog, published).drift).toEqual(["about: the file's description differs", "control-room: look, pictures differ", "gone-room: in the published file, not public in core"]);
  });

  it("lists the public sets the published file doesn't carry yet apart, as unreleased rather than drift", () => {
    expect(publishedDrift(looks, catalog, file(exported))).toEqual({ drift: [], unreleased: ["undrawn-room"] });
    expect(publishedDrift(described, catalog, file({}))).toEqual({ drift: [], unreleased: ["control-room"] });
  });

  it("takes the size and camera count from the published file, which only the drawing measures", () => {
    const room = exported["control-room"]!;
    expect(publishedDrift(described, catalog, file({ "control-room": { ...room, size: [9, 9, 9], cameras: 5 } }))).toEqual({ drift: [], unreleased: [] });
  });
});

describe("writeSetPictures", () => {
  it("writes each picture at most 1280 by 720 with a thumbnail, removes what the export doesn't name, and changes nothing a second time", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "export-sets-"));
    folders.push(root);
    const views = path.join(root, "views");
    const out = path.join(root, "site", "public", "sets");
    for (const file of drawn) {
      await mkdir(path.dirname(path.join(views, file)), { recursive: true });
      await sharp({ create: { width: 1600, height: 900, channels: 3, background: "#406080" } }).jpeg().toFile(path.join(views, file));
    }
    await mkdir(path.join(out, "studio-room"), { recursive: true });
    await writeFile(path.join(out, "studio-room", "plan.jpg"), "left from before");
    const { sets } = publicSets(looks, catalog, records, has);

    const first = await writeSetPictures(sets, views, out);
    expect(first.written).toHaveLength(10);
    expect(first.removed).toEqual(["studio-room/plan.jpg"]);
    expect(existsSync(path.join(out, "studio-room"))).toBe(false);
    expect(await sharp(path.join(out, "control-room", "card/1-game.jpg")).metadata()).toMatchObject({ width: 1280, height: 720 });
    expect((await sharp(path.join(out, "control-room", "plan_tn.jpg")).metadata()).width).toBe(320);
    expect((await readdir(path.join(out, "control-room", "card"))).sort()).toEqual(["1-game.jpg", "1-game_tn.jpg", "1.jpg", "1_tn.jpg", "2.jpg", "2_tn.jpg"]);

    const second = await writeSetPictures(sets, views, out);
    expect(second).toMatchObject({ written: [], removed: [] });
    expect(second.kept).toHaveLength(10);
  });
});
