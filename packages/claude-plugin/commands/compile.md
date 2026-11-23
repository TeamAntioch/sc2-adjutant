---
description: Compile a Mission's Blueprint into a Map Package the StarCraft II Editor opens
argument-hint: "<mission> [folder for the Map Package]"
---

Compile a Mission with the sc2-adjutant MCP server's `compile_map` tool. The arguments are the Mission, then optionally a folder for the Map Package inside the Workspace: `$ARGUMENTS`. If no Mission was given, call `get_session_state` without one and ask the author which Mission to compile.

If the Editor may have the Mission's package open, ask the author to close it there first: rewriting a map the Editor has open can crash it. Then report where the Map Package was written and every warning, each with what it means for the author, and the next step from the tool's reply.
