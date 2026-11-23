// Compiles a Melee Map Blueprint into a Map Package the Editor calls Melee (#213): what the
// `compile-melee-map` CLI and the MCP server's `compile_melee_map` tool both run. The blueprint's
// half is turned into the whole map (#214, rotate-half.ts); the terrain and the resource bases go
// through the Mission compiler's writer, keeping to the rotation; `writeMapPackage`'s melee option
// writes the players, start locations, trigger and catalogs a melee map must have. Every resource
// base is the standard melee base, each main's ramp the diagonal ramp with a plate at its foot
// (#215, melee-mains.ts). The melee checks run on what's drawn and written (#216,
// melee-checks.ts, melee-status.ts): an error stops the build with nothing written to `outputDir`,
// and the distance report and its warnings come back with the map.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, cp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { isResourceBase, type MeleeMapBlueprint, MeleeMapBlueprintSchema, meleePlayableBounds } from "../domain/melee-map-blueprint.js";
import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { MainRampError } from "../terrain/rasterize.js";
import { formatIssues } from "../util/format-issues.js";
import { packageModes } from "../util/package-file-mode.js";
import { townHallSpot } from "./expand-placements.js";
import { checkMeleeMap, type MeleeReport } from "./melee-checks.js";
import { meleeMains, placeMeleeUnits, withRotatedMains } from "./melee-mains.js";
import { type MeleeFinding, MeleeRuleError, meleeError } from "./melee-rules.js";
import { forbiddenFeatures, meleeStatusReasons, readMeleePackage } from "./melee-status.js";
import { rotateHalf } from "./rotate-half.js";
import { VOID_MOD } from "./write-document-info-xml.js";
import { writeMapPackage } from "./write-map-package.js";

export type CompileMeleeMapOptions = {
  /** Timestamp recorded in each component's .version file; defaults to now. */
  readonly savedAt?: Date;
};

export type CompiledMeleeMap = {
  /** The whole map: the half and its rotation. */
  readonly blueprint: MeleeMapBlueprint;
  /** Advice from drawing the terrain and placing the units. */
  readonly warnings: readonly string[];
  /** The distance report, with the melee rules' warnings. */
  readonly report: MeleeReport;
};

export async function compileMeleeMap(blueprintPath: string, outputDir: string, options: CompileMeleeMapOptions = {}): Promise<CompiledMeleeMap> {
  return writeMeleeMap(await readMeleeMapBlueprint(blueprintPath), outputDir, options);
}

/**
 * Writes a parsed Melee Map Blueprint's Map Package to `outputDir`: its half and the half turned
 * 180°. Throws a MeleeRuleError, writing nothing there, if the map breaks a melee rule.
 */
export async function writeMeleeMap(half: MeleeMapBlueprint, outputDir: string, options: CompileMeleeMapOptions = {}): Promise<CompiledMeleeMap> {
  const halfMains = meleeMains(half);
  const { blueprint, symmetry } = rotateHalf(half);
  const mains = withRotatedMains(halfMains, symmetry);
  const starts = startLocations(blueprint);
  let report: MeleeReport | undefined;
  // Written beside the target first, and copied over it only once the written map passes.
  const staging = path.join(path.dirname(path.resolve(outputDir)), `.${path.basename(outputDir)}.${randomUUID()}.tmp`);
  try {
    const { warnings } = await writeMapPackage({
      blueprint: terrainBlueprint(blueprint),
      outputDir: staging,
      includeObjects: true,
      playableBounds: meleePlayableBounds(blueprint),
      // Void (Mod) alone, as on every ladder map: the game adds the multiplayer balance mods for melee.
      dependencies: [VOID_MOD],
      melee: {
        startLocations: starts,
        symmetry,
        diagonalRampsOnto: new Set(mains.map((main) => main.zoneId)),
        placeUnits: (terrain) => {
          const placed = placeMeleeUnits(blueprint, mains, terrain, symmetry);
          const checked = checkMeleeMap({ blueprint, mains, terrain, units: placed.units, starts, symmetry });
          if (checked.errors.length > 0) throw new MeleeRuleError(checked.errors);
          report = checked.report;
          return placed;
        },
      },
      ...(options.savedAt ? { savedAt: options.savedAt } : {}),
    });
    const written = await readMeleePackage(staging);
    const errors: MeleeFinding[] = [
      ...meleeStatusReasons(written).map((reason): MeleeFinding => ({ rule: "melee-status", object: "the map", message: reason })),
      ...forbiddenFeatures(written.objects),
    ];
    if (errors.length > 0) throw new MeleeRuleError(errors);
    // Each file keeps the mode it has in the package, a new one the package's (cp gives them the staging copy's).
    const modes = packageModes(outputDir);
    const files = (await readdir(staging, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.relative(staging, path.join(entry.parentPath, entry.name)));
    const wanted = await Promise.all(files.map(async (file) => [file, await modes.modeFor(path.join(outputDir, file))] as const));
    await cp(staging, outputDir, { recursive: true, force: true });
    for (const [file, mode] of wanted) await chmod(path.join(outputDir, file), mode);
    // The writer removes a stale no-pathing layer from its own folder; do the same here.
    if (!existsSync(path.join(staging, "CellAttribute_Pnp"))) await rm(path.join(outputDir, "CellAttribute_Pnp"), { force: true });
    return { blueprint, warnings, report: report! };
  } catch (error) {
    if (error instanceof MainRampError) meleeError("main-ramp", `main ${error.mainId}`, error.detail);
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function readMeleeMapBlueprint(blueprintPath: string): Promise<MeleeMapBlueprint> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(blueprintPath, "utf8"));
  } catch (error) {
    throw new Error(`Can't read the Melee Map Blueprint ${blueprintPath}: ${(error as Error).message}`, { cause: error });
  }
  const parsed = MeleeMapBlueprintSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid Melee Map Blueprint ${blueprintPath}: ${formatIssues(parsed.error, "(blueprint)")}`);
  return parsed.data;
}

/** Each start base's town-hall centre, in `starts` order: where MeleeInitUnits puts each player's town hall. */
function startLocations(blueprint: MeleeMapBlueprint): { x: number; y: number }[] {
  return blueprint.starts.map((id) => {
    const [x, y] = townHallSpot(blueprint.placements.find((placement) => placement.id === id)!.params.at);
    return { x, y };
  });
}

/** The melee map as the Mission compiler's terrain and placements read it: a Mission with no story. */
function terrainBlueprint(melee: MeleeMapBlueprint): MissionBlueprint {
  return {
    id: melee.id,
    campaignId: "melee",
    title: melee.title,
    ...(melee.summary ? { summary: melee.summary } : {}),
    setting: melee.summary ?? melee.title,
    mapSize: melee.mapSize,
    ...(melee.tilesetId ? { tilesetId: melee.tilesetId } : {}),
    ...(melee.lighting ? { lighting: melee.lighting } : {}),
    ...(melee.textures ? { textures: melee.textures } : {}),
    ...(melee.texturePalette ? { texturePalette: melee.texturePalette } : {}),
    ...(melee.cliffPalette ? { cliffPalette: melee.cliffPalette } : {}),
    ...(melee.raggedCliffs !== undefined ? { raggedCliffs: melee.raggedCliffs } : {}),
    ...(melee.terrainSeed ? { terrainSeed: melee.terrainSeed } : {}),
    lights: [],
    transitions: [],
    uiActions: [],
    water: [],
    zones: melee.zones.map((zone) => ({ ...zone, connections: zone.connections.map((connection) => ({ ...connection })) })),
    anchors: [],
    kept: [],
    // Rocks are units the melee path places itself; the Mission placements have no such kind.
    placements: melee.placements.filter(isResourceBase).map((placement) => ({ id: placement.id, zoneId: placement.zoneId, kind: placement.kind, params: { ...placement.params } })),
    composites: [],
    doodads: [],
    regions: [],
    beats: [],
    objectives: [],
    encounters: [],
    waves: [],
    ramps: melee.ramps,
    terrainObjects: melee.terrainObjects,
    outcomes: { victory: [], defeat: [] },
    mechanics: [],
    tech: [],
    screenplay: { title: melee.title, scenes: [] },
  };
}
