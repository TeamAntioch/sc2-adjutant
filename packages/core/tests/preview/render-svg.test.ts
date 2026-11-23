import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { missionBlueprintSchema } from "../../src/domain/mission-blueprint.js";
import { loadPlugins } from "../../src/plugins/registry.js";
import { renderPreviewSvg } from "../../src/preview/render-svg.js";
import { CrossingBlueprintSchema, crossingRaw } from "../support/workspaces.js";

const blueprint = CrossingBlueprintSchema.parse(crossingRaw);
const svg = renderPreviewSvg(blueprint);

describe("layout preview", () => {
  it("matches the committed map of record (regenerate with vitest -u after renderer changes)", async () => {
    await expect(svg).toMatchFileSnapshot(fileURLToPath(new URL("../fixtures/workspaces/crossing/missions/ashen-crossing/preview.svg", import.meta.url)));
  });

  it("shades a Zone above level 4 darker than level 4, and adds the levels above 3 to the legend in one row", () => {
    const high = CrossingBlueprintSchema.parse({ ...crossingRaw, zones: crossingRaw.zones.map((zone: { id: string }, i: number) => (i === 1 ? { ...zone, elevation: 12 } : zone)) } as never);
    const out = renderPreviewSvg(high);
    const fill = new RegExp(`id="zone-${high.zones[1]!.id}" points="[^"]+" fill="(#[0-9a-f]{6})"`).exec(out)![1]!;
    expect(fill).not.toBe("#d9d2bd");
    expect(fill).not.toBe("#6f5a3f");
    expect(out).toContain(">level 12</text>");
    expect(svg).not.toContain(">level 12</text>");
    const many = CrossingBlueprintSchema.parse({ ...crossingRaw, zones: crossingRaw.zones.map((zone: { id: string }, i: number) => (i === 1 ? { ...zone, elevation: 5 } : i === 2 ? { ...zone, elevation: 15 } : zone)) } as never);
    expect(renderPreviewSvg(many)).toContain(">levels 5-15, darker each level</text>");
  });

  it("draws every zone, anchor and ramp, addressable by id", () => {
    for (const zone of blueprint.zones) expect(svg).toContain(`id="zone-${zone.id}"`);
    for (const anchor of blueprint.anchors) expect(svg).toContain(`id="anchor-${anchor.id}"`);
    expect(svg).toContain('id="ramp-temple_ramp"');
  });

  it("puts north at the top: higher map y is drawn higher", () => {
    // 6 px per cell, 28 px margin, 128 cells tall.
    const templeGate = /id="zone-temple_gate" points="([^"]+)"/.exec(svg)![1]!;
    const landing = /id="zone-landing_zone" points="([^"]+)"/.exec(svg)![1]!;
    const topY = (points: string): number => Math.min(...points.split(" ").map((pair) => Number(pair.split(",")[1])));
    expect(topY(templeGate)).toBe(28 + (128 - 96) * 6);
    expect(topY(templeGate)).toBeLessThan(topY(landing));
  });

  it("marks the goal, and no shelters from a Threat that only deals damage", () => {
    // Shelters are the safe ground of a Mechanic's Threat that fails the Mission; hazard's damages.
    expect(svg).not.toContain("<title>shelter</title>");
    expect(svg.match(/<title>victory<\/title>/g)).toHaveLength(1);
  });

  it("draws a shelter round each safe zone of a Mechanic's Threat that fails the Mission", async () => {
    // The countdown is a fixture Plugin's Mechanic (tests/fixtures/plugins/countdown): a blast over
    // every zone the hero can reach but its shelters, that fails the Mission.
    const plugins = await loadPlugins(fileURLToPath(new URL("../fixtures/", import.meta.url)), [{ source: "bundled:hazard" }, { source: "./plugins/countdown" }]);
    const blast = { id: "blast", type: "countdown", params: { heroAnchorId: "hero_zeratul", shelterZoneIds: ["overhang", "rock_arch", "temple_gate"], firstSeconds: 45, intervalSeconds: 40 } };
    const sheltered = renderPreviewSvg(missionBlueprintSchema(plugins).parse({ ...crossingRaw, mechanics: [...(crossingRaw.mechanics as unknown[]), blast] }));
    const shelters = [...sheltered.matchAll(/<polygon points="([^"]+)"[^>]*><title>shelter<\/title>/g)].map((match) => match[1]);
    const pointsOf = new Map([...sheltered.matchAll(/id="zone-([a-z_]+)" points="([^"]+)"/g)].map((match) => [match[1]!, match[2]!]));
    expect(shelters).toEqual(["overhang", "rock_arch", "temple_gate"].map((id) => pointsOf.get(id)));
  });
});
