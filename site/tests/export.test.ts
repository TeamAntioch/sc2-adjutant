// The static export, as `npm run build` leaves it in site/out/ (the test script builds first): the
// home page and one page behind each of the five tabs, each in the shell.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const OUT = new URL("../out/", import.meta.url);

const TABS = [
  { label: "Install", path: "install" },
  { label: "Tutorials", path: "tutorials" },
  { label: "Tools", path: "tools" },
  { label: "Skills", path: "skills" },
  { label: "Commands", path: "commands" },
];

function page(path: string): string {
  return readFileSync(new URL(path ? `${path}/index.html` : "index.html", OUT), "utf8");
}

describe("the static export", () => {
  it("has a home page and a page behind each tab", () => {
    expect(existsSync(new URL("index.html", OUT))).toBe(true);
    for (const tab of TABS) expect(existsSync(new URL(`${tab.path}/index.html`, OUT)), tab.path).toBe(true);
  });

  it("has the favicon, as SVG with an .ico and an Apple touch icon beside it, linked from each page", () => {
    for (const file of ["icon.svg", "favicon.ico", "apple-icon.png"]) expect(existsSync(new URL(file, OUT)), file).toBe(true);
    const head = /<head>.*?<\/head>/s.exec(page(""))?.[0] ?? "";
    expect(head).toMatch(/<link rel="icon" href="\/icon\.svg[^"]*"[^>]*type="image\/svg\+xml"/);
    expect(head).toMatch(/<link rel="icon" href="\/favicon\.ico[^"]*"/);
    expect(head).toMatch(/<link rel="apple-touch-icon" href="\/apple-icon\.png[^"]*"/);
  });

  it("shows every tab in each page's shell, the page's own tab marked current", () => {
    for (const current of TABS) {
      const html = page(current.path);
      const tabs = /<nav aria-label="Sections".*?<\/nav>/s.exec(html)?.[0] ?? "";
      for (const tab of TABS) expect(tabs, `${current.path} links ${tab.path}`).toContain(`href="/${tab.path}/"`);
      expect(tabs.match(/aria-current="page"/g), `${current.path} marks one tab`).toHaveLength(1);
      expect(tabs).toMatch(new RegExp(`<a[^>]*aria-current="page"[^>]*href="/${current.path}/"|<a[^>]*href="/${current.path}/"[^>]*aria-current="page"`));
    }
  });

  it("shows the core version it was built from", () => {
    const core = JSON.parse(readFileSync(new URL("../../packages/core/package.json", import.meta.url), "utf8")) as { version: string };
    for (const path of ["", ...TABS.map((tab) => tab.path)]) expect(page(path), path || "home").toContain(`sc2-adjutant ${core.version}`);
  });

  it("links to the mapping reference and the Plugin docs, and leaves a slot for search", () => {
    const html = page("");
    expect(html).toContain('href="https://screference.antioch.games"');
    expect(html).toContain('href="https://github.com/TeamAntioch/sc2-adjutant/blob/main/docs/plugin-api.md"');
    expect(html).toContain("data-search-slot");
  });

  it("has a page tree and an on-this-page column around each tab's page but the Tutorials'", () => {
    for (const tab of TABS.filter(({ path }) => path !== "tutorials")) {
      const html = page(tab.path);
      expect(html, tab.path).toContain('aria-label="Pages"');
      expect(html, tab.path).toContain('aria-label="On this page"');
    }
  });

  it("gives the Tutorials tab the Briefings layout instead: a mission-select grid, and no page tree", () => {
    const html = page("tutorials");
    expect(html).toContain('aria-label="Mission select"');
    expect(html).not.toContain('aria-label="Pages"');
  });

  it("gives a hand-written page's headings ids, for on-this-page links", () => {
    expect(page("install")).toContain('<h2 id="from-a-checkout">From a checkout</h2>');
  });
});
