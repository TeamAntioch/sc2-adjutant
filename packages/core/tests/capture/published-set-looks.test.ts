// Core's looks.json is the authoring copy of the public sets' looks, and the pinned
// @team-antioch/sc2-asset-catalog's data/set-looks.json is what `npm run export-sets` last
// published from it. They must agree (#905): an edit on one side alone would drift unseen. A
// public set no release carries yet is listed, not failed: the Set Finder lays it over the
// published ones until one does.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { publishedDrift, type SetLooksFile } from "../../src/capture/export-sets.js";
import type { CinematicSet } from "../../src/cutscene/set-catalog.js";
import { parseSetLooks } from "../../src/cutscene/set-looks.js";

const data = fileURLToPath(new URL("../../data/cinematic-sets/", import.meta.url));
const looks = parseSetLooks(JSON.parse(readFileSync(path.join(data, "looks.json"), "utf8")));
const catalog = (JSON.parse(readFileSync(path.join(data, "catalog.json"), "utf8")) as { sets: CinematicSet[] }).sets;
const packageDir = path.dirname(createRequire(import.meta.url).resolve("@team-antioch/sc2-asset-catalog/package.json"));
const published = JSON.parse(readFileSync(path.join(packageDir, "data/set-looks.json"), "utf8")) as SetLooksFile;
const { version } = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")) as { version: string };

describe("the published set looks", () => {
  it("are what the export writes from core's looks", () => {
    const { drift, unreleased } = publishedDrift(looks, catalog, published);
    if (unreleased.length) console.log(`Public sets in core that ${version} doesn't carry yet: ${unreleased.join(", ")}`);
    const fix = [
      `core's data/cinematic-sets/looks.json and @team-antioch/sc2-asset-catalog ${version}'s data/set-looks.json disagree on the sets below.`,
      "If core's side changed, run npm run export-sets into a sc2-asset-catalog checkout and release it, then bump the pin.",
      "If a newer sc2-asset-catalog release already carries the change, bump the pin (docs/agents/asset-catalog.md).",
      "Every picture a look names counts as drawn: one set-cards never drew differs until it's drawn and exported, or taken out of the look.",
    ].join("\n");
    expect(drift, fix).toEqual([]);
  });
});
