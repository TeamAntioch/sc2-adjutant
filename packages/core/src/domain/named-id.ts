// What a named id may hold (a conversation's, a line's, a sound's …): it goes into XML attributes
// and data links, and a sound id also names its voice file, so letters, digits, `_`, `-` and `.`,
// with no spaces, no path separators, `..` or markup, and no dot at either end. The naming
// template's ids and a Blueprint's own conversation id are held to it alike.

export const NAMED_ID = /^(?!.*\.\.)[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_-])?$/;

/** What a named id may hold, said the way a refusal says it. */
export const NAMED_ID_RULE = "letters, digits, _, - and ., not ending in . and with no ..";

export const isNamedId = (id: string): boolean => NAMED_ID.test(id);
