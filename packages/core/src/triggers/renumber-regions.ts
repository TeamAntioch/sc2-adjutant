// Compiled regions renumbered past Kept ones (ADR-0010): the trigger builders call a Compiled
// region by its place in missionRegions' order (regionIdForZone); when a Kept region holds that
// number, the compile gives the Compiled one another (numberRegions), and every region value in
// the triggers follows it here. A Kept region's own value (`kept`) is left as it is.

import type { TriggerDocument } from "./trigger-model.js";

/**
 * `triggers` with each Compiled region value's place `n` replaced by `ids[n - 1]`, and each Beat's
 * bounds region value (its `bounds` place among them) by `boundsIds[bounds]`: the ids those regions
 * were written at, found by their source.
 */
export function renumberRegions(triggers: TriggerDocument, ids: readonly number[], boundsIds: readonly number[] = []): TriggerDocument {
  if (ids.every((id, index) => id === index + 1) && boundsIds.length === 0) return triggers;
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== "object") return value;
    const node = value as Record<string, unknown>;
    if (node["kind"] === "region" && typeof node["bounds"] === "number" && boundsIds[node["bounds"]] !== undefined) return { ...node, regionId: boundsIds[node["bounds"]] };
    if (node["kind"] === "region" && typeof node["regionId"] === "number" && node["kept"] !== true) {
      return { ...node, regionId: ids[node["regionId"] - 1] ?? node["regionId"] };
    }
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
  };
  return walk(triggers) as TriggerDocument;
}
