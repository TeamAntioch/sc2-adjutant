---
description: Reopen an earlier Co-design Stage of a Mission, when its signed-off design is being redone
argument-hint: "<mission> <stage> <why>"
disable-model-invocation: true
allowed-tools: mcp__plugin_sc2-adjutant_sc2-adjutant__get_session_state
---

Reopen an earlier Co-design Stage of a Mission with the sc2-adjutant MCP server. The arguments are the Mission, the Stage to go back to, then why the author is reopening it: `$ARGUMENTS`.

1. Call the server's `get_session_state` tool for the Mission to read its Stage and sign-offs. If no Mission or Stage was given, ask which.
2. If that Stage isn't signed off (it is the Stage the Mission is at, or a later one), say so and stop: only a signed-off Stage can be reopened.
3. Say which Stage this reopens, and that its sign-off and every later one will be superseded and need signing off again; name them, with their dates. Unless the author has just asked in this conversation to reopen that Stage, ask them to confirm, in the same question asking why if no reason was given, and wait for the answer.
4. Call `reopen_stage` with the Mission, that Stage's number and, as `note`, why the author is reopening it, in a few words.
5. Report the Stage the Mission is now at and its next step, from the tool's reply. If the tool refuses, report its reason, and don't retry with another Stage.
