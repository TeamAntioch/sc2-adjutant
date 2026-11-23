"use client";
// The macOS / Windows switch on the Install page (#979). Each machine's steps are a <ForOs> block,
// and the exported HTML has both, one after the other, each with its machine's name: that's the
// page without JavaScript. With it, the root layout's OS_SCRIPT (lib/os.ts) sets data-os on <html>
// before the page paints, globals.css hides the other machine's blocks, and this switch changes it.
// The reader's choice is kept for the next visit.
import { useEffect, useState, type ReactNode } from "react";

import { isOs, OS_KEY, OS_LABEL, OSES, type Os } from "@/lib/os";

/** Shows `os`'s steps, and keeps the choice when `keep` says it's the reader's. */
function show(os: Os, keep: boolean) {
  document.documentElement.dataset.os = os;
  if (!keep) return;
  try {
    localStorage.setItem(OS_KEY, os);
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
}

/** The switch: no buttons until JavaScript runs, so a reader without it sees both machines' steps and no dead buttons. */
export function OsSwitch() {
  const [os, setOs] = useState<Os>();

  useEffect(() => {
    // OS_SCRIPT has set it; "macos", not kept, only if it somehow didn't run.
    const current = document.documentElement.dataset.os;
    const os = isOs(current) ? current : "macos";
    show(os, false);
    setOs(os);
  }, []);

  const choose = (os: Os) => {
    show(os, true);
    setOs(os);
  };
  // The slot is always there, and globals.css gives it the buttons' height once data-os is set, so
  // the buttons appearing moves nothing below them.
  return (
    <div className="os-switch">
      {os && (
        <div role="group" aria-label="Your machine" className="inline-flex h-full border border-sky-400/40 font-display text-[11px] font-semibold uppercase tracking-[0.14em]">
          {OSES.map((machine) => (
            <button
              key={machine}
              type="button"
              aria-pressed={os === machine}
              onClick={() => choose(machine)}
              className={`px-3 ${os === machine ? "bg-cyan-400/20 text-cyan-200" : "text-slate-400 hover:text-cyan-300"}`}
            >
              {OS_LABEL[machine]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** One machine's version of a step. It holds paragraphs, lists and code blocks, never a <div>. */
export function ForOs({ os, children }: { os: Os; children: ReactNode }) {
  return (
    <div data-for-os={os} className="for-os">
      <p className="for-os-label">{OS_LABEL[os]}</p>
      {children}
    </div>
  );
}
