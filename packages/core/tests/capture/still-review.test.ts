// The Still Review builder (#124): a round's versions, each from one or more capture_shots folders
// (later ones, retakes, fill the Shots the earlier lack), checked frame by frame against a
// reference capture, into a round folder of review.json, frames/ and the page, index.html. The
// frames are generated (tests/support/generated-frames.ts); the capture folders are written as
// capture_shots writes them.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { buildStillReview, recordStillFeedback } from "../../src/capture/still-review.js";
import { frame, ground, PLACES } from "../support/generated-frames.js";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

let groundImage: Buffer;
beforeAll(async () => {
  groundImage = await ground(7);
});

/** The set's four Shots, by place. */
const SHOTS = [
  { rect: [10, 10, 40, 27], label: "yard" },
  { rect: [50, 10, 80, 27], label: "gate" },
  { rect: [90, 10, 120, 27], label: "pit" },
  { rect: [10, 40, 40, 57], label: "ridge" },
] as const;

type Taken = { place: number } | "missing" | "late";

/**
 * A capture folder as capture_shots writes it, of the set Shots numbered in `shots` (a retake
 * captures only some, numbered from 1): each Shot's frame shows the place given, or is missing or late.
 */
async function capture(dir: string, map: string, taken: readonly (readonly [setShot: number, Taken])[]): Promise<string> {
  await mkdir(dir, { recursive: true });
  const shots = [];
  for (const [i, [setShot, what]] of taken.entries()) {
    const spec = SHOTS[setShot - 1]!;
    const name = `${String(i + 1).padStart(2, "0")}-${spec.label}.jpg`;
    if (typeof what === "object") await frame(groundImage, PLACES[what.place - 1]!, path.join(dir, name));
    shots.push({
      shot: i + 1,
      frame: typeof what === "object" ? name : null,
      ...(what === "late" ? { late: true } : {}),
      rect: spec.rect,
      pitch: 75,
      yaw: 0,
      label: spec.label,
      camera: { target: [0, 0], distance: 37, pitch: 75, yawOffset: 0, fov: 27.8 },
      whole: true,
    });
  }
  await writeFile(path.join(dir, "shots.json"), JSON.stringify({ map: `/maps/${map}.SC2Map`, end: "done", shots }));
  return dir;
}

async function workspace() {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-still-review-"));
  folders.push(folder);
  const missionDir = path.join(folder, "missions", "yard");
  await mkdir(missionDir, { recursive: true });
  const blueprintPath = path.join(missionDir, "blueprint.json");
  await writeFile(blueprintPath, "{}");
  const shotsDir = path.join(missionDir, "output", "shots");
  return { blueprintPath, missionDir, shotsDir };
}

/** The data the page carries, from its JSON script. */
function pageData(html: string): { shots: { shot: number; frames: { version: string; status: string; frame: string | null }[] }[] } {
  const match = /<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error("the page carries no review data");
  return JSON.parse(match[1]!);
}

describe("buildStillReview", () => {
  it("checks each version's frames, leaves the missing, late and wrong ones off the page and names them for a retake", async () => {
    const { blueprintPath, missionDir, shotsDir } = await workspace();
    const before = await capture(path.join(shotsDir, "before"), "Yard", [
      [1, { place: 1 }],
      [2, { place: 2 }],
      [3, { place: 3 }],
      [4, { place: 4 }],
    ]);
    // Shot 2 shows Shot 3's place, Shot 3 is missing, Shot 4 late.
    const washes = await capture(path.join(shotsDir, "washes"), "Yard-washes", [
      [1, { place: 1 }],
      [2, { place: 3 }],
      [3, "missing"],
      [4, "late"],
    ]);

    const result = await buildStillReview({
      target: { blueprintPath },
      set: "ground",
      round: "r1",
      lighting: "Char Dusk",
      versions: [
        { label: "before", note: "as it was", captures: [before] },
        { label: "washes", note: "darker washes", captures: [washes] },
      ],
    });

    const roundDir = path.join(missionDir, "output", "stills", "ground", "r1");
    expect(result.roundDir).toBe(roundDir);
    const review = JSON.parse(await readFile(path.join(roundDir, "review.json"), "utf8"));
    const statuses = review.shots.map((shot: { label: string; frames: { status: string }[] }) => [shot.label, shot.frames.map((entry) => entry.status)]);
    expect(statuses).toEqual([
      ["yard", ["ok", "ok"]],
      ["gate", ["ok", "wrong"]],
      ["pit", ["ok", "missing"]],
      ["ridge", ["ok", "late"]],
    ]);
    // Only the frames the page shows are copied.
    const shown = review.shots.flatMap((shot: { frames: { frame: string | null }[] }) => shot.frames.flatMap((entry) => (entry.frame ? [entry.frame] : [])));
    expect(shown).toHaveLength(5);
    expect((await readdir(path.join(roundDir, "frames"))).sort()).toEqual(shown.map((file: string) => path.basename(file)).sort());
    expect(review.problems).toEqual([
      { shot: 2, label: "gate", version: "washes", status: "wrong", shows: 3 },
      { shot: 3, label: "pit", version: "washes", status: "missing" },
      { shot: 4, label: "ridge", version: "washes", status: "late" },
    ]);
    expect(review.retakes).toEqual([
      {
        version: "washes",
        map: "/maps/Yard-washes.SC2Map",
        shots: [
          { rect: [50, 10, 80, 27], pitch: 75, yaw: 0, label: "gate" },
          { rect: [90, 10, 120, 27], pitch: 75, yaw: 0, label: "pit" },
          { rect: [10, 40, 40, 57], pitch: 75, yaw: 0, label: "ridge" },
        ],
      },
    ]);
    expect(result.summary).toMatch(/washes: Shot 2 \(gate\) shows Shot 3 \(pit\)'s place/);
    expect(result.summary).toMatch(/Retake.*washes.*2, 3, 4/);

    // The page carries the same Shots, frames and statuses.
    const page = pageData(await readFile(path.join(roundDir, "index.html"), "utf8"));
    expect(page.shots.map((shot) => ({ shot: shot.shot, frames: shot.frames.map(({ version, status, frame }) => ({ version, status, frame })) }))).toEqual(
      review.shots.map((shot: { shot: number; frames: { version: string; status: string; frame: string | null }[] }) => ({
        shot: shot.shot,
        frames: shot.frames.map(({ version, status, frame }) => ({ version, status, frame })),
      })),
    );
    // No path on this machine, nor the maps the retakes name.
    expect(await readFile(path.join(roundDir, "index.html"), "utf8")).not.toMatch(new RegExp(`${shotsDir}|/maps/|${roundDir}`));
  });

  it("fills a version's lacking Shots from its retakes, matched by place, not number", async () => {
    const { blueprintPath, shotsDir } = await workspace();
    const before = await capture(path.join(shotsDir, "before"), "Yard", [
      [1, { place: 1 }],
      [2, { place: 2 }],
      [3, { place: 3 }],
      [4, { place: 4 }],
    ]);
    const washes = await capture(path.join(shotsDir, "washes"), "Yard-washes", [
      [1, { place: 1 }],
      [2, { place: 3 }],
      [3, "missing"],
      [4, { place: 4 }],
    ]);
    // The retake of Shots 2 and 3, as its own Shots 1 and 2.
    const retake = await capture(path.join(shotsDir, "washes-retake"), "Yard-washes", [
      [2, { place: 2 }],
      [3, { place: 3 }],
    ]);

    const result = await buildStillReview({
      target: { blueprintPath },
      set: "ground",
      round: "r1",
      versions: [
        { label: "before", captures: [before] },
        { label: "washes", captures: [washes, retake] },
      ],
    });

    const review = JSON.parse(await readFile(path.join(result.roundDir, "review.json"), "utf8"));
    expect(review.shots.map((shot: { frames: { status: string }[] }) => shot.frames[1]!.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(review.problems).toEqual([]);
    expect(review.retakes).toEqual([]);
  });

  it("refuses a capture whose Shots aren't the set's", async () => {
    const { blueprintPath, shotsDir } = await workspace();
    const before = await capture(path.join(shotsDir, "before"), "Yard", [[1, { place: 1 }]]);
    const other = path.join(shotsDir, "other");
    await capture(other, "Yard", [[1, { place: 1 }]]);
    const shotsFile = path.join(other, "shots.json");
    const listed = JSON.parse(await readFile(shotsFile, "utf8"));
    listed.shots[0].rect = [0, 0, 5, 5];
    await writeFile(shotsFile, JSON.stringify(listed));
    await expect(
      buildStillReview({
        target: { blueprintPath },
        set: "ground",
        round: "r1",
        versions: [
          { label: "before", captures: [before] },
          { label: "other", captures: [other] },
        ],
      }),
    ).rejects.toThrow(/other.*Shot 1.*isn't one of the set's/);
  });
});

describe("recordStillFeedback", () => {
  it("writes the page's rows as feedback.json and feedback.md, which the next round's page shows", async () => {
    const { blueprintPath, shotsDir } = await workspace();
    const before = await capture(path.join(shotsDir, "before"), "Yard", [
      [1, { place: 1 }],
      [2, { place: 2 }],
    ]);
    const washes = await capture(path.join(shotsDir, "washes"), "Yard-washes", [
      [1, { place: 1 }],
      [2, { place: 2 }],
    ]);
    const versions = [
      { label: "before", captures: [before] },
      { label: "washes", captures: [washes] },
    ];
    const r1 = await buildStillReview({ target: { blueprintPath }, set: "ground", round: "r1", versions });

    const feedback = await recordStillFeedback(r1.roundDir, [
      { path: "shots/2", data: { best: "washes", tags: ["seams"], note: "the seam by the gate shows" } },
      { path: "shots/1", data: { best: "no-change", tags: [], note: "" } },
      { path: "review/overall", data: { note: "closer" } },
      { path: "review/status", data: { done: true } },
    ]);

    expect(feedback.done).toBe(true);
    const written = JSON.parse(await readFile(path.join(r1.roundDir, "feedback.json"), "utf8"));
    expect(written).toEqual({
      round: "r1",
      done: true,
      overall: "closer",
      shots: [
        { shot: 1, label: "yard", best: "no-change", tags: [], note: "" },
        { shot: 2, label: "gate", best: "washes", tags: ["seams"], note: "the seam by the gate shows" },
      ],
    });
    const markdown = await readFile(path.join(r1.roundDir, "feedback.md"), "utf8");
    expect(markdown).toContain("the seam by the gate shows");
    expect(markdown).toContain("closer");

    const r2 = await buildStillReview({ target: { blueprintPath }, set: "ground", round: "r2", versions, previous: r1.roundDir });
    const review = JSON.parse(await readFile(path.join(r2.roundDir, "review.json"), "utf8"));
    expect(review.previous).toEqual({ round: "r1", overall: "closer" });
    expect(review.shots[1].previous).toEqual({ best: "washes", tags: ["seams"], note: "the seam by the gate shows" });
    expect(existsSync(path.join(r2.roundDir, "index.html"))).toBe(true);
  });

  it("refuses rows it doesn't know", async () => {
    const { blueprintPath, shotsDir } = await workspace();
    const before = await capture(path.join(shotsDir, "before"), "Yard", [[1, { place: 1 }]]);
    const r1 = await buildStillReview({ target: { blueprintPath }, set: "ground", round: "r1", versions: [{ label: "before", captures: [before] }] });
    await expect(recordStillFeedback(r1.roundDir, [{ path: "shots/9", data: { best: "before", tags: [], note: "" } }])).rejects.toThrow(/shots\/9.*no Shot 9/);
  });
});
