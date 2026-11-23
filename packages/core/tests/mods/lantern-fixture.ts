// Lantern-Story, a synthetic Campaign Mod defining its own tilesets, texture, units and Light, in a
// throwaway copy of the crossing Workspace that names it as its Campaign Mod in its own config, so
// no Plugin is involved. Its package holds the Kept entries; its Blueprint owns one more tileset.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WORKSPACE_FILE } from "../../src/plugins/workspace.js";
import { put } from "./mod-fixture.js";

export const CROSSING = fileURLToPath(new URL("../fixtures/workspaces/crossing/", import.meta.url));

const terrainData = (texture: string) => `<?xml version="1.0" encoding="us-ascii"?>
<Catalog>
    <CTerrain id="LanternCoast">
        <Lighting value="LanternDusk"/>
        <BlendTextures value="${texture}"/>
        <BlendTextures value="MeinhoffWhiteSand"/>
        <BlendTextures value="MeinhoffRoughSand"/>
        <BlendTextures value="MeinhoffCraters"/>
        <BlendTextures value="MeinhoffRock"/>
        <BlendTextures value="MeinhoffConcrete"/>
        <BlendTextures value="MeinhoffPanels"/>
        <BlendTextures value="MeinhoffGrating"/>
        <CliffSets value="MeinhoffEx1Cliff0"/>
        <CliffSets value="MeinhoffEx1Cliff1"/>
        <FixedSkyboxModel value="LanternSky"/>
        <FogEnabled value="1"/>
        <FogColor value="255,40,60,90"/>
    </CTerrain>
</Catalog>
`;

const terrainTexData = (texture: string) => `<?xml version="1.0" encoding="us-ascii"?>
<Catalog>
    <CTerrainTex id="${texture}">
        <Texture value="Assets\\Textures\\${texture}.dds"/>
    </CTerrainTex>
</Catalog>
`;

const UNIT_DATA = `<?xml version="1.0" encoding="us-ascii"?>
<Catalog>
    <CUnit id="SignalBeacon" parent="DESTRUCTIBLE">
        <LifeMax value="25"/>
    </CUnit>
    <CUnit id="LanternKite" parent="Medivac"/>
</Catalog>
`;

const LIGHT_DATA = `<?xml version="1.0" encoding="us-ascii"?>
<Catalog>
    <CLight id="LanternDusk" parent="Shakuras"/>
</Catalog>
`;

/** Blueprint-owned: a second tileset on the Kept one, as generic entries. */
const ENTRIES = [
  {
    catalog: "Terrain",
    class: "CTerrain",
    id: "LanternReef",
    parent: "LanternCoast",
    fields: { CliffSets: [{ value: "MeinhoffEx1Cliff1" }, { value: "MeinhoffEx1Cliff0" }], HideLowestLevel: 1 },
  },
];

/** The crossing Mission's speakers. */
const CHARACTERS = ["KARAX", "ZERATUL", "ARTANIS"].map((speaker) => ({ speaker, id: `Char${speaker[0]}${speaker.slice(1).toLowerCase()}` }));

const roots: string[] = [];
/** Removes the Workspaces made: give it to afterEach. */
export async function cleanupLantern(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

/**
 * The crossing fixture with Lantern-Story imported and, unless `named` is false, named as its
 * Campaign Mod. Its LanternCoast's first blend texture is the mod's own `texture`, LanternShingle by default.
 */
export async function lanternWorkspace({ named = true, texture = "LanternShingle" }: { readonly named?: boolean; readonly texture?: string } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-catalog-layer-"));
  roots.push(root);
  await cp(CROSSING, root, { recursive: true });
  const config = JSON.parse(await readFile(path.join(root, WORKSPACE_FILE), "utf8")) as Record<string, unknown>;
  await writeFile(path.join(root, WORKSPACE_FILE), JSON.stringify({ ...config, mods: ["lantern-story"], ...(named ? { campaignMod: "Lantern-Story" } : {}) }, null, 2));
  const mod = path.join(root, "mods", "lantern-story");
  await put(path.join(mod, "blueprint.json"), JSON.stringify({ id: "lantern-story", kind: "campaign", entries: [{ source: "entries/terrain.json" }], characters: CHARACTERS }, null, 2));
  await put(path.join(mod, "entries", "terrain.json"), JSON.stringify(ENTRIES, null, 2));
  await put(path.join(mod, "compile-record.json"), JSON.stringify({ version: 1, entries: [] }));
  const pkg = path.join(mod, "Lantern-Story.SC2Mod");
  await put(path.join(pkg, "DocumentInfo"), `<?xml version="1.0" encoding="utf-8"?>\n<DocInfo/>\n`);
  const gameData = path.join(pkg, "Base.SC2Data", "GameData");
  await put(path.join(gameData, "TerrainData.xml"), terrainData(texture));
  await put(path.join(gameData, "TerrainTexData.xml"), terrainTexData(texture));
  await put(path.join(gameData, "UnitData.xml"), UNIT_DATA);
  await put(path.join(gameData, "LightData.xml"), LIGHT_DATA);
  const blueprintPath = path.join(root, "missions", "ashen-crossing", "blueprint.json");
  return { root, blueprintPath };
}

/** Puts the Mission on `tilesetId` with the tileset's own textures, the mod's Light and its beacon allowed. */
export async function useLantern(blueprintPath: string, tilesetId: string): Promise<void> {
  const blueprint = JSON.parse(await readFile(blueprintPath, "utf8")) as Record<string, unknown>;
  delete blueprint["textures"];
  await writeFile(
    blueprintPath,
    JSON.stringify({ ...blueprint, tilesetId, lighting: "LanternDusk", tech: [{ player: 1, allow: { units: ["SignalBeacon", "LanternKite", "Marine"], buildings: [], upgrades: [] } }] }, null, 2),
  );
}
