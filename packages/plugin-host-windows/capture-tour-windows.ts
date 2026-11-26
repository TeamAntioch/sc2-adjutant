// The capture tour's logic on Windows, apart from the Editor and the game: the bank the map saves,
// the frames and stops.txt it writes, the watch from the game's start to the tour's end, and which
// documents are capture copies. Pure, or driven through a TourWorld, so it's tested without SC2.
// The watch is the macOS adapter's (plugin-host-macos/capture-tour.ts), as the Exemplar and
// cinematic-set captures expect it.

import path from "node:path";

import type { CaptureTourRequest, CaptureTourResult } from "@team-antioch/sc2-adjutant/plugin-sdk";

import { elidedMatches, type EditorState } from "./editor-windows.ts";

/** A bank file's int or fixed value for a key, as the game writes it (`<Key name="..."><Value int="..."/>`). */
export function bankValue(bank: string, key: string, kind: "int" | "fixed"): string | undefined {
  const match = new RegExp(`name="${key}"[^\\n]*\\n[^\\n]*${kind}="([-0-9.]*)"`).exec(bank);
  return match?.[1];
}

/** Where the game saves a bank: `<Documents>\StarCraft II\Banks\<bank>.SC2Bank`, Documents being wherever the shell says. */
export const bankFile = (documents: string, bank: string): string => path.join(documents, "StarCraft II", "Banks", `${bank}.SC2Bank`);

/** A stop's frame: `<stop>.jpg`, zero-padded to `digits`. */
export const frameName = (stop: string, digits: number): string => `${stop.padStart(digits, "0")}.jpg`;

/** A stop's line in stops.txt: the stop, then each key's fixed value (empty when the bank lacks it). */
export const stopsLine = (stop: string, bank: string, keys: readonly string[]): string => `${[stop, ...keys.map((key) => bankValue(bank, key, "fixed") ?? "")].join(" ")}\n`;

/** How often the watch reads the bank, in seconds. */
const POLL_SECONDS = 0.5;
/** How often Space is pressed while no stop comes, once pressSpaceAfterSeconds have passed, in seconds. */
const SPACE_EVERY_SECONDS = 10;

/** What the watch does to the game and the machine; the adapter's is in capture-tour.ts. */
export type TourWorld = {
  readonly gameRunning: () => Promise<boolean>;
  /**
   * The bank file's content, "" when there's none, and when the game saved it (its modified time,
   * in ms on the `now` clock), taken before the content so a save in between only makes it earlier.
   */
  readonly readBank: () => Promise<{ readonly text: string; readonly savedAt?: number }>;
  /** Captures the game's window to this frame; false when there was no window or the capture failed. */
  readonly capture: (frame: string) => Promise<boolean>;
  /** Deletes a frame captured too late to trust. */
  readonly discard: (frame: string) => Promise<void>;
  readonly pressSpace: () => Promise<void>;
  /** Appends a line to stops.txt. */
  readonly record: (line: string) => Promise<void>;
  readonly wait: (seconds: number) => Promise<void>;
  /** Milliseconds, for the waits. */
  readonly now: () => number;
  readonly log: (line: string) => void;
};

export type TourWatch = Pick<CaptureTourRequest, "outputDir" | "frameDigits" | "recordKeys" | "startSeconds" | "pressSpaceAfterSeconds" | "holdSeconds"> & {
  /** The bank as an earlier run left it, attached to a game already running: ignored until the game saves it again. */
  readonly leftover?: string;
};

/**
 * Watches a running game until its tour ends: reads the bank every half second, captures each new
 * stop, and records it in stops.txt when `recordKeys` are given. Ends "done" at stop -1, "game
 * exited" when the game quits first, and "never started" with no stop within `startSeconds`, having
 * pressed Space every 10 s after `pressSpaceAfterSeconds`, for a loading screen that waits for it.
 * With `holdSeconds`, a frame whose capture finished after the bank's save plus the hold is
 * deleted and its stop listed as late, not taken again: the camera may have moved on.
 */
export async function watchTour(watch: TourWatch, world: TourWorld): Promise<CaptureTourResult> {
  // When the watch began, until the first stop comes; then undefined.
  let waiting: number | undefined = world.now();
  let leftover = watch.leftover;
  let last = 0;
  let frames = 0;
  const late: number[] = [];
  let lastSpace: number | undefined;
  for (;;) {
    await world.wait(POLL_SECONDS);
    if (!(await world.gameRunning())) {
      world.log(`game exited at stop ${last}`);
      return { frames, end: "game exited", late };
    }
    const { text: bank, savedAt } = await world.readBank();
    if (leftover !== undefined && bank !== leftover) leftover = undefined;
    const stop = leftover === undefined ? bankValue(bank, "stop", "int") : undefined;
    if (stop === undefined) {
      // Once the tour has started, a bank caught mid-write is just read again.
      if (waiting === undefined) continue;
      const waited = (world.now() - waiting) / 1000;
      if (waited >= watch.pressSpaceAfterSeconds && (lastSpace === undefined || waited - lastSpace >= SPACE_EVERY_SECONDS)) {
        lastSpace = waited;
        world.log("no stop yet; pressing Space in the game (takes focus)");
        await world.pressSpace();
      }
      if (waited > watch.startSeconds) {
        world.log("the tour never started");
        return { frames, end: "never started", late };
      }
      continue;
    }
    waiting = undefined;
    if (stop === "-1") {
      world.log(`tour done (${frames} stops)`);
      return { frames, end: "done", late };
    }
    if (Number(stop) === last) continue;
    const frame = path.join(watch.outputDir, frameName(stop, watch.frameDigits));
    if (!(await world.capture(frame))) continue;
    last = Number(stop);
    const over = lateBy(savedAt, world.now(), watch.holdSeconds);
    if (over !== undefined) {
      await world.discard(frame);
      late.push(last);
      world.log(`stop ${stop}: captured ${over.toFixed(1)} s after its hold ended, so the camera may have moved on: dropped as late`);
      continue;
    }
    frames++;
    world.log(`stop ${stop}`);
    if (watch.recordKeys) await world.record(stopsLine(stop, bank, watch.recordKeys));
  }
}

/**
 * How many seconds after its stop's hold a capture that finished at `finished` (ms) ended, the hold
 * running `holdSeconds` from the bank's save at `savedAt` (ms); undefined when it ended inside the
 * hold, or there's no hold or save time to judge by. The game's wait is real time and only runs
 * long, so a capture inside the window can't show a camera that moved on. The macOS adapter's
 * shootStop uses the same rule.
 */
export function lateBy(savedAt: number | undefined, finished: number, holdSeconds: number | undefined): number | undefined {
  if (savedAt === undefined || holdSeconds === undefined) return undefined;
  const over = (finished - savedAt) / 1000 - holdSeconds;
  return over > 0 ? over : undefined;
}

/**
 * The Map Packages in this cache's capture folder (`maps`) that the Editor has open. A document
 * counts when the path it shows can stand for `<maps>\<its name>`, and either shows that path
 * whole or the copy is on disk: an elided path (`C:/.../capture/maps/X.SC2Map`) could be another
 * cache's copy, which isn't this machine's to close.
 */
export function captureCopies(state: EditorState, maps: string, exists: (file: string) => boolean): string[] {
  const copies = new Set<string>();
  for (const document of state.documents) {
    const copy = path.join(maps, path.posix.basename(document.path));
    if (!/\.SC2Map$/i.test(copy) || !elidedMatches(document.path, copy)) continue;
    if (document.path.includes("...") && !exists(copy)) continue;
    copies.add(copy);
  }
  return [...copies];
}
