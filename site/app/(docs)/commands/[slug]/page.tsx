import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ToolList } from "@/components/tool-reference";
import { asSentence, commandNamed, reference } from "@/lib/reference";
import { indexed } from "@/lib/search";

/** A page for each command the reference lists, and no others. */
export const dynamicParams = false;

export function generateStaticParams() {
  return reference().commands.map((command) => ({ slug: command.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const command = commandNamed(slug);
  return command ? { title: command.invocation, description: command.description } : {};
}

/** One command's page, generated from its file in the plugin's commands (#978). */
export default async function CommandPage({ params }: Props) {
  const { slug } = await params;
  const command = commandNamed(slug);
  if (!command) notFound();

  return (
    <div {...indexed("Command")}>
      <div data-pagefind-ignore className="font-display text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
        <Link href="/commands/">Command</Link>
      </div>
      <h1>
        <code className="normal-case !text-cyan-50">{command.invocation}</code>
      </h1>
      <p className="text-lg text-slate-300">{asSentence(command.description)}</p>

      <h2 id="triggers">When it runs</h2>
      <p>
        When you type <code>{command.invocation}</code> in Claude Code.{" "}
        {command.modelInvocable
          ? "Claude may also run it on its own when the conversation calls for it."
          : "Only you can run it: Claude doesn't run it on its own."}
      </p>

      <h2 id="arguments">Arguments</h2>
      {command.argumentHint ? (
        <>
          <pre>
            <code>
              {command.invocation} {command.argumentHint}
            </code>
          </pre>
          <p className="text-slate-400">
            Angle brackets mark what it needs, square brackets what it can do without.
          </p>
        </>
      ) : (
        <p>None: type the command alone.</p>
      )}

      <h2 id="tools">Tools it drives</h2>
      {command.tools.length > 0 && <ToolList names={command.tools} noted={command.allowedTools} note="called without asking" />}
      {command.tools.length === 0 && command.claudeCodeTools.length === 0 && <p className="text-slate-400">It names no tool.</p>}
      {command.claudeCodeTools.length > 0 && (
        <>
          {command.tools.length === 0 && <p>It drives none of the server&apos;s tools, so it works before the server has started.</p>}
          <p>The Claude Code tools it runs without asking:</p>
          <ul>
            {command.claudeCodeTools.map((tool) => (
              <li key={tool}>
                <code>{tool}</code>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
