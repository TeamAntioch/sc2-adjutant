// Filing a Mission's generated triggers and variables in Trigger Folders (#816): the folders the
// compile writes, each with its Label, and where each variable goes, from the triggers that use it.

import { folderId } from "./trigger-builders.js";
import { nestedCalls, type ElementId, type Trigger, type TriggerCall, type TriggerDocument, type TriggerFiling, type TriggerVariable, triggerCalls } from "./trigger-model.js";

/** Each kind of folder's icon: a Label of the Native library, by Id (#816's Icons table). */
export const FOLDER_LABELS = {
  mission: "0677E49B", // Campaign
  beat: "C5092BE2", // Story
  objectives: "00000035", // Objective
  encounters: "00000013", // Unit Group
  waves: "DB711C00", // AI Advanced
  screenplay: "A544E154", // Transmission
  cutscene: "ACD748EC", // Cutscene: a scene with a Trigger Scene or Cinematic
  conversation: "00000034", // Conversation: a scene with lines only
  cues: "00000017", // Event
  mechanics: "00000009", // Game
  enemyAi: "00000027", // AI
  variables: "CE915C5A", // Variable
} as const;

/**
 * A Trigger Folder the compile may write, before it's filled: `path` is its place from Root
 * ("Beat:calm/Waves/raid"), which gives its id (folderId); a subfolder's path is its parent's, then
 * "/<key>".
 */
export type FolderPlan = {
  readonly path: string;
  readonly name: string;
  readonly label: string;
  readonly subfolders?: readonly FolderPlan[];
};

/** The Variables subfolder's path in the folder at `path`. */
const variablesPath = (path: string): string => `${path}/Variables`;

/** Adds `item` to the list `map` holds at `key`. */
const push = <Key, Item>(map: Map<Key, Item[]>, key: Key, item: Item): void => {
  const list = map.get(key);
  if (list) list.push(item);
  else map.set(key, [item]);
};

/** The variables `trigger`'s calls read or set, by element id. */
function variablesUsed(trigger: Trigger): Set<ElementId> {
  const used = new Set<ElementId>();
  const visit = (call: TriggerCall): void => {
    for (const param of Object.values(call.params)) if (param.value.kind === "variable") used.add(param.value.variable.id);
    nestedCalls(call).forEach(visit);
  };
  triggerCalls(trigger).forEach(visit);
  return used;
}

/**
 * `doc` filed in the folders `plan` lists: each trigger in the folder `placeOf` gives it; each
 * variable in the Variables subfolder of the one folder whose triggers use it, or of `shared` when
 * more than one folder's do, or none. In each folder its Variables come first, then its triggers in
 * `doc`'s order, then its subfolders in `plan`'s order; a folder with nothing in it isn't written.
 */
export function fileDocument(doc: Pick<TriggerDocument, "variables" | "triggers">, plan: readonly FolderPlan[], placeOf: (trigger: Trigger) => string, shared: string): TriggerDocument {
  const known = new Set<string>();
  const index = (list: readonly FolderPlan[]): void =>
    list.forEach((folder) => {
      known.add(folder.path);
      index(folder.subfolders ?? []);
    });
  index(plan);
  if (!known.has(shared)) throw new Error(`The shared variables' folder ${shared} isn't one of the compile's folders`);
  const triggersAt = new Map<string, Trigger[]>();
  const users = new Map<ElementId, Set<string>>();
  for (const trigger of doc.triggers) {
    const place = placeOf(trigger);
    if (!known.has(place)) throw new Error(`Trigger "${trigger.name}" is filed in ${place}, which isn't one of the compile's folders`);
    push(triggersAt, place, trigger);
    for (const id of variablesUsed(trigger)) users.set(id, (users.get(id) ?? new Set()).add(place));
  }
  const variablesAt = new Map<string, TriggerVariable[]>();
  for (const variable of doc.variables) {
    const places = [...(users.get(variable.id) ?? [])];
    push(variablesAt, places.length === 1 ? places[0]! : shared, variable);
  }
  const filed = (folder: FolderPlan): TriggerFiling[] => {
    const variables = variablesAt.get(folder.path) ?? [];
    return [
      ...(variables.length > 0
        ? [
            {
              type: "Category" as const,
              folder: { id: folderId(variablesPath(folder.path)), name: "Variables", label: FOLDER_LABELS.variables, items: variables.map((variable) => ({ type: "Variable" as const, id: variable.id })) },
            },
          ]
        : []),
      ...(triggersAt.get(folder.path) ?? []).map((trigger) => ({ type: "Trigger" as const, id: trigger.id })),
      ...folders(folder.subfolders ?? []),
    ];
  };
  const folders = (list: readonly FolderPlan[]): TriggerFiling[] =>
    list.flatMap((folder) => {
      const items = filed(folder);
      return items.length > 0 ? [{ type: "Category" as const, folder: { id: folderId(folder.path), name: folder.name, label: folder.label, items } }] : [];
    });
  return { variables: doc.variables, triggers: doc.triggers, root: folders(plan) };
}
