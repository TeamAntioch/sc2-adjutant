---
description: Start a new Campaign by making a Workspace here, or in a new folder, with sc2-adjutant installed in it
argument-hint: "[folder]"
disable-model-invocation: true
allowed-tools: Bash(node --version), Bash(ls -A:*), Bash(npx @team-antioch/sc2-adjutant init:*), Bash(npx.cmd @team-antioch/sc2-adjutant init:*)
---

Make a new Workspace, the folder that holds a Campaign's Missions, with sc2-adjutant's `init`, and tell the author how to start the sc2-adjutant MCP server in it. The Workspace goes in the folder `$ARGUMENTS`, relative to the current one, when the author gave one, or else in the current folder. This command runs before there is a server: outside a Workspace the server doesn't start, so do everything here with Bash, and don't wait for the server's tools.

1. **Node.** Run `node --version`. sc2-adjutant needs Node.js 22.18 or later. If `node` isn't found, or its version is older, say so, tell the author to install the current LTS release from https://nodejs.org/ (it comes with npm), then quit Claude Code and start it again so it finds the new `node`, and stop.
2. **The folder.** Run `ls -A` in the Workspace's folder (`ls -A <folder>` for a folder the author gave; one that doesn't exist yet is fine, since `init` makes it). `init` refuses a folder that already has a Workspace config, `sc2-adjutant.workspace.json`, or any of the entries it would overwrite: `README.md`, `missions/`, `mods/`, `plugins/`, `package.json` and `.gitignore`. Anything else is fine, such as the `.claude/` folder Claude Code makes, or a `.git/` folder. If the folder is usable, use it. If it isn't, say which entries are in the way and offer to make the Workspace in a new subfolder instead, suggesting `my-campaign`. Ask for the subfolder's name, and wait; Claude Code then asks the author to approve the commands that follow, as this command's approval covers only the turn it was typed in. A subfolder that already exists must pass the same check.
3. **init.** In the current folder, run `npx @team-antioch/sc2-adjutant init .`; in another folder, `npx @team-antioch/sc2-adjutant init <folder>`, quoted if it has spaces. On Windows (the platform is win32), type `npx.cmd` instead of `npx`. npx downloads sc2-adjutant, and `init` then runs `npm install`, which can take a few minutes: give the command a timeout of 10 minutes. If it refuses the folder, pass its reason on and offer a subfolder, as in step 2. Then pass on what `init` reported, in a few lines:
   - the Host Adapter it installed for this machine, or that this machine has none, and what that leaves out;
   - the machine config it wrote, or the one it kept, and what that names;
   - anything it couldn't do, such as an `npm install` that failed or skills it didn't copy, with what to do about it.

   Leave out its own "Next:" lines, which are written for a terminal: step 4 replaces them.
4. **The server.** Tell the author how to start it, now that the folder is a Workspace:
   - If `init` ran in the current folder, run `/mcp`, select `plugin:sc2-adjutant:sc2-adjutant` and reconnect it. If it still isn't connected, quit Claude Code and start `claude` again in this folder.
   - If `init` ran in another folder, quit Claude Code, then `cd <folder>` and start `claude` there: the server serves the Workspace Claude Code was started in.

   Then they run `/sc2-adjutant:co-design ashfall-relay` to start on the example Mission, *Ashfall Relay*.

Don't change the machine config, or anything `init` wrote, yourself: the next steps, such as telling the Host Adapter where the StarCraft II Editor is, are on the Install page of the sc2-adjutant site.
