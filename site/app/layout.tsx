import type { Metadata } from "next";
import Link from "next/link";

import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/chakra-petch/400.css";
import "@fontsource/chakra-petch/500.css";
import "@fontsource/chakra-petch/600.css";
import "@fontsource/chakra-petch/700.css";
import "./globals.css";

import { SearchSlot } from "@/components/search-slot";
import { Tabs } from "@/components/tabs";
import { OS_SCRIPT } from "@/lib/os";
import { CORE_VERSION, ELSEWHERE } from "@/lib/site";

export const metadata: Metadata = {
  title: { default: "sc2-adjutant", template: "%s · sc2-adjutant" },
  description: "Install sc2-adjutant, look up its tools, skills and commands, and follow its tutorials.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // OS_SCRIPT sets data-os on <html> before React hydrates it (the Install page's switch, #979).
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: OS_SCRIPT }} />
      </head>
      <body className="hud-grid flex min-h-screen flex-col font-sans text-slate-300 antialiased">
        <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-sky-400/35 bg-gradient-to-b from-cyan-900/40 to-[#070d16]/95 px-4 py-2.5 backdrop-blur sm:px-5">
          <Link href="/" className="font-display text-[13px] font-bold uppercase tracking-[0.14em] text-cyan-300">
            ◆ Adjutant
          </Link>
          <Tabs />
          <span className="flex-1" />
          <SearchSlot />
        </header>
        <div className="flex-1">{children}</div>
        <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-sky-400/20 px-4 py-3 font-mono text-[11px] text-slate-500 sm:px-5">
          <span>{`Built from sc2-adjutant ${CORE_VERSION}`}</span>
          <span className="flex-1" />
          {ELSEWHERE.map((link) => (
            <a key={link.href} href={link.href} className="hover:text-cyan-300">
              {link.title} ↗
            </a>
          ))}
        </footer>
      </body>
    </html>
  );
}
