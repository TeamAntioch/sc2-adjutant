// A Campaign Mod's library (ADR-0011): the GUI trigger library its Missions call. Its Mod Blueprint declares the library's **interface**: each
// function's name, kind, parameters with their types, and the stable element IDs found at Import,
// which are kept forever so the Missions calling them never break. Each function's **body** is
// either GUI, typed trigger primitives stored as data (a GUI Body, the same tree of calls,
// parameters and values a Mission compile writes, ADR-0002), or Galaxy, a script file in the mod's
// folder that the Blueprint owns. GUI is the default, for any function an author would open in the
// Editor; Galaxy is for code that's naturally text.
//
// Beside its functions, the interface declares the library's other items: its categories (trigger
// folders) and what each files, in order, its Root, preset types, structures, comments and custom
// script. Its triggers and globals are the Mod Blueprint's `triggers`, which its categories file.
//
// A reference to another library's element is `<library>/<id>`, as the Editor writes
// `Library="Ntve" Id="00000136"`; the library's own elements are named by id alone.

import { z } from "zod";

import { StringsSchema } from "./entry-strings.js";

/** An Editor element id: eight hexadecimal digits. */
export const ElementId = z.string().regex(/^[0-9A-F]{8}$/, "An element id is eight upper-case hexadecimal digits, as the Editor writes it");
/** A library element by its library and id, such as `Ntve/00000136`. */
export const ElementRef = z.string().regex(/^[A-Za-z0-9]+\/[0-9A-F]{8}$/, "A reference is <library>/<id>, such as Ntve/00000136");
/** A library id, as `<Library Id="…">` gives it and Galaxy names it (lib<id>_gf_…). */
export const LibraryId = z.string().regex(/^[A-Za-z][A-Za-z0-9]*$/, "A library id is letters and digits, starting with a letter");

/** A parameter's, variable's or return value's type: `<Type Value>`, with the preset type, game link catalog and so on it names. */
export const TypeSpecSchema = z
  .object({
    type: z.string().min(1),
    /** A preset type or structure (TypeElement), as `<library>/<id>`. */
    element: ElementRef.optional(),
    /** A game link's catalog (GameType), such as Character. */
    gameType: z.string().min(1).optional(),
    /** An asset's type (AssetType). */
    assetType: z.string().min(1).optional(),
    /** A user type (UserType). */
    userType: z.string().min(1).optional(),
  })
  .strict();
/**
 * A variable's type (`<VariableType>`): a parameter's or return value's type, and whether it is
 * constant or an array, which only a variable is.
 */
export const VariableTypeSpecSchema = TypeSpecSchema.extend({
  /** A constant variable's (`<Constant/>`): declared with its initial value, which nothing sets after. */
  constant: z.boolean().optional(),
  /**
   * An array variable's size in each dimension, first to last (`<ArraySize Dim>`): a literal
   * (`Value`), or a constant variable of the library (`Type="Variable"`), as `<library>/<id>`. Galaxy
   * holds one more than each (`int[4]` for a size of 3, `[lib<id>_gv_<count> + 1]`).
   */
  array: z
    .array(z.union([z.object({ size: z.number().int().positive() }).strict(), z.object({ variable: ElementRef }).strict()]))
    .min(1)
    .optional(),
})
  .strict()
  .refine((type) => !(type.constant && type.array), "An array variable can't be constant: no Editor save has one");
/** A type as the writers take it: a variable's, which a parameter's or return value's is without its constant and sizes. */
export type TypeSpec = z.infer<typeof VariableTypeSpecSchema>;
/** One dimension of an array variable's size. */
export type ArrayBound = NonNullable<TypeSpec["array"]>[number];

/** A value a parameter, a default or a variable's initial value holds: exactly one of these. */
export type GuiValue =
  /** A preset value (`<Preset Type="PresetValue">`), such as Ntve/00000067 (Wait). */
  | { readonly preset: string }
  /**
   * A value of a bits preset type (`<ValueType Type="preset"/>` with `<ValueElement>`): the bits set,
   * its values (`<ValuePreset>`) in the Editor's order, none for none set. An older Editor names no
   * preset type for a value with some set: `presetElement` is then absent.
   */
  | { readonly presetElement: string; readonly bits?: readonly string[] }
  | { readonly bits: readonly string[] }
  /** A literal (`<Value>` and `<ValueType>`): `value` as the Editor writes it, absent for an empty one. */
  | { readonly value?: string; readonly type: string; readonly valueId?: string; readonly typeInfo?: string; readonly gameType?: string; readonly context?: string; readonly valueParams?: readonly HeldValue[] }
  /** The value of a call. */
  | { readonly call: GuiCall }
  /**
   * A variable of the library: one of the function's own, or a global; `index` the values it is
   * indexed by, one per dimension, when it is an array (`<Array>`); `member` names a member of it (of
   * the element indexed), when it is a structure.
   */
  | { readonly variable: string; readonly index?: readonly HeldValue[]; readonly member?: StructMember }
  /** One of the function's own parameters. */
  | { readonly parameter: string }
  /** A trigger of the library (`<ValueType Type="trigger"/>` with `<ValueElement Type="Trigger">`). */
  | { readonly trigger: string }
  /** Custom script (`<CustomType>` and `<ScriptCode>`): Galaxy text standing for a value of `customType`. */
  | { readonly customScript: string; readonly customType?: string }
  /** An Arithmetic or Expression value (`<ExpressionType>`): text whose `~<code>~` slots its values fill. */
  | { readonly expression: GuiExpression };

/**
 * An expression's type (`<ExpressionType>`: int, fixed, string or text), its text
 * (`<ExpressionText>`) with its `~<code>~` slots, and the value given for each slot
 * (`<ExpressionParam>`), in the Editor's order. A text expression's text is in GameStrings, keyed
 * by its Param (Param/Expression/lib_<library>_<id>), so it has none here.
 */
export type GuiExpression = { readonly type: string; readonly text?: string; readonly slots: readonly ExpressionSlot[] };

/** A value an expression's slot is given: the Param holding it, the slot's code (`<ExpressionCode>`), and the value. */
export type ExpressionSlot = { readonly id: string; readonly code: string } & GuiValue;

/**
 * A member of a structure a variable holds (`<StructMember>`): the Param naming it, the structure's
 * own variable, the values it is indexed by when it is an array, and a member of that, if it is a
 * structure too.
 */
export type StructMember = { readonly id: string; readonly variable: string; readonly index?: readonly HeldValue[]; readonly member?: StructMember };

/** A parameter of a call: its element id, the callee's ParamDef it fills, and its value. */
export type GuiParam = { readonly id: string; readonly def: string } & GuiValue;

/** One call in a GUI body: an action, a condition, or a function giving a value. */
export type GuiCall = {
  readonly id: string;
  /** The function called, as `<library>/<id>`. */
  readonly function: string;
  /** The block slot it sits in (If Then Else's "Then"), as `<library>/<id>`. */
  readonly sub?: string;
  readonly disabled?: boolean;
  readonly params?: readonly GuiParam[];
  /** The calls a block holds (If Then Else's conditions and actions), each with its slot. */
  readonly body?: readonly GuiStatement[];
  /** Custom Script's own Galaxy (`<ScriptCode>`), written as it stands. */
  readonly script?: string;
};

/** A comment among the actions: its text (empty for a blank one) and its slot. */
export type GuiComment = { readonly id: string; readonly comment: string; readonly sub?: string; readonly disabled?: boolean };

export type GuiStatement = GuiCall | GuiComment;

const FORMS = ["preset", "presetElement", "bits", "type", "call", "variable", "parameter", "trigger", "customScript", "expression"] as const;
/** Exactly one value form: a literal is its `type` (with `value`, `valueId`, `typeInfo`, `gameType` and `context`), a set of bits its `presetElement`, its `bits` or both, the others one key each. */
function oneValue(value: Record<string, unknown>, context: z.RefinementCtx): void {
  const forms = FORMS.filter((form) => value[form] !== undefined && !(form === "bits" && value.presetElement !== undefined));
  if (forms.length !== 1) context.addIssue({ code: "custom", message: `A value is one of ${FORMS.join(", ")} (a literal is its type, with value): this has ${forms.length ? forms.join(" and ") : "none"}` });
  if (forms[0] !== "type" && ["value", "valueId", "typeInfo", "gameType", "context", "valueParams"].some((key) => value[key] !== undefined)) {
    context.addIssue({ code: "custom", message: "value, valueId, typeInfo, gameType, context and valueParams go with a literal's type" });
  }
  if (value.member !== undefined && forms[0] !== "variable") context.addIssue({ code: "custom", message: "member goes with a variable" });
  if (value.index !== undefined && forms[0] !== "variable") context.addIssue({ code: "custom", message: "index goes with a variable" });
  if (value.customType !== undefined && forms[0] !== "customScript") context.addIssue({ code: "custom", message: "customType goes with customScript" });
}

/**
 * The GUI tree's schemas, with `Ref` the form a reference to a function, a parameter definition, a
 * block slot or a preset takes: a library's always names its library (`<library>/<id>`, its own
 * too), a map's names a library's and gives the map's own by Id alone (MapElementRef); and with
 * `VariableRef` the form a variable (or a structure's member) takes: a library's own by Id alone, a
 * map's own by Id or a library's global (and its structures' members) as `<library>/<id>`.
 */
function guiSchemas(Ref: z.ZodType<string>, VariableRef: z.ZodType<string>) {
  const valueShape = {
    preset: Ref.optional(),
    presetElement: Ref.optional(),
    /** The values set of a bits preset type (ValuePreset), in the Editor's order. */
    bits: z.array(Ref).min(1).optional(),
    value: z.string().optional(),
    type: z.string().min(1).optional(),
    /**
     * The element a literal names by its number (ValueId): a difficulty's or a player color's, an
     * ability command's index, a sound's one more than its index.
     */
    valueId: z.string().regex(/^\d+$/).optional(),
    /** What the Editor notes of a literal's type (ValueTypeInfo), such as an ability command's targeting or a file path's kind. */
    typeInfo: z.string().optional(),
    gameType: z.string().min(1).optional(),
    context: z.string().optional(),
    /** Values a literal holds of its own (ValueParam), such as a catalog field path's array index. */
    valueParams: z.array(z.lazy(() => HeldValueSchema)).optional(),
    call: z.lazy(() => GuiCallSchema).optional(),
    variable: VariableRef.optional(),
    /** The values an array variable is indexed by, one per dimension. */
    index: z.array(z.lazy(() => HeldValueSchema)).min(1).optional(),
    /** A member of the structure the variable holds. */
    member: z.lazy(() => StructMemberSchema).optional(),
    parameter: ElementId.optional(),
    trigger: ElementId.optional(),
    customScript: z.string().optional(),
    customType: z.string().min(1).optional(),
    /** An Arithmetic or Expression value: its type, its text and its slots' values. */
    expression: z.lazy(() => GuiExpressionSchema).optional(),
  };
  const StructMemberSchema: z.ZodType<StructMember> = z.lazy(() => z.object({ id: ElementId, variable: VariableRef, index: z.array(HeldValueSchema).min(1).optional(), member: StructMemberSchema.optional() }).strict()) as never;
  const GuiValueSchema: z.ZodType<GuiValue> = z.object(valueShape).strict().superRefine(oneValue) as never;
  const GuiParamSchema: z.ZodType<GuiParam> = z
    .object({ id: ElementId, def: Ref, ...valueShape })
    .strict()
    .superRefine(oneValue) as never;
  const GuiCallSchema: z.ZodType<GuiCall> = z.lazy(() =>
    z
      .object({
        id: ElementId,
        function: Ref,
        sub: Ref.optional(),
        disabled: z.boolean().optional(),
        params: z.array(GuiParamSchema).optional(),
        body: z.array(GuiStatementSchema).optional(),
        script: z.string().optional(),
      })
      .strict(),
  ) as never;
  const GuiCommentSchema = z.object({ id: ElementId, comment: z.string(), sub: Ref.optional(), disabled: z.boolean().optional() }).strict();
  const GuiStatementSchema: z.ZodType<GuiStatement> = z.lazy(() => z.union([GuiCommentSchema, GuiCallSchema])) as never;
  /** A value with the element id of the Param that holds it: a default, or a variable's initial value. */
  const HeldValueSchema: z.ZodType<{ readonly id: string } & GuiValue> = z.object({ id: ElementId, ...valueShape }).strict().superRefine(oneValue) as never;
  const ExpressionSlotSchema: z.ZodType<ExpressionSlot> = z.object({ id: ElementId, code: z.string().min(1), ...valueShape }).strict().superRefine(oneValue) as never;
  const GuiExpressionSchema: z.ZodType<GuiExpression> = z
    .object({ type: z.string().min(1), text: z.string().optional(), slots: z.array(ExpressionSlotSchema) })
    .strict()
    .refine((expression) => (expression.type === "text") === (expression.text === undefined), "A text expression's text is in GameStrings, and every other expression has its own text") as never;
  /** One of the function's (or trigger's) own variables. */
  const GuiVariableSchema = z
    .object({
      id: ElementId,
      /** Its name, as the Editor shows it (Variable/Name in TriggerStrings). */
      name: z.string(),
      /** Its Galaxy name, when the Editor was given one; else from its name. */
      identifier: z.string().min(1).optional(),
      type: VariableTypeSpecSchema,
      /** Its initial value, when it has one. */
      value: HeldValueSchema.optional(),
    })
    .strict();
  return { GuiValueSchema, GuiParamSchema, GuiCallSchema, GuiCommentSchema, GuiStatementSchema, HeldValueSchema, GuiVariableSchema };
}

const LIBRARY_GUI = guiSchemas(ElementRef, ElementId);
export const GuiValueSchema = LIBRARY_GUI.GuiValueSchema;
export const GuiParamSchema = LIBRARY_GUI.GuiParamSchema;
export const GuiCallSchema = LIBRARY_GUI.GuiCallSchema;
export const GuiCommentSchema = LIBRARY_GUI.GuiCommentSchema;
export const GuiStatementSchema = LIBRARY_GUI.GuiStatementSchema;
export const HeldValueSchema = LIBRARY_GUI.HeldValueSchema;
export type HeldValue = { readonly id: string } & GuiValue;
/** One of the function's own variables. */
export const GuiVariableSchema = LIBRARY_GUI.GuiVariableSchema;

/**
 * A reference in a map's GUI tree: a library's element as `<library>/<id>` (Ntve/00000136), or the
 * map's own by its Id alone (a Kept or Blueprint function, as the Editor writes it with no Library).
 */
export const MapElementRef = z.union([ElementRef, ElementId]);
/**
 * The GUI tree's schemas for a map's own elements (a Mission Blueprint's triggers): the map's own
 * references are bare Ids, and a variable may be a library's global, or a member of a library's
 * structure, as `<library>/<id>` (Cmpn/E5539606), as the Editor writes it with its Library.
 */
export const MAP_GUI = guiSchemas(MapElementRef, MapElementRef);
export type GuiVariable = z.infer<typeof GuiVariableSchema>;

/** A function's GUI body, as its source file in the mod's folder holds it. */
export const GuiBodySchema = z
  .object({
    variables: z.array(GuiVariableSchema).default([]),
    actions: z.array(GuiStatementSchema).default([]),
  })
  .strict();
export type GuiBody = z.infer<typeof GuiBodySchema>;

/** A source file in the mod's folder, relative to it (as the Mod Blueprint's other sources). */
const SourcePath = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.split(/[\\/]/).includes(".."), "A source is a file in the mod's folder, relative to it");
const PackagePath = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.includes("\\") && !value.split("/").includes(".."), "A package path is relative, with forward slashes, and stays inside the package");

export const FUNCTION_KINDS = ["action", "function", "condition", "event"] as const;
/**
 * The Editor's other function flags, as written without their Flag prefix (FlagCreateThread is
 * createThread). `allowBreak` marks a block whose slots may hold Stop Looping (a loop's own, such
 * as Nova's For Each Army Tech Item): it changes no Galaxy of the block's own.
 */
export const FUNCTION_FLAGS = ["native", "createThread", "hidden", "inline", "noScriptPrefix", "subFunctions", "allowBreak", "operator", "restricted"] as const;

export const LibraryParameterSchema = z
  .object({
    id: ElementId,
    /** Its name, as the Editor shows it (ParamDef/Name). */
    name: z.string(),
    identifier: z.string().min(1).optional(),
    type: TypeSpecSchema,
    default: HeldValueSchema.optional(),
    /** The preset its values are limited to (`<Preset Type="Preset">`), or the presets, where there are several. */
    preset: z.union([ElementRef, z.array(ElementRef).min(2)]).optional(),
    /** ParamFlagPreload: what it names is preloaded. */
    preload: z.boolean().optional(),
    /** Limits, as the Editor writes them. */
    limits: z.string().optional(),
  })
  .strict();
export type LibraryParameter = z.infer<typeof LibraryParameterSchema>;

export const SubFunctionSlotSchema = z
  .object({
    id: ElementId,
    name: z.string(),
    identifier: z.string().min(1).optional(),
    /** What the slot holds. */
    holds: z.enum(["action", "condition"]).optional(),
  })
  .strict();

/** The element ids a function's interface gives: its own, its parameters' and their defaults', its block slots'. */
const interfaceIds = (fn: { readonly id: string; readonly parameters: readonly { readonly id: string; readonly default?: { readonly id: string } | undefined }[]; readonly subFunctions: readonly { readonly id: string }[] }): string[] => [
  fn.id,
  ...fn.parameters.flatMap((parameter) => [parameter.id, ...(parameter.default ? [parameter.default.id] : [])]),
  ...fn.subFunctions.map((slot) => slot.id),
];

export const LibraryFunctionSchema = z
  .object({
    id: ElementId,
    /** Its name, as the Editor's function list shows it (FunctionDef/Name). */
    name: z.string().min(1),
    /** Its Galaxy name (lib<library>_gf_<identifier>), when the Editor was given one; else from its name. */
    identifier: z.string().min(1).optional(),
    kind: z.enum(FUNCTION_KINDS),
    flags: z.array(z.enum(FUNCTION_FLAGS)).default([]),
    /** Its grammar and hint, as the Editor's function list shows them. */
    grammar: z.string().optional(),
    hint: z.string().optional(),
    /** Its label (the icon in the function list), as `<library>/<id>`. */
    label: ElementRef.optional(),
    /** The Editor's Section, the part of a campaign it is filed under ("Shared", "Armory"): it changes no Galaxy. */
    section: z.string().min(1).optional(),
    disabled: z.boolean().optional(),
    /** Deprecated in the Editor's function list (kept for old callers): its statements are headed // Deprecated in place of // Implementation. */
    deprecated: z.boolean().optional(),
    internal: z.boolean().optional(),
    returns: TypeSpecSchema.optional(),
    parameters: z.array(LibraryParameterSchema).default([]),
    /** Its own block slots, for a block function such as an If Then. */
    subFunctions: z.array(SubFunctionSlotSchema).default([]),
    /** The Galaxy template of a function written as one (ScriptCode), with #PARAM and #SUBFUNCS. */
    script: z.string().optional(),
    /** A GUI body: its source file (src/mods/library-xml.ts reads it), GuiBodySchema. */
    gui: SourcePath.optional(),
    /** A Galaxy body: a script file the Blueprint owns, written whole at `path` in the package. */
    galaxy: z.object({ path: PackagePath.refine((file) => file.toLowerCase().endsWith(".galaxy"), "A Galaxy body is a .galaxy file"), source: SourcePath }).strict().optional(),
  })
  .strict()
  .superRefine((fn, context) => {
    const native = fn.flags.includes("native");
    if (fn.gui !== undefined && fn.galaxy !== undefined) context.addIssue({ code: "custom", path: ["galaxy"], message: "A function's body is GUI or Galaxy, not both" });
    if (native && fn.gui !== undefined) context.addIssue({ code: "custom", path: ["gui"], message: "A native function's body is Galaxy: give it as galaxy { path, source }" });
    if (native && fn.galaxy === undefined) context.addIssue({ code: "custom", path: ["galaxy"], message: "A native function's body is Galaxy, a script file the Blueprint owns: give it as galaxy { path, source }" });
    if (!native && fn.galaxy !== undefined) context.addIssue({ code: "custom", path: ["flags"], message: "A function with a Galaxy body is native: add native to its flags" });
    if (!native && fn.gui === undefined && fn.script === undefined) context.addIssue({ code: "custom", path: ["gui"], message: "A function's body is GUI by default: give its source file as gui" });
    const ids = interfaceIds(fn);
    const twice = ids.find((id, index) => ids.indexOf(id) !== index);
    if (twice) context.addIssue({ code: "custom", path: ["parameters"], message: `The element id ${twice} is used twice in ${fn.name}` });
  });
export type LibraryFunction = z.infer<typeof LibraryFunctionSchema>;

/**
 * The kinds of item a library files in its Root or a category (a trigger folder), as the compile
 * record names them, and the Editor's element type of each.
 */
export const LIBRARY_ITEM_TYPES = {
  category: "Category",
  function: "FunctionDef",
  trigger: "Trigger",
  variable: "Variable",
  preset: "Preset",
  structure: "Structure",
  comment: "Comment",
  "custom-script": "CustomScript",
} as const;
export type LibraryItemKind = keyof typeof LIBRARY_ITEM_TYPES;
/** The kinds of item the interface declares beside its functions (triggers and globals are the Mod Blueprint's `triggers`). */
export const LIBRARY_STRUCTURE_KINDS = ["category", "preset", "structure", "comment", "custom-script"] as const;
export type LibraryStructureKind = (typeof LIBRARY_STRUCTURE_KINDS)[number];
/** An item of the library as Root or a category files it: `<kind>:<id>`, such as `function:B8B27D5C` or `category:9C164C63`. */
export const LibraryItemRef = z
  .string()
  .regex(new RegExp(`^(${Object.keys(LIBRARY_ITEM_TYPES).join("|")}):[0-9A-F]{8}$`), `An item is <kind>:<id>, its kind one of ${Object.keys(LIBRARY_ITEM_TYPES).join(", ")}`);

/** A category (a trigger folder): its name, and the items filed in it, in order. */
export const LibraryCategorySchema = z
  .object({
    id: ElementId,
    /** Its name, as the Editor shows it (Category/Name); none for one the Editor shows by its id. */
    name: z.string().optional(),
    identifier: z.string().min(1).optional(),
    /** Its label (the folder's icon), as `<library>/<id>`. */
    label: ElementRef.optional(),
    items: z.array(LibraryItemRef).default([]),
  })
  .strict();
export type LibraryCategory = z.infer<typeof LibraryCategorySchema>;

/** One value of a preset type. */
export const PresetValueSchema = z
  .object({
    id: ElementId,
    /** Its name, as the Editor shows it (PresetValue/Name); none for one the Editor shows by its id. */
    name: z.string().optional(),
    /** Its value as the Editor writes it (`<Value>`), absent for none. */
    value: z.string().optional(),
    /** DefinesDefault: the value the preset type starts at. */
    default: z.boolean().optional(),
  })
  .strict();

/** A preset type: its base type and its values. */
export const LibraryPresetSchema = z
  .object({
    id: ElementId,
    /** Its name, as the Editor shows it (Preset/Name); none for one the Editor shows by its id. */
    name: z.string().optional(),
    /** Its base type (BaseType), such as int or bool. */
    baseType: z.string().min(1),
    /** PresetCustom: its values are the library's own. */
    custom: z.boolean().optional(),
    /** PresetGenConstVar: Galaxy gets a constant for each value. */
    constants: z.boolean().optional(),
    /** The preset type it extends (PresetExtends), as `<library>/<id>`. */
    extends: ElementRef.optional(),
    values: z.array(PresetValueSchema).default([]),
  })
  .strict();
export type LibraryPreset = z.infer<typeof LibraryPresetSchema>;

/** A structure (a record type): its members, each a variable with its type and initial value. */
export const LibraryStructureSchema = z
  .object({
    id: ElementId,
    /** Its name, as the Editor shows it (Structure/Name); none for one the Editor shows by its id. */
    name: z.string().optional(),
    members: z.array(GuiVariableSchema).default([]),
  })
  .strict();
export type LibraryStructure = z.infer<typeof LibraryStructureSchema>;

/** A comment filed among the library's items: its text, empty for a blank one. */
export const LibraryCommentSchema = z.object({ id: ElementId, comment: z.string() }).strict();
export type LibraryComment = z.infer<typeof LibraryCommentSchema>;

/** Custom script filed among the library's items: Galaxy the Editor writes into the library's script as it stands. */
export const LibraryCustomScriptSchema = z
  .object({
    id: ElementId,
    /** Its name, as the Editor shows it (CustomScript/Name); none for one the Editor shows by its id. */
    name: z.string().optional(),
    identifier: z.string().min(1).optional(),
    label: ElementRef.optional(),
    script: z.string(),
    /** The Galaxy function the library's initialization calls (InitFunc). */
    initFunction: z.string().min(1).optional(),
  })
  .strict();
export type LibraryCustomScript = z.infer<typeof LibraryCustomScriptSchema>;

/** Each element id the library's items other than functions give, with what gives it. */
export function structureIds(library: Pick<LibraryInterface, "categories" | "presets" | "structures" | "comments" | "customScripts">): { readonly id: string; readonly by: string }[] {
  return [
    ...library.categories.map((category, index) => ({ id: category.id, by: `categories.${index}` })),
    ...library.presets.flatMap((preset, index) => [{ id: preset.id, by: `presets.${index}` }, ...preset.values.map((value) => ({ id: value.id, by: `presets.${index}` }))]),
    ...library.structures.flatMap((structure, index) => [
      { id: structure.id, by: `structures.${index}` },
      ...structure.members.flatMap((member) => [member.id, ...(member.value ? heldIds(member.value) : [])]).map((id) => ({ id, by: `structures.${index}` })),
    ]),
    ...library.comments.map((comment, index) => ({ id: comment.id, by: `comments.${index}` })),
    ...library.customScripts.map((script, index) => ({ id: script.id, by: `customScripts.${index}` })),
  ];
}

/** The element ids a held value gives: its own, and those of the values and calls it holds. */
export function heldIds(value: HeldValue): string[] {
  return [value.id, ...valueIds(value)];
}
function valueIds(value: GuiValue): string[] {
  if ("call" in value && value.call) return statementIds(value.call);
  if ("valueParams" in value && value.valueParams) return value.valueParams.flatMap(heldIds);
  if ("expression" in value && value.expression) return value.expression.slots.flatMap(heldIds);
  if ("variable" in value && value.variable !== undefined) return [...(value.member ? memberIds(value.member) : []), ...(value.index ?? []).flatMap(heldIds)];
  return [];
}
/** A member's ids in the order the Editor writes them: its own, its member's, then its index values'. */
const memberIds = (member: StructMember): string[] => [member.id, ...(member.member ? memberIds(member.member) : []), ...(member.index ?? []).flatMap(heldIds)];
/** The element ids a statement gives: its own, its parameters' and the values and calls they hold, and those of the statements in its slots. */
export function statementIds(statement: GuiStatement): string[] {
  if (isComment(statement)) return [statement.id];
  return [statement.id, ...(statement.params ?? []).flatMap((param) => [param.id, ...valueIds(param)]), ...(statement.body ?? []).flatMap(statementIds)];
}

export const LibraryInterfaceSchema = z
  .object({
    /** The library's id, as Missions name it (`Library="<id>"`) and Galaxy does (lib<id>_gf_…). */
    id: LibraryId,
    /** Its name, as the Editor shows it (Library/Name). */
    name: z.string().min(1),
    /**
     * The items filed in the library's Root, in order, when the interface writes it; any item of the
     * interface no category files goes at its end. A Kept item may be named: its line is written here.
     */
    root: z.array(LibraryItemRef).optional(),
    /** Its categories (trigger folders), each filing its items. */
    categories: z.array(LibraryCategorySchema).default([]),
    functions: z.array(LibraryFunctionSchema).default([]),
    presets: z.array(LibraryPresetSchema).default([]),
    structures: z.array(LibraryStructureSchema).default([]),
    comments: z.array(LibraryCommentSchema).default([]),
    customScripts: z.array(LibraryCustomScriptSchema).default([]),
    /**
     * The words of its functions' text values and text expressions, by the strings file each is in
     * (GameStrings, as the Editor writes them), each keyed by the value's Param:
     * Param/Value/lib_<library>_<id> and Param/Expression/lib_<library>_<id>. An empty text's key
     * holds nothing or is left out (convert-library takes them from the package).
     */
    strings: StringsSchema.optional(),
  })
  .strict()
  .superRefine((library, context) => {
    const seen = new Map<string, number>();
    for (const [index, fn] of library.functions.entries()) {
      for (const id of new Set(interfaceIds(fn))) {
        const other = seen.get(id);
        if (other !== undefined) context.addIssue({ code: "custom", path: ["functions", index], message: `The element id ${id} is in both ${library.functions[other]!.name} (functions.${other}) and ${fn.name} (functions.${index})` });
        else seen.set(id, index);
      }
    }
    const given = new Map<string, string>([...seen].map(([id, index]) => [id, `functions.${index}`]));
    for (const { id, by } of structureIds(library)) {
      const other = given.get(id);
      if (other !== undefined) context.addIssue({ code: "custom", path: by.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part)), message: `The element id ${id} is ${other === by ? "used twice" : "given twice"} in ${other === by ? by : `${other} and ${by}`}: each element of the library has an id of its own` });
      else given.set(id, by);
    }
    // Each item is filed once, in Root or one category.
    const filed = new Map<string, string>();
    const file = (ref: string, where: string, path: (string | number)[]): void => {
      const other = filed.get(ref);
      if (other !== undefined) context.addIssue({ code: "custom", path, message: `${ref} is filed in both ${other} and ${where}: an item is filed once` });
      else filed.set(ref, where);
    };
    (library.root ?? []).forEach((ref, index) => file(ref, "root", ["root", index]));
    library.categories.forEach((category, index) => category.items.forEach((ref, at) => file(ref, `categories.${index} (${category.name ?? category.id})`, ["categories", index, "items", at])));
    for (const [index, category] of library.categories.entries()) {
      if (category.items.includes(`category:${category.id}`)) context.addIssue({ code: "custom", path: ["categories", index], message: `The category ${category.name ?? category.id} files itself` });
    }
  });
export type LibraryInterface = z.infer<typeof LibraryInterfaceSchema>;

/** A statement is a comment, not a call. */
export const isComment = (statement: GuiStatement): statement is GuiComment => "comment" in statement;
