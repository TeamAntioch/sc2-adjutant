import Link from "next/link";

import { briefingNumber, reference, tutorialHref } from "@/lib/reference";

export const metadata = { title: "Tutorials" };

const CARD = "clip-panel flex h-full flex-col bg-sky-400/30 p-px";
const MAP =
  "mb-3 h-16 bg-[radial-gradient(circle_at_30%_60%,rgba(34,211,238,0.35)_0_10px,transparent_11px),radial-gradient(circle_at_70%_35%,rgba(251,191,36,0.35)_0_8px,transparent_9px),linear-gradient(135deg,#13263a,#0a1522)]";

/** The Tutorials index (#980): a mission-select grid, one card to each tutorial in site/tutorials/. */
export default function TutorialsIndex() {
  const { tutorials } = reference();
  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-12 pt-6 sm:px-8">
      <div className="font-display text-[11px] font-medium uppercase tracking-[0.3em] text-cyan-400/80">◆ Mission select</div>
      <h1 className="mt-2 font-display text-2xl font-bold uppercase tracking-wider text-cyan-50 sm:text-3xl">Tutorials</h1>
      <p className="my-3 max-w-[66ch]">
        Each tutorial is a briefing you play through with Claude: its objectives on the left, and the session on the right, as what you type and the tools Claude calls.
        A step marked with a host needs that machine&apos;s Host Adapter; without one, you do it by hand. A step marked with a Finder calls tools only that Finder serves.
      </p>
      <ol aria-label="Mission select" className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tutorials.map((tutorial) => {
          const hosts = [...new Set(tutorial.objectives.flatMap((objective) => objective.hostAdapters))];
          const finders = [...new Set(tutorial.objectives.flatMap((objective) => objective.finders))];
          return (
            <li key={tutorial.slug}>
              <Link href={tutorialHref(tutorial.slug)} className={`${CARD} transition hover:bg-cyan-400/70`}>
                <div className="clip-panel flex flex-1 flex-col bg-[#0c1624] p-3">
                  <div className={MAP} aria-hidden />
                  <div className="font-mono text-[11px] text-slate-500">{briefingNumber(tutorial)}</div>
                  <div className="font-display text-[13px] font-semibold uppercase leading-snug tracking-[0.08em] text-cyan-50">{tutorial.title}</div>
                  <p className="mt-1.5 flex-1 text-[12.5px] text-slate-400">{tutorial.summary}</p>
                  <div className="mt-3 font-mono text-[11px] text-slate-500">
                    {tutorial.objectives.length} objectives · {tutorial.minutes} min{hosts.length > 0 && ` · a step needs a ${hosts.join(" or ")} host`}
                    {finders.length > 0 && ` · steps need the ${finders.join(" and the ")}`}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
