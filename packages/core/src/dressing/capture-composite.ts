// Captures a Doodad Composite recipe (DL-07) from doodads placed in the Editor: the author builds a
// shape from stock doodads, draws a region round it, and the doodads inside become the recipe's
// members, relative to their middle. Heights are above the ground at that middle, so the shape
// stays rigid wherever it's stamped. A member that is the map's own doodad made from a model brings
// that actor with it, so the recipe works on any map.

import type { Composite, CompositeActor, RegionShape } from "../domain/mission-blueprint.js";
import type { PlacedDoodad as EditorDoodad } from "../map/read-objects-xml.js";

const round = (value: number, places = 3): number => Math.round(value * 10 ** places) / 10 ** places;

function inShape(shape: RegionShape, x: number, y: number): boolean {
  if (shape.type === "rect") {
    const [x0, y0, x1, y1] = shape.quad;
    return x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && y >= Math.min(y0, y1) && y <= Math.max(y0, y1);
  }
  const dx = x - shape.center.x;
  const dy = y - shape.center.y;
  if (shape.type === "circle") return Math.hypot(dx, dy) <= shape.radius;
  return Math.abs(dx) / (shape.width / 2) + Math.abs(dy) / (shape.height / 2) <= 1;
}

/** Whether a point is in a region: in one of its shapes and none of its negative ones. */
export function inRegion(shapes: readonly RegionShape[], x: number, y: number): boolean {
  return shapes.some((shape) => !shape.negative && inShape(shape, x, y)) && !shapes.some((shape) => shape.negative && inShape(shape, x, y));
}

export type CaptureOptions = {
  readonly id: string;
  readonly kind: Composite["kind"];
  readonly style?: Composite["style"];
  readonly scale?: readonly [number, number];
  readonly description?: string;
  /** Only these types (to leave out the floor and props round a shape on someone else's map). */
  readonly types?: readonly string[];
  /** The map's own doodads made from models (readDoodadActors): members of these types bring them along. */
  readonly actors?: ReadonlyMap<string, CompositeActor>;
};

/**
 * The recipe of the doodads standing in `shapes`, centred on their middle (the centre of their
 * bounding box), with each member's height above `groundAt` there.
 */
export function captureComposite(
  doodads: readonly EditorDoodad[],
  shapes: readonly RegionShape[],
  groundAt: (x: number, y: number) => number,
  options: CaptureOptions,
): Composite {
  const inside = doodads.filter((d) => inRegion(shapes, d.position.x, d.position.y) && (!options.types || options.types.includes(d.type)));
  if (inside.length === 0) throw new Error(`No doodads in the region for composite ${options.id}`);
  const xs = inside.map((d) => d.position.x);
  const ys = inside.map((d) => d.position.y);
  const middle = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const ground = groundAt(middle.x, middle.y);
  const members = inside.map((d) => {
    const { x, y, z } = d.scale;
    const uniform = Math.abs(x - y) < 0.001 && Math.abs(x - z) < 0.001;
    const tint = d.tintColor?.split(",").slice(0, 3).join(",");
    return {
      type: d.type,
      x: round(d.position.x - middle.x),
      y: round(d.position.y - middle.y),
      height: round(d.position.z - ground),
      yaw: round(d.yaw, 4),
      ...(Math.abs(d.pitch) > 0.001 ? { pitch: round(d.pitch, 4) } : {}),
      ...(Math.abs(d.roll) > 0.001 ? { roll: round(d.roll, 4) } : {}),
      scale: uniform ? round(x) : ([round(x), round(y), round(z)] as [number, number, number]),
      ...(tint && tint !== "255,255,255" ? { tint } : {}),
      variation: d.variation ?? 0,
      ...(d.flags.includes("NoDoodadFootprint") ? { noFootprint: true } : {}),
    };
  });
  return {
    id: options.id,
    ...(options.description ? { description: options.description } : {}),
    kind: options.kind,
    style: options.style ?? "natural",
    scale: [options.scale?.[0] ?? 1, options.scale?.[1] ?? 1],
    actors: [...new Set(members.map((m) => m.type))].flatMap((type) => options.actors?.get(type) ?? []),
    members,
  };
}
