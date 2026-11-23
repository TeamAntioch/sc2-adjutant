// Cinematic set captures: the contact-sheet map from `npm run contact-sheet` plays one cutscene per
// set and announces each shot in bank "CsSheet"; the Host Adapter's editor.captureTour, run through
// the Editor Broker, screenshots them, and core collates the frames into one folder per set with an
// index.html contact sheet. A bulk job with no manual form.

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SheetShot } from "../cutscene/contact-sheet.js";
import { requireCapability, type Host } from "../host/host.js";
import { hostContext } from "../host/machine-config.js";
import { CAPTURE_MAPS_FOLDER, type CaptureTourResult } from "../plugins/plugin-api.js";
import { runBrokeredCapture } from "./editor-broker-client.js";
import { frameBrightness, nearestBrightness, TARGET_BRIGHTNESS } from "./pick-lighting.js";

/** The bank the contact-sheet map saves. */
const SHEET_BANK = "CsSheet";
/** A 1600×900 JPEG this small is black or nearly so (a black frame is 29 KB, a lit room 200 KB+). */
const DARK_BYTES = 50_000;

export type CaptureSetsOptions = {
  /** The author already opened the sheet map and ran Test Document: only watch the game. */
  readonly attach?: boolean;
  readonly log?: (line: string) => void;
};

export type CaptureSetsResult = CaptureTourResult & CollateResult;

/**
 * Screenshots every shot of the contact sheet into `<outDir>/frames/`, then collates them. The
 * sheet map is copied into the machine's capture folder first, since the capture closes it without
 * saving.
 */
export async function captureSets(host: Host, manifestPath: string, outDir: string, options: CaptureSetsOptions = {}): Promise<CaptureSetsResult> {
  requireCapability(host, "editor.captureTour", "Capturing cinematic sets");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as SheetManifest;
  const sheetMap = path.resolve(path.dirname(manifestPath), manifest.map);
  const maps = path.join(hostContext(host.machine).requirePath("cacheDir"), CAPTURE_MAPS_FOLDER);
  // Through the Editor Broker, which copies the sheet into the capture folder under the job's own
  // name, unless the author's game is only watched or the sheet is a capture map already.
  const { frames, end } = await runBrokeredCapture(
    host,
    {
      kind: "map",
      source: sheetMap,
      label: "sheet",
      copy: !options.attach && path.dirname(sheetMap) !== maps,
      bank: SHEET_BANK,
      ...(options.attach ? { attach: true } : {}),
      settings: { frameDigits: 4, width: 1600, quality: 85, startSeconds: 450, pressSpaceAfterSeconds: 90 },
      outputDir: path.join(outDir, "frames"),
    },
    options.log ? { log: options.log } : {},
  );
  return { frames, end, ...(await collateSheet(manifest.shots, outDir, manifest.views ? { views: manifest.views } : {})) };
}

/** `views`: on a card sheet, the set views folder holding each set's Blender card pictures. */
type SheetManifest = { readonly map: string; readonly shots: readonly SheetShot[]; readonly views?: string };

/** `picked`: on a sheet filming each card under several lightings, how many cards had a frame kept. */
export type CollateResult = { readonly sets: number; readonly collated: number; readonly usable: number; readonly picked?: number };

/** A card's kept frame: the lighting it had, its brightness, its file, and every lighting tried with its brightness. */
export type PickedLighting = { readonly lighting: string; readonly brightness: number; readonly file: string; readonly tried: readonly { readonly lighting: string; readonly brightness: number }[] };

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const html = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type CollatedShot = { readonly camera: string; readonly file: string | null; readonly dark: boolean };

/**
 * Sorts the frames (`<outDir>/frames/<stop>.jpg`) into `<outDir>/<set id>/<shot>-<camera>.jpg` and
 * writes `<outDir>/index.html`: one row per set, usable frames first. A frame under DARK_BYTES is
 * (nearly) black: a camera inside a wall, or a set lit only by lights tied to the original file's
 * shots. Sets with nothing usable go last. With `views` (a card sheet's shots name their cards), it
 * also writes `<outDir>/pairs.html`: each frame beside the card picture Blender drew from that camera.
 */
export async function collateSheet(
  shots: readonly SheetShot[],
  outDir: string,
  options: { readonly views?: string; readonly brightness?: (file: string) => Promise<number> } = {},
): Promise<CollateResult> {
  const sets = new Map<string, { name: string; shots: CollatedShot[] }>();
  let missing = 0;
  let dark = 0;
  /** Each captured shot's file in outDir. */
  const copied = new Map<SheetShot, string>();
  for (const shot of shots) {
    const frame = path.join(outDir, "frames", `${String(shot.stop).padStart(4, "0")}.jpg`);
    const file = `${String(shot.shot).padStart(2, "0")}-${slug(shot.camera)}.jpg`;
    const set = sets.get(shot.setId) ?? { name: shot.setName, shots: [] };
    sets.set(shot.setId, set);
    if (!existsSync(frame)) {
      missing++;
      set.shots.push({ camera: shot.camera, file: null, dark: true });
      continue;
    }
    const isDark = (await stat(frame)).size < DARK_BYTES;
    if (isDark) dark++;
    await mkdir(path.join(outDir, shot.setId), { recursive: true });
    await copyFile(frame, path.join(outDir, shot.setId, file));
    copied.set(shot, path.join(outDir, shot.setId, file));
    set.shots.push({ camera: shot.camera, file: `${shot.setId}/${file}`, dark: isDark });
  }
  if (options.views) await writePairs(shots, sets, outDir, options.views);
  const picks = shots.some((shot) => shot.lighting) ? await pickLightings(shots, copied, outDir, options.brightness ?? frameBrightness) : undefined;
  if (picks) await writePicks(picks, sets, outDir, options.views);

  const usableIn = (set: { shots: CollatedShot[] }): number => set.shots.filter((shot) => !shot.dark).length;
  const lit = [...sets].filter(([, set]) => usableIn(set) > 0);
  const blank = [...sets].filter(([, set]) => usableIn(set) === 0);
  const row = ([id, set]: [string, { name: string; shots: CollatedShot[] }]): string =>
    `<section><h2>${html(set.name)} <small>${html(id)} · ${usableIn(set)}/${set.shots.length} usable</small></h2><div class="row">${[...set.shots]
      .sort((a, b) => Number(a.dark) - Number(b.dark))
      .map(
        (shot) =>
          `<figure class="${shot.dark ? "dark" : ""}">${shot.file ? `<a href="${shot.file}"><img src="${shot.file}" loading="lazy"></a>` : '<div class="gap">not captured</div>'}<figcaption>${html(shot.camera)}</figcaption></figure>`,
      )
      .join("")}</div></section>`;
  const captured = shots.length - missing;
  const usable = captured - dark;
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Cinematic set contact sheet</title>
<style>body{font:14px Helvetica,Arial,sans-serif;margin:24px;background:#fafafa}h2{font-size:16px;margin:24px 0 8px}small{color:#888;font-weight:normal}
.row{display:flex;gap:8px;overflow-x:auto}figure{margin:0;flex:0 0 320px}img{width:320px;display:block;border:1px solid #ccc}
figure.dark{opacity:.35;flex-basis:160px}figure.dark img{width:160px}.gap{width:160px;height:90px;background:#eee;display:flex;align-items:center;justify-content:center;color:#999}
figcaption{font-size:12px;color:#555;margin-top:4px}</style>
<h1>Cinematic set contact sheet</h1>
<p>${sets.size} sets, ${captured} of ${shots.length} shots captured, ${usable} usable (dimmed: dark frames). ${blank.length} sets have no usable frame and are listed last.</p>
${lit.map(row).join("\n")}
<h1>No usable frame</h1>
${blank.map(row).join("\n")}
`,
  );
  return { sets: sets.size, collated: captured, usable, ...(picks ? { picked: Object.values(picks).reduce((sum, cards) => sum + Object.keys(cards).length, 0) } : {}) };
}

/**
 * For each card filmed under several lightings, keeps the frame nearest TARGET_BRIGHTNESS as
 * `<outDir>/<set id>/card-N.jpg` and writes every card's pick to `<outDir>/lighting.json`, by set and card.
 */
async function pickLightings(shots: readonly SheetShot[], copied: ReadonlyMap<SheetShot, string>, outDir: string, brightness: (file: string) => Promise<number>): Promise<Record<string, Record<string, PickedLighting>>> {
  const cards = new Map<string, { setId: string; card: string; tried: { lighting: string; brightness: number; file: string }[] }>();
  for (const shot of shots) {
    const file = copied.get(shot);
    if (!shot.card || !shot.lighting || !file) continue;
    const key = `${shot.setId}\u0000${shot.card}`;
    const entry = cards.get(key) ?? { setId: shot.setId, card: shot.card, tried: [] };
    cards.set(key, entry);
    entry.tried.push({ lighting: shot.lighting, brightness: await brightness(file), file });
  }
  const picks: Record<string, Record<string, PickedLighting>> = {};
  for (const { setId, card, tried } of cards.values()) {
    const best = nearestBrightness(tried)!;
    const kept = `card-${card.replace(/^card\//, "")}`;
    await copyFile(best.file, path.join(outDir, setId, kept));
    (picks[setId] ??= {})[card] = { lighting: best.lighting, brightness: best.brightness, file: `${setId}/${kept}`, tried: tried.map(({ lighting, brightness }) => ({ lighting, brightness })) };
  }
  await writeFile(path.join(outDir, "lighting.json"), `${JSON.stringify({ target: TARGET_BRIGHTNESS, sets: picks }, null, 1)}\n`);
  return picks;
}

/** The picks page: per card, the kept frame beside Blender's card picture, with the lightings tried and their brightness. */
async function writePicks(picks: Record<string, Record<string, PickedLighting>>, sets: ReadonlyMap<string, { name: string }>, outDir: string, views: string | undefined): Promise<void> {
  const link = (file: string): string => path.relative(outDir, file).split(path.sep).join("/");
  const sections = Object.entries(picks).map(([id, cards]) => {
    const rows = Object.entries(cards).map(([card, pick]) => {
      const blender = views ? `<figure><a href="${link(path.join(views, id, card))}"><img src="${link(path.join(views, id, card))}" loading="lazy"></a><figcaption>Blender ${html(card)}</figcaption></figure>` : "";
      const tried = [...pick.tried].sort((a, b) => Math.abs(a.brightness - TARGET_BRIGHTNESS) - Math.abs(b.brightness - TARGET_BRIGHTNESS)).map((way) => `<li${way.lighting === pick.lighting ? ' class="kept"' : ""}>${way.brightness.toFixed(2)} ${html(way.lighting)}</li>`);
      return `<div class="pair"><figure><a href="${pick.file}"><img src="${pick.file}" loading="lazy"></a><figcaption>in game, ${html(pick.lighting)}</figcaption></figure>${blender}<ul>${tried.join("")}</ul></div>`;
    });
    return `<section><h2>${html(sets.get(id)?.name ?? id)} <small>${html(id)}</small></h2>${rows.join("")}</section>`;
  });
  await writeFile(
    path.join(outDir, "picks.html"),
    `<!doctype html><meta charset="utf-8"><title>Card cameras, lighting picked</title>
<style>body{font:14px Helvetica,Arial,sans-serif;margin:24px;background:#fafafa}h2{font-size:16px;margin:24px 0 8px}small{color:#888;font-weight:normal}
.pair{display:flex;gap:8px;margin-bottom:8px;align-items:flex-start}figure{margin:0;flex:0 0 480px}img{width:480px;display:block;border:1px solid #ccc}
ul{font-size:12px;color:#555;margin:0;padding-left:16px}li.kept{color:#000;font-weight:bold}figcaption{font-size:12px;color:#555;margin-top:4px}</style>
<h1>Card cameras, lighting picked</h1>
<p>Each card picture was filmed under several lightings; the frame kept is the one whose mean brightness is nearest ${TARGET_BRIGHTNESS} (0 black, 1 white). Beside it, Blender's card and every lighting tried with its brightness, nearest first.</p>
${sections.join("\n")}
`,
  );
}

/** The card sheet's pairs page: per set, each in-game frame beside the Blender card picture of the same camera. */
async function writePairs(shots: readonly SheetShot[], sets: ReadonlyMap<string, { name: string; shots: CollatedShot[] }>, outDir: string, views: string): Promise<void> {
  const link = (file: string): string => path.relative(outDir, file).split(path.sep).join("/");
  const sections = [...sets].map(([id, set]) => {
    const ofSet = shots.filter((shot) => shot.setId === id);
    const usable = set.shots.filter((shot) => !shot.dark).length;
    const rows = ofSet.map((shot, at) => {
      const frame = set.shots[at]!;
      const card = shot.card ? link(path.join(views, id, shot.card)) : undefined;
      const game = frame.file ? `<a href="${frame.file}"><img src="${frame.file}" loading="lazy"></a>` : '<div class="gap">not captured</div>';
      const blender = card ? `<a href="${card}"><img src="${card}" loading="lazy"></a>` : '<div class="gap">no card</div>';
      return `<div class="pair${frame.dark ? " dark" : ""}"><figure>${game}<figcaption>in game${frame.dark ? " (dark)" : ""}</figcaption></figure><figure>${blender}<figcaption>Blender ${html(shot.card ?? "")}</figcaption></figure></div>`;
    });
    return `<section><h2>${html(set.name)} <small>${html(id)} · ${usable} of ${set.shots.length} usable</small></h2>${rows.join("")}</section>`;
  });
  await writeFile(
    path.join(outDir, "pairs.html"),
    `<!doctype html><meta charset="utf-8"><title>Card cameras in game</title>
<style>body{font:14px Helvetica,Arial,sans-serif;margin:24px;background:#fafafa}h2{font-size:16px;margin:24px 0 8px}small{color:#888;font-weight:normal}
.pair{display:flex;gap:8px;margin-bottom:8px}figure{margin:0;flex:0 0 480px}img{width:480px;display:block;border:1px solid #ccc}
.pair.dark figure:first-child{opacity:.5}.gap{width:480px;height:270px;background:#eee;display:flex;align-items:center;justify-content:center;color:#999}
figcaption{font-size:12px;color:#555;margin-top:4px}</style>
<h1>Card cameras in game</h1>
<p>Each Set Finder card picture filmed again in the game from the camera Blender drew it from, under the set's base Light: the game's frame on the left, Blender's neutral-light card on the right. Dimmed: a frame small enough to be (nearly) black.</p>
${sections.join("\n")}
`,
  );
}
