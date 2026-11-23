// UI Components (ADR-0019): purpose-level pieces of campaign presentation core compiles into a
// Campaign Mod when its Mod Blueprint turns one on in its `ui` field (`ui.bossBar`, `ui.toast`).
// Each component gives:
//
//   - its look: named fields (textures, font styles, colours, anchor), each with a default built
//     from Blizzard's stock assets, which the Blueprint's `ui.<id>` entry overrides;
//   - its layout, if it shows frames of its own, built from its look, written as
//     Base.SC2Data/UI/Layout/<name>.SC2Layout and loaded by the generated DescIndex ahead of the
//     Blueprint's own layouts; a component with none (one that drives the camera and the game's
//     own UI) writes no layout file and adds nothing to the DescIndex;
//   - its library functions, each a name, parameters, a return type if it gives a value, and a
//     Galaxy body, which the compile adds to the mod's library (components.ts) as GUI functions in
//     its "UI" folder: an action, or a function of kind `function` when it returns a value;
//   - its script, if it has state: Galaxy at the library's top level (its globals and the helpers
//     its functions call), which the compile adds as a Custom Script in that folder, so it comes
//     before the functions in the library's Galaxy;
//   - its Blueprint trigger actions, which a Mission's `uiActions` name and which compile into calls
//     to those functions.
//
// The look helpers below are the vocabulary components share, so a colour or an anchor is written
// the same way in every Blueprint.

import { z } from "zod";

import type { TypeSpec } from "../domain/library-interface.js";
import type { ParamValue } from "../triggers/trigger-model.js";
import type { LayoutElement } from "./layout-writer.js";

/** A parameter of a component's library function: its name, as the Editor shows it, and its type. */
export type UiFunctionParameter = {
  readonly name: string;
  readonly type: TypeSpec;
  /** Its Galaxy name, lp_ and this started lower case; from its name when left out. */
  readonly identifier?: string;
};

/**
 * A library function a component adds to the mod's library: an action, or, with a return type, a
 * function of kind `function`, which a trigger uses as a value. Its body may Wait, as any GUI
 * function that isn't a condition may, holding up the trigger that calls it.
 */
export type UiFunction = {
  /** Its name, as the Editor's function list shows it: its id is derived from it and the component's. */
  readonly name: string;
  readonly grammar?: string;
  readonly hint?: string;
  readonly parameters?: readonly UiFunctionParameter[];
  /** The type of the value it returns, which its body's Galaxy returns on every path; none for an action. */
  readonly returns?: TypeSpec;
  /** Runs in its own thread (FlagCreateThread), as a refresh loop does; a function returning a value can't, since a thread hands nothing back. */
  readonly createThread?: boolean;
  /**
   * Its body, Galaxy written into the function as Custom Script. A parameter is lp_ and its
   * identifier started lower case (Title is lp_title); the library's own functions are
   * lib<library>_gf_<identifier>, so a body calls another of its component's through `galaxyName`.
   */
  readonly galaxy: string;
};

/** What an action's arguments may need of the Mission that calls it. */
export type UiActionContext = {
  /** A unit Anchor's or Kept unit's unit, by its id, as the argument of the param `param`; throws, naming the param, for an id that is neither. */
  readonly unit: (anchorId: string, param: string) => ParamValue;
};

/** A Blueprint trigger action: the function it calls, its params as a Mission gives them, and the call's arguments from them. */
export type UiActionDefinition<Params = never> = {
  /** The name of the component's function it calls. */
  readonly function: string;
  /** The other components the function calls, by id, which the Campaign Mod must turn on too; it has the function only then. */
  readonly needs?: readonly string[];
  readonly params: z.ZodType<Params>;
  /** The call's arguments, by parameter key: the parameter's identifier started lower case (Title is title). */
  readonly args: (params: Params, mission: UiActionContext) => Readonly<Record<string, ParamValue>>;
};

/** What a component's functions and script may need to know of the library they go in. */
export type UiLibraryContext = {
  /** The Galaxy name of one of the component's own functions, by its name: lib<library>_gf_<identifier>. */
  readonly galaxyName: (functionName: string) => string;
  /**
   * The Galaxy name of a global or helper of the component's script: lib<library>_ui_<component>_<name>,
   * which no name the Editor gives (gv_, gf_, gt_ …) can be.
   */
  readonly scriptName: (name: string) => string;
  /**
   * What another component's functions and script know of the library, by its id, when the Mod
   * Blueprint turns it on too, and undefined when it doesn't: so a component can defer to another
   * (the toast's queue waits while a hero moment plays) only where both are on, and is written as
   * it is alone otherwise. A script may call the other's functions, which the library's header
   * declares, but not name its script's globals, whose Custom Script may come after its own.
   */
  readonly other: (id: string) => UiLibraryContext | undefined;
};

export type UiComponent<Look = unknown> = {
  /** Its key in the Mod Blueprint's `ui`, such as bossBar. */
  readonly id: string;
  /**
   * Its name in the package, PascalCase: its layout's file name, without .SC2Layout, the name its
   * templates go by (<name>/<template>), and its script's Custom Script name.
   */
  readonly name: string;
  /** Its look fields, each with its default: parsing {} gives the default look. */
  readonly look: z.ZodType<Look, unknown>;
  /** Its layout, from its look; none for a component with no frames of its own, which writes no layout file. */
  readonly layout?: (look: Look) => readonly LayoutElement[];
  readonly functions: (look: Look, library: UiLibraryContext) => readonly UiFunction[];
  /**
   * Its script, when it keeps state: Galaxy at the library's top level, before its functions. Its
   * globals take no initial value but a constant (the game starts each at its zero), and every name
   * it defines is a scriptName.
   */
  readonly script?: (look: Look, library: UiLibraryContext) => string;
  /** Its Blueprint trigger actions, by name (showBossBar). */
  readonly actions: Readonly<Record<string, UiActionDefinition<never>>>;
};

/** A component, with its look's and actions' types checked where it is written. */
export const defineUiComponent = <Look, Params extends Record<string, unknown>>(component: {
  readonly id: string;
  readonly name: string;
  readonly look: z.ZodType<Look, unknown>;
  readonly layout?: (look: Look) => readonly LayoutElement[];
  readonly functions: (look: Look, library: UiLibraryContext) => readonly UiFunction[];
  readonly script?: (look: Look, library: UiLibraryContext) => string;
  readonly actions: { readonly [K in keyof Params]: UiActionDefinition<Params[K]> };
}): UiComponent => component as unknown as UiComponent;

// ---------------------------------------------------------------------------------------------
// Look fields

/** A colour, red, green and blue, 0-255 each. */
export const LookColor = z.tuple([z.number().int().min(0).max(255), z.number().int().min(0).max(255), z.number().int().min(0).max(255)]);
export type LookColor = z.infer<typeof LookColor>;
/** A colour as a layout's Color writes it: "r,g,b". */
export const colorValue = (color: LookColor): string => color.join(",");

/** An image file in the game's assets, by its path (Assets\Textures\….dds), as a script sets an image: a toast's or a choice card's icon, which takes no asset key. */
export const IMAGE_FILE = /^[A-Za-z0-9_][A-Za-z0-9_\-. \\/]*\.(dds|tga|png|jpg)$/i;

/** A texture: an asset key (@UI/HealthBar) or a file path in the game's assets (Assets\Textures\….dds). */
export const LookTexture = z.string().min(1);
/** A font style, by its name in a FontStyles file (@BossBarTitle). */
export const LookStyle = z.string().min(1);

export const ANCHOR_POINTS = ["topLeft", "top", "topRight", "left", "centre", "right", "bottomLeft", "bottom", "bottomRight"] as const;
/**
 * Where a frame sits in its parent: one of nine points (top, topRight, centre …) and its offset
 * from it in pixels, x positive to the right and y positive down, as SC2's offsets go.
 */
export const LookAnchor = z.object({ at: z.enum(ANCHOR_POINTS), x: z.number().int().default(0), y: z.number().int().default(0) }).strict();
export type LookAnchor = z.infer<typeof LookAnchor>;

/**
 * A frame's Anchors for `anchor`, relative to its parent: each edge it sits against at that edge
 * (pos Min or Max), and on an axis it's centred on, both edges at the parent's middle (pos Mid),
 * which centres a frame of a set size.
 */
export function anchorElements(anchor: LookAnchor): LayoutElement[] {
  const vertical = anchor.at.startsWith("top") ? "Min" : anchor.at.startsWith("bottom") ? "Max" : "Mid";
  const horizontal = /left$/i.test(anchor.at) ? "Min" : /right$/i.test(anchor.at) ? "Max" : "Mid";
  const side = (name: string, pos: string, offset: number): LayoutElement => ({ tag: "Anchor", attributes: { side: name, relative: "$parent", pos, offset: String(offset) } });
  const axis = (pos: string, low: string, high: string, offset: number): LayoutElement[] =>
    pos === "Min" ? [side(low, pos, offset)] : pos === "Max" ? [side(high, pos, offset)] : [side(low, pos, offset), side(high, pos, offset)];
  return [...axis(vertical, "Top", "Bottom", anchor.y), ...axis(horizontal, "Left", "Right", anchor.x)];
}

// ---------------------------------------------------------------------------------------------
// Galaxy helpers

/**
 * A script's helper `name`, true while any player is in cinematic mode as NativeLib's Cinematic
 * Mode records it: the flag the toast's queue and a hero moment wait on.
 */
export const inCinematicHelper = (name: string): string[] => [
  "// True while any player is in cinematic mode, as NativeLib's Cinematic Mode records it.",
  `bool ${name} () {`,
  "    playergroup lv_players;",
  "    int lv_player;",
  "",
  "    lv_players = PlayerGroupActive();",
  "    lv_player = -1;",
  "    while (true) {",
  "        lv_player = PlayerGroupNextPlayer(lv_players, lv_player);",
  "        if (lv_player < 0) {",
  "            return false;",
  "        }",
  "        if (libNtve_gf_PlayerInCinematicMode(lv_player)) {",
  "            return true;",
  "        }",
  "    }",
  "    return false;",
  "}",
];
