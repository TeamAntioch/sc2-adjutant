import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Prose, ToolList } from "@/components/tool-reference";
import { describedSkill, reference, skillNamed } from "@/lib/reference";
import { indexed } from "@/lib/search";

/** A page for each skill the reference lists, and no others. */
export const dynamicParams = false;

export function generateStaticParams() {
  return reference().skills.map((skill) => ({ slug: skill.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const skill = skillNamed(slug);
  return skill ? { title: skill.slug, description: describedSkill(skill.description).does } : {};
}

/** One skill's page, generated from its SKILL.md and reference files (#978). */
export default async function SkillPage({ params }: Props) {
  const { slug } = await params;
  const skill = skillNamed(slug);
  if (!skill) notFound();
  const { does, triggers } = describedSkill(skill.description);

  return (
    <div {...indexed("Skill")}>
      <div data-pagefind-ignore className="font-display text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
        <Link href="/skills/">Skill</Link>
      </div>
      <h1>
        <code className="normal-case !text-cyan-50">{skill.slug}</code>
      </h1>
      <p className="text-lg text-slate-300">
        <Prose text={does} />
      </p>

      <h2 id="triggers">When it triggers</h2>
      <p>Claude loads the skill on its own when the conversation fits its description{triggers ? ":" : "."}</p>
      {triggers && (
        <blockquote>
          <Prose text={triggers} />
        </blockquote>
      )}
      <p>
        To load it by name, type <code>{skill.invocation}</code>.
      </p>

      <h2 id="tools">Tools it drives</h2>
      {skill.tools.length > 0 ? (
        <>
          <p>The tools the skill names.</p>
          <ToolList names={skill.tools} />
        </>
      ) : (
        <p className="text-slate-400">It names no tool: it is knowledge for Claude to design with.</p>
      )}
    </div>
  );
}
