---
description: Sign off the Co-design Stage a Mission is at, once the author agrees its result
argument-hint: "<mission> [what the author agreed]"
disable-model-invocation: true
allowed-tools: mcp__plugin_sc2-adjutant_sc2-adjutant__get_session_state
---

Sign off the current Co-design Stage of a Mission with the sc2-adjutant MCP server. The arguments are the Mission, then optionally a few words on what the author agreed: `$ARGUMENTS`.

1. Call the server's `get_session_state` tool for the Mission to read the Stage it is at. If no Mission was given, ask which one.
2. Say which Stage this signs off and, in a sentence, the result being agreed. Unless the author has just said in this conversation that they agree it, ask them to confirm, and wait for a yes.
3. Call `sign_off_stage` with the Mission, that Stage's number and, as `note`, what the author agreed in a few words.
4. Report the Stage the Mission is now at and its next step, from the tool's reply. If the tool refuses, report its reason, and don't retry with another Stage.
