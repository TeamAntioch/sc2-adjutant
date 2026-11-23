// The keys of a CCutsceneNodePropertyValue, as Blizzard's cutscenes write them: each key's value at
// an absolute time, and a Bezier handle on each side, a third of the way in time to the key beside it
// (1 ms out at the ends), so a span's time runs evenly along it and only its value bends. The handle
// values make the shape, and each side carries the Editor's tangent type for it: 3 (Linear), which
// the writer also gives its eased spans, and 7 (Auto), which passes through each key at the slope
// between its neighbours, flat at turning points and at the ends (research §4.10, decoded from the
// handle geometry; two Editor-made cutscenes' roll keys match it to the digit).

/** A key: its value at `time` (ms), its handles' values (their times are its neighbours'), and each side's tangent type. */
export type CurveKey = {
  readonly time: number;
  readonly value: number;
  readonly inValue: number;
  readonly outValue: number;
  readonly inType: TangentType;
  readonly outType: TangentType;
};

/** The Editor's tangent types: 3 Linear, 7 Auto. */
export type TangentType = "3" | "7";

/** A value at a time (ms). */
export type Point = { readonly time: number; readonly value: number };

/** How far off its curve a shake puts a property at a time (ms). */
export type Jolt = { readonly time: number; readonly offset: number };

const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

/** How far along a span its value is, as a Bezier in its time share u: "ease" leaves at speed (halfway at a third of its time) and settles, "linear" keeps one speed. */
const PROGRESS = { ease: [0, 1 / 2, 1, 1], linear: [0, 1 / 3, 2 / 3, 1] } as const;

const bezier = ([p0, p1, p2, p3]: readonly number[], u: number): number => (1 - u) ** 3 * p0! + 3 * (1 - u) ** 2 * u * p1! + 3 * (1 - u) * u ** 2 * p2! + u ** 3 * p3!;

/** How far along a span (0 to 1) a key's value has got at its time share `u`, as its curve moves it: see PROGRESS. */
export const progressAt = (style: "ease" | "linear", u: number): number => bezier(PROGRESS[style], u);

/** The control points of a cubic Bezier's stretch from u = `from` to `to` (de Casteljau). */
function stretch(points: readonly number[], from: number, to: number): number[] {
  const after = (controls: readonly number[], u: number): number[] => {
    const [, p1, p2, p3] = controls as [number, number, number, number];
    const [p12, p23] = [lerp(p1, p2, u), lerp(p2, p3, u)];
    return [bezier(controls, u), lerp(p12, p23, u), p23, p3];
  };
  const tail = after(points, from);
  // The tail's own u at `to`, then the tail's head up to it (the reversed tail's tail).
  return after([...tail].reverse(), 1 - (to - from) / (1 - from)).reverse();
}

/** The time share u at which a span's progress reaches `share` (it only grows), by bisection. */
function shareAt(progress: readonly number[], share: number): number {
  let [low, high] = [0, 1];
  for (let step = 0; step < 50; step++) {
    const middle = (low + high) / 2;
    if (bezier(progress, middle) < share) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** A value a span passes on its way, and how far along its progress (0 to 1). */
export type Passing = { readonly share: number; readonly value: number };

/**
 * Keys through `points`, each span between two "ease" (it leaves at speed and settles onto the next
 * key: its out handle halfway in value, its in handle flat) or "linear" (both handles on the
 * straight line). A span with values `between` passes each at its share of the span's progress,
 * keyed where it gets there, so the span keeps its pace and goes straight from value to value (a
 * turn the engine would otherwise make off the true one, turns.ts).
 */
export function spanKeys(points: readonly Point[], spans: readonly ("ease" | "linear")[], between: readonly (readonly Passing[] | undefined)[] = []): CurveKey[] {
  const keys: { time: number; value: number; inValue: number; outValue: number }[] = points.map(({ time, value }) => ({ time, value, inValue: value, outValue: value }));
  const out: typeof keys = [];
  points.forEach((point, at) => {
    out.push(keys[at]!);
    const after = points[at + 1];
    if (!after) return;
    const passes = [{ share: 0, value: point.value }, ...(between[at] ?? []), { share: 1, value: after.value }];
    const progress = PROGRESS[spans[at] ?? "ease"];
    const times = passes.map(({ share }) => (share === 0 ? 0 : share === 1 ? 1 : shareAt(progress, share)));
    for (let piece = 0; piece + 1 < passes.length; piece++) {
      // This piece's stretch of the span's progress, mapped onto its two values.
      const [, p1, p2] = stretch(progress, times[piece]!, times[piece + 1]!);
      const [a, b] = [passes[piece]!, passes[piece + 1]!];
      const valueOf = (share: number) => a.value + ((b.value - a.value) * (share - a.share)) / (b.share - a.share);
      out.at(-1)!.outValue = valueOf(p1!);
      const last = piece + 2 === passes.length;
      const tail = last ? keys[at + 1]! : { time: lerp(point.time, after.time, times[piece + 1]!), value: b.value, inValue: b.value, outValue: b.value };
      tail.inValue = valueOf(p2!);
      if (!last) out.push(tail);
    }
  });
  return out.map((key) => ({ ...key, inType: "3", outType: "3" }));
}

/**
 * A key's Auto handles among `points`: at the slope from the key before to the key after, flat at a
 * turning point or an end. The slope is eased off until neither handle passes its neighbour's value,
 * so the curve doesn't overshoot and the two handles stay on one line (no kink at the key).
 */
function autoHandles(points: readonly Point[], at: number): { inValue: number; outValue: number } {
  const { time, value } = points[at]!;
  const before = points[at - 1];
  const after = points[at + 1];
  if (!before || !after || (value - before.value) * (after.value - value) <= 0) return { inValue: value, outValue: value };
  const through = (after.value - before.value) / (after.time - before.time);
  const most = Math.min((3 * Math.abs(value - before.value)) / (time - before.time), (3 * Math.abs(after.value - value)) / (after.time - time));
  const slope = Math.sign(through) * Math.min(Math.abs(through), most);
  return { inValue: value - (slope * (time - before.time)) / 3, outValue: value + (slope * (after.time - time)) / 3 };
}

/** Keys through `points` with Auto tangents: a smooth path through every key, at rest at its ends. */
export function smoothKeys(points: readonly Point[]): CurveKey[] {
  return points.map((point, at) => ({ ...point, ...autoHandles(points, at), inType: "7", outType: "7" }));
}

/** The curve's value at `time`: its first key's before it, its last's after. */
function valueAt(keys: readonly CurveKey[], time: number): number {
  const next = keys.findIndex((key) => key.time >= time);
  if (next === -1) return keys.at(-1)!.value;
  if (next === 0) return keys[0]!.value;
  const [a, b] = [keys[next - 1]!, keys[next]!];
  const u = (time - a.time) / (b.time - a.time);
  return (1 - u) ** 3 * a.value + 3 * (1 - u) ** 2 * u * a.outValue + 3 * (1 - u) * u ** 2 * b.inValue + u ** 3 * b.value;
}

/** The curve with a key at `time` that leaves its shape as it was (de Casteljau's split), or a flat one before its first key or after its last. */
function withKeyAt(keys: readonly CurveKey[], time: number): CurveKey[] {
  if (keys.some((key) => key.time === time)) return [...keys];
  const next = keys.findIndex((key) => key.time > time);
  if (next <= 0) {
    const { value } = next === 0 ? keys[0]! : keys.at(-1)!;
    const flat: CurveKey = { time, value, inValue: value, outValue: value, inType: "3", outType: "3" };
    return next === 0 ? [flat, ...keys] : [...keys, flat];
  }
  const [a, b] = [keys[next - 1]!, keys[next]!];
  const u = (time - a.time) / (b.time - a.time);
  const [p01, p12, p23] = [lerp(a.value, a.outValue, u), lerp(a.outValue, b.inValue, u), lerp(b.inValue, b.value, u)];
  const [p012, p123] = [lerp(p01, p12, u), lerp(p12, p23, u)];
  return [
    ...keys.slice(0, next - 1),
    { ...a, outValue: p01 },
    { time, value: lerp(p012, p123, u), inValue: p012, outValue: p123, inType: a.outType, outType: b.inType },
    { ...b, inValue: p23 },
    ...keys.slice(next + 1),
  ];
}

/**
 * The curve shaken from `startMs` to `endMs`: keys at the offsets' times, each that far off the curve
 * there, with Auto tangents, as Blizzard keys a camera's shake by hand (research §4.10, "Handheld and
 * shake"; an Editor-made tram ride's camera too). It leaves the curve's shape outside the range as it was.
 */
export function shaken(keys: readonly CurveKey[], startMs: number, endMs: number, offsets: readonly Jolt[]): CurveKey[] {
  const split = withKeyAt(withKeyAt(keys, startMs), endMs);
  const inside = offsets.filter(({ time }) => time > startMs && time < endMs).map(({ time, offset }) => ({ time, value: valueAt(split, time) + offset }));
  const before = split.filter((key) => key.time <= startMs);
  const after = split.filter((key) => key.time >= endMs);
  const points = [...before, ...inside, ...after];
  const auto = (at: number) => autoHandles(points, at);
  const [start, end] = [before.length - 1, before.length + inside.length];
  return [
    ...before.slice(0, -1),
    { ...before.at(-1)!, outValue: auto(start).outValue, outType: "7" },
    ...inside.map((point, at): CurveKey => ({ ...point, ...auto(start + 1 + at), inType: "7", outType: "7" })),
    { ...after[0]!, inValue: auto(end).inValue, inType: "7" },
    ...after.slice(1),
  ];
}

/**
 * A shake's jolts on one property from `from` to `to` (ms): a key every half cycle, alternating in
 * sign, each a seeded half to all of `amplitude`. `seed` (one per property) starts each property's
 * jolts on its own side and gives them their own sizes, so the axes don't jolt in step, and a
 * compile repeats.
 */
export function shakeJolts(from: number, to: number, hz: number, amplitude: number, seed: number): Jolt[] {
  // mulberry32, seeded by the property and the shake's start.
  let state = (Math.round(from) * 31 + seed * 7919) >>> 0;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const side = random() < 0.5 ? 1 : -1;
  const step = 500 / hz;
  const jolts: Jolt[] = [];
  for (let at = 1; from + at * step < to - step / 2; at++) jolts.push({ time: Math.round(from + at * step), offset: side * (at % 2 ? 1 : -1) * amplitude * (0.5 + random() / 2) });
  return jolts;
}
