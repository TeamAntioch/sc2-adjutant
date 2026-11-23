// The UI Components a Mod Blueprint turns on (ADR-0019), compiled: each one's look resolved from
// its defaults and the Blueprint's overrides, its layout if it has one, and its library functions
// as the mod's library holds them.
//
// A generated function is a GUI function of the mod's library, filed in its "UI" category, its
// body one Custom Script action holding the component's Galaxy: an action, or a function of kind
// `function` with its return type when it returns a value. Its id and every id it owns are
// derived from the component's and function's names (`ui/<component>/<function>`), so they're the
// same compile after compile, as the ids Missions call the library by must be.

import type { GuiBody, LibraryCategory, LibraryCustomScript, LibraryFunction, LibraryInterface, TypeSpec } from "../domain/library-interface.js";
import { stableElementId } from "../triggers/trigger-builders.js";
import type { FunctionDef } from "../triggers/trigger-catalog.js";
import { galaxyIdentifier, type ParamValue } from "../triggers/trigger-model.js";
import { formatIssues } from "../util/format-issues.js";
import { writeLayout } from "./layout-writer.js";
import { type UiActionContext, type UiComponent, type UiFunction, type UiLibraryContext } from "./ui-component.js";

/** The Mod Blueprint's `ui`: each component it turns on, by id, with the look fields it overrides. */
export type UiField = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** A component that is on, with its look. */
export type UiComponentOn = { readonly component: UiComponent; readonly look: unknown };

/** Custom Script, the action a generated function's body is. */
const CUSTOM_SCRIPT = "Ntve/00000123";
/** The Editor's "User Interface" label, the UI folder's icon. */
const UI_LABEL = "Ntve/00000026";

/** Where a component's layout goes in the mod package, if it has one. */
export const componentLayoutFile = (component: UiComponent): string => `Base.SC2Data/UI/Layout/${component.name}.SC2Layout`;

/**
 * The components `ui` turns on, in its order, each with its look: its defaults with the Blueprint's
 * overrides. Throws for a component `registry` doesn't have or a look field it refuses.
 */
export function uiComponentsOn(ui: UiField | undefined, registry: readonly UiComponent[]): UiComponentOn[] {
  return Object.entries(ui ?? {}).map(([id, overrides]) => {
    const component = registry.find((candidate) => candidate.id === id);
    if (!component) throw new Error(`ui.${id} isn't a UI Component: the components are ${registry.map((each) => each.id).join(", ") || "none yet"}`);
    const look = component.look.safeParse(overrides);
    if (!look.success) throw new Error(`ui.${id}'s look isn't valid: ${formatIssues(look.error, "(look)")}`);
    return { component, look: look.data };
  });
}

/** The layout file of each component with a layout, written from its look: a component with none writes none. */
export const componentLayouts = (on: readonly UiComponentOn[]): { readonly file: string; readonly content: string; readonly by: string }[] =>
  on.flatMap(({ component, look }) => (component.layout ? [{ file: componentLayoutFile(component), content: writeLayout(component.layout(look)), by: `ui.${component.id}` }] : []));

/** A generated function's Galaxy identifier: from its name, since a component gives it no other. */
const generatedIdentifier = (name: string): string => galaxyIdentifier(name);

/** The Galaxy name of a component's function `name` in the library `library`: lib<library>_gf_<identifier>. */
export const componentGalaxyName = (library: string, name: string): string => `lib${library}_gf_${generatedIdentifier(name)}`;

/** The Galaxy name of a global or helper of `component`'s script in the library `library`: lib<library>_ui_<component>_<name>. */
export const componentScriptName = (library: string, component: UiComponent, name: string): string => `lib${library}_ui_${component.id}_${name}`;

/** What `component`'s functions and script know of the library `library`, beside the other components `on`. */
export const componentContext = (library: string, component: UiComponent, on: readonly UiComponentOn[]): UiLibraryContext => ({
  galaxyName: (name) => componentGalaxyName(library, name),
  scriptName: (name) => componentScriptName(library, component, name),
  other: (id) => {
    const other = id === component.id ? undefined : on.find((each) => each.component.id === id)?.component;
    return other ? componentContext(library, other, on) : undefined;
  },
});

/** The library functions the components add, with their GUI bodies, their scripts, and the "UI" category that files them. */
export type ComponentLibrary = {
  readonly functions: readonly LibraryFunction[];
  readonly bodies: ReadonlyMap<string, GuiBody>;
  /** Each component's script, as a Custom Script named for the component (its name), whose Galaxy the compile writes too. */
  readonly customScripts: readonly LibraryCustomScript[];
  readonly category?: LibraryCategory;
};

/** The components' functions as the library `library` holds them. */
export function componentLibrary(library: string, on: readonly UiComponentOn[]): ComponentLibrary {
  const functions: LibraryFunction[] = [];
  const bodies = new Map<string, GuiBody>();
  const customScripts: LibraryCustomScript[] = [];
  /** Which component gave each Galaxy identifier: the library has one function of each. */
  const given = new Map<string, string>();
  for (const { component, look } of on) {
    const context = componentContext(library, component, on);
    const { galaxyName } = context;
    const script = component.script?.(look, context);
    if (script !== undefined) customScripts.push({ id: stableElementId(`ui/${component.id}/script`), name: component.name, script });
    const made = component.functions(look, context);
    for (const [action, definition] of Object.entries(component.actions)) {
      if (made.find((fn) => fn.name === definition.function)?.returns !== undefined)
        throw new Error(`The UI Component ${component.id}'s action ${action} calls ${definition.function}, which returns a value: a Blueprint trigger action can't take a value into a variable yet, so call it from the mod's own triggers`);
    }
    for (const fn of made) {
      if (fn.returns !== undefined && fn.createThread) throw new Error(`The UI Component ${component.id}'s function ${fn.name} returns a value and runs in its own thread, which hands nothing back to its caller: drop createThread, or its return type`);
      const identifier = generatedIdentifier(fn.name).toLowerCase();
      const other = given.get(identifier);
      if (other === component.id) throw new Error(`The UI Component ${component.id} has two functions whose Galaxy name is ${galaxyName(fn.name)}: a library has one function of each name, so give each of its functions a name of its own`);
      if (other !== undefined) throw new Error(`The UI Components ${other} and ${component.id} each have a function whose Galaxy name is ${galaxyName(fn.name)}: a library has one function of each name, so name the component in its function's (Show Boss Bar, not Show)`);
      given.set(identifier, component.id);
      const path = `ui/${component.id}/${fn.name}`;
      const generated = libraryFunction(path, fn);
      functions.push(generated);
      bodies.set(generated.id, { variables: [], actions: [{ id: stableElementId(`${path}/body`), function: CUSTOM_SCRIPT, script: fn.galaxy }] });
    }
  }
  if (functions.length === 0 && customScripts.length === 0) return { functions, bodies, customScripts };
  const items = [...customScripts.map((script) => `custom-script:${script.id}`), ...functions.map((fn) => `function:${fn.id}`)];
  return { functions, bodies, customScripts, category: { id: stableElementId("ui/category"), name: "UI", label: UI_LABEL, items } };
}

function libraryFunction(path: string, fn: UiFunction): LibraryFunction {
  return {
    id: stableElementId(path),
    name: fn.name,
    kind: fn.returns !== undefined ? "function" : "action",
    flags: fn.createThread ? ["createThread"] : [],
    ...(fn.returns !== undefined ? { returns: fn.returns } : {}),
    ...(fn.grammar !== undefined ? { grammar: fn.grammar } : {}),
    ...(fn.hint !== undefined ? { hint: fn.hint } : {}),
    parameters: (fn.parameters ?? []).map((parameter) => ({
      id: stableElementId(`${path}/parameters/${parameter.name}`),
      name: parameter.name,
      ...(parameter.identifier !== undefined ? { identifier: parameter.identifier } : {}),
      type: parameter.type,
    })),
    subFunctions: [],
  };
}

/**
 * `library` with the components' functions added, and their "UI" category. Refuses a component's
 * function whose Galaxy name one of the library's own functions has, and a component's script
 * named as one of the library's own Custom Scripts; an element id one of the
 * library's own items shares with a generated one is refused where the compile writes them
 * (library.ts).
 */
export function withComponents(library: LibraryInterface, generated: ComponentLibrary): LibraryInterface {
  if (generated.functions.length === 0 && generated.customScripts.length === 0) return library;
  const own = new Map(library.functions.map((fn) => [(fn.identifier ?? galaxyIdentifier(fn.name)).toLowerCase(), fn]));
  for (const fn of generated.functions) {
    const clash = own.get(generatedIdentifier(fn.name).toLowerCase());
    if (clash) throw new Error(`The library's function ${clash.name} has the Galaxy name a UI Component's function ${fn.name} is given (lib${library.id}_gf_${generatedIdentifier(fn.name)}): rename the library's, or turn the component off`);
  }
  // A Custom Script's Galaxy is a block under its name, so two of one name would be one block.
  const ownScripts = new Set(library.customScripts.map((script) => script.name ?? script.id));
  for (const script of generated.customScripts) {
    const name = script.name ?? script.id;
    if (ownScripts.has(name)) throw new Error(`The library's Custom Script ${name} has the name a UI Component's script is given, and the compile writes each script's Galaxy under its name: rename the library's, or turn the component off`);
  }
  return {
    ...library,
    functions: [...library.functions, ...generated.functions],
    customScripts: [...library.customScripts, ...generated.customScripts],
    categories: [...library.categories, ...(generated.category ? [generated.category] : [])],
  };
}

/** A mod's UI as its compile makes it: the components on, their functions, and its library with them. */
export type ModUi = {
  readonly components: readonly UiComponentOn[];
  /** The components' functions, when the mod has a library for them to go in. */
  readonly generated?: ComponentLibrary;
  /** The mod's library with the components' functions added. */
  readonly library?: LibraryInterface;
};

/**
 * The UI a Mod Blueprint's `ui` and `library` make, refusing what its compile refuses: a component
 * `registry` doesn't have or a look it refuses, a component on in a mod with no library, two
 * functions of one Galaxy name, a generated function with a Galaxy name of the library's own, and
 * a component's script with the name of one of the library's own Custom Scripts.
 * compile-mod, `check` and a Mission's calls all go through it, so they refuse alike.
 */
export function modUi(blueprint: { readonly ui?: UiField | undefined; readonly library?: LibraryInterface | undefined }, registry: readonly UiComponent[]): ModUi {
  const components = uiComponentsOn(blueprint.ui, registry);
  if (!blueprint.library) {
    if (components.length > 0) throw new Error(`ui turns on ${components.map(({ component }) => component.id).join(", ")}, whose functions go in the mod's library: declare the library in the Blueprint (convert-library writes it)`);
    return { components };
  }
  const generated = componentLibrary(blueprint.library.id, components);
  return { components, generated, library: withComponents(blueprint.library, generated) };
}

/** A Mission's call of a component's action: the function it calls and its arguments, from the action's params. */
export type UiActionCall = { readonly component: string; readonly function: string; readonly args: Readonly<Record<string, ParamValue>> };

/**
 * The call `action` makes with `params`, from the components in `registry`. Throws for an action no
 * component has, or params it refuses, saying which.
 */
export function uiActionCall(action: string, params: unknown, registry: readonly UiComponent[], mission: UiActionContext): UiActionCall {
  const having = registry.filter((candidate) => Object.hasOwn(candidate.actions, action));
  if (having.length > 1) throw new Error(`${action} is an action of each of the UI Components ${having.map((each) => each.id).join(" and ")}: an action belongs to one component`);
  const component = having[0];
  if (!component) {
    const known = registry.flatMap((each) => Object.keys(each.actions));
    throw new Error(`${action} isn't an action of a UI Component: the actions are ${known.join(", ") || "none yet"}`);
  }
  const definition = component.actions[action]!;
  const parsed = definition.params.safeParse(params);
  if (!parsed.success) throw new Error(`${action}'s params aren't valid: ${formatIssues(parsed.error, "(params)")}`);
  return { component: component.id, function: generatedIdentifier(definition.function), args: definition.args(parsed.data, mission) };
}

/** The Campaign Mod whose components a Mission's actions call: its `ui`, and how a message names it and its Blueprint. */
export type UiCampaignMod = { readonly ui: UiField | undefined; readonly label: string; readonly shown: string };

/** As uiActionCall, and throws for an action of a component `mod` hasn't turned on. */
export function campaignUiCall(action: string, params: unknown, registry: readonly UiComponent[], mod: UiCampaignMod, mission: UiActionContext): UiActionCall {
  const made = uiActionCall(action, params, registry, mission);
  if (!Object.hasOwn(mod.ui ?? {}, made.component)) throw new Error(`${action} is an action of the UI Component ${made.component}, which ${mod.label} hasn't turned on: add ui.${made.component} to its Mod Blueprint (${mod.shown})`);
  const needs = (registry.find((each) => each.id === made.component)?.actions[action]?.needs ?? []).filter((id) => !Object.hasOwn(mod.ui ?? {}, id));
  if (needs.length > 0) throw new Error(`${action} calls the UI Component ${needs.join(" and ")}'s functions too, which ${mod.label} hasn't turned on: add ${needs.map((id) => `ui.${id}`).join(" and ")} to its Mod Blueprint (${mod.shown})`);
  return made;
}

/** Whether `value` can be given to a parameter of `type`: a value's kind is the Editor's type name; a variable's or a call's isn't known here. */
const takes = (type: TypeSpec, value: ParamValue): boolean => {
  if (value.kind === "variable" || value.kind === "call") return true;
  if (value.kind !== type.type) return false;
  return value.kind !== "gamelink" || type.gameType === undefined || type.gameType === value.gameType;
};

/**
 * The arguments of `call` keyed as `def` keys its parameters, checking each is one, of the kind its
 * parameter's type (`types`, by the same keys) takes.
 */
export function uiCallArgs(def: FunctionDef, call: UiActionCall, types: Readonly<Record<string, TypeSpec>>): Readonly<Record<string, ParamValue>> {
  const unknown = Object.keys(call.args).filter((key) => !(key in def.params));
  const missing = Object.keys(def.params).filter((key) => !(key in call.args));
  const kinds = Object.entries(call.args).flatMap(([key, value]) => {
    const type = types[key];
    if (!type || takes(type, value)) return [];
    const wanted = type.gameType ? `${type.type} (${type.gameType})` : type.type;
    return [`gives ${key} a value of kind ${value.kind === "gamelink" ? `gamelink (${value.gameType})` : value.kind}, where its parameter's type is ${wanted}`];
  });
  const wrong = [...(unknown.length ? [`gives ${unknown.join(", ")}, which it has no parameter for`] : []), ...(missing.length ? [`leaves out ${missing.join(", ")}`] : []), ...kinds];
  if (wrong.length) throw new Error(`The UI Component ${call.component}'s call of ${call.function} ${wrong.join(", and ")}: its action's args are keyed by the function's parameters, each of its parameter's type`);
  return call.args;
}
