// Annotated top-down SVG preview of a Mission Blueprint: the shared sketchpad for agreeing a
// mission's geography before terrain is compiled (Co-design Stage 2, the geography sketch). Deterministic, so it
// can be golden-tested and diffed. North is up, as in the Editor (SC2's y axis points up).

import { blueprintCatalog } from "../catalog/catalog-layer.js";
import { getDoodad } from "../catalog/stock-catalog.js";
import { isPlaced, type MissionBlueprint, SetPieceParamsSchema } from "../domain/mission-blueprint.js";
import { buildLayoutModel } from "../layout/layout-model.js";
import { encounterStartZoneId } from "../layout/threats.js";
import { assumedPlayableBounds } from "../map/map-bounds.js";
import { boundsPlan } from "../triggers/beat-bounds.js";
import { previewRamps } from "../terrain/rasterize.js";
import { rampOutline } from "../terrain/ramps.js";

/** Pixels per map cell. */
const SCALE = 6;
const MARGIN = 28;
/** Legend below the map: a title line, then swatch rows in columns. */
const LEGEND_HEIGHT = 112;
const LEGEND_ROWS = 5;
const LEGEND_COLUMN = 180;

/** Fill per cliff level: 0 pit, 1 ground, then darker browns each level up to 15. */
const ELEVATION_FILL = ["#5b4a6b", "#d9d2bd", "#b9a37d", "#937a57", "#6f5a3f", ...higherFills(11)];
/** Elevation names in the legend; the others are "level N". */
const ELEVATION_NAME = ["pit", "ground", "raised", "high"];

/** Fills for levels 5 and up: from level 4's brown to a near-black, evenly. */
function higherFills(count: number): string[] {
  const from = [0x6f, 0x5a, 0x3f];
  const to = [0x24, 0x1c, 0x12];
  return Array.from({ length: count }, (_, i) => {
    const t = (i + 1) / count;
    return `#${from.map((c, k) => Math.round(c + t * (to[k]! - c)).toString(16).padStart(2, "0")).join("")}`;
  });
}
const PLAYER_COLOR: Record<number, string> = { 0: "#8a8a8a", 1: "#2f7de1", 15: "#d23b3b" };
/** Line style per connection type: dash pattern and colour. */
const CONNECTION_STYLE: Record<string, { readonly dash: string; readonly color: string }> = {
  open: { dash: "6 4", color: "#222" },
  narrow: { dash: "2 3", color: "#222" },
  ramp: { dash: "", color: "#222" },
  rocks: { dash: "", color: "#8a5a2b" },
  collapsible: { dash: "4 2 1 2", color: "#c0612b" },
  bridge: { dash: "10 3", color: "#222" },
  "air-only": { dash: "1 4", color: "#2f7de1" },
};

type Point = { readonly x: number; readonly y: number };

const round = (value: number): number => Math.round(value * 10) / 10;
const xml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Polygon area centroid (falls back to the vertex mean for degenerate shapes). */
function centroid(polygon: readonly Point[]): Point {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!;
    const b = polygon[i]!;
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    return { x: polygon.reduce((s, p) => s + p.x, 0) / polygon.length, y: polygon.reduce((s, p) => s + p.y, 0) / polygon.length };
  }
  return { x: cx / (3 * area), y: cy / (3 * area) };
}

export function renderPreviewSvg(blueprint: MissionBlueprint): string {
  const { width, height } = blueprint.mapSize;
  const px = (point: Point): Point => ({ x: round(MARGIN + point.x * SCALE), y: round(MARGIN + (height - point.y) * SCALE) });
  const points = (polygon: readonly Point[]): string => polygon.map((p) => `${px(p).x},${px(p).y}`).join(" ");
  const mapWidth = width * SCALE;
  const mapHeight = height * SCALE;
  const svgWidth = MARGIN * 2 + mapWidth;
  const svgHeight = MARGIN * 2 + mapHeight + LEGEND_HEIGHT;
  const zoneById = new Map(blueprint.zones.map((zone) => [zone.id, zone]));
  const anchorById = new Map(blueprint.anchors.map((anchor) => [anchor.id, anchor]));
  const out: string[] = [];

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" font-family="Helvetica, Arial, sans-serif">`,
    `  <title>${xml(blueprint.title)}: layout preview</title>`,
    "  <defs>",
    '    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#222"/></marker>',
    '    <marker id="attack" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#d23b3b"/></marker>',
    "  </defs>",
    `  <rect width="${svgWidth}" height="${svgHeight}" fill="#ffffff"/>`,
    `  <rect x="${MARGIN}" y="${MARGIN}" width="${mapWidth}" height="${mapHeight}" fill="${ELEVATION_FILL[1]}" stroke="#444"/>`,
  );

  // Zones, filled by elevation, in blueprint order (later zones paint over earlier ones, as in the terrain).
  out.push('  <g id="zones">');
  for (const zone of blueprint.zones) {
    out.push(
      `    <polygon id="zone-${zone.id}" points="${points(zone.polygon)}" fill="${ELEVATION_FILL[zone.elevation] ?? ELEVATION_FILL[1]}" stroke="#5a5040" stroke-width="1"/>`,
    );
  }
  out.push("  </g>");

  // 16-cell grid with coordinates.
  out.push('  <g id="grid" stroke="#000" stroke-opacity="0.08" font-size="9" fill="#666">');
  for (let x = 0; x <= width; x += 16) {
    out.push(`    <line x1="${px({ x, y: 0 }).x}" y1="${MARGIN}" x2="${px({ x, y: 0 }).x}" y2="${MARGIN + mapHeight}"/>`);
    out.push(`    <text x="${px({ x, y: 0 }).x}" y="${MARGIN + mapHeight + 12}" text-anchor="middle" stroke="none">${x}</text>`);
  }
  for (let y = 0; y <= height; y += 16) {
    out.push(`    <line x1="${MARGIN}" y1="${px({ x: 0, y }).y}" x2="${MARGIN + mapWidth}" y2="${px({ x: 0, y }).y}"/>`);
    out.push(`    <text x="${MARGIN - 4}" y="${px({ x: 0, y }).y + 3}" text-anchor="end" stroke="none">${y}</text>`);
  }
  out.push("  </g>");

  // The playable area, MapInfo's (map-bounds.ts); then each bounds region a Beat sets (beat-bounds.ts), labelled.
  const [left, bottom, right, top] = assumedPlayableBounds(blueprint);
  const topLeft = px({ x: left, y: top });
  out.push(
    `  <rect id="camera-bounds" x="${topLeft.x}" y="${topLeft.y}" width="${(right - left) * SCALE}" height="${(top - bottom) * SCALE}" fill="none" stroke="#333" stroke-dasharray="8 6" stroke-opacity="0.5"/>`,
  );
  const beatBounds = boundsPlan(blueprint).regions;
  if (beatBounds.length > 0) {
    out.push('  <g id="beat-bounds" fill="none" stroke="#2a6fb0" stroke-opacity="0.6" font-size="9">');
    for (const region of beatBounds) {
      const [l, b, r, t] = region.rect;
      const corner = px({ x: l, y: t });
      const dash = region.source.role === "transition" ? ' stroke-dasharray="2 4"' : region.source.role === "playable" ? ' stroke-dasharray="10 3"' : "";
      out.push(`    <rect x="${corner.x}" y="${corner.y}" width="${round((r - l) * SCALE)}" height="${round((t - b) * SCALE)}"${dash}><title>${xml(region.name)}</title></rect>`);
      out.push(`    <text x="${corner.x + 3}" y="${corner.y + 10}" fill="#2a6fb0" stroke="none">${xml(region.name.replace(/^Bounds /, ""))}</text>`);
    }
    out.push("  </g>");
  }

  // Connections between zone centres, once per pair; anything but `open` is labelled with its type (and width).
  out.push('  <g id="connections" stroke-width="1.5" fill="none" stroke-opacity="0.7" font-size="9">');
  const seen = new Set<string>();
  for (const zone of blueprint.zones) {
    for (const connection of zone.connections) {
      const key = [zone.id, connection.toZoneId].sort().join("|");
      const other = zoneById.get(connection.toZoneId);
      if (seen.has(key) || !other) continue;
      seen.add(key);
      const a = px(centroid(zone.polygon));
      const b = px(centroid(other.polygon));
      const style = CONNECTION_STYLE[connection.type] ?? CONNECTION_STYLE.open!;
      const label = [connection.type, connection.width === undefined ? "" : String(connection.width)].filter(Boolean).join(" · ");
      out.push(
        `    <line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${style.color}" stroke-dasharray="${style.dash}"><title>${xml(label)}</title></line>`,
      );
      if (connection.type !== "open") {
        out.push(
          `    <text x="${round((a.x + b.x) / 2)}" y="${round((a.y + b.y) / 2 - 3)}" text-anchor="middle" fill="${style.color}" stroke="#fff" stroke-width="3" paint-order="stroke">${xml(label)}</text>`,
        );
      }
    }
  }
  out.push("  </g>");

  // Ramps where the compiler will stamp them, with an uphill arrow; ones that don't fit are listed.
  const { ramps, unplaced } = previewRamps(blueprint);
  out.push('  <g id="ramps">');
  ramps.forEach((ramp, index) => {
    const outline = rampOutline(ramp);
    const from = px(outline.from);
    const to = px(outline.to);
    out.push(
      `    <polygon id="ramp-${ramp.id ?? index}" points="${points(outline.corners)}" fill="#f2e3b3" stroke="#7a6230" stroke-width="1.5"/>`,
      `    <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#222" stroke-width="2" marker-end="url(#arrow)"/>`,
    );
  });
  unplaced.forEach((message, index) => {
    out.push(`    <text x="${MARGIN}" y="${MARGIN + 14 * (index + 1)}" fill="#b00020" stroke="#fff" stroke-width="3" paint-order="stroke">${xml(message)}</text>`);
  });
  out.push("  </g>");

  // Shelters (the safe ground from a Mechanic's Threat that fails the Mission, such as the flare's) and the victory zone.
  const shelters = new Set(
    blueprint.mechanics.length > 0
      ? buildLayoutModel(blueprint).threats().flatMap((threat) => (threat.source.kind === "Mechanic" && threat.consequence === "fail" ? threat.safety.zoneIds : []))
      : [],
  );
  const victoryZones = new Set(
    blueprint.outcomes.victory.flatMap((condition) => (condition.type === "anchorEntersZone" ? [condition.zoneId] : [])),
  );
  out.push('  <g id="highlights" fill="none">');
  for (const zone of blueprint.zones) {
    if (shelters.has(zone.id)) {
      out.push(`    <polygon points="${points(zone.polygon)}" stroke="#1f9e6b" stroke-width="3" stroke-dasharray="7 4"><title>shelter</title></polygon>`);
    }
    if (victoryZones.has(zone.id)) {
      out.push(`    <polygon points="${points(zone.polygon)}" stroke="#d4a017" stroke-width="3"><title>victory</title></polygon>`);
    }
  }
  out.push("  </g>");

  // Encounters: the outline of the Zone each starts in (encounterStartZoneId) and arrows from each attacker to it.
  out.push('  <g id="encounters">');
  for (const encounter of blueprint.encounters) {
    const zone = zoneById.get(encounterStartZoneId(blueprint, encounter));
    if (!zone) continue;
    const target = px(centroid(zone.polygon));
    out.push(`    <polygon points="${points(zone.polygon)}" fill="none" stroke="#d23b3b" stroke-width="2" stroke-dasharray="3 3"><title>encounter ${xml(encounter.id)}</title></polygon>`);
    for (const anchorId of encounter.attackerAnchorIds) {
      const anchor = anchorById.get(anchorId);
      if (!anchor || !isPlaced(anchor)) continue;
      const from = px(anchor.position);
      out.push(`    <line x1="${from.x}" y1="${from.y}" x2="${target.x}" y2="${target.y}" stroke="#d23b3b" stroke-width="1.2" stroke-opacity="0.7" marker-end="url(#attack)"/>`);
    }
  }
  out.push("  </g>");

  // Zone labels in each zone's top-left corner (units tend to sit at zone centres), with a halo.
  out.push('  <g id="zone-labels" font-size="11" fill="#222" stroke="#fff" stroke-width="3" paint-order="stroke">');
  for (const zone of blueprint.zones) {
    const corner = px({ x: Math.min(...zone.polygon.map((p) => p.x)), y: Math.max(...zone.polygon.map((p) => p.y)) });
    const flags = [shelters.has(zone.id) ? "shelter" : "", victoryZones.has(zone.id) ? "goal" : ""].filter(Boolean).join(", ");
    out.push(`    <text x="${corner.x + 4}" y="${corner.y + 13}" font-weight="bold">${xml(zone.name)}</text>`);
    const detail = [`level ${zone.elevation}`, zone.texture, flags].filter(Boolean).join(" · ");
    out.push(`    <text x="${corner.x + 4}" y="${corner.y + 24}" font-size="9">${xml(detail)}</text>`);
  }
  out.push("  </g>");

  // Set pieces: where each sits and how far it reaches, labelled with its id for review.
  const setPieces = blueprint.placements.filter((placement) => placement.kind === "set-piece");
  if (setPieces.length > 0) out.push('  <g id="set-pieces" font-size="10" fill="none" stroke="#6b3fa0" stroke-width="1.5" stroke-dasharray="4 3">');
  for (const placement of setPieces) {
    const params = SetPieceParamsSchema.parse(placement.params);
    const zone = blueprint.zones.find((z) => z.id === placement.zoneId)!;
    const centre = params.at ?? {
      x: zone.polygon.reduce((sum, p) => sum + p.x, 0) / zone.polygon.length,
      y: zone.polygon.reduce((sum, p) => sum + p.y, 0) / zone.polygon.length,
    };
    const c = px(centre);
    out.push(
      `    <circle id="set-piece-${placement.id}" cx="${c.x}" cy="${c.y}" r="${round(params.radius * SCALE)}"><title>${xml(`${placement.id}: ${params.story}`)}</title></circle>`,
      `    <text x="${c.x}" y="${c.y + 4}" text-anchor="middle" fill="#6b3fa0" stroke="#fff" stroke-width="3" stroke-dasharray="none" paint-order="stroke">${xml(placement.id)}</text>`,
    );
  }
  if (setPieces.length > 0) out.push("  </g>");

  // Anchors.
  out.push('  <g id="anchors" font-size="10" stroke-width="1">');
  // A Wave's unit's Anchor isn't on the map until its send; the preview draws placed ones.
  for (const anchor of blueprint.anchors.filter(isPlaced)) {
    const p = px(anchor.position);
    const title = `<title>${xml(`${anchor.kind} ${anchor.id}${anchor.unitType ? ` (${anchor.unitType})` : ""}${anchor.doodadType ? ` (${anchor.doodadType})` : ""}`)}</title>`;
    if (anchor.kind === "unit") {
      const color = PLAYER_COLOR[anchor.player ?? 0] ?? "#8a8a8a";
      out.push(
        `    <circle id="anchor-${anchor.id}" cx="${p.x}" cy="${p.y}" r="5" fill="${color}" stroke="#fff">${title}</circle>`,
        `    <text x="${p.x + 7}" y="${p.y + 3}" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke">${xml(anchor.name)}</text>`,
      );
    } else if (anchor.kind === "doodad") {
      const blocks = anchor.doodadType ? getDoodad(blueprintCatalog(blueprint), anchor.doodadType)?.blocksGround === true : false;
      out.push(
        blocks
          ? `    <rect id="anchor-${anchor.id}" x="${p.x - 2.5}" y="${p.y - 2.5}" width="5" height="5" fill="#4a3f33">${title}</rect>`
          : `    <circle id="anchor-${anchor.id}" cx="${p.x}" cy="${p.y}" r="2" fill="#6d6458">${title}</circle>`,
      );
    } else if (anchor.kind === "camera") {
      if (anchor.cameraTarget) {
        const t = px(anchor.cameraTarget);
        out.push(`    <line x1="${p.x}" y1="${p.y}" x2="${t.x}" y2="${t.y}" stroke="#7b4bd1" stroke-dasharray="4 3" marker-end="url(#arrow)"/>`);
      }
      out.push(`    <polygon id="anchor-${anchor.id}" points="${p.x},${p.y - 6} ${p.x + 5},${p.y + 4} ${p.x - 5},${p.y + 4}" fill="#7b4bd1" stroke="#fff">${title}</polygon>`);
    } else {
      out.push(`    <polygon id="anchor-${anchor.id}" points="${p.x},${p.y - 5} ${p.x + 5},${p.y} ${p.x},${p.y + 5} ${p.x - 5},${p.y}" fill="#e08a1e" stroke="#fff">${title}</polygon>`);
      out.push(`    <text x="${p.x + 7}" y="${p.y + 3}" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke">${xml(anchor.name)}</text>`);
    }
  }
  out.push("  </g>");

  // Legend, below the map.
  const legendTop = MARGIN * 2 + mapHeight + 4;
  const legend: string[] = [
    `    <text x="${MARGIN}" y="${legendTop}" font-weight="bold" font-size="13">${xml(blueprint.title)}` +
      `<tspan font-weight="normal" font-size="10" fill="#555"> · ${width}×${height} · ${xml(blueprint.tilesetId ?? "")}</tspan></text>`,
  ];
  let rowIndex = 0;
  const row = (swatch: string, label: string): void => {
    const x = MARGIN + Math.floor(rowIndex / LEGEND_ROWS) * LEGEND_COLUMN;
    const y = legendTop + 12 + (rowIndex % LEGEND_ROWS) * 18;
    legend.push(`    <g transform="translate(${x},${y})">${swatch}<text x="22" y="9">${xml(label)}</text></g>`);
    rowIndex++;
  };
  ELEVATION_NAME.forEach((name, level) => row(`<rect width="16" height="12" fill="${ELEVATION_FILL[level]}" stroke="#5a5040"/>`, `${name} (level ${level})`));
  // Levels above those the Zones use, in one row so the legend keeps its width: the lowest and highest fills side by side.
  const higher = blueprint.zones.map((zone) => zone.elevation).filter((level) => level >= ELEVATION_NAME.length);
  if (higher.length > 0) {
    const low = Math.min(...higher);
    const high = Math.max(...higher);
    row(
      `<rect width="8" height="12" fill="${ELEVATION_FILL[low]}"/><rect x="8" width="8" height="12" fill="${ELEVATION_FILL[high]}"/><rect width="16" height="12" fill="none" stroke="#5a5040"/>`,
      low === high ? `level ${low}` : `levels ${low}-${high}, darker each level`,
    );
  }
  row('<rect width="16" height="12" fill="#f2e3b3" stroke="#7a6230"/>', "ramp (arrow uphill)");
  row('<rect width="16" height="12" fill="none" stroke="#1f9e6b" stroke-width="2" stroke-dasharray="4 2"/>', "shelter");
  row('<rect width="16" height="12" fill="none" stroke="#d4a017" stroke-width="2"/>', "goal");
  row('<rect width="16" height="12" fill="none" stroke="#d23b3b" stroke-dasharray="3 3"/>', "encounter trigger");
  row('<line x1="0" y1="6" x2="16" y2="6" stroke="#222" stroke-dasharray="6 4"/>', "connection (labelled by type)");
  row(`<circle cx="8" cy="6" r="5" fill="${PLAYER_COLOR[1]}"/>`, "player unit");
  row(`<circle cx="8" cy="6" r="5" fill="${PLAYER_COLOR[15]}"/>`, "hostile unit");
  row('<rect x="5" y="3" width="6" height="6" fill="#4a3f33"/>', "doodad (blocks ground)");
  row('<circle cx="8" cy="6" r="2" fill="#6d6458"/>', "doodad");
  row('<polygon points="8,0 13,10 3,10" fill="#7b4bd1"/>', "camera");
  row('<polygon points="8,1 13,6 8,11 3,6" fill="#e08a1e"/>', "point");
  out.push('  <g id="legend" font-size="10" fill="#222">', ...legend, "  </g>");

  out.push("</svg>", "");
  return out.join("\n");
}
