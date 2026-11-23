import Link from "next/link";

import { commandHref, reference } from "@/lib/reference";

export const metadata = { title: "Commands" };

/** The Commands index: every slash command the Claude Code plugin ships, generated from its files (#978). */
export default function CommandsIndex() {
  const { commands } = reference();
  return (
    <>
      <h1>Commands</h1>
      <p>
        The {commands.length} slash commands in the Claude Code plugin. Type one in Claude Code, with what its argument hint asks for after it. Each page is generated from
        the command&apos;s own file.
      </p>
      <dl className="my-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(16rem,auto)_1fr]">
        {commands.map((command) => (
          <div key={command.slug} className="contents">
            <dt>
              <Link href={commandHref(command.slug)}>
                <code>
                  {command.invocation}
                  {command.argumentHint && ` ${command.argumentHint}`}
                </code>
              </Link>
            </dt>
            <dd className="text-slate-400">{command.description}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
