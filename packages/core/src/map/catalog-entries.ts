// The entries of a GameData catalog file, as a compile record lists them (ADR-0010's
// `catalog-entry`): each top-level element of its <Catalog>, keyed by its class and id
// (`CUnit:Crane`), since one file may hold entries of one id in several catalogs (a hero's file
// has its CUnit and its CActorUnit). Comments, even ones holding commented-out entries, aren't
// entries.

import { rootChildren } from "../util/xml.js";

/** One entry of a catalog file: its key and where its text is, from the start of its line. */
export type CatalogEntry = { readonly key: string; readonly className: string; readonly id: string | undefined; readonly start: number; readonly end: number; readonly text: string };

/** An entry's key: `<Class>:<id>`, or the class alone for an entry with no id (a class's default). */
export const catalogEntryKey = (className: string, id: string | undefined): string => (id === undefined ? className : `${className}:${id}`);

/** The entries of `xml`, a `<Catalog>` document, in order. */
export function catalogEntries(xml: string): CatalogEntry[] {
  return rootChildren(xml).children.map((element) => {
    const id = element.attributes.get("id");
    return { key: catalogEntryKey(element.name, id), className: element.name, id, start: element.start, end: element.end, text: element.text };
  });
}
