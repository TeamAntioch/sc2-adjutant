---
description: Compile a Mission and play it in StarCraft II through the Editor's Test Document
argument-hint: "<mission>"
disable-model-invocation: true
---

Test the Mission `$ARGUMENTS` in the game with the sc2-adjutant MCP server's `test_mission` tool. If no Mission was given, call `get_session_state` without one and ask the author which Mission to test.

1. Ask the author to close the Mission in the StarCraft II Editor if it is open there, and wait for them: rewriting a map the Editor has open can crash it, and the Editor keeps testing the copy it loaded.
2. Call `test_mission` for the Mission.
3. Report what the server did, any compile warnings, the result of each declared route test (a failed one is a Blueprint or terrain problem to fix, not a game result: it is read from the terrain, not from the game), and, as a numbered list, every step it hands to the author. Then ask the author what they saw in the game.
