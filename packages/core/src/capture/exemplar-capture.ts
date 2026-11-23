// Exemplar captures: camera tours of each Exemplar Map, screenshotted in the game. Core plans the
// tours (one per lighting, or one per dressed place), the Editor Broker builds each capture copy,
// and the Host Adapter's editor.captureTour drives the Editor and the game and writes the frames.
// A bulk job with no manual form, so a host without the capability can't run it.

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { requireCapability, type Host } from "../host/host.js";
import { hostContext } from "../host/machine-config.js";
import type { CaptureTourResult } from "../plugins/plugin-api.js";
import { runBrokeredCapture } from "./editor-broker-client.js";

type Rect = readonly [left: number, bottom: number, right: number, top: number];

/** What captures read of an Exemplar Map: its id, source map and the capture settings its exemplars.json entry records. */
export type ExemplarEntry = {
  readonly id: string;
  /** The source map's folder (see `exemplarMapSources`); may start with `~/`. */
  readonly path: string;
  /** Lightings to tour instead of every one its triggers use. */
  readonly captureLights?: readonly string[];
  /** The lighting of its place tour, for maps whose main light the triggers don't make obvious. */
  readonly placeLight?: string;
  /** Lighting by zone for a place tour; the first zone holding a place wins. */
  readonly placeZones?: readonly { readonly light: string; readonly rect: Rect }[];
};

/** The part of a Map Study (study.json) that captures read. */
export type ExemplarStudy = {
  readonly lighting: { readonly lightsUsed: readonly string[]; readonly calls?: readonly { readonly light: string; readonly inFunction: string }[] };
};

/** mixtures.json's maps and dressed places. */
export type ExemplarMixtures = {
  readonly maps: readonly string[];
  readonly places: readonly { readonly map: string; readonly center: readonly [number, number] }[];
};

/** One camera tour of one map in one lighting; frames go to `<id>/captures/<label>/`. */
export type ExemplarTour = {
  readonly id: string;
  readonly path: string;
  /** A lighting the map's triggers set, or "default" for the tileset's. */
  readonly lighting: string;
  readonly label: string;
  /** The places to visit; a grid tour over the playable area when absent. */
  readonly stops?: readonly (readonly [number, number])[];
};

/** Grid tours: each map once per lighting its triggers use (its captureLights when set), else in the default lighting. */
export function gridTours(exemplars: readonly ExemplarEntry[], studyOf: (id: string) => ExemplarStudy): ExemplarTour[] {
  return exemplars.flatMap((exemplar) => {
    const lights = exemplar.captureLights ?? studyOf(exemplar.id).lighting.lightsUsed;
    return (lights.length > 0 ? lights : ["default"]).map((light) => ({ id: exemplar.id, path: exemplar.path, lighting: light, label: light }));
  });
}

/** Trigger functions whose lighting isn't the map's own: cutscenes and camera modes. */
const SCENE_FUNCTION = /Cutscene|Cinematic|Camera|Booms|Eye|Nightmare/i;

/**
 * Place tours: one frame centred on each dressed place mixtures.json lists, in one lighting: the
 * map's placeLight, else the light its triggers set most outside cutscenes and camera modes, else
 * "default". A map lit by zone gets one tour per lighting, each with the places in its zones.
 */
export function placeTours(exemplars: readonly ExemplarEntry[], mixtures: ExemplarMixtures, studyOf: (id: string) => ExemplarStudy): ExemplarTour[] {
  return mixtures.maps.flatMap((id) => {
    const exemplar = exemplars.find((entry) => entry.id === id);
    if (!exemplar) throw new Error(`mixtures.json names map ${id}, which exemplars.json doesn't list`);
    const calls = new Map<string, number>();
    for (const call of studyOf(id).lighting.calls ?? []) {
      if (!SCENE_FUNCTION.test(call.inFunction)) calls.set(call.light, (calls.get(call.light) ?? 0) + 1);
    }
    const busiest = [...calls].sort((a, b) => b[1] - a[1])[0]?.[0];
    const main = exemplar.placeLight ?? busiest ?? "default";
    const lightOf = ([x, y]: readonly [number, number]): string =>
      (exemplar.placeZones ?? []).find(({ rect: [left, bottom, right, top] }) => x >= left && x <= right && y >= bottom && y <= top)?.light ?? main;
    const byLight = new Map<string, (readonly [number, number])[]>();
    for (const place of mixtures.places) {
      if (place.map !== id) continue;
      const light = lightOf(place.center);
      byLight.set(light, [...(byLight.get(light) ?? []), place.center]);
    }
    return [...byLight].map(([light, stops]) => ({ id, path: exemplar.path, lighting: light, label: `places-${light}`, stops }));
  });
}

export type CaptureExemplarToursOptions = {
  /** The folder holding `<id>/captures/<label>/` (the research archive's docs/research/exemplar-maps). */
  readonly capturesRoot: string;
  /** Start each tour at map init, for maps whose timed triggers never fire. */
  readonly startOnInit?: boolean;
  /** Keep data errors on screen, to debug a tour that doesn't start. */
  readonly showErrors?: boolean;
  readonly log?: (line: string) => void;
};

export type ExemplarTourOutcome =
  | { readonly id: string; readonly label: string; readonly outcome: CaptureTourResult["end"] | "already captured"; readonly frames: number }
  | { readonly id: string; readonly label: string; readonly outcome: "failed"; readonly frames: 0; readonly reason: string };

/** Captures each tour that has no frames yet, so reruns resume; a failed tour doesn't stop the rest. */
export async function captureExemplarTours(host: Host, tours: readonly ExemplarTour[], options: CaptureExemplarToursOptions): Promise<ExemplarTourOutcome[]> {
  requireCapability(host, "editor.captureTour", "Capturing Exemplar tours");
  const log = options.log ?? (() => undefined);
  // The broker it runs through listens in the cache folder.
  hostContext(host.machine).requirePath("cacheDir");
  const outcomes: ExemplarTourOutcome[] = [];
  for (const tour of tours) {
    const outputDir = path.join(options.capturesRoot, tour.id, "captures", tour.label);
    if (existsSync(outputDir) && (await readdir(outputDir)).some((file) => file.endsWith(".jpg"))) {
      log(`${tour.id}/${tour.label}: already captured`);
      outcomes.push({ id: tour.id, label: tour.label, outcome: "already captured", frames: 0 });
      continue;
    }
    const lighting = tour.lighting === "default" ? undefined : tour.lighting;
    const source = tour.path.replace(/^~(?=\/)/, os.homedir());
    try {
      // Through the Editor Broker, which gives each tour's copy its own name: two tours of one map
      // back to back under one name made the Editor test the first copy again.
      const result = await runBrokeredCapture(
        host,
        {
          kind: "tour",
          source,
          label: tour.label,
          copy: {
            ...(lighting ? { lighting } : {}),
            ...(tour.stops ? { stops: tour.stops } : {}),
            ...(options.startOnInit ? { startOnInit: true } : {}),
            ...(options.showErrors ? { showErrors: true } : {}),
          },
          settings: { frameDigits: 3, recordKeys: ["x", "y"], width: 1600, quality: 80, startSeconds: 300, pressSpaceAfterSeconds: 30 },
          outputDir,
        },
        { log: (line) => log(`${tour.id}/${tour.label}: ${line}`) },
      );
      log(`${tour.id}/${tour.label}: ${result.end}, ${result.frames} frames`);
      outcomes.push({ id: tour.id, label: tour.label, outcome: result.end, frames: result.frames });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(`${tour.id}/${tour.label}: failed: ${reason}`);
      outcomes.push({ id: tour.id, label: tour.label, outcome: "failed", frames: 0, reason });
    }
  }
  return outcomes;
}
