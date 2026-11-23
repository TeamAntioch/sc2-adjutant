import Link from "next/link";

import { Prose } from "@/components/tool-reference";
import { describedSkill, reference, skillHref } from "@/lib/reference";
import { PLUGIN_DOCS_URL } from "@/lib/site";

export const metadata = { title: "Skills" };

/** The Skills index: every skill the Claude Code plugin ships, generated from its files (#978). */
export default function SkillsIndex() {
  const { skills } = reference();
  return (
    <>
      <h1>Skills</h1>
      <p>
        The {skills.length} skills in the Claude Code plugin. Claude reaches for a skill when the conversation fits its description, and the skill says which tools to
        drive. Each page is generated from the skill&apos;s own files.
      </p>
      <dl className="my-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(12rem,auto)_1fr]">
        {skills.map((skill) => (
          <div key={skill.slug} className="contents">
            <dt>
              <Link href={skillHref(skill.slug)}>{skill.slug}</Link>
            </dt>
            <dd className="text-slate-400">
              <Prose text={describedSkill(skill.description).does} />
            </dd>
          </div>
        ))}
      </dl>

      <h2 id="writing-your-own">Writing your own</h2>
      <p>
        Plugins can add skills of their own. See the <a href={PLUGIN_DOCS_URL}>Plugin docs</a>.
      </p>
    </>
  );
}
