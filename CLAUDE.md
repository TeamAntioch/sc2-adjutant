# sc2-adjutant

## Agent skills

### Issue tracker

Issues and specs are GitHub issues on TeamAntioch/sc2-adjutant, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Stacked PRs

Tickets ship as GitHub stacked PRs, one ticket per layer. Read `docs/agents/stacked-prs.md` before branching for a ticket, syncing a stack or touching `golden.json`.

### sc2-asset-catalog

The doodad catalog and the Doodad Finder are the public repo TeamAntioch/sc2-asset-catalog's, used here through its published packages at a pinned version. Read `docs/agents/asset-catalog.md` before changing either, or linking `../sc2-asset-catalog`.

## Where knowledge belongs

Product knowledge another author's assistant would need (Editor and Host behaviour, SC2 file-format and engine facts, cutscene and camera rules, taste) is documented in the repo: `docs/reference/`, a skill, a Host Adapter's docs or a Style Pack's knowledge. Assistant memory holds only what is personal to one author. When in doubt, document.

## Tutorials

Every feature a mapper uses can be learnt from a tutorial. A change that adds one comes with a new tutorial under `site/tutorials/`, or a change to an existing one, in the same change. Its tool calls are checked against the server's tools by the site's reference script, `npm run reference` in `site/` (the checks are in `site/scripts/tutorials.ts`).

## No Claude-written lines

Never write dialogue, Screenplay lines or scene text for this repo, not even for a tutorial, example, test fixture or doc. Use public-domain text copied word for word, with its source named (tutorial 4 uses *Hamlet* from Project Gutenberg), or lines the author gives you. Where neither exists yet, leave a `TODO(author)` placeholder. Anything derived from the lines, such as line counts, timings and shot lists, waits for the real text.

## Workspaces

An author's Missions live in their own Workspace, usually a repo of its own cloned beside this checkout; the example Campaign (`packages/core/examples/example-campaign`) shows the layout. Each Mission's Map Package is committed beside its Blueprint, as `missions/<id>/<Name>.SC2Map` with its `compile-record.json` (ADR-0010), and the author opens that package in the Editor. Compile it in place, from the Workspace's folder: `npm run compile-map -- missions/<id>/blueprint.json`, with no output folder. `npm run check` validates every Mission against the packages. A throwaway copy, such as a test Cinematic's map, goes under the Mission's git-ignored `output/`, never in a session scratchpad, which is wiped on restart. Opening one: `packages/plugin-host-macos/docs/macos-host.md`.
