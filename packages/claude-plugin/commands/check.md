---
description: Check every Mission in the Workspace against the Workspace's Plugins
allowed-tools: mcp__plugin_sc2-adjutant_sc2-adjutant__check_workspace
---

Check the Workspace with the sc2-adjutant MCP server's `check_workspace` tool.

Report how many Missions it checked, then each problem with its file and where in the Blueprint, grouped by Mission. List a Cinematic's warnings and review items (its cinematography checks, such as a T4 length) after its errors, as questions for the author rather than faults; for a T4 review item, offer to walk the scene's lines with the cinematography skill. When there are problems, offer to fix those whose fix is clear, one Mission at a time, with `get_blueprint` and `patch_blueprint`, and ask the author about the rest. When there are none, say so in one line.
