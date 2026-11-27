// A tutorial's pieces (#980), in the Briefings layout. <You> is what the author types and <Claude>
// is Claude's reply. <ToolCall> is a tool call, linked to its tool page. <Objective> is a step,
// marked with the Host Adapters or Finders it needs. The MDX uses them by these names (mdx-components.tsx).
// The reference script has already checked each tool call against the server.
import Link from "next/link";
import type { ReactNode } from "react";

import { toolHref, toolNamed, type Tutorial } from "@/lib/reference";
import { objectiveId } from "@/lib/slug";

import { FinderChip, HostChip } from "./needs-chip";

/** The dashed box on a step that says what it needs. */
const NEEDS_NOTE = "!my-3 border border-dashed border-amber-400/55 px-3 py-2 text-[13px] text-amber-100";

/** The Install page's section on the Finders: what they need, the model they download and Jev's key. */
const RANKED_SEARCH_HREF = "/install/#optional-ranked-doodad-and-set-search";

const WHO = "pt-0.5 font-display text-[10px] font-semibold uppercase leading-[1.9] tracking-[0.16em]";

/** One turn of the session: who speaks, then what they say. */
function Turn({ who, children }: { who: "you" | "claude"; children: ReactNode }) {
  return (
    <div data-turn={who} className="my-3 grid max-w-[720px] grid-cols-[56px_minmax(0,1fr)] gap-2.5 text-[13.5px] sm:grid-cols-[68px_minmax(0,1fr)]">
      <div className={`${WHO} ${who === "you" ? "text-amber-400" : "text-cyan-400"}`}>{who === "you" ? "You" : "Claude"}</div>
      <div className="min-w-0 [&_p]:my-1.5 first:[&>*]:mt-0 last:[&>*]:mb-0">{children}</div>
    </div>
  );
}

/** What the author types to Claude: a request in plain words, or a slash command. */
export function You({ children }: { children: ReactNode }) {
  return <Turn who="you">{children}</Turn>;
}

/** Claude's reply, with the tool calls it makes. */
export function Claude({ children }: { children: ReactNode }) {
  return <Turn who="claude">{children}</Turn>;
}

/** An argument's value as a tool call writes it. */
const shown = (value: unknown) => JSON.stringify(value);
/** An object or array argument longer than this, as JSON, goes below the tool's line. */
const SHORT_OBJECT = 60;

/**
 * A tool call, as a panel: the tool, linked to its page, with its arguments and, as its children,
 * a few words on what it does here.
 */
export function ToolCall({ name, args = {}, children }: { name: string; args?: Record<string, unknown>; children?: ReactNode }) {
  const tool = toolNamed(name);
  // The reference script already refuses this; a page built from a stale reference.json shouldn't get by either.
  if (!tool) throw new Error(`<ToolCall name="${name}">: ${name} isn't a tool the server lists`);
  const entries = Object.entries(args);
  // Plain values and short objects go on the tool's line; a long object (a patch, say) sets the
  // arguments out below it.
  const flat = entries.every(([, value]) => value === null || typeof value !== "object" || shown(value).length <= SHORT_OBJECT);
  return (
    <div className="my-2 border border-sky-400/30 bg-sky-950/35 px-2.5 py-2 text-[12.5px]" data-tool-call={name}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href={toolHref(name)} className="!no-underline">
          <code className="!text-cyan-400">{name}</code>
        </Link>
        {flat && entries.length > 0 && (
          <span data-pagefind-ignore className="min-w-0 font-mono text-[12px] text-slate-300">
            {entries.map(([key, value], index) => (
              <span key={key}>
                {index > 0 && <span className="text-slate-500"> · </span>}
                {key}: <span className="text-cyan-200">{shown(value)}</span>
              </span>
            ))}
          </span>
        )}
        <span className="flex-1" />
        <Link href={toolHref(name)} data-pagefind-ignore className="whitespace-nowrap text-[11.5px]">
          tool page →
        </Link>
      </div>
      {!flat && <pre data-args data-pagefind-ignore className="mt-1.5 overflow-x-auto font-mono text-[12px] leading-relaxed text-cyan-200">{JSON.stringify(args, null, 2)}</pre>}
      {children && <div className="mt-1 text-slate-400 [&_p]:my-0">{children}</div>}
    </div>
  );
}

/**
 * One step of a tutorial: its number, its title and, when it needs a Host Adapter capability or a
 * Finder, a note saying which. The tutorial's page passes `tutorial`, where the step's number, Host
 * Adapters and Finders come from. `needs` is read there too, from what the reference script made of it.
 */
export function Objective({ id, title, tutorial, children }: { id?: string; title: string; needs?: string | string[]; tutorial: Tutorial; children: ReactNode }) {
  const anchor = objectiveId(id, title);
  const index = tutorial.objectives.findIndex((objective) => objective.id === anchor);
  const step = tutorial.objectives[index];
  if (!step) throw new Error(`${tutorial.file}: no objective ${anchor} in the reference; run pnpm --filter sc2-adjutant-site run reference`);
  return (
    <section id={step.id} className="scroll-mt-20 border-t border-sky-400/15 pt-7 first:border-t-0">
      <div className="font-display text-[11px] font-medium uppercase tracking-[0.3em] text-cyan-400/80">
        ◆ Objective {index + 1} of {tutorial.objectives.length}
      </div>
      <h2 className="objective-title">{step.title}</h2>
      {step.needs.length > 0 && (
        <p className={NEEDS_NOTE}>
          <HostChip step={step} /> This step needs a Host Adapter with{" "}
          {step.needs.map((need, at) => (
            <span key={need}>
              {at > 0 && " and "}
              <code>{need}</code>
            </span>
          ))}
          : the {step.hostAdapters.join(" or ")} one.
        </p>
      )}
      {step.finders.map((finder) => (
        <p key={finder} className={NEEDS_NOTE}>
          <FinderChip finder={finder} />{" "}
          {`This step needs the ${finder}: the server lists its tools only when core's optional ${finder} package is installed, as an npm install does unless optional dependencies are left out. `}
          <Link href={RANKED_SEARCH_HREF}>Ranked doodad and set search</Link> says what it needs, and how to give its ranker a key.
        </p>
      ))}
      {children}
    </section>
  );
}
