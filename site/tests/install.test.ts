// The Install page (#979, #999), as `npm run build` leaves it in site/out/: setup inside Claude Code,
// then the npx route from a terminal, with a macOS and a Windows variant of each machine-specific
// step, both in the exported HTML so the page works without JavaScript, and the optional
// ranked-search section that tutorial 2 links to.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { OSES, type Os } from "../lib/os";

const OUT = new URL("../out/", import.meta.url);

const page = (path: string) => readFileSync(new URL(`${path}/index.html`, OUT), "utf8");

/** HTML's text: tags dropped, the entities React writes decoded. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * Each block for one machine, as HTML. A block holds no <div>, so each ends at the first </div>.
 * The test of the exported HTML checks that no block ends inside a code block, so one cut short fails.
 */
const blocksFor = (html: string, os: Os) => [...html.matchAll(new RegExp(`<div[^>]*data-for-os="${os}"[^>]*>(.*?)</div>`, "gs"))].map((match) => match[1]!);

/** The text of every block for one machine. */
const forOs = (html: string, os: Os) => blocksFor(html, os).map(text).join("\n");

describe("the Install page", () => {
  const html = page("install");

  it("leads with setup inside Claude Code, in the order #999 gives", () => {
    const order = [
      'href="https://claude.com/claude-code"',
      'href="https://nodejs.org/"',
      "22.18 or later",
      "claude\n</code>",
      "/plugin marketplace add TeamAntioch/sc2-adjutant",
      "/plugin install sc2-adjutant@sc2-adjutant",
      "/sc2-adjutant:init\n</code>",
      "<code>/mcp</code>, select <code>plugin:sc2-adjutant:sc2-adjutant</code> and reconnect it",
      "/sc2-adjutant:co-design ashfall-relay",
    ];
    const at = order.map((marker) => html.indexOf(marker, html.indexOf('id="install-in-claude-code"')));
    for (const [index, marker] of order.entries()) expect(at[index], marker).toBeGreaterThan(index ? at[index - 1]! : html.indexOf('id="install-in-claude-code"'));
    expect(at.at(-1)).toBeLessThan(html.indexOf('id="from-a-terminal"'));
  });

  it("keeps the npx route as a short note from a terminal, before the route from a checkout", () => {
    const terminal = html.slice(html.indexOf('id="from-a-terminal"'), html.indexOf('id="updating"'));
    expect(html.indexOf('id="from-a-terminal"')).toBeGreaterThan(-1);
    for (const command of ["claude plugin marketplace add TeamAntioch/sc2-adjutant", "claude plugin install sc2-adjutant@sc2-adjutant", "npx @team-antioch/sc2-adjutant init my-campaign", "npx.cmd @team-antioch/sc2-adjutant init my-campaign"]) {
      expect(terminal, command).toContain(command);
    }
    const before = html.slice(0, html.indexOf('id="from-a-terminal"'));
    expect(before).not.toContain("npx @team-antioch/sc2-adjutant init");
    expect(html.indexOf('id="from-a-terminal"')).toBeLessThan(html.indexOf('id="from-a-checkout"'));
  });

  it("has the macOS commands and paths", () => {
    const mac = forOs(html, "macos");
    expect(mac).toContain("npx @team-antioch/sc2-adjutant init my-campaign");
    expect(mac).toContain("@team-antioch/sc2-adjutant-host-macos");
    expect(mac).toContain('"hostAdapter": "bundled:host-macos"');
    expect(mac).toContain("~/.config/sc2-adjutant/machine.json");
    expect(mac).not.toContain("npx.cmd");
  });

  it("has the Windows commands and paths", () => {
    const windows = forOs(html, "windows");
    expect(windows).toContain("npx.cmd @team-antioch/sc2-adjutant init my-campaign");
    expect(windows).toContain("@team-antioch/sc2-adjutant-host-windows");
    expect(windows).toContain('"hostAdapter": "bundled:host-windows"');
    expect(windows).toContain("%APPDATA%\\sc2-adjutant\\machine.json");
    expect(windows).not.toContain("host-macos");
  });

  it("shows both machines' steps in the exported HTML, each block whole, so the page works without JavaScript", () => {
    // Only the head script hides one machine's blocks, by setting data-os on <html> in the browser.
    expect(html).not.toMatch(/<html[^>]*data-os=/);
    const [mac, windows] = OSES.map((os) => blocksFor(html, os));
    expect(mac!.length).toBeGreaterThan(0);
    expect(windows!.length).toBe(mac!.length);
    for (const os of OSES) {
      const blocks = blocksFor(html, os);
      // Every block's text is all there: none ends inside a code block.
      for (const block of blocks) expect((block.match(/<pre/g) ?? []).length, os).toBe((block.match(/<\/pre>/g) ?? []).length);
      expect(html.match(new RegExp(`data-for-os="${os}"`, "g"))?.length, os).toBe(blocks.length);
    }
  });

  it("says what each error the server prints means, by its printed words", () => {
    for (const printed of [
      "isn't in a Workspace: no sc2-adjutant.workspace.json in it or any folder above it.",
      "Make one here with /sc2-adjutant:init, or open Claude Code in a Workspace folder. From a terminal, npx @team-antioch/sc2-adjutant init <folder> makes one too.",
      "Couldn't find sc2-adjutant core. Looked in:",
      "Run npm install in the Workspace folder, which installs core there.",
      "but it isn't built: no",
      "sc2-adjutant: warning: the plugin and core versions don't match.",
      "which core can't find: install it beside sc2-adjutant",
      "Invalid machine config",
      "Unknown file extension",
    ]) {
      expect(text(html), printed).toContain(printed);
    }
  });

  it("has the optional ranked-search section, which links to the asset catalog's README for the details", () => {
    expect(html).toContain('id="optional-ranked-doodad-and-set-search"');
    const section = html.slice(html.indexOf('id="optional-ranked-doodad-and-set-search"'), html.indexOf('id="from-a-checkout"'));
    expect(section).toContain('href="https://github.com/TeamAntioch/sc2-asset-catalog#ranking-with-jev"');
    expect(section).toContain('href="https://github.com/TeamAntioch/sc2-asset-catalog#the-cache-folder"');
    for (const point of ["find_doodads", "open_doodad_finder", "find_sets", "--omit=optional", "gte-small", "Visual C++ Redistributable", "npx @team-antioch/sc2-doodad-finder login", "TYPESAFE_API_KEY", "--budget", "ranker-payloads/"]) {
      expect(section, point).toContain(point);
    }
  });
});

describe("tutorial 1, Your first Mission", () => {
  it("starts the Workspace with /sc2-adjutant:init, linked to its page, not with npx", () => {
    const html = page("tutorials/first-mission");
    const first = /<section id="workspace"[^>]*>(.*?)<\/section>/s.exec(html)?.[1] ?? "";
    expect(first).toContain("/sc2-adjutant:init");
    expect(first).toContain('href="/commands/init/"');
    expect(html).not.toContain("npx @team-antioch/sc2-adjutant init");
  });
});

describe("tutorial 2, Finding doodads", () => {
  it("links each of its Finder steps to the install page's ranked-search section", () => {
    const html = page("tutorials/finding-doodads");
    const steps = [...html.matchAll(/<section id="([^"]+)"[^>]*>(.*?)<\/section>/gs)].filter(([, , body]) => body!.includes("This step needs the Doodad Finder"));
    expect(steps.length).toBeGreaterThan(0);
    for (const [, id, body] of steps) expect(body, id).toContain('href="/install/#optional-ranked-doodad-and-set-search"');
  });
});

describe("the Claude Code plugin's README", () => {
  const readme = readFileSync(new URL("../../packages/claude-plugin/README.md", import.meta.url), "utf8");

  it("has no Install section of its own, and links to the site's", () => {
    expect(readme).not.toMatch(/^## Install\b/m);
    expect(readme).toContain("https://adjutant.antioch.games/install/");
  });
});
