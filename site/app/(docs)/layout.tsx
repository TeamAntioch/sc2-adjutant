import { OnThisPage } from "@/components/on-this-page";
import { PageTree } from "@/components/page-tree";

/** Design A, "Console Docs": the page tree on the left, the page, and "on this page" on the right. */
export default function DocsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="mx-auto grid max-w-[1280px] grid-cols-1 md:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)_180px]">
      <aside className="hidden border-r border-sky-400/20 px-3.5 py-5 md:block">
        <PageTree />
      </aside>
      <article className="doc min-w-0 px-4 pb-10 pt-6 sm:px-8">{children}</article>
      <aside className="hidden border-l border-sky-400/20 px-3.5 py-6 xl:block">
        <OnThisPage />
      </aside>
    </div>
  );
}
