// Place-finding: an Exemplar Map's dressed places and what each is made of (which types an author
// used, in what roles and shares, how dense and how far apart), so a generator can make a new
// arrangement in the same mood rather than copy the layout.
//
// A place is a cluster of doodads within 2.5 cells of each other (helpers other than point lights
// left out); clusters wider than one capture frame are split into 16x16-cell tiles. Places under 8
// visible members are dropped. A place has a mood only when the caller passes mood rules: moods are a
// Style Pack's own, not core's.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { StudiedDoodad } from "./measure-doodads.js";
import { round } from "./stats.js";

/** Helpers that never show in game: left out of places. */
const HIDDEN = /Curtain|Blocker|PlacementDoodad|^PathingBlocker|^SightBlocker/i;
/** Point lights: kept in a place, but not counted as its visible members. */
const LIGHT = /^LightOmni|^LightSpot/i;
const RADIUS = 2.5;
/** A cluster wider than this, either way, is wider than one capture frame. */
const FRAME_SPAN = 18;
const TILE = 16;
const MIN_SIZE = 8;
const SNAP = Math.PI / 4;
const r2 = (v: number) => round(v, 2);

// Motifs: what a type is for, whatever its planet, so a mixture can be regenerated with another
// tileset's assets. First match wins; matched on the type name, so a few will be wrong.
const MOTIFS: readonly (readonly [string, RegExp])[] = [
  ["carnage", /Corpse|Carcass|Blood|Bone|Ragdoll|Skeleton|Bodybag|Death|Drained|Petrified|Fossil|Crow|FlySwarm|Yeti/],
  ["fire", /Fire|Smoke|Ember|Lava|ElectricalArcs|Lightning/],
  ["wreck", /RuinedShips|Cockpit|WingPiece|Hanger_Bay|Wreck|Destroyed|Broken|Debris|Rubble|Scrap|Junk|Crack|Crater|Blast|Torn|Abandoned|Collaps|Garbage|Trash|Dumpster|Glass_Splat|MeteorImpact/],
  ["military", /Gun|Rocket|Missile|Stationary|Siege|Goliath|Dragoon|Reaver|Target|Killwall|Military|Barracks|Sandbag|Fidgeting|Probe/],
  ["creep", /Creep|Zerg|^Char(?!Crystal|Floor)|Combs|TIM|Blister|Spore|Worm/],
  ["lab", /Monitor|Console|Terminal|Lab|Stasis|Display|Holo|Workstation|Screen|Camera|Cabinet|Flask|TestTube|PrisonCell|HoldingPen|Lightboard|Containment/],
  ["civic", /Bench|StoreFront|Billboard|Sign|Streetlight|Car(s|$)|Truck|Vehicle|Mono|Furniture|Couch|Table|Book|Game_|Carpet|Banister|Coffee|Hut|Garage|Flag|Podium|GroundProps|GroundMix|Tires|Mengsk|MarineStatue|Topiary|Chef|Outhouse|Bar$|Fuel|Resort|Downtown|Interior|Vase|Portrait|Wraith|Wolf|Subway|Charger|Station$|Panda|Fish|Eel|Small_Props|SeaShell|Palmtree|Birds/],
  ["cargo", /Crate|Container|Supplies|Pallete|Cart|Storage|Barrel|Palette|Equipment|Misc/],
  ["machinery", /Pipe|Piping|Protector|RepairBay|Cable|Hose|Vent|Fan|Generator|Reactor|Turbine|Conduit|Power|Tank|Crane|Welder|Factory|Girder|Scaffold|Mechanism|Conveyor|Exhaust|Dock|Antenna|Radar|Solar|Steam|Compactor|Coolant|Arm$|Beam\d?$|Bullhorn|Mining/],
  ["light", /Light|Lantern|Strobe|Floodlight|Searchlight|Alarm|Fireflies/],
  ["masonry", /Brick|Temple|Column|Pillar|Arch|Statue|Shrine|Obelisk|Monlyth|Sarcophag|Altar|Brazier|Banner|Inlay|Reliquary|Sanctum|Summoning|Spout|Facades|Tower|City_Structure|Buildings?|ZhakulDas|Pyramid|Spires?$|Hex/],
  ["structure", /Curb|Trim|Tarmac|Pad|Road|Railing|Wall|Gate|Door|Fence|Plates?|Plating|Platform|Floor|Deck|Bridge|Ramp|Barrier|Entrance|Roof|Hull|Window|Ornate|Skybox|Matrix|Core|Overpass|SkyScrapers|Building/],
  ["vegetation", /Tree|Foliage|Bush|Brush|Plant|Vine|Bramble|Grass|Flower|Underbrush|Crops|Weeds|Overgrowth|GroundCover|Tendril|Log|Cactus|Fauna|Leaves/],
  ["weather", /Snow|Ice(?!World)|Fog|Mist|Rain|Wind|Cloud|Water|River|Gust|Dust|Drift|Air$/],
  ["rock", /Rock|Stone|Crystal|Spire|Glacier|Cliff|GapFiller|Icicle|Formation/],
  ["decal", /Decal|Splat|Crack|Sludge|Arrow|GroundScar/],
];

/** A type's motif, from its name: what it is for, whatever its planet; "other" when none matches. */
export const motifOf = (type: string): string => MOTIFS.find(([, re]) => re.test(type))?.[0] ?? "other";

export type PlaceRole = "anchor" | "fill" | "scatter";
export type RoleEntry = { readonly type: string; readonly motif: string; readonly count: number; readonly share: number };

export type Place = {
  readonly map: string;
  /** Set only by the caller's mood rules. */
  readonly mood?: string;
  readonly center: readonly [number, number];
  readonly size: readonly [number, number];
  /** Members other than point lights. */
  readonly visible: number;
  readonly distinctTypes: number;
  readonly perHundredCells: number;
  /** The median distance from each visible member to its nearest neighbour. */
  readonly spacing: { readonly median: number | null };
  /** Each motif's share of the visible members, largest first. */
  readonly motifs: Readonly<Record<string, number>>;
  /** Scatter: a type used 6 or more times, or a decal; anchor: a type used once or twice; the rest is fill. */
  readonly roles: Readonly<Record<PlaceRole, readonly RoleEntry[]>>;
  /** The share of visible members whose yaw is snapped to 45 degrees. */
  readonly yawSnapped45: number | null;
  readonly scale: readonly [number, number] | null;
  readonly manipulations: Readonly<Record<string, number>>;
  readonly lights: { readonly count: number; readonly colours: Readonly<Record<string, number>> };
  /**
   * The frames near the place, when the caller passed its capture stops: paths relative to the
   * `captureDir` given to `readCaptureStops`, always under `<map>/frames/`.
   */
  readonly frames?: readonly string[];
};

function clusters(ds: readonly StudiedDoodad[]): StudiedDoodad[][] {
  const key = (x: number, y: number) => `${Math.floor(x / RADIUS)},${Math.floor(y / RADIUS)}`;
  const buckets = new Map<string, number[]>();
  ds.forEach((d, i) => {
    const k = key(d.position.x, d.position.y);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(i);
  });
  const seen = new Uint8Array(ds.length);
  const out: StudiedDoodad[][] = [];
  for (let s = 0; s < ds.length; s++) {
    if (seen[s]) continue;
    const members = [s];
    seen[s] = 1;
    for (let h = 0; h < members.length; h++) {
      const { x, y } = ds[members[h]!]!.position;
      const bx = Math.floor(x / RADIUS);
      const by = Math.floor(y / RADIUS);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const j of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
            if (seen[j]) continue;
            const p = ds[j]!.position;
            if ((p.x - x) ** 2 + (p.y - y) ** 2 <= RADIUS * RADIUS) {
              seen[j] = 1;
              members.push(j);
            }
          }
    }
    out.push(members.map((i) => ds[i]!));
  }
  return out;
}

/** Max minus min, with a loop: a map-wide cluster is too big to spread into Math.max. */
function extent(values: readonly number[]): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return hi - lo;
}

/** A cluster wider than one capture frame, split into 16x16-cell tiles. */
function splitWide(group: StudiedDoodad[]): StudiedDoodad[][] {
  if (extent(group.map((d) => d.position.x)) <= FRAME_SPAN && extent(group.map((d) => d.position.y)) <= FRAME_SPAN) return [group];
  const tiles = new Map<string, StudiedDoodad[]>();
  for (const d of group) {
    const k = `${Math.floor(d.position.x / TILE)},${Math.floor(d.position.y / TILE)}`;
    if (!tiles.has(k)) tiles.set(k, []);
    tiles.get(k)!.push(d);
  }
  return [...tiles.values()];
}

function lightColour(type: string): string {
  const m = type.match(/^Light(?:Omni|Spot)([A-Z][a-z]+)/);
  return m ? m[1]! : "White";
}

const median = (a: readonly number[]): number | null => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)]!;
};

const increment = (counts: Map<string, number>, key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);

function profile(map: string, members: readonly StudiedDoodad[]): Place {
  const visible = members.filter((d) => !LIGHT.test(d.type));
  const lights = members.filter((d) => LIGHT.test(d.type));
  const xs = members.map((d) => d.position.x);
  const ys = members.map((d) => d.position.y);
  const w = extent(xs) + 1;
  const h = extent(ys) + 1;

  const byType = new Map<string, StudiedDoodad[]>();
  for (const d of visible) {
    if (!byType.has(d.type)) byType.set(d.type, []);
    byType.get(d.type)!.push(d);
  }
  const roles: Record<PlaceRole, RoleEntry[]> = { anchor: [], fill: [], scatter: [] };
  for (const [type, list] of byType) {
    const role: PlaceRole = list[0]!.kind === "decal" || list.length >= 6 ? "scatter" : list.length <= 2 ? "anchor" : "fill";
    roles[role].push({ type, motif: motifOf(type), count: list.length, share: r2(list.length / visible.length) });
  }
  for (const r of Object.values(roles)) r.sort((a, b) => b.count - a.count);

  const nn = visible
    .map((d, i) => {
      let best = Infinity;
      for (let j = 0; j < visible.length; j++) {
        if (j === i) continue;
        const dd = Math.hypot(visible[j]!.position.x - d.position.x, visible[j]!.position.y - d.position.y);
        if (dd < best) best = dd;
      }
      return best;
    })
    .filter(Number.isFinite);
  const offSnap = (yaw: number) => ((yaw % SNAP) + SNAP) % SNAP;
  const snapped = visible.filter((d) => Math.abs(offSnap(d.yaw)) < 0.02 || Math.abs(offSnap(d.yaw) - SNAP) < 0.02);
  const scales = visible.map((d) => d.scale.z);
  const manip = new Map<string, number>();
  for (const d of visible) for (const m of d.manipulations) increment(manip, m);
  const colours = new Map<string, number>();
  for (const d of lights) increment(colours, lightColour(d.type));
  const motifs = new Map<string, number>();
  for (const d of visible) increment(motifs, motifOf(d.type));

  return {
    map,
    center: [r2(xs.reduce((a, b) => a + b, 0) / xs.length), r2(ys.reduce((a, b) => a + b, 0) / ys.length)],
    size: [r2(w), r2(h)],
    visible: visible.length,
    distinctTypes: byType.size,
    perHundredCells: r2((visible.length / (w * h)) * 100),
    spacing: { median: nn.length ? r2(median(nn)!) : null },
    motifs: Object.fromEntries([...motifs].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, r2(n / visible.length)])),
    roles,
    yawSnapped45: visible.length ? r2(snapped.length / visible.length) : null,
    scale: scales.length ? [r2(scales.reduce((a, b) => Math.min(a, b))), r2(scales.reduce((a, b) => Math.max(a, b)))] : null,
    manipulations: Object.fromEntries([...manip].map(([m, n]) => [m, r2(n / visible.length)])),
    lights: { count: lights.length, colours: Object.fromEntries(colours) },
  };
}

/** A Style Pack's mood: a place has it when `test` passes on the place's motif shares. */
export type MoodRule = { readonly name: string; readonly test: (motifs: Readonly<Record<string, number>>) => boolean };

export type FindPlacesOptions = {
  /** Checked in order; a place takes the first that passes, and has no mood when none does. */
  readonly moods?: readonly MoodRule[];
  /** The map's capture stops (`readCaptureStops`): each place then lists the frames near it. */
  readonly stops?: CaptureStops;
};

/** One stop of a capture tour: frame `n` of `tour`, its camera on (x, y). */
export type CaptureStop = { readonly tour: string; readonly n: number; readonly x: number; readonly y: number };
/** The stops a map's frames are taken from; `placeTours` when they are place tours, stopping at place centres. */
export type CaptureStops = { readonly stops: readonly CaptureStop[]; readonly placeTours: boolean };

/**
 * The stops of one map's tours under `captureDir` (`<captureDir>/<map>/captures/<tour>/stops.txt`,
 * else the same under `frames/`): every place tour when the map has any (a map lit by zone has one
 * per lighting), else its first grid tour. Undefined when the map has no tours.
 */
export function readCaptureStops(captureDir: string, map: string): CaptureStops | undefined {
  for (const sub of ["captures", "frames"]) {
    const dir = path.join(captureDir, map, sub);
    if (!existsSync(dir)) continue;
    const tours = readdirSync(dir)
      .filter((t) => existsSync(path.join(dir, t, "stops.txt")))
      .sort();
    const placeTours = tours.filter((t) => t.startsWith("places"));
    const use = placeTours.length ? placeTours : tours.slice(0, 1);
    if (!use.length) continue;
    const stops = use.flatMap((tour) =>
      readFileSync(path.join(dir, tour, "stops.txt"), "utf8")
        .trim()
        .split("\n")
        .map((line) => line.trim().split(/\s+/).map(Number))
        .filter(([n, x, y]) => [n, x, y].every(Number.isFinite))
        .map(([n, x, y]) => ({ tour, n: n!, x: x!, y: y! })),
    );
    return { stops, placeTours: placeTours.length > 0 };
  }
  return undefined;
}

/**
 * The frames near a place, as paths under the captures folder (`<map>/frames/<tour>/<nnn>.jpg`):
 * from a place tour, the stop within a cell of its centre; from a grid tour, the two nearest within 8 cells.
 */
function framesNear(map: string, center: readonly [number, number], { stops, placeTours }: CaptureStops): string[] {
  return stops
    .map((s) => ({ ...s, d: Math.hypot(s.x - center[0], s.y - center[1]) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, placeTours ? 1 : 2)
    .filter((s) => s.d <= (placeTours ? 1 : 8))
    .map((s) => `${map}/frames/${s.tour}/${String(s.n).padStart(3, "0")}.jpg`);
}

/** The dressed places among one map's doodads (from `studyDoodads`), largest first. */
export function findPlaces(map: string, doodads: readonly StudiedDoodad[], options: FindPlacesOptions = {}): Place[] {
  return clusters(doodads.filter((d) => !HIDDEN.test(d.type)))
    .flatMap(splitWide)
    .filter((g) => g.filter((d) => !LIGHT.test(d.type)).length >= MIN_SIZE)
    .map((g) => {
      const found = profile(map, g);
      const place = options.stops ? { ...found, frames: framesNear(map, found.center, options.stops) } : found;
      const mood = options.moods?.find((rule) => rule.test(place.motifs))?.name;
      return mood === undefined ? place : { ...place, mood };
    })
    .sort((a, b) => b.visible - a.visible);
}

/** Lower quartile, median and upper quartile. */
type Quartiles = readonly [number, number, number];

const quartiles = (a: readonly number[]): Quartiles | null => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? [r2(s[Math.floor(s.length / 4)]!), r2(s[Math.floor(s.length / 2)]!), r2(s[Math.floor((3 * s.length) / 4)]!)] : null;
};

/** One mood's typical mixture across the places that have it. */
export type MoodMixture = {
  readonly places: number;
  readonly maps: readonly string[];
  /** Each motif's share quartiles, by median then upper quartile, motifs no place uses left out. */
  readonly motifs: Readonly<Record<string, Quartiles>>;
  readonly visible: Quartiles | null;
  readonly distinctTypes: Quartiles | null;
  readonly anchors: Quartiles | null;
  readonly perHundredCells: Quartiles | null;
  readonly spacing: Quartiles | null;
  readonly yawSnapped45: Quartiles | null;
  readonly lightsPerPlace: Quartiles | null;
  readonly lightColours: Readonly<Record<string, number>>;
  /** Per motif, per map, the types it used for that motif (up to 8, "<type> <count>"). */
  readonly pools: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  /** Up to six places with frames. */
  readonly examples: readonly { readonly map: string; readonly center: readonly [number, number]; readonly frames: readonly string[] }[];
};

/** A place as the mixtures list it: where, how big, its motifs and its top three types per role. */
export type PlaceSummary = Pick<Place, "map" | "mood" | "center" | "size" | "visible" | "motifs" | "frames"> & { readonly top: readonly string[] };

function moodMixture(ps: readonly Place[]): MoodMixture {
  const motifNames = new Set(ps.flatMap((p) => Object.keys(p.motifs)));
  const pools: Record<string, Record<string, Record<string, number>>> = {};
  for (const p of ps)
    for (const r of Object.values(p.roles))
      for (const t of r) {
        const byMap = (pools[t.motif] ??= {});
        const types = (byMap[p.map] ??= {});
        types[t.type] = (types[t.type] ?? 0) + t.count;
      }
  const colours: Record<string, number> = {};
  for (const p of ps) for (const [c, n] of Object.entries(p.lights.colours)) colours[c] = (colours[c] ?? 0) + n;
  return {
    places: ps.length,
    maps: [...new Set(ps.map((p) => p.map))],
    motifs: Object.fromEntries(
      [...motifNames]
        .map((k) => [k, quartiles(ps.map((p) => p.motifs[k] ?? 0))!] as const)
        .filter(([, q]) => q[2] > 0)
        .sort((a, b) => b[1][1] - a[1][1] || b[1][2] - a[1][2]),
    ),
    visible: quartiles(ps.map((p) => p.visible)),
    distinctTypes: quartiles(ps.map((p) => p.distinctTypes)),
    anchors: quartiles(ps.map((p) => p.roles.anchor.length)),
    perHundredCells: quartiles(ps.map((p) => p.perHundredCells)),
    spacing: quartiles(ps.flatMap((p) => (p.spacing.median == null ? [] : [p.spacing.median]))),
    yawSnapped45: quartiles(ps.flatMap((p) => (p.yawSnapped45 == null ? [] : [p.yawSnapped45]))),
    lightsPerPlace: quartiles(ps.map((p) => p.lights.count)),
    lightColours: colours,
    pools: Object.fromEntries(
      Object.entries(pools).map(([motif, byMap]) => [
        motif,
        Object.fromEntries(
          Object.entries(byMap).map(([m, types]) => [
            m,
            Object.entries(types)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 8)
              .map(([t, n]) => `${t} ${n}`),
          ]),
        ),
      ]),
    ),
    examples: ps.flatMap((p) => (p.frames?.length ? [{ map: p.map, center: p.center, frames: p.frames }] : [])).slice(0, 6),
  };
}

/**
 * A Style Pack's mixtures from its places: per mood, in `moods` order, the typical mixture of the
 * places that have it (a mood with none is left out), and every place in brief.
 */
export function buildMixtures(places: readonly Place[], moods: readonly string[]): { moods: Record<string, MoodMixture>; places: PlaceSummary[] } {
  const library: Record<string, MoodMixture> = {};
  for (const mood of moods) {
    const ps = places.filter((p) => p.mood === mood);
    if (ps.length) library[mood] = moodMixture(ps);
  }
  return {
    moods: library,
    places: places.map((p) => ({
      map: p.map,
      ...(p.mood === undefined ? {} : { mood: p.mood }),
      center: p.center,
      size: p.size,
      visible: p.visible,
      motifs: p.motifs,
      top: [...p.roles.anchor.slice(0, 3), ...p.roles.fill.slice(0, 3), ...p.roles.scatter.slice(0, 3)].map((t) => `${t.type} ${t.count}`),
      ...(p.frames?.length ? { frames: p.frames } : {}),
    })),
  };
}
