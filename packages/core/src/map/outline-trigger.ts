// One outline for a Mission's trigger, whichever owns it (#1034): a Kept trigger in its Map Package
// or one of its Blueprint's own (ADR-0026). Either is read into a Blueprint element (a Kept one as
// convert_triggers reads it), then outlined into the authoring tool's input in the Editor's terms
// (triggers/authoring-outline.ts), against what it may name in the Mission as write_blueprint_trigger
// reads it. So a trigger outlines the same before and after it is converted, and a Blueprint
// trigger's outline, given to write_blueprint_trigger, writes its file back as it is.

import type { BlueprintTrigger } from "../domain/blueprint-trigger.js";
import { mapElements, stringTable, UnconvertibleFunctionError } from "../mods/library-xml.js";
import type { Workspace } from "../plugins/workspace.js";
import type { AuthoringTrigger } from "../triggers/author-trigger.js";
import { outlineForAuthoring } from "../triggers/authoring-outline.js";
import { readKeptTrigger, recordConversionContext } from "./convert-mission-triggers.js";
import { missionMapReach, missionTriggerReach } from "./write-blueprint-trigger.js";

/** A Mission's trigger outlined: what it is and who owns it, and its outline. */
export type TriggerOutline = {
  readonly name: string;
  readonly id: string;
  /** Kept in the Map Package, or the Blueprint's own. */
  readonly owner: "Kept" | "Blueprint";
  /** A Blueprint trigger's file, relative to the Blueprint. */
  readonly file?: string;
  /** The trigger as write_blueprint_trigger's input, in the Editor's terms. */
  readonly trigger: AuthoringTrigger;
  /** Each place holding what the input can't express, in the Editor's terms: none where the outline writes it back as it is. */
  readonly unwritable: readonly string[];
  /** The outline as text: the input as JSON, then what it can't express. The same whichever owns the trigger. */
  readonly text: string;
};

/** The outline's text: `trigger` as JSON, then each place the input can't express. */
export const outlineText = (trigger: AuthoringTrigger, unwritable: readonly string[]): string =>
  [JSON.stringify(trigger, null, 2), ...(unwritable.length > 0 ? ["Not written back as it is, for what the input can't express:", ...unwritable.map((place) => `- ${place}`)] : [])].join("\n");

/**
 * The outline of the Mission's trigger `wanted` (by name or element Id): the Blueprint's own, else
 * a Kept one in its Map Package. Refused where none has it, two Kept ones share the name, or a Kept
 * one can't be read into a Blueprint element (naming why).
 */
export async function outlineTrigger(workspace: Workspace, blueprintPath: string, wanted: string): Promise<TriggerOutline> {
  const reach = await missionTriggerReach(workspace, blueprintPath);
  const { authored, files, gameStrings, kept, libraries, record } = reach;
  // A Kept trigger against the reach it will have once converted: not among the Kept triggers, the Blueprint's all there.
  const outline = (trigger: BlueprintTrigger, owner: TriggerOutline["owner"], others: typeof authored.triggers, file?: string): TriggerOutline => {
    const { trigger: input, unwritable } = outlineForAuthoring(trigger, { libraries, map: missionMapReach(reach, others, trigger.id) });
    return { name: trigger.name, id: trigger.id, owner, ...(file !== undefined ? { file } : {}), trigger: input, unwritable, text: outlineText(input, unwritable) };
  };

  const own = authored.triggers.find(({ trigger }) => trigger.id === wanted || trigger.name === wanted);
  if (own) return outline(own.trigger, "Blueprint", authored.triggers.filter((entry) => entry !== own), own.file);

  const strings = stringTable(files.triggerStrings);
  const named = kept.filter((item) => item.type === "Trigger" && (item.id === wanted || strings.get(`Trigger/Name/${item.id}`) === wanted));
  if (named.length === 0) throw new Error(`The Mission has no trigger "${wanted}": not one of its Blueprint's, nor a Kept one in its Map Package`);
  if (named.length > 1) throw new Error(`"${wanted}" is the name of the Kept triggers ${named.map((item) => item.id).join(", ")}: give one by its element Id`);
  const item = named[0]!;
  // Read as convert_triggers reads it, so it outlines as it will once converted.
  const { held } = recordConversionContext(record?.entries ?? []);
  let trigger: BlueprintTrigger;
  try {
    trigger = readKeptTrigger(mapElements(files.triggers), strings, gameStrings, item.id, held ?? new Set()).trigger;
  } catch (error) {
    if (!(error instanceof UnconvertibleFunctionError)) throw error;
    throw new Error(`The Kept trigger "${strings.get(`Trigger/Name/${item.id}`) ?? item.id}" (${item.id}) can't be read in the Editor's terms: ${error.reason}`, { cause: error });
  }
  return outline(trigger, "Kept", authored.triggers);
}

/** Where a trigger outlined lives, for its heading: Kept in the package, or its Blueprint file. */
export const outlineHeading = ({ name, id, owner, file }: TriggerOutline): string =>
  owner === "Kept" ? `${name} (Kept trigger ${id}: convert it with convert_triggers before rewriting it with write_blueprint_trigger)` : `${name} (Blueprint trigger ${id}, ${file}; write_blueprint_trigger rewrites it)`;
