// Capture copies of Exemplar Maps: the platform-neutral half of an Exemplar capture. A copy of the
// map whose Triggers are replaced by a camera tour that announces each stop in bank "ExTour", ready
// for the Host Adapter's editor.captureTour to screenshot.

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { readMapInfo } from "../map/read-map-info.js";
import { withCustomScript, withCustomScriptInMapScript } from "../triggers/custom-script.js";
import { writeMapScript } from "../triggers/write-map-script.js";

/** The bank the tour saves, with int key `stop` and fixed keys `x` and `y` (the camera target, in cells). */
export const TOUR_BANK = "ExTour";
/** The tour's Custom Script element and its init function, in Triggers and MapScript.galaxy. */
const TOUR_SCRIPT_ID = "E7700001";
const TOUR_INIT = "ExTour_Init";
/** The most stops a tour's arrays hold. */
const MAX_STOPS = 1024;
/**
 * How long the tour holds each stop after announcing it, in seconds of real time, before it pans
 * on: the trigger's exTourHold, and the hold the Editor Broker asks the host to time each frame
 * against (`CaptureTourRequest.holdSeconds`), so a frame taken after the camera moved is dropped.
 */
export const TOUR_HOLD_SECONDS = 2.5;

/** A stop's camera: see `CaptureCopyOptions.cameras`. */
export type TourCamera = { readonly distance: number; readonly pitch: number; readonly yawOffset: number };

export type CaptureCopyOptions = {
  /** The copy's file name; by default the source's. */
  readonly name?: string;
  /** The lighting the map's triggers would set; the tileset default when unset. */
  readonly lighting?: string;
  /** Points ([x, y] in cells) to visit instead of stepping a grid over the playable area: a place tour. */
  readonly stops?: readonly (readonly [number, number])[];
  /**
   * A camera for each stop, one for one: distance and pitch, and a yaw in degrees from the game
   * camera's own. Stops without cameras keep the default game camera.
   */
  readonly cameras?: readonly TourCamera[];
  /**
   * Set the Camera Bounds to the Playable Area as the tour starts, so a stop at the map's edge
   * isn't held in by narrower ones (ADR-0015): a Shot's camera is fitted to the Playable Area.
   */
  readonly playableCameraBounds?: boolean;
  /** Start the tour at map init instead of after 0.5 s of game time, for maps whose timed triggers never fire. */
  readonly startOnInit?: boolean;
  /** Keep data errors on screen during Test Document, to debug a tour that doesn't start. */
  readonly showErrors?: boolean;
};

/**
 * Copies `source` into `destDir`, replacing any earlier copy, with its Triggers replaced by the
 * tour, in both Triggers and MapScript.galaxy: Test Document runs MapScript.galaxy as it is, and a
 * map without one loads no script at all, so the tour never starts (docs/reference/
 * editor-and-engine.md, "Test Document and MapScript.galaxy"). The map's own script is replaced by
 * an empty one with the tour in it. Its imported trigger libraries go too: they override the game's own and can fail to compile, which silently stops every
 * trigger, the tour included.
 */
export async function makeCaptureCopy(source: string, destDir: string, options: CaptureCopyOptions = {}): Promise<string> {
  if (options.stops && options.stops.length > MAX_STOPS) throw new Error(`A capture tour visits at most ${MAX_STOPS} stops; this one has ${options.stops.length}`);
  // An empty list would set no stops, and the tour would fall back to a full grid of the map.
  if (options.stops && options.stops.length === 0) throw new Error("A place tour needs at least one stop; leave stops out for a grid tour");
  if (options.cameras && options.cameras.length !== (options.stops?.length ?? 0)) {
    throw new Error(`A tour gives one camera per stop: ${options.stops?.length ?? 0} stops, ${options.cameras.length} cameras`);
  }
  const copy = path.join(destDir, options.name ?? path.basename(source));
  await rm(copy, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });
  await cp(source, copy, { recursive: true });
  const mapInfo = await readFile(path.join(copy, "MapInfo"));
  // Data errors would otherwise print over the frames.
  if (!options.showErrors) await writeFile(path.join(copy, "MapInfo"), hideErrorsDuringTest(mapInfo));
  const script = tourScript(readMapInfo(mapInfo).playableBounds, options);
  await writeFile(path.join(copy, "Triggers"), withCustomScript(undefined, TOUR_SCRIPT_ID, script, TOUR_INIT));
  const emptyScript = writeMapScript({ mapName: path.basename(copy, ".SC2Map"), triggers: { variables: [], triggers: [] } });
  await writeFile(path.join(copy, "MapScript.galaxy"), withCustomScriptInMapScript(emptyScript, TOUR_SCRIPT_ID, script, TOUR_INIT));
  await rm(path.join(copy, "Base.SC2Data", "TriggerLibs"), { recursive: true, force: true });
  return copy;
}

/** The game options flag Hide Errors During Test Document. */
const HIDE_ERRORS_TEST = 0x20;

/**
 * MapInfo with Hide Errors During Test Document turned on. The header's integrity hash counts set
 * flags negatively, so it drops by one with the new bit.
 */
export function hideErrorsDuringTest(mapInfo: Buffer): Buffer {
  const b = Buffer.from(mapInfo);
  const width = b.readUInt32LE(16);
  const height = b.readUInt32LE(20);
  let o = 24;
  const cString = () => {
    o = b.indexOf(0, o) + 1;
  };
  const lpString = () => {
    o += 2 + b.readUInt16LE(o);
  };
  // Locale and preview modes, preview and hover images, minimap resolution and difficulty, fog, tileset.
  o += 8;
  cString();
  cString();
  o += 8;
  cString();
  cString();
  const [left, bottom, right, top] = [0, 4, 8, 12].map((k) => b.readInt32LE(o + k)) as [number, number, number, number];
  if (!(right > left && top > bottom && right <= width && top <= height)) throw new Error("MapInfo: the playable bounds aren't where expected");
  // Bounds, base height, loading screen, loading bar, scale, text anchor and box, custom layout.
  o += 16 + 4 + 4;
  cString();
  lpString();
  o += 4 + 4 + 16;
  cString();
  lpString();
  lpString();
  const flags = b.readUInt32LE(o);
  const speedMode = b.readInt32LE(o + 4);
  if (speedMode !== 0 && speedMode !== 1) throw new Error("MapInfo: the game options aren't where expected");
  if (flags & HIDE_ERRORS_TEST) return b;
  b.writeUInt32LE((flags | HIDE_ERRORS_TEST) >>> 0, o);
  b.writeBigUInt64LE(BigInt.asUintN(64, b.readBigUInt64LE(8) - 1n), 8);
  return b;
}

/** Galaxy wants a decimal point in a fixed literal. */
const fixed = (value: number, digits: number): string => value.toFixed(digits);

/**
 * The tour: reveal the map, hide the UI, then step the camera across the playable area, or visit
 * the listed stops. Each stop is announced by saving bank "ExTour", so a watcher outside the game
 * can screenshot it; stop -1 ends the tour.
 */
/** A Galaxy string literal: backslashes and double quotes escaped, and no line breaks. */
export function galaxyString(text: string): string {
  if (/[\r\n]/.test(text)) throw new Error(`A Galaxy string can't hold a line break: ${JSON.stringify(text)}`);
  return `"${text.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

export function tourScript(bounds: readonly [number, number, number, number], options: Pick<CaptureCopyOptions, "lighting" | "stops" | "cameras" | "startOnInit" | "playableCameraBounds"> = {}): string {
  const [left, bottom, right, top] = bounds;
  const cameras = options.cameras;
  const cameraOf = (n: number): string => {
    const camera = cameras?.[n];
    return camera ? ` exTourDistance[${n}] = ${fixed(camera.distance, 2)}; exTourPitch[${n}] = ${fixed(camera.pitch, 2)}; exTourYaw[${n}] = ${fixed(camera.yawOffset, 2)};` : "";
  };
  const points = options.stops
    ? [...options.stops.map(([x, y], n) => `    exTourX[${n}] = ${fixed(x, 2)}; exTourY[${n}] = ${fixed(y, 2)};${cameraOf(n)}`), `    exTourCount = ${options.stops.length};`]
    : ["    // A grid tour: no stops are listed."];
  // Each stop's camera, set at once before the pan; the yaw turns from the game camera's own.
  const cameraArrays = cameras ? "\n// Each stop's camera: distance, pitch and a yaw from the game camera's own.\nfixed[exTourMax] exTourDistance;\nfixed[exTourMax] exTourPitch;\nfixed[exTourMax] exTourYaw;" : "";
  const setCamera = cameras
    ? `
    CameraSetValue(1, c_cameraValueDistance, exTourDistance[n - 1], 0.0, -1, 10.0);
    CameraSetValue(1, c_cameraValuePitch, exTourPitch[n - 1], 0.0, -1, 10.0);
    CameraSetValue(1, c_cameraValueYaw, CameraInfoGetValue(CameraInfoDefault(), c_cameraValueYaw) + exTourYaw[n - 1], 0.0, -1, 10.0);`
    : "";
  return `// Exemplar capture tour: reveal the map, hide UI, then step the camera across the playable area, or
// visit the listed stops instead (a place tour).
include "TriggerLibs/NativeLib"
// Each stop is announced by saving bank "${TOUR_BANK}" with key "stop" so an outside watcher can screenshot.
const fixed exTourStepX = 18.0;
const fixed exTourStepY = 12.0;
const fixed exTourHold = ${fixed(TOUR_HOLD_SECONDS, 2)};
const fixed exTourSettle = 2.0;
const fixed exTourInset = 8.0;
const int exTourMax = ${MAX_STOPS};
fixed[exTourMax] exTourX;
fixed[exTourMax] exTourY;
int exTourCount = 0;${cameraArrays}
// Lighting the map's triggers would set; "" keeps the tileset default.
const string exTourLighting = ${galaxyString(options.lighting ?? "")};
bank exTourBank;

void ExTour_Points() {
${points.join("\n")}
}

void ExTour_Announce(int n, fixed x, fixed y) {
    BankValueSetFromInt(exTourBank, "tour", "stop", n);
    BankValueSetFromFixed(exTourBank, "tour", "x", x);
    BankValueSetFromFixed(exTourBank, "tour", "y", y);
    BankSave(exTourBank);
}

void ExTour_Visit(int n, fixed x, fixed y) {${setCamera}
    CameraPan(1, Point(x, y), 0.0, -1, 10.0, false);
    Wait(exTourSettle, c_timeReal);
    ExTour_Announce(n, x, y);
    Wait(exTourHold, c_timeReal);
}

bool ExTour_Run(bool testConds, bool runActions) {
    point lo;
    point hi;
    fixed x;
    fixed y;
    int n;
    lo = Point(${fixed(left, 1)}, ${fixed(bottom, 1)});
    hi = Point(${fixed(right, 1)}, ${fixed(top, 1)});
    n = 0;
    exTourBank = BankLoad("${TOUR_BANK}", 1);
    if (exTourLighting != "") {
        GameSetLighting(exTourLighting, 0.0);
    }
    VisEnable(c_visTypeMask, false);
    VisEnable(c_visTypeFog, false);
    libNtve_gf_HideGameUI(false, PlayerGroupAll());
    UISetFrameVisible(PlayerGroupAll(), c_syncFrameTypeInfoPanel, false);
    UISetFrameVisible(PlayerGroupAll(), c_syncFrameTypeCommandPanel, false);
    UISetFrameVisible(PlayerGroupAll(), c_syncFrameTypeMinimapPanel, false);
    UISetFrameVisible(PlayerGroupAll(), c_syncFrameTypeConsolePanel, false);
    UISetFrameVisible(PlayerGroupAll(), c_syncFrameTypeHeroPanel, false);
    UISetFrameVisible(PlayerGroupAll(), c_syncFrameTypeStatusUI, false);
    UISetCursorVisible(PlayerGroupAll(), false);${
      options.playableCameraBounds
        ? // RegionPlayableMapArea isn't available in a Triggers CustomScript (macos-host.md), so the
          // region is MapInfo's rectangle. The minimap is hidden, so it isn't shrunk.
          `\n    // The Camera Bounds are the Playable Area.\n    CameraSetBounds(PlayerGroupAll(), RegionRect(${fixed(left, 1)}, ${fixed(bottom, 1)}, ${fixed(right, 1)}, ${fixed(top, 1)}), false);`
        : ""
    }
    CameraLockInput(1, true);
    CameraApplyInfo(1, CameraInfoDefault(), 0.0, -1, 10.0, false);
    Wait(3.0, c_timeReal);
    ExTour_Points();
    if (exTourCount > 0) {
        while (n < exTourCount) {
            ExTour_Visit(n + 1, exTourX[n], exTourY[n]);
            n += 1;
        }
        ExTour_Announce(-1, 0.0, 0.0);
        return true;
    }
    y = PointGetY(hi) - exTourInset;
    while (y > PointGetY(lo) + exTourInset / 2.0) {
        x = PointGetX(lo) + exTourInset;
        while (x < PointGetX(hi) - exTourInset / 2.0) {
            n += 1;
            ExTour_Visit(n, x, y);
            x += exTourStepX;
        }
        y -= exTourStepY;
    }
    ExTour_Announce(-1, 0.0, 0.0);
    return true;
}

void ExTour_Init() {
    trigger t;
    t = TriggerCreate("ExTour_Run");
    ${options.startOnInit ? "TriggerAddEventMapInit(t);" : "TriggerAddEventTimeElapsed(t, 0.5, c_timeGame);"}
}`;
}
