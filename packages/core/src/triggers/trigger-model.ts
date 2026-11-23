import type { FunctionDef, PresetDef, SubFunctionDef } from "./trigger-catalog.js";

/** Editor element IDs are 8 uppercase hex digits, unique within a map's Triggers file. */
export type ElementId = string;

export type TriggerVariableType = "unit" | "unitgroup" | "objective" | "timer" | "int" | "bool" | "fixed" | "timerwindow" | "dialog" | "cutscene" | "actor" | "sound" | "transmission" | "point";

export type TriggerVariable = {
  readonly id: ElementId;
  readonly name: string;
  readonly type: TriggerVariableType;
  /** A preset (e.g. No Unit) or a call such as New Timer. */
  readonly initial: { readonly id: ElementId; readonly value: ParamValue };
};

/** A trigger referenced as a value (e.g. by Run Trigger). */
export type TriggerRef = {
  readonly id: ElementId;
  readonly name: string;
  /** Its Galaxy name when it isn't the one its name gives: a Kept trigger's own Identifier. */
  readonly scriptName?: string;
};

export type ParamValue =
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "fixed"; readonly value: number }
  | { readonly kind: "preset"; readonly preset: PresetDef }
  /** Localized text; an empty string is written as StringToText(""). */
  | { readonly kind: "text"; readonly text: string }
  /** A game data id. A Sound's is a soundlink where the native takes one; as a game link it's a string, which can be empty (Show Toast's "the default"). */
  | { readonly kind: "gamelink"; readonly gameType: "Unit" | "Light" | "Effect" | "Model" | "Behavior" | "Upgrade" | "Sound"; readonly value: string }
  /** A file in the game's assets: an image by default, such as a tip's icon ("Assets\\Textures\\btn-....dds"), or a cutscene ("Cutscenes\\<name>.SC2Cutscene"). */
  | { readonly kind: "filepath"; readonly value: string; readonly asset?: "image" | "cutscene" }
  /** A sound by CSound id; the Editor stores only the id and Galaxy uses asset index -1 (any). */
  | { readonly kind: "soundlink"; readonly sound: string }
  /** A placed ObjectPoint, by its Objects Id. */
  | { readonly kind: "point"; readonly objectId: number }
  /** A placed ObjectUnit, by its Objects Id (form taken from an Editor-saved map). */
  | { readonly kind: "unit"; readonly objectId: number }
  /** A placed ObjectCamera (a camera Anchor), by its Objects Id, as Apply Camera Object takes it (form taken from an Editor-saved map). */
  | { readonly kind: "camerainfo"; readonly objectId: number }
  /** A colour as the Editor writes it, "<alpha>,<red>,<green>,<blue>" 0-255 ("255,0,0,0" is black, as an Editor-saved map's Cinematic Fades give it). */
  | { readonly kind: "color"; readonly value: string }
  | { readonly kind: "bool"; readonly value: boolean }
  /** A plain string. The empty one is written without a Value; any other with its Value, as the Editor saves a named string (an Editor-saved map's `Unit/Name/Scout`). */
  | { readonly kind: "string"; readonly value: string }
  /** A water state, "<CWater id>|<state name>" ("[Default]" for the first). */
  | { readonly kind: "water"; readonly value: string }
  /** A conversation line, "<conversation>|<line id>". */
  | { readonly kind: "convline"; readonly value: string }
  /** An actor message such as "Signal WarpBeaconOn", as the Editor writes Send Actor Message To Unit's (a Campaign Mod's own Triggers). */
  | { readonly kind: "actormsg"; readonly value: string }
  /** An animation name such as "Talk". */
  | { readonly kind: "modelanim"; readonly value: string }
  /** Target filter flags (c_targetFilter names, e.g. "Missile"): all of `require`, none of `exclude`. */
  | { readonly kind: "unitfilter"; readonly require: readonly string[]; readonly exclude: readonly string[] }
  /**
   * A placed region, by its Regions id: a Compiled region's place in missionRegions' order (the
   * compile renumbers it past a Kept region holding that number), or with `kept` a Kept region's own id.
   */
  /** A Compiled region by its place, a Kept one (`kept`) by its id; a Beat's bounds region also by its place among those (`bounds`, beat-bounds.ts). */
  | { readonly kind: "region"; readonly regionId: number; readonly kept?: true; readonly bounds?: number }
  /** Command 0 of an ability; the Editor records the target type (0 none, as a Stop, 1 unit, 2 point) instead of the index. */
  | { readonly kind: "abilcmd"; readonly ability: string; readonly target: "none" | "unit" | "point" }
  | { readonly kind: "variable"; readonly variable: TriggerVariable }
  | { readonly kind: "trigger"; readonly trigger: TriggerRef }
  | { readonly kind: "call"; readonly call: TriggerCall };

export type TriggerParam = {
  readonly id: ElementId;
  readonly value: ParamValue;
};

export type TriggerCall = {
  readonly id: ElementId;
  readonly def: FunctionDef;
  /** Keyed by the parameter names in `def.params`; every parameter must be supplied. */
  readonly params: Readonly<Record<string, TriggerParam>>;
  /** The calls inside a block action (If Then Else, Pick Each), by sub-function: its "if" conditions, "then" actions... */
  readonly blocks?: readonly TriggerBlock[];
};

export type TriggerBlock = {
  readonly type: SubFunctionDef;
  readonly calls: readonly TriggerCall[];
};

/** Calls nested in a call: those in its parameters, then those in its blocks. */
export function nestedCalls(call: TriggerCall): TriggerCall[] {
  return [
    ...Object.values(call.params).flatMap((param) => (param.value.kind === "call" ? [param.value.call] : [])),
    ...(call.blocks ?? []).flatMap((block) => block.calls),
  ];
}

export type Trigger = {
  readonly id: ElementId;
  readonly name: string;
  readonly events: readonly TriggerCall[];
  /** All must hold for the actions to run. */
  readonly conditions?: readonly TriggerCall[];
  readonly actions: readonly TriggerCall[];
  /** Off until an action turns it on (the Editor's "Initially On" unticked). */
  readonly initiallyOff?: boolean;
};

/** Events, conditions and actions in the order the Editor writes them. */
export function triggerCalls(trigger: Trigger): TriggerCall[] {
  return [...trigger.events, ...(trigger.conditions ?? []), ...trigger.actions];
}

/**
 * A Trigger Folder: an Editor trigger Category, filing variables, triggers and subfolders in the
 * order the Editor lists them.
 */
export type TriggerFolder = {
  readonly id: ElementId;
  readonly name: string;
  /** Its icon: a Label of the Native library, by Id ("0677E49B" is Campaign). */
  readonly label?: string;
  readonly items: readonly TriggerFiling[];
};

/** An item filed in Root or in a folder: a variable or a trigger by element ID, or a folder. */
export type TriggerFiling =
  | { readonly type: "Variable"; readonly id: ElementId }
  | { readonly type: "Trigger"; readonly id: ElementId }
  | { readonly type: "Category"; readonly folder: TriggerFolder };

export type TriggerDocument = {
  readonly variables: readonly TriggerVariable[];
  readonly triggers: readonly Trigger[];
  /**
   * The Triggers Root: where each variable and trigger is filed, in Root or in a folder, in order.
   * Defaults to all variables, then all triggers, in Root.
   */
  readonly root?: readonly TriggerFiling[];
};

/** A filed item and what it holds: a variable, a trigger, or a folder and its items. */
export type TriggerNode =
  | { readonly type: "Variable"; readonly variable: TriggerVariable }
  | { readonly type: "Trigger"; readonly trigger: Trigger }
  | { readonly type: "Category"; readonly folder: TriggerFolder; readonly items: readonly TriggerNode[] };

/** The document's Root as a tree, each variable, trigger and folder filed once. */
export function triggerTree(doc: TriggerDocument): TriggerNode[] {
  const variables = new Map(doc.variables.map((variable) => [variable.id, variable]));
  const triggers = new Map(doc.triggers.map((trigger) => [trigger.id, trigger]));
  const root = doc.root ?? [...doc.variables.map((variable) => ({ type: "Variable" as const, id: variable.id })), ...doc.triggers.map((trigger) => ({ type: "Trigger" as const, id: trigger.id }))];
  const seen = new Set<ElementId>();
  const once = (id: ElementId, type: string): void => {
    if (seen.has(id)) throw new Error(`TriggerDocument files ${type} ${id} twice`);
    seen.add(id);
  };
  const node = (filing: TriggerFiling): TriggerNode => {
    switch (filing.type) {
      case "Variable": {
        const variable = variables.get(filing.id);
        if (!variable) throw new Error(`TriggerDocument files Variable ${filing.id}, which it doesn't have`);
        once(filing.id, filing.type);
        return { type: "Variable", variable };
      }
      case "Trigger": {
        const trigger = triggers.get(filing.id);
        if (!trigger) throw new Error(`TriggerDocument files Trigger ${filing.id}, which it doesn't have`);
        once(filing.id, filing.type);
        return { type: "Trigger", trigger };
      }
      case "Category":
        if (variables.has(filing.folder.id) || triggers.has(filing.folder.id)) throw new Error(`TriggerDocument's folder ${filing.folder.id} (${filing.folder.name}) has the element ID of one of its variables or triggers`);
        once(filing.folder.id, filing.type);
        return { type: "Category", folder: filing.folder, items: filing.folder.items.map(node) };
    }
  };
  const tree = root.map(node);
  const unfiled = [...variables.keys(), ...triggers.keys()].filter((id) => !seen.has(id));
  if (unfiled.length > 0) throw new Error(`TriggerDocument files ${unfiled.join(", ")} nowhere: each variable and trigger goes in Root or a folder`);
  return tree;
}

/** The document's folders, variables and triggers in the tree's depth-first order, the order the Editor writes MapScript in. */
export function treeOrder(doc: TriggerDocument): { readonly folders: readonly TriggerFolder[]; readonly variables: readonly TriggerVariable[]; readonly triggers: readonly Trigger[] } {
  const folders: TriggerFolder[] = [];
  const variables: TriggerVariable[] = [];
  const triggers: Trigger[] = [];
  const visit = (node: TriggerNode): void => {
    if (node.type === "Variable") variables.push(node.variable);
    else if (node.type === "Trigger") triggers.push(node.trigger);
    else {
      folders.push(node.folder);
      node.items.forEach(visit);
    }
  };
  triggerTree(doc).forEach(visit);
  return { folders, variables, triggers };
}

/** Galaxy identifier the Editor derives from a display name: "Melee Initialization" -> "MeleeInitialization". */
export function galaxyIdentifier(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "");
}

/** The Galaxy name the Editor gives a trigger it saves: gt_ and its Identifier, else its name's. */
export function editorTriggerName(name: string, identifier?: string): string {
  return `gt_${identifier ?? galaxyIdentifier(name)}`;
}

/**
 * The Galaxy name the Editor gives a global it saves: gv_ and its Identifier, else its name's,
 * started lower case ("Mission Objectives" is gv_missionObjectives). The compile names its own
 * globals this way too, so an Editor save doesn't rename them.
 */
export function editorGlobalName(name: string, identifier?: string): string {
  if (identifier !== undefined) return `gv_${identifier}`;
  const id = galaxyIdentifier(name);
  return `gv_${id.charAt(0).toLowerCase()}${id.slice(1)}`;
}
