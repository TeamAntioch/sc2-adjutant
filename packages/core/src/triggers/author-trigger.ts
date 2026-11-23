// Writes a Mission Blueprint's trigger element (ADR-0026) from calls given in the Editor's terms
// (#1033): functions by name or identifier, parameters by name, presets by value name, block slots
// by name (If, Then, Else), and the map's own variables, triggers and functions by name. Names are
// resolved against the libraries in reach (function-search.ts's resolveFunction) and the map's own
// elements; a name two functions share is ambiguous until a library is given. Ids are filled in,
// and a parameter not given takes the value a new call gives it in the Editor (its default, copied
// with Ids of its own, a text's words from its library's GameStrings). Each value is checked against
// its parameter's type. Every value a converted trigger holds has a form here (#1061): the map's own
// preset values and records' members, sets of bits, Arithmetic and Expression values, a library's
// globals by name, a literal with what the Editor saves of it, a parameter left unset or repeated;
// authoring-outline.ts reads a Blueprint trigger back into this input.
//
// The input is a readable, editable tree of calls (AuthoringTrigger): what an outline of a Blueprint
// trigger reads back to (#1034), so a trigger can be read, edited and written again. Rewriting a
// trigger keeps its Id, its locals' Ids by name, and the Ids of every call left unchanged; a call
// changed in place (the same function where it was) keeps its own Id and its unchanged parameters'.
// A new Id is 8 hex digits no element in reach has (`taken`: the package's, the compile record's
// and the Blueprint's).
//
// Custom script is written only where the input asks for it (`customScript`). A name nothing in reach
// has is refused, pointing to search_trigger_functions, to custom script asked for explicitly, and to
// a Missing-Feature Report (the report-missing-feature skill). Every refusal names its place and
// what's wrong in the Editor's terms.

import { createHash } from "node:crypto";

import { z } from "zod";

import type { BlueprintTrigger } from "../domain/blueprint-trigger.js";
import { type GuiCall, type GuiParam, type GuiStatement, type GuiValue, type GuiVariable, type HeldValue, isComment, type LibraryFunction, type StructMember, type TypeSpec } from "../domain/library-interface.js";
import { blueprintTriggerIds } from "./blueprint-triggers.js";
import { editorTypeName, type FunctionEntry, resolveFunction } from "../mods/function-search.js";
import { type GameLibrary, gameTriggerTypeNames, type LibraryVariable } from "../mods/library-galaxy.js";

/** A value in the Editor's terms. */
export type AuthoringValue =
  /** A number: an Integer or a Real literal, as the parameter takes. */
  | number
  /** true or false: a Boolean literal. */
  | boolean
  /** By the parameter's type: a preset value by name, a text's words, a String, a trigger by name, a game link's id. */
  | string
  /** A call's value. */
  | AuthoringCall
  /** A preset value by its name (Game Time), a library's as `<library>/<id>`, or the map's own by name or Id. */
  | { readonly preset: string }
  /** A set of bits: the values set, by name (none for none set), of the parameter's preset type, or of `preset` (a bits preset type by name or reference) where it takes any. */
  | AuthoringBits
  /** A variable: the trigger's local, a Blueprint or Kept global by name (or Id), or a library's global by name (or `<library>/<id>`). */
  | AuthoringVariableRef
  /** A trigger by name: a Kept or Blueprint one, or this one. */
  | { readonly trigger: string }
  /** A text: its words, in GameStrings. */
  | { readonly text: string }
  /**
   * A literal as the Editor writes it: its value and type, a game link's catalog, and what else the
   * Editor saves of it: a placed object's or a number's element (`valueId`: a placed unit, point,
   * region or camera, a player colour, an ability command's index), its type's note (`typeInfo`, an
   * ability command's targeting) and a user type instance's type (`context`).
   */
  | AuthoringLiteral
  /** An Arithmetic or Expression value: its type, its text with `~<code>~` slots (a text expression's words), and each slot's value by code, in the Editor's order. */
  | AuthoringExpression
  /** Custom script standing for a value, asked for explicitly. */
  | { readonly customScript: string; readonly type?: string };

/** A set of bits: its values set, by name or reference, and the bits preset type they are of (by name or reference) where the parameter doesn't name one. */
export type AuthoringBits = { readonly bits: readonly string[]; readonly preset?: string };
/** A literal: its value as the Editor writes it and its type, with the catalog, number, type note and user type the Editor saves of some. */
export type AuthoringLiteral = { readonly value?: string; readonly type: string; readonly gameType?: string; readonly valueId?: string; readonly typeInfo?: string; readonly context?: string };
/** An Arithmetic or Expression value: its text with `~<code>~` slots (a Text one's words), its type (Integer, Real, String or Text) and each slot's value by code. */
export type AuthoringExpression = { readonly expression: string; readonly type: string; readonly slots?: Readonly<Record<string, AuthoringValue>> };

/**
 * A variable named, indexed by a value per dimension and, for a structure, one of its members by
 * name, and so on. `library` settles a library global's name two libraries in reach share.
 */
export type AuthoringVariableRef = { readonly variable: string; readonly library?: string; readonly index?: readonly AuthoringValue[]; readonly member?: AuthoringMember };
/** A member of a library's structure, by name or as `<library>/<id>`, and a member of it in turn. */
export type AuthoringMember = { readonly variable: string; readonly index?: readonly AuthoringValue[]; readonly member?: AuthoringMember };

/** A call: its function by name, identifier or `<library>/<id>`; its parameters by name; its blocks' statements by slot name. */
export type AuthoringCall = {
  readonly function: string;
  /** The function's library, by id (Ntve) or name (Built-In), or "map" for the map's own: needed only when the name is ambiguous. */
  readonly library?: string;
  /** Its parameters by name (or by reference, where two share a name); `null` leaves one unset, as the Editor saves a call not filled in; a list gives a parameter its template repeats each value. */
  readonly params?: Readonly<Record<string, AuthoringValue | readonly AuthoringValue[] | null>>;
  readonly blocks?: Readonly<Record<string, readonly AuthoringStatement[]>>;
  readonly disabled?: boolean;
};

/** A statement: a call, a comment, or custom script asked for explicitly. */
export type AuthoringStatement = AuthoringCall | { readonly comment: string; readonly disabled?: boolean } | { readonly customScript: string; readonly disabled?: boolean };

/** A local variable: its name, its type by the Editor's name (Unit Group), its own (unitgroup) or a preset's name, and its initial value. */
export type AuthoringVariable = {
  readonly name: string;
  readonly type: string | { readonly type: string; readonly element?: string; readonly gameType?: string; readonly assetType?: string; readonly userType?: string };
  readonly value?: AuthoringValue;
  /** An array's size in each dimension. */
  readonly array?: readonly number[];
  readonly constant?: boolean;
  /** Its Galaxy name, where the Editor was given one; else from its name. */
  readonly identifier?: string;
};

/** A trigger in the Editor's terms. */
export type AuthoringTrigger = {
  /** The Blueprint trigger rewritten, by its element Id: needed only to rename one, which is otherwise found by its name. */
  readonly id?: string;
  readonly name: string;
  readonly identifier?: string;
  /** Its icon in the Editor's trigger list, a Label as `<library>/<id>`. */
  readonly label?: string;
  readonly section?: string;
  readonly disabled?: boolean;
  readonly initiallyOff?: boolean;
  readonly variables?: readonly AuthoringVariable[];
  /** Its events: calls, and comments among them. */
  readonly events?: readonly (AuthoringCall | { readonly comment: string; readonly disabled?: boolean })[];
  readonly conditions?: readonly AuthoringStatement[];
  readonly actions?: readonly AuthoringStatement[];
};

const ValueSchema: z.ZodType<AuthoringValue> = z.lazy(() =>
  z.union([
    z.number().finite(),
    z.boolean(),
    z.string(),
    z.object({ preset: z.string().min(1) }).strict(),
    z.object({ bits: z.array(z.string().min(1)), preset: z.string().min(1).optional() }).strict(),
    z.object({ variable: z.string().min(1), library: z.string().min(1).optional(), index: z.array(ValueSchema).min(1).optional(), member: MemberSchema.optional() }).strict(),
    z.object({ trigger: z.string().min(1) }).strict(),
    z.object({ text: z.string() }).strict(),
    z
      .object({
        value: z.string().optional(),
        type: z.string().min(1),
        gameType: z.string().min(1).optional(),
        valueId: z.string().regex(/^\d+$/).optional(),
        typeInfo: z.string().optional(),
        context: z.string().optional(),
      })
      .strict(),
    z
      .object({
        expression: z.string().describe("Its text with ~<code>~ slots (~A~ + 1); a text expression's words"),
        type: z.string().min(1).describe("Integer, Real, String or Text"),
        slots: z.record(z.string().min(1), ValueSchema).optional().describe("Each slot's value by its code, in the Editor's order"),
      })
      .strict(),
    z.object({ customScript: z.string().min(1), type: z.string().min(1).optional() }).strict(),
    CallSchema,
  ]),
) as never;
const MemberSchema: z.ZodType<AuthoringMember> = z.lazy(() => z.object({ variable: z.string().min(1), index: z.array(ValueSchema).min(1).optional(), member: MemberSchema.optional() }).strict()) as never;
const CallSchema: z.ZodType<AuthoringCall> = z.lazy(() =>
  z
    .object({
      function: z.string().min(1).describe("The function's name as the Editor shows it (Periodic Event), its identifier (TriggerAddEventTimePeriodic) or <library>/<id>"),
      library: z.string().min(1).optional().describe("Its library by id (Ntve) or name (Built-In), or map for the map's own: only when the name is ambiguous"),
      params: z.record(z.string(), z.union([ValueSchema, z.array(ValueSchema).min(1), z.null()])).optional().describe("Its parameters by name (Duration), or by reference where two share a name; one left out takes its default, null leaves it unset, and a list gives a parameter its template repeats (Combine Text Multiple's Text) each value"),
      blocks: z.record(z.string(), z.array(StatementSchema)).optional().describe("A block's statements by slot name (If, Then, Else)"),
      disabled: z.boolean().optional(),
    })
    .strict(),
) as never;
const StatementSchema: z.ZodType<AuthoringStatement> = z.lazy(() =>
  z.union([z.object({ comment: z.string(), disabled: z.boolean().optional() }).strict(), z.object({ customScript: z.string().min(1), disabled: z.boolean().optional() }).strict(), CallSchema]),
) as never;

export const AuthoringTriggerSchema: z.ZodType<AuthoringTrigger> = z
  .object({
    id: z.string().regex(/^[0-9A-F]{8}$/).optional().describe("The Blueprint trigger to rewrite, by its element Id: only to rename it"),
    name: z.string().min(1).describe("Its name, as the Editor shows it; a Blueprint trigger of this name is rewritten"),
    identifier: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
    label: z.string().regex(/^[A-Za-z0-9]+\/[0-9A-F]{8}$/).optional().describe("Its icon, a Label as <library>/<id>"),
    section: z.string().min(1).optional(),
    disabled: z.boolean().optional(),
    initiallyOff: z.boolean().optional(),
    variables: z
      .array(
        z
          .object({
            name: z.string().min(1),
            type: z.union([z.string().min(1), z.object({ type: z.string().min(1), element: z.string().optional(), gameType: z.string().optional(), assetType: z.string().optional(), userType: z.string().optional() }).strict()]),
            value: ValueSchema.optional(),
            array: z.array(z.number().int().positive()).min(1).optional(),
            constant: z.boolean().optional(),
            identifier: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
          })
          .strict(),
      )
      .optional(),
    events: z.array(z.union([z.object({ comment: z.string(), disabled: z.boolean().optional() }).strict(), CallSchema])).optional(),
    conditions: z.array(StatementSchema).optional(),
    actions: z.array(StatementSchema).optional(),
  })
  .strict() as never;

/** The map's own elements a trigger may name: its Kept functions (their interfaces, own references bare), its Kept and Blueprint globals, and its Kept and Blueprint triggers. */
export type MapReach = {
  readonly functions: readonly LibraryFunction[];
  /** A global whose type can't be read whole has none, and a value naming it is checked against no type. */
  readonly globals: readonly { readonly id: string; readonly name: string; readonly type?: TypeSpec }[];
  readonly triggers: readonly { readonly id: string; readonly name: string }[];
  /** Its Kept preset types, each with its values by Id (a value with no name of its own can be given by Id only). */
  readonly presets?: readonly MapPreset[];
  /** Its Kept structures (records), each with its members by Id, name and type. */
  readonly structures?: readonly { readonly id: string; readonly members: readonly { readonly id: string; readonly name: string; readonly type?: TypeSpec }[] }[];
  /** Its GameStrings' words, by key (Param/Value/<id>): the texts its Kept functions' defaults hold. */
  readonly texts?: ReadonlyMap<string, string>;
};

/** One of the map's own preset types: its Id, its name, its base type, whether its values are bits, and its values. */
export type MapPreset = {
  readonly id: string;
  readonly name?: string | undefined;
  readonly base?: string | undefined;
  readonly bits?: boolean | undefined;
  readonly values: readonly { readonly id: string; readonly name?: string | undefined; readonly identifier?: string | undefined }[];
};

export type AuthoringContext = {
  readonly libraries: Readonly<Record<string, GameLibrary>>;
  readonly map: MapReach;
  /** Every element Id in reach (the package's, the compile record's, the Blueprint's): a new Id is none of them. */
  readonly taken: ReadonlySet<string>;
  /** The Blueprint trigger rewritten, whose Ids are kept where its calls are unchanged. */
  readonly previous?: BlueprintTrigger;
  /**
   * Told, for a value, a structure member or a local given, the plainest form in the Editor's terms
   * that writes it the same where it stands (Ids aside), where it has one: a preset value, global,
   * member, trigger or type by its name, a literal as a number, a boolean or its text. An outline
   * reads a trigger back in these (authoring-outline.ts, #1034). `given` is the input's own object.
   * Each form is tried by building it, which takes fresh Ids, so a write told this is a trial: keep
   * the forms, not the trigger it writes.
   */
  readonly plainer?: (given: object, form: unknown) => void;
};

export type AuthoredBlueprintTrigger = {
  readonly trigger: BlueprintTrigger;
  /** How many of its calls kept the Id they had, and how many it has. */
  readonly keptCalls: number;
  readonly calls: number;
};

/** Why a trigger can't be written: each problem, in the Editor's terms. */
export class AuthoringError extends Error {
  constructor(
    readonly trigger: string,
    readonly problems: readonly string[],
  ) {
    super(`The trigger "${trigger}" can't be written:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
    this.name = "AuthoringError";
  }
}

/** Where no function in reach does the job: custom script, asked for, and a Missing-Feature Report. */
export const NO_FUNCTION_FITS =
  'find one with search_trigger_functions; if no game function does the job, write custom script only where asked for ({ "customScript": "<Galaxy>" }), and offer the mapper a Missing-Feature Report (the report-missing-feature skill)';

/** Custom Script, the action that runs Galaxy text as it stands. */
export const CUSTOM_SCRIPT = "Ntve/00000123";
/** The GameStrings file a trigger's words are written to: the input's locale. */
export const GAME_STRINGS = "enUS.SC2Data/LocalizedData/GameStrings.txt";

/** A parameter of a function in reach: its reference, name, type and default (the library's form). */
type Parameter = { readonly ref: string; readonly name: string; readonly type: TypeSpec; readonly default?: HeldValue | undefined; readonly repeats?: boolean };
type Slot = { readonly ref: string; readonly name: string; readonly holds?: "action" | "condition" | undefined };
/** A function in reach, as a call needs it. */
type Callable = {
  readonly ref: string;
  readonly name: string;
  /** Where it is, for a message: its library's name, or "the map". */
  readonly where: string;
  readonly kind: LibraryFunction["kind"];
  readonly params: readonly Parameter[];
  readonly returns?: TypeSpec | undefined;
  readonly slots: readonly Slot[];
};

/** A value built: its GUI form (without its holder's Id) and its type, where it has one. */
type Built = { readonly gui: GuiValue; readonly type?: TypeSpec | undefined };

/** A preset type in reach: its name, base type, whether its values are bits, its values' references and where it is (a library's name, or "the map"). */
type PresetType = { readonly name?: string | undefined; readonly base?: string | undefined; readonly bits?: boolean | undefined; readonly values: readonly string[]; readonly where: string };

/** The words a value built carries until it has its holder's Id: a text's (`words`), a text expression's (`expressionWords`). */
type Worded = { readonly words?: string; readonly expressionWords?: string };

/** An expression's type, from the Editor's name (Integer, Real, String, Text) or its own (int, fixed, string, text). */
const EXPRESSION_TYPES: Readonly<Record<string, string>> = { integer: "int", int: "int", real: "fixed", fixed: "fixed", string: "string", text: "text" };

/** A name as two are compared: in any case, its spaces aside. */
export const folded = (text: string): string => text.toLowerCase().replace(/\s+/g, "");
const quoteList = (names: readonly string[]): string => names.map((name) => `"${name}"`).join(", ");
/** A library's element as `<library>/<id>`. */
export const ELEMENT_REF = /^[A-Za-z0-9]+\/[0-9A-F]{8}$/;

/** Where a call stands: in the events, the conditions (or an If's slot), the actions, or as a value. */
type CallKind = "event" | "condition" | "action" | "value";

/** Whether a function of `kind` fits where a call of `wanted` stands: a value is any that gives one. */
const fitsKind = (wanted: CallKind, kind: LibraryFunction["kind"], returns: boolean): boolean => (wanted === "value" ? returns : kind === wanted);

/** A word with its article, as a refusal names a kind or a type: an Integer, a Unit Group. */
const withArticle = (word: string): string => (/^[AEIOaeio]/.test(word) ? `an ${word}` : `a ${word}`);

/** A map's own function, as a call needs it. */
const mapCallable = (fn: LibraryFunction): Callable => ({
  ref: fn.id,
  name: fn.name,
  where: "the map",
  kind: fn.kind,
  params: fn.parameters.map((parameter) => ({ ref: parameter.id, name: parameter.name, type: parameter.type, default: parameter.default })),
  returns: fn.returns,
  slots: fn.subFunctions.map((slot) => ({ ref: slot.id, name: slot.name, holds: slot.holds })),
});

/** Types that take any value: the Editor checks them against each other only. */
const ANY_TYPE = new Set(["anycompare", "sameasparent", "return"]);

/** Whether a value of type `given` fits where `expected` is wanted. */
function fits(expected: TypeSpec, given: TypeSpec | undefined): boolean {
  if (given === undefined || ANY_TYPE.has(expected.type)) return true;
  if (expected.type === "anyvariable") return true;
  if (expected.type === "anynumber") return given.type === "int" || given.type === "fixed";
  // An Integer where a Real is taken is one to Galaxy, and the Editor saves such (Arithmetic (Integer) given a Real parameter, in pkorhal02 and thanson01).
  if (expected.type === "fixed" && given.type === "int") return true;
  if (expected.type === "anypreset") return given.type === "preset";
  if (expected.type === "anygamelink") return given.type === "gamelink";
  if (expected.type !== given.type) return false;
  if (expected.type === "preset" && expected.element !== undefined && given.element !== undefined) return expected.element === given.element;
  if (expected.type === "gamelink" && expected.gameType !== undefined && given.gameType !== undefined) return expected.gameType === given.gameType;
  return true;
}

/** Whether a function's template repeats its parameter `identifier` (`#PARAM(<identifier>,<separator>)`, Combine Text Multiple's Text): a call gives it a list of values. */
export const templateRepeats = (script: string | undefined, identifier: string | undefined): boolean => identifier !== undefined && script?.includes(`#PARAM(${identifier},`) === true;

/** New element Ids: 8 hex digits, none taken, the same for the same seed. */
class IdSource {
  private count = 0;
  private readonly given = new Set<string>();
  constructor(
    private readonly taken: ReadonlySet<string>,
    private readonly seed: string,
  ) {}
  next(): string {
    for (;;) {
      const id = createHash("sha1").update(`${this.seed}/${this.count++}`).digest("hex").slice(0, 8).toUpperCase();
      if (!this.taken.has(id) && !this.given.has(id)) {
        this.given.add(id);
        return id;
      }
    }
  }
}

/** Writes `input` as a Blueprint trigger element, its names resolved in `context`. Refused (AuthoringError) with every problem found. */
export function authorTrigger(input: AuthoringTrigger, context: AuthoringContext): AuthoredBlueprintTrigger {
  return new Author(input, context).write();
}

class Author {
  private readonly problems: string[] = [];
  /** How many disabled statements the one being written is in. */
  private disabled = 0;
  private readonly ids: IdSource;
  /** Each text value's and text expression's words, by its key in GameStrings (Param/Value/<id>, Param/Expression/<id>). */
  private readonly words = new Map<string, string>();
  private readonly id: string;
  private readonly locals: { readonly id: string; readonly name: string; readonly type: TypeSpec }[] = [];
  /** Every preset type in reach, by reference (`<library>/<id>`, the map's own by Id). */
  private readonly presetTypes = new Map<string, PresetType>();
  /** Every preset value in reach, by reference: its name and identifier. */
  private readonly presetValueNames = new Map<string, { readonly name?: string | undefined; readonly identifier?: string | undefined }>();
  /** Each preset value's preset types, by reference. */
  private readonly presetsOf = new Map<string, string[]>();
  /** How many trial builds (`quietly`) the one being built is in: none is offered as plainer. */
  private trying = 0;

  constructor(
    private readonly input: AuthoringTrigger,
    private readonly context: AuthoringContext,
  ) {
    this.ids = new IdSource(new Set([...context.taken, ...(context.previous ? blueprintTriggerIds(context.previous) : [])]), input.name);
    this.id = context.previous?.id ?? this.ids.next();
    const addType = (ref: string, type: PresetType): void => {
      this.presetTypes.set(ref, type);
      for (const value of type.values) this.presetsOf.set(value, [...(this.presetsOf.get(value) ?? []), ref]);
    };
    for (const [library, lib] of Object.entries(context.libraries)) {
      for (const [id, value] of Object.entries(lib.presetValues)) this.presetValueNames.set(`${library}/${id}`, { name: value.name, identifier: value.identifier });
      for (const [id, preset] of Object.entries(lib.presets)) addType(`${library}/${id}`, { name: preset.name, base: preset.base, bits: preset.bits, values: (preset.values ?? []).map((value) => `${library}/${value}`), where: lib.name ?? library });
    }
    for (const preset of context.map.presets ?? []) {
      for (const value of preset.values) this.presetValueNames.set(value.id, { name: value.name, identifier: value.identifier });
      addType(preset.id, { name: preset.name, base: preset.base, bits: preset.bits, values: preset.values.map((value) => value.id), where: "the map" });
    }
  }

  private refuse(where: string, problem: string): void {
    this.problems.push(where ? `${where}: ${problem}` : problem);
  }

  /** What `build` gives, as a trial: no problem it finds and no words it gives are kept. */
  private quietly<T>(build: () => T): T {
    const problems = this.problems.length;
    const words = new Map(this.words);
    this.trying++;
    try {
      return build();
    } finally {
      this.trying--;
      this.problems.length = problems;
      this.words.clear();
      for (const [key, text] of words) this.words.set(key, text);
    }
  }

  /** Tells the context (`plainer`) the first of `forms` that `build` writes as it wrote `given` (`built`), Ids aside. */
  private offerPlainer<F>(given: object, built: unknown, forms: readonly (F | undefined)[], build: (form: F) => unknown): void {
    const tell = this.context.plainer;
    if (!tell || this.trying > 0 || built === undefined) return;
    const shape = idless(built);
    for (const form of forms) {
      if (form === undefined) continue;
      const tried = this.quietly(() => build(form));
      if (tried !== undefined && idless(tried) === shape) return tell(given, form);
    }
  }

  /** The plainer forms of `input` to try, plainest first: by its name where it is given by reference, a literal as a number, boolean or text. */
  private plainerForms(input: Exclude<AuthoringValue, number | boolean | string | AuthoringCall>): (AuthoringValue | undefined)[] {
    const { libraries, map } = this.context;
    // A set of bits first: it may name its preset type (`preset`).
    if ("bits" in input) {
      const bits = input.bits.map((bit) => this.presetValueNames.get(bit)?.name ?? bit);
      const type = input.preset === undefined ? undefined : this.presetTypes.get(input.preset)?.name;
      return [{ bits }, type === undefined ? undefined : { bits, preset: type }, input.preset === undefined ? undefined : { bits, preset: input.preset }];
    }
    if ("preset" in input) {
      const name = this.presetValueNames.get(input.preset)?.name;
      return name === undefined ? [] : [name, { preset: name }];
    }
    if ("variable" in input) {
      const global = map.globals.find((each) => each.id === input.variable);
      if (global) return [{ ...input, variable: global.name }];
      if (!ELEMENT_REF.test(input.variable)) return [];
      const [library, id] = input.variable.split("/") as [string, string];
      const name = libraries[library]?.variables?.[id]?.name;
      return name === undefined ? [] : [{ ...input, variable: name }, { ...input, variable: name, library }];
    }
    if ("trigger" in input) {
      const name = input.trigger === this.id ? this.input.name : map.triggers.find((each) => each.id === input.trigger)?.name;
      return name === undefined ? [] : [name, { trigger: name }];
    }
    if ("text" in input) return [input.text];
    // A literal holding no more than its value and type, or a game link's catalog, which a game link parameter gives.
    if ("type" in input && "value" in input && input.value !== undefined && Object.keys(input).every((key) => ["type", "value", "gameType"].includes(key))) {
      if (input.type === "bool") return [input.value === "true" ? true : input.value === "false" ? false : undefined];
      const number = Number(input.value);
      return [input.value.trim() !== "" && Number.isFinite(number) ? number : undefined, input.value];
    }
    return [];
  }

  private typeName(type: TypeSpec | undefined): string {
    if (type?.type === "preset" && type.element !== undefined) {
      const name = this.presetTypes.get(type.element)?.name;
      if (name !== undefined) return name;
    }
    return type === undefined ? "a value of any type" : editorTypeName(this.context.libraries, type);
  }

  write(): AuthoredBlueprintTrigger {
    const { input, context } = this;
    // A disabled trigger has no Galaxy, so its calls may leave parameters unset.
    if (input.disabled) this.disabled++;
    // Locals first, so the statements can name them; a local keeps its Id by its name.
    const variables: GuiVariable[] = [];
    for (const [index, variable] of (input.variables ?? []).entries()) {
      const where = `local ${index + 1} ("${variable.name}")`;
      if (this.locals.some((local) => local.name === variable.name)) this.refuse(where, "another local has this name");
      const type = this.variableType(variable, where);
      // Its type by the Editor's name of it, where that writes it the same.
      this.offerPlainer(variable, type, [type === undefined ? undefined : { ...variable, type: this.typeName(type) }], (form: AuthoringVariable) => this.variableType(form, where));
      const id = context.previous?.variables.find((old) => old.name === variable.name)?.id ?? this.ids.next();
      this.locals.push({ id, name: variable.name, type: type ?? { type: "int" } });
      variables.push({ id, name: variable.name, ...(variable.identifier !== undefined ? { identifier: variable.identifier } : {}), type: type ?? { type: "int" } });
    }
    for (const [index, variable] of (input.variables ?? []).entries()) {
      if (variable.value === undefined) continue;
      const where = `local ${index + 1} ("${variable.name}")`;
      const built = this.value(variable.value, { type: variables[index]!.type.type, ...(variables[index]!.type.element ? { element: variables[index]!.type.element } : {}), ...(variables[index]!.type.gameType ? { gameType: variables[index]!.type.gameType } : {}) }, where);
      if (built) variables[index] = { ...variables[index]!, value: this.held(built) };
    }
    const events = (input.events ?? []).map((call, index) => this.statement(call, "event", `event ${index + 1}`));
    const conditions = (input.conditions ?? []).map((statement, index) => this.statement(statement, "condition", `condition ${index + 1}`));
    const actions = (input.actions ?? []).map((statement, index) => this.statement(statement, "action", `action ${index + 1}`));
    if (this.problems.length > 0) throw new AuthoringError(input.name, this.problems);

    let trigger: BlueprintTrigger = {
      kind: "trigger",
      id: this.id,
      name: input.name,
      ...(input.identifier !== undefined ? { identifier: input.identifier } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.section !== undefined ? { section: input.section } : {}),
      ...(input.disabled ? { disabled: true } : {}),
      ...(input.initiallyOff ? { initiallyOff: true } : {}),
      variables,
      events: events.filter((statement): statement is GuiStatement => statement !== undefined),
      conditions: conditions.filter((statement): statement is GuiStatement => statement !== undefined),
      actions: actions.filter((statement): statement is GuiStatement => statement !== undefined),
    };
    const previous = context.previous;
    // The words a call kept compares by: its enUS ones, the locale the input writes.
    const oldWords = new Map(Object.entries(previous?.strings?.[GAME_STRINGS] ?? {}));
    if (previous) trigger = keepIds(trigger, previous, this.words, oldWords);
    // Its text values' and text expressions' words, from what it holds now: each locale's the old trigger had for what it keeps, the input's in enUS.
    const held = new Set(blueprintTriggerIds(trigger));
    const strings: Record<string, Record<string, string>> = {};
    for (const [file, entries] of Object.entries(previous?.strings ?? {})) {
      for (const [key, words] of Object.entries(entries)) if (held.has(key.slice(key.lastIndexOf("/") + 1))) (strings[file] ??= {})[key] = words;
    }
    for (const key of textKeys(trigger)) (strings[GAME_STRINGS] ??= {})[key] = this.words.get(key) ?? oldWords.get(key) ?? "";
    if (Object.keys(strings).length > 0) trigger = { ...trigger, strings };
    const before = new Set(previous ? callIds(previous) : []);
    const calls = callIds(trigger);
    return { trigger, calls: calls.length, keptCalls: calls.filter((id) => before.has(id)).length };
  }

  /** A local's type, from the Editor's name of a type (Unit Group), its own (unitgroup), a preset type's name, or a type spec. */
  private variableType(variable: AuthoringVariable, where: string): TypeSpec | undefined {
    const array = variable.array ? { array: variable.array.map((size) => ({ size })) } : {};
    const constant = variable.constant ? { constant: true } : {};
    if (typeof variable.type !== "string") return { ...variable.type, ...array, ...constant } as TypeSpec;
    const wanted = folded(variable.type);
    const types = gameTriggerTypeNames();
    const plain = Object.entries(types).find(([type, name]) => folded(type) === wanted || folded(name) === wanted);
    if (plain) return { type: plain[0], ...array, ...constant };
    const presets = this.presetTypesNamed(variable.type);
    if (presets.length === 1) return { type: "preset", element: presets[0]!, ...array, ...constant };
    if (presets.length > 1) this.refuse(where, `the type "${variable.type}" is ambiguous: it is the preset types ${presets.join(", ")}; give { "type": "preset", "element": "<library>/<id>" }`);
    else this.refuse(where, `no type is named "${variable.type}": give the Editor's name of a type (Unit Group, Real) or a preset type's (Time Type)`);
    return undefined;
  }

  /** A held value (a local's initial value, an index): the value with an Id of its own. */
  private held(built: Built): HeldValue {
    const id = this.ids.next();
    return this.withWords(id, built.gui);
  }

  /** `gui` with its holder's Id, its words (a text's, a text expression's) kept by that Id's key in GameStrings. */
  private withWords<T extends GuiValue>(id: string, gui: T): { readonly id: string } & T {
    const { words, expressionWords, ...rest } = gui as T & Worded;
    if (words !== undefined) this.words.set(`Param/Value/${id}`, words);
    if (expressionWords !== undefined) this.words.set(`Param/Expression/${id}`, expressionWords);
    return { id, ...(rest as T) };
  }

  /** A statement in a list of `kind` (an event, a condition, an action) or a block slot holding it. */
  private statement(input: AuthoringStatement, kind: "event" | "condition" | "action", where: string, sub?: string): GuiStatement | undefined {
    const subPart = sub ? { sub } : {};
    if ("comment" in input) {
      return { id: this.ids.next(), comment: input.comment, ...subPart, ...(input.disabled ? { disabled: true } : {}) };
    }
    if ("customScript" in input) {
      if (kind !== "action") return this.refuse(where, `custom script is an action (Custom Script), not ${kind === "event" ? "an event" : "a condition"}`), undefined;
      return { id: this.ids.next(), function: CUSTOM_SCRIPT, ...subPart, ...(input.disabled ? { disabled: true } : {}), script: input.customScript };
    }
    // A disabled statement's calls, at any depth, may leave a parameter unset.
    if (input.disabled) this.disabled++;
    const made = this.call(input, kind, where);
    if (input.disabled) this.disabled--;
    return made ? { ...made.call, ...subPart } : undefined;
  }

  /**
   * The function `name` (in `library`) stands for in reach, or undefined (refused). Where several
   * have the name, the one whose kind fits where it stands (`kind`) is it: Built-In's two Nots are a
   * condition and a function giving a value.
   */
  private callable(input: AuthoringCall, kind: CallKind, where: string): Callable | undefined {
    const { libraries, map } = this.context;
    const name = input.function.trim();
    const library = input.library;
    const mapOnly = library !== undefined && ["map", "themap"].includes(folded(library));
    const fromLibraries = mapOnly ? { status: "none" as const } : resolveFunction(libraries, name, { library });
    const libraryCandidates: FunctionEntry[] = fromLibraries.status === "found" ? [fromLibraries.fn] : fromLibraries.status === "ambiguous" ? [...fromLibraries.candidates] : [];
    const mapCandidates = library === undefined || mapOnly ? map.functions.filter((fn) => fn.id === name.toUpperCase() || folded(fn.name) === folded(name) || (fn.identifier !== undefined && fn.identifier.toLowerCase() === name.toLowerCase())) : [];
    const candidates = [
      ...libraryCandidates.map((fn) => ({ label: `${fn.name} (${fn.libraryName ?? fn.library}${fn.category ? `, ${fn.category}` : ""}; ${fn.id})`, library: fn.library, fits: fitsKind(kind, fn.kind, fn.returns !== undefined), make: () => this.libraryCallable(fn) })),
      ...mapCandidates.map((fn) => ({ label: `${fn.name} (the map's function; ${fn.id})`, library: "map", fits: fitsKind(kind, fn.kind, fn.returns !== undefined), make: () => mapCallable(fn) })),
    ];
    if (candidates.length === 0) {
      this.refuse(where, `no function in reach is named "${name}"${library !== undefined ? ` in ${library}` : ""}: ${NO_FUNCTION_FITS}`);
      return undefined;
    }
    const fitting = candidates.filter((candidate) => candidate.fits);
    const chosen = candidates.length === 1 ? candidates : fitting.length > 0 ? fitting : candidates;
    if (chosen.length > 1) {
      const held = new Set(chosen.map((candidate) => candidate.library));
      const ask = held.size === chosen.length ? `give its library ("library": ${quoteList([...held])})` : "give it as <library>/<id>";
      this.refuse(where, `"${name}" is ambiguous: it is ${chosen.map((candidate) => candidate.label).join(", ")}; ${ask}`);
      return undefined;
    }
    return chosen[0]!.make();
  }

  /** A library function in reach, as a call needs it. */
  private libraryCallable(entry: FunctionEntry): Callable {
    const { libraries } = this.context;
    const lib = libraries[entry.library]!;
    const fn = lib.functions[entry.id.slice(entry.library.length + 1)]!;
    return {
      ref: entry.id,
      name: entry.name,
      where: entry.libraryName ?? entry.library,
      kind: entry.kind,
      params: fn.params.map((param) => {
        const def = lib.params[param];
        return {
          ref: `${entry.library}/${param}`,
          name: def?.name ?? def?.identifier ?? param,
          type: { type: def?.type ?? "", ...(def?.element ? { element: def.element } : {}), ...(def?.gameType ? { gameType: def.gameType } : {}) },
          default: def?.default,
          // Repeated by its template: #PARAM(<identifier>,<separator>), a list of values joined (Combine Text Multiple's Text).
          repeats: templateRepeats(fn.script, def?.identifier),
        };
      }),
      returns: fn.returns,
      slots: (fn.subFunctions ?? []).map((ref) => {
        const [slotLibrary, slotId] = ref.split("/") as [string, string];
        const slot = libraries[slotLibrary]?.slots?.[slotId];
        return { ref, name: slot?.name ?? libraries[slotLibrary]?.subFunctions[slotId] ?? slotId, holds: slot?.holds };
      }),
    };
  }

  /** A call of `kind` (or a value's, `function`), its parameters filled in, each checked against its type, and its blocks' statements. */
  private call(input: AuthoringCall, kind: CallKind, where: string): { readonly call: GuiCall; readonly fn: Callable } | undefined {
    const fn = this.callable(input, kind, where);
    if (!fn) return undefined;
    const at = `${where} (${fn.name})`;
    if (!fitsKind(kind, fn.kind, fn.returns !== undefined)) {
      this.refuse(at, kind === "value" ? `${fn.name} is ${withArticle(fn.kind)}, which gives no value` : `${fn.name} is ${withArticle(fn.kind === "function" ? "function giving a value" : fn.kind)}, not ${withArticle(kind)}`);
      return undefined;
    }
    const given = new Map(Object.entries(input.params ?? {}).map(([name, value]) => [folded(name), { name, value }]));
    for (const { name } of given.values()) {
      if (!fn.params.some((param) => folded(param.name) === folded(name) || folded(param.ref) === folded(name))) this.refuse(at, `${fn.name} has no parameter "${name}": ${fn.params.length ? `its parameters are ${quoteList(fn.params.map((param) => param.name))}` : "it has none"}`);
    }
    const types = new Map<string, TypeSpec | undefined>();
    const params: GuiParam[] = [];
    for (const param of fn.params) {
      const here = `${at}, ${param.name}`;
      const expected = this.expected(param, types);
      const byRef = given.get(folded(param.ref));
      if (!byRef && given.has(folded(param.name)) && fn.params.filter((each) => folded(each.name) === folded(param.name)).length > 1) {
        this.refuse(here, `${fn.name} has two parameters named "${param.name}": give each by its reference (${quoteList(fn.params.filter((each) => folded(each.name) === folded(param.name)).map((each) => each.ref))})`);
        continue;
      }
      const value = (byRef ?? given.get(folded(param.name)))?.value;
      // Left unset, as the Editor saves a call not filled in: only in a disabled statement, for which no Galaxy is written.
      if (value === null) {
        if (this.disabled === 0) this.refuse(here, "only a disabled statement's call can leave a parameter unset (null): give it a value");
        continue;
      }
      // A parameter its template repeats (Combine Text Multiple's Text) takes a list: one Param per value, in order.
      if (Array.isArray(value) && !param.repeats) {
        this.refuse(here, `${fn.name} takes one ${param.name}, not a list: its template doesn't repeat it`);
        continue;
      }
      const values: readonly (AuthoringValue | undefined)[] = Array.isArray(value) ? value : [value as AuthoringValue | undefined];
      for (const [index, each] of values.entries()) {
        const place = values.length > 1 ? `${here} ${index + 1}` : here;
        let built: Built | undefined;
        if (each !== undefined) built = this.value(each, expected, place);
        else if (param.default !== undefined) built = this.defaulted(param, expected, place);
        else this.refuse(place, `${fn.name} needs its ${param.name} (${this.typeName(expected)}): it has no default, so give it in params`);
        if (!built) continue;
        types.set(param.ref, built.type ?? expected);
        params.push(this.withWords(this.ids.next(), { def: param.ref, ...built.gui } as GuiValue & { def: string }) as GuiParam);
      }
    }
    const body: GuiStatement[] = [];
    const blocks = Object.entries(input.blocks ?? {});
    if (blocks.length > 0 && fn.slots.length === 0) this.refuse(at, `${fn.name} has no blocks to fill`);
    else {
      for (const [index, [slotName]] of blocks.entries()) {
        if (!fn.slots.some((each) => folded(each.name) === folded(slotName))) this.refuse(at, `${fn.name} has no block "${slotName}": its blocks are ${quoteList(fn.slots.map((each) => each.name))}`);
        else if (blocks.slice(0, index).some(([other]) => folded(other) === folded(slotName))) this.refuse(at, `${fn.name}'s block "${slotName}" is given twice: give its statements in one list`);
      }
      // In the order given, which an Editor save may hold otherwise than its slots' (Then before If).
      for (const [slotName, statements] of blocks) {
        const slot = fn.slots.find((each) => folded(each.name) === folded(slotName));
        if (!slot) continue;
        statements.forEach((statement, index) => {
          const made = this.statement(statement, slot.holds ?? "action", `${at}, ${slot.name} ${index + 1}`, slot.ref);
          if (made) body.push(made);
        });
      }
    }
    return { fn, call: { id: this.ids.next(), function: fn.ref, ...(input.disabled ? { disabled: true } : {}), ...(params.length ? { params } : {}), ...(body.length ? { body } : {}) } };
  }

  /** The type a parameter's value must have: its own, or (Same As) the type of the value given to the parameter it names. */
  private expected(param: Parameter, types: ReadonlyMap<string, TypeSpec | undefined>): TypeSpec {
    if (param.type.type !== "sameas" || param.type.element === undefined) return param.type;
    return types.get(param.type.element) ?? { type: "anycompare" };
  }

  /** A parameter's default, as a new call in the Editor gives it: copied with Ids of its own. */
  private defaulted(param: Parameter, expected: TypeSpec, where: string): Built | undefined {
    const value = param.default!;
    // A Same As parameter's default is a literal of one type, which the value it follows may not be (Comparison's Value 2 is Integer 1).
    const literal = "type" in value && value.type !== undefined ? { type: value.type, ...("gameType" in value && value.gameType ? { gameType: value.gameType } : {}) } : undefined;
    // Exactly: the Editor gives a new Comparison of Reals no Integer 1, though a given Integer fits a Real.
    if (param.type.type === "sameas" && literal && (!fits(expected, literal) || (expected.type === "fixed" && literal.type === "int"))) {
      this.refuse(where, `takes ${this.article(expected)}, but its default is ${this.article(literal)}: give it`);
      return undefined;
    }
    // The words of the texts it holds, which the Editor gives a new call: the library data's, or the map's GameStrings for a Kept function's.
    const slash = param.ref.indexOf("/");
    const known = slash < 0 ? this.context.map.texts && ((id: string) => this.context.map.texts!.get(`Param/Value/${id}`) ?? "") : this.context.libraries[param.ref.slice(0, slash)]?.defaultTexts && ((id: string) => this.context.libraries[param.ref.slice(0, slash)]!.defaultTexts![id]);
    const words = new Map<string, string>();
    let unknown: string | undefined;
    const copied = relabel(value, () => this.ids.next(), (old, fresh, node) => {
      if (isTextExpression(node)) unknown ??= "a text expression";
      if (node.type !== "text" || node.value !== undefined) return;
      const found = known?.(old);
      if (found === undefined) unknown ??= "a text";
      else words.set(fresh, found);
    });
    if (unknown !== undefined) {
      this.refuse(where, `its default is ${unknown} whose words aren't known here: give its words`);
      return undefined;
    }
    const { id: top, ...gui } = copied;
    // The default's own words move to the Param holding it, which withWords gives its Id; its inner values' keep theirs.
    for (const [id, text] of words) if (id !== top) this.words.set(`Param/Value/${id}`, text);
    return { gui: { ...(gui as GuiValue), ...(words.has(top) ? { words: words.get(top) } : {}) } as GuiValue, type: literal ?? param.type };
  }

  /** A value of `expected` from its Editor form, or undefined (refused), and its plainer form offered (`plainer`). */
  private value(input: AuthoringValue, expected: TypeSpec, where: string): Built | undefined {
    const built = this.valueOf(input, expected, where);
    if (typeof input === "object" && !("function" in input)) this.offerPlainer(input, built, this.plainerForms(input), (form: AuthoringValue) => this.valueOf(form, expected, where));
    return built;
  }

  /** A value of `expected` from its Editor form, or undefined (refused). Any Variable (Set Variable's Variable) takes a variable only. */
  private valueOf(input: AuthoringValue, expected: TypeSpec, where: string): Built | undefined {
    const wrong = (given: TypeSpec | undefined, what: string): undefined => {
      this.refuse(where, `takes ${this.article(expected)}, but ${what} is ${this.article(given)}`);
      return undefined;
    };
    const checked = (built: Built | undefined, what: string): Built | undefined => (built === undefined ? undefined : fits(expected, built.type) ? built : wrong(built.type, what));
    if (expected.type === "anyvariable" && !(typeof input === "object" && "variable" in input)) {
      this.refuse(where, 'takes a variable: give { "variable": "<name>" }');
      return undefined;
    }
    if (typeof input === "number") {
      const type = ANY_TYPE.has(expected.type) || expected.type === "anynumber" ? (Number.isInteger(input) ? "int" : "fixed") : expected.type;
      if (type === "int" || type === "byte") return Number.isInteger(input) ? { gui: { type, value: String(input) }, type: { type } } : wrong({ type: "fixed" }, String(input));
      if (type === "fixed") return { gui: { type, value: String(input) }, type: { type } };
      return wrong({ type: Number.isInteger(input) ? "int" : "fixed" }, String(input));
    }
    if (typeof input === "boolean") return checked({ gui: { type: "bool", value: String(input) }, type: { type: "bool" } }, String(input));
    if (typeof input === "string") return this.named(input, expected, where);
    if ("function" in input) {
      const made = this.call(input, "value", where);
      return made && checked({ gui: { call: made.call }, type: made.fn.returns }, `${made.fn.name}'s value`);
    }
    if ("bits" in input) return checked(this.bits(input, expected, where), "the set of bits");
    if ("preset" in input) return checked(this.preset(input.preset, expected, where), `"${input.preset}"`);
    if ("variable" in input) return checked(this.variable(input, where), `the variable "${input.variable}"`);
    if ("expression" in input) return this.expression(input, expected, where);
    if ("trigger" in input) {
      const id = this.trigger(input.trigger, where);
      return id === undefined ? undefined : checked({ gui: { trigger: id }, type: { type: "trigger" } }, `the trigger "${input.trigger}"`);
    }
    if ("text" in input) return checked({ gui: { type: "text", words: input.text } as GuiValue, type: { type: "text" } }, "a text");
    if ("customScript" in input) return { gui: { customScript: input.customScript, ...(input.type ? { customType: input.type } : {}) }, type: input.type ? { type: input.type } : undefined };
    const literal = {
      type: input.type,
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.valueId !== undefined ? { valueId: input.valueId } : {}),
      ...(input.typeInfo !== undefined ? { typeInfo: input.typeInfo } : {}),
      ...(input.gameType ? { gameType: input.gameType } : {}),
      ...(input.context !== undefined ? { context: input.context } : {}),
    };
    return checked({ gui: literal, type: { type: input.type, ...(input.gameType ? { gameType: input.gameType } : {}) } }, `the ${input.type} "${input.value ?? input.valueId ?? ""}"`);
  }

  /**
   * An Arithmetic or Expression value: its type (Integer, Real, String or Text), its text and each
   * slot's value by code, in the order given (the Editor's). Every code the text names has a slot,
   * and every slot is named in the text, but in a text expression, whose words may name only some.
   * A text expression's words are in GameStrings, keyed by its Param.
   */
  private expression(input: AuthoringExpression, expected: TypeSpec, where: string): Built | undefined {
    const type = EXPRESSION_TYPES[folded(input.type)];
    if (type === undefined) {
      this.refuse(where, `an expression's type is Integer, Real, String or Text, not "${input.type}"`);
      return undefined;
    }
    if (!fits(expected, { type })) {
      this.refuse(where, `takes ${this.article(expected)}, but the expression is ${this.article({ type })}`);
      return undefined;
    }
    const slots = Object.entries(input.slots ?? {});
    const named = new Set([...input.expression.matchAll(/~([^~]+)~/g)].map((match) => match[1]!));
    const missing = [...named].filter((code) => !slots.some(([slot]) => slot === code));
    if (missing.length > 0) this.refuse(where, `the expression names ${quoteList(missing.map((code) => `~${code}~`))}, which no slot gives: give each in slots`);
    const unnamed = type === "text" ? [] : slots.filter(([code]) => !named.has(code)).map(([code]) => code);
    if (unnamed.length > 0) this.refuse(where, `the expression's text names no slot ${quoteList(unnamed)}: write ~<code>~ where each stands`);
    if (type === "string" && /["\r\n]/.test(input.expression)) this.refuse(where, "a string expression's text can't hold a quote or a line break, which the Editor writes no Galaxy for");
    const built = slots.map(([code, value]) => ({ code, value: this.value(value, { type: "anycompare" }, `${where}, slot ${code}`) }));
    if (missing.length > 0 || unnamed.length > 0 || built.some((slot) => slot.value === undefined)) return undefined;
    const expression = { type, ...(type === "text" ? {} : { text: input.expression }), slots: built.map((slot) => ({ ...this.withWords(this.ids.next(), slot.value!.gui), code: slot.code })) };
    return { gui: { expression, ...(type === "text" ? { expressionWords: input.expression } : {}) } as GuiValue, type: { type } };
  }

  /** A set of bits: its values by name, of the bits preset type the parameter takes, or `preset` where it takes any. */
  private bits(input: AuthoringBits, expected: TypeSpec, where: string): Built | undefined {
    let element: string | undefined;
    if (input.preset !== undefined) {
      const named = this.presetTypes.has(input.preset) ? [input.preset] : this.presetTypesNamed(input.preset);
      if (named.length !== 1) {
        this.refuse(where, named.length > 1 ? `the preset type "${input.preset}" is ambiguous: it is ${named.join(", ")}; give it as <library>/<id>` : `no preset type in reach is named "${input.preset}"`);
        return undefined;
      }
      element = named[0];
    } else if (expected.type === "preset" && expected.element !== undefined) element = expected.element;
    if (element === undefined) {
      this.refuse(where, `takes ${this.article(expected)}: name the bits preset type the set is of ({ "bits": […], "preset": "<name>" })`);
      return undefined;
    }
    const preset = this.presetTypes.get(element);
    if (!preset?.bits) {
      this.refuse(where, `${this.typeName({ type: "preset", element })} isn't a set of bits: give one of its values ({ "preset": "<name>" })`);
      return undefined;
    }
    const values: string[] = [];
    for (const name of input.bits) {
      const found = this.valuesNamed(name, preset.values);
      if (found.length === 1) values.push(found[0]!);
      else this.refuse(where, found.length > 1 ? `"${name}" is ambiguous: it is the preset values ${found.join(", ")}; give it by its reference` : `${this.typeName({ type: "preset", element })} has no value "${name}": its values are ${quoteList(preset.values.map((value) => this.presetValueNames.get(value)?.name ?? value))}`);
    }
    if (values.length !== input.bits.length) return undefined;
    return { gui: { presetElement: element, ...(values.length ? { bits: values } : {}) }, type: { type: "preset", element } };
  }

  /** The preset types in reach named `name` (or so referenced): a library's as `<library>/<id>`, the map's by Id. */
  private presetTypesNamed(name: string): string[] {
    if (this.presetTypes.has(name)) return [name];
    const wanted = folded(name);
    return [...this.presetTypes].flatMap(([ref, preset]) => (preset.name !== undefined && folded(preset.name) === wanted ? [ref] : []));
  }

  /** The values of `pool` named `name`, by name, identifier or reference. */
  private valuesNamed(name: string, pool: readonly string[]): string[] {
    if (pool.includes(name)) return [name];
    const wanted = folded(name);
    return [...new Set(pool)].filter((ref) => {
      const value = this.presetValueNames.get(ref);
      return value !== undefined && ((value.name !== undefined && folded(value.name) === wanted) || (value.identifier !== undefined && folded(value.identifier) === wanted));
    });
  }

  /** A type as a refusal names it, with its article: a Real, an Integer. */
  private article(type: TypeSpec | undefined): string {
    return type === undefined ? this.typeName(type) : withArticle(this.typeName(type));
  }

  /** A string, read by the type it's given for: a preset value's name, a text's words, a String, a trigger's name, a game link's id. */
  private named(input: string, expected: TypeSpec, where: string): Built | undefined {
    switch (expected.type) {
      case "text":
        return { gui: { type: "text", words: input } as GuiValue, type: { type: "text" } };
      // The types whose literal is the text as given: a String, an actor message.
      case "string":
      case "actormsg":
        return { gui: { type: expected.type, value: input }, type: { type: expected.type } };
      case "trigger": {
        const id = this.trigger(input, where);
        return id === undefined ? undefined : { gui: { trigger: id }, type: { type: "trigger" } };
      }
      case "gamelink":
        if (expected.gameType !== undefined) return { gui: { type: "gamelink", value: input, gameType: expected.gameType }, type: expected };
        break;
      case "preset":
        return this.preset(input, expected, where);
    }
    if (ANY_TYPE.has(expected.type)) return { gui: { type: "string", value: input }, type: { type: "string" } };
    // A type's own presets (Any Unit for a Unit).
    const found = this.presetValues(input, expected);
    if (found.length === 1) return { gui: { preset: found[0]! }, type: expected };
    this.refuse(where, `takes ${this.article(expected)}, which "${input}" isn't the name of: give a call ({ "function": … }), a variable ({ "variable": … }) or a literal ({ "value": …, "type": "${expected.type}" })`);
    return undefined;
  }

  /** The preset values named `name` (or `<library>/<id>`) that `expected` takes: those of its preset type, or of a preset type of its base type. */
  private presetValues(name: string, expected: TypeSpec): string[] {
    const pool =
      expected.type === "preset" && expected.element !== undefined
        ? (this.presetTypes.get(expected.element)?.values ?? [])
        : [...this.presetTypes.values()].flatMap((preset) => (expected.type === "anypreset" || ANY_TYPE.has(expected.type) || preset.base === expected.type ? preset.values : []));
    const found = this.valuesNamed(name, pool);
    // A value given by its reference may be of another preset type of the same base, as an older Editor saved some (Player Property (Get)'s Minerals for (Set)'s).
    const base = expected.type === "preset" && expected.element !== undefined ? this.presetTypes.get(expected.element)?.base : undefined;
    if (found.length === 0 && base !== undefined && this.presetValueNames.has(name) && (this.presetsOf.get(name) ?? []).some((type) => this.presetTypes.get(type)?.base === base)) return [name];
    return found;
  }

  /** A preset value by name for `expected`: its type the preset type it's of, where any preset type is taken. */
  private preset(name: string, expected: TypeSpec, where: string): Built | undefined {
    const found = this.presetValues(name, expected);
    if (found.length === 1) {
      const presetType = this.presetsOf.get(found[0]!)?.[0];
      const open = expected.type === "anypreset" || ANY_TYPE.has(expected.type);
      return { gui: { preset: found[0]! }, type: open ? { type: "preset", ...(presetType ? { element: presetType } : {}) } : expected };
    }
    if (found.length > 1) {
      this.refuse(where, `"${name}" is ambiguous: it is the preset values ${found.join(", ")}; give it as <library>/<id>`);
      return undefined;
    }
    const choices = expected.type === "preset" && expected.element !== undefined ? (this.presetTypes.get(expected.element)?.values ?? []).map((value) => this.presetValueNames.get(value)?.name ?? value) : [];
    this.refuse(where, `${this.typeName(expected)} has no value "${name}"${choices.length ? `: its values are ${quoteList(choices)}` : ""}`);
    return undefined;
  }

  /** A trigger by name or Id: this one, a Blueprint or a Kept one. */
  private trigger(name: string, where: string): string | undefined {
    if (name === this.input.name || name === this.id) return this.id;
    const found = this.context.map.triggers.filter((trigger) => trigger.name === name || trigger.id === name);
    if (found.length === 1) return found[0]!.id;
    this.refuse(where, found.length > 1 ? `"${name}" is ambiguous: the triggers ${found.map((trigger) => trigger.id).join(", ")} have this name; give its Id` : `the map has no trigger named "${name}"`);
    return undefined;
  }

  /** A variable by name: the trigger's local, a Blueprint or Kept global, or a library's global as `<library>/<id>`; indexed and a structure's member. */
  private variable(input: AuthoringVariableRef, where: string): Built | undefined {
    const { libraries, map } = this.context;
    const name = input.variable;
    let ref: string | undefined;
    let type: TypeSpec | undefined;
    const local = input.library === undefined ? this.locals.find((each) => each.name === name || each.id === name) : undefined;
    const globals = input.library === undefined ? map.globals.filter((each) => each.name === name || each.id === name) : [];
    // A library's global by its name, where neither the trigger nor the map has one of it.
    const libraryGlobals = ELEMENT_REF.test(name)
      ? []
      : Object.entries(libraries).flatMap(([library, lib]) =>
          (input.library === undefined || folded(input.library) === folded(library) || (lib.name !== undefined && folded(lib.name) === folded(input.library))) ? Object.entries(lib.variables ?? {}).flatMap(([id, variable]) => (!variable.member && variable.name !== undefined && folded(variable.name) === folded(name) ? [{ ref: `${library}/${id}`, type: variable.type, where: lib.name ?? library }] : [])) : [],
        );
    if (local) [ref, type] = [local.id, local.type];
    else if (globals.length === 1) [ref, type] = [globals[0]!.id, globals[0]!.type];
    else if (globals.length === 0 && libraryGlobals.length === 1) [ref, type] = [libraryGlobals[0]!.ref, libraryGlobals[0]!.type];
    else if (globals.length === 0 && libraryGlobals.length > 1) {
      this.refuse(where, `"${name}" is ambiguous: it is the globals ${libraryGlobals.map((each) => `${each.ref} (${each.where})`).join(", ")}; give its library ("library": …) or it as <library>/<id>`);
      return undefined;
    }
    else if (globals.length > 1) {
      this.refuse(where, `"${name}" is ambiguous: the globals ${globals.map((each) => each.id).join(", ")} have this name; give its Id`);
      return undefined;
    } else if (ELEMENT_REF.test(name)) {
      const [library, id] = name.split("/") as [string, string];
      const found = libraries[library]?.variables?.[id];
      if (!found || found.member) {
        this.refuse(where, `the library ${library} has no global variable ${id} in reach`);
        return undefined;
      }
      [ref, type] = [name, found.type];
    } else {
      this.refuse(where, `no variable named "${name}" is in reach${input.library !== undefined ? ` in ${input.library}` : ""}: not a local of this trigger, nor a Blueprint or Kept global, nor a global of a library in reach`);
      return undefined;
    }
    const index = this.index(input.index, type, where);
    if (index === null) return undefined;
    let valueType = indexedType(type, input.index?.length ?? 0);
    let member: StructMember | undefined;
    if (input.member) {
      const built = this.member(input.member, valueType, where);
      if (!built) return undefined;
      [member, valueType] = [built.member, built.type];
    }
    return { gui: { variable: ref, ...(index ? { index } : {}), ...(member ? { member } : {}) }, type: valueType };
  }

  /** The values an array is indexed by, each an Integer; null when refused. */
  private index(values: readonly AuthoringValue[] | undefined, type: TypeSpec | undefined, where: string): HeldValue[] | undefined | null {
    if (!values) return undefined;
    if (type?.array !== undefined && values.length > type.array.length) {
      this.refuse(where, `it is indexed ${values.length} times, but has ${type.array.length} dimension${type.array.length === 1 ? "" : "s"}`);
      return null;
    }
    const out: HeldValue[] = [];
    for (const value of values) {
      const built = this.value(value, { type: "int" }, `${where}, index`);
      if (!built) return null;
      out.push(this.held(built));
    }
    return out;
  }

  /** A structure's member (memberOf), and its name offered as plainer where it is given by reference. */
  private member(input: AuthoringMember, holder: TypeSpec | undefined, where: string): { readonly member: StructMember; readonly type: TypeSpec | undefined } | undefined {
    const built = this.memberOf(input, holder, where);
    const [library, id] = input.variable.split("/") as [string, string | undefined];
    const name = id !== undefined ? this.context.libraries[library]?.variables?.[id]?.name : (this.context.map.structures ?? []).flatMap((structure) => structure.members).find((member) => member.id === input.variable)?.name;
    this.offerPlainer(input, built, [name === undefined ? undefined : { ...input, variable: name }], (form: AuthoringMember) => this.memberOf(form, holder, where));
    return built;
  }

  /** A member of a library's structure (the one `holder`, the value it is a member of, is), by name or as `<library>/<id>`. */
  private memberOf(input: AuthoringMember, holder: TypeSpec | undefined, where: string): { readonly member: StructMember; readonly type: TypeSpec | undefined } | undefined {
    let ref = input.variable;
    let found: Pick<LibraryVariable, "member" | "type" | "structure"> | undefined;
    // The map's own structures' members, as a library's are.
    const mapMembers = (this.context.map.structures ?? []).flatMap((structure) => structure.members.map((member) => ({ ref: member.id, variable: { member: true as const, structure: structure.id, name: member.name, ...(member.type ? { type: member.type } : {}) } })));
    if (ELEMENT_REF.test(ref)) {
      const [library, id] = ref.split("/") as [string, string];
      found = this.context.libraries[library]?.variables?.[id];
    } else if (mapMembers.some((member) => member.ref === ref)) {
      found = mapMembers.find((member) => member.ref === ref)!.variable;
    } else {
      // By name, among the members of the structure the value it is a member of holds.
      const structure = holder?.element;
      const named = [
        ...Object.entries(this.context.libraries).flatMap(([library, lib]) => Object.entries(lib.variables ?? {}).map(([id, variable]) => ({ ref: `${library}/${id}`, variable }))),
        ...mapMembers,
      ].filter(({ variable }) => variable.member && variable.name !== undefined && folded(variable.name) === folded(ref) && (structure === undefined || variable.structure === structure));
      if (named.length > 1) {
        this.refuse(where, `the member "${ref}" is ambiguous: it is ${named.map((each) => `${each.ref} (of ${each.variable.structure})`).join(", ")}; give it as <library>/<id>`);
        return undefined;
      }
      if (named.length === 1) [ref, found] = [named[0]!.ref, named[0]!.variable];
    }
    if (!found?.member) {
      this.refuse(where, `"${input.variable}" isn't a structure member in reach: name a member of a library's structure${holder?.element ? ` (${holder.element})` : ""} by its name or as <library>/<id>`);
      return undefined;
    }
    const index = this.index(input.index, found.type, where);
    if (index === null) return undefined;
    let type = indexedType(found.type, input.index?.length ?? 0);
    let inner: StructMember | undefined;
    if (input.member) {
      const built = this.member(input.member, type, where);
      if (!built) return undefined;
      [inner, type] = [built.member, built.type];
    }
    return { member: { id: this.ids.next(), variable: ref, ...(index ? { index } : {}), ...(inner ? { member: inner } : {}) }, type };
  }
}

/**
 * What was built, as text with its Ids left out: two builds alike but for their fresh Ids are the
 * same. Only an element's own Id is held under `id`; what a value names is under `variable`,
 * `preset`, `trigger`, `function` and the like, so leaving every `id` out loses nothing else.
 */
const idless = (built: unknown): string => JSON.stringify(built, (key, value: unknown) => (key === "id" ? undefined : value));

/** A variable's type once indexed `by` times: an array's element where every dimension is indexed. */
function indexedType(type: TypeSpec | undefined, by: number): TypeSpec | undefined {
  if (type === undefined || by === 0 || type.array === undefined) return type;
  if (by < type.array.length) return { ...type, array: type.array.slice(by) };
  const { array: _array, ...element } = type;
  return element;
}

/** `value` with every Id in it (its own and all it holds) a new one, each node with an Id told to `seen` with its old and new Ids. */
function relabel<T>(value: T, next: () => string, seen?: (old: string, fresh: string, node: Readonly<Record<string, unknown>>) => void): T {
  if (Array.isArray(value)) return value.map((item) => relabel(item, next, seen)) as T;
  if (value === null || typeof value !== "object") return value;
  const record = value as Readonly<Record<string, unknown>>;
  const fresh = typeof record.id === "string" ? next() : undefined;
  if (fresh !== undefined) seen?.(record.id as string, fresh, record);
  return Object.fromEntries(Object.entries(record).map(([key, inner]) => [key, key === "id" && fresh !== undefined ? fresh : relabel(inner, next, seen)])) as T;
}

/** What a node is, its Ids aside, with each text's and text expression's words by its key: two nodes alike are the same call. */
function shape(node: unknown, words: ReadonlyMap<string, string>): string {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (value === null || typeof value !== "object") return value;
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    // In key order: a file read back has its schema's order, a call just made its own.
    // A set of bits is its values, whatever preset type it names (an older Editor's names none).
    for (const key of Object.keys(record).sort()) if (key !== "id" && !(key === "presetElement" && record.bits !== undefined)) out[key] = strip(record[key]);
    // Parameters in any order: the tool writes them in their definition's, which a save may not hold (zspace01's Unit In Unit Group).
    if (Array.isArray(out.params)) out.params = (out.params as { readonly def: string }[]).slice().sort((a, b) => a.def.localeCompare(b.def));
    if (record.type === "text" && record.value === undefined && typeof record.id === "string") out.words = words.get(`Param/Value/${record.id}`) ?? "";
    if (isTextExpression(record) && typeof record.id === "string") out.expressionWords = words.get(`Param/Expression/${record.id}`) ?? "";
    return out;
  };
  return JSON.stringify(strip(node));
}

/**
 * `fresh` with the Ids of `previous` kept: a statement alike one of the old in the same list is that
 * one, Ids and all; one changed in place (the same function where an old one was) keeps its call's Id
 * and its unchanged parameters', its blocks matched the same way.
 */
function keepIds(fresh: BlueprintTrigger, previous: BlueprintTrigger, words: ReadonlyMap<string, string>, oldWords: ReadonlyMap<string, string>): BlueprintTrigger {
  const call = (made: GuiCall, old: GuiCall): GuiCall => ({
    ...made,
    id: old.id,
    ...(made.params
      ? {
          params: made.params.map((param, at) => {
            // The same occurrence of its parameter: a repeated one (Combine Text Multiple's Text) is matched value by value.
            const occurrence = made.params!.slice(0, at).filter((each) => each.def === param.def).length;
            const before = old.params?.filter((each) => each.def === param.def)[occurrence];
            if (!before) return param;
            if (shape(before, oldWords) === shape(param, words)) return before;
            if ("call" in param && param.call && "call" in before && before.call && param.call.function === before.call.function) return { ...param, id: before.id, call: call(param.call, before.call) } as GuiParam;
            return param;
          }),
        }
      : {}),
    ...(made.body ? { body: list(made.body, old.body ?? []) } : {}),
  });
  const list = (made: readonly GuiStatement[], old: readonly GuiStatement[]): GuiStatement[] => {
    const used = new Set<number>();
    const alike = made.map((statement) => shape(statement, words));
    const out: (GuiStatement | undefined)[] = made.map((_, index) => {
      const at = old.findIndex((before, oldIndex) => !used.has(oldIndex) && shape(before, oldWords) === alike[index]);
      if (at < 0) return undefined;
      used.add(at);
      return old[at];
    });
    return made.map((statement, index) => {
      if (out[index]) return out[index]!;
      const before = old[index];
      if (before && !used.has(index) && !isComment(statement) && !isComment(before) && statement.function === before.function && statement.sub === before.sub) {
        used.add(index);
        return call(statement, before);
      }
      return statement;
    });
  };
  const variables = fresh.variables.map((variable) => {
    const before = previous.variables.find((each) => each.name === variable.name);
    if (!before) return variable;
    if (shape(before, oldWords) === shape(variable, words)) return before;
    return before.value && variable.value && shape(before.value, oldWords) === shape(variable.value, words) ? { ...variable, value: before.value } : variable;
  });
  return { ...fresh, variables, events: list(fresh.events, previous.events), conditions: list(fresh.conditions, previous.conditions), actions: list(fresh.actions, previous.actions) };
}

/** The Ids of the nodes a trigger holds, at any depth, that `holds` picks. */
function idsWhere(trigger: BlueprintTrigger, holds: (node: Readonly<Record<string, unknown>>) => boolean): string[] {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node !== null && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (typeof record.id === "string" && holds(record)) out.push(record.id);
      Object.values(record).forEach(visit);
    }
  };
  visit([trigger.variables, trigger.events, trigger.conditions, trigger.actions]);
  return out;
}

/** The Ids of every call a trigger holds. */
const callIds = (trigger: BlueprintTrigger): string[] => idsWhere(trigger, (node) => typeof node.function === "string");

/** Whether a node is a text expression, whose words are in GameStrings. */
const isTextExpression = (node: Readonly<Record<string, unknown>>): boolean => (node.expression as { readonly type?: string } | undefined)?.type === "text";

/** The GameStrings keys of the Params and values holding a text (Param/Value/<id>) or a text expression (Param/Expression/<id>). */
const textKeys = (trigger: BlueprintTrigger): string[] => [
  ...idsWhere(trigger, (node) => node.type === "text" && node.value === undefined).map((id) => `Param/Value/${id}`),
  ...idsWhere(trigger, isTextExpression).map((id) => `Param/Expression/${id}`),
];
