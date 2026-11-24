// Data rules for a Mod Blueprint's generic entries, the facts hero work trips over
// (docs/reference/data-rules.md). Each is a warning that names its fix: the stock data backs each
// one (the reference lists the evidence), but none is confirmed in the Editor yet, so none
// refuses a compile.

import { isCommentItem, isCommentKey } from "../domain/catalog-fields.js";
import { repeatedFields } from "./effective-entry.js";
import { entryXml, type GenericEntry, genericEntryKey } from "./generic-entries.js";

/** The fields that hold one item per level, so an item with no index leaves the parent's level 0 as it was. */
const LEVEL_ARRAYS = ["VeterancyLevelArray", "LevelScalingArray", "LevelUpgradeArray"];

/** The AbilSetId Blizzard's class default gives every ability of that class, which a copy inherits. */
const STOCK_ABIL_SET_IDS: Readonly<Record<string, string>> = { CAbilAttack: "Attack", CAbilHarvest: "Harv", CAbilRally: "Rall", CAbilStop: "Stop" };

/** The first item of `value`, a field written as one item or an array of them (a comment isn't an item). */
function firstItem(value: unknown): unknown {
  return Array.isArray(value) ? value.find((item) => !isCommentItem(item)) : value;
}

const hasIndex = (item: unknown): boolean => typeof item === "object" && item !== null && "index" in item;

/** Each way the entries of each source break a data rule, as a warning naming the entry and the fix. */
export function dataRuleWarnings(sources: readonly { readonly from: string; readonly entries: readonly GenericEntry[] }[]): string[] {
  const all = sources.flatMap(({ entries }) => entries);
  const byId = new Map<string, GenericEntry>();
  for (const entry of all) if (entry.id !== undefined) byId.set(`${entry.catalog}:${entry.id}`, entry);
  const out: string[] = [];
  // The Blueprint's own entries only, as the effective-entry merge reads them: Kept and imported data aren't here.
  const repeats = repeatedFields(sources.map(({ from, entries }) => ({ label: from, files: [`<Catalog>\n${entries.map(entryXml).join("\n")}\n</Catalog>`] })));
  for (const { from, entries } of sources) {
    for (const entry of entries) {
      const name = `${from}: ${genericEntryKey(entry)}`;
      const parent = entry.parent === undefined ? undefined : byId.get(`${entry.catalog}:${entry.parent}`);
      const fields = Object.entries(entry.fields).filter(([key]) => !isCommentKey(key));

      if (entry.parent !== undefined) {
        for (const [field, value] of fields) {
          if (!LEVEL_ARRAYS.includes(field)) continue;
          if (!hasIndex(firstItem(value))) out.push(`${name}: ${field}'s first item has no index, so the parent ${entry.parent}'s level 0 stays active under it: write index="0" on the first item`);
        }
      }

      if (entry.catalog === "Abil" && entry.parent !== undefined && !fields.some(([field]) => field === "AbilSetId")) {
        const inherited = parent?.fields.AbilSetId ?? STOCK_ABIL_SET_IDS[entry.class];
        if (inherited !== undefined)
          out.push(`${name}: a copy of ${entry.parent} has no AbilSetId of its own, so it shares the set id "${String(typeof inherited === "object" ? (inherited as { value?: unknown }).value : inherited)}" and a command given to either ability reaches both: give it its own AbilSetId`);
      }

      if (entry.catalog === "Actor" && parent && parent.class !== entry.class && !entry.class.startsWith(parent.class))
        out.push(`${name}: its parent ${entry.parent} is a ${parent.class}, not a ${entry.class}: parent an actor on one of its own class (Blizzard parents a subclass on its base class, such as CActorRegionQuad on CActorRegion, but the safe pairing is the same class)`);

      for (const repeat of repeats.filter((one) => one.class === entry.class && one.id === entry.id)) {
        const field = repeat.index === undefined ? repeat.field : `${repeat.field}[${repeat.index}]`;
        out.push(`${name}: ${field} repeats the value its parent ${repeat.parent} sets: delete it here, so a later change to ${repeat.parent} reaches this entry (or change it, if it should differ)`);
      }

      if (entry.catalog === "Weapon" && entry.class === "CWeapon" && entry.id !== undefined)
        out.push(`${name}: a named weapon is a CWeaponLegacy in Blizzard's data (none of its 3,000-odd named weapons is a CWeapon), and the Editor may refuse a named CWeapon: change its class to CWeaponLegacy`);
    }
  }
  return out;
}
