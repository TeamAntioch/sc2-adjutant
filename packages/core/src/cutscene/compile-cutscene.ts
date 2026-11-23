// Writes a shot-list cutscene into a compiled map, where the Cutscene Editor opens it and the game
// can play it over the map's own set: what the `compile-cutscene` CLI and the MCP server's
// `compile_cutscene` tool both run.

import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { ShotCameraSchema } from "../domain/cinematic.js";
import { playsAlone, type MissionBlueprint } from "../domain/mission-blueprint.js";
import { lightRegionOverride } from "../map/light-regions.js";
import { mapLights, withLights } from "../map/write-lights.js";
import { blueprintCatalog } from "../catalog/catalog-layer.js";
import { bindLikeOriginal } from "../plugins/plugin-api.js";
import { parseMissionBlueprint, type Workspace } from "../plugins/workspace.js";
import { readMissionScript } from "../script/name-script.js";
import { withCustomScript, withCustomScriptInMapScript } from "../triggers/custom-script.js";
import { writeMapScript } from "../triggers/write-map-script.js";
import { formatIssues } from "../util/format-issues.js";
import { packageModes } from "../util/package-file-mode.js";
import { cinematicPath, compileCinematics, compileTestCinematic, formatCinematicProblem, loadCinematic } from "./cinematic.js";
import { missionCinematicDependencyProblems } from "./cinematic-dependencies.js";
import { missionFeedChannelProblems } from "./feed-channels.js";
import { INDEX_VERSION, playCinematicScript, playShotCutsceneScript, shotCutscene, type ShotCutscene } from "./write-shot-cutscene.js";

export { INDEX_VERSION } from "./write-shot-cutscene.js";
/** The custom script's element id in the Triggers file. */
/** The custom script that plays a shot list from map start: a test loop, which the next compile_map drops. */
export const PLAY_SCRIPT_ID = "C5500002";

export type CompiledCutscene = {
  /** Where the .SC2Cutscene file was written. */
  readonly file: string;
  readonly shots: number;
  /** With `play`: the point it plays from at map start, the shot list's origin. */
  readonly playsFrom?: readonly [number, number];
  /** With `play`, for a Cinematic: it plays from map start in a full-screen dialog, not in the world. */
  readonly inDialog?: true;
  /** With `play`, for a Cinematic whose scene is cued at mission start: its cue plays it, so no loop was added. */
  readonly fromCue?: true;
  /** For a Cinematic: what it films that the map's dependencies don't load, each with the dependency to add (cinematic-dependencies.ts). */
  readonly warnings?: readonly string[];
};

const finite = z.number().finite();
const Vec3Schema = z.tuple([finite, finite, finite]);
const CameraSchema = ShotCameraSchema;
const AnimClipSchema = z.object({ name: z.string().min(1), durationMs: finite, moveSpeed: finite });
/** The shape `shotCutscene` reads, checked before anything is written; other keys are allowed and ignored. */
const ShotCutsceneSchema = z.object({
  light: z.string().optional(),
  origin: Vec3Schema.optional(),
  shots: z.array(
    z.object({
      name: z.string().min(1),
      durationMs: finite.positive(),
      from: CameraSchema,
      to: CameraSchema.optional(),
      move: z.enum(["ease", "linear"]).optional(),
      backdrop: z
        .array(
          z.object({
            model: z.string().min(1),
            at: Vec3Schema,
            name: z.string().optional(),
            rotation: z.union([finite, Vec3Schema]).optional(),
            scale: finite.optional(),
            variation: z.number().int().optional(),
            tint: z.tuple([finite, finite, finite]).optional(),
            anim: z.union([z.string(), AnimClipSchema]).optional(),
            walkTo: z.array(Vec3Schema).optional(),
          }),
        )
        .optional(),
      lights: z
        .array(z.object({ name: z.string().min(1), at: Vec3Schema, color: z.tuple([finite, finite, finite]), strength: finite, range: finite }))
        .optional(),
    }),
  ),
});

/** Reads a shot list (a ShotCutscene) from its JSON file, refused with every problem's path unless it has a shot list's shape. */
export async function readShotCutscene(specPath: string): Promise<ShotCutscene> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(specPath, "utf8"));
  } catch (error) {
    throw new Error(`Can't read the shot list ${specPath}: ${(error as Error).message}`, { cause: error });
  }
  const parsed = ShotCutsceneSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${specPath} isn't a shot list: ${formatIssues(parsed.error, "(shot list)")}`);
  // The file as written, not the parsed copy, so keys the schema doesn't name still reach the writer.
  return raw as ShotCutscene;
}

/**
 * Writes `spec` to `<map>/Base.SC2Data/Cutscenes/<name>.SC2Cutscene`. With `play`, also adds a
 * custom script that plays it in a loop from map start, at the shot list's origin, so Test
 * Document shows it in game. A name the map's triggers play a Cinematic from is refused (ignoring
 * case), since the shot list would replace it.
 */
export async function compileShotCutscene(spec: ShotCutscene, map: string, name: string, { play = false } = {}): Promise<CompiledCutscene> {
  const owner = (await cutscenesPlayedBy(map)).find((played) => played.toLowerCase() === name.toLowerCase());
  if (owner !== undefined) throw new Error(`The map plays a Cinematic ${owner}, and a shot list written as ${name}.SC2Cutscene would replace it; name the shot list something else`);
  const file = `${name}.SC2Cutscene`;
  const written = await writeIntoMap(map, file, shotCutscene(spec), spec.shots.length, play ? { script: playShotCutsceneScript(file, spec.origin), init: "ShotCutscene_Init" } : undefined);
  if (!play) return written;
  const [x, y] = spec.origin ?? [0, 0, 0];
  return { ...written, playsFrom: [x, y] };
}

/**
 * Writes the Mission's Cinematic `id` (checked, and timed from its voice files) into `map`, a
 * package compile-map wrote, which holds the conversation data its lines play from. With `play`, it
 * also plays from map start in a loop, in a full-screen dialog; one whose scene is cued at mission
 * start already plays from there by its cue (compile-map's triggers), so it gets no second loop.
 *
 * A test Cinematic (cinematics/<id>.json, which the Blueprint doesn't list) is written silent, as
 * `<name>.SC2Cutscene` (its id by default). Named after the Cinematic the map's mission start cue
 * plays, it takes that one's place and plays from the cue; the name of any other listed Cinematic is
 * refused, since the test would replace it. Any other name loops it from map start, which a map
 * that plays a Cinematic from its mission start cue refuses, since both would play.
 */
export async function compileCinematicCutscene(workspace: Workspace, blueprintPath: string, id: string, map: string, { play = false, name }: { readonly play?: boolean; readonly name?: string } = {}): Promise<CompiledCutscene> {
  const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
  const entry = blueprint.screenplay.script?.cinematics.find((cinematic) => cinematic.id === id);
  const atStart = (scene: number): boolean => blueprint.screenplay.script?.cues.some((cue) => cue.scene === scene && cue.cue.type === "missionStart" && !playsAlone(cue)) ?? false;
  if (!entry) {
    if (!existsSync(cinematicPath(blueprintPath, id))) throw new Error(`${blueprintPath} lists no Cinematic ${id} in screenplay.script.cinematics, and there is no test Cinematic ${cinematicPath(blueprintPath, id)}`);
    const written = name ?? id;
    const cued = blueprint.screenplay.script?.cinematics.find((cinematic) => atStart(cinematic.scene));
    // Only the mission start Cinematic may be stood in for: any other listed one would be lost
    // silently. Compared ignoring case, as the file systems the map is written to do.
    const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
    const listed = blueprint.screenplay.script?.cinematics.find((cinematic) => same(cinematic.id, written));
    if (listed && listed.id !== cued?.id) {
      throw new Error(`The Blueprint lists a Cinematic ${listed.id}, which its cues play, and a test written as ${written}.SC2Cutscene would replace it; name the test something else`);
    }
    if (cued && written !== cued.id && same(written, cued.id)) throw new Error(`Name the test ${cued.id}, as its Blueprint does, to write it in that Cinematic's place`);
    const { xml, shots, lights } = await compileTestCinematic(workspace.root, blueprintPath, id, blueprintCatalog(blueprint));
    const fromCue = play && cued?.id === written;
    if (play && cued && !fromCue) throw new Error(`The map's mission start cue plays the Cinematic ${cued.id}, which would play over a test loop; write the test in its place: name it ${cued.id}`);
    const file = `${written}.SC2Cutscene`;
    await addPluginLights(map, blueprint, lights);
    const result = { ...(await writeIntoMap(map, file, xml, shots, play && !fromCue ? { script: playCinematicScript(file), init: "Cinematic_Init" } : undefined)), ...(await unloadedWarnings(workspace, blueprint, blueprintPath, { id, index: -1, scene: undefined })) };
    return play ? { ...result, inDialog: true, ...(fromCue ? { fromCue: true as const } : {}) } : result;
  }
  const script = await readMissionScript(blueprint, blueprintPath, workspace);
  const only = bindLikeOriginal({ ...blueprint, screenplay: { ...blueprint.screenplay, script: { ...blueprint.screenplay.script!, cinematics: [entry] } } }, blueprint);
  const { xml, shots, lights } = (await compileCinematics(workspace.root, only, blueprintPath, script))[id]!;
  const file = `${id}.SC2Cutscene`;
  await addPluginLights(map, blueprint, lights);
  const fromCue = play && atStart(entry.scene);
  const loop = play && !fromCue;
  const written = {
    ...(await writeIntoMap(map, file, xml, shots, loop ? { script: playCinematicScript(file, { environmentShown: entry.environment === "shown" }), init: "Cinematic_Init" } : undefined)),
    ...(await unloadedWarnings(workspace, blueprint, blueprintPath, { id, index: blueprint.screenplay.script!.cinematics.indexOf(entry), scene: entry.scene })),
  };
  return play ? { ...written, inDialog: true, ...(fromCue ? { fromCue: true as const } : {}) } : written;
}

/** The warnings for what the Cinematic `entry` films that the map's dependencies don't load, as `warnings` when there are any. */
async function unloadedWarnings(
  workspace: Workspace,
  blueprint: MissionBlueprint,
  blueprintPath: string,
  entry: { readonly id: string; readonly index: number; readonly scene: number | undefined },
): Promise<{ readonly warnings?: readonly string[] }> {
  // It was just written, so it reads.
  const { loaded } = await loadCinematic(workspace.root, blueprintPath, entry);
  const filmed = loaded ? [loaded] : [];
  const warnings = [...(await missionCinematicDependencyProblems(workspace, blueprint, filmed)), ...(await missionFeedChannelProblems(filmed))].map(formatCinematicProblem);
  return warnings.length > 0 ? { warnings } : {};
}

/**
 * The Mission's Cinematic `file` is the shot list of (<mission>/cinematics/<id>.json), if it is
 * one: listed in its blueprint, or a test Cinematic the blueprint doesn't list.
 */
export async function cinematicIdOf(workspace: Workspace, blueprintPath: string, file: string): Promise<{ readonly id: string; readonly listed: boolean } | undefined> {
  const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
  const id = path.basename(file, ".json");
  if (path.extname(file) !== ".json" || path.resolve(cinematicPath(blueprintPath, id)) !== path.resolve(file)) return undefined;
  return { id, listed: blueprint.screenplay.script?.cinematics.some((entry) => entry.id === id) ?? false };
}

/**
 * The names (without .SC2Cutscene) of the cutscenes `map`'s Triggers play: each Cinematic its
 * Blueprint listed when compile-map wrote it ("Cinematic <Id>", a Cutscenes\<id>.SC2Cutscene file
 * path), or one the Editor saved there. Read from the map, not a Blueprint, since a plain shot list
 * may have none, and the map is what would be written over.
 */
async function cutscenesPlayedBy(map: string): Promise<string[]> {
  const triggers = path.join(map, "Triggers");
  if (!existsSync(triggers)) return [];
  const xml = await readFile(triggers, "utf8");
  return [...xml.matchAll(/<Value>Cutscenes[\\/]([^<\\/]+)\.SC2Cutscene<\/Value>/gi)].map((match) => match[1]!);
}

/**
 * Writes the Plugin Lights the Mission names, in its Blueprint or in this Cinematic (`lights`, the
 * Light ids it switches to), into the map's LightData as they are now: compile-map leaves out one
 * that only a test Cinematic names, and a Light retuned since shows. The map's other Lights are kept.
 */
async function addPluginLights(map: string, blueprint: MissionBlueprint, lights: readonly string[]): Promise<void> {
  const own = new Set(blueprint.lights.map((light) => light.id));
  const contributed = mapLights(blueprint, lights).filter((light) => !own.has(light.id));
  if (contributed.length === 0) return;
  const file = path.join(map, "Base.SC2Data", "GameData", "LightData.xml");
  const existing = existsSync(file) ? await readFile(file, "utf8") : undefined;
  // The lighting regions go into a Plugin Light that holds them; any other Light's are compile-map's to write.
  const regions = lightRegionOverride(blueprint);
  const updated = withLights(existing, contributed, regions && contributed.some((light) => light.id === regions.light) ? regions : undefined)!;
  if (updated === existing) return;
  await mkdir(path.dirname(file), { recursive: true });
  // A new file gets the mode of the map's others (the Editor saves every file 755).
  const { write } = packageModes(map);
  await write(file, updated);
  const components = path.join(map, "ComponentList.SC2Components");
  const list = await readFile(components, "utf8");
  if (!list.includes('Type="gada"')) await write(components, list.replace("</Components>", `    <DataComponent Type="gada">GameData</DataComponent>\n</Components>`));
}

/** Writes `xml` as the map's Cutscenes/<file>; with `play`, also its play script (Galaxy, and the name of its Init function). */
async function writeIntoMap(map: string, file: string, xml: string, shots: number, play: { readonly script: string; readonly init: string } | undefined): Promise<CompiledCutscene> {
  const { write } = packageModes(map);
  const components = path.join(map, "ComponentList.SC2Components");
  let list = await readFile(components, "utf8");
  const ensure = (type: string, entry: string): void => {
    if (!list.includes(`Type="${type}"`)) list = list.replace("</Components>", `    <DataComponent Type="${type}">${entry}</DataComponent>\n</Components>`);
  };
  ensure("cuts", "Cutscenes/Index");
  if (play) ensure("trig", "Triggers");
  await write(components, list);
  const folder = path.join(map, "Base.SC2Data", "Cutscenes");
  await mkdir(folder, { recursive: true });
  await write(path.join(folder, "Index.version"), INDEX_VERSION);
  await write(path.join(folder, file), xml);
  const written = { file: path.join(folder, file), shots };
  if (!play) return written;

  const triggers = path.join(map, "Triggers");
  const current = existsSync(triggers) ? await readFile(triggers, "utf8") : undefined;
  await write(triggers, withCustomScript(current, PLAY_SCRIPT_ID, play.script, play.init));
  // Test Document runs MapScript.galaxy as it stands (only an Editor save rebuilds it from
  // Triggers), so the script goes into it too; a map without one gets an empty generated one.
  const mapScript = path.join(map, "MapScript.galaxy");
  const generated = existsSync(mapScript) ? await readFile(mapScript, "utf8") : writeMapScript({ mapName: path.basename(map, ".SC2Map"), triggers: { variables: [], triggers: [] } });
  await write(mapScript, withCustomScriptInMapScript(generated, PLAY_SCRIPT_ID, play.script, play.init));
  return written;
}
