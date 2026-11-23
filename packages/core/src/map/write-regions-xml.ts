import type { MissionBlueprint, RegionLook, RegionShape } from "../domain/mission-blueprint.js";
import type { PlacedSetPiece } from "../dressing/expand-dressing.js";
import { boxOf } from "./map-bounds.js";

/** A region to write: its Editor name and how it's drawn. Written in order, numbered from 1 unless `ids` says otherwise. */
export type WrittenRegion = { readonly name: string } & RegionLook;

export type WriteRegionsOptions = {
  readonly regions: readonly WrittenRegion[];
  /** Each region's id, in order (numberRegions); by default 1, 2, 3... */
  readonly ids?: readonly number[];
};

/**
 * The ids of `count` Compiled regions beside the Kept regions holding `kept` (ADR-0010). Each
 * keeps its place in missionRegions' order as its number (what regionIdForZone gives, and the
 * triggers use) unless a Kept region holds that number; then it takes the next number past every
 * one in use, so the Kept region stays as it is. The same Kept ids and count give the same numbers;
 * a count that changes moves a renumbered region, as it moves every region after a Zone added or
 * removed, and the compiled triggers follow either way.
 */
export function numberRegions(count: number, kept: ReadonlySet<number>): number[] {
  let next = Math.max(count, ...kept) + 1;
  return Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    if (!kept.has(id)) return id;
    while (kept.has(next)) next++;
    return next++;
  });
}

/** What made a region, so sync can tell a zone's trigger area from a set piece's label or the author's own. */
export type RegionSource =
  | { readonly kind: "zone"; readonly zoneId: string }
  | { readonly kind: "set-piece"; readonly setPieceId: string }
  /** A Wave's warning circle around one target's aim point (ADR 0008). */
  | { readonly kind: "wave-warning"; readonly waveId: string; readonly zoneId: string }
  /** A Beat's camera bounds, playable area or camera transition, given by Zones or as a rectangle (ADR-0015). */
  | { readonly kind: "bounds"; readonly beatId: string; readonly role: "playable" | "camera" | "transition" }
  | { readonly kind: "region"; readonly regionId: string };

/** Regions are numbered from 1 in zone order; triggers reference them by this id. */
export function regionIdForZone(zones: readonly { readonly id: string }[], zoneId: string): number {
  const index = zones.findIndex((zone) => zone.id === zoneId);
  if (index < 0) throw new Error(`Unknown zone id: ${zoneId}`);
  return index + 1;
}

/** The bounding rectangle of a polygon: a zone's trigger area unless the author drew one. */
export function boundsShape(polygon: readonly { readonly x: number; readonly y: number }[]): RegionShape {
  return { type: "rect", quad: [...boxOf([polygon])!] as [number, number, number, number] };
}

/**
 * How many regions missionRegions writes before the Beats' bounds regions, given the Waves'
 * warning circles: the Zones', the circles, one per set piece (one per set-piece Placement) and the
 * author's own. The triggers number the bounds regions from here.
 */
export function regionsBeforeBounds(blueprint: Pick<MissionBlueprint, "zones" | "placements" | "regions">, waveWarnings: number): number {
  return blueprint.zones.length + waveWarnings + blueprint.placements.filter((placement) => placement.kind === "set-piece").length + blueprint.regions.length;
}

/**
 * Every region the mission writes, in id order: zones first (so triggers' region ids stay put),
 * each its drawn `region` or its polygon's bounds; then the Waves' warning circles
 * (waveWarningRegions), which triggers also use; then one per set piece, named after it, so a
 * reviewer can point at it; then the author's own `regions`; last the Beats' bounds regions
 * (boundsRegions), so adding or dropping one renumbers no other region.
 */
export function missionRegions(
  blueprint: MissionBlueprint,
  setPieces: readonly PlacedSetPiece[],
  waveWarnings: readonly (WrittenRegion & { readonly source: RegionSource })[] = [],
  bounds: readonly (WrittenRegion & { readonly source: RegionSource })[] = [],
): (WrittenRegion & { readonly source: RegionSource })[] {
  return [
    ...blueprint.zones.map((zone) => ({
      name: zone.name,
      ...(zone.region ?? { shapes: [boundsShape(zone.polygon)] }),
      source: { kind: "zone" as const, zoneId: zone.id },
    })),
    ...waveWarnings,
    ...setPieces.map((piece) => ({
      name: piece.id,
      shapes: [boundsShape([{ x: piece.x - piece.radius, y: piece.y - piece.radius }, { x: piece.x + piece.radius, y: piece.y + piece.radius }])],
      source: { kind: "set-piece" as const, setPieceId: piece.id },
    })),
    ...blueprint.regions.map(({ id, ...region }) => ({ ...region, source: { kind: "region" as const, regionId: id } })),
    ...bounds,
  ];
}

function shapeLines(shape: RegionShape): string[] {
  const negative = shape.negative ? ["      <negative/>"] : [];
  if (shape.type === "rect") return [`    <shape type="rect">`, ...negative, `      <quad value="${shape.quad.join(",")}"/>`, `    </shape>`];
  const center = `      <center value="${shape.center.x},${shape.center.y}"/>`;
  if (shape.type === "circle") return [`    <shape type="circle">`, ...negative, center, `      <radius value="${shape.radius}"/>`, `    </shape>`];
  return [`    <shape type="diamond">`, ...negative, center, `      <width value="${shape.width}"/>`, `      <height value="${shape.height}"/>`, `    </shape>`];
}

export function writeRegionsXml(options: WriteRegionsOptions): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="utf-8"?>');
  lines.push("<Regions>");

  options.regions.forEach((region, index) => {
    lines.push(`  <region id="${options.ids?.[index] ?? index + 1}">`);
    lines.push(`    <name value="${region.name}"/>`);
    if (region.color) lines.push(`    <color value="${region.color}"/>`);
    if (region.invisible) lines.push(`    <invisible/>`);
    for (const shape of region.shapes) lines.push(...shapeLines(shape));
    lines.push(`  </region>`);
  });

  lines.push("</Regions>");
  return lines.join("\n");
}
