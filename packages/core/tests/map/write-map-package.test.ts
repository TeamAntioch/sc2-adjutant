import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readMapInfoFields } from "../../src/map/read-map-info-fields.js";
import { writeMapPackage } from "../../src/map/write-map-package.js";
import { withFog } from "../support/map-info-fog.js";
import { CrossingBlueprintSchema, crossingRaw } from "../support/workspaces.js";

// Without its script: voice files are generated locally (npm run tts) and not checked in.
// With a local campaign mod as its dependency, as a Campaign's Missions have.
const blueprint = CrossingBlueprintSchema.parse(withoutScript({ ...crossingRaw, dependencies: ["file:Mods\\Example-Campaign.SC2Mod"] } as never));

function withoutScript(raw: { screenplay: { script?: unknown } }): unknown {
  const { script: _script, ...screenplay } = raw.screenplay;
  return { ...raw, screenplay };
}

describe("writeMapPackage", () => {
  let outputDir: string | undefined;

  afterEach(async () => {
    if (outputDir) {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("writes blueprint dependencies into DocumentInfo", async () => {
    outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-"));
    await writeMapPackage({ blueprint, outputDir });

    const documentInfo = await readFile(path.join(outputDir, "DocumentInfo"), "utf8");
    expect(documentInfo).toContain("<Value>file:Mods\\Example-Campaign.SC2Mod</Value>");
    expect(documentInfo).not.toContain("Void.SC2Mod");
  });

  it("starts a Mission's unexplored ground under Black Mask (MapInfo fog Black), as Blizzard's campaign maps do", async () => {
    outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-"));
    await writeMapPackage({ blueprint, outputDir });

    expect(readMapInfoFields(await readFile(path.join(outputDir, "MapInfo"))).fog).toBe("Black");
  });

  it("starts a Mission under Grey Mask (fog Dark) when its Blueprint asks for grey Unexplored Areas", async () => {
    outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-"));
    const grey = CrossingBlueprintSchema.parse(withoutScript({ ...crossingRaw, unexploredAreas: "grey" } as never));
    await writeMapPackage({ blueprint: grey, outputDir });

    expect(readMapInfoFields(await readFile(path.join(outputDir, "MapInfo"))).fog).toBe("Dark");
  });

  it("starts a Mission under Black Mask (Reduced Radius) (fog BlackNoUnhide) when its Blueprint asks for it, as the Editor saves it", async () => {
    outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-"));
    const reduced = CrossingBlueprintSchema.parse(withoutScript({ ...crossingRaw, unexploredAreas: "black-reduced-radius" } as never));
    await writeMapPackage({ blueprint: reduced, outputDir });
    const written = await readFile(path.join(outputDir, "MapInfo"));

    expect(readMapInfoFields(written).fog).toBe("BlackNoUnhide");
    // The Editor's change on 01-02: the fog string and nothing else, the hash included.
    await writeMapPackage({ blueprint, outputDir });
    expect(written.equals(withFog(await readFile(path.join(outputDir, "MapInfo")), "BlackNoUnhide"))).toBe(true);
  }, 30_000);

  it("refuses an Unexplored Areas the Editor doesn't have", () => {
    expect(CrossingBlueprintSchema.safeParse(withoutScript({ ...crossingRaw, unexploredAreas: "BlackNoUnhide" } as never)).success).toBe(false);
  });

  it("writes the same default dependencies into DocumentInfo and DocumentHeader", async () => {
    outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-"));
    const { dependencies: _dependencies, ...withoutDependencies } = blueprint;
    // Parsed again, so its Plugins (its Mechanics) are bound to it.
    await writeMapPackage({ blueprint: CrossingBlueprintSchema.parse(withoutDependencies), outputDir });

    const voidMod = "bnet:Void (Mod)/0.0/999,file:Mods/Void.SC2Mod";
    // Ashen Crossing's RockTower comes from the Wings of Liberty campaign package, so the compiler
    // adds the Void campaign to the default.
    const voidCampaign = "bnet:Void (Campaign)/0.0/999,file:Campaigns/Void.SC2Campaign";
    const documentInfo = await readFile(path.join(outputDir, "DocumentInfo"), "utf8");
    expect(documentInfo).toContain(`<Value>${voidMod}</Value>`);
    expect(documentInfo).toContain(`<Value>${voidCampaign}</Value>`);

    const header = await readFile(path.join(outputDir, "DocumentHeader"));
    expect(header.readUInt32LE(44)).toBe(2);
    expect(header.subarray(48, 48 + voidMod.length + 1).toString("utf8")).toBe(`${voidMod}\0`);
    expect(header.subarray(48 + voidMod.length + 1, 48 + voidMod.length + 1 + voidCampaign.length + 1).toString("utf8")).toBe(`${voidCampaign}\0`);
  });

  it("writes a .version file for every listed component", async () => {
    outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-"));
    await writeMapPackage({ blueprint, outputDir, includeObjects: true, includeRegions: true });

    const componentList = await readFile(path.join(outputDir, "ComponentList.SC2Components"), "utf8");
    const paths = [...componentList.matchAll(/>([^<]+)<\/DataComponent>/g)].map((match) => match[1]);
    expect(paths).toEqual(["DocumentInfo", "MapInfo", "t3Terrain.xml", "Objects", "Regions"]);

    for (const componentPath of ["DocumentInfo", "MapInfo", "t3Terrain", "Objects", "Regions"]) {
      const version = await readFile(path.join(outputDir, `${componentPath}.version`));
      expect(version.length).toBe(44);
      expect(version.toString("ascii", 0, 4)).toBe("cdes");
    }
  });

  it("writes trigger components when includeTriggers is set", async () => {
    outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-"));
    await writeMapPackage({ blueprint, outputDir, includeObjects: true, includeTriggers: true });

    const componentList = await readFile(path.join(outputDir, "ComponentList.SC2Components"), "utf8");
    expect(componentList).toContain('<DataComponent Type="text" Locale="enUS">GameText</DataComponent>');
    expect(componentList).toContain('<DataComponent Type="trig">Triggers</DataComponent>');
    for (const file of ["DocumentHeader", "Triggers", "Triggers.version", "GameText.version", "MapScript.galaxy"]) {
      await expect(readFile(path.join(outputDir, file))).resolves.toBeDefined();
    }
    const gameStrings = await readFile(path.join(outputDir, "enUS.SC2Data", "LocalizedData", "GameStrings.txt"), "utf8");
    expect(gameStrings).toContain(`DocInfo/Name=${blueprint.title}`);
  });

  it("writes game data catalogs as a gada component", async () => {
    outputDir = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-"));
    await writeMapPackage({ blueprint, outputDir, gameData: { "LightData.xml": "<Catalog/>" } });

    const componentList = await readFile(path.join(outputDir, "ComponentList.SC2Components"), "utf8");
    expect(componentList).toContain('<DataComponent Type="gada">GameData</DataComponent>');
    await expect(readFile(path.join(outputDir, "Base.SC2Data", "GameData", "LightData.xml"), "utf8")).resolves.toBe("<Catalog/>");
    await expect(readFile(path.join(outputDir, "GameData.version"))).resolves.toBeDefined();
  });
});
