# Trigger Scenes Pre-empt In-Play Lines

A Trigger Scene ([ADR 0012](./0012-trigger-scenes-and-chained-skips.md)) starts the moment its cue fires, never waiting for an in-play line to end. Its Setup takes the Mission's lines and cuts off only the in-play line playing, if one is. That line is replayed from its start once the scene, and its lines after the handback, have played. The rest of that line's cue follows it. In-play script scenes still queue on one another as before (`script_transmissions_playing`).

We chose this because a Trigger Scene may be time-critical. One mission's Scene 6 frames a blink-strike that plays in data either way. Waiting ~10 s for an in-play line to end would miss the strike.

**How it compiles** (`packages/core/src/triggers/transmission-hold.ts`). Only a Mission with a Trigger Scene gets any of this. In one with none, nothing cuts an in-play line, and its lines compile as before.

- `script_trigger_scene` holds the number of the Trigger Scene holding the lines (the Mission's scenes are numbered from 1), or 0 when none does. Setup takes the lines. The scene gives them back (sets 0, unless another scene has taken them since) once its handback has settled, or after its last `handback.linesFrom` line. A Trigger Scene that hands on to the next scene in a chain gives them back too, and the next scene takes them with no wait between. A victory outro never gives them back, since the game is over.
- Each in-play script line is sent without waiting, and its id is kept in `script_line`. A line waits until no Trigger Scene holds the lines. When one cuts it off (`TransmissionClear` and `script_line_cut`), its own thread sends it again from the start, in a While loop, until it plays to its end uncut. The line's cue keeps `script_transmissions_playing` through all of this, so the cue's later lines and any queued cue play after the replay.
- A Trigger Scene's own lines, in its shots and after its handback, are kept in `script_trigger_scene_line`. Its Cleanup clears only that line, not `TransmissionClearAll()`. A skip ends the Cinematic trigger (ADR 0012), so the line it kept is the only one of the scene's still playing, and a skip still leaves nothing of the scene playing. Its lines after the handback play while it holds the lines, so no in-play line cuts in. A Trigger Scene that starts among them cuts off the one playing. That line is replayed once the later scene has given the lines back, the first scene taking them again (and cutting off any in-play line that started in between), and the rest of the lines follow. A scene played again while its own lines after the handback still play stops them (`TriggerStop`), since it plays them afresh.
- At most one line plays in each slot at a time. In-play lines play one at a time behind `script_transmissions_playing`. A Trigger Scene's lines play only while it holds the lines. So each slot keeps one id and one cut flag.

## Considered Options

- **Wait for the lock.** Setup would wait for `script_transmissions_playing` to be free before going to black, and hold it until its handback. That's simpler, and nothing is ever cut off. Rejected, because a scene cued on a moment in play would start up to a line's length late, after the moment it frames.
- **Clear every transmission at Setup.** Rejected: the in-play line would be lost, and so would any other transmission (a Wave warning).

## Consequences

- A cut line is heard again from its start. Its first words play twice, which is better than losing the line.
- Other transmissions still overlap a Trigger Scene's lines, as before: a Wave warning's, or an inline Screenplay scene's. Neither queues on the script lock. A Cinematic doesn't take the lines either.
- Trigger Scenes are not meant to overlap one another on screen. One that starts while another plays its shots takes the lines, and the first then leaves them to it when it ends.
