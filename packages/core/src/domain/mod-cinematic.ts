// A Campaign Mod's Cinematic (ADR-0009, ADR-0011): a scene of one of its Screenplays (a hub chat's
// group, an interlude's scene) filmed from a shot list in the mod's folder,
// cinematics/<id>.json, on Sets imported there (sets/<slug>.json). The compile writes it into the
// mod's Cutscenes as <cutscene>.SC2Cutscene, the file the scene's cue plays (a Campaign's hub chats may name
// it in a UserData row beside the conversation and group), so the cue needs no change.

import path from "node:path";

import { z } from "zod";

import { slugId } from "./mission-blueprint.js";
import { CatalogId } from "./mod-screenplay.js";

/** Where a mod's cutscenes sit in its package. */
export const CUTSCENES_DIR = "Base.SC2Data/Cutscenes/";

/** A cutscene's name in the package: a file name, written as Base.SC2Data/Cutscenes/<name>.SC2Cutscene. */
const CutsceneName = z
  .string()
  .min(1)
  .refine((name) => !/[\\/:*?"<>|]/.test(name) && !/\.sc2cutscene$/i.test(name) && name.trim() === name, "A cutscene's name is a file name with no folder, no .SC2Cutscene and no leading or trailing space");

export const ModCinematicSchema = z
  .object({
    /** Its shot list is cinematics/<id>.json in the mod's folder. */
    id: slugId,
    /** The Conversation whose lines it plays: one the Blueprint's Screenplays compile. */
    conversation: CatalogId,
    /** The scene (its group, Group0000N) whose lines it plays. */
    scene: z.number().int().positive(),
    /**
     * The cutscene's name in the package, without .SC2Cutscene: it is written as
     * Base.SC2Data/Cutscenes/<cutscene>.SC2Cutscene, the file its cue plays. A Kept cutscene of
     * that name is converted, compared aspect by aspect with the one it replaces.
     */
    cutscene: CutsceneName,
  })
  .strict();
export type ModCinematic = z.infer<typeof ModCinematicSchema>;

/** The package file a mod's Cinematic is written to. */
export const cutsceneFile = (cinematic: Pick<ModCinematic, "cutscene">): string => `${CUTSCENES_DIR}${cinematic.cutscene}.SC2Cutscene`;

/** A Campaign Mod's Cinematics: one per id, per scene and per cutscene file. */
export const ModCinematicsSchema = z.array(ModCinematicSchema).superRefine((cinematics, context) => {
  const seen = { id: new Map<string, number>(), scene: new Map<string, number>(), cutscene: new Map<string, number>() };
  cinematics.forEach((cinematic, index) => {
    const keys = { id: cinematic.id, scene: `${cinematic.conversation} scene ${cinematic.scene}`, cutscene: cinematic.cutscene.toLowerCase() };
    for (const key of ["id", "scene", "cutscene"] as const) {
      const other = seen[key].get(keys[key]);
      if (other !== undefined) context.addIssue({ code: "custom", path: [index, key === "scene" ? "scene" : key], message: `cinematics.${other} and cinematics.${index} have the same ${key === "scene" ? `scene (${keys.scene})` : `${key} ${cinematic[key]}`}: each is one Cinematic's` });
      else seen[key].set(keys[key], index);
    }
  });
});

/**
 * A Set cutscene: one of the mod's Sets written back as a cutscene with no shots (its pieces, the
 * characters on its marks, its cameras, lamps, ambience and base Lights, where its source file had
 * them), so the author can open the room in the Cutscene Editor. A Kept cutscene of that name is
 * converted, compared aspect by aspect as a Cinematic's is; an Editor change to it comes back into
 * the Set through sync.
 */
export const ModSetCutsceneSchema = z
  .object({
    /** Its name in the package, without .SC2Cutscene: written as Base.SC2Data/Cutscenes/<cutscene>.SC2Cutscene. */
    cutscene: CutsceneName,
    /** The Set it shows: a Set file in the mod's folder (sets/<slug>.json), relative to it. */
    set: z
      .string()
      .min(1)
      .refine((file) => !path.isAbsolute(file) && !file.split(/[\\/]/).includes("..") && file.toLowerCase().endsWith(".json"), "A Set is a .json file in the mod's folder, relative to it"),
    /** How long its timeline runs, in ms, as the Editor shows it: SET_CUTSCENE_MS when left out. */
    lengthMs: z.number().int().positive().optional(),
  })
  .strict();
export type ModSetCutscene = z.infer<typeof ModSetCutsceneSchema>;

/** How long a Set cutscene runs when its declaration doesn't say: a minute, long enough to scrub through its Lights. */
export const SET_CUTSCENE_MS = 60_000;

/** A Campaign Mod's Set cutscenes: one per cutscene file. */
export const ModSetCutscenesSchema = z.array(ModSetCutsceneSchema).superRefine((cutscenes, context) => {
  const seen = new Map<string, number>();
  cutscenes.forEach((entry, index) => {
    const other = seen.get(entry.cutscene.toLowerCase());
    if (other !== undefined) context.addIssue({ code: "custom", path: [index, "cutscene"], message: `setCutscenes.${other} and setCutscenes.${index} both write ${entry.cutscene}: each is one Set cutscene's` });
    else seen.set(entry.cutscene.toLowerCase(), index);
  });
});
