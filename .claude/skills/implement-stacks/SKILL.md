---
name: implement-stacks
description: "Implements a spec's tickets as GitHub stacked PRs, one ticket per layer, working the frontier until it needs a merge. Use only when the user asks to implement a spec's tickets as stacked PRs, directly or through /loop."
---

You have a spec issue whose tickets form a task graph through GitHub's blocked-by links. Ship it as stacked PRs following `docs/agents/stacked-prs.md`, which holds the placement rules, the golden rules and the merge rules. Read it, and the `gh-stack` skill, before step 1.

You are the orchestrator. **Implementer subagents** build tickets; you place them, dispatch them and keep the stacks in sync. Brief subagents with **context pointers** (the ticket, the stack, the branch below, the docs) rather than restating them.

## Steps

1. **Read the graph.** Fetch the spec, every ticket under it, and each ticket's blockers (`gh api repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by`). Done when every open ticket has its blockers and labels in hand.

2. **Sync.** For each open stack, run `gh stack sync --prune` from the worktree that owns it. Close any ticket whose PR merged but stayed open. Done when `gh stack view --json` shows every stack current, with nothing `needsRebase`.

3. **Place the frontier.** Apply the placement rules to every open ticket. Done when each ready ticket has a stack and a branch below it (`main` for a new stack), and each waiting ticket names the merge it waits for.

4. **Dispatch.** Start one implementer subagent per stack you are growing, in the background, each in its own worktree. Give a stack one implementer at a time: a stack's layers build in order. Brief each one with the **implementer brief** below.

5. **Collect.** As each implementer reports, check its PR in `gh stack view --json` and remove its worktree so the branch is free for the next layer. When its stack has another ready ticket, dispatch it (step 4). Done when no ticket can start without a merge.

6. **Report.** For each stack, list its PRs bottom-up with links: the order the author reviews and merges them. Then list each waiting ticket and the merge that unblocks it, with `ready-for-human` tickets called out as the author's.

Under `/loop`, each run starts again at step 1.

## Implementer brief

Implement ticket #<n> as a new top layer of stack `<stack>`, on branch `<stack>/<n>-<slug>`, above `<branch below>`. Follow `docs/agents/stacked-prs.md`.

1. Fetch and state the ticket's title. Check out the branch below (`gh stack checkout`, or `gh stack init` on `main` for a new stack), then `gh stack add <branch>`.
2. Build it with the `tdd` skill at the seams the ticket and spec name. Run the typecheck and single test files as you go and the full suite at the end. Done when every acceptance criterion holds and the suite is green.
3. Review with the `code-review` skill against the branch below. Fix what it confirms. Done when every finding is fixed or listed with a reason in the PR body.
4. Commit, then `gh stack submit --auto --open`. Write the PR title and body with the `pr` skill, including `Closes #<n>`, and set them with `gh pr edit`.
5. Report back in a few lines: PR number, any `golden.json` change and why, and any review findings you left.
