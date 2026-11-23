// Extracts the mood mixture of every dressed place on the independent Exemplar Maps: which types an
// author used, in what roles and shares, how dense and how far apart, so a generator can make a new
// arrangement in the same mood rather than copy the layout (DL-07, DL-08, DL-15).
//
// A place is a cluster of doodads within 2.5 cells of each other (helpers other than point lights left
// out); clusters wider than one capture frame are split into 16x16-cell tiles. Places under 8 members
// are dropped. Each place lists the capture frames whose camera target is within 8 cells (or, from a place tour, the
// frame centred on it), for labelling.
//
//   npm run build && node packages/core/scripts/exemplar-analysis/mixtures.mjs [id ...] > <Style Pack>/exemplar-maps/mixtures.json   (from the Workspace root)
//
// The Style Pack is the Workspace's active one; its Exemplar Maps folder is where its manifest's
// exemplarMaps list sits (packages/plugin-style-antioch/exemplar-maps for this repo).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { researchArchiveDir } from "../../dist/capture/research-archive.js";
import { exemplarMapSources, loadWorkspace, stylePackFiles } from "../../dist/plugins/workspace.js";
import { loadMapPackage } from "../../dist/study/load-map-package.js";
import { studyDoodads } from "../../dist/study/measure-doodads.js";
import { workspaceRoot } from "../workspace-root.mjs";

// Captures and their 1000px frames are in the research archive SC2_RESEARCH_DIR names, never in the
// repo or the Style Pack. Without it every place would lose its frames, so it must be set.
const captureDir = path.join(researchArchiveDir(), "docs/research/exemplar-maps");
const workspace = await loadWorkspace(workspaceRoot());
const { exemplarDir } = stylePackFiles(workspace);
if (!exemplarDir) throw new Error("The Workspace's Style Pack lists no Exemplar Maps");
// One map per family of shared maps (episode-2-analysis.md, independence table).
const INDEPENDENT = ["1-1", "1-2", "1-4", "1-5", "1-7", "1-8", "2-0", "2-1", "2-2", "2-3", "2-4", "2-5", "2-6", "2-8", "3-0", "3-2", "3-3", "3-4", "3-5", "3-6", "3-7", "3-9", "3-10", "3-11"];
const only = process.argv.slice(2);
const ids = only.length ? only : INDEPENDENT;
// The active Style Pack's Exemplar Maps, with source maps from the machine config's exemplarMaps folder.
const exemplars = await exemplarMapSources(workspace);

const HIDDEN = /Curtain|Blocker|PlacementDoodad|^PathingBlocker|^SightBlocker/i;
const LIGHT = /^LightOmni|^LightSpot/i;
const RADIUS = 2.5;
const TILE = 16;
const MIN_SIZE = 8;
const SNAP = Math.PI / 4;
const r2 = (v) => Math.round(v * 100) / 100;

// Motifs: what a type is for, whatever its planet, so a mixture can be regenerated with another
// tileset's assets. First match wins; matched on the type name, so a few will be wrong.
const MOTIFS = [
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
// Moods: a place's story, read from its motif shares. Checked against frames (mixtures.md).
const MOODS = [
  ["battlefield", (m) => (m.carnage ?? 0) >= 0.15],
  ["infestation", (m) => (m.creep ?? 0) >= 0.2],
  ["military post", (m) => (m.military ?? 0) >= 0.15],
  ["lab", (m) => (m.lab ?? 0) >= 0.15],
  ["street", (m) => (m.civic ?? 0) >= 0.2],
  ["ruin", (m) => (m.wreck ?? 0) >= 0.15 || ((m.masonry ?? 0) >= 0.15 && (m.vegetation ?? 0) + (m.rock ?? 0) >= 0.3)],
  ["shrine", (m) => (m.masonry ?? 0) >= 0.2],
  ["industrial", (m) => (m.machinery ?? 0) + (m.cargo ?? 0) >= 0.25],
  ["built edge", (m) => (m.structure ?? 0) + (m.decal ?? 0) + (m.light ?? 0) >= 0.5],
  ["wild ground", () => true],
];
const moodOf = (motifs) => MOODS.find(([, test]) => test(motifs))[0];

const motifOf = (type) => MOTIFS.find(([, re]) => re.test(type))?.[0] ?? "other";

function clusters(ds) {
  const key = (x, y) => `${Math.floor(x / RADIUS)},${Math.floor(y / RADIUS)}`;
  const buckets = new Map();
  ds.forEach((d, i) => {
    const k = key(d.position.x, d.position.y);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(i);
  });
  const seen = new Uint8Array(ds.length);
  const out = [];
  for (let s = 0; s < ds.length; s++) {
    if (seen[s]) continue;
    const members = [s];
    seen[s] = 1;
    for (let h = 0; h < members.length; h++) {
      const { x, y } = ds[members[h]].position;
      const bx = Math.floor(x / RADIUS);
      const by = Math.floor(y / RADIUS);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const j of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
            if (seen[j]) continue;
            const p = ds[j].position;
            if ((p.x - x) ** 2 + (p.y - y) ** 2 <= RADIUS * RADIUS) {
              seen[j] = 1;
              members.push(j);
            }
          }
    }
    out.push(members.map((i) => ds[i]));
  }
  return out;
}

function splitWide(group) {
  const xs = group.map((d) => d.position.x);
  const ys = group.map((d) => d.position.y);
  if (Math.max(...xs) - Math.min(...xs) <= 18 && Math.max(...ys) - Math.min(...ys) <= 18) return [group];
  const tiles = new Map();
  for (const d of group) {
    const k = `${Math.floor(d.position.x / TILE)},${Math.floor(d.position.y / TILE)}`;
    if (!tiles.has(k)) tiles.set(k, []);
    tiles.get(k).push(d);
  }
  return [...tiles.values()];
}

function lightColour(type) {
  const m = type.match(/^Light(?:Omni|Spot)([A-Z][a-z]+)/);
  return m ? m[1] : "White";
}

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

function profile(members) {
  const visible = members.filter((d) => !LIGHT.test(d.type));
  const lights = members.filter((d) => LIGHT.test(d.type));
  const xs = members.map((d) => d.position.x);
  const ys = members.map((d) => d.position.y);
  const w = Math.max(...xs) - Math.min(...xs) + 1;
  const h = Math.max(...ys) - Math.min(...ys) + 1;

  // Roles: scatter is any type used 6 or more times, or a decal; anchors are types used once or twice
  // that aren't decals; the rest is fill.
  const byType = new Map();
  for (const d of visible) {
    if (!byType.has(d.type)) byType.set(d.type, []);
    byType.get(d.type).push(d);
  }
  const roles = { anchor: [], fill: [], scatter: [] };
  for (const [type, list] of byType) {
    const role = list[0].kind === "decal" || list.length >= 6 ? "scatter" : list.length <= 2 ? "anchor" : "fill";
    roles[role].push({ type, motif: motifOf(type), count: list.length, share: r2(list.length / visible.length) });
  }
  for (const r of Object.values(roles)) r.sort((a, b) => b.count - a.count);

  const nn = visible.map((d, i) => {
    let best = Infinity;
    for (let j = 0; j < visible.length; j++) {
      if (j === i) continue;
      const dd = Math.hypot(visible[j].position.x - d.position.x, visible[j].position.y - d.position.y);
      if (dd < best) best = dd;
    }
    return best;
  }).filter(Number.isFinite);
  const snapped = visible.filter((d) => Math.abs(((d.yaw % SNAP) + SNAP) % SNAP) < 0.02 || Math.abs((((d.yaw % SNAP) + SNAP) % SNAP) - SNAP) < 0.02);
  const scales = visible.map((d) => d.scale.z);
  const manip = new Map();
  for (const d of visible) for (const m of d.manipulations) manip.set(m, (manip.get(m) ?? 0) + 1);
  const colours = new Map();
  for (const d of lights) colours.set(lightColour(d.type), (colours.get(lightColour(d.type)) ?? 0) + 1);
  const motifs = new Map();
  for (const d of visible) motifs.set(motifOf(d.type), (motifs.get(motifOf(d.type)) ?? 0) + 1);

  return {
    center: [r2(xs.reduce((a, b) => a + b, 0) / xs.length), r2(ys.reduce((a, b) => a + b, 0) / ys.length)],
    size: [r2(w), r2(h)],
    visible: visible.length,
    distinctTypes: byType.size,
    perHundredCells: r2((visible.length / (w * h)) * 100),
    spacing: { median: nn.length ? r2(median(nn)) : null },
    motifs: Object.fromEntries([...motifs].sort((a, b) => b[1] - a[1]).map(([k, n]) => [k, r2(n / visible.length)])),
    roles,
    yawSnapped45: visible.length ? r2(snapped.length / visible.length) : null,
    scale: scales.length ? [r2(Math.min(...scales)), r2(Math.max(...scales))] : null,
    manipulations: Object.fromEntries([...manip].map(([m, n]) => [m, r2(n / visible.length)])),
    lights: { count: lights.length, colours: Object.fromEntries(colours) },
  };
}

// The tours to take frames from: every place tour (stops at place centres; a map lit by zone has one
// per lighting) when the map has any, else its first grid tour. Stops are read from the full-size
// captures/ in the research archive, else from its frames/; frame paths always point into frames/
// (relative to the archive's docs/research/exemplar-maps).
function stopsFor(id) {
  const sources = [[captureDir, "captures"], [captureDir, "frames"]];
  for (const [base, sub] of sources) {
    const dir = path.join(base, id, sub);
    if (!existsSync(dir)) continue;
    const tours = readdirSync(dir).filter((t) => existsSync(path.join(dir, t, "stops.txt"))).sort();
    const placeTours = tours.filter((t) => t.startsWith("places"));
    const use = placeTours.length ? placeTours : tours.slice(0, 1);
    if (!use.length) continue;
    const stops = use.flatMap((tour) =>
      readFileSync(path.join(dir, tour, "stops.txt"), "utf8")
        .trim()
        .split("\n")
        .map((l) => l.split(/\s+/).map(Number))
        .map(([n, x, y]) => ({ tour, n, x, y })),
    );
    return { stops, places: placeTours.length > 0 };
  }
  return null;
}

const out = [];
for (const id of ids) {
  const e = exemplars.find((x) => x.id === id);
  const map = loadMapPackage(e.source);
  const ds = studyDoodads(map).filter((d) => !HIDDEN.test(d.type));
  const caps = stopsFor(id);
  if (!caps) console.error(`${id}: no captures or frames in ${captureDir}; its places list no frames`);
  const places = clusters(ds)
    .flatMap(splitWide)
    .filter((g) => g.filter((d) => !LIGHT.test(d.type)).length >= MIN_SIZE)
    .map((g) => {
      const p = profile(g);
      if (caps) {
        const near = caps.stops
          .map((s) => ({ ...s, d: Math.hypot(s.x - p.center[0], s.y - p.center[1]) }))
          .sort((a, b) => a.d - b.d)
          .slice(0, caps.places ? 1 : 2)
          .filter((s) => s.d <= (caps.places ? 1 : 8));
        p.frames = near.map((s) => `${id}/frames/${s.tour}/${String(s.n).padStart(3, "0")}.jpg`);
      }
      return { map: id, mood: moodOf(p.motifs), ...p };
    })
    .sort((a, b) => b.visible - a.visible);
  out.push(...places);
  console.error(`${id}: ${places.length} places`);
}
// The library: per mood, the typical mixture and, per motif, the types each map used for it.
const quart = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? [s[Math.floor(s.length / 4)], s[Math.floor(s.length / 2)], s[Math.floor((3 * s.length) / 4)]].map(r2) : null;
};
const moods = {};
for (const [mood] of MOODS) {
  const ps = out.filter((p) => p.mood === mood);
  if (!ps.length) continue;
  const motifShare = {};
  for (const p of ps) for (const k of Object.keys(p.motifs)) motifShare[k] = true;
  const pools = {};
  for (const p of ps)
    for (const r of Object.values(p.roles))
      for (const t of r) {
        pools[t.motif] ??= {};
        pools[t.motif][p.map] ??= {};
        pools[t.motif][p.map][t.type] = (pools[t.motif][p.map][t.type] ?? 0) + t.count;
      }
  const colours = {};
  for (const p of ps) for (const [c, n] of Object.entries(p.lights.colours)) colours[c] = (colours[c] ?? 0) + n;
  moods[mood] = {
    places: ps.length,
    maps: [...new Set(ps.map((p) => p.map))],
    motifs: Object.fromEntries(
      Object.keys(motifShare)
        .map((k) => [k, quart(ps.map((p) => p.motifs[k] ?? 0))])
        .filter(([, q]) => q[2] > 0)
        .sort((a, b) => b[1][1] - a[1][1] || b[1][2] - a[1][2]),
    ),
    visible: quart(ps.map((p) => p.visible)),
    distinctTypes: quart(ps.map((p) => p.distinctTypes)),
    anchors: quart(ps.map((p) => p.roles.anchor.length)),
    perHundredCells: quart(ps.map((p) => p.perHundredCells)),
    spacing: quart(ps.map((p) => p.spacing.median).filter((v) => v != null)),
    yawSnapped45: quart(ps.map((p) => p.yawSnapped45)),
    lightsPerPlace: quart(ps.map((p) => p.lights.count)),
    lightColours: colours,
    pools: Object.fromEntries(
      Object.entries(pools).map(([motif, byMap]) => [
        motif,
        Object.fromEntries(Object.entries(byMap).map(([m, types]) => [m, Object.entries(types).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `${t} ${n}`)])),
      ]),
    ),
    examples: ps.filter((p) => p.frames?.length).slice(0, 6).map((p) => ({ map: p.map, center: p.center, frames: p.frames })),
  };
}
const places = out.map((p) => ({
  map: p.map,
  mood: p.mood,
  center: p.center,
  size: p.size,
  visible: p.visible,
  motifs: p.motifs,
  top: [...p.roles.anchor.slice(0, 3), ...p.roles.fill.slice(0, 3), ...p.roles.scatter.slice(0, 3)].map((t) => `${t.type} ${t.count}`),
  ...(p.frames?.length ? { frames: p.frames } : {}),
}));
console.log(JSON.stringify({ generated: new Date().toISOString().slice(0, 10), maps: ids, moods, places }, null, 1));
