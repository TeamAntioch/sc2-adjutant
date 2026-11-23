import type { CompositeActor } from "../domain/mission-blueprint.js";
import { xmlElement, xmlElements } from "./xml-elements.js";

/**
 * A map's own doodads made from models: the CActorDoodads in its ActorData with a Model (3-4's
 * AntimatterMissileDoodad), as recipe actors. Animated unless the Stand loop (On index 1) is removed.
 */
export function readDoodadActors(xml: string): Map<string, CompositeActor> {
  const actors = new Map<string, CompositeActor>();
  for (const { attrs, body } of xmlElements(xml, "CActorDoodad")) {
    const model = xmlElement(body, "Model")?.attrs.value;
    if (!attrs.id || !model) continue;
    const scale = Number(xmlElement(body, "Scale")?.attrs.value ?? 1);
    const still = xmlElements(body, "On").some((on) => on.attrs.index === "1" && on.attrs.removed === "1");
    // Only on a still actor: an animation beside the kept Stand loop is not one the Blueprint can say.
    const played = still
      ? xmlElements(body, "On")
          .map((on) => /^AnimPlay ([A-Za-z][A-Za-z0-9]*) Stand,\1 PlayForever$/.exec(on.attrs.Send ?? "")?.[1])
          .find((animation) => animation)
      : undefined;
    actors.set(attrs.id, { id: attrs.id, model, scale, animate: !still, ...(played ? { animation: played } : {}) });
  }
  return actors;
}
