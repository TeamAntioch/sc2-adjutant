// A Campaign Mod's Screenplay (ADR-0011): an interlude or a set of hub chats, kept where the
// Campaign keeps its Screenplays and compiled into one of the mod's Conversations. Its declaration
// in the Mod Blueprint names what the Screenplay Source knows it by (such as a script repo's Act), the
// pulled copy in the mod's folder the compile reads, and the CConversation it compiles into, with
// the imported ids the Conversation already had. The conversation shape (src/mods/conversations.ts)
// compiles it: each scene a group, each line a conversation line, its text a localized string.

import path from "node:path";

import { z } from "zod";

import { StringText } from "./entry-strings.js";

/** A catalog id, as a CConversation's or a CSound's is written. */
export const CatalogId = z.string().regex(/^[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_-])?$/, "An id is letters, digits, _, - and ., not ending in .");

export const ModScreenplaySchema = z
  .object({
    /**
     * What the Campaign Pack's Screenplay Source knows the Screenplay by, such as a script repo's
     * Act id; the pull fetches it into `source`. Left out in a Workspace with no Screenplay
     * Source, where `source` is the Screenplay itself.
     */
    ref: z.string().min(1).optional(),
    /** The Screenplay file in the mod's folder (its pulled copy, with a Source), relative to it. */
    source: z
      .string()
      .min(1)
      .refine((value) => !path.isAbsolute(value) && !value.split(/[\\/]/).includes(".."), "A source is a file in the mod's folder, relative to it"),
    /** The CConversation it compiles into, in the mod's ConversationData. */
    conversation: CatalogId,
    /**
     * The name the Editor lists the Conversation by, Conversation/Name/<conversation> in enUS
     * ObjectStrings: it isn't the id, so it's recorded here (convert-screenplay finds the Kept one).
     * Left out, the compile writes no name, and a Kept one stays Kept.
     */
    name: StringText.min(1).optional(),
    /**
     * The Sound each imported line already plays, by its line id, where it isn't the one the
     * naming template gives: imported ids are kept (convert-screenplay finds them). A new line
     * plays the naming template's.
     */
    importedSounds: z.record(z.string().min(1), CatalogId).default({}),
    /**
     * The name each imported group already has, by its group id, where it isn't the one the shape
     * gives (Conversation/<conversation>/<group id>): the Editor keeps a group's first name when its
     * Conversation is renamed, and the name is its title's string key (convert-screenplay finds them).
     */
    importedGroupNames: z.record(z.string().regex(/^Group\d{5}$/, "A group id is Group and five digits, Group00001"), z.string().min(1)).optional(),
    /** The facial animation an imported line plays, by its line id, where the Editor gave it one (FacialAnim): the Screenplay has none (convert-screenplay finds them). */
    importedFacialAnims: z.record(z.string().min(1), CatalogId).optional(),
    /** How long each line overlaps the one before it, in milliseconds, as the Conversation's lines have it (OverlapPrevious). */
    overlapPrevious: z.number().int().nonnegative().optional(),
  })
  .strict();

export type ModScreenplay = z.infer<typeof ModScreenplaySchema>;

/** A source as the file system finds it: `/` for a backslash, `.` steps gone, and without case, as macOS and Windows compare file names. */
const sourceKey = (source: string): string => path.posix.normalize(source.replace(/\\/g, "/")).toLowerCase();

/** The Screenplays of a Campaign Mod, each Conversation written by one, and each pulled into its own file. */
export const ModScreenplaysSchema = z.array(ModScreenplaySchema).superRefine((screenplays, context) => {
  const conversations = new Map<string, number>();
  const sources = new Map<string, number>();
  screenplays.forEach((screenplay, index) => {
    const other = conversations.get(screenplay.conversation);
    if (other !== undefined) context.addIssue({ code: "custom", path: [index, "conversation"], message: `${screenplay.conversation} is written by screenplays.${other} and screenplays.${index}: a Conversation comes from one Screenplay` });
    else conversations.set(screenplay.conversation, index);
    const key = sourceKey(screenplay.source);
    const sharing = sources.get(key);
    if (sharing !== undefined) context.addIssue({ code: "custom", path: [index, "source"], message: `${screenplay.source} is the source of screenplays.${sharing} and screenplays.${index}: each Screenplay has its own file, or one pull would overwrite the other's` });
    else sources.set(key, index);
  });
});
