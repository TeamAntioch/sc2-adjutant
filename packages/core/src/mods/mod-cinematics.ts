// A Campaign Mod's Cinematics (ADR-0009, ADR-0011, domain/mod-cinematic.ts): each a scene of one
// of its Screenplays, read with its Sets from the mod's folder, checked as a Mission's are, timed by
// the voice files its Asset Mods hold, and written as the .SC2Cutscene its cue plays.
//
// Its lines are the Conversation's own: each named, in the shot list and in the cutscene, by the
// Sound it plays (the imported one, if the Screenplay keeps one), so a shot cuts on the Sound the
// author hears in the Editor.

import { feedChannelProblems } from "../cutscene/feed-channels.js";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { type CastModels, castModels, cinematicLightWarnings, cinematicProblems, type CinematicProblem, formatCinematicProblem, isCinematicError, type LoadedCinematic, loadListedCinematics, measuredLengthsMs, sceneLines, writeChecked } from "../cutscene/cinematic.js";
import type { ModBlueprint } from "../domain/mod-blueprint.js";
import { type SetData, SetSchema } from "../domain/cinematic-set.js";
import { cutsceneFile, type ModCinematic, type ModSetCutscene, SET_CUTSCENE_MS } from "../domain/mod-cinematic.js";
import { setCutscene } from "../cutscene/set-cutscene.js";
import { isInside } from "../util/inside.js";
import type { Workspace } from "../plugins/workspace.js";
import type { Script, ScriptLine } from "../script/name-script.js";
import { lineSound, type ModScript } from "./conversations.js";
import { type AssetMod, dependedAssetMods } from "./sound-sets.js";

/** A mod's Cinematic read with its Sets, and the Screenplay it plays, its lines named by the Sounds they play. */
export type ModCinematicRead = { readonly cinematic: ModCinematic; readonly loaded: LoadedCinematic; readonly script: Script };

/** `script` with each line's sound ID the Sound its Conversation plays (lineSound). */
export function playedScript({ screenplay, script }: Pick<ModScript, "screenplay" | "script">): Script {
  return {
    ...script,
    scenes: script.scenes.map((scene) => ({ ...scene, items: scene.items.map((item) => (item.kind === "line" ? { ...item, soundId: lineSound(screenplay, item) } : item)) })),
  };
}

/**
 * The Blueprint's Cinematics, each read with its Sets (in the mod's folder, as its other sources are) and checked
 * against its scene, and every problem met: a Conversation none of its Screenplays compiles, and
 * each Cinematic check a Mission's Cinematic gets. `read` holds those that can be written;
 * `loaded`, every one that read with its Sets, whatever its problems.
 */
export async function readModCinematics(
  blueprint: ModBlueprint,
  blueprintPath: string,
  scripts: readonly ModScript[],
  /** Its Workspace: the Plugins and Campaign Mod whose Lights and models it may name. */
  workspace: Pick<Workspace, "registry" | "catalog">,
  /** What its cast is checked against, when the caller has read it. */
  castAgainst?: CastModels,
): Promise<{ readonly read: readonly ModCinematicRead[]; readonly loaded: readonly LoadedCinematic[]; readonly problems: readonly CinematicProblem[] }> {
  if (blueprint.cinematics.length === 0) return { read: [], loaded: [], problems: [] };
  const models = castAgainst ?? (await castModels(workspace.catalog));
  const { loaded, problems: found } = await loadListedCinematics(path.dirname(blueprintPath), blueprintPath, blueprint.cinematics, "the mod's folder");
  const problems = [...found];
  const read: ModCinematicRead[] = [];
  for (const entry of loaded) {
    const cinematic = blueprint.cinematics[entry.index]!;
    const script = scripts.find((found) => found.script.conversationId === cinematic.conversation);
    if (!script) {
      problems.push({ file: blueprintPath, path: `cinematics.${entry.index}.conversation`, message: `Cinematic ${cinematic.id} plays ${cinematic.conversation}, which none of the Blueprint's Screenplays compiles: declare its Screenplay first` });
      continue;
    }
    const played = playedScript(script);
    const checked = cinematicProblems(entry, played, blueprintPath, models, "cinematics");
    problems.push(...checked, ...cinematicLightWarnings(entry, undefined, workspace), ...feedChannelProblems(entry, models.displays ?? {}));
    if (!checked.some(isCinematicError)) read.push({ cinematic, loaded: entry, script: played });
  }
  return { read, loaded, problems };
}

/**
 * Each line's length in ms, from its voice file in the Asset Mods the mod depends on, as their
 * packages hold it (a recording, or a placeholder), else the estimate; with the Sounds it estimated.
 */
export async function modLineLengths(lines: readonly ScriptLine[], assetMods: readonly AssetMod[]): Promise<{ readonly lengths: Map<string, number>; readonly estimated: readonly string[] }> {
  return measuredLengthsMs(lines, (soundId) => {
    const owner = assetMods.find((asset) => asset.bySound.has(soundId.toLowerCase()));
    return owner ? path.join(owner.mod.modPackage, ...owner.bySound.get(soundId.toLowerCase())!.split("/")) : undefined;
  });
}

/** One of the mod's Cinematics as the package file it's written to, with the Sounds of the lines it timed by the estimate. */
export type ModCutscene = { readonly id: string; readonly index: number; readonly file: string; readonly xml: string; readonly estimated: readonly string[] };

/**
 * The Blueprint's Cinematics as their .SC2Cutscene files, timed by the voice files of the Asset
 * Mods it depends on (a line with none by the estimate, each named in `estimated`). Throws with every problem when any can't be written.
 */
export async function modCutscenes(blueprint: ModBlueprint, blueprintPath: string, workspace: Workspace, scripts: readonly ModScript[]): Promise<ModCutscene[]> {
  if (blueprint.cinematics.length === 0) return [];
  const models = await castModels(workspace.catalog);
  const { read, problems } = await readModCinematics(blueprint, blueprintPath, scripts, workspace, models);
  const errors = problems.filter(isCinematicError);
  if (errors.length > 0) throw new Error(`The Cinematics can't be written: ${errors.map(formatCinematicProblem).join("; ")}`);
  const assetMods = await dependedAssetMods(blueprint, workspace, scripts);
  const out: ModCutscene[] = [];
  for (const { cinematic, loaded, script } of read) {
    const { lengths, estimated } = await modLineLengths(sceneLines(script, loaded.scene) ?? [], assetMods);
    out.push({ id: cinematic.id, index: loaded.index, file: cutsceneFile(cinematic), xml: writeChecked(loaded, script, lengths, models).xml, estimated });
  }
  return out;
}

/** A Set cutscene's declaration with its Set read from the mod's folder. */
export type ModSetCutsceneRead = { readonly index: number; readonly entry: ModSetCutscene; readonly setFile: string; readonly set: SetData };

/**
 * The Blueprint's Set cutscenes, each with its Set read from the mod's folder, and every problem met:
 * a Set outside the folder, missing, unreadable or not a Set.
 */
export async function readModSetCutscenes(blueprint: ModBlueprint, blueprintPath: string): Promise<{ readonly read: readonly ModSetCutsceneRead[]; readonly problems: readonly CinematicProblem[] }> {
  const dir = path.dirname(blueprintPath);
  const read: ModSetCutsceneRead[] = [];
  const problems: CinematicProblem[] = [];
  for (const [index, entry] of blueprint.setCutscenes.entries()) {
    const setFile = path.resolve(dir, entry.set);
    const where = { file: blueprintPath, path: `setCutscenes.${index}.set` };
    if (!(await isInside(dir, setFile))) {
      problems.push({ ...where, message: `${entry.set} is outside the mod's folder` });
      continue;
    }
    if (!existsSync(setFile)) {
      problems.push({ ...where, message: `The Set ${entry.set} isn't there: import it with import-set --mod first` });
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(setFile, "utf8"));
    } catch (error) {
      problems.push({ ...where, message: `The Set ${entry.set} can't be read: ${(error as Error).message}` });
      continue;
    }
    const parsed = SetSchema.safeParse(raw);
    if (!parsed.success) {
      problems.push(...parsed.error.issues.map((issue) => ({ file: setFile, ...(issue.path.length ? { path: issue.path.join(".") } : {}), message: issue.message })));
      continue;
    }
    read.push({ index, entry, setFile, set: parsed.data });
  }
  return { read, problems };
}

/** The Blueprint's Set cutscenes as their .SC2Cutscene files. Throws with every problem when any can't be written. */
export async function modSetCutscenes(blueprint: ModBlueprint, blueprintPath: string, models: CastModels): Promise<{ readonly index: number; readonly file: string; readonly xml: string }[]> {
  const { read, problems } = await readModSetCutscenes(blueprint, blueprintPath);
  if (problems.length > 0) throw new Error(`The Set cutscenes can't be written: ${problems.map(formatCinematicProblem).join("; ")}`);
  return read.map(({ index, entry, set }) => ({ index, file: cutsceneFile(entry), xml: setCutscene(set, { lengthMs: entry.lengthMs ?? SET_CUTSCENE_MS, models }) }));
}

/** XML text with its entities read (`&amp;` is `&`), as the Editor reads a name it escaped. */
const unescapeXml = (text: string): string =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * Which of `cutscenes` anything in the mod package plays: a catalog entry (a hub chat's UserData
 * row), the Triggers or a script naming Cutscenes\<cutscene>.SC2Cutscene, the package read once
 * for them all. A Cinematic its cue doesn't name is written but never plays.
 */
export async function playedCutscenes(pkg: string, cutscenes: readonly string[]): Promise<Set<string>> {
  const played = new Set<string>();
  const files = existsSync(pkg) ? (await readdir(pkg, { recursive: true })).map((file) => file.split(path.sep).join("/")) : [];
  for (const file of files.filter((found) => /^Base\.SC2Data\/GameData\/.*\.xml$|^Triggers$|\.galaxy$/i.test(found))) {
    if (played.size === new Set(cutscenes).size) break;
    const raw = await readFile(path.join(pkg, file), "utf8");
    // XML (a catalog, the Triggers) escapes a name's & and quotes; a script doesn't.
    const text = (file.toLowerCase().endsWith(".galaxy") ? raw : unescapeXml(raw)).toLowerCase().replace(/\//g, "\\").replace(/\\\\/g, "\\");
    for (const cutscene of cutscenes) if (text.includes(`cutscenes\\${cutscene}.sc2cutscene`.toLowerCase())) played.add(cutscene);
  }
  return played;
}
