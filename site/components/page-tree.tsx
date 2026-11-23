"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ELSEWHERE, isPage, SECTIONS } from "@/lib/site";

const GROUP = "mb-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500";

/** The page tree on the left: every section's pages, then the links out. */
export function PageTree() {
  const pathname = usePathname();
  return (
    <nav aria-label="Pages" className="text-[13px]">
      {SECTIONS.map((section) => (
        <div key={section.href} className="mb-4">
          <div className={GROUP}>{section.title}</div>
          {section.pages.map((page) => {
            const current = isPage(pathname, page.href);
            return (
              <Link
                key={page.href}
                href={page.href}
                aria-current={current ? "page" : undefined}
                className={`block px-2 py-0.5 ${current ? "bg-cyan-400/10 text-cyan-50 shadow-[inset_2px_0_0_#22d3ee]" : "text-slate-400 hover:text-cyan-100"}`}
              >
                {page.title}
              </Link>
            );
          })}
        </div>
      ))}
      <div className="mt-6">
        <div className={GROUP}>Elsewhere</div>
        {ELSEWHERE.map((link) => (
          <a key={link.href} href={link.href} className="block px-2 py-0.5 text-slate-400 hover:text-cyan-100">
            {link.title} ↗
          </a>
        ))}
      </div>
    </nav>
  );
}
