import type { Composite, MissionBlueprint } from "../domain/mission-blueprint.js";
import { blueprintPlugins } from "../plugins/plugin-api.js";

/**
 * A Doodad Composite recipe by id: the mission's own first, then the shared library of the
 * Plugins the Blueprint was validated against (a Style Pack's recipes). A recipe the mission
 * doesn't hold, asked of a Blueprint with no Plugins bound (one made in code, not parsed), is
 * refused rather than looked up in no library at all.
 */
export function getComposite(blueprint: MissionBlueprint, id: string): Composite | undefined {
  const own = blueprint.composites.find((composite) => composite.id === id);
  if (own) return own;
  return blueprintPlugins(blueprint, `Doodad Composite ${id}, which isn't one of the Mission's own,`).composite(id);
}
