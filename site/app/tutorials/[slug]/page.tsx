import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ComponentProps } from "react";

import { Objective } from "@/components/briefing";
import { ObjectivesRail } from "@/components/objectives-rail";
import { briefingNumber, reference, tutorialHref, tutorialNamed } from "@/lib/reference";
import { indexed } from "@/lib/search";

/** A page for each tutorial in site/tutorials/, and no others. */
export const dynamicParams = false;

export function generateStaticParams() {
  return reference().tutorials.map((tutorial) => ({ slug: tutorial.slug }));
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const tutorial = tutorialNamed(slug);
  return tutorial ? { title: tutorial.title, description: tutorial.summary } : {};
}

/**
 * A tutorial in the Briefings layout (#980), inside the site's top tabs: the objectives rail on the
 * left, and the session on the right as the author's turns and Claude's tool calls.
 */
export default async function TutorialPage({ params }: Props) {
  const { slug } = await params;
  const tutorial = tutorialNamed(slug);
  if (!tutorial) notFound();
  // The import names the folder and the extension as literals, so the bundler packs only the MDX in site/tutorials/.
  const { default: Content } = (await import(`@/tutorials/${tutorial.file.replace(/\.mdx$/, "")}.mdx`)) as typeof import("*.mdx");
  // Each step finds its number and Host Adapters in the tutorial it's in.
  const components = { Objective: (props: Omit<ComponentProps<typeof Objective>, "tutorial">) => <Objective {...props} tutorial={tutorial} /> };

  return (
    <div className="mx-auto grid max-w-[1280px] grid-cols-1 md:grid-cols-[250px_minmax(0,1fr)]">
      <aside className="border-b border-sky-400/20 bg-[#0c1624]/60 px-4 py-5 md:border-b-0 md:border-r">
        <div className="md:sticky md:top-20">
          <ObjectivesRail
            tutorial={tutorial}
            tutorials={reference().tutorials.map((other) => ({ href: tutorialHref(other.slug), title: other.title, minutes: other.minutes, current: other.slug === slug }))}
          />
        </div>
      </aside>
      <article className="doc min-w-0 px-4 pb-10 pt-6 sm:px-8" {...indexed("Tutorial")}>
        <div data-pagefind-ignore className="font-display text-[11px] font-medium uppercase tracking-[0.3em] text-cyan-400/80">
          ◆ Briefing {briefingNumber(tutorial)} · {tutorial.minutes} min
        </div>
        <h1>{tutorial.title}</h1>
        <div className="my-3 h-px max-w-[420px] bg-gradient-to-r from-cyan-400/70 to-transparent" />
        <Content components={components} />
      </article>
    </div>
  );
}
