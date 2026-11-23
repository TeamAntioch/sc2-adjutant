// A catalog entry's fields, as a generic typed entry (src/mods/generic-entries.ts) and the
// purpose-level shapes that compile down to one (a character's CharacterData fields) hold them: a
// value, a structure (its numbers and strings are attributes, its objects and arrays fields of
// its own) or an array of either, one element per item. A comment stands among a structure's
// fields as a "$comment" key ("$comment2", "$comment3" … for more in one structure), or among an
// array's items as an item holding only "$comment"; either way it's written where it stands.

import { z } from "zod";

/** A field's value: a value, a structure, or an array of either. */
export type FieldValue = string | number | FieldStruct | readonly (string | number | FieldStruct)[];
export type FieldStruct = { readonly [name: string]: FieldValue };

/** An element or attribute name, as XML has them. */
export const XML_NAME = /^[A-Za-z_][\w.-]*$/;

const Scalar = z.union([z.string(), z.number().finite()]);
/** A structure's member: an attribute or field name, "$text", or a comment's key. */
const Struct: z.ZodType<FieldStruct> = z.lazy(() =>
  z.record(
    z.string().refine((key) => XML_NAME.test(key) || key === "$text" || isCommentKey(key), "A member is an attribute or field name, $text, or a comment's $comment"),
    FieldSchema,
  ),
);
export const FieldSchema: z.ZodType<FieldValue> = z.lazy(() => z.union([Scalar, Struct, z.array(z.union([Scalar, Struct]))]));

/** A comment's key in a structure: $comment, $comment2, $comment3 … */
export const COMMENT_KEY = /^\$comment([2-9]|[1-9]\d+)?$/;
/** A structure's first comment's key, and an array's comment item's only key. */
export const COMMENT = "$comment";

/** Whether `key` holds a comment, in a structure. */
export const isCommentKey = (key: string): boolean => COMMENT_KEY.test(key);

/** Whether an array's item is a comment between its items: a structure holding only $comment. */
export const isCommentItem = (item: FieldValue): item is { readonly $comment: string } => typeof item === "object" && !Array.isArray(item) && Object.keys(item).length === 1 && COMMENT in item;

/** A catalog entry's fields, by name, with its comments among them. */
export const FieldsSchema = z.record(z.string().refine((key) => XML_NAME.test(key) || isCommentKey(key), "A field is a name such as LifeMax, or a comment's $comment"), FieldSchema);
