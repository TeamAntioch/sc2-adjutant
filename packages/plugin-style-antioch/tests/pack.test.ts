// The Antioch Style Pack as core loads it: a valid manifest, every file it names, and the style rules
// its code contributes, with its rules reaching core through the SDK's types alone.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { compositeFront } from "@team-antioch/sc2-adjutant/src/catalog/stock-catalog.js";
import { CompositeSchema } from "@team-antioch/sc2-adjutant/src/domain/mission-blueprint.js";
import { loadPlugins } from "@team-antioch/sc2-adjutant/src/plugins/registry.js";
import { describe, expect, it } from "vitest";

const PACK = fileURLToPath(new URL("..", import.meta.url));

describe("the Antioch Style Pack", () => {
  it("loads as a Style Pack with its knowledge, Exemplar Maps, Composites, prompts and rules", async () => {
    const manifest = JSON.parse(await readFile(new URL("../sc2-adjutant-plugin.json", import.meta.url), "utf8")) as { contributions: { styleRules: string[] } };
    const registry = await loadPlugins(PACK, [{ source: PACK, roles: ["style-pack"] }]);
    const [plugin] = registry.plugins;
    expect(plugin).toMatchObject({ name: "style-antioch", roles: ["style-pack"] });
    expect(plugin!.contributions.styleRules).toEqual(manifest.contributions.styleRules);
    const knowledge = registry.contributions("knowledge").map((document) => document.id);
    expect(knowledge).toEqual(expect.arrayContaining(["guide", "lessons", "textures", "cliffs", "dressing", "exemplar-maps", "composites"]));
    expect(registry.contributions("exemplarMaps").length).toBeGreaterThan(10);
    expect(registry.contributions("composites").length).toBeGreaterThan(0);
    expect(registry.contributions("prompts").map((prompt) => prompt.name)).toEqual(["add-exemplar-map"]);
    expect(Object.keys(registry.styleRules()).length).toBeGreaterThan(0);
  });

  it("imports only types from core in its rules", async () => {
    const source = await readFile(new URL("../rules.ts", import.meta.url), "utf8");
    const sdk = source.match(/^\s*(?:import|export)\b[^;]*?\bfrom\s*["']@team-antioch\/sc2-adjutant\/plugin-sdk["']/gms) ?? [];
    expect(sdk.length).toBeGreaterThan(0);
    expect(sdk.filter((statement) => !/^\s*(?:import|export)\s+type\b/.test(statement))).toEqual([]);
  });

  it("gives console-bank the front its measured consoles and screens face, so a wall-backed copy faces the room", async () => {
    const recipes = JSON.parse(await readFile(new URL("../blizzard-composites.json", import.meta.url), "utf8")) as { composites: unknown[] };
    const bank = recipes.composites.map((recipe) => CompositeSchema.parse(recipe)).find((recipe) => recipe.id === "console-bank")!;
    expect(bank.front).toBe(225);
    // DOM_LabConsoles at 316° faces 316 + 270; DOM_LabWallScreens at 135° faces 135 + 90: both about 225°.
    const { front: _front, ...unfronted } = bank;
    const measured = (compositeFront(unfronted, undefined, { about: ".", pictures: ".", doodads: {} })! * 180) / Math.PI;
    expect(measured).toBeGreaterThan(220);
    expect(measured).toBeLessThan(230);
    // Its sheet-read monitors don't agree: Blizzard turned one small monitor (yaw 179°) to face about 89°, so the recipe needs its own front.
    expect(compositeFront(unfronted)).toBeUndefined();
  });
});
