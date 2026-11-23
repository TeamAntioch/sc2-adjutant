// Names a parsed Screenplay's conversation, lines, sounds and speakers for the compiled map, with
// the Campaign Pack's naming template and the characters of the Workspace's Campaign Mod (its
// Campaign Characters, src/mods/characters.ts). A speaker's character gives its CCharacter id,
// what its off-map Transmissions show and its placeholder voice; once the Campaign has a Campaign
// Mod, every speaker needs one. Core's default naming, for any hook the template leaves out or
// when there is no template, is the Mission id, scene and line:
//
//   conversation  lava_field
//   line          Line1-2              (scene 1, its second line)
//   sound         lava_field-1-2       (also the voice file's name)
//   CSound Line   1-2                  (the line id without "Line")
//   character     Raynor               (the speaker's name, without spaces), when it has no character

import { readFile } from "node:fs/promises";
import path from "node:path";

import { speakerKey } from "../domain/character.js";
import { isNamedId } from "../domain/named-id.js";
import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { DEFAULT_VOICE_FORMAT, type VoiceFormat } from "../host/voice-files.js";
import { type CampaignCharacters, workspaceCharacters } from "../mods/characters.js";
import {
  type LineNamingContext,
  type NamingTemplate,
  type PluginRegistry,
  runHook,
  type ScreenplayNamingContext,
} from "../plugins/plugin-api.js";
import type { Workspace } from "../plugins/workspace.js";
import { characterName, type ParsedScene, type ParsedScript, parseScript, type TextSpan } from "./parse-script.js";

/** A Screenplay line with the names it has in the map, and what its speaker's Transmissions show. */
export type ScriptLine = {
  readonly kind: "line";
  /** Screenplay speaker, e.g. "RAYNOR". */
  readonly speaker: string;
  /** The name its Transmissions show, e.g. "Raynor". */
  readonly character: string;
  /** The CCharacter that speaks it, e.g. "Raynor": its character's id, else the naming template's. */
  readonly characterId: string;
  /** The off-map Transmission's unit type or portrait model, from the speaker's character. */
  readonly unit?: string;
  readonly model?: string;
  /** The placeholder text-to-speech voice, from the speaker's character. */
  readonly voice?: string;
  readonly soundId: string;
  /** How it's delivered, e.g. "slowly"; not spoken or shown. */
  readonly delivery?: string;
  /** Conversation line id, e.g. "Line1-2". */
  readonly lineId: string;
  /** The CSound's `Line` attribute. */
  readonly soundLine: string;
  /** Text without emotion tags or emphasis marks: what is spoken. */
  readonly text: string;
  /** The text as the game shows it, emphasis in italic tags (ParsedLine's `shown`). */
  readonly shown: string;
  readonly spans: readonly TextSpan[];
};

export type ScriptScene = ParsedScene<ScriptLine>;

/** A Screenplay named for the map. */
export type Script = {
  readonly title: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly conversationId: string;
  readonly scenes: readonly ScriptScene[];
};

/** Core's naming, used for every hook the Campaign Pack's template doesn't give. */
export const DEFAULT_NAMING: Required<NamingTemplate> = {
  name: "default",
  conversationId: ({ missionId }) => missionId,
  lineId: ({ scene, line }) => `Line${scene}-${line}`,
  soundId: ({ missionId, scene, line }) => `${missionId}-${scene}-${line}`,
  soundLine: ({ lineId }) => lineId.replace(/^Line/, ""),
  characterId: (name) => name.replace(/\s+/g, ""),
};


/** How a Screenplay is named where its caller knows more than the naming template. */
export type NameScriptOptions = {
  /** The CConversation it compiles into, when its declaration names it (a Campaign Mod's Screenplay): the template's conversationId hook isn't asked. */
  readonly conversationId?: string;
};

/**
 * Names `parsed` for the map or mod it compiles into. `missionId` is the Mission Blueprint's id, or
 * a Campaign Mod's for its Screenplays, and is what the naming hooks read as `missionId`.
 */
export function nameScript(parsed: ParsedScript, missionId: string, plugins: PluginRegistry, characters: CampaignCharacters, options: NameScriptOptions = {}): Script {
  const template = plugins.naming();
  if (characters.declaredIn) {
    const undeclared = new Map<string, string>();
    for (const scene of parsed.scenes) {
      for (const item of scene.items) {
        if (item.kind === "line" && !characters.character(item.speaker) && !undeclared.has(speakerKey(item.speaker))) undeclared.set(speakerKey(item.speaker), `${item.speaker} (first in scene ${scene.number}, line ${item.position})`);
      }
    }
    if (undeclared.size > 0) throw new Error(`The Screenplay's speaker${undeclared.size === 1 ? "" : "s"} ${[...undeclared.values()].join(", ")} ${undeclared.size === 1 ? "has" : "have"} no character: declare each in ${characters.declaredIn}`);
  }
  /** Runs one naming hook, the template's or else core's, and checks the id it returns. */
  const name = <Context>(where: string, hook: Exclude<keyof NamingTemplate, "name">, context: Context): string => {
    const given = template?.[hook] as ((context: Context) => unknown) | undefined;
    const label = `${where}: the naming template ${given ? template!.name : DEFAULT_NAMING.name}`;
    const id = runHook(label, `${hook} hook`, () => (given ? given.call(template, context) : (DEFAULT_NAMING[hook] as (context: Context) => unknown)(context)));
    if (typeof id !== "string" || !isNamedId(id)) {
      throw new Error(`${label}: its ${hook} hook returned ${JSON.stringify(id)}, not an id (letters, digits, _, - and ., not ending in .)`);
    }
    return id;
  };

  const screenplay: ScreenplayNamingContext = { missionId, title: parsed.title, fields: parsed.fields };
  const conversationId = options.conversationId ?? name("The Screenplay", "conversationId", screenplay);
  const seen = new Map<string, string>();
  // Compared without case: a sound id names a voice file, and macOS and Windows file names ignore case.
  const unique = (kind: string, id: string, where: string): string => {
    const key = `${kind} ${id.toLowerCase()}`;
    const clash = seen.get(key);
    if (clash) throw new Error(`${where} and ${clash} would share the ${kind} ${id} (ids are compared without case)`);
    seen.set(key, where);
    return id;
  };

  const scenes = parsed.scenes.map((scene) => ({
    number: scene.number,
    title: scene.title,
    items: scene.items.map((item) => {
      if (item.kind !== "line") return item;
      const where = `Scene ${scene.number}, line ${item.position} (${item.speaker})`;
      const context: LineNamingContext = {
        ...screenplay,
        conversationId,
        scene: scene.number,
        line: item.position,
        speaker: item.speaker,
        ...(item.scriptId ? { scriptId: item.scriptId } : {}),
      };
      const character = characters.character(item.speaker);
      const shownName = character?.name ?? characterName(item.speaker);
      const lineId = unique("line id", name(where, "lineId", context), where);
      const line: ScriptLine = {
        kind: "line",
        speaker: item.speaker,
        character: shownName,
        characterId: character?.id ?? name(where, "characterId", shownName),
        ...(character?.unit ? { unit: character.unit } : {}),
        ...(character?.model ? { model: character.model } : {}),
        ...(character?.voice ? { voice: character.voice } : {}),
        soundId: unique("sound id", name(where, "soundId", context), where),
        ...(item.delivery ? { delivery: item.delivery } : {}),
        lineId,
        soundLine: name(where, "soundLine", { ...context, lineId }),
        text: item.text,
        shown: item.shown,
        spans: item.spans,
      };
      return line;
    }),
  }));
  return { title: parsed.title, fields: parsed.fields, conversationId, scenes };
}

export function scriptLines(script: Script): ScriptLine[] {
  return script.scenes.flatMap((scene) => scene.items.filter((item): item is ScriptLine => item.kind === "line"));
}

/** A Mission's Screenplay script, where its voice files are, and their format in its Map Package (host/voice-files.ts). */
export type MissionVoiceScript = { readonly script: Script; readonly audioDir: string; readonly voiceFormat: VoiceFormat };

/**
 * The Screenplay a Blueprint references, parsed and named in `workspace` (its Campaign Pack gives
 * the naming template, its Campaign Mod the characters), and where its voice files are; undefined
 * when it references none. Paths are relative to the Blueprint file. The Workspace is passed, not
 * read off the Blueprint, so a Blueprint that wasn't parsed with it (a copy made in code) can't
 * quietly fall back to core's naming. `characters` stands in for the Campaign Mod's where the
 * speakers' characters don't matter, such as following lines across a pull.
 */
export async function readMissionScript(
  blueprint: MissionBlueprint,
  blueprintPath: string,
  workspace: Workspace,
  characters?: CampaignCharacters,
): Promise<MissionVoiceScript | undefined> {
  const reference = blueprint.screenplay.script;
  if (!reference) return undefined;
  const blueprintDir = path.dirname(blueprintPath);
  const parsed = parseScript(await readFile(path.join(blueprintDir, reference.source), "utf8"));
  return { script: nameScript(parsed, blueprint.id, workspace.registry, characters ?? (await workspaceCharacters(workspace)), reference.conversationId === undefined ? {} : { conversationId: reference.conversationId }), audioDir: path.join(blueprintDir, reference.audioDir), voiceFormat: reference.voiceFormat ?? DEFAULT_VOICE_FORMAT };
}
