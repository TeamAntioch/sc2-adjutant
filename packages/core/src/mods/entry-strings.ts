// A catalog entry's own localized strings (ADR-0011: localized strings are generated, never
// authored). An entry, generic or a character's CCharacter, holds the strings keyed to it, by the
// strings file each is in, and the compile writes them beside the entry. A string is keyed to an
// entry in one of three ways:
//
//   by its catalog's convention,           Unit/Name/Crane, Unit/EditorPrefix/Crane,
//   <Catalog>/<Field>/<id>                 Button/Tooltip/Quay, Button/Hotkey/Quay (GameHotkeys)
//   by a field naming its key              <Text Text="UserData/Harbour/Quay_Name"/> (a CUser's text),
//                                          <Indices Name="ConversationState/Characters/CharHal"/>,
//                                          <Variations Name="Character/Name/CharScout/Var1"/>
//
//   by a default of its class             Button/Tooltip/Crane, a CUnit's Description
//
// A key a field names is the entry's when it's in the entry's own catalog's strings, or in no
// catalog's (UserData/…, LookAtType/…). One in another catalog's is the entry's only when no other
// entry's id is in it: it has no id (Weapon/ScoutWeaponCharging, an ability's Activity), or its id is
// the entry's own (Unit/Name/Buoy, the Buoy actor's HighlightTooltip). A CSound's subtitle names its
// conversation line's text, which is the Conversation's. And a key its convention gives to one entry
// of the mod is that entry's, even when another names it (a button sharing another's tooltip, an
// actor naming its unit's name, a unit's description when the mod has a button of its id): it
// moves with its own entry. convert-entries moves the strings with the entries (convert-entries.ts).

import type { FieldValue } from "../domain/catalog-fields.js";
import { isCommentKey } from "../domain/catalog-fields.js";
import { LOCALIZED_STRINGS_FILE, type Strings } from "../domain/entry-strings.js";
import { catalogSchema } from "./catalog-schema.js";
import { genericEntryKey, type GenericEntry } from "./generic-entries.js";

/** The entry a key's convention (`<Catalog>/<Field>/<id>`) gives it to, by catalog and id; none for a key of another form. */
export function conventionOwner(key: string): { readonly catalog: string; readonly id: string } | undefined {
  const [catalog, field, ...rest] = key.split("/");
  if (!catalog || !field || rest.length === 0 || rest.some((part) => part === "")) return undefined;
  return { catalog, id: rest.join("/") };
}

/**
 * The keys a class's defaults give an entry in another catalog's name: Core's CUnit's Description is
 * `Button/Tooltip/##id##`, the only such default in Core's catalogs. It's the unit's description,
 * which the game shows; a button of the unit's id has the same key as its tooltip.
 */
export function defaultKeys(entry: Pick<GenericEntry, "catalog" | "id" | "fields">): string[] {
  // A unit that sets its own Description names its key instead.
  return entry.catalog === "Unit" && entry.id !== undefined && entry.fields.Description === undefined ? [`Button/Tooltip/${entry.id}`] : [];
}

/** The keys that can be an entry's other than by its catalog's convention: those its fields name and those its class's defaults give it. */
export function ownKeys(entry: Pick<GenericEntry, "catalog" | "id" | "fields">): Set<string> {
  return new Set([...namedKeys(entry), ...defaultKeys(entry)]);
}

/**
 * The keys an entry's fields name that can be its own: each text value of its fields that starts
 * with its own catalog (`Character/Name/CharScout/Var1`) or with no catalog the game's data schema
 * has (`UserData/Harbour/Quay_Name`), and one in another catalog's that names no other entry's id
 * (`Weapon/ScoutWeaponCharging`, or `Unit/Name/Buoy` for the Buoy actor).
 */
export function namedKeys(entry: Pick<GenericEntry, "catalog" | "id" | "fields">, catalogs: ReadonlySet<string> = schemaCatalogs()): Set<string> {
  const out = new Set<string>();
  const walk = (value: FieldValue): void => {
    if (typeof value === "string") out.add(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === "object") for (const [key, member] of Object.entries(value)) if (!isCommentKey(key)) walk(member);
  };
  for (const [key, value] of Object.entries(entry.fields)) if (!isCommentKey(key)) walk(value);
  for (const key of out) {
    const catalog = key.split("/")[0]!;
    const owner = conventionOwner(key);
    const namesOtherId = owner !== undefined && owner.id !== entry.id;
    if (!key.includes("/") || (catalog !== entry.catalog && catalogs.has(catalog) && namesOtherId)) out.delete(key);
  }
  return out;
}

let catalogs: ReadonlySet<string> | undefined;
/** The catalogs the game's data schema has, by name (Unit, Sound, Conversation …). */
const schemaCatalogs = (): ReadonlySet<string> => (catalogs ??= new Set(Object.keys(catalogSchema().catalogs)));

/**
 * Whether `key` is keyed to `entry`: by its catalog's convention for the entry's id, by a default of
 * its class, or named by one of its fields. Which entry of the mod is given a key two can hold is
 * convert-entries' choice; the compile takes either, and refuses two that write it differently.
 */
export function isKeyedTo(entry: GenericEntry, key: string, own: ReadonlySet<string> = ownKeys(entry)): boolean {
  const owner = conventionOwner(key);
  return (owner !== undefined && entry.id !== undefined && owner.catalog === entry.catalog && owner.id === entry.id) || own.has(key);
}

/** What's wrong with an entry's strings, each saying which: a file that isn't a localized strings file, or a key not keyed to it. */
export function entryStringProblems(entry: GenericEntry): string[] {
  if (!entry.strings) return [];
  const name = genericEntryKey(entry);
  const own = ownKeys(entry);
  return Object.entries(entry.strings).flatMap(([file, keys]) => [
    ...(LOCALIZED_STRINGS_FILE.test(file) ? [] : [`${name}'s strings go in ${file}, which isn't a localized strings file (<locale>.SC2Data/LocalizedData/<name>.txt)`]),
    ...Object.keys(keys)
      .filter((key) => !isKeyedTo(entry, key, own))
      .map((key) => `${name}'s string ${key} isn't keyed to it: an entry holds the strings its catalog names for its id (${entry.catalog}/<Field>/${entry.id ?? "<id>"}), those its fields name and those its class's defaults give it`),
  ]);
}

/** `strings` with `file`'s `key` set to `text`, in the order keys were added. */
export function withString(strings: Strings | undefined, file: string, key: string, text: string): Strings {
  return { ...strings, [file]: { ...strings?.[file], [key]: text } };
}
