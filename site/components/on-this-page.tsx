"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface Heading {
  id: string;
  text: string;
  level: number;
}

/** "On this page" on the right: the article's h2 and h3 headings, read once the page has rendered. */
export function OnThisPage() {
  const pathname = usePathname();
  const [headings, setHeadings] = useState<Heading[]>([]);

  useEffect(() => {
    const found = [...document.querySelectorAll<HTMLHeadingElement>("article.doc h2[id], article.doc h3[id]")];
    setHeadings(found.map((h) => ({ id: h.id, text: h.textContent ?? "", level: h.tagName === "H3" ? 3 : 2 })));
  }, [pathname]);

  return (
    <nav aria-label="On this page" className="text-xs">
      <div className="mb-2 font-display text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">On this page</div>
      {headings.map((h) => (
        <a key={h.id} href={`#${h.id}`} className={`block py-0.5 text-slate-400 hover:text-cyan-300 ${h.level === 3 ? "pl-3" : ""}`}>
          {h.text}
        </a>
      ))}
    </nav>
  );
}
