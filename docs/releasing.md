# Releasing

A release is one version bump and one tag. The tag publishes the six public npm packages from CI. The plugin ships from this repo, which is its marketplace, so it reaches mappers when the bump merges to `main`.

## 1. Bump the version in a pull request

Set one version, say `0.1.1`, in every one of these:

- each public package's `package.json` (the list and order are in `scripts/public-packages.mjs`)
- core's `dependencies` on the other public packages, which name the version exactly
- the plugin's `packages/claude-plugin/.claude-plugin/plugin.json` and `packages/claude-plugin/package.json`
- on a minor or major bump, each package's `peerDependencies` range on core (`^0.1.0` to `^0.2.0`)

Then run `pnpm install` so `pnpm-lock.yaml` matches.

The Publish workflow's pull-request run checks all of the above (`node scripts/publish-packages.mjs check`, which you can also run locally), then runs `npm publish --dry-run` for each package.

## 2. Tag the merge commit

After the pull request merges:

```sh
git switch main && git pull
git tag v0.1.1
git push origin v0.1.1
```

The tag starts the Publish workflow (`.github/workflows/publish.yml`). It refuses a tag that isn't `v` and the packages' version, runs `pnpm install`, the build and the tests, then publishes each package in order through npm's trusted publishing, so no token is needed. A package whose version is already on npm is skipped, so a run that failed partway can be re-run.

Watch it with `gh run watch`, then check one package with `npm view @team-antioch/sc2-adjutant version`.

## 3. The plugin

Claude Code updates an installed plugin when the `version` in its `plugin.json` changes. Mappers get it at Claude Code's next marketplace update, or straight away with `/plugin marketplace update sc2-adjutant`. A plugin change merged without a version bump reaches no one.

The plugin's MCP server runs the core installed in the mapper's Workspace, and warns when the plugin's and core's `major.minor` differ. After a minor or major release, mappers also update core in their Workspace.

## Trusted publishing

Each package's settings on npmjs.com name TeamAntioch / sc2-adjutant / `publish.yml` as its trusted publisher. A new public package has to be published by hand once (`npm publish --access public` from its folder) before it can be given a trusted publisher. Add it to `scripts/public-packages.mjs` first.
