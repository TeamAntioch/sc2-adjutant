import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type Catalog, resolveLayered } from "./catalog-layer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Built by scripts/build-tech-catalog.mjs from Blizzard's UnitData.xml, UpgradeData.xml, BehaviorData.xml and EffectData.xml.
const CATALOG_PATH = path.resolve(__dirname, "../../data/tech-catalog.json");

/** What the tech checks know of a stock unit (CUnit, structures included). */
export type TechUnit = {
  /** Its mover is Fly: terrain doesn't stop it. */
  readonly flyer?: true;
  readonly structure?: true;
};

type TechCatalog = { readonly units: Readonly<Record<string, TechUnit>>; readonly upgrades: readonly string[]; readonly behaviors: readonly string[]; readonly effects: readonly string[] };

let catalog: { units: ReadonlyMap<string, TechUnit>; upgrades: ReadonlySet<string>; behaviors: ReadonlySet<string>; effects: ReadonlySet<string> } | null = null;
function load() {
  if (!catalog) {
    const raw = JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as TechCatalog;
    catalog = { units: new Map(Object.entries(raw.units)), upgrades: new Set(raw.upgrades), behaviors: new Set(raw.behaviors), effects: new Set(raw.effects) };
  }
  return catalog;
}

/**
 * A unit or structure, the game's or the Campaign Mod's, or undefined for an id neither defines. A
 * mod's unit flies and is a structure as its own fields say, else as the game's unit of its id or
 * its parent does.
 */
export function techUnit(catalog: Catalog, id: string): TechUnit | undefined {
  const units = catalog.units;
  const own = units.get(id);
  if (!own) return load().units.get(id);
  if (own.template) return undefined;
  /** A game unit's flag, false when it lacks it, undefined for an id the game doesn't define. */
  const stockFlag = (flag: keyof TechUnit) => (stock: string) => {
    const unit = load().units.get(stock);
    return unit ? unit[flag] === true : undefined;
  };
  const flyer = resolveLayered(units, id, (unit) => (unit.mover === undefined ? undefined : unit.mover === "Fly"), stockFlag("flyer"));
  const structure = resolveLayered(units, id, (unit) => unit.structure, stockFlag("structure"));
  return { ...(flyer ? { flyer: true as const } : {}), ...(structure ? { structure: true as const } : {}) };
}

/** The game's unit ids (its CUnit entries, structures included). */
export function gameUnitIds(): Iterable<string> {
  return load().units.keys();
}

/** Whether a CUpgrade id is a stock upgrade. */
export function isKnownUpgrade(id: string): boolean {
  return load().upgrades.has(id);
}

/** Whether a behaviour (a CBehavior id of any class) is the game's or the Campaign Mod's. */
export function isKnownBehavior(catalog: Catalog, id: string): boolean {
  return catalog.behaviors.has(id) || load().behaviors.has(id);
}

/** Whether an effect (a CEffect id of any class) is the game's or the Campaign Mod's. */
export function isKnownEffect(catalog: Catalog, id: string): boolean {
  return catalog.effects.has(id) || load().effects.has(id);
}
