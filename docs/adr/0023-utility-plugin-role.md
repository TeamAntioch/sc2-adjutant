# Utilities Are a Fourth Plugin Role, Listed by the Workspace

Some tools an author may want aren't about building maps at all. Take a model workshop, a tool for reworking game models in Blender: retexturing one, rescaling it, trimming its animations. That is making art, not building maps, so it shouldn't come with every install of the generic Claude Code plugin. But none of the three Plugin roles of [ADR-0005](./0005-code-plugins-with-typed-contributions.md) fits it, so we add a fourth, **Utility** (spec #821, decided by the author on 2026-11-21): the role of a Plugin that supplies an optional tool a Workspace chooses to add. A Workspace config lists its Utilities in `utilities`, and a Plugin's manifest declares the `utility` role to be listed there.

## What makes something a Utility

Ask what the Plugin's Contributions are about:

- **This Campaign itself** (its Campaign Mod, its Screenplays and how their lines are named, the Mechanics only it uses): a **Campaign Pack**. A Workspace has at most one, since it holds one Campaign.
- **One author's taste for how Missions look** (Exemplar Maps, Map Studies, Design Lessons, Doodad Composites, Style Rules): a **Style Pack**. A Workspace has at most one, since only one taste shapes the dressing.
- **What this machine can do** with StarCraft II beyond files (open the Editor, capture, render, speak): a **Host Adapter**, named in the machine config, not the Workspace.
- **A tool that works the same for any Campaign, any taste and any machine** that has what it needs, and that an author chooses to have: a **Utility**. A Workspace can list any number.

The model workshop is such a case: nothing in it is one Campaign's own (a model it reworks is, but the tool isn't), it isn't anyone's taste in how a map looks, and it isn't a capability core asks the machine for, since nothing in a compile or a check calls it.

## Considered Options

- **Keep the tool in the generic plugin.** Rejected: every mapper would get an art pipeline with their mapping assistant.
- **Make it a Style Pack.** Rejected: a Workspace names one Style Pack, and an author who wants the model workshop would have to give up their taste, or fold the tool into it. It isn't taste either.
- **List it in `plugins` with no role.** Rejected: `plugins` is for single Contributions such as one Mechanic, and a Plugin with no role can't say what it is for. `list_plugins` couldn't tell an author which optional tools they had added, and the manifest couldn't refuse being named for a job it doesn't do.

## Consequences

- The registry loads Plugins in the config's order: the Campaign Pack, the Style Pack, the Utilities in their listed order, then `plugins`. A Utility loads only when the Workspace lists it, as every Plugin does (#96). Naming a Plugin in `utilities` whose manifest doesn't declare `utility` fails the load, as naming one in any role slot does. The other way round is allowed (decided by the author on 2026-11-22): a Plugin whose manifest declares `utility` but which the Workspace names in `plugins` still loads: a role a manifest declares is what it may be named for, and no role requires its slot. It then loads with the other `plugins`, after the Utilities.
- A Utility contributes only what any Plugin may. A naming template, a Screenplay Source or a Campaign Mod name still needs the Campaign Pack slot, Style Rules the `style-pack` role, and Host Adapter capabilities the machine config. One Plugin can still fill several roles, by being named in each slot.
- `list_plugins` reports each Plugin's roles from its manifest, so a Utility shows as `utility`.
- How a Plugin's skills reach Claude Code, which is how a Utility gets used, is decided below (#824).
- A Utility holds its skills, scripts and reference docs itself, so the generic plugin doesn't ship them. It needn't be a published package: a Workspace lists a local Utility by its folder under `utilities`, as it lists any local Plugin.

## Skills from any Plugin

Any Plugin, of any role, can contribute skills: `contributions.skills` names folders in the Plugin, each holding a `SKILL.md` and its files. A Style Pack can ship a skill for dressing in its style, a Campaign Pack skills for its own tooling, and a Utility its tool.

A Claude Code plugin's own skills are static folders inside it, and MCP prompts are only slash commands the author types, so neither can carry a skill that depends on which Plugins a Workspace lists. Instead, the sc2-adjutant Claude Code plugin ships a SessionStart hook. In a Workspace, it finds the Workspace and core as the launcher does, and core copies each listed Plugin's skill folders into `<workspace>/.claude/skills/`, where Claude Code finds project skills on its own. The hook returns `reloadSkills: true`, so they load in that same session. The MCP `sync` tool runs the same copy (`copyWorkspaceSkills` in `packages/core/src/plugins/plugin-skills.ts`), and Claude Code watches `.claude/skills/`, so a Plugin listed mid-session brings its skills without a restart. `init` runs it too, on the Workspace it makes, with the core it has just installed there, so the copies name Plugin folders in the Workspace and not wherever `init` ran from. The `sync` command line doesn't copy skills (decided by the author on 2026-11-22): it runs outside a Claude Code session, so nothing would load them, and the next session start copies them anyway.

### Rules for the copies

- **Named for their Plugin** (decided by the author on 2026-11-22): a skill is copied as its Plugin's manifest name, a hyphen, and its folder's name, and the copy's `SKILL.md` frontmatter `name:` is set to that, so two Plugins' skills of one folder name don't meet and an author can tell where a skill came from. A folder already named as its Plugin is, or starting with its Plugin's name and a hyphen, keeps its name: `workshop` from Plugin `workshop` stays `workshop`. A scoped manifest name loses its `@` and each run of characters a skill's name can't hold (`/`, `.`, `_`) becomes a hyphen, so `@scope/x` gives `scope-x-<folder>`. A copied name that is not a skill name Claude Code takes (at most 64 lowercase letters, digits and hyphens) is refused at load. `list_plugins` shows each skill by the name it's copied as, which holds its folder's name.

- **Copy, never link**, so it works on Windows without Developer Mode.
- **A marker file**, `.sc2-adjutant-skill.json`, is in each copy, naming its Plugin. Only marked folders are refreshed or removed. A folder or link without it is never touched, and a Plugin skill copied as that name is then not copied, with a message at session start saying why (decided by the author on 2026-11-22).
- **Removed when unlisted**: a marked copy whose name no listed Plugin's skill is copied as is removed, which includes a copy made under a skill's name before copies were named for their Plugin. A copy whose source files' contents haven't changed is left as it is, so a session start rewrites nothing.
- **Ignored by git**: the copies are listed in the Workspace's `.gitignore`, in a block the copy rewrites.
- **The install path, filled in**: `{{PLUGIN_FOLDER}}` in a skill's Markdown is replaced with the Plugin's folder on copy, so the skill runs its scripts and reads its docs from the installed Plugin, not from the copy. Other files are copied byte for byte, except Python's bytecode (`__pycache__` folders and `.pyc` files), which is left out of the copy and its fingerprint, so running a skill's scripts from its Plugin doesn't make every copy change (decided by the author on 2026-11-22).
- **One skill's problem leaves the rest**: a skill holding a link that leads outside its Plugin, nowhere, or back into its own folder is not copied (an older copy of it stays), and the others are.
- **Two skills can't be copied as one name**, since both would be one folder. Prefixing doesn't rule it out (Plugin `a`'s skill `b-c` and Plugin `a-b`'s skill `c` are both `a-b-c`), so loading the Workspace refuses it on the copied name, naming both Plugins, as it refuses two Plugins' prompts of one name.
- **Fast, and harmless outside a Workspace**: the hook reads the Plugins' manifests alone, importing no Plugin code and none of core's catalogs. Outside a Workspace, or without a built core, it does nothing, and a problem is shown at session start rather than failing it.

### Considered Options

- **Symlinks into the Plugins.** Rejected: Windows needs Developer Mode or admin rights for them, and a link can't fill in the install path.
- **List the skills in the Claude Code plugin's manifest.** Rejected: its `skills` paths are static and must stay inside the plugin's folder, so they can't follow a Workspace's config.
- **Serve them as MCP prompts.** Rejected: Claude Code exposes MCP prompts as slash commands the author types, not as skills Claude picks up on its own.
