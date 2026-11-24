import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Description, Fields } from "@/components/tool-reference";
import { indexed } from "@/lib/search";
import { commandHref, commandNamed, groupHref, reference, skillHref, toolNamed, tutorialHref, tutorialNamed, WRITES } from "@/lib/reference";

/** A page for each tool the reference lists, and no others. */
export const dynamicParams = false;

export function generateStaticParams() {
  return reference().tools.map((tool) => ({ name: tool.name }));
}

type Props = { params: Promise<{ name: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { name } = await params;
  const tool = toolNamed(name);
  return tool ? { title: tool.name, description: tool.title } : {};
}

/** One tool's page, generated from what the server lists for it (#977). */
export default async function ToolPage({ params }: Props) {
  const { name } = await params;
  const tool = toolNamed(name);
  if (!tool) notFound();
  const group = reference().groups.find((candidate) => candidate.id === tool.group);
  const { skills, commands, tutorials } = tool.usedBy;

  return (
    <div {...indexed("Tool")}>
      <div data-pagefind-ignore className="font-display text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
        <Link href={groupHref(tool.group)}>{group?.title ?? tool.group}</Link> tool
      </div>
      <h1>
        <code className="normal-case !text-cyan-50">{tool.name}</code>
      </h1>
      <p className="text-lg text-slate-300">{tool.title}</p>
      <Description text={tool.description} />

      <h2 id="inputs">Inputs</h2>
      {tool.inputs.length > 0 ? <Fields fields={tool.inputs} /> : <p>It takes no inputs.</p>}

      <h2 id="outputs">Outputs</h2>
      {tool.outputs.length > 0 ? (
        <>
          <p>Beside its text reply, the tool returns this structured result.</p>
          <Fields fields={tool.outputs} />
        </>
      ) : (
        <p>Its reply is text alone.</p>
      )}

      <h2 id="writes">Writes</h2>
      <p>{WRITES[tool.writes]}</p>

      <h2 id="needs">Needs</h2>
      {tool.needs.kind === "none" && <p>Nothing: the server lists it on every machine.</p>}
      {tool.needs.kind === "capability" && (
        <p>
          A Host Adapter with {tool.needs.capabilities.length === 1 ? "the capability " : "the capabilities "}
          {tool.needs.capabilities.map((capability, index) => (
            <span key={capability}>
              {index > 0 && ", "}
              <code>{capability}</code>
            </span>
          ))}
          . On a machine without it, the server doesn&apos;t list this tool.
        </p>
      )}
      {tool.needs.kind === "refused" && (
        <p>
          A Host Adapter with {tool.needs.capabilities.length === 1 ? "the capability " : "the capabilities "}
          {tool.needs.capabilities.map((capability, index) => (
            <span key={capability}>
              {index > 0 && ", "}
              <code>{capability}</code>
            </span>
          ))}
          . The server lists it on every machine, and on one without it refuses the call, saying what the machine lacks.
        </p>
      )}
      {tool.needs.kind === "finder" && <p>The {tool.needs.finder} package. Where it isn&apos;t installed, the server doesn&apos;t list this tool.</p>}

      <h2 id="cli-twin">CLI twin</h2>
      {tool.cli ? (
        <p>
          From a checkout, <code>{tool.cli}</code> does the same from the command line.
        </p>
      ) : (
        <p>None: it is only a tool.</p>
      )}

      <h2 id="used-by">Used by</h2>
      {skills.length + commands.length + tutorials.length === 0 ? (
        <p className="text-slate-400">No skill, command or tutorial names it yet.</p>
      ) : (
        // Weighted low in search, like a skill's list of tools: naming this tool isn't being about it.
        <ul data-pagefind-weight="0.5">
          {skills.map((skill) => (
            <li key={`skill-${skill}`}>
              Skill <Link href={skillHref(skill)}>{skill}</Link>
            </li>
          ))}
          {commands.map((command) => (
            <li key={`command-${command}`}>
              Command{" "}
              <Link href={commandHref(command)}>
                <code>{commandNamed(command)?.invocation}</code>
              </Link>
            </li>
          ))}
          {tutorials.map((tutorial) => (
            <li key={`tutorial-${tutorial}`}>
              Tutorial <Link href={tutorialHref(tutorial)}>{tutorialNamed(tutorial)?.title ?? tutorial}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
