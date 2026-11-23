// What compiled triggers call an Anchor, Zone or Kept Reference by (ADR-0010). A Kept Reference
// shares the Anchor namespace, so a trigger builder that takes an Anchor id (a speaker, a unit in a
// condition) or a Zone id (where a condition takes a region) resolves it here: a Kept one is the
// Editor's own object, region or trigger, found by its Editor Id; anything else is compiled.

import { type KeptKind, type KeptReference, type MissionBlueprint, waveUnitAnchors } from "../domain/mission-blueprint.js";
import { stableObjectId } from "../map/stable-object-id.js";
import { regionIdForZone } from "../map/write-regions-xml.js";
import { triggerVariable } from "./trigger-builders.js";
import { NTVE_PRESETS as P } from "./trigger-catalog.js";
import type { ParamValue, TriggerRef, TriggerVariable } from "./trigger-model.js";

type Kept = Pick<MissionBlueprint, "kept">;

/** The Kept Reference `id` names, when it is one of `kind`. */
export function keptReference(blueprint: Kept, id: string, kind?: KeptKind): KeptReference | undefined {
  return blueprint.kept.find((reference) => reference.id === id && (kind === undefined || reference.kind === kind));
}

/** Whether `id` names one of the Mission's units: a unit Anchor's or a Kept unit's. */
export function namesUnit(blueprint: Pick<MissionBlueprint, "anchors" | "kept">, id: string): boolean {
  return blueprint.anchors.some((anchor) => anchor.id === id && anchor.kind === "unit") || keptReference(blueprint, id, "unit") !== undefined;
}

/** A unit, point or camera's Objects Id: the Kept object's own, else the compiled Anchor's. */
export function objectIdOf(blueprint: Kept, anchorId: string): number {
  const kept = blueprint.kept.find((reference) => reference.id === anchorId && (reference.kind === "unit" || reference.kind === "point" || reference.kind === "camera"));
  return kept ? Number(kept.editorId) : stableObjectId(anchorId);
}

/**
 * The unit variable of a Wave's unit's Anchor (waveUnitAnchors): no unit until the send creates
 * it, then that unit. Declared by the Wave streams (waveStreams), whether or not its Wave compiles.
 * Its name takes - as _, so the schema refuses two such Anchors whose ids differ only there.
 */
export function waveUnitVariable(anchorId: string): TriggerVariable {
  return triggerVariable(`anchors/${anchorId}/unit`, `anchor_${anchorId.replace(/-/g, "_")}_unit`, "unit", { kind: "preset", preset: P.noUnit });
}

/** Whether a unit Anchor is a Wave's unit, there only once its send creates it (waveUnitAnchors). */
export function isWaveUnit(blueprint: Pick<MissionBlueprint, "waves">, anchorId: string): boolean {
  return waveUnitAnchors(blueprint).has(anchorId);
}

/**
 * A unit Anchor's unit as a trigger value: a Wave's unit's variable (waveUnitVariable), else the
 * Kept or compiled object by its Objects Id. Given to an event's unit (a UnitRef), the variable is
 * read as the event comes, so an event on a Wave's unit fires only once it's there.
 */
export function unitValueOf(blueprint: Pick<MissionBlueprint, "kept" | "waves">, anchorId: string): ParamValue {
  return isWaveUnit(blueprint, anchorId) ? { kind: "variable", variable: waveUnitVariable(anchorId) } : { kind: "unit", objectId: objectIdOf(blueprint, anchorId) };
}

/** The region a condition names by a Zone id: a Kept region by its own id, else the Zone's compiled region. */
export function regionValueOf(blueprint: Pick<MissionBlueprint, "kept" | "zones">, zoneId: string): Extract<ParamValue, { kind: "region" }> {
  const kept = keptReference(blueprint, zoneId, "region");
  return kept ? { kind: "region", regionId: Number(kept.editorId), kept: true } : { kind: "region", regionId: regionIdForZone(blueprint.zones, zoneId) };
}

/** What a trigger's name calls an Anchor or a Kept object. */
export function anchorNameOf(blueprint: Pick<MissionBlueprint, "kept" | "anchors">, anchorId: string): string {
  return blueprint.anchors.find((anchor) => anchor.id === anchorId)?.name ?? keptReference(blueprint, anchorId)?.name ?? anchorId;
}

/** What a trigger's name calls a Zone or a Kept region. */
export function zoneNameOf(blueprint: Pick<MissionBlueprint, "kept" | "zones">, zoneId: string): string {
  return blueprint.zones.find((zone) => zone.id === zoneId)?.name ?? keptReference(blueprint, zoneId, "region")?.name ?? zoneId;
}

/** A Kept trigger as a trigger value: its element Id, its name, and its Galaxy name when the package has given one (resolveKeptReferences). */
export function keptTriggerRef(blueprint: Kept, triggerId: string): TriggerRef {
  const kept = keptReference(blueprint, triggerId, "trigger");
  if (!kept) throw new Error(`Unknown Kept trigger id: ${triggerId}`);
  return { id: String(kept.editorId), name: kept.name, ...(kept.scriptName ? { scriptName: kept.scriptName } : {}) };
}
