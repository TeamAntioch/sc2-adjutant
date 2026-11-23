// Point-in-polygon and edge distance, shared by the terrain, the layout checker and the triggers.

export type Point = { readonly x: number; readonly y: number };

/** Inside the polygon or on its boundary. */
export function containsPoint(polygon: readonly Point[], point: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    const withinX = point.x >= Math.min(a.x, b.x) && point.x <= Math.max(a.x, b.x);
    const withinY = point.y >= Math.min(a.y, b.y) && point.y <= Math.max(a.y, b.y);
    if (cross === 0 && withinX && withinY) return true;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from a point to a polygon's outline. */
export function distanceToPolygon(polygon: readonly Point[], point: Point): number {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!;
    const b = polygon[i]!;
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
  }
  return best;
}
