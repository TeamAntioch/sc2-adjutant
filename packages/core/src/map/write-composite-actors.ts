// Doodads made from models for Doodad Composite recipes (DL-07): each recipe a set piece stamps
// brings its `actors`, written to the map's ActorData as CActorDoodads, as 3-4 made its missile
// tower from the Scout's missile model.

import { type ModelAnims } from "../catalog/model-anims.js";
import { getComposite } from "../catalog/composites.js";
import { type CompositeActor, type MissionBlueprint, SetPieceParamsSchema } from "../domain/mission-blueprint.js";

/** The actors of every recipe the mission's set pieces stamp, once each by id. */
export function compositeActors(blueprint: MissionBlueprint): CompositeActor[] {
  const actors = new Map<string, CompositeActor>();
  for (const placement of blueprint.placements) {
    if (placement.kind !== "set-piece") continue;
    const params = SetPieceParamsSchema.parse(placement.params);
    for (const member of [...params.anchor, ...params.props, ...params.clutter]) {
      if (typeof member !== "object" || !("composite" in member)) continue;
      for (const actor of getComposite(blueprint, member.composite)?.actors ?? []) actors.set(actor.id, actor);
    }
  }
  return [...actors.values()];
}

/**
 * Catalog lines for the actors: a model at a fixed scale (each copy's size comes from its recipe),
 * without the stock doodad's sound emitter and, unless `animate`, its looping Stand animation. An
 * `animation` is sent on creation instead (see the actor's schema).
 */
export function compositeActorLines(actors: readonly CompositeActor[]): string[] {
  return actors.flatMap((actor) => [
    `    <CActorDoodad id="${actor.id}">`,
    `        <On index="0" removed="1"/>`,
    ...(actor.animate ? [] : [`        <On index="1" removed="1"/>`]),
    ...(actor.animation ? [`        <On Terms="ActorCreation" Send="AnimPlay ${actor.animation} Stand,${actor.animation} PlayForever"/>`] : []),
    `        <Model value="${actor.model}"/>`,
    `        <Scale value="${actor.scale.toFixed(6)}"/>`,
    `        <RandomScaleRange value="1.000000,1.000000"/>`,
    `    </CActorDoodad>`,
  ]);
}

/**
 * An `animation` plays only when the model has a `Stand <animation>` sequence: else the actor shows
 * nothing, silently. A model the catalog doesn't know (a mod's, beyond the Workspace's) isn't checked.
 */
export function compositeActorWarnings(actors: readonly CompositeActor[], anims: ModelAnims): string[] {
  return actors.flatMap((actor) => {
    const model = anims[actor.model];
    if (!actor.animation || !model) return [];
    if (model.anims.some((sequence) => sequence.name.split(" ").slice(0, 2).join(" ") === `Stand ${actor.animation}`)) return [];
    return [`Actor ${actor.id} plays animation ${actor.animation}, but its model ${actor.model} has no "Stand ${actor.animation}" sequence: it would show nothing. Leave animation out, or name one of its Stand sequences`];
  });
}
