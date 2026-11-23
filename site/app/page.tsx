import Link from "next/link";

import { CORE_VERSION, MAPPING_REFERENCE_URL, SECTIONS } from "@/lib/site";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-12 sm:px-8">
      <div className="font-display text-[11px] font-medium uppercase tracking-[0.3em] text-cyan-400/80">◆ {`sc2-adjutant ${CORE_VERSION}`}</div>
      <h1 className="text-balance mt-2 font-display text-3xl font-bold uppercase tracking-wider text-cyan-50 sm:text-4xl">
        Co-design StarCraft II missions with Claude
      </h1>
      <div className="mt-3 h-px max-w-md bg-gradient-to-r from-cyan-400/70 to-transparent" />
      <p className="mt-4 max-w-[66ch]">
        sc2-adjutant is a Claude Code plugin that takes a Mission from a premise to a Map Package the StarCraft II Editor opens. Galleries of
        doodads, cliffs and textures live on the <a href={MAPPING_REFERENCE_URL} className="text-sky-300 hover:underline">Mapping Reference</a>.
      </p>
      <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map((section) => (
          <Link key={section.href} href={section.href} className="clip-panel block bg-sky-400/35 p-px hover:bg-cyan-400/70">
            <div className="clip-panel h-full bg-[#0c1624] px-4 py-3">
              <div className="font-display text-sm font-semibold uppercase tracking-[0.12em] text-cyan-300">{section.title}</div>
              <p className="mt-1 text-sm text-slate-400">{section.blurb}</p>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
