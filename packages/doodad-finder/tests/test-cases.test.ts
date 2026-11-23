// The test command's cases (src/test-cases.ts): past Doodad Searches' Search Parts and tick logs,
// from synthetic files.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { pastSearchCases, pastSearchFiles, percentile, TICK_LOG, tickLogCases, tickLogFiles, topHits } from "../src/test-cases.ts";

let dir: string | undefined;
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const write = async (file: string, text: string) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
};

const SEARCH = {
  title: "Press over a belt",
  mission: "m1",
  parts: [
    { name: "press head", readsAs: "a heavy block that drops", candidates: [{ id: "FoundryStamperHead", note: "Fits.", judgedFrom: "sheet" }, { id: "SupplyCrate", note: "Boxy.", judgedFrom: "image" }] },
    { name: "frame", readsAs: "a gantry", candidates: [], shortlist: [{ id: "FoundryPressFrame", level: 2, ranker: "jev" }] },
  ],
};

describe("the test command's cases", () => {
  it("asks each judged Search Part by its name and by its line, as a part of its search's object, to find its candidates best first, from the archive and each Mission's output", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "finder-cases-"));
    const archive = path.join(dir, "archive");
    const missions = path.join(dir, "missions");
    await write(path.join(missions, "m1/output/doodad-search/press/search.json"), JSON.stringify(SEARCH));
    await write(path.join(archive, "doodad-search/broken/search.json"), "{ not json");
    const files = await pastSearchFiles(archive, missions);
    expect(files.map((file) => path.relative(dir!, file).split(path.sep).join("/"))).toEqual(["archive/doodad-search/broken/search.json", "missions/m1/output/doodad-search/press/search.json"]);
    const { cases, skipped } = await pastSearchCases(files);
    expect(cases).toEqual([
      { from: "press / press head (name)", ask: "press head", object: "Press over a belt", mission: "m1", targets: ["FoundryStamperHead", "SupplyCrate"] },
      { from: "press / press head (line)", ask: "a heavy block that drops", object: "Press over a belt", mission: "m1", targets: ["FoundryStamperHead", "SupplyCrate"] },
    ]);
    expect(skipped.map(({ file }) => path.basename(path.dirname(file)))).toEqual(["broken"]);
  });

  it("takes each tick log line with cards ticked as a case for its Mission", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "finder-cases-"));
    const missions = path.join(dir, "missions");
    await write(path.join(missions, "m2", TICK_LOG), [JSON.stringify({ ask: "cover", tags: [{ facet: "story", value: "military" }], ticked: ["Sandbags"] }), JSON.stringify({ ask: "nothing", ticked: [] }), "oops"].join("\n"));
    const { cases, skipped } = await tickLogCases(await tickLogFiles(missions));
    expect(cases).toEqual([{ from: "m2 tick log line 1", ask: "cover", tags: [{ facet: "story", value: "military" }], mission: "m2", targets: ["Sandbags"] }]);
    expect(skipped).toHaveLength(1);
  });

  it("counts a ranked list's top-n hits out of as many targets as could fit there", () => {
    const ranked = ["a", "b", "c", "d", "e"];
    expect(topHits(ranked, ["b", "e", "x"], 3)).toEqual({ found: 1, of: 3 });
    expect(topHits(ranked, ["e", "a"], 3)).toEqual({ found: 1, of: 2 });
    expect(topHits(ranked, [], 3)).toEqual({ found: 0, of: 0 });
  });

  it("gives percentiles by nearest rank", () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(values, 50)).toBe(10);
    expect(percentile(values, 95)).toBe(19);
  });
});
