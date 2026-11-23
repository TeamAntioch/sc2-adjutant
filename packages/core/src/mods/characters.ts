// Characters, the first purpose-level shape (ADR-0011): each one a Campaign Mod's Blueprint
// declares (domain/character.ts) compiles down to a generic entry, its CCharacter in CharacterData:
//
//   { speaker: "MEDIC", id: "CharMedic", unit: "SMMedic", voice: "Moira" }
//                                     <CCharacter id="CharMedic"><Unit value="SMMedic"/></CCharacter>
//   model: "MedicPortrait"            <Variations Model="MedicPortrait"/>, beside any other Variations fields
//   fields: { Race: "Terran" }        <Race value="Terran"/>, as a generic entry's fields
//   strings: { "<strings file>": { "Character/Name/CharMedic": "Ana Ortiz" } }
//                                     its strings, as a generic entry's
//
// The speaker, its shown name and its voice are the Mission compile's: they aren't CharacterData.
// Mission compiles name their Screenplays' speakers from the Workspace's Campaign Characters: the
// characters its Campaign Mod's Blueprint declares.

import { type Character, speakerKey } from "../domain/character.js";
import type { FieldStruct, FieldValue } from "../domain/catalog-fields.js";
import type { ModBlueprint } from "../domain/mod-blueprint.js";
import type { Workspace } from "../plugins/workspace.js";
import { customDoodadEntries } from "./custom-doodads.js";
import type { GenericEntry } from "./generic-entries.js";
import type { SwapSlot } from "./texture-swaps.js";
import { campaignModBlueprint, MOD_PACKAGE_EXTENSION } from "./workspace-mods.js";

/** The CCharacter `character` compiles to. */
export function characterEntry(character: Character): GenericEntry {
  const fields: Record<string, FieldValue> = {};
  if (character.unit !== undefined) fields["Unit"] = character.unit;
  Object.assign(fields, character.fields);
  if (character.model !== undefined) fields["Variations"] = { ...((character.fields["Variations"] as FieldStruct | undefined) ?? {}), Model: character.model };
  return { catalog: "Character", class: "CCharacter", id: character.id, fields, ...(character.strings ? { strings: character.strings } : {}) };
}

/**
 * The generic entries the Blueprint's purpose-level shapes compile down to, by the declaration each
 * comes from, as compile-mod's messages name it ("the Blueprint's characters (MEDIC)"):
 * compile-mod writes them beside its generic entries, and convert-entries leaves them be.
 *
 * A doodad's swaps take their slots from `swapSlots` (modDoodadWarnings's, by doodad id), which a
 * compile gives and must give for every doodad that swaps, since a slot without its layer's
 * component fails silently in the game. Without it, as for what only asks which entries the
 * Blueprint writes, each swap's CTexture has its id and file and the bare slot.
 */
export function shapeEntries(blueprint: ModBlueprint, swapSlots?: ReadonlyMap<string, readonly SwapSlot[]>): readonly { readonly from: string; readonly entries: readonly GenericEntry[] }[] {
  return [
    ...blueprint.characters.map((character) => ({ from: `the Blueprint's characters (${character.speaker})`, entries: [characterEntry(character)] })),
    ...blueprint.doodads.map((doodad, index) => {
      const from = `doodads.${index} (${doodad.id})`;
      const slots = swapSlots ? swapSlots.get(doodad.id) : doodad.swaps;
      if (doodad.swaps.length > 0 && !slots) throw new Error(`${from} swaps textures: pass its swaps' slots (modDoodadWarnings) to shapeEntries`);
      return { from, entries: customDoodadEntries(doodad, slots) };
    }),
  ];
}

/** The characters a Workspace's Screenplays speak with: its Campaign Characters. */
export type CampaignCharacters = {
  /** The character declared for a Screenplay speaker, matched ignoring case and extra spaces. */
  character(speaker: string): Character | undefined;
  /**
   * Where every speaker must be declared, for the message when one isn't: the Campaign Mod's
   * Blueprint, or why it can't be read. Undefined when the Campaign names no Campaign Mod, whose
   * speakers have no characters and speak with no portrait.
   */
  readonly declaredIn?: string;
};

/** No characters, and none needed: a Campaign with no Campaign Mod. */
export const NO_CHARACTERS: CampaignCharacters = { character: () => undefined };

/** The Campaign Characters `characters`, all declared in `declaredIn`. */
export function charactersOf(characters: readonly Character[], declaredIn: string): CampaignCharacters {
  const bySpeaker = new Map(characters.map((character) => [speakerKey(character.speaker), character]));
  return { character: (speaker) => bySpeaker.get(speakerKey(speaker)), declaredIn };
}

/**
 * The Workspace's Campaign Characters: those its Campaign Mod's Blueprint declares. Its config or
 * its Campaign Pack names the Campaign Mod; when neither names one, there are none. When the
 * Workspace hasn't imported it, its Blueprint can't be read or it is an Asset Mod, there are none
 * and every speaker is undeclared, with the reason, so a Mission doesn't quietly compile without
 * its portraits and voices. Each mod's Blueprint is read once per call: a call is a Mission compile
 * or check, and the Blueprint may change between them (an import, a pull).
 */
export async function workspaceCharacters(workspace: Workspace): Promise<CampaignCharacters> {
  const mod = await campaignModBlueprint(workspace);
  if (mod.found === "none") return NO_CHARACTERS;
  const where = `the characters of the Campaign Mod ${mod.name}'s Blueprint`;
  if (mod.found === "missing") return charactersOf([], `${where}, which the Workspace doesn't have: import ${mod.name}${MOD_PACKAGE_EXTENSION} with import-mod`);
  if (mod.found === "unreadable") return charactersOf([], `${where} (${mod.shown}), which can't be read: ${mod.reason}`);
  if (mod.blueprint.kind !== "campaign") return charactersOf([], `a Campaign Mod's Blueprint, but ${mod.name} (${mod.shown}), named as the Campaign Mod, is an Asset Mod: make it a Campaign Mod`);
  return charactersOf(mod.blueprint.characters, `${where} (${mod.shown})`);
}
