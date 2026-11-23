# Typed GUI Trigger Primitives

Mission logic, `Mechanics`, objectives, transmissions, and in-game cutscenes are compiled into structured `Triggers` XML using verified typed primitives extracted from Editor-saved campaign maps and SC2's built-in `Ntve` library rather than freeform XML or raw `.galaxy` scripts. Raw XML is too fragile for novel mission mechanics, and raw script-only output would be opaque in Galaxy Editor's Trigger UI and harder to round-trip. The primitive library grows only when a new mechanic requires a primitive we haven't wrapped yet.
