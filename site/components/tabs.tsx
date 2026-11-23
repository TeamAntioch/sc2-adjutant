"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { inSection, SECTIONS } from "@/lib/site";

/** The top tabs: Install · Tutorials · Tools · Skills · Commands, the current section's marked. */
export function Tabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className="flex flex-wrap items-center gap-0.5">
      {SECTIONS.map((section) => {
        const current = inSection(pathname, section.href);
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={current ? "page" : undefined}
            className={`clip-tab px-3.5 py-2 font-display text-[11px] font-medium uppercase tracking-[0.12em] transition-colors ${
              current ? "bg-cyan-400/20 text-cyan-50 shadow-[inset_0_-2px_0_#22d3ee]" : "text-sky-300 hover:bg-cyan-400/10 hover:text-cyan-100"
            }`}
          >
            {section.title}
          </Link>
        );
      })}
    </nav>
  );
}
