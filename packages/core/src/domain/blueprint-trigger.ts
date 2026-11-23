// A Mission Blueprint's own trigger elements (ADR-0026): each a GUI Body stored by its Editor element
// Id, one JSON file per element under `missions/<id>/triggers/`, which the Blueprint's `triggers`
// lists by path. A trigger holds what the Editor saves for one: its flags, its local variables, its
// events, conditions and actions, each a call to any function in reach, in the tree a library
// function's body uses (library-interface.ts). A library's element is `<library>/<id>`, a
// dependency mod's global (and its structures' members) too; the map's own (a Kept function or
// variable, or another Blueprint element) is its Id alone, as the Editor writes it. Names sit
// beside the bodies, and a text value's words in `strings`, keyed by its Param
// (`Param/Value/<id>`), as a Mod Blueprint's do. Folders are the Blueprint's `triggerFolders`.

import { z } from "zod";

import { StringsSchema } from "./entry-strings.js";
import { ElementId, ElementRef, MAP_GUI } from "./library-interface.js";

/** A GameStrings file a Blueprint trigger's text values are in: `<locale>.SC2Data/LocalizedData/GameStrings.txt`. */
const GAME_STRINGS = /^[a-zA-Z]{4}\.SC2Data\/LocalizedData\/GameStrings\.txt$/;

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
  .superRefine((trigger, context) => {
    for (const file of Object.keys(trigger.strings ?? {})) {
      if (!GAME_STRINGS.test(file)) context.addIssue({ code: "custom", path: ["strings", file], message: "A trigger's strings are its text values' words, in a GameStrings file (enUS.SC2Data/LocalizedData/GameStrings.txt)" });
    }
  });
export type BlueprintTrigger = z.infer<typeof BlueprintTriggerSchema>;

/** An item a Blueprint Trigger Folder files: one of the Blueprint's triggers, globals or other folders, as `<kind>:<id>`. */
export const BlueprintFolderItem = z.string().regex(/^(trigger|variable|category):[0-9A-F]{8}$/, "An item is trigger:<id>, variable:<id> or category:<id>, a Blueprint trigger, global or folder by its element Id");

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
