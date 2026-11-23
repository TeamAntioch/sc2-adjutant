// Who owns each part of a Map Package, decided once before writeMapPackage writes anything (ADR-0010).
//
// A package is one of three modes: a melee map, a Mission compiled whole, or a Mission compiled
// beside Kept terrain (the package's terrain, map info and triggers stay as the Editor saved them).
// The plan says, for each part of the package, whether the compile writes it, the package keeps it,
// or the compile patches it in place, and holds the preconditions a Kept package must meet and
// the words they are refused in. It reads no file: the caller passes what it found.
//
// writeMapPackage's sections ask the plan; PackageOutput (out.keep, out.remove, out.patchKept)
// carries it out.

import { hasKeptTerrain, type MissionBlueprint } from "../domain/mission-blueprint.js";
import { componentVersionFileName } from "./write-component-version.js";

export type PackageMode = "melee" | "compiled" | "beside-kept";

/** The compile writes the part, the package keeps it as the Editor saved it, or the compile changes the package's own in place. */
export type Owner = "compile" | "package" | "patch";

/**
 * The parts of a package that change hands:
 *  - terrain: the t3 terrain files, their cell flags and water; beside Kept ground the Zones that generate write into the package's cell by cell;
 *  - pathing: CellAttribute_Pnp;
 *  - lightingMap: the lighting regions' mask;
 *  - mapInfo: MapInfo and Minimap.tga (the Blueprint's bounds.playable patches them in place), with DocumentInfo and DocumentHeader;
 *  - missionData: the catalogs, game strings and hotkeys the Blueprint's triggers and Mechanics bring, and the map's name strings;
 *  - doodadCatalogs: the Blueprint's own doodads' ModelData and ActorData, merged by entry beside Kept ones;
 *  - triggers: Triggers and MapScript.galaxy, the Mission's spliced in beside the Kept ones;
 *  - componentList: ComponentList.SC2Components, gaining only the components the compile adds.
 */
export type PackagePart = "terrain" | "pathing" | "lightingMap" | "mapInfo" | "missionData" | "doodadCatalogs" | "triggers" | "componentList";

export type OwnershipInput = {
  readonly blueprint: Pick<MissionBlueprint, "id" | "zones" | "kept">;
  readonly outputDir: string;
  /** Whether the compile writes a melee map (options.melee given). */
  readonly melee: boolean;
};

/** A part beside Kept terrain: who owns it, and the files the package keeps whole for it (the terrain, the map's size, players, dependencies and header). */
export type BesideKeptPart = { readonly owner: Owner; readonly files?: readonly string[] };

/**
 * The one source for a package beside Kept terrain (a package compiled whole has the compile own
 * every part). The plan's owner(), keptFiles, componentListKind and writesTriggers all read it, and
 * a part the compile owns keeps no files.
 */
export const BESIDE_KEPT: Readonly<Record<PackagePart, BesideKeptPart>> = {
  terrain: {
    owner: "patch",
    files: ["t3Terrain.xml", "t3HeightMap", "t3SyncHeightMap", "t3SyncCliffLevel", "t3TextureMasks", "t3SyncTextureInfo", "t3CellFlags", "t3Water", componentVersionFileName("t3Terrain.xml")],
  },
  pathing: { owner: "package", files: ["CellAttribute_Pnp"] },
  lightingMap: { owner: "package" },
  mapInfo: {
    owner: "patch",
    files: ["Minimap.tga", "MapInfo", "DocumentInfo", "DocumentHeader", componentVersionFileName("MapInfo"), componentVersionFileName("DocumentInfo")],
  },
  missionData: { owner: "package" },
  doodadCatalogs: { owner: "patch" },
  triggers: { owner: "patch" },
  componentList: { owner: "patch" },
};

export type OwnershipPlan = {
  readonly mode: PackageMode;
  readonly melee: boolean;
  /** A Blueprint with Kept terrain, compiled in its own package. */
  readonly besideKept: boolean;
  /** Whether the compile writes, keeps or patches the part. */
  owner(part: PackagePart): Owner;
  /** The files the package keeps whole, for PackageOutput.keep; none unless beside Kept terrain. */
  readonly keptFiles: readonly string[];
  /** The kind the ComponentList is written as. */
  readonly componentListKind: "components" | "kept-components";
  /** The refusal if the package can't be compiled beside: it needs a compile record and a MapInfo. */
  packageRefusal(hasRecord: boolean, hasMapInfo: boolean): string | undefined;
  /**
   * The refusal if Kept References are built with no compile record to keep their Kept triggers from
   * being written over. A reference to one of the Blueprint's own triggers (`blueprintTriggers`, by
   * element Id; ADR-0026) names nothing in the package, so it needs no record.
   */
  keptReferencesRefusal(buildsMissionTriggers: boolean, hasRecord: boolean, blueprintTriggers?: ReadonlySet<string>): string | undefined;
  /** Whether the compile writes triggers: asked for, and beside Kept terrain only if it has any to splice in. */
  writesTriggers(requested: boolean, splicesAny: boolean): boolean;
  /** The refusal if the compile's triggers have no Kept Triggers file to go beside. */
  triggersRefusal(writesTriggers: boolean, hasTriggers: boolean): string | undefined;
  /** The refusal if a held Kept trigger has no package to hold it in. */
  holdsRefusal(hasTriggers: boolean): string | undefined;
};

/** Decides the ownership of the package the options describe; `table` is BESIDE_KEPT, a parameter so a test can flip an entry. */
export function planOwnership(input: OwnershipInput, table: Readonly<Record<PackagePart, BesideKeptPart>> = BESIDE_KEPT): OwnershipPlan {
  const { blueprint, outputDir, melee } = input;
  const besideKept = !melee && hasKeptTerrain(blueprint);
  const mode: PackageMode = melee ? "melee" : besideKept ? "beside-kept" : "compiled";
  const owner = (part: PackagePart): Owner => (besideKept ? table[part].owner : "compile");
  return {
    mode,
    melee,
    besideKept,
    owner,
    keptFiles: besideKept ? Object.values(table).flatMap((part) => (part.owner === "compile" ? [] : (part.files ?? []))) : [],
    componentListKind: owner("componentList") === "compile" ? "components" : "kept-components",
    packageRefusal: (hasRecord, hasMapInfo) =>
      besideKept && (!hasRecord || !hasMapInfo)
        ? `${blueprint.id} ${blueprint.zones.length === 0 ? "has no Zones, so every terrain cell is Kept Content" : "has Kept terrain beside its Zones"}, and ${outputDir} isn't a Map Package with a compile record to keep it from: compile the Mission in place, into its own package (no output folder), or import a map for it (import-map)`
        : undefined,
    keptReferencesRefusal: (buildsMissionTriggers, hasRecord, blueprintTriggers = new Set()) =>
      buildsMissionTriggers && !hasRecord && blueprint.kept.some((reference) => !(reference.kind === "trigger" && blueprintTriggers.has(String(reference.editorId))))
        ? `${blueprint.id} has Kept References, but ${outputDir} has no compile record, so its triggers would be written whole over the Kept Content they name: compile the Mission in place, into its own package (no output folder), once it has a record (import-map writes one)`
        : undefined,
    writesTriggers: (requested, splicesAny) => requested && (owner("triggers") === "compile" || splicesAny),
    triggersRefusal: (writesTriggers, hasTriggers) =>
      writesTriggers && besideKept && !hasTriggers ? `${outputDir} has no Triggers for the compile's triggers to go beside: add a trigger in the Editor and save the map, then compile again` : undefined,
    holdsRefusal: (hasTriggers) => (besideKept && hasTriggers ? undefined : `${blueprint.id} holds a Kept trigger, but ${outputDir} has no Kept triggers to hold`),
  };
}
