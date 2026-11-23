// Beats started on Mechanics' moments that could start out of order (beatOrderWarnings): the
// compile's warnings read it, with the orders the Mechanics guarantee (their momentOrder hooks).

import type { MissionBlueprint } from "../domain/mission-blueprint.js";
import { mechanicContext } from "../plugins/mechanic-context.js";
import { pluginMechanicEntries, runHook } from "../plugins/plugin-api.js";

/** A Mechanic's moment a Beat starts on, with its key for the order graph. */
type Moment = { readonly mechanicId: string; readonly cue: string; readonly key: string };
const moment = (mechanicId: string, cue: string): Moment => ({ mechanicId, cue, key: JSON.stringify([mechanicId, cue]) });
const momentName = ({ mechanicId, cue }: Moment): string => `Mechanic ${mechanicId}'s ${cue}`;

/**
 * Beats that start only on Mechanics' moments and could start out of order. A Beat starts only
 * while its trigger is on, and each Beat's start turns off every earlier Beat's, so an earlier
 * Beat whose moment comes after a later one's never starts. Moments are ordered only as the
 * Mechanics guarantee (their `momentOrder`, chained), and a moment is ordered with itself: a pair
 * of Beats whose order nothing guarantees warns that the earlier may never start, and one whose
 * later Beat's moments always come first warns that it never does. A pair where either Beat may
 * start on anything else (an Anchor's event, a Kept trigger's run, a scene playing) isn't judged:
 * their order isn't the Mechanics' to say, and the cue order the scenes follow is the author's.
 */
export function beatOrderWarnings(blueprint: MissionBlueprint): string[] {
  // Beats past the first started only on Mechanics' moments, with their moments.
  const onMoments = blueprint.beats.flatMap((beat, index) => {
    if (index === 0 || !beat.startsWhen) return [];
    const moments = beat.startsWhen.flatMap((condition) => (condition.type === "mechanic" ? [moment(condition.mechanicId, condition.cue)] : []));
    return moments.length === beat.startsWhen.length ? [{ beat, moments }] : [];
  });
  if (onMoments.length < 2) return [];
  const after = new Map<string, Set<string>>();
  const context = mechanicContext(blueprint);
  for (const { id, mechanic, params, label } of pluginMechanicEntries(blueprint)) {
    if (!mechanic.momentOrder) continue;
    const pairs: unknown = runHook(label, "momentOrder hook", () => mechanic.momentOrder!(params, { ...context, mechanicId: id }));
    const ref = (value: unknown): value is { mechanicId: string; cue: string } =>
      typeof value === "object" && value !== null && typeof (value as { mechanicId?: unknown }).mechanicId === "string" && typeof (value as { cue?: unknown }).cue === "string";
    if (!Array.isArray(pairs) || !pairs.every((pair) => ref(pair?.before) && ref(pair?.after))) throw new Error(`${label}: its momentOrder hook returned ${JSON.stringify(pairs)}, not pairs of { before, after } moments`);
    for (const { before, after: later } of pairs as { before: { mechanicId: string; cue: string }; after: { mechanicId: string; cue: string } }[]) {
      const from = moment(before.mechanicId, before.cue).key;
      if (!after.has(from)) after.set(from, new Set());
      after.get(from)!.add(moment(later.mechanicId, later.cue).key);
    }
  }
  // Whether `first` always comes before `then` (or is it), along the guaranteed orders.
  const precedes = (first: Moment, then: Moment): boolean => {
    if (first.key === then.key) return true;
    const seen = new Set<string>([first.key]);
    const queue = [first.key];
    while (queue.length > 0) {
      for (const next of after.get(queue.shift()!) ?? []) {
        if (next === then.key) return true;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return false;
  };
  return onMoments.flatMap(({ beat: earlier, moments: earlierMoments }, index) => {
    for (const { beat: later, moments: laterMoments } of onMoments.slice(index + 1)) {
      // Fine when each of the later Beat's moments comes after one of the earlier's.
      const unordered = laterMoments.find((then) => !earlierMoments.some((first) => precedes(first, then)));
      if (!unordered) continue;
      const never = laterMoments.every((then) => earlierMoments.every((first) => then.key !== first.key && precedes(then, first)));
      const earlierNames = earlierMoments.map(momentName).join(" or ");
      return [
        never
          ? `Beat ${earlier.id} never starts: Beat ${later.id}, after it, starts on ${momentName(unordered)}, which always comes before ${earlierNames}, and its start turns ${earlier.id}'s trigger off. Swap the two Beats, or start ${earlier.id} on an earlier moment`
          : `Beat ${earlier.id} may never start: Beat ${later.id}, after it, starts on ${momentName(unordered)}, which nothing orders after ${earlierNames}, and if it comes first its start turns ${earlier.id}'s trigger off. Order the two moments (a Mechanic can guarantee an order, as a meditation's after does), or start the Beats on moments that are`,
      ];
    }
    return [];
  });
}
