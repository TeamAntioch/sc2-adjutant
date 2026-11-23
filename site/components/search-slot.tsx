"use client";

// Search (#983), in every page's shell: the box in the header, or ⌘K (Ctrl+K off a Mac), opens a
// dialog that searches the Pagefind index the build wrote to /pagefind/. Each hit shows its kind.
// The index exists only in a build (`npm run build -w site`), so under `next dev` the dialog says so.
import Link from "next/link";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

import { KINDS, type Kind, PAGEFIND_PATH, type Pagefind } from "@/lib/search";

/** Hits shown for a query: Pagefind ranks them, and a mapper reads the first few. */
const SHOWN = 12;

interface Hit {
  url: string;
  title: string;
  kind: Kind | undefined;
  excerpt: string;
}

/** The plural each kind's filter chip shows. */
const PLURAL: Record<Kind, string> = { Tool: "Tools", Skill: "Skills", Command: "Commands", Tutorial: "Tutorials" };

/** Pagefind, loaded once, the first time the dialog opens. */
let loading: Promise<Pagefind> | undefined;
function loadPagefind(): Promise<Pagefind> {
  // The index is a file of the built site, not a module of the bundle: the bundler leaves the import alone.
  loading ??= (import(/* webpackIgnore: true */ /* turbopackIgnore: true */ PAGEFIND_PATH) as Promise<Pagefind>).catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

const ENTITIES = { lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'", amp: "&" };

/**
 * An excerpt as Pagefind gives it: the page's text, HTML-escaped, with the match in <mark>. Split
 * on the marks and unescaped, so React sets the text and nothing from a page is set as HTML.
 */
function Excerpt({ html }: { html: string }) {
  const text = (part: string) =>
    part.replace(/&(lt|gt|quot|#39|#x27|amp);/g, (_, name: keyof typeof ENTITIES) => ENTITIES[name]);
  return (
    <>
      {html.split(/(<mark>.*?<\/mark>)/s).map((part, index) =>
        part.startsWith("<mark>") ? (
          <mark key={index} className="bg-transparent text-amber-300">
            {text(part.slice(6, -7))}
          </mark>
        ) : (
          text(part)
        ),
      )}
    </>
  );
}

export function SearchSlot() {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [mac, setMac] = useState(true);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind | undefined>();
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [state, setState] = useState<"ready" | "searching" | "unavailable">("ready");

  const open = useCallback(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
    input.current?.select();
    loadPagefind().catch(() => setState("unavailable"));
  }, []);
  const close = useCallback(() => dialog.current?.close(), []);

  useEffect(() => {
    const onMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    setMac(onMac);
    // ⌘K on a Mac, Ctrl+K elsewhere: on a Mac, Ctrl+K in a text field deletes to the end of the line.
    const onKey = (event: KeyboardEvent) => {
      if ((onMac ? event.metaKey : event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    const words = query.trim();
    if (!words) {
      setHits([]);
      setState((now) => (now === "unavailable" ? now : "ready"));
      return;
    }
    let stale = false;
    setState("searching");
    loadPagefind()
      .then(async (pagefind) => {
        // debouncedSearch answers null when a later query has replaced this one.
        const found = await pagefind.debouncedSearch(words, kind ? { filters: { kind } } : {}, 150);
        if (!found || stale) return;
        const pages = await Promise.all(found.results.slice(0, SHOWN).map((result) => result.data()));
        if (stale) return;
        setHits(pages.map((page) => ({ url: page.url, title: page.meta.title ?? page.url, kind: page.filters.kind?.[0] as Kind | undefined, excerpt: page.excerpt })));
        setActive(0);
        setState("ready");
      })
      .catch(() => !stale && setState("unavailable"));
    return () => {
      stale = true;
    };
  }, [query, kind]);

  const onInputKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // A search field's own Escape clears it and keeps the dialog open: Escape closes it here.
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((at) => (hits.length ? (at + step + hits.length) % hits.length : 0));
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing && hits[active]) {
      event.preventDefault();
      document.getElementById(`search-hit-${active}`)?.click();
    }
  };

  return (
    <>
      <button
        type="button"
        data-search-slot
        onClick={open}
        aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
        className="flex min-w-0 items-center gap-2.5 border border-sky-400/35 px-2.5 py-1 font-mono text-xs text-slate-500 hover:border-cyan-400 hover:text-slate-300"
      >
        Search tools, skills…
        <kbd className="hidden border border-sky-400/35 px-1 font-mono text-sky-300 sm:inline">{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <dialog
        ref={dialog}
        aria-label="Search"
        onClick={(event) => event.target === dialog.current && close()}
        className="mx-auto mt-[10vh] w-[min(640px,calc(100vw-32px))] border border-cyan-400/60 bg-[#0a1420] p-0 text-slate-300 shadow-[0_0_40px_rgba(34,211,238,0.15)] backdrop:bg-[#030810]/75"
      >
        <div className="border-b border-sky-400/25 p-3">
          <input
            ref={input}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKey}
            placeholder="What do you want to do? (move a Zone, find doodads…)"
            role="combobox"
            aria-label="Search tools, skills, commands and tutorials"
            aria-autocomplete="list"
            aria-expanded={hits.length > 0}
            aria-controls="search-hits"
            aria-activedescendant={hits[active] ? `search-hit-${active}` : undefined}
            className="w-full border border-sky-400/35 bg-transparent px-2.5 py-2 font-sans text-sm text-cyan-50 outline-none placeholder:text-slate-500 focus:border-cyan-400"
          />
          <div role="group" aria-label="Kind" className="mt-2 flex flex-wrap gap-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.14em]">
            {[undefined, ...KINDS].map((option) => (
              <button
                key={option ?? "all"}
                type="button"
                aria-pressed={kind === option}
                onClick={() => setKind(option)}
                className={`border px-2 py-0.5 ${kind === option ? "border-cyan-400 text-cyan-50" : "border-sky-400/25 text-slate-500 hover:text-slate-300"}`}
              >
                {option ? PLURAL[option] : "All"}
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          <p aria-live="polite" className={state === "unavailable" || (query.trim() && hits.length === 0 && state === "ready") ? "p-4 text-sm text-slate-400" : "sr-only"}>
            {state === "unavailable" ? (
              <>
                Search needs the built site: run <code>npm run build -w site</code>, then <code>npm run serve -w site</code>.
              </>
            ) : !query.trim() || state === "searching" ? (
              ""
            ) : hits.length === 0 ? (
              "Nothing matches. Try what it does, in other words."
            ) : (
              `${hits.length} ${hits.length === 1 ? "result" : "results"}`
            )}
          </p>
          <ul id="search-hits" role="listbox" aria-label="Results">
            {state !== "unavailable" &&
              hits.map((hit, index) => (
                <li key={hit.url} role="none">
                  <Link
                    id={`search-hit-${index}`}
                    role="option"
                    aria-selected={index === active}
                    href={hit.url}
                    onClick={close}
                    onMouseEnter={() => setActive(index)}
                    className={`block border-b border-sky-400/10 px-4 py-2.5 ${index === active ? "bg-cyan-400/10" : ""}`}
                  >
                    <span className="flex items-baseline gap-2">
                      {hit.kind && (
                        <span data-kind={hit.kind} className="border border-sky-400/35 px-1.5 font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-300">
                          {hit.kind}
                        </span>
                      )}
                      <span className="font-mono text-sm text-cyan-50">{hit.title}</span>
                    </span>
                    <span className="mt-1 block text-[13px] leading-snug text-slate-400">
                      <Excerpt html={hit.excerpt} />
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      </dialog>
    </>
  );
}
