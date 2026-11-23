---
name: report-missing-feature
description: Offers to report something sc2-adjutant can't do as a public Missing-Feature Report, and files it only after the mapper approves the exact text. Use after working around missing support (a trigger, Editor part or file the tools can't make or the compile doesn't know about, a hand edit inside a Map Package or a Mod's package, a request only partly met, a stock model's animations recorded in the Workspace because core lacks them), or when the mapper asks to report a missing feature.
---

A **Missing-Feature Report** is an issue in sc2-adjutant's public repo, `TeamAntioch/sc2-adjutant`, saying what sc2-adjutant couldn't do and how the work got around it. Reports always go to that repo. It is public, so the report describes the gap in sc2-adjutant's own terms and carries nothing of the mapper's map. Every step runs on the mapper's yes: nothing is searched for, drafted or filed before it.

The script `${CLAUDE_SKILL_DIR}/scripts/report.mjs` turns a JSON draft into what is filed, so the encoding is the script's. Run it with `node`, from the session's working folder, and write the draft to a file in the OS's temp folder, never in the Workspace:

```json
{ "title": "<capability>", "missing": "…", "workaround": "…", "suggestion": "…", "context": "…", "environment": "…" }
```

Its keys are the issue form's field ids, and each value is a string. `title`, `missing` and `workaround` are required.

## 1. Offer

Offer once per gap per session, at a natural pause after the workaround, when the task in hand is done or waiting on the mapper. Say what wasn't supported and that the report goes to a public repo, in words like: "It looks like sc2-adjutant doesn't support this right now. Would you like to report it? The report goes to sc2-adjutant's public GitHub repo, and I'll show you its text first."

A no ends it for that gap for the rest of the session. A yes moves to step 2. The mapper asking to report a gap counts as the yes.

## 2. Look for an existing report

Pick two to four key terms for the gap in sc2-adjutant's terms. Search the repo's reports, open and closed. With `gh` installed and logged in (`gh auth status` succeeds):

```sh
gh issue list --repo TeamAntioch/sc2-adjutant --label missing-feature --state all --search "<terms>" --json number,title,state,stateReason,labels,url
```

Without it, fetch `https://api.github.com/search/issues?q=repo:TeamAntioch/sc2-adjutant+label:missing-feature+<terms>` (terms joined with `+`), which needs no login.

Read the likely matches, then:

| Match | What to do |
|---|---|
| None | Step 3 |
| An open report of the same gap | Offer to add this workaround to it as a comment instead. On a yes, draft as in step 3 and file as a comment in step 5 |
| Closed as done (`stateReason` `COMPLETED`, no `wontfix` label) | Find the version that has it from the issue's comments and closing pull request, name it, and suggest updating sc2-adjutant. File nothing |
| Closed as a duplicate | Follow its link to the report it duplicates, and use that report's row |
| Closed with the `wontfix` label, or as not planned | Say it was declined, with the reason the issue gives. File nothing |

This step is done when each likely match has been read and one row applies.

## 3. Draft

| Key | Holds |
|---|---|
| `title` | The missing capability, in a few words. The script puts `Missing: ` before it |
| `missing` | What sc2-adjutant couldn't do, in its own terms (a Blueprint key, a tool, a part of the compile) |
| `workaround` | What was done instead: a hand edit in the Map Package, a part left to the Editor, a request only partly met |
| `suggestion` | What support could look like, if there's a clear idea. Optional |
| `context` | Where it came up: the Co-design Stage or the tool |
| `environment` | The output of `node "${CLAUDE_SKILL_DIR}/scripts/report.mjs" environment <core version>`, with core's version from the last line of the sc2-adjutant server's `list_plugins` (`sc2-adjutant core <version>`). Without the server, or with a server that doesn't name it, run it with no version: it names the core it finds from the working folder, which may not be the one the server runs |

The draft leaves out the mapper's Mission, Campaign and Workspace names, file paths, Screenplay text, the unit and character names they invented, map content, usernames and machine names. Write `<placeholder>` names in their place. A snippet (a piece of trigger, an XML entry) goes in only when the mapper agrees to that snippet, with placeholder names.

Then check the draft:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/report.mjs" check <draft.json>
```

It lists the paths, file names in paths, Map Package and Mod names, long quotes (double, single or backtick) and Workspace names (the Campaign's, its Missions' titles and folders, its mods' and its local Plugins') it finds, each with its field, and exits 1 when there are any. Rewrite each one that is the mapper's with a placeholder, or drop it, and check again. Some finds are the game's or sc2-adjutant's own, such as a game data file's path or a Workspace name that is also a plain word in the sentence, and those stay. The check only finds what has a shape, so also reread the draft for the rest of the list above. It exits 2 on an error instead, such as a draft that isn't valid JSON, lacks a required field or holds a value that isn't a string: fix the draft as the error says and check again. An error naming the Workspace config isn't the draft's: say the Workspace's names couldn't be checked, and reread the draft for them by hand. This step is done when every find left is the game's or sc2-adjutant's own and the reread finds nothing.

## 4. Show the exact text

```sh
node "${CLAUDE_SKILL_DIR}/scripts/report.mjs" preview <draft.json>
```

For a comment on an existing report, add `--comment`: it prints the body alone, which is all a comment posts, and a comment's draft needs no `title`.

Show its output to the mapper unchanged, in a code block, with the repo it goes to. Ask them to approve it, edit it or cancel. An edit goes back into the draft, through `check`, and is shown again. A cancel ends it, and nothing is filed. This step is done when the mapper has approved the text they were last shown.

## 5. File

With `gh` installed and logged in, the script adds a comment to an existing report (step 2) and prints its URL:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/report.mjs" comment <issue number> <draft.json>
```

A new report goes by the route `node "${CLAUDE_SKILL_DIR}/scripts/report.mjs" route` prints. GitHub keeps the labels a new issue is filed with only from a user with push access to the repo (write, maintain or admin; triage isn't enough), and the form's labels apply for anyone, so:

- **`gh`:** the mapper can push to the repo. The script files it and prints the new issue's URL: `node "${CLAUDE_SKILL_DIR}/scripts/report.mjs" file <draft.json>`. It files nothing, and exits 3, if the access is gone by then; take the form route.
- **`form`:** no push access, or `gh` couldn't tell. The mapper files it with the form, as below.

Give the mapper the link.

On the `form` route, or without `gh`, the mapper files it on GitHub:

- **A new report:** run `node "${CLAUDE_SKILL_DIR}/scripts/report.mjs" url <draft.json>`. It prints `url`, the issue form filled from the draft, and `leftOut`, the fields the URL doesn't carry. Open `url` with the OS's opener and give the mapper the link too. The form's Submit button is theirs to press.
- **A comment:** open the existing report's page, and put the text from `preview <draft.json> --comment` on the clipboard for the mapper to paste.

The URL is percent-encoded, quotes included, so single quotes hold it. Openers and clipboard tools by OS:

| OS | Open | Clipboard |
|---|---|---|
| macOS | `open '<url>'` | `… \| pbcopy` |
| Windows | `powershell -NoProfile -Command "Start-Process '<url>'"` | Save the text to a file, then `powershell -NoProfile -Command "Get-Content -Raw -Encoding UTF8 '<file>' \| Set-Clipboard"` |
| Linux | `xdg-open '<url>'` | `… \| wl-copy`, or `… \| xclip -selection clipboard` |

When `leftOut` isn't empty, the report was too long for a URL. `node "${CLAUDE_SKILL_DIR}/scripts/report.mjs" clipboard <draft.json>` prints the text the form is missing; put it on the clipboard. When only `suggestion` is left out, it's that field's text: tell the mapper to paste it into "What support could look like". When every field is left out, it's the whole body, without the title the form already has: show it in a code block, one field under each heading, and tell the mapper to copy each into the form's box of that name. When no clipboard tool works, show the text in a code block for them to copy.

This step is done when the mapper has the issue's link, or the form is open with everything it doesn't carry on their clipboard or in front of them.

## Stock model animations

A Cinematic can cast a speaker only on a model whose animations are recorded. When core doesn't record a game model, the mapper records it in the Workspace's root `model-anims.json` with `record_model_anims`, or with `npm run model-anims`. Both list the stock models core lacks in a line that says to offer a Missing-Feature Report. That recording is the workaround, and core could carry the models for everyone, so it's a gap to offer. Make one offer per session, at a pause after the recording, covering every stock model recorded so far. A model recorded after that offer was answered isn't offered again this session.

Search with the terms `model animations`, and read which models each match names. Step 2's rows apply per model:
- An open report for stock model animations gets a comment naming the models it lacks.
- A report closed as done covers only the models it names. For those, suggest updating sc2-adjutant. File the rest as a new report.

Model ids are the game's, so they go in the report. The draft follows this shape, with the session's models in place of these:

```json
{
  "title": "Animations for stock models",
  "missing": "Core's recorded model animations don't include SMX3_Marine or SMX3_Tech, so a Cinematic can't cast a speaker on them until a Workspace records them.",
  "workaround": "Recorded them in the Workspace's root model-anims.json with record_model_anims.",
  "suggestion": "Record them in core's model animations, so every Workspace can cast them.",
  "context": "Casting a Cinematic"
}
```

Add `environment` as step 3 says.
