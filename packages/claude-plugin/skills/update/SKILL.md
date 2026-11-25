---
name: update
description: Updates sc2-adjutant to its latest release, the Claude Code plugin and the core packages installed in the Workspace together, then asks the author to restart Claude Code so the new version loads. Use when the session start says a newer sc2-adjutant is out, when the MCP server warns that the plugin and core versions don't match, or when the author asks to update sc2-adjutant or whether it is up to date.
---

The plugin and core release together, at one version, so update both. Core is the npm package `@team-antioch/sc2-adjutant`, installed in the Workspace beside its Host Adapter and Utilities; the plugin comes from the sc2-adjutant marketplace. Nothing is changed before the author says yes, and Claude Code only loads the new plugin after a restart.

## 1. See where things stand

In the Workspace folder, run:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/status.mjs"
```

If the author set the plugin's `core_path` option, pass it with `--core <path>`. `claude plugin configure sc2-adjutant@sc2-adjutant` shows the option's value without changing it.

The script asks npm for the latest release and prints JSON:

- `latest`: the newest release's version.
- `plugin`: its `version`, whether it is `behind`, and `install`: `marketplace` (Claude Code's plugin cache), `checkout` (a clone of sc2-adjutant, through a local marketplace or `--plugin-dir`) or `other`.
- `core`: its `version`, `behind`, `folder` and `from`: the Workspace's `node_modules`, the `core_path` option or the checkout around the plugin.
- `packages`: the sc2-adjutant packages the Workspace's `package.json` names.
- `commands`: the commands that update what's behind, when the script can name them.
- `upToDate`: whether nothing is behind.

If it exits non-zero, npm couldn't be reached: say so, and stop. If `upToDate` is true, tell the author the versions, that they're on the latest release, and stop.

## 2. Ask

Tell the author what's behind, with each version and `latest`, and the commands you'll run. Ask before running them: they change the Workspace's `package.json` and lockfile, and the plugin Claude Code loads. Wait for the yes.

## 3. Update the plugin

First run `claude plugin list --json`. If its `sc2-adjutant@sc2-adjutant` entry has a `readFromFolder`, the marketplace is a local clone: treat the install as `checkout`, with that folder's repo as the checkout.

- `marketplace`: run `commands.plugin` in order: `claude plugin marketplace update sc2-adjutant`, then `claude plugin update sc2-adjutant@sc2-adjutant`. If the update asks to confirm a command the marketplace declares, show it to the author and run it again with `-y` only on their yes. Then `claude plugin list --json` shows the version installed under `sc2-adjutant@sc2-adjutant`.
- `checkout`: the plugin is the author's clone of sc2-adjutant, which may hold work of their own, so don't pull it. Tell them to run `git pull`, then `npm install` and `npm run build`, in that checkout. The same goes for core when `core.from` is the `core_path` option or the checkout around the plugin.
- `other`: say where the plugin is (`plugin.root`), and that it updates the way it was installed.

## 4. Update core

When `core.from` is the Workspace's `node_modules`, run `commands.workspace` in the Workspace folder. It names every package in `packages` at `latest` (`npm install @team-antioch/sc2-adjutant@<latest> …`), since `npm update` keeps to `package.json`'s `^0.x` ranges and never crosses a minor version. On Windows from PowerShell, type `npm.cmd`. Give it a timeout of 10 minutes. If it fails, pass on npm's error and stop before the restart.

Then run the script again: `core.version` should be `latest`. The plugin still shows its old version there, since the script runs from the old copy until the restart.

## 5. Restart

Tell the author the update is done, from which versions to which, and that Claude Code loads the new plugin, its MCP server and skills only when it starts again. Ask them to quit Claude Code and start it again in this folder: `claude --continue` picks this conversation back up. Don't reconnect the server through `/mcp` instead: it would start the new core from the old plugin.
