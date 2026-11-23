// A cinematic set drawn from above: where its pieces sit, who stands where (with facing), and the
// cameras that film it, from its richest occurrence. Plus the README index of the whole catalog.
// The files give each piece's origin, not its size, so a set built from pieces sharing one origin
// (most story rooms) shows as one square; the marks and cameras carry the shape of the room.

import { displayChannels, type DisplayChannels } from "../catalog/display-channels.js";
import type { CinematicSet, SetOccurrence } from "./set-catalog.js";
import { CORE_SOURCE_KINDS, type CutsceneSourceKinds, sourceKind } from "./source-kinds.js";

const WIDTH = 760;
const PLAN = 520;
const MARGIN = 24;
/** Pieces further than this from where people stand are outside the room (backdrops, other shots). */
const CAMERA_REACH = 25;
/** The plan shows at least this many set units across. */
const FRAME_SPAN = 8;
/** Cameras are named on the plan when no more than this many are shown. */
const MAX_CAMERA_LABELS = 20;

const round = (value: number): number => Math.round(value * 10) / 10;
const xml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (current && current.length + 1 + word.length > max) {
      lines.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) lines.push(current);
  return lines;
}

/** "Blizzard: campaigns/swarm.sc2campaign/base.sc2data/Cutscenes/Zerg01.SC2Cutscene": the file, with its source kind's label. */
const sourceLabel = (kinds: CutsceneSourceKinds, occurrence: SetOccurrence): string => `${sourceKind(kinds, occurrence.origin).label}: ${occurrence.file}`;

/** "A", "A and B", "A, B and C". */
const listed = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/**
 * A set's screens, the models in it that show a render-to-texture channel (core's
 * data/display-channels.json), each with its channels; and its models the file doesn't list (not
 * read), which might be screens. A piece named by its file is no CModel the file could list, so it
 * isn't counted as not read.
 */
export function setScreens(set: CinematicSet, displays: DisplayChannels): { readonly screens: { readonly model: string; readonly channels: readonly number[] }[]; readonly unread: readonly string[] } {
  const byFile = new Set(set.occurrences.flatMap((occurrence) => occurrence.pieces.flatMap((piece) => (piece.modelPath ? [piece.model] : []))));
  const screens: { model: string; channels: readonly number[] }[] = [];
  const unread: string[] = [];
  for (const { model } of set.models) {
    const channels = displayChannels(displays, model);
    if (channels?.length) screens.push({ model, channels });
    else if (channels === undefined && !byFile.has(model)) unread.push(model);
  }
  return { screens, unread };
}

const channelsOf = (channels: readonly number[]): string => `channel${channels.length > 1 ? "s" : ""} ${channels.join(", ")}`;

/**
 * A set's plan from above, with its side panel. `displays` (core's data/display-channels.json)
 * names its screens and their channels.
 */
export function renderSetPlanSvg(set: CinematicSet, kinds: CutsceneSourceKinds = CORE_SOURCE_KINDS, displays: DisplayChannels = {}): string {
  const best = set.occurrences[0]!;
  // Frame the room on where people stand (or, with nobody, on its pieces), at least FRAME_SPAN
  // across. Cameras are clipped to it: many ride rigs, so their own position isn't where they film.
  const marks = best.marks.filter(
    (mark, index) => best.marks.findIndex((other) => other.name === mark.name && Math.hypot(other.at[0] - mark.at[0], other.at[1] - mark.at[1]) < 0.3) === index,
  );
  const anchor = marks.length ? marks.map((mark) => mark.at) : best.pieces.map((piece) => piece.at);
  const ax = anchor.reduce((sum, p) => sum + p[0], 0) / anchor.length;
  const ay = anchor.reduce((sum, p) => sum + p[1], 0) / anchor.length;
  const inRoom = (p: readonly number[]): boolean => Math.hypot(p[0]! - ax, p[1]! - ay) <= CAMERA_REACH;
  const framed = [...anchor, ...best.pieces.map((piece) => piece.at).filter(inRoom)];
  const xs = framed.map((p) => p[0]);
  const ys = framed.map((p) => p[1]);
  const pad = (low: number, high: number): [number, number] => {
    const middle = (low + high) / 2;
    const half = Math.max((high - low) / 2 + 1.5, FRAME_SPAN / 2);
    return [middle - half, middle + half];
  };
  const [x0, x1] = pad(Math.min(...xs), Math.max(...xs));
  const [y0, y1] = pad(Math.min(...ys), Math.max(...ys));
  const k = Math.min(PLAN / (x1 - x0), PLAN / (y1 - y0));
  const ox = MARGIN + (PLAN - (x1 - x0) * k) / 2;
  const oy = 70 + (PLAN - (y1 - y0) * k) / 2;
  const at = (x: number, y: number): [number, number] => [round(ox + (x - x0) * k), round(oy + (y1 - y) * k)];
  const out: string[] = [];

  out.push(
    `<clipPath id="plan"><rect x="${MARGIN}" y="70" width="${PLAN}" height="${PLAN}"/></clipPath>`,
    `<rect x="${MARGIN}" y="70" width="${PLAN}" height="${PLAN}" fill="#f4f2ee" stroke="#999"/>`,
    `<g clip-path="url(#plan)">`,
  );

  // Pieces, merged where they share an origin.
  const origins = new Map<string, { x: number; y: number; models: string[] }>();
  for (const piece of best.pieces) {
    const key = `${round(piece.at[0])},${round(piece.at[1])}`;
    const entry = origins.get(key) ?? { x: piece.at[0], y: piece.at[1], models: [] };
    entry.models.push(piece.model);
    origins.set(key, entry);
  }
  for (const { x, y, models } of origins.values()) {
    const [px, py] = at(x, y);
    const size = Math.min(14, 4 + models.length);
    out.push(`<rect x="${round(px - size / 2)}" y="${round(py - size / 2)}" width="${size}" height="${size}" fill="#b5ab98" stroke="#6d6458"><title>${xml(models.join(", "))}</title></rect>`);
    if (models.length > 1) out.push(`<text x="${round(px + size / 2 + 2)}" y="${round(py + 3)}" font-size="8" fill="#6d6458">${models.length}</text>`);
  }

  // Cameras: eye, a wedge toward the target, the name.
  const shown = best.cameras.filter((camera) => camera.target[0] >= x0 && camera.target[0] <= x1 && camera.target[1] >= y0 && camera.target[1] <= y1);
  for (const camera of shown) {
    const [ex, ey] = camera.eye;
    const [tx, ty] = camera.target;
    const heading = Math.atan2(ty - ey, tx - ex);
    const spread = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * (16 / 9));
    const reach = Math.min(Math.hypot(tx - ex, ty - ey), 1.5);
    const [px, py] = at(ex, ey);
    const [lx, ly] = at(ex + Math.cos(heading + spread) * reach, ey + Math.sin(heading + spread) * reach);
    const [rx, ry] = at(ex + Math.cos(heading - spread) * reach, ey + Math.sin(heading - spread) * reach);
    out.push(
      `<polygon points="${px},${py} ${lx},${ly} ${rx},${ry}" fill="#7b4bd1" fill-opacity="0.12" stroke="#7b4bd1" stroke-width="0.8"/>`,
      `<circle cx="${px}" cy="${py}" r="2.5" fill="#7b4bd1"><title>${xml(camera.name)}</title></circle>`,
    );
    // Past a handful the names pile up; hover a camera's eye for its name instead.
    if (shown.length <= MAX_CAMERA_LABELS) out.push(`<text x="${round(px + 4)}" y="${round(py - 3)}" font-size="8" fill="#5a3a9a">${xml(camera.name)}</text>`);
  }

  // Marks: a dot, a facing tick, the name.
  for (const mark of marks) {
    const [px, py] = at(mark.at[0], mark.at[1]);
    const angle = (mark.facing * Math.PI) / 180;
    out.push(
      `<line x1="${px}" y1="${py}" x2="${round(px + Math.cos(angle) * 10)}" y2="${round(py - Math.sin(angle) * 10)}" stroke="#2f7de1" stroke-width="1.5"/>`,
      `<circle cx="${px}" cy="${py}" r="4" fill="#2f7de1" stroke="#fff"><title>${xml(`${mark.name} (${mark.model})`)}</title></circle>`,
      `<text x="${round(px + 6)}" y="${round(py + 12)}" font-size="10" fill="#111" stroke="#fff" stroke-width="2.5" paint-order="stroke">${xml(mark.name)}</text>`,
    );
  }

  out.push("</g>");

  // Scale bar: one unit and five.
  const [s0x, s0y] = at(x0 + 0.5, y0 + 0.5);
  out.push(
    `<line x1="${s0x}" y1="${s0y}" x2="${round(s0x + 5 * k)}" y2="${s0y}" stroke="#333" stroke-width="2"/>`,
    `<line x1="${s0x}" y1="${s0y - 4}" x2="${s0x}" y2="${s0y + 4}" stroke="#333"/><line x1="${round(s0x + k)}" y1="${s0y - 4}" x2="${round(s0x + k)}" y2="${s0y + 4}" stroke="#333"/>`,
    `<text x="${s0x}" y="${s0y - 6}" font-size="9" fill="#333">5 units (tick: 1)</text>`,
  );

  // Side panel: where it's used, light, screens, models.
  const { screens, unread } = setScreens(set, displays);
  const side: string[] = [
    `${set.occurrences.length} file${set.occurrences.length === 1 ? "" : "s"}; drawn from:`,
    sourceLabel(kinds, best),
    ...(best.lights.length ? [`Light: ${best.lights.join(", ")}`] : []),
    ...(screens.length ? [`Screens: ${screens.map((screen) => `${screen.model} (${channelsOf(screen.channels)})`).join("; ")}`] : unread.length ? [`Screens: none known; not read: ${unread.join(", ")}`] : []),
    ...(best.rttFeeds.length ? [`Its file feeds displays from: ${best.rttFeeds.join(", ")}`] : []),
    `Marks: ${marks.length}; cameras: ${best.cameras.length} (${shown.length} aimed inside the plan; a camera on a rig is drawn where its node sits, which may not be where it films)`,
    "",
    "Models:",
    ...set.models.slice(0, 28).map((entry) => `${entry.model}${set.occurrences.length > 1 ? ` ×${entry.uses}` : ""}`),
    ...(set.models.length > 28 ? [`… and ${set.models.length - 28} more`] : []),
    "",
    "Also in:",
    ...set.occurrences.slice(1, 12).map((occurrence) => sourceLabel(kinds, occurrence)),
    ...(set.occurrences.length > 12 ? [`… and ${set.occurrences.length - 12} more`] : []),
  ].flatMap((line) => (line ? wrap(line, 34) : [""]));
  const sideX = MARGIN + PLAN + 16;
  side.forEach((line, index) => out.push(`<text x="${sideX}" y="${84 + index * 12}" font-size="9" fill="#333">${xml(line)}</text>`));

  const height = Math.max(70 + PLAN + MARGIN, 84 + side.length * 12 + MARGIN);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" font-family="Helvetica, Arial, sans-serif">`,
    `<title>${xml(set.name)}: cinematic set</title>`,
    `<rect width="${WIDTH}" height="${height}" fill="#fff"/>`,
    `<text x="${MARGIN}" y="34" font-size="18" font-weight="bold" fill="#111">${xml(set.name)}</text>`,
    `<text x="${MARGIN}" y="54" font-size="10" fill="#666">${xml(`${set.id} · top-down, +y up · squares: piece origins (count) · blue: marks with facing · purple: cameras`)}</text>`,
    ...out,
    "</svg>",
    "",
  ].join("\n");
}

/** The index's Screen channels cell: the channels the set's screens show; "?" where none is known and some of its models weren't read. */
const screensCell = (set: CinematicSet, displays: DisplayChannels): string => {
  const { screens, unread } = setScreens(set, displays);
  const channels = [...new Set(screens.flatMap((screen) => screen.channels))].sort((a, b) => a - b);
  return channels.length ? channels.join(", ") : unread.length ? "?" : "";
};

/**
 * The README index of the catalog. `origins` are the source kinds the catalog was read from, in
 * order; by default, the ones its sets come from. `privateOnly` says the catalog holds only the sets
 * with a file that isn't Blizzard's (catalog-sets --private).
 */
export function renderSetIndex(
  sets: readonly CinematicSet[],
  files: number,
  kinds: CutsceneSourceKinds = CORE_SOURCE_KINDS,
  origins: readonly string[] = [...new Set(sets.flatMap((set) => set.occurrences.map((entry) => entry.origin)))],
  privateOnly = false,
  displays: DisplayChannels = {},
): string {
  const rows = sets.map((set) => {
    const best = set.occurrences[0]!;
    const origins = [...new Set(set.occurrences.map((entry) => sourceKind(kinds, entry.origin).label))].join(", ");
    const marks = [...new Set(best.marks.map((mark) => mark.name))].slice(0, 6).join(", ");
    return `| [${set.name}](plans/${set.id}.svg) | ${origins} | ${set.occurrences.length} | ${set.models.length} | ${best.marks.length}${marks ? ` (${marks})` : ""} | ${best.cameras.length} | ${screensCell(set, displays)} |`;
  });
  return [
    "# Cinematic sets",
    "",
    `Generated by \`npm run catalog-sets\` from ${files} Cutscene Editor files (${listed(origins.map((origin) => sourceKind(kinds, origin).description))}); don't edit by hand.${privateOnly ? " It holds only the sets with a file that isn't Blizzard's; Blizzard's own are in core's catalog." : ""} \`catalog.json\` has every occurrence: file, pieces, marks, cameras, Lights and display feeds. Screen channels gives the render-to-texture channels the set's screens show, from core's \`data/display-channels.json\`, which records the game's models only (\`?\`: none known, and some models weren't read).`,
    "",
    "A set is a cluster of scenery in one file (pieces closer than 15 units), merged with clusters in other files that share most of their models. Marks and cameras are the ones within 10 units of its scenery in the richest file. The plans are top-down from that file. They aren't pictures: the files give each piece's origin, not its size.",
    "",
    "| Set | From | Files | Models | Marks (richest file) | Cameras | Screen channels |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}
