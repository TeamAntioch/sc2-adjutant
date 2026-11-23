// Sound sets, a purpose-level shape (ADR-0011, domain/sound-set.ts): a Campaign Mod's CSound for
// each line of a conversation one of its Screenplays compiles, as a generic entry in SoundData,
// playing the voice file the line's Asset Source gives it in one of the Asset Mods the mod depends
// on. In the template form the voice file's game path is fitted to the parent's template, so the
// Editor's form comes out:
//
//   Base.SC2Assets/Assets/Sounds/Conversations/H-01-002.ogg, template Assets\Sounds\^TemplateParam1^.ogg
//   → Template="Conversations\##id##;<facial anim>"
//
// and in the AssetArray form it's the AssetArray's File, Assets\Sounds\Conversations\H-01-002.ogg.
// Each CSound owns its name, Sound/Name/<id> in ObjectStrings, as an entry owns its strings
// (docs/reference/mod-strings.md): its id, as the Editor names a sound it creates.

import type { ModBlueprint } from "../domain/mod-blueprint.js";
import type { FieldValue } from "../domain/catalog-fields.js";
import { OBJECT_STRINGS, type Strings } from "../domain/entry-strings.js";
import { type SoundForm, soundForm, TEMPLATE_PARAM } from "../domain/sound-set.js";
import type { Workspace } from "../plugins/workspace.js";
import { conversationLines, type ModScript } from "./conversations.js";
import type { GenericEntry } from "./generic-entries.js";
import { readModBlueprint, readWorkspaceMod, type WorkspaceMod } from "./workspace-mods.js";

/** A CSound's name's key. */
export const soundNameKey = (sound: string): string => `Sound/Name/${sound}`;

/** A line CSound's own strings: its name, its id, as the Editor names a sound it creates. */
const soundNameStrings = (sound: string): Strings => ({ [OBJECT_STRINGS]: { [soundNameKey(sound)]: sound } });

/** An Asset Mod's declared files, by the Sound ID their name gives (a voice file is named for the Sound it plays). */
export type AssetMod = { readonly mod: WorkspaceMod; readonly bySound: ReadonlyMap<string, string> };

/**
 * The CSounds of the Blueprint's sound sets, as generic entries, from the Asset Sources of the
 * Asset Mods it depends on. `name` is the mod's package name; `scripts` are its Screenplays, named.
 */
export async function soundSetEntries(blueprint: ModBlueprint, name: string, scripts: readonly ModScript[], workspace: () => Promise<Workspace>): Promise<GenericEntry[]> {
  if (blueprint.soundSets.length === 0) return [];
  const assetMods = await dependedAssetMods(blueprint, await workspace(), scripts);
  const out: GenericEntry[] = [];
  for (const [index, set] of blueprint.soundSets.entries()) {
    const where = `soundSets.${index}`;
    const script = scripts.find((found) => found.script.conversationId === set.conversation);
    if (!script) throw new Error(`${where} voices ${set.conversation}, which none of the Blueprint's Screenplays compiles: declare its Screenplay first`);
    for (const { line, sound } of conversationLines(script, set.groups)) {
      const owner = assetMods.find((asset) => asset.bySound.has(sound.toLowerCase()));
      if (!owner) {
        const names = assetMods.map((asset) => asset.mod.name).join(", ") || "none";
        throw new Error(`${where}: ${line.lineId}'s Sound ${sound} has no Asset Source in the Asset Mods ${name} depends on (${names}): declare its voice file in an Asset Mod's voices or assets`);
      }
      const voice = gamePath(owner.bySound.get(sound.toLowerCase())!);
      const form = soundForm(set, line.lineId);
      const anim = set.facialAnims[line.lineId] ?? set.facialAnim;
      const tokens = { Subtitle: set.conversation, Speaker: line.characterId, Line: line.soundLine };
      if (form.template !== undefined) {
        const file = templateParam(form, voice, sound);
        if (file === undefined) throw new Error(`${where}: ${line.lineId}'s voice file ${voice} (in ${owner.mod.name}) doesn't fit the parent's template ${form.template}`);
        out.push({ catalog: "Sound", class: "CSound", id: sound, parent: form.parent, attributes: editorOrder({ ...form.attributes, ...tokens, Template: `${file};${anim ?? "##id##"}` }), fields: form.fields, strings: soundNameStrings(sound) });
        continue;
      }
      const assetArray: Record<string, FieldValue> = {
        index: "0",
        File: { value: voice },
        FacialAnim: { value: anim ?? "" },
        FacialGroup: { value: "" },
        PortraitModel: { value: "" },
        Speaker: { value: `ConversationState/Characters/${line.characterId}` },
        Subtitle: { value: `Conversation/${set.conversation}/${line.lineId}` },
      };
      out.push({ catalog: "Sound", class: "CSound", id: sound, parent: form.parent, attributes: editorOrder({ ...form.attributes, ...tokens }), fields: { AssetArray: assetArray, ...form.fields }, strings: soundNameStrings(sound) });
    }
  }
  return out;
}

/** The Sound of each line the Blueprint's sound sets voice, each the id of a CSound they write; `scripts` are its Screenplays, named. */
export function soundSetSounds(blueprint: ModBlueprint, scripts: readonly ModScript[]): string[] {
  return blueprint.soundSets.flatMap((set) => {
    const script = scripts.find((found) => found.script.conversationId === set.conversation);
    return script ? conversationLines(script, set.groups).map(({ sound }) => sound) : [];
  });
}

/** The Asset Mods of the Workspace that the Blueprint's dependencies name (`file:Mods\<Name>.SC2Mod`), each with its files by Sound. */
export async function dependedAssetMods(blueprint: ModBlueprint, workspace: Workspace, scripts: readonly ModScript[]): Promise<AssetMod[]> {
  const named = new Set(blueprint.dependencies.flatMap((dependency) => dependency.split(",").filter((part) => part.startsWith("file:")).map((part) => part.slice(5).split(/[\\/]/).pop()!.replace(/\.sc2mod$/i, "").toLowerCase())));
  const out: AssetMod[] = [];
  for (const id of workspace.mods) {
    // A mod that can't be read is skipped, as campaignMod skips it; the Workspace check reports it.
    let mod: WorkspaceMod;
    try {
      mod = await readWorkspaceMod(workspace, id);
    } catch {
      continue;
    }
    if (mod.kind !== "asset" || !named.has(mod.name.toLowerCase())) continue;
    const asset = await readModBlueprint(mod.blueprintPath);
    const bySound = new Map<string, string>();
    // An asset is a line's voice file only when it's a sound file named for the line's Sound.
    for (const file of asset.assets) if (SOUND_FILE.test(file.path)) bySound.set(stem(file.path).toLowerCase(), file.path);
    for (const voices of asset.voices) {
      const script = scripts.find((found) => found.script.conversationId === voices.conversation);
      if (!script) continue;
      for (const { sound } of conversationLines(script, voices.groups)) bySound.set(sound.toLowerCase(), `${voices.folder}/${sound}.${voices.format}`);
    }
    out.push({ mod, bySound });
  }
  return out;
}

/** The order the Editor writes a dialogue CSound's attributes in, any others after them, so a converted SoundData comes out as the Editor's. */
const EDITOR_ORDER = ["Portrait", "Subtitle", "Template", "Speaker", "Actor", "Line"];
function editorOrder(attributes: Record<string, string>): Record<string, string> {
  const rank = (name: string) => (EDITOR_ORDER.includes(name) ? EDITOR_ORDER.indexOf(name) : EDITOR_ORDER.length);
  return Object.fromEntries(Object.entries(attributes).sort(([a], [b]) => rank(a) - rank(b)));
}

const SOUND_FILE = /\.(ogg|wav)$/i;
const stem = (file: string): string => file.slice(file.lastIndexOf("/") + 1).replace(/\.[^.]*$/, "");

/** A package file's path as the game reads it, from the mod's data root: Base.SC2Assets/Assets/x.ogg is Assets\x.ogg. */
function gamePath(file: string): string {
  return file.replace(/^Base\.SC2(Assets|Data)\//i, "").replace(/\//g, "\\");
}

/** The first template parameter that makes the parent's template give `file`, the Sound's own id as ##id##; undefined when it doesn't fit. */
export function templateParam(form: SoundForm, file: string, sound: string): string | undefined {
  const [before, after] = form.template!.split(TEMPLATE_PARAM) as [string, string];
  const lower = file.toLowerCase();
  if (!lower.startsWith(before.toLowerCase()) || !lower.endsWith(after.toLowerCase()) || file.length <= before.length + after.length) return undefined;
  const param = file.slice(before.length, file.length - after.length);
  const name = param.slice(param.lastIndexOf("\\") + 1);
  return name.toLowerCase() === sound.toLowerCase() ? `${param.slice(0, param.length - name.length)}##id##` : param;
}
