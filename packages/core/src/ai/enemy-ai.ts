// The enemy AI's tuning, in one place (enemy-ai §3, §8). Blizzard's campaign enemies don't build
// bases: every base is placed, the campaign AI mines, defends and rebuilds what it's told to, and
// difficulty is set per placed unit. Each knob here is a guess to be tuned in play; a blueprint
// overrides any of them in `enemyAi`.

import type { EnemyAiOverrides, MissionBlueprint } from "../domain/mission-blueprint.js";
import { expandPlacements, type PlacedUnit } from "../map/expand-placements.js";

export const ENEMY_AI = {
  /** Set at the start and topped up every `topUpSeconds` of AI time, so rebuilding never stalls. */
  money: { minerals: 10000, vespene: 10000, topUpSeconds: 10 },
  /** Casual keeps this share of each group's units, and plays the enemy at this handicap (%). */
  casual: { keep: 2 / 3, handicap: 50 },
  /** Hard and Brutal add this share of each group's units again, and grant these upgrades. */
  hard: { extra: 0.25, upgrades: [] as string[] },
  brutal: { extra: 0.5, upgrades: ["ProtossGroundWeaponsLevel1", "ProtossGroundArmorsLevel1"] },
  /** Kept alive by the AI, as Blizzard keeps economy, supply and static defence; the army isn't. */
  rebuildAlways: ["Probe", "SCV", "Drone", "Pylon", "SupplyDepot", "PhotonCannon", "ShieldBattery", "MissileTurret", "Bunker", "SpineCrawler", "SporeCrawler"],
};

export type EnemyAiSettings = typeof ENEMY_AI;

/** `base` with every field `over` sets. */
const merge = <T extends object>(base: T, over: object | undefined): T =>
  ({ ...base, ...Object.fromEntries(Object.entries(over ?? {}).filter(([, value]) => value !== undefined)) }) as T;

/** The defaults with the blueprint's overrides on top. */
export function enemyAiSettings(overrides: EnemyAiOverrides | undefined = undefined): EnemyAiSettings {
  return {
    money: merge(ENEMY_AI.money, overrides?.money),
    casual: merge(ENEMY_AI.casual, overrides?.casual),
    hard: merge(ENEMY_AI.hard, overrides?.hard),
    brutal: merge(ENEMY_AI.brutal, overrides?.brutal),
    rebuildAlways: overrides?.rebuildAlways ?? ENEMY_AI.rebuildAlways,
  };
}

/** The Editor's "Always" rebuild count, by Blizzard's usage (enemy-ai §3.1; unverified, §9 Q3). */
export const REBUILD_ALWAYS = 14;

/** Casual, Normal, Hard, Brutal: the Editor's difficulty indices 1-4. */
export type PerDifficulty<T> = readonly [T, T, T, T];

/** A placed unit's AI settings, as the Editor's unit properties write them. */
export type UnitAi = {
  readonly rebuild: PerDifficulty<number>;
  readonly active: PerDifficulty<boolean>;
  /** "Available For Attack Waves". */
  readonly waveable: boolean;
};

/** Present on these difficulties: a group's own units, minus Casual's cut, plus the Hard and Brutal extras. */
export const ALWAYS: PerDifficulty<boolean> = [true, true, true, true];
export const NOT_CASUAL: PerDifficulty<boolean> = [false, true, true, true];
export const HARD_UP: PerDifficulty<boolean> = [false, false, true, true];
export const BRUTAL_ONLY: PerDifficulty<boolean> = [false, false, false, true];

/** A placed enemy unit's AI settings: rebuilt by type, kept home, active as its group decides. */
export function unitAi(settings: EnemyAiSettings, unitType: string, active: PerDifficulty<boolean> = ALWAYS): UnitAi {
  const rebuild = settings.rebuildAlways.includes(unitType) ? REBUILD_ALWAYS : 0;
  return { rebuild: [rebuild, rebuild, rebuild, rebuild], active, waveable: false };
}

/** Players 2-14 that the blueprint's unit anchors and placed units belong to: the computer players to start. */
export function enemyPlayers(blueprint: MissionBlueprint, placed: readonly PlacedUnit[] = expandPlacements(blueprint).units): number[] {
  const players = [
    ...blueprint.anchors.flatMap((anchor) => (anchor.kind === "unit" && anchor.player !== undefined ? [anchor.player] : [])),
    ...placed.flatMap((unit) => (unit.player !== undefined ? [unit.player] : [])),
  ];
  return [...new Set(players)].filter((player) => player >= 2 && player <= 14).sort((a, b) => a - b);
}
