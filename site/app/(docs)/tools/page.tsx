import Link from "next/link";

import { reference, toolHref, toolNamed } from "@/lib/reference";

export const metadata = { title: "Tools" };

/** The Tools index: every MCP tool, by the group the server registers it in, generated from the server (#977). */
export default function ToolsIndex() {
  const { groups, tools } = reference();
  return (
    <>
      <h1>Tools</h1>
      <p>
        Every MCP tool the sc2-adjutant server gives Claude, {tools.length} in all. Each page is generated from the server itself, so it changes in the same pull request
        as the tool.
      </p>
      {groups.map((group) => (
        <section key={group.id}>
          <h2 id={group.id}>{group.title}</h2>
          <dl className="my-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[minmax(12rem,auto)_1fr]">
            {group.tools.map((name) => (
              <div key={name} className="contents">
                <dt>
                  <Link href={toolHref(name)}>
                    <code>{name}</code>
                  </Link>
                </dt>
                <dd className="text-slate-400">{toolNamed(name)?.title}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </>
  );
}
