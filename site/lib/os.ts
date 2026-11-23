// The reader's machine, for the Install page's macOS / Windows switch (#979). The root layout runs
// OS_SCRIPT in <head>, before the page paints, so one machine's steps are hidden from the first
// frame and a link to an anchor below them lands where it points. Without JavaScript, <html> gets
// no data-os and both machines' steps show.

/** The machines a Host Adapter runs on, in the order the page shows them. */
export const OSES = ["macos", "windows"] as const;

export type Os = (typeof OSES)[number];

export const OS_LABEL: Record<Os, string> = { macos: "macOS", windows: "Windows" };

export const isOs = (value: unknown): value is Os => OSES.includes(value as Os);

/** Where the reader's choice is kept between visits. */
export const OS_KEY = "sc2-adjutant-os";

/**
 * Sets data-os on <html>: the kept choice, else a guess from the browser ("Windows" in its user
 * agent; "Win" alone would match "Darwin"). Storage can be blocked, so it falls back to the guess.
 */
export const OS_SCRIPT = `(function(){var os;try{os=localStorage.getItem(${JSON.stringify(OS_KEY)})}catch(e){}if(${JSON.stringify(OSES)}.indexOf(os)<0)os=/Windows/.test(navigator.userAgent)?"windows":"macos";document.documentElement.dataset.os=os})()`;
