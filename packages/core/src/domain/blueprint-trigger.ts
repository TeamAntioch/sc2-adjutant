// A Mission Blueprint's own trigger elements (ADR-0026): each a GUI Body stored by its Editor element
// Id, one JSON file per element under `missions/<id>/triggers/`, which the Blueprint's `triggers`
// lists by path. A trigger holds what the Editor saves for one: its flags, its local variables, its
// events, conditions and actions, each a call to any function in reach, in the tree a library
// function's body uses (library-interface.ts). A library's element is `<library>/<id>`, a
// dependency mod's global (and its structures' members) too; the map's own (a Kept function or
// variable, or another Blueprint element) is its Id alone, as the Editor writes it. Names sit
// beside the bodies, and a text value's words in `strings`, keyed by its Param
// (`Param/Value/<id>`), as a Mod Blueprint's do. Folders are the Blueprint's `triggerFolders`.
//
// A file holds one element, by its `kind`: a trigger, a comment, or a function, whose interface is a library
// function's (library-interface.ts) and whose body is its own variables and actions.

import { z } from "zod";

import { StringsSchema } from "./entry-strings.js";
import { ElementId, ElementRef, FUNCTION_FLAGS, FUNCTION_KINDS, MAP_GUI, MAP_TYPES, MapElementRef, SubFunctionSlotSchema } from "./library-interface.js";

/** A GameStrings file a Blueprint trigger's text values are in: `<locale>.SC2Data/LocalizedData/GameStrings.txt`. */
const GAME_STRINGS = /^[a-zA-Z]{4}\.SC2Data\/LocalizedData\/GameStrings\.txt$/;

/** Each file of an element's strings checked as a GameStrings file. */
function gameStringsFiles(strings: Readonly<Record<string, unknown>> | undefined, context: z.RefinementCtx): void {
  for (const file of Object.keys(strings ?? {})) {
    if (!GAME_STRINGS.test(file)) context.addIssue({ code: "custom", path: ["strings", file], message: "An element's strings are its text values' words, in a GameStrings file (enUS.SC2Data/LocalizedData/GameStrings.txt)" });
  }
}

/** A trigger element (`<Element Type="Trigger">`), as the Editor saves it. */
export const BlueprintTriggerSchema = z
  .object({
    kind: z.literal("trigger"),
    id: ElementId,
    /** Its name, as the Editor shows it (Trigger/Name/<id> in TriggerStrings): its Galaxy name is gt_ and its identifier, else its name's. */
    name: z.string().min(1),
    identifier: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "An identifier is a Galaxy name: letters, digits and _").optional(),
    /** Its icon in the Editor's trigger list, a Label as `<library>/<id>`: it changes no Galaxy. */
    label: ElementRef.optional(),
    /** The part of a campaign it is filed under (`<Section>`): it changes no Galaxy. */
    section: z.string().min(1).optional(),
    /** Disabled (`<Disabled/>`): the Editor writes no Galaxy for it. */
    disabled: z.boolean().optional(),
    /** Initially off (`<InitOff/>`): its events are added, but it runs only once a trigger turns it on. */
    initiallyOff: z.boolean().optional(),
    variables: z.array(MAP_GUI.GuiVariableSchema).default([]),
    events: z.array(MAP_GUI.GuiStatementSchema).default([]),
    conditions: z.array(MAP_GUI.GuiStatementSchema).default([]),
    actions: z.array(MAP_GUI.GuiStatementSchema).default([]),
    /** Its text values' words, by GameStrings file, each keyed by the Param holding it (`Param/Value/<id>`). */
    strings: StringsSchema.optional(),
  })
  .strict()
  .superRefine((trigger, context) => gameStringsFiles(trigger.strings, context));
export type BlueprintTrigger = z.infer<typeof BlueprintTriggerSchema>;

/** A map function's parameter (`<Element Type="ParamDef">`), as a library function's is (LibraryParameterSchema), the map's own preset types by Id. */
const BlueprintParameterSchema = z
  .object({
    id: ElementId,
    /** Its name, as the Editor shows it (ParamDef/Name/<id>). */
    name: z.string(),
    identifier: z.string().min(1).optional(),
    type: MAP_TYPES.TypeSpecSchema,
    default: MAP_GUI.HeldValueSchema.optional(),
    /** The preset its values are limited to (`<Preset Type="Preset">`), or the presets, where there are several. */
    preset: z.union([MapElementRef, z.array(MapElementRef).min(2)]).optional(),
    /** ParamFlagPreload: what it names is preloaded. */
    preload: z.boolean().optional(),
    limits: z.string().optional(),
  })
  .strict();

/**
 * A map function (`<Element Type="FunctionDef">`), as the Editor saves it: its interface as a
 * library function's (LibraryFunctionSchema: its kind, flags, return type, parameters and block
 * slots), its own variables and actions, and its text values' words. Its Galaxy is gf_ and its
 * identifier, else its name's.
 */
export const BlueprintFunctionSchema = z
  .object({
    kind: z.literal("function"),
    id: ElementId,
    /** Its name, as the Editor's function list shows it (FunctionDef/Name/<id>). */
    name: z.string().min(1),
    identifier: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "An identifier is a Galaxy name: letters, digits and _").optional(),
    /** What it is in the Editor (FlagAction, FlagCall, FlagCondition, FlagEvent): an action, a value (function), a condition or an event. */
    functionKind: z.enum(FUNCTION_KINDS),
    /** Its other flags (FlagCreateThread is createThread). */
    flags: z.array(z.enum(FUNCTION_FLAGS)).default([]),
    /** Its grammar and hint, as the Editor's function list shows them (FunctionDef/Grammar/<id>, FunctionDef/Hint/<id>). */
    grammar: z.string().optional(),
    hint: z.string().optional(),
    /** Its icon in the function list, a Label as `<library>/<id>`: it changes no Galaxy. */
    label: ElementRef.optional(),
    /** The part of a campaign it is filed under (`<Section>`): it changes no Galaxy. */
    section: z.string().min(1).optional(),
    disabled: z.boolean().optional(),
    deprecated: z.boolean().optional(),
    internal: z.boolean().optional(),
    returns: MAP_TYPES.TypeSpecSchema.optional(),
    parameters: z.array(BlueprintParameterSchema).default([]),
    /** Its own block slots, for a block function such as an If Then. */
    subFunctions: z.array(SubFunctionSlotSchema).default([]),
    variables: z.array(MAP_GUI.GuiVariableSchema).default([]),
    actions: z.array(MAP_GUI.GuiStatementSchema).default([]),
    /** Its text values' words, by GameStrings file, each keyed by the Param holding it (`Param/Value/<id>`). */
    strings: StringsSchema.optional(),
  })
  .strict()
  .superRefine((fn, context) => {
    gameStringsFiles(fn.strings, context);
    if (fn.flags.includes("native")) context.addIssue({ code: "custom", path: ["flags"], message: "A Mission's function is GUI: a native one's body is Galaxy, which a Mission Blueprint doesn't hold" });
    // What the map script's writer (the Kept renderer's renderFunction) doesn't write yet, so no compile could.
    for (const flag of fn.flags.filter((each) => each !== "createThread" && each !== "native")) context.addIssue({ code: "custom", path: ["flags"], message: `A Mission's function with the flag ${flag} isn't written yet: no compile writes its Galaxy` });
    for (const key of ["disabled", "deprecated", "internal"] as const) if (fn[key]) context.addIssue({ code: "custom", path: [key], message: `A ${key} Mission function isn't written yet: no compile writes its Galaxy` });
    if (fn.functionKind === "event") context.addIssue({ code: "custom", path: ["functionKind"], message: "A Mission's event function isn't written yet: no compile writes its Galaxy" });
    if (fn.subFunctions.length > 0) context.addIssue({ code: "custom", path: ["subFunctions"], message: "A Mission's block function (one with block slots) isn't written yet: no compile writes its Galaxy" });
  });
export type BlueprintFunction = z.infer<typeof BlueprintFunctionSchema>;

/** A comment filed among the map's items, in Root or a folder (`<Element Type="Comment">`): its text, empty for a blank one. It has no Galaxy. */
export const BlueprintCommentSchema = z.object({ kind: z.literal("comment"), id: ElementId, comment: z.string() }).strict();
export type BlueprintComment = z.infer<typeof BlueprintCommentSchema>;

/** Any element a Mission Blueprint's trigger element file holds, by its kind. */
export const BlueprintElementSchema = z.discriminatedUnion("kind", [BlueprintTriggerSchema, BlueprintFunctionSchema, BlueprintCommentSchema]);
export type BlueprintElement = z.infer<typeof BlueprintElementSchema>;

/** An item a Blueprint Trigger Folder files: one of the Blueprint's triggers, globals or other folders, as `<kind>:<id>`. */
export const BlueprintFolderItem = z.string().regex(/^(trigger|function|comment|variable|category):[0-9A-F]{8}$/, "An item is trigger:<id>, function:<id>, comment:<id>, variable:<id> or category:<id>, a Blueprint trigger, function, comment, global or folder by its element Id");

/** A Trigger Folder (an Editor Category) of the Blueprint's own triggers: its name, its icon and what it files, in order. */
export const BlueprintTriggerFolderSchema = z
  .object({
    id: ElementId,
    name: z.string().min(1),
    /** Its icon, a Label as `<library>/<id>`. */
    label: ElementRef.optional(),
    items: z.array(BlueprintFolderItem).default([]),
  })
  .strict();
export type BlueprintTriggerFolder = z.infer<typeof BlueprintTriggerFolderSchema>;

/** A Blueprint trigger element's file: a JSON file in the Mission's `triggers/` folder, relative to the Blueprint. */
export const BlueprintTriggerPath = z
  .string()
  .regex(/^triggers\/[^\\]+\.json$/, "A trigger element's file is a .json file in the Mission's triggers/ folder, such as triggers/ping.json")
  .refine((value) => !value.split("/").includes(".."), "A trigger element's file stays inside the Mission's triggers/ folder");
