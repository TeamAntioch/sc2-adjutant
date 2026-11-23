// A sound set, a purpose-level shape (ADR-0011): the SoundData entries of a conversation's lines,
// one CSound per line, compiled from their Asset Sources in the Asset Mod (src/mods/sound-sets.ts).
// Each CSound is in one of the two forms the Editor writes. The template form is a child of a
// parent that takes the line's tokens, as the Editor's dialogue templates do:
//
//   <CSound id="<Sound>" parent="<parent>" Subtitle="<conversation>" Template="<file>;<facial anim>"
//           Speaker="<CCharacter>" Line="<line number>"/>
//
// where <file> is the voice file's path as the parent's AssetArrayTemplate takes it (`##id##` when
// it's the Sound ID itself), and the facial anim is the set's, or the line's own. The AssetArray
// form (no template) gives the file in full, under any parent:
//
//   <CSound id="<Sound>" parent="<parent>" Subtitle="<conversation>" Speaker="<CCharacter>" Line="<line number>">
//       <AssetArray index="0">
//           <File value="<voice file>"/>  <FacialAnim value="<facial anim>"/>  <FacialGroup value=""/>
//           <PortraitModel value=""/>  <Speaker value="ConversationState/Characters/<CCharacter>"/>
//           <Subtitle value="Conversation/<conversation>/<line id>"/>
//       </AssetArray>
//   </CSound>
//
// Either form adds the set's own attributes and fields (such as Actor="", <Category value="Dialogue"/>),
// and a line may take a form of its own (`lines`).

import { z } from "zod";

import { FieldsSchema } from "./catalog-fields.js";
import { CatalogId } from "./mod-screenplay.js";

/** A facial anim, the second template parameter: it can't hold the parameters' ; or end the attribute. */
const FacialAnim = z.string().regex(/^[^;"]*$/, "A facial anim has no ; or \"");

/** Where the parent's AssetArrayTemplate puts its first template parameter. */
export const TEMPLATE_PARAM = "^TemplateParam1^";

/** The attributes a sound set writes itself, from the line: the others are a form's. */
export const LINE_ATTRIBUTES = ["Subtitle", "Template", "Speaker", "Line"] as const;

/** How a line's CSound is written: its parent, the template form or the AssetArray form, and anything else each has. */
const SoundFormSchema = z
  .object({
    /** The CSound each line's is a child of: in the template form, one that takes the Subtitle, Template, Speaker and Line tokens. */
    parent: CatalogId,
    /**
     * The parent's AssetArrayTemplate File, with ^TemplateParam1^ where the line's file goes, such
     * as `Assets\Sounds\^TemplateParam1^.ogg`: each line's voice file must fit it. Left out, each
     * CSound gives its AssetArray in full.
     */
    template: z
      .string()
      .refine((value) => value.split(TEMPLATE_PARAM).length === 2, `A template has ${TEMPLATE_PARAM} once`)
      .optional(),
    /** Each CSound's other attributes, such as Actor="" or Portrait="ScoutPortrait". */
    attributes: z
      .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string())
      .refine((attributes) => !["id", "parent", ...LINE_ATTRIBUTES].some((name) => name in attributes), `id, parent, ${LINE_ATTRIBUTES.join(", ")} are the sound set's own: they aren't a form's attributes`)
      .default({}),
    /** Each CSound's other fields, after its AssetArray, as a generic entry's, such as { "Category": "Dialogue", "Mode": "2D" }. */
    fields: FieldsSchema.refine((fields) => !("AssetArray" in fields), "AssetArray is the sound set's own: it isn't a form's field").default({}),
  })
  .strict();
export type SoundForm = z.infer<typeof SoundFormSchema>;

export const SoundSetSchema = SoundFormSchema.extend({
  /** The conversation whose lines it voices, one the Blueprint's Screenplays compile. */
  conversation: CatalogId,
  /** The scenes (Group0000N) whose lines it has; all of them when left out. */
  groups: z.array(z.number().int().positive()).min(1).optional(),
  /** The facial anim for a line not in facialAnims: the second template parameter (##id## when left out), or the AssetArray's FacialAnim (none when left out). */
  facialAnim: FacialAnim.optional(),
  /** A line's own facial anim, by its line id (such as Line01002). */
  facialAnims: z.record(z.string().min(1), FacialAnim).default({}),
  /** A line's own form, by its line id, in place of the set's: its parent, template, attributes and fields. */
  lines: z.record(z.string().min(1), SoundFormSchema).default({}),
}).strict();
export type SoundSet = z.infer<typeof SoundSetSchema>;

/** The form `lineId`'s CSound is written in: its own, else the set's. */
export function soundForm(set: SoundSet, lineId: string): SoundForm {
  return set.lines[lineId] ?? { parent: set.parent, ...(set.template !== undefined ? { template: set.template } : {}), attributes: set.attributes, fields: set.fields };
}

/** A Campaign Mod's sound sets, each conversation's lines in one. */
export const SoundSetsSchema = z.array(SoundSetSchema).superRefine((sets, context) => {
  const seen = new Map<string, number>();
  sets.forEach((set, index) => {
    const other = seen.get(set.conversation);
    if (other !== undefined) context.addIssue({ code: "custom", path: [index, "conversation"], message: `${set.conversation} has two sound sets, soundSets.${other} and soundSets.${index}: a conversation's lines are in one` });
    else seen.set(set.conversation, index);
  });
});
