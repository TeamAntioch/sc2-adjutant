// Localized strings as a Mod Blueprint holds them (ADR-0011): by strings file, each key's text.
// The Blueprint's raw `strings` have this form, and so do a catalog entry's own strings, those
// keyed to it, which a generic entry or a character holds (src/mods/entry-strings.ts).

import { z } from "zod";

import { PackagePath } from "./package-path.js";

/** A localized strings file in a package: `<locale>.SC2Data/LocalizedData/<name>.txt`. */
export const LOCALIZED_STRINGS_FILE = /^[a-zA-Z]{4}\.SC2Data\/LocalizedData\/[^/]+\.txt$/;

/** The enUS strings file of names only the Editor shows, such as a CSound's or a Conversation's, as the Editor writes it. */
export const OBJECT_STRINGS = "enUS.SC2Data/LocalizedData/ObjectStrings.txt";

/** A string's key: no = or line break. */
export const StringKey = z.string().min(1).regex(/^[^=\r\n]+$/, "A string key has no = or line break");

/** A string's text: one line. */
export const StringText = z.string().regex(/^[^\r\n]*$/, "A string is one line");

/** A path inside a mod package, with forward slashes: a compile record's, with no backslash. */
export const PackageFilePath = PackagePath.refine((value) => !value.includes("\\"), "A package path has forward slashes");

/** Strings by file (a path in the package, such as `enUS.SC2Data/LocalizedData/GameStrings.txt`), each key's text. */
export const StringsSchema = z.record(PackageFilePath, z.record(StringKey, StringText));

export type Strings = z.infer<typeof StringsSchema>;
