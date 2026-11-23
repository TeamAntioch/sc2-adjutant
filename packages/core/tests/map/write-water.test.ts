import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { MissionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { expandDressing } from "../../src/dressing/expand-dressing.js";
import { poolWaterId, t3WaterBuffer, waterDataXml, waterWarnings } from "../../src/map/write-water.js";
import { rasterizeTerrain, terrainHeightAt } from "../../src/terrain/rasterize.js";
import { writeCellAttribute } from "../../src/terrain/write-cell-attribute.js";
import { buildMissionTriggers } from "../../src/triggers/build-mission-triggers.js";
import { writeMapScript } from "../../src/triggers/write-map-script.js";
import { writeTriggersXml } from "../../src/triggers/write-triggers-xml.js";

// terrain-test: a level-0 pit (`pit`, cells 20-36 × 56-72) below ground at 8.
const raw = JSON.parse(await readFile(new URL("../fixtures/terrain-test/blueprint.json", import.meta.url), "utf8")) as Record<string, unknown>;
const editorWater = await readFile(new URL("../fixtures/editor-terrain/water/t3Water", import.meta.url));

const pool = { id: "pit", zoneId: "pit", type: "Agria", height: 5.9, states: [{ name: "Flood", height: 7.5 }] };
const parse = (extra: Record<string, unknown> = {}) => MissionBlueprintSchema.parse({ ...raw, water: [pool], ...extra });

describe("water pools (DL-13)", () => {
  it("writes the pool's rectangle as the Editor wrote the same area", () => {
    const ours = t3WaterBuffer(parse());
    expect(ours.length).toBe(editorWater.length);
    // Header, and the rectangle after the 40-byte name: the zone's box widened by 4 cells.
    expect(ours.subarray(0, 32)).toEqual(editorWater.subarray(0, 32));
    expect(ours.subarray(72)).toEqual(editorWater.subarray(72));
    expect([0, 4, 8, 12].map((k) => ours.readFloatLE(72 + k))).toEqual([16, 52, 40, 76]);
    expect(ours.toString("ascii", 32, 32 + "Agria_Pit".length)).toBe("Agria_Pit");
    expect(poolWaterId(parse().water[0]!)).toBe("Agria_Pit");
  });

  it("gives each pool its own copy of the stock type, with its states", () => {
    const xml = waterDataXml(parse())!;
    expect(xml).toContain('<CWater id="Agria_Pit" parent="Agria">');
    expect(xml).toMatch(/<State index="0">\r\n\s+<Name value="\[Default\]"\/>\r\n\s+<Height value="5.900000"\/>/);
    // Agria's look (the core default state) carried into both states.
    expect(xml.match(/<Color value="0.100000,0.350000,0.500000,0.300000"\/>/g)).toHaveLength(2);
    expect(xml).toMatch(/<State index="1">\r\n\s+<Name value="Flood"\/>\r\n\s+<Height value="7.500000"\/>/);
    expect(waterDataXml(MissionBlueprintSchema.parse(raw))).toBeUndefined();
  });

  it("raises a pool from a transition, without holding up the light", () => {
    const blueprint = parse({
      transitions: [{ id: "flood", cue: { type: "missionStart" }, afterSeconds: 10, water: { poolId: "pit", state: "Flood", seconds: 12 } }],
    });
    const doc = buildMissionTriggers(blueprint);
    const script = writeMapScript({ mapName: blueprint.title, triggers: doc });
    expect(script).toContain('WaterSetState("Agria_Pit|Flood", 12.0, c_wtcLinear);');
    expect(writeTriggersXml(doc)).toContain('<ValueType Type="water"/>');
  });

  it("rejects an unknown pool or state, and a transition that changes nothing", () => {
    const issues = (transition: Record<string, unknown>): string[] => {
      const result = MissionBlueprintSchema.safeParse({ ...raw, water: [pool], transitions: [transition] });
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };
    const base = { id: "t", cue: { type: "missionStart" } };
    expect(issues({ ...base, water: { poolId: "lake", state: "Flood" } })).toEqual(["Unknown water pool: lake"]);
    expect(issues({ ...base, water: { poolId: "pit", state: "Drain" } })).toEqual(["Pool pit has no state Drain"]);
    expect(issues({ ...base, water: { poolId: "pit", state: "default" } })).toEqual([]);
    expect(issues(base)).toEqual(["A transition changes the light, the water or both"]);
  });

  describe("on the terrain", () => {
    const rocks = { dressing: { cliffs: { spacing: 2, natural: { large: ["ZerusRockLarge"], small: ["AgriaDebris"] } } } };
    const blueprint = parse({ ...rocks, water: [{ ...pool, states: [{ name: "Flood", height: 9 }, { name: "Dry", height: -1 }] }] });
    const terrain = rasterizeTerrain(blueprint);

    it("warns about a height that doesn't show or spills out", () => {
      const warnings = waterWarnings(blueprint, terrain);
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toMatch(/pit \(Flood\): height 9 is over the ground at its edge/);
      expect(warnings[1]).toMatch(/pit \(Dry\): height -1 is at or under the zone's floor/);
    });

    it("dresses nothing under the water", () => {
      // By cell, as the compiler masks it: the bank's slope may dip under the surface within a dry cell.
      const submerged = (doodads: readonly { x: number; y: number }[]) =>
        doodads.filter(
          (d) => d.x > 16 && d.x < 40 && d.y > 52 && d.y < 76 && terrainHeightAt(terrain, 128, Math.floor(d.x) + 0.5, Math.floor(d.y) + 0.5) < 5.9,
        );
      expect(submerged(expandDressing(MissionBlueprintSchema.parse({ ...raw, ...rocks }), terrain).doodads).length).toBeGreaterThan(0);
      expect(submerged(expandDressing(blueprint, terrain).doodads)).toEqual([]);
    });
  });

  describe("dug into a play level (1-8's ponds)", () => {
    // A pond on the ground level (8): an irregular zone listed after the field, so it owns its cells.
    const pond = { id: "pond", name: "Pond", landform: "flat", role: "path", connections: [], polygon: [{ x: 56, y: 56 }, { x: 70, y: 54 }, { x: 74, y: 64 }, { x: 66, y: 74 }, { x: 54, y: 68 }], elevation: 1 };
    const zones = [...(raw.zones as unknown[]), pond];
    const blueprint = parse({ zones, water: [{ id: "pond", zoneId: "pond", type: "Agria", height: 7.55, dig: { depth: 4 } }] });
    const terrain = rasterizeTerrain(blueprint);
    const at = (x: number, y: number) => terrainHeightAt(terrain, 128, x, y);

    it("sinks the zone into a bowl on its own level, without a cliff", () => {
      expect(at(64, 64)).toBeLessThan(5);
      expect(at(64, 64)).toBeGreaterThan(2.5);
      expect(at(48, 64)).toBeGreaterThan(7.6);
      expect(at(80, 64)).toBeGreaterThan(7.6);
      expect(terrain.cliffCells.some((cell) => {
        const x = (cell.index % 64) * 2;
        const y = Math.floor(cell.index / 64) * 2;
        return x >= 50 && x <= 78 && y >= 50 && y <= 78;
      })).toBe(false);
      expect(waterWarnings(blueprint, terrain)).toEqual([]);
    });

    it("paints the flooded sub-cells unpathable, and nothing outside the pond", () => {
      // Each cell is 2 × 4 sub-cells; bit (row < 2 ? 4 : 0) + 2 × column + row % 2, row 0 at the bottom.
      let whole = 0;
      let partial = 0;
      terrain.noPathing.forEach((bits, cell) => {
        const [x, y] = [cell % 128, Math.floor(cell / 128)];
        if (bits === 255) whole++;
        else if (bits !== 0) partial++;
        if (bits === 0) return;
        expect(x >= 51 && x <= 77 && y >= 51 && y <= 77).toBe(true);
        for (let row = 0; row < 4; row++) {
          for (let column = 0; column < 2; column++) {
            const painted = (bits >> ((row < 2 ? 4 : 0) + 2 * column + (row % 2))) & 1;
            expect(painted === 1).toBe(at(x + (column + 0.5) / 2, y + (row + 0.5) / 4) < 7.55);
          }
        }
      });
      expect(whole).toBeGreaterThan(80);
      expect(partial).toBeGreaterThan(20);
      expect(terrain.noPathing[64 * 128 + 64]).toBe(255);
      expect(rasterizeTerrain(parse()).noPathing.every((value) => value === 0)).toBe(true);
    });

    it("writes the paint as the Editor's CellAttribute_Pnp", () => {
      const file = writeCellAttribute(terrain.noPathing);
      expect(file.length).toBe(4 + 128 * 128);
      expect([...file.subarray(0, 4)]).toEqual([0, 0, 2, 0]);
      expect(file[4 + 64 * 128 + 64]).toBe(255);
    });
  });
});
