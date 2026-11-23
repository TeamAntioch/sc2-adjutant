// A character (ADR-0011): one of a Campaign's speakers, declared once in its Campaign Mod's Mod
// Blueprint. Its declaration gives the speaker as Screenplays write it, its CCharacter id, what an
// off-map Transmission from it shows (a unit type, or else a portrait model), its other
// CharacterData fields and the placeholder voice for its lines. The mod compile writes it into
// CharacterData as a generic entry (src/mods/characters.ts); Mission compiles name their
// Screenplays' speakers from it.

import { z } from "zod";

import { FieldsSchema } from "./catalog-fields.js";
import { StringsSchema } from "./entry-strings.js";

/** How a speaker is matched to its character: "Matt  Horner" is "MATT HORNER". */
export function speakerKey(speaker: string): string {
  return speaker.trim().replace(/\s+/g, " ").toUpperCase();
}

/** What a record keyed by speaker (as `speakerAnchors` and a trigger scene's `speakers` are) gives `speaker`: its own entry, else the one it matches by speakerKey. */
export function bySpeaker<T>(record: Readonly<Record<string, T>>, speaker: string): T | undefined {
  if (Object.hasOwn(record, speaker)) return record[speaker];
  const key = speakerKey(speaker);
  return Object.entries(record).find(([name]) => speakerKey(name) === key)?.[1];
}

export const CharacterSchema = z
  .object({
    /** The speaker as the Screenplay writes it, e.g. "RAYNOR"; matched ignoring case and extra spaces. */
    speaker: z.string().refine((speaker) => speakerKey(speaker) !== "", "A speaker has a name"),
    /** Its CCharacter, in the mod's CharacterData, which its conversation lines name. */
    id: z.string().regex(/^[A-Za-z0-9_]+$/, "A CCharacter id is letters, digits and _"),
    /** The name its Transmissions show; defaults to the speaker title-cased without spaces ("VAN DER BERG" is "VanDerBerg"). */
    name: z.string().min(1).optional(),
    /** The unit type an off-map Transmission from it shows; CharacterData's Unit. */
    unit: z.string().min(1).optional(),
    /** Or the portrait model, shown when it has no unit; CharacterData's Variations Model. */
    model: z.string().min(1).optional(),
    /** The placeholder text-to-speech voice for its lines. */
    voice: z.string().min(1).optional(),
    /** Its other CharacterData fields (Race, Gender, Age, the rest of Variations …), as a generic entry's. */
    fields: FieldsSchema.default({}),
    /**
     * The localized strings keyed to its CCharacter, by strings file, as a generic entry holds them
     * (Character/Name, VoiceRef, Description, Dialect …): convert-entries moves them here.
     */
    strings: StringsSchema.optional(),
  })
  .strict()
  .superRefine((character, context) => {
    if ("Unit" in character.fields) context.addIssue({ code: "custom", path: ["fields", "Unit"], message: "A character's Unit is its unit: give it as unit" });
    const variations = character.fields["Variations"];
    if (character.model !== undefined && variations !== undefined && (typeof variations !== "object" || Array.isArray(variations))) {
      context.addIssue({ code: "custom", path: ["fields", "Variations"], message: "A character with a model has one Variations, which the model goes in: give Variations as one structure" });
    } else if (variations !== undefined && typeof variations === "object" && !Array.isArray(variations) && "Model" in variations) {
      context.addIssue({ code: "custom", path: ["fields", "Variations", "Model"], message: "A character's Variations Model is its portrait model: give it as model" });
    }
  });

/** One of a Campaign's speakers, and what its Transmissions show and sound like. */
export type Character = z.infer<typeof CharacterSchema>;

/** A list of characters, each speaker and each CCharacter id once. */
export const CharactersSchema = z.array(CharacterSchema).superRefine((characters, context) => {
  const speakers = new Map<string, number>();
  const ids = new Map<string, number>();
  characters.forEach((character, index) => {
    const key = speakerKey(character.speaker);
    if (speakers.has(key)) context.addIssue({ code: "custom", path: [index, "speaker"], message: `${key} is declared twice, as characters.${speakers.get(key)} and characters.${index}` });
    else speakers.set(key, index);
    if (ids.has(character.id)) context.addIssue({ code: "custom", path: [index, "id"], message: `${character.id} is the id of two characters, characters.${ids.get(character.id)} and characters.${index}` });
    else ids.set(character.id, index);
  });
});
