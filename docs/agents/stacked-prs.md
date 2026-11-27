# Stacked PRs

Tickets ship as GitHub stacked PRs, one ticket per layer, so each PR is one ticket's diff. Run every `gh stack` command the way the `gh-stack` skill says: non-interactive flags, `view --json` for state.

## Placing a ticket

A ticket is **ready** when each blocker is merged to `main` or is a layer of one open stack, and it isn't `ready-for-human`.

- Every blocker merged: start a new stack on `main`.
- Unmerged blockers all in one stack: add the ticket as that stack's new top layer.
- Unmerged blockers spread over several stacks: wait for merges.

Stacks are linear, so two tickets ready on the same top can't both sit on it. Put the second on top of the first when they touch the same area of the code; it rides one layer high, a dependency the graph doesn't have. Otherwise it waits for the shared blocker to merge and starts its own stack.

Name each stack after its area, and each branch `<stack>/<ticket>-<slug>`, for example `plugins/101-registry`.

## The golden

Core's golden test (`packages/core/tests/golden/reference-missions.test.ts`) compiles two frozen versions of a reference Mission in a fixture Workspace (`packages/core/tests/fixtures/workspaces/reference`), through its own Campaign Pack, Campaign Mod, the Antioch Style Pack and hazard, and compares every file of each Map Package, and the warnings, with that version's `golden.json`. `npm run update-golden` rewrites them. The fixture is frozen: change its Missions or its Campaign Pack only as an intended golden update. The Style Pack isn't frozen with it, so a change to its rules is one too.

- A ticket that moves code without meaning to change output keeps the golden green as it stands. A red golden there is a bug in the layer, not a golden to regenerate.
- A ticket that changes output on purpose runs `pnpm run update-golden`, commits `golden.json` in its own layer, and names the changed files and why in the PR body.
- A rebase conflict in `golden.json` takes either side, finishes the rebase, then reruns `pnpm run update-golden` in that layer and rebases upstack.

## Review and merge

Each layer is code-reviewed against the layer below before it's submitted, and its PR body follows the `pr` skill with `Closes #<ticket>`.

The author reviews and merges, bottom-up, with `gh stack merge` or on GitHub. Agents open, update and sync stacks; merging is the author's. After a merge, `gh stack sync --prune` rebases what's left, and any ticket whose PR merged but stayed open is closed by hand, since a closing keyword fires only on a PR whose base is `main` when it merges.
