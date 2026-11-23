import { describe, expect, it } from "vitest";

import { MissionBlueprintSchema, waveUnitCounts } from "../src/domain/mission-blueprint.js";

const validBlueprint = {
  id: "plain_crossing",
  campaignId: "fixtures",
  title: "The Plain Crossing",
  setting: "A moon spiraling toward a sun",
  mapSize: { width: 128, height: 128 },
  tilesetId: "KorhalCityEx2",
  zones: [
    {
      id: "landing_zone",
      name: "Landing Zone",
      elevation: 1,
      landform: "flat", role: "base",
      polygon: [
        { x: 10, y: 10 },
        { x: 30, y: 10 },
        { x: 30, y: 30 },
        { x: 10, y: 30 },
      ],
      connections: [{ toZoneId: "sunlit_ridge", type: "ramp" }],
    },
    {
      id: "sunlit_ridge",
      name: "Sunlit Ridge",
      elevation: 2,
      landform: "ridge", role: "path",
      polygon: [
        { x: 32, y: 10 },
        { x: 52, y: 10 },
        { x: 52, y: 30 },
        { x: 32, y: 30 },
      ],
      connections: [{ toZoneId: "landing_zone", type: "ramp" }],
    },
  ],
  anchors: [
    {
      id: "hero_zeratul",
      name: "Zeratul",
      zoneId: "landing_zone",
      kind: "unit",
      position: { x: 20, y: 20, z: 8 },
      rotation: 0,
    },
    {
      id: "camera_opening",
      name: "Opening Camera",
      zoneId: "landing_zone",
      kind: "camera",
      position: { x: 20, y: 20, z: 12 },
    },
  ],
  placements: [
    {
      id: "landing_minerals",
      zoneId: "landing_zone",
      kind: "resource-base",
      params: { mineralPatches: 8, vespeneGeysers: 2 },
    },
  ],
  beats: [
    {
      id: "opening",
      title: "Arrival",
      summary: "The player lands and surveys the scorched plain.",
      zoneIds: ["landing_zone"],
      anchorIds: ["hero_zeratul", "camera_opening"],
    },
  ],
  objectives: [
    {
      id: "survive",
      title: "Survive the first flare",
      description: "Keep Zeratul alive through the first surge.",
      type: "primary",
      beatId: "opening",
    },
  ],
  screenplay: {
    title: "The Plain Crossing",
    scenes: [
      {
        id: "scene_arrival",
        beatId: "opening",
        lines: [
          {
            id: "line_001",
            speaker: "Zeratul",
            text: "This moon is falling apart.",
            durationSeconds: 3,
          },
        ],
      },
    ],
  },
};

describe("MissionBlueprintSchema", () => {
  it("accepts a valid blueprint", () => {
    expect(MissionBlueprintSchema.parse(validBlueprint).id).toBe("plain_crossing");
  });

  it("rejects duplicate zone ids", () => {
    const duplicate = {
      ...validBlueprint,
      zones: [validBlueprint.zones[0], { ...validBlueprint.zones[0], name: "Duplicate" }],
    };
    expect(() => MissionBlueprintSchema.parse(duplicate)).toThrow();
  });

  describe("Kept terrain (ADR-0010)", () => {
    const imported = {
      id: "harbour",
      campaignId: "fixtures",
      title: "The Harbour",
      setting: "A port at dusk",
      mapSize: { width: 96, height: 64 },
      tilesetId: "KorhalCityEx2",
      screenplay: { title: "The Harbour" },
    };

    it("allows a Blueprint with no Zones and no Beats: every terrain cell is Kept Content", () => {
      const blueprint = MissionBlueprintSchema.parse(imported);
      expect(blueprint.zones).toEqual([]);
      expect(blueprint.beats).toEqual([]);
    });

    describe("Kept References", () => {
      const kept = [
        { id: "gate-opens", kind: "trigger", editorId: "0A1B2C3D", name: "Gate Opens" },
        { id: "dock-master", kind: "unit", editorId: 1234567, name: "Dock Master" },
        { id: "quay", kind: "region", editorId: 3, name: "Quay" },
      ];
      const scene = (cue: object, speakerAnchorId = "dock-master") => ({ id: "s", cue, lines: [{ id: "l", speaker: "Dock Master", speakerAnchorId, text: "Tie her up." }] });
      const messages = (blueprint: object) => (MissionBlueprintSchema.safeParse(blueprint).error?.issues ?? []).map((issue) => `${issue.path.join(".")}: ${issue.message}`);

      it("are accepted where an Anchor of their kind is: a speaker, a unit and region in a condition, a Kept trigger's run", () => {
        const blueprint = MissionBlueprintSchema.parse({
          ...imported,
          kept,
          screenplay: { title: "The Harbour", scenes: [scene({ type: "keptTriggerRuns", triggerId: "gate-opens" }), { ...scene({ type: "anchorEntersZone", anchorId: "dock-master", zoneId: "quay" }), id: "t" }] },
        });
        expect(blueprint.kept.map((reference) => reference.id)).toEqual(["gate-opens", "dock-master", "quay"]);
      });

      it("refuse the wrong kind, an unknown Kept trigger, an Editor Id of the wrong form, and an id an Anchor has", () => {
        expect(messages({ ...imported, kept, screenplay: { title: "T", scenes: [scene({ type: "keptTriggerRuns", triggerId: "dock-master" })] } })).toContain(
          "screenplay.scenes.0.cue.triggerId: Unknown Kept trigger id: dock-master (declare it in kept, with kind trigger)",
        );
        expect(messages({ ...imported, kept, screenplay: { title: "T", scenes: [scene({ type: "anchorDies", anchorId: "quay" }, "quay")] } })).toContain("screenplay.scenes.0.lines.0.speakerAnchorId: Unknown unit anchor id: quay");
        expect(messages({ ...imported, kept: [{ id: "t", kind: "trigger", editorId: 5, name: "T" }] })).toContain("kept.0.editorId: A Kept trigger's editorId is its element Id in Triggers: 8 uppercase hex digits, as a string");
        expect(messages({ ...imported, kept: [{ id: "u", kind: "unit", editorId: "12", name: "U" }] })).toContain("kept.0.editorId: A Kept unit's editorId is its number in Objects");
        expect(messages({ ...validBlueprint, kept: [{ id: validBlueprint.anchors[0]!.id, kind: "unit", editorId: 9, name: "U" }] })).toContain(
          `kept.0.id: Kept Reference ${validBlueprint.anchors[0]!.id} has an Anchor's id`,
        );
      });

      it("hold a Kept trigger until a cue, run from another Kept trigger or by its own Map Initialization event", () => {
        const held = (hold: object, kind = "trigger") => [...kept, { id: "stealth", kind, editorId: kind === "trigger" ? "0A1B2C3E" : 7, name: "Stealth", hold }];
        const blueprint = MissionBlueprintSchema.parse({ ...imported, kept: held({ from: "gate-opens", until: { type: "anchorDies", anchorId: "dock-master" } }) });
        expect(blueprint.kept[3]!.hold).toEqual({ from: "gate-opens", until: { type: "anchorDies", anchorId: "dock-master" } });
        expect(MissionBlueprintSchema.parse({ ...imported, kept: held({ until: { type: "missionStart" } }) }).kept[3]!.hold).toEqual({ until: { type: "missionStart" } });

        expect(messages({ ...imported, kept: held({ until: { type: "missionStart" } }, "unit") })).toContain("kept.3.hold: Only a Kept trigger is held; this is a Kept unit");
        expect(messages({ ...imported, kept: held({ from: "dock-master", until: { type: "missionStart" } }) })).toContain("kept.3.hold.from: Unknown Kept trigger id: dock-master (declare it in kept, with kind trigger)");
        expect(messages({ ...imported, kept: held({ from: "stealth", until: { type: "missionStart" } }) })[0]).toMatch(/^kept\.3\.hold\.from: stealth can't hold its own Run Trigger/);
        expect(messages({ ...imported, kept: held({ until: { type: "keptTriggerRuns", triggerId: "stealth" } }) })[0]).toMatch(/^kept\.3\.hold\.until\.triggerId: stealth would wait on its own run/);
        expect(messages({ ...imported, kept: held({ until: { type: "anchorDies", anchorId: "nobody" } }) })).toContain("kept.3.hold.until.anchorId: Unknown unit anchor id: nobody");
        expect(messages({ ...imported, kept: held({ until: { type: "scenePlayed", scene: 4 } }) }).join("\n")).toMatch(/^kept\.3\.hold\.until/m);
      });

      it("refuse a Kept region with a Zone's id, which a condition would take for the Zone", () => {
        const zoneId = validBlueprint.zones[0]!.id;
        expect(messages({ ...validBlueprint, kept: [{ id: zoneId, kind: "region", editorId: 3, name: "Quay" }] })).toContain(`kept.0.id: Kept Reference ${zoneId} has a Zone's id`);
      });
    });

    it("still needs Beats when the Blueprint has Zones, which compile its terrain", () => {
      const { beats: _beats, ...noBeats } = validBlueprint as typeof validBlueprint & { beats: unknown };
      expect(() => MissionBlueprintSchema.parse({ ...noBeats, beats: [] })).toThrow(/Zones need at least one Beat/);
    });
  });

  it("rejects unknown keys", () => {
    expect(() => MissionBlueprintSchema.parse({ ...validBlueprint, typo: true })).toThrow();
  });

  it("rejects invalid cliff elevations", () => {
    const invalid = {
      ...validBlueprint,
      zones: [{ ...validBlueprint.zones[0], elevation: 9 }],
    };
    expect(() => MissionBlueprintSchema.parse(invalid)).toThrow();
  });

  it("rejects dangling zone references", () => {
    const dangling = {
      ...validBlueprint,
      anchors: [{ ...validBlueprint.anchors[0], zoneId: "missing_zone" }],
    };
    expect(() => MissionBlueprintSchema.parse(dangling)).toThrow();
  });

  describe("layout model (ADR 0003)", () => {
    const [landing, ridge] = validBlueprint.zones;
    const withZones = (...zones: object[]) => ({ ...validBlueprint, zones });
    const issues = (blueprint: object) => {
      const result = MissionBlueprintSchema.safeParse(blueprint);
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };

    it("defaults overlooks and introduces to empty", () => {
      const parsed = MissionBlueprintSchema.parse(validBlueprint);
      expect(parsed.zones[0].overlooks).toEqual([]);
      expect(parsed.beats[0].introduces).toEqual([]);
    });

    it("rejects the old terrainRole field", () => {
      expect(() => MissionBlueprintSchema.parse(withZones({ ...landing, terrainRole: "base" }, ridge))).toThrow();
    });

    it("accepts a one-way connection listed only on the zone it leaves from", () => {
      const drop = { ...ridge, connections: [{ toZoneId: "landing_zone", type: "open", oneWay: true }] };
      const below = { ...landing, connections: [] };
      expect(issues(withZones(below, drop))).toEqual([]);
    });

    it("rejects a one-way connection listed on both sides", () => {
      const drop = { ...ridge, connections: [{ toZoneId: "landing_zone", type: "ramp", oneWay: true }] };
      expect(issues(withZones(landing, drop))).toContainEqual(expect.stringContaining("one-way"));
    });

    it("rejects unknown beats and disagreeing timings on a connection", () => {
      const opens = (beat: string) => [{ toZoneId: "sunlit_ridge", type: "ramp", opensAtBeat: beat }];
      expect(issues(withZones({ ...landing, connections: opens("nope") }, ridge))).toContainEqual("Unknown beat id: nope");
      expect(issues(withZones({ ...landing, connections: opens("opening") }, ridge))).toContainEqual(
        expect.stringContaining("disagree on opensAtBeat"),
      );
    });

    it("rejects a connection that opens and closes at the same beat", () => {
      const connection = { type: "ramp", opensAtBeat: "opening", closesAtBeat: "opening" };
      const blueprint = withZones(
        { ...landing, connections: [{ toZoneId: "sunlit_ridge", ...connection }] },
        { ...ridge, connections: [{ toZoneId: "landing_zone", ...connection }] },
      );
      expect(issues(blueprint)).toContainEqual(expect.stringContaining("same beat"));
    });

    it("rejects overlooks of unknown zones or itself", () => {
      expect(issues(withZones({ ...landing, overlooks: ["nowhere"] }, ridge))).toContainEqual("Unknown zone id: nowhere");
      expect(issues(withZones({ ...landing, overlooks: ["landing_zone"] }, ridge))).toContainEqual(
        "A zone can't overlook itself",
      );
    });
  });

  describe("waves (ADR 0008)", () => {
    const wave = {
      id: "raid",
      spawnZoneId: "sunlit_ridge",
      targetZoneIds: ["landing_zone"],
      arrival: "ground",
      units: [{ type: "Zealot", count: 2 }],
      startsAtBeat: "opening",
      firstSeconds: 60,
    };
    const withWaves = (...waves: object[]) => ({ ...validBlueprint, waves });
    const issues = (blueprint: object) => {
      const result = MissionBlueprintSchema.safeParse(blueprint);
      return result.success ? [] : result.error.issues.map((issue) => ({ message: issue.message, path: issue.path.join(".") }));
    };

    it("migrates the old form: one target, and unit types counted by repeats", () => {
      const { targetZoneIds: _, units: __, ...rest } = wave;
      const old = { ...rest, targetZoneId: "landing_zone", unitTypes: ["Adept", "Adept", "Zealot"] };
      const [parsed] = MissionBlueprintSchema.parse(withWaves(old)).waves;
      expect(parsed).toMatchObject({
        targetZoneIds: ["landing_zone"],
        units: [
          { type: "Adept", count: 2 },
          { type: "Zealot", count: 1 },
        ],
      });
      expect(parsed).not.toHaveProperty("targetZoneId");
      expect(parsed).not.toHaveProperty("unitTypes");
    });

    it("keeps a title, in the old form too, and refuses an empty one", () => {
      const { targetZoneIds: _, ...rest } = wave;
      expect(MissionBlueprintSchema.parse(withWaves({ ...rest, targetZoneId: "landing_zone", title: "Ridge Raid" })).waves[0]?.title).toBe("Ridge Raid");
      expect(issues(withWaves({ ...wave, title: "" }))).toContainEqual(expect.objectContaining({ path: "waves.0.title" }));
    });

    it("refuses a wave that gives a field in both forms", () => {
      expect(issues(withWaves({ ...wave, targetZoneId: "landing_zone" }))).toContainEqual(expect.objectContaining({ path: "waves.0" }));
    });

    it("accepts a Raid with a spawn Anchor and a warning", () => {
      const raid = {
        ...wave,
        targetZoneIds: ["landing_zone", "sunlit_ridge"],
        units: [
          { type: "Zealot", count: 2 },
          { type: "Stalker", count: [0, 0, 1, 2] },
        ],
        onlyIfPlayerHolds: "Assimilator",
        spawnAnchorId: "ridge_gate",
        warning: { seconds: 15, transmission: "scene_arrival", firstOnly: true },
      };
      const gate = { id: "ridge_gate", name: "Ridge Gate", zoneId: "sunlit_ridge", kind: "point", position: { x: 40, y: 20 } };
      expect(issues({ ...withWaves(raid), anchors: [...validBlueprint.anchors, gate] })).toEqual([]);
    });

    it("sends a wave's unit with every send unless it joins only the first", () => {
      const units = [
        { type: "Zealot", count: 2 },
        { type: "Archon", count: 1, sends: "first" },
      ];
      expect(MissionBlueprintSchema.parse(withWaves({ ...wave, units })).waves[0]!.units.map((unit) => unit.sends)).toEqual(["every", "first"]);
      expect(issues(withWaves({ ...wave, units: [{ type: "Zealot", count: 2, sends: "second" }] }))).toContainEqual(expect.objectContaining({ path: "waves.0.units.0.sends" }));
    });

    it("lets a type come with every send and once more with the first, but not twice in either", () => {
      const zealot = { type: "Zealot", count: 1 };
      expect(issues(withWaves({ ...wave, units: [zealot, { ...zealot, sends: "first" }] }))).toEqual([]);
      expect(issues(withWaves({ ...wave, units: [zealot, zealot] }))).toContainEqual(expect.objectContaining({ path: "waves.0.units.1.type", message: "Duplicate unit type: Zealot" }));
      expect(issues(withWaves({ ...wave, units: [{ ...zealot, sends: "first" }, { ...zealot, sends: "first" }] }))).toContainEqual({
        path: "waves.0.units.1.type",
        message: "Duplicate unit type on the first send: Zealot",
      });
      // A real type id spelled like the old key is a different type, not a repeat.
      expect(issues(withWaves({ ...wave, units: [{ ...zealot, sends: "first" }, { type: "Zealot on the first send", count: 1 }] }))).toEqual([]);
    });

    it("refuses a repeating wave that only its first send brings units to", () => {
      const units = [{ type: "Archon", count: 1, sends: "first" }];
      expect(issues(withWaves({ ...wave, units, intervalSeconds: 60 }))).toContainEqual(expect.objectContaining({ path: "waves.0.intervalSeconds" }));
      expect(issues(withWaves({ ...wave, units }))).toEqual([]);
    });

    it("reports an unknown zone, Anchor, Beat or scene in a wave at its path", () => {
      expect(issues(withWaves({ ...wave, onlyIfPlayerHolds: "Assimilator", targetZoneIds: ["landing_zone", "nowhere"] }))).toEqual([
        { message: "Unknown zone id: nowhere", path: "waves.0.targetZoneIds.1" },
      ]);
      expect(issues(withWaves({ ...wave, spawnAnchorId: "nobody" }))).toEqual([{ message: "Unknown point anchor id: nobody", path: "waves.0.spawnAnchorId" }]);
      expect(issues(withWaves({ ...wave, endsAtBeat: "never" }))).toEqual([{ message: "Unknown beat id: never", path: "waves.0.endsAtBeat" }]);
      expect(issues(withWaves({ ...wave, warning: { seconds: 10, transmission: "unwritten" } }))).toEqual([
        { message: "Unknown scene id: unwritten", path: "waves.0.warning.transmission" },
      ]);
    });

    it("refuses a spawn Anchor that isn't a point in the spawn zone", () => {
      const point = (zoneId: string) => ({ id: "gate", name: "Gate", zoneId, kind: "point", position: { x: 20, y: 20 } });
      const withGate = (zoneId: string) => ({ ...withWaves({ ...wave, spawnAnchorId: "gate" }), anchors: [...validBlueprint.anchors, point(zoneId)] });
      expect(issues(withGate("landing_zone"))).toEqual([
        { message: "Anchor gate is in landing_zone, not the wave's spawn zone sunlit_ridge", path: "waves.0.spawnAnchorId" },
      ]);
      expect(issues(withWaves({ ...wave, spawnZoneId: "landing_zone", spawnAnchorId: "camera_opening" }))).toEqual([
        { message: "Unknown point anchor id: camera_opening", path: "waves.0.spawnAnchorId" },
      ]);
    });

    it("refuses a repeated candidate or unit type, and a unit that never comes", () => {
      expect(issues(withWaves({ ...wave, onlyIfPlayerHolds: "Assimilator", targetZoneIds: ["landing_zone", "landing_zone"] }))).toEqual([
        { message: "Duplicate target zone: landing_zone", path: "waves.0.targetZoneIds.1" },
      ]);
      const units = [
        { type: "Zealot", count: 1 },
        { type: "Zealot", count: 2 },
      ];
      expect(issues(withWaves({ ...wave, units }))).toEqual([{ message: "Duplicate unit type: Zealot", path: "waves.0.units.1.type" }]);
      expect(issues(withWaves({ ...wave, units: [{ type: "Zealot", count: [0, 0, 0, 0] }] }))).toEqual([
        { message: "A wave's unit needs a count above 0 on some difficulty", path: "waves.0.units.0.count" },
      ]);
    });

    it("lets only a Raid list more than one target zone", () => {
      expect(issues(withWaves({ ...wave, targetZoneIds: ["landing_zone", "sunlit_ridge"] }))).toEqual([
        { message: "Only a Raid (onlyIfPlayerHolds) may list more than one target zone", path: "waves.0.targetZoneIds" },
      ]);
      expect(issues(withWaves({ ...wave, onlyIfPlayerHolds: "Assimilator", targetZoneIds: ["landing_zone", "sunlit_ridge"] }))).toEqual([]);
    });

    it("refuses a wave with no target or no units", () => {
      expect(issues(withWaves({ ...wave, targetZoneIds: [] }))).toContainEqual(expect.objectContaining({ path: "waves.0.targetZoneIds" }));
      expect(issues(withWaves({ ...wave, units: [] }))).toContainEqual(expect.objectContaining({ path: "waves.0.units" }));
    });
  });

  describe("tech", () => {
    const withTech = (tech: unknown) => ({ ...validBlueprint, tech });
    const issues = (blueprint: object) => {
      const result = MissionBlueprintSchema.safeParse(blueprint);
      return result.success ? [] : result.error.issues.map((issue) => ({ message: issue.message, path: issue.path.join(".") }));
    };

    it("defaults to no restrictions", () => {
      expect(MissionBlueprintSchema.parse(validBlueprint).tech).toEqual([]);
    });

    it("takes each player's disallowed units, buildings and upgrades, and an allow list", () => {
      const parsed = MissionBlueprintSchema.parse(
        withTech([
          { player: 1, disallow: { buildings: ["Stargate"], units: ["Phoenix"], upgrades: ["BlinkTech"] } },
          { player: 2, allow: { buildings: ["Nexus", "Gateway"], units: ["Probe", "Zealot"] } },
        ]),
      );
      expect(parsed.tech[0]).toEqual({ player: 1, disallow: { units: ["Phoenix"], buildings: ["Stargate"], upgrades: ["BlinkTech"] } });
      expect(parsed.tech[1]!.allow).toEqual({ units: ["Probe", "Zealot"], buildings: ["Nexus", "Gateway"], upgrades: [] });
    });

    it("checks names against the stock unit and upgrade catalog", () => {
      expect(issues(withTech([{ player: 1, disallow: { buildings: ["Stargat"], upgrades: ["Blink"] } }]))).toEqual([
        { message: "Unknown unit or building: Stargat (data/tech-catalog.json)", path: "tech.0.disallow.buildings.0" },
        { message: "Unknown upgrade: Blink (data/tech-catalog.json)", path: "tech.0.disallow.upgrades.0" },
      ]);
    });

    it("keeps buildings and units apart", () => {
      expect(issues(withTech([{ player: 1, disallow: { buildings: ["Stalker"], units: ["Stargate"] } }]))).toEqual([
        { message: "Stalker isn't a building; list it under units", path: "tech.0.disallow.buildings.0" },
        { message: "Stargate is a building; list it under buildings", path: "tech.0.disallow.units.0" },
      ]);
    });

    it("refuses a second entry for one player, an empty entry, and a name listed twice or both allowed and disallowed", () => {
      expect(issues(withTech([{ player: 1, disallow: { units: ["Phoenix"] } }, { player: 1, disallow: { units: ["VoidRay"] } }]))).toContainEqual({
        message: "Duplicate player: 1",
        path: "tech.1.player",
      });
      expect(issues(withTech([{ player: 1 }]))).toContainEqual({ message: "Give allow, disallow or both", path: "tech.0" });
      expect(issues(withTech([{ player: 1, allow: { units: ["Zealot"] }, disallow: { units: ["Zealot"] } }]))).toContainEqual({
        message: "Zealot is both allowed and disallowed",
        path: "tech.0.disallow.units.0",
      });
      expect(issues(withTech([{ player: 1, disallow: { units: ["Zealot", "Zealot"] } }]))).toContainEqual({ message: "Zealot is listed twice", path: "tech.0.disallow.units.1" });
    });
  });

  describe("waveUnitCounts", () => {
    it("copies Normal's count to Casual and scales Hard ×1.3 and Brutal ×1.5, rounded", () => {
      expect(waveUnitCounts(1)).toEqual([1, 1, 1, 2]);
      expect(waveUnitCounts(2)).toEqual([2, 2, 3, 3]);
      expect(waveUnitCounts(3)).toEqual([3, 3, 4, 5]);
      expect(waveUnitCounts(5)).toEqual([5, 5, 7, 8]);
      expect(waveUnitCounts(10)).toEqual([10, 10, 13, 15]);
    });

    it("takes four counts as given", () => {
      expect(waveUnitCounts([0, 0, 1, 2])).toEqual([0, 0, 1, 2]);
      expect(waveUnitCounts([4, 2, 2, 2])).toEqual([4, 2, 2, 2]);
    });
  });
});
