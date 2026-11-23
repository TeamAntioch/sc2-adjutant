---
description: Start or resume a Mission's co-design session, at the Co-design Stage it has reached
argument-hint: "[mission]"
allowed-tools: mcp__plugin_sc2-adjutant_sc2-adjutant__get_session_state, mcp__plugin_sc2-adjutant_sc2-adjutant__list_plugins
---

Start or resume the co-design session for the Mission `$ARGUMENTS` with the sc2-adjutant MCP server.

1. Call the server's `get_session_state` tool with `mission` set to `$ARGUMENTS`. If no Mission was given, call it without one, list the Workspace's Missions with their Stages, and ask the author which one to work on before going on.
2. Tell the author, in two or three sentences, which Stage the Mission is at, what has been signed off, and the Stage's next step, as the tool's reply gives them.
3. Then do that next step with the author, until its result is ready for the author to sign off. Follow the skill for the Stage's work wherever one covers it: `level-design` for the geography sketch, `exemplar-design` for palette and placement, `cinematography` for the cutscenes in dialogue and compilation. Read the Workspace's Plugins with `list_plugins`, and their knowledge through the server's resources and prompts, not from their folders.

A Stage closes only when the author explicitly agrees its result, with `/sc2-adjutant:sign-off`. Never sign a Stage off on your own judgement. If the author redoes the design of a Stage already signed off, it is reopened with `/sc2-adjutant:reopen`, only when the author asks: its sign-off and every later one are superseded, and each Stage from there is signed off again.
