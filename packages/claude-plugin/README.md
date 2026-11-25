# sc2-adjutant for Claude Code

The Claude Code plugin for sc2-adjutant. It wraps sc2-adjutant's MCP server with the co-design skills and commands for the co-design session. Open Claude Code in a **Workspace** and the plugin serves that Workspace.

To install it, follow [the install page](https://adjutant.antioch.games/install/): the npm route, a Workspace from `init`, checking the server and its errors, and the route from a checkout.

| Part | What it is |
|---|---|
| `.claude-plugin/plugin.json` | The manifest. It starts the MCP server as `node ${CLAUDE_PLUGIN_ROOT}/server/start.mjs ${CLAUDE_PROJECT_DIR}` |
| `server/` | The launcher: it finds the Workspace and sc2-adjutant core, then runs core's server (`sc2-adjutant-mcp`) following the session's working folder |
| `skills/` | `level-design`, `hero-mission-design`, `encounter-design`, `ally-design`, `exemplar-design`, `style-pack-builder`, `texture-sets`, `doodad-search`, `custom-doodads`, `cinematography`, `boss-design`, `boss-build`, `forecast-attacks` and `sound-mix` for Missions, `melee-design` for Melee Maps, `report-missing-feature` ([below](#reporting-a-missing-feature)), and `update` ([below](#updating)) |
| `commands/` | The co-design commands below |
| `hooks/` | The SessionStart hooks that check for a newer release ([below](#updating)) and copy the Workspace's Plugins' skills into it ([below](#skills-from-the-workspaces-plugins)), and the PostToolUse hook that notices a hand edit inside a compiled package ([below](#reporting-a-missing-feature)) |

## Commands

Each command but `init` drives the server's tools, and none holds design knowledge of its own; the skills and the active Plugins' knowledge carry that.

| Command | What it does |
|---|---|
| `/sc2-adjutant:init` | Starts a new Campaign: checks Node and the folder, runs `init` (with `npx`) here or in a new subfolder, and says how to start the server in the new Workspace. It uses only Bash, so it works before the server can start |
| `/sc2-adjutant:co-design [mission]` | Starts or resumes a Mission's co-design: reads `get_session_state`, says the Co-design Stage and what's next, and does it with the skill for that Stage |
| `/sc2-adjutant:sign-off <mission> [note]` | Signs off the Stage the Mission is at with `sign_off_stage`, after the author confirms |
| `/sc2-adjutant:reopen <mission> <stage> <why>` | Takes the Mission back to an earlier, signed-off Stage with `reopen_stage`, after the author confirms. That Stage and every later one need signing off again; their old sign-offs are kept, superseded |
| `/sc2-adjutant:check` | Checks every Mission in the Workspace with `check_workspace` |
| `/sc2-adjutant:compile <mission> [folder for the Map Package]` | Compiles the Mission's Map Package with `compile_map` |
| `/sc2-adjutant:test <mission>` | Compiles and plays the Mission through the Editor's Test Document with `test_mission`, or hands the steps to the author |

`init`, `sign-off`, `reopen` and `test` run only when you type them: Claude never makes a Workspace, signs a Stage off, reopens one or starts the game by itself. The commands pre-approve only the server's read-only tools, and `init` the shell commands it runs; a tool that writes (a sign-off, a reopening, a Blueprint edit, a compile) asks first, as any MCP tool does.

The skills read the Workspace's Style Pack and Campaign Pack through the server: `list_plugins`, the knowledge resources (`sc2-adjutant://plugins/<plugin>/knowledge/<id>`) and the Plugins' prompts. They never open a pack's files, so they work with a pack wherever it is installed. `tests/skills.test.ts` holds them to that, and to holding nothing of any one author's campaign, words or machine.

## How the server finds its Workspace and core

The Workspace is the project Claude Code has open, or the nearest folder above it with a `sc2-adjutant.workspace.json`, so a session opened in a Mission's folder serves its Workspace. Without one, the server doesn't start, and `/mcp` shows why; `/sc2-adjutant:init` makes one.

The server then follows the session's working folder. Claude Code lists the folder it is working in as the first of its MCP roots, and moves it when the session enters or leaves a git worktree (`EnterWorktree`, `ExitWorktree`). The launcher starts core's server with `--follow-roots`, which asks for the roots at each call and serves the Workspace at or above the first one, so a Mission that exists only in the worktree is there to read and edit. Only the first root counts; folders added with `--add-dir` are ignored. The Workspace found from the project folder serves when the client lists no roots, or none has a Workspace above it, and the last Workspace serves if the client doesn't answer. A session that reaches a worktree without moving its roots (a folder added with `--add-dir`, or a `cd` in a shell) names it per call: every tool takes an optional `workspace`, a Workspace folder, a git worktree of one, or any folder inside either, and that call reads and writes there instead. `workspace` must be absolute, and it covers tool calls only: the Plugin knowledge resources and prompts follow the session's roots. Plugin folders a worktree doesn't hold are still looked up in the main checkout. A Plugin's code is still imported once per process, so an edit to it needs `/reload-plugins`.

Core is the first of:

1. the `core_path` option: a checkout of sc2-adjutant, or its `packages/core` folder
2. `@team-antioch/sc2-adjutant` installed in the Workspace (its `node_modules`)
3. the sc2-adjutant checkout the plugin is in (`../core`), as with a local marketplace or `--plugin-dir`

When none holds a built core, the server's error lists where it looked and what to do.

The plugin and core release together, at the same version. When the core it finds has a different major or minor version from the plugin's (`.claude-plugin/plugin.json`), or has no version it can read, the launcher prints a warning to the server's log (`/mcp`), with both versions and how to update each, and starts the server anyway. A different patch version is fine. [Updating](#updating) brings both onto the latest release.

## Updating

At each session start in a Workspace, `hooks/update-check.mjs` compares the plugin's version and the Workspace's core with the newest release, core's `latest` on npm (`server/versions.mjs`). It asks npm at most every 12 hours, caching the answer in the OS's temp folder, and sends nothing but the package's name. When either is behind, the author sees one line saying so and Claude is told to offer the `update` skill once; when both are current, only Claude is told, so it can answer "am I up to date?". Outside a Workspace, offline, or with `SC2_ADJUTANT_NO_UPDATE_CHECK` set, it says nothing.

The `update` skill (`/sc2-adjutant:update`) runs `skills/update/scripts/status.mjs`, which asks npm afresh and names the commands for what's behind. After the author's yes, it updates a plugin installed from the marketplace with `claude plugin marketplace update sc2-adjutant` and `claude plugin update sc2-adjutant@sc2-adjutant`, and the Workspace's sc2-adjutant packages with `npm install <package>@<latest> …`. `npm update` alone isn't enough: the Workspace's `^0.x` ranges never cross a minor version. A plugin or core from a checkout is the author's to pull. Then it asks the author to restart Claude Code, since the new plugin, its server and skills load only at start.

## When the server doesn't start

`/mcp` shows a server that failed as failed, with the launcher's error. Claude Code also keeps each MCP server's log; on macOS it's under `~/Library/Caches/claude-cli-nodejs/<project folder>/mcp-logs-plugin-sc2-adjutant-sc2-adjutant/`.

- **"Connection closed" from a checkout's core** usually means stale builds. Core refuses a checkout's Plugin package whose source is newer than its `dist/` (`packages/core/src/plugins/built-package.ts`), and a bundled Plugin refused that way stops the server. So does a `node_modules` holding an old `@team-antioch/sc2-asset-catalog`, or a core `dist/` missing exports newer Plugins use. Run `npm install && npm run build` in the checkout; `dist/` isn't committed, so a pull alone doesn't rebuild it.
- **A Plugin's load error shows only on a tool call.** The server can start and still fail to load a Plugin, so call `list_plugins` to see it.
- **Reconnect after fixing it.** `/reload-plugins` doesn't retry a failed MCP server; use `/mcp` and Reconnect.
- **A compile refusing what main already handles** means the core the server runs is older than main, such as a shared checkout left on an old commit. Build core in an up-to-date worktree and run its CLI from there (`node <checkout>/packages/core/dist/cli/compile-map.js <blueprint>`), or point `core_path` at that worktree.

## Skills from the Workspace's Plugins

A Plugin the Workspace lists (its Campaign Pack, Style Pack, a Utility or any other) can contribute skills ([ADR-0023](https://github.com/TeamAntioch/sc2-adjutant/blob/main/docs/adr/0023-utility-plugin-role.md)). A Claude Code plugin's own skills are fixed folders inside it, so these reach Claude Code another way: at each session start, `hooks/copy-skills.mjs` finds the Workspace and core as the launcher does, and core copies each listed Plugin's skill folders into `<workspace>/.claude/skills/`, where Claude Code finds project skills. It then asks Claude Code to reload its skills (`reloadSkills`), so they load in that session.

- Each copy is named for its Plugin: Plugin `example-pack`'s skill folder `dressing-review` is copied as `.claude/skills/example-pack-dressing-review/`, with its `SKILL.md`'s `name:` set to match, so two Plugins' skills don't meet. A skill already named as its Plugin is, or starting with its Plugin's name and a hyphen, keeps its name. A scoped Plugin name such as `@scope/x` gives `scope-x-`. `list_plugins` shows each skill by the name it's copied as.
- Each copy holds a marker file, `.sc2-adjutant-skill.json`. Only marked folders are refreshed or removed: a skill folder of your own is never touched, even one with the name a Plugin skill is copied as (that skill is then not copied, and the session start says so). A marked copy under a name no skill is copied as any more, such as one made before copies were named for their Plugin, is removed.
- A copy whose Plugin the Workspace no longer lists, or whose skill it no longer contributes, is removed. One whose files haven't changed is left as it is.
- The copies are listed in the Workspace's `.gitignore`, in a block the hook rewrites, so they aren't committed.
- Files are copied, never linked, so it works on Windows without Developer Mode. `{{PLUGIN_FOLDER}}` in a skill's Markdown is filled in with the Plugin's folder, so the skill runs its scripts from the installed Plugin. Python's `__pycache__` folders and `.pyc` files are left out, so running a skill's scripts doesn't make its copy change.
- Outside a Workspace, or without a built core, the hook does nothing.

The MCP `sync` tool runs the same copy (the `sync` command line doesn't), and Claude Code watches `.claude/skills/`, so a Plugin added to the Workspace mid-session brings its skills at the next `sync`; or start a new session.

## Reporting a missing feature

When Claude has to work around something sc2-adjutant can't do (a trigger the Blueprint can't declare, an Editor part no tool drives, a hand edit inside a Map Package), the `report-missing-feature` skill offers once, at a pause, to report it to the public repo, [TeamAntioch/sc2-adjutant](https://github.com/TeamAntioch/sc2-adjutant/issues). If you say yes, Claude looks for an existing report, drafts one in sc2-adjutant's terms without your map's names, paths or content, and shows you the exact text. Nothing is filed until you approve it. It files with `gh` when that's installed and logged in, and otherwise opens the repo's Missing feature issue form filled in, for you to submit. Say no, and Claude doesn't ask again about that gap in the session.

The skill's script, `skills/report-missing-feature/scripts/report.mjs`, builds the `gh` arguments, the Markdown body and the form URL from Claude's draft, and checks the draft for paths and the Workspace's names. `tests/report-missing-feature.test.ts` holds it to the issue form's fields and labels.

A PostToolUse hook, `hooks/hand-edit.mjs`, runs after each `Edit`, `Write` and `Bash` call, and as PostToolUseFailure after one that failed (a command that exited non-zero). When the call looks like it changed something inside a compiled package (a `*.SC2Map/` or `*.SC2Mod/` folder), it adds a note to Claude's context: this is a hand edit inside the package, outside the Blueprint and the compile, and if it works around missing support, offer the skill once, at a pause. For `Edit` and `Write` the test is the call's file. For `Bash` it's deliberately rough, since the note is only advisory: the command's text names a package path and has a write-like token anywhere in it (a `>` redirect, `tee`, `sed -i`, `perl -i`, `rm`, `mv`, `cp`, `rsync`, `touch`, or a `python` or `node` script with `open(` or `write`). So it can fire on a copy out of a package or a redirect elsewhere, and it can miss an edit after a `cd` into a package or one by a script file; the skill's own description covers what it misses. A Bash command's package is named as written: an absolute or `~/` path is resolved, a relative one is kept as its text. It adds the note at most once per package per session, keeping a marker file per package in a folder for the session under the OS's temp folder; it deletes other sessions' folders after a week. On macOS and Windows a package's path is compared without case. It never blocks or fails the tool call; on any problem it exits quietly. It doesn't fire for a Blueprint edit or a compile, nor for a throwaway copy under a Mission's `output/` folder. `tests/hand-edit-hook.test.ts` runs it as Claude Code does.

## Tests

`npm test -w sc2-adjutant-claude-plugin` checks the skills' frontmatter, links and content, the manifest, and the launcher. It also starts the server the way the plugin does, on a copy of the example Workspace, and checks that every tool a command names is one the server lists, and runs the SessionStart hook on scratch Workspaces and the PostToolUse hook on scratch sessions. Core must be built first (`npm run build`). `claude plugin validate packages/claude-plugin` and `claude plugin validate .` (the marketplace) check the plugin as Claude Code reads it.
