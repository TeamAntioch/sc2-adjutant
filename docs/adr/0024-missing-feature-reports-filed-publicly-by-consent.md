# Missing-Feature Reports Are Filed Publicly, by Consent, with No Relay

When Claude has to work around something sc2-adjutant can't do (a trigger the Blueprint can't declare, an Editor part no tool drives, a file the compile doesn't know about), the gap is found by the mapper's session and then lost. So the Claude Code plugin ships a skill, `report-missing-feature`, that offers to report the gap as a **Missing-Feature Report** and files it only when the mapper says yes (spec #923, decided by the author in a grilling on 2026-11-22):

- **The public repo, fixed.** Reports go to `TeamAntioch/sc2-adjutant`, the public repo #813 and #120 create, named as a constant in the skill. There is no setting to change it. A mapper can't see a private repo, and development moves to the public one, so reports land where the work is.
- **gh first, then a prefilled form.** With `gh` installed and logged in, Claude files with `gh issue create`. Otherwise it opens the repo's `missing-feature` issue form with each field filled from the URL, and the mapper submits it on GitHub. No service of ours stands between the mapper and GitHub, and no token is asked for.
- **Nothing sent without a yes, and the text seen first.** Claude offers once, at a pause after the workaround, and says the repo is public. If the mapper says yes, Claude shows the exact title and body, and files only what the mapper approves. The report describes the gap in the product's own terms. It leaves out Mission, Campaign and Workspace names, file paths, Screenplay text, invented names, map content, usernames and machine names. A snippet goes in only when the mapper agrees to that snippet.
- **Existing reports first.** Before drafting, Claude searches the repo's `missing-feature` issues. On a likely match, it offers to add this workaround to that issue instead. A match closed as done points the mapper to the version that has it, and one closed as `wontfix` ends the offer.
- **Two signals, neither of them a filing.** The skill's description covers the general case. A PostToolUse hook in the plugin notices a hand edit inside a Map Package or a Mod's package folder, the clearest sign that the compile is missing something, and reminds Claude of the skill at most once per Mission per session.
- **The maintainer is told by the GitHub Slack app**, subscribed to the repo's issues filtered to the `missing-feature` label. The public repo holds no Slack secret or workflow.
- **Triage is the maintainer's, outside the public tree.** Reports carry `needs-triage` and move through the usual triage labels. The skill that triages them and starts work on the accepted ones belongs to the maintainer's own tooling and doesn't ship.

## Considered Options

- **File to the private development repo.** Rejected: mappers can't see it, so they couldn't check for an existing report or follow theirs.
- **A hosted form or relay that files with a bot token.** Rejected: it's a service and a secret to keep running, it needs its own spam handling, and an anonymous report leaves no one to answer a question.
- **Ask the mapper for a GitHub token.** Rejected: too much to ask for a one-line report, and a token in a Workspace is a token to leak.
- **File automatically when a workaround happens.** Rejected: a public issue drawn from someone's map needs their yes, and their eyes on the text.
- **An Action that posts to a Slack webhook.** Rejected for now: the Slack app's label filter does the same with nothing to maintain. An Action is the route if the message ever needs triage hints.
- **Detect gaps only from MCP tools that refuse something as unsupported.** Deferred, not rejected: it would be a third signal, added once we see which refusals actually come up.
- **Ship the triage skill.** Rejected: it drives one maintainer's tooling and means nothing in another author's setup.

## Consequences

- The skill and hook ship with 0.1.0, since the repo they point at comes with it (#120).
- The public repo carries the `missing-feature` label and a `missing-feature` issue form. The form's field ids are the URL parameters the skill fills, so a test holds the two to the same ids.
- A report filed through `gh` can't use the form, so it uses the same headings in Markdown and sets both labels itself.
- The URL route is bound by GitHub's URL length. The skill keeps the body short and puts the full text on the clipboard when it won't fit.
