// A written melee Map Package checked the way the Editor decides "Melee" in Map > Map Status
// (#216; melee research §4 "What makes a map Melee"), and for the features TLMC forbids (§1a).
// Each reason is the Editor's own string (core mod EditorStrings.txt) for the field that breaks
// it; the MapInfo fields are those of the reverse-engineered `MapInfo__CheckNonMeleeConditions`
// (sc2-file-format-docs mapinfo.md). The compiler writes none of these, so a reason here is a
// compiler bug: the build stops before the map reaches the author.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { MeleeFinding } from "./melee-rules.js";
import { readDependencies } from "./read-dependencies.js";
import { readDocumentHeaderDependencies } from "./read-document-header.js";
import { type MapInfoFields, readMapInfoFields } from "./read-map-info-fields.js";
import { VOID_MOD } from "./write-document-info-xml.js";

/** What the Editor reads of a Map Package for its melee status. */
export type MeleePackage = {
  readonly mapInfo: MapInfoFields;
  /** DocumentInfo's dependencies, and DocumentHeader's: the game resolves them from the header. */
  readonly dependencies: { readonly info: readonly string[]; readonly header: readonly string[] };
  /** Catalog files in Base.SC2Data/GameData. */
  readonly gameData: readonly string[];
  /** Whether the package has its own game attributes (an Attributes file). */
  readonly attributes: boolean;
  /** The Triggers file, if any. */
  readonly triggers: string | undefined;
  readonly objects: string;
};

/** The catalogs that keep a map Melee: the ladder maps' cosmetic ones, and ActorData's Doodad Composites (tested 2026-10-31). */
export const MELEE_CATALOGS: ReadonlySet<string> = new Set(["LightData.xml", "WaterData.xml", "TerrainData.xml", "ActorData.xml"]);

/** The stock Melee Initialization trigger's Ntve functions: on map init, then the four MeleeInit calls in order. */
const MELEE_TRIGGER_EVENT = "00000120";
const MELEE_TRIGGER_ACTIONS = ["00000143", "00000145", "00000150", "00000148"];

const CONTROL_NAMES: Readonly<Record<number, string>> = { 1: "User", 2: "Computer", 3: "Neutral", 4: "Hostile" };

export async function readMeleePackage(mapDir: string): Promise<MeleePackage> {
  const optional = async (file: string): Promise<string | undefined> => (existsSync(path.join(mapDir, file)) ? readFile(path.join(mapDir, file), "utf8") : undefined);
  const gameDataDir = path.join(mapDir, "Base.SC2Data", "GameData");
  return {
    mapInfo: readMapInfoFields(await readFile(path.join(mapDir, "MapInfo"))),
    dependencies: {
      info: await readDependencies(mapDir),
      header: readDocumentHeaderDependencies(await readFile(path.join(mapDir, "DocumentHeader"))),
    },
    gameData: existsSync(gameDataDir) ? (await readdir(gameDataDir)).filter((file) => file.endsWith(".xml")) : [],
    attributes: existsSync(path.join(mapDir, "Attributes")),
    triggers: await optional("Triggers"),
    objects: (await optional("Objects")) ?? "",
  };
}

/** Every reason the Editor would give for calling the map Custom, in its own words. None: Melee. */
export function meleeStatusReasons(pkg: MeleePackage): string[] {
  const reasons: string[] = [];
  const { mapInfo: info } = pkg;
  const voidOnly = (list: readonly string[]): boolean => list.length === 1 && list[0] === VOID_MOD;
  if (!voidOnly(pkg.dependencies.info) || !voidOnly(pkg.dependencies.header)) reasons.push("Custom dependencies (see File > Dependencies)");
  if (pkg.attributes) reasons.push("Custom attributes (see Map > Game Attributes)");
  const custom = pkg.gameData.filter((file) => !MELEE_CATALOGS.has(file));
  for (const file of custom) reasons.push(`Custom '${file.replace(/\.xml$/, "")}' game data (${file})`);

  if (info.publishMode !== 0) reasons.push(`Additional expansion data is not allowed, or an Arcade map (see Map > Map Options): publish mode ${info.publishMode}`);
  if (info.localeMode !== 1) reasons.push(`Locale mode is ${info.localeMode}, not 1`);
  if (info.previewType !== 1) reasons.push("Minimap Preview is not set to Map Image");
  if (info.difficulty !== 0) reasons.push("Show User Difficulty is not set to None");
  if (info.fog !== "Dark") reasons.push(`Unexplored Areas is not set to Grey Mask (fog ${info.fog})`);
  if (info.gameOptions & 0x01) reasons.push("Disable Replay Recording is set");
  if (info.gameOptions & 0x10) reasons.push("Use Horizontal Field Of View is set");
  if (info.loadingScreenType !== 0) reasons.push("Custom loading screen");

  const playing = info.players.filter((player) => player.control === 1 || player.control === 2);
  for (const player of info.players) {
    if (player.control === 2) reasons.push(`Player ${player.id} is set to '${CONTROL_NAMES[player.control]}' control`);
    if (player.race !== "") reasons.push(`Player ${player.id} race is not set to Any (${player.race})`);
    if (player.startLocation !== 0) reasons.push(`Player ${player.id} start location is not set to Random`);
  }
  const owners = new Set([...pkg.objects.matchAll(/<ObjectUnit [^>]*Player="(\d+)"/g)].map((match) => Number(match[1])));
  for (const owner of [...owners].filter((id) => id !== 0).sort((a, b) => a - b)) reasons.push(`Player ${owner} has pre-placed units, but is not Neutral`);
  const locations = [...pkg.objects.matchAll(/<ObjectPoint [^>]*Type="StartLoc"/g)].length;
  if (locations < playing.length) reasons.push(`Not enough Start Locations for all non-neutral players (Players: ${playing.length}, Locations: ${locations})`);

  reasons.push(...triggerReasons(pkg.triggers));
  return reasons;
}

/** The Triggers file against the stock Melee Initialization: one trigger, Ntve calls only, no libraries or other elements. */
function triggerReasons(triggers: string | undefined): string[] {
  const elements = [...(triggers ?? "").matchAll(/<Element Type="(\w+)" Id="(\w+)"(?:\/>|>([\s\S]*?)<\/Element>)/g)].map((match) => ({
    type: match[1]!,
    id: match[2]!,
    body: match[3] ?? "",
  }));
  const found = elements.filter((element) => element.type === "Trigger");
  if (found.length === 0) return ["No triggers exist"];
  const reasons: string[] = [];
  if (/<Library\b/.test(triggers!)) reasons.push("Custom trigger libraries exist");
  if (elements.some((element) => element.type !== "Trigger" && element.type !== "FunctionCall")) reasons.push("Custom trigger elements exist");
  if (found.length > 1) reasons.push("Custom triggers exist");
  // The trigger's calls by Id: an older save numbers each element type apart, so only a FunctionCall is one.
  const byId = new Map(elements.filter((element) => element.type === "FunctionCall").map((element) => [element.id, element]));
  const call = (id: string): string | undefined => {
    const def = /<FunctionDef Type="FunctionDef" Library="Ntve" Id="(\w+)"\/>/.exec(byId.get(id)?.body ?? "");
    return def?.[1];
  };
  const trigger = found[0]!.body;
  const events = [...trigger.matchAll(/<Event Type="FunctionCall" Id="(\w+)"\/>/g)].map((match) => call(match[1]!));
  const actions = [...trigger.matchAll(/<Action Type="FunctionCall" Id="(\w+)"\/>/g)].map((match) => call(match[1]!));
  const onlyCalls = [...trigger.matchAll(/<(\w+)/g)].every((match) => match[1] === "Event" || match[1] === "Action");
  if (events.join() !== MELEE_TRIGGER_EVENT || actions.join() !== MELEE_TRIGGER_ACTIONS.join() || !onlyCalls) {
    reasons.push("Trigger does not match default melee trigger (use Data > Reset All Data to reset)");
  }
  return reasons;
}

/**
 * Unit types the 21 ladder maps place as Neutral (melee research §1 "Watchtowers, rocks and other
 * neutral features"): minerals and geysers with their tileset skins (`LabMineralField`,
 * `SpacePlatformGeyser`) and `MineralField450` walls, plates, rocks and debris, towers,
 * collapsible rocks, inhibitor and acceleration zones, and four critters.
 */
const LADDER_NEUTRALS = /MineralField|Geyser$|^Unbuildable(Rocks|Plates|Bricks)Destructible$|^Destructible|^Debris2x2|^XelNagaTower$|^Collapsible|^(Inhibitor|Acceleration)Zone|^(LabBot|CleaningBot|UtilityBot|Scantipede)$/;

/**
 * The features TLMC forbids on a ladder map (research §1a) in a package's Objects: air sight and
 * air space blockers, neutral force fields, and core-race units or buildings (anything outside the
 * ladder maps' neutral vocabulary) as map objects. Scripted neutral units need triggers, which
 * `meleeStatusReasons` already refuses. Each finding names the object.
 */
export function forbiddenFeatures(objects: string): MeleeFinding[] {
  const findings: MeleeFinding[] = [];
  const at = (position: string): string => position.split(",").slice(0, 2).join(", ");
  for (const match of objects.matchAll(/<ObjectUnit [^>]*Id="(\d+)"[^>]*Position="([^"]+)"[^>]*UnitType="([^"]+)"/g)) {
    const [, id, position, unitType] = match as unknown as [string, string, string, string];
    const object = `${unitType} (object ${id} at ${at(position)})`;
    if (/ForceField/i.test(unitType)) findings.push({ rule: "forbidden-feature", object, message: "a neutral force field" });
    else if (!LADDER_NEUTRALS.test(unitType)) findings.push({ rule: "forbidden-feature", object, message: "not a ladder neutral feature: a core-race unit or building as a map object" });
  }
  for (const match of objects.matchAll(/<ObjectDoodad [^>]*Id="(\d+)"[^>]*Position="([^"]+)"[^>]*Type="([^"]+)"/g)) {
    const [, id, position, type] = match as unknown as [string, string, string, string];
    if (/(Air|Space).*Blocker|Blocker.*(Air|Space)/i.test(type)) findings.push({ rule: "forbidden-feature", object: `${type} (doodad ${id} at ${at(position)})`, message: "an air sight or air space blocker" });
  }
  return findings;
}
