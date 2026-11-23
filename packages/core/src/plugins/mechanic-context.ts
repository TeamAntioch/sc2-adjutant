// What a Mechanic's hooks read of the Blueprint (plugin-api.ts's MechanicContext). Kept apart from
// the plugin API, which the Blueprint schemas use at load: expanding the Placements needs those
// schemas, and they reach this module only inside functions, so importing it here breaks no load order
// (nor do the schema module's helpers, which this module calls only inside its function too).

import { blueprintCatalog, type Catalog } from "../catalog/catalog-layer.js";
import { isKnownBehavior } from "../catalog/tech-catalog.js";
import { missionLight } from "../catalog/tileset-lights.js";
import { isPlaced, type MissionBlueprint, waveUnitAnchors } from "../domain/mission-blueprint.js";
import { expandPlacements, type PlacedUnit } from "../map/expand-placements.js";
import { blueprintPlugins, type MechanicContext, mechanicLabel, type PluginRegistry, runHook } from "./plugin-api.js";

/**
 * The context for `blueprint`, its light from `catalog` and its Mechanics from `plugins`: the ones it
 * was validated against unless given (as while it is being validated).
 */
export function mechanicContext(blueprint: MissionBlueprint, catalog: Catalog = blueprintCatalog(blueprint), plugins?: PluginRegistry): MechanicContext {
  let placed: readonly PlacedUnit[] | undefined;
  // The behaviours the Mechanics' game data define, as their behaviorIds hooks declare them, found
  // on first use; an entry whose params don't parse (its own issue) declares none.
  let local: ReadonlySet<string> | undefined;
  const localBehaviors = (): ReadonlySet<string> => {
    if (local) return local;
    const registry = plugins ?? blueprintPlugins(blueprint);
    const found = new Set<string>();
    blueprint.mechanics.forEach((entry, index) => {
      const mechanic = registry.mechanic(entry.type);
      if (!mechanic?.behaviorIds) return;
      const label = mechanicLabel(registry, entry, index);
      const params = runHook(label, "paramsSchema", () => mechanic.paramsSchema.safeParse(entry.params));
      if (!params.success) return;
      const ids: unknown = runHook(label, "behaviorIds hook", () => mechanic.behaviorIds!(params.data, { ...context, mechanicId: entry.id }));
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) throw new Error(`${label}: its behaviorIds hook returned ${JSON.stringify(ids)}, not a list of behaviour ids`);
      for (const id of ids) found.add(id);
    });
    return (local = found);
  };
  const context: MechanicContext = {
    zones: blueprint.zones,
    anchors: blueprint.anchors.filter(isPlaced),
    waveUnitAnchorIds: new Set(waveUnitAnchors(blueprint).keys()),
    beats: blueprint.beats,
    regions: blueprint.regions,
    mechanics: blueprint.mechanics.map(({ id, type, params }) => ({ id, type, params })),
    light: missionLight(catalog, blueprint),
    knowsBehavior: (id) => isKnownBehavior(catalog, id) || localBehaviors().has(id),
    // Expanded on first use only, since a validate hook may run before the Placements are known good.
    placedUnits: () => (placed ??= expandPlacements(blueprint).units),
  };
  return context;
}
