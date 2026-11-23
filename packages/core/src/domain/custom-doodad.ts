// A custom doodad (#605): a model the Workspace holds, made a doodad the Editor's palette lists and
// a map can place. The game places a doodad by its CActorDoodad's id, and an actor's Model is the
// CModel of its own id unless it names another (CActorModel's default `##id##`), so a custom
// doodad is two entries of one id (src/mods/custom-doodads.ts):
//
//   { id: "Ring", model: "Assets/Models/Rings/Ring.m3" }
//       <CModel id="Ring" parent="Doodad"><Model value="Assets\Models\Rings\Ring.m3"/></CModel>
//       <CActorDoodad id="Ring"><On index="0" removed="1"/><On index="1" removed="1"/>
//           <RandomScaleRange value="1.000000,1.000000"/></CActorDoodad>
//
// A CModel with no actor isn't a doodad: the Editor places a placeholder for it, and its palette
// leaves it out (ADR-0017). The actor drops CActorDoodad's default sound emitter (`Doodad_<id>`, which a
// custom model has none of) and, unless `animate`, its looping Stand, and keeps every copy at the
// size placed (the default draws each between 0.8 and 1.2). A Campaign Mod's Blueprint declares one
// for every Mission, its files in the Asset Mod; a Mission Blueprint declares one for its map alone.
// With `gameModel`, the model is the game's own .m3, so neither ships a file for it. Either's
// `swaps` draw new textures in place of the model's own (src/mods/texture-swaps.ts).

import { z } from "zod";

import { FieldsSchema } from "./catalog-fields.js";

/** The Editor's doodad palette groups (EditorCategories `DoodadType:<group>`), as the game's doodads use them; CActorDoodad's default is Props. */
export const DOODAD_GROUPS = ["Environment", "Structures", "Props", "Debris", "Blocker", "CliffRamps", "TerrainObject", "Track"] as const;

/** A file's storage path, as game data names it: `Assets/Models/Ring/Ring.m3`, either slash, not absolute and with no `..`. */
export const StoragePath = z
  .string()
  .min(1)
  .refine((value) => !/^[\\/]|^[A-Za-z]:/.test(value) && !value.split(/[\\/]/).includes(".."), "A storage path is relative, such as Assets/Models/Ring/Ring.m3");

/** One texture swap: a new texture drawn in place of one the model names, on this doodad alone (src/mods/texture-swaps.ts). */
export const DoodadSwapSchema = z
  .object({
    /** The texture the model names, such as `Assets/Textures/Pylon_Emissive.dds`. */
    replace: StoragePath,
    /** The texture drawn in its place, a file the game loads: found as a model's own textures are (a Mission's `textures`, Kept, Workspace mods; a Campaign Mod's in its Asset Mod), or listed in `gameTextures`. */
    with: StoragePath,
  })
  .strict();
export type DoodadSwap = z.infer<typeof DoodadSwapSchema>;

export const CustomDoodadSchema = z
  .object({
    /** The doodad type, and its CModel's id: letters, digits and underscores, as Blizzard's ids are; never a game doodad's or unit's, which the compile refuses. */
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, "A doodad id is letters, digits and underscores, starting with a letter"),
    /** The model file's storage path, such as `Assets/Doodads(Custom)/Rings/Ring.m3`, or the game's own model's with `gameModel`. */
    model: StoragePath.refine((value) => value.toLowerCase().endsWith(".m3"), "A doodad's model is an .m3 file"),
    /** The name the Editor's palette shows, in ObjectStrings (Actor/Name and Model/Name); the id without one. */
    name: z.string().min(1).regex(/^[^\r\n]*$/, "A name is one line").optional(),
    /** Its palette group (EditorCategories `DoodadType:<group>`); Props without one. */
    group: z.enum(DOODAD_GROUPS).optional(),
    /** The tilesets (TexSets) whose doodad lists show it; every tileset's without any. */
    tilesets: z.array(z.string().min(1)).min(1).optional(),
    /** Its footprint (a CFootprint id such as FootprintDoodad2x2), when it blocks pathing or building. */
    footprint: z.string().min(1).optional(),
    /** Its model's size, every copy's (CModel ScaleMin and ScaleMax); 1 without one. */
    scale: z.number().positive().optional(),
    /**
     * The model is the game's own (`Assets/Buildings/Protoss/PylonEx2/PylonEx2.m3`), read from the
     * game's files: no copy of it is written, its textures are the game's, and the compile refuses
     * a path the game has no model at.
     */
    gameModel: z.boolean().optional(),
    /** Keeps the default looping Stand animation (`$Stand PlayForever`); a still prop without it. */
    animate: z.boolean().default(false),
    /**
     * Texture paths the model names that are the game's own, not files of the Workspace's: each
     * one is a decision, so a texture missing from the Workspace is never taken for the game's.
     */
    gameTextures: z.array(StoragePath).default([]),
    /**
     * New textures drawn in place of the model's own, one entry per texture replaced, on this doodad
     * alone (src/mods/texture-swaps.ts): a Mission's in its map, a Campaign Mod's in the mod's data,
     * each `with` a file its map or Asset Mod loads.
     */
    swaps: z.array(DoodadSwapSchema).default([]),
    /** More fields of its CModel and its CActorDoodad (generic entry fields), over the ones above. */
    fields: z.object({ model: FieldsSchema.optional(), actor: FieldsSchema.optional() }).strict().optional(),
  })
  .strict();
export type CustomDoodad = z.infer<typeof CustomDoodadSchema>;

/**
 * Refuses a gameModel doodad that ships `textures` or lists `gameTextures` other than its swaps' `with`
 * textures: a game model's own textures are the game's already, and a file shipped at one of their
 * paths replaces it for every model in the map.
 */
function gameModelTextures(
  doodad: { readonly gameModel?: boolean | undefined; readonly gameTextures: readonly string[]; readonly textures?: Readonly<Record<string, string>>; readonly swaps: readonly DoodadSwap[] },
  context: z.RefinementCtx,
): void {
  if (!doodad.gameModel) return;
  const comparable = (texture: string) => texture.replace(/\\/g, "/").toLowerCase();
  const swapped = new Set(doodad.swaps.map((swap) => comparable(swap.with)));
  const shipped = Object.keys(doodad.textures ?? {}).filter((texture) => !swapped.has(comparable(texture)));
  if (shipped.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["textures"],
      message: `a gameModel's textures are the game's own: a file shipped at one of their paths replaces it for every model in the map, so ship only a swap's with texture, not ${shipped.join(", ")}`,
    });
  }
  const listed = doodad.gameTextures.filter((texture) => !swapped.has(comparable(texture)));
  if (listed.length > 0) context.addIssue({ code: "custom", path: ["gameTextures"], message: `a gameModel's textures are the game's own: list only a swap's with texture in gameTextures, not ${listed.join(", ")}` });
}

/** A file in the Mission's folder, relative to it. */
const MissionFile = z
  .string()
  .min(1)
  .refine((value) => !/^[\\/]|^[A-Za-z]:/.test(value) && !value.split(/[\\/]/).includes(".."), "A source is a file in the Mission's folder, relative to it");

/**
 * A Mission's own custom doodad: its model and the textures it ships are files in the Mission's
 * folder, written into the Map Package at their storage paths, beside its CModel and CActorDoodad.
 * A texture the model names that isn't among them is found in the Map Package (a Kept file), in the
 * Workspace's mod packages, or listed in `gameTextures`. The Editor's palette shows it by its id.
 */
export const MissionDoodadSchema = CustomDoodadSchema.omit({ name: true })
  .extend({
    /** The model's file in the Mission's folder, such as `art/Ring.m3`; none for a gameModel. */
    source: MissionFile.optional(),
    /** The textures it ships, each file in the Mission's folder: by the storage path the model names (`Assets/Textures/Ring_Diff.dds`), or a swap's `with`. */
    textures: z.record(StoragePath, MissionFile).default({}),
  })
  .superRefine((doodad, context) => {
    if (doodad.gameModel && doodad.source !== undefined) context.addIssue({ code: "custom", path: ["source"], message: "a gameModel is the game's own file: leave source out" });
    if (!doodad.gameModel && doodad.source === undefined) context.addIssue({ code: "custom", path: ["source"], message: "a doodad's model is a file in the Mission's folder: give its source, or set gameModel for the game's own model" });
    gameModelTextures(doodad, context);
  });
export type MissionDoodad = z.infer<typeof MissionDoodadSchema>;

/** Refuses a list of doodads with an id twice, in any case, as the game matches ids. */
function idsOnce(doodads: readonly { readonly id: string }[], context: z.RefinementCtx): void {
  const seen = new Map<string, number>();
  doodads.forEach(({ id }, index) => {
    const other = seen.get(id.toLowerCase());
    if (other !== undefined) context.addIssue({ code: "custom", path: [index, "id"], message: `doodads.${other} and doodads.${index} are both ${id}: a doodad is declared once` });
    seen.set(id.toLowerCase(), index);
  });
}

/** A Campaign Mod's custom doodads, each id once. */
export const CustomDoodadsSchema = z.array(CustomDoodadSchema.superRefine(gameModelTextures)).default([]).superRefine(idsOnce);
/** A Mission's own custom doodads, each id once. */
export const MissionDoodadsSchema = z.array(MissionDoodadSchema).default([]).superRefine(idsOnce);
