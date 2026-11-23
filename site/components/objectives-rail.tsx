"use client";

// The Briefings layout's left rail (#980): the tutorial's objectives, each linked to its step and
// marked with the Host Adapters or Finders it needs, then the other tutorials. As the page scrolls,
// the step in view is marked current and the ones above it done.
import Link from "next/link";
import { useEffect, useState } from "react";

import type { Objective, Tutorial } from "@/lib/reference-types";

import { NeedsChip, needsAny } from "./needs-chip";

const GROUP = "mb-2.5 font-display text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500";

/** How far below the top of the window a step's top must have scrolled to count as the one in view. */
const IN_VIEW = 120;

/** The index of the step in view: the last whose top has scrolled above IN_VIEW, else the first. */
function stepInView(objectives: Objective[]): number {
  let current = 0;
  objectives.forEach((objective, index) => {
    const top = document.getElementById(objective.id)?.getBoundingClientRect().top;
    if (top !== undefined && top <= IN_VIEW) current = index;
  });
  return current;
}

/** A tutorial in the rail's list: only what it shows, so the page sends the client no more. */
export interface RailTutorial {
  href: string;
  title: string;
  minutes: number;
  current: boolean;
}

export function ObjectivesRail({ tutorial, tutorials }: { tutorial: Tutorial; tutorials: RailTutorial[] }) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const update = () => setCurrent(stepInView(tutorial.objectives));
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("hashchange", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("hashchange", update);
    };
  }, [tutorial]);

  return (
    <>
      <nav aria-label="Objectives" className="mb-6">
        <div className={GROUP}>Objectives</div>
        <ol className="grid gap-2">
          {tutorial.objectives.map((objective, index) => {
            const state = index < current ? "done" : index === current ? "now" : "next";
            return (
              <li key={objective.id}>
                <a
                  href={`#${objective.id}`}
                  aria-current={state === "now" ? "step" : undefined}
                  className={`grid grid-cols-[16px_minmax(0,1fr)] gap-2 text-[13px] ${state === "now" ? "text-cyan-50" : state === "done" ? "text-slate-500" : "text-slate-400"} hover:text-cyan-100`}
                >
                  <i
                    aria-hidden
                    className={`mt-1 block h-3 w-3 rotate-45 border ${
                      state === "now" ? "border-amber-400 bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.6)]" : state === "done" ? "border-green-400 bg-green-400" : "border-sky-300"
                    }`}
                  />
                  <span>
                    {objective.title}
                    {needsAny(objective) && (
                      <>
                        {" "}
                        <NeedsChip step={objective} />
                      </>
                    )}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      </nav>
      <nav aria-label="Tutorials">
        <div className={GROUP}>Tutorials</div>
        <ol className="grid gap-1.5">
          {tutorials.map((other) => (
            <li key={other.href}>
              <Link
                href={other.href}
                aria-current={other.current ? "page" : undefined}
                className={`flex justify-between gap-1.5 border px-2 py-1.5 font-display text-[11px] font-medium uppercase leading-snug tracking-[0.08em] ${
                  other.current ? "border-cyan-400 text-cyan-50" : "border-sky-400/20 text-slate-400 hover:text-cyan-100"
                }`}
              >
                <span>{other.title}</span>
                <span className="whitespace-nowrap text-slate-500">{other.minutes} min</span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
