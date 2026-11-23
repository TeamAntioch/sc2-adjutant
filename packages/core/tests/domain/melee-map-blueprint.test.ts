import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MeleeMapBlueprintSchema } from "../../src/domain/melee-map-blueprint.js";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/melee/two-spawns.json", import.meta.url), "utf8"));

function issues(raw: unknown): string[] {
  const parsed = MeleeMapBlueprintSchema.safeParse(raw);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("MeleeMapBlueprintSchema", () => {
  it("parses the two-spawn fixture, recording its category, spawns and symmetry", () => {
    const parsed = MeleeMapBlueprintSchema.parse(fixture);
    expect(parsed).toMatchObject({ category: "standard", spawns: 2, symmetry: "rot180", playableSize: { width: 136, height: 136 } });
    expect(parsed.zones.map((zone) => zone.id)).toEqual(["middle", "natural", "main-rim", "main"]);
  });

  it("rejects a Mission's Beats and Screenplay", () => {
    expect(issues({ ...fixture, beats: [{ id: "start", title: "Start" }] })).toEqual([expect.stringMatching(/beats/)]);
    expect(issues({ ...fixture, screenplay: { title: "Two Spawns" } })).toEqual([expect.stringMatching(/screenplay/)]);
  });

  it("rejects Waves, Mechanics, Anchors and tech", () => {
    for (const key of ["waves", "mechanics", "anchors", "tech"]) {
      expect(issues({ ...fixture, [key]: [] }), key).toEqual([expect.stringMatching(new RegExp(key))]);
    }
  });

  it("accepts only the Standard category, two spawns and 180° rotation", () => {
    expect(issues({ ...fixture, category: "macro" })).toEqual([expect.stringMatching(/^category/)]);
    expect(issues({ ...fixture, spawns: 4 })).toEqual([expect.stringMatching(/^spawns/)]);
    expect(issues({ ...fixture, symmetry: "mirrorX" })).toEqual([expect.stringMatching(/^symmetry/)]);
  });

  it("needs the half's one start of two, a built resource base", () => {
    expect(issues({ ...fixture, starts: ["main-base", "natural-base"] })).toEqual(["starts: Half of a 2-spawn map needs 1 start (the rotation makes the other), not 2"]);
    // main-base, no longer a start, then needs a facing of its own.
    expect(issues({ ...fixture, starts: ["nowhere"] })).toEqual([
      "placements.0.params.facing: Resource base main-base needs a `facing`: only a start base faces away from its main ramp by default",
      "starts.0: Unknown resource-base placement id: nowhere",
    ]);
  });

  it("keeps every pre-placed unit Neutral: no town hall or Assimilators on a resource base", () => {
    const placements = fixture.placements.map((placement: { id: string; params: object }) =>
      placement.id === "natural-base" ? { ...placement, params: { ...placement.params, townHall: { player: 2 } } } : placement,
    );
    expect(issues({ ...fixture, placements })).toEqual([expect.stringMatching(/^placements\.1\.params: .*townHall/)]);
  });

  it("refuses connections timed by beats, which a melee map has none of", () => {
    const zones = fixture.zones.map((zone: { id: string; connections?: object[] }) =>
      zone.id === "main" ? { ...zone, connections: [{ toZoneId: "natural", type: "ramp", opensAtBeat: "later" }] } : zone,
    );
    expect(issues({ ...fixture, zones })).toEqual([expect.stringMatching(/^zones\.3\.connections\.0: .*opensAtBeat/)]);
  });

  it("fits the playable area inside the map, centred across, an even height for the rotation", () => {
    expect(issues({ ...fixture, playableSize: { width: 170, height: 136 } })).toEqual(["playableSize: The playable area (170×136) must fit inside the map (160×160)"]);
    expect(issues({ ...fixture, playableSize: { width: 135, height: 136 } })).toEqual([
      "playableSize.width: The map's width less the playable width must be even, to centre it (160 - 135)",
    ]);
    expect(issues({ ...fixture, playableSize: { width: 136, height: 135 } })).toEqual([
      "playableSize.height: The playable height must be even, for the rotation to keep the cliff grid (135)",
    ]);
  });
});
