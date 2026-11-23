// Makes a whole melee map from the half a Melee Map Blueprint draws (#214): every zone,
// connection, ramp, terrain object and resource base turned 180° about the playable area's
// centre, the turned copy named `<id>-rot` and listed right after its source. A zone that lies
// across the centre (it overlaps its own rotation) isn't copied: it must already be symmetric.
//
// Listing each copy after its source keeps the halves alike where zones overlap (later zones
// win): if a zone wins over another's copy on one side, its copy wins over that zone on the other.
// So the two halves meet at the seam with no gap or overlap of their own. What the compiler can't
// draw the same way twice (a ramp's fit, a resource base's layout, the noise in outlines and
// textures) it turns from the source side, through the `Rot180` this returns.

import { type DiagonalFacing, isResourceBase, type MeleeMapBlueprint, type MeleePlacement, meleePlayableBounds } from "../domain/melee-map-blueprint.js";
import { containsPoint, type Point } from "../terrain/rasterize.js";
import { ROTATED_EDGE, ROTATED_FACING, type Rot180, rotatedId, rotatePoint } from "../terrain/symmetry.js";
import { townHallSpot } from "./expand-placements.js";

type Zone = MeleeMapBlueprint["zones"][number];

/** The whole map, and the rotation that made it. */
export function rotateHalf(half: MeleeMapBlueprint): { readonly blueprint: MeleeMapBlueprint; readonly symmetry: Rot180 } {
  const [left, bottom, right, top] = meleePlayableBounds(half);
  const centre = { x: (left + right) / 2, y: (bottom + top) / 2 };
  const turn = (point: Point): Point => rotatePoint({ centre }, point);

  const symmetric = new Set(half.zones.filter((zone) => acrossCentre(zone, centre, [left, bottom, right, top])).map((zone) => zone.id));
  const zonePartners = new Map(half.zones.map((zone) => [zone.id, symmetric.has(zone.id) ? zone.id : rotatedId(zone.id)]));
  const partner = (zoneId: string): string => zonePartners.get(zoneId) ?? zoneId;
  const rotatedFrom = new Map<string, string>();
  const symmetry: Rot180 = { centre, zonePartners, rotatedFrom };

  // Zones have their own names; ramps, terrain objects and placements share `rotatedFrom`, so one name list.
  const refuseCopyNames = (ids: readonly string[]): void => {
    const taken = new Set(ids);
    for (const id of ids) {
      if (taken.has(rotatedId(id))) throw new Error(`The id ${rotatedId(id)} is the name the rotation gives ${id}'s copy; rename it`);
    }
  };
  refuseCopyNames(half.zones.map((zone) => zone.id));
  refuseCopyNames([...half.ramps, ...half.terrainObjects, ...half.placements].map((item) => item.id));

  for (const zone of half.zones) {
    for (const connection of zone.connections) {
      if (connection.type === "bridge") {
        throw new Error(`Zone ${zone.id}'s bridge to ${connection.toZoneId}: a melee map can't rotate a bridge yet; use a ramp`);
      }
      if (connection.type === "ramp" && symmetric.has(zone.id) && symmetric.has(connection.toZoneId)) {
        throw new Error(`The ramp between ${zone.id} and ${connection.toZoneId}, both across the centre, would be its own rotation, which no ramp can be; put one zone of the pair in the half`);
      }
    }
  }

  const turnConnection = (connection: Zone["connections"][number]): Zone["connections"][number] => ({
    ...connection,
    toZoneId: partner(connection.toZoneId),
    ...(connection.at ? { at: { ...connection.at, ...turn(connection.at) } } : {}),
  });

  const zones = half.zones.flatMap((zone): Zone[] => {
    if (symmetric.has(zone.id)) {
      // Its connections to the half reach the other half's copies too.
      const copies = zone.connections.filter((connection) => !symmetric.has(connection.toZoneId)).map(turnConnection);
      return [{ ...zone, connections: [...zone.connections, ...copies] }];
    }
    const polygon = zone.polygon.map((point) => ({ ...point, ...turn(point) }));
    const off = polygon.find((point) => point.x < 0 || point.y < 0 || point.x > half.mapSize.width || point.y > half.mapSize.height);
    if (off) throw new Error(`Zone ${zone.id} turned 180° about the centre (${centre.x}, ${centre.y}) runs off the map at (${off.x}, ${off.y}); keep the half inside the playable area`);
    const { region: _region, ...rest } = zone;
    const copy: Zone = {
      ...rest,
      id: partner(zone.id),
      polygon,
      connections: zone.connections.map(turnConnection),
      overlooks: zone.overlooks.map(partner),
    };
    return [zone, copy];
  });

  const ramps = half.ramps.flatMap((ramp) => {
    const copy = { ...ramp, id: rotatedId(ramp.id), zoneId: partner(ramp.zoneId), edge: ROTATED_EDGE[ramp.edge], offset: -ramp.offset };
    rotatedFrom.set(copy.id, ramp.id);
    return [ramp, copy];
  });

  const terrainObjects = half.terrainObjects.flatMap((object) => {
    // Two quarter turns about its centre vertex turn its stamp exactly round with it (stampVertices).
    return [object, { ...object, id: rotatedId(object.id), at: turn(object.at), rotation: (object.rotation + 2) % 4 }];
  });

  const placements = half.placements.flatMap((placement): MeleePlacement[] => {
    const named = { id: rotatedId(placement.id), zoneId: partner(placement.zoneId) };
    rotatedFrom.set(named.id, placement.id);
    if (!isResourceBase(placement)) return [placement, { ...placement, ...named, params: { ...placement.params, at: turn(placement.params.at) } }];
    // The town-hall spot turned exactly: `at` itself would snap onto the cell beside it. A base
    // overlapping its own copy fails the build's symmetry check (melee-checks.ts).
    const [x, y] = townHallSpot(placement.params.at);
    const at = turn({ x, y });
    const { facing } = placement.params;
    return [placement, { ...placement, ...named, params: { ...placement.params, at, ...(facing ? { facing: ROTATED_FACING[facing] as DiagonalFacing } : {}) } }];
  });

  const blueprint: MeleeMapBlueprint = {
    ...half,
    zones,
    ramps,
    terrainObjects,
    placements,
    // Player 1 at the half's start, Player 2 at its rotation.
    starts: half.starts.flatMap((id) => [id, rotatedId(id)]),
  };
  return { blueprint, symmetry };
}

/**
 * Whether the zone overlaps its own rotation, so lies across the centre: then it must be
 * symmetric (the same ground turned round), or the build fails naming it. Sampled in the playable
 * area (the margins round it differ, so only it turns onto itself) at cell centres and at the
 * 2-cell grid's corners, where the terrain reads the polygons.
 */
function acrossCentre(zone: Zone, centre: Point, [left, bottom, right, top]: readonly [number, number, number, number]): boolean {
  const turn = (point: Point): Point => rotatePoint({ centre }, point);
  const inside = (point: Point): boolean => containsPoint(zone.polygon, point);
  const samples: Point[] = [];
  for (let y = bottom; y < top; y++) for (let x = left; x < right; x++) samples.push({ x: x + 0.5, y: y + 0.5 });
  for (let y = bottom; y <= top; y += 2) for (let x = left; x <= right; x += 2) samples.push({ x, y });
  const overlaps = samples.some((point) => point.x % 1 !== 0 && inside(point) && inside(turn(point)));
  if (!overlaps) return false;
  const lopsided = samples.find((point) => inside(point) !== inside(turn(point)));
  if (lopsided) {
    const turned = turn(lopsided);
    const [have, lack] = inside(lopsided) ? [lopsided, turned] : [turned, lopsided];
    throw new Error(
      `Zone ${zone.id} lies across the centre (${centre.x}, ${centre.y}) but isn't symmetric under the 180° rotation: ` +
        `(${have.x}, ${have.y}) is in it and its rotation (${lack.x}, ${lack.y}) isn't. Make it the same turned round, or keep it to one half`,
    );
  }
  return true;
}
