// What a tool hands the author when the Host Adapter can't do a step in the Editor, and playing a Map Package in the game.

import path from "node:path";
import { EditorBusyError, runEditorAction } from "../../capture/editor-broker-client.js";
import { type Host } from "../../host/host.js";

export type Handoff = {
  /** What the Host Adapter did, as sentences. */
  readonly automated: string[];
  /** Why the Host Adapter stopped short, when it tried and failed. */
  readonly reason?: string;
  readonly steps: string[];
};

/** A hand-off as reply lines: what the Host Adapter did, why it stopped short, and the author's steps. */
export function describeHandoff(handoff: Handoff): string[] {
  return [
    ...handoff.automated,
    ...(handoff.reason ? [handoff.reason] : []),
    ...(handoff.steps.length ? ["Over to the author:", ...handoff.steps.map((step, index) => `${index + 1}. ${step}`)] : []),
  ];
}

/**
 * When the Host Adapter can tell that the Editor has the Map Package open, the text (for `ctx.fail`) refusing a
 * tool that would rewrite it (rewriting a map the Editor has open can crash it), with the author's
 * steps; otherwise undefined. A host that can't tell lets the tool go ahead.
 */
export async function editorHasOpen(
  host: Host,
  mapPath: string,
  tool: string,
  refusal: string,
): Promise<{ readonly text: string; readonly steps: string[] } | undefined> {
  if (!host.has("editor.checkClosed")) return undefined;
  try {
    await host.run("editor.checkClosed", { mapPath });
    return undefined;
  } catch (error) {
    const steps = ["Close the map in the StarCraft II Editor without saving.", `Ask for ${tool} again.`];
    const reason = `${refusal}: ${error instanceof Error ? error.message : String(error)}`;
    return { text: [reason, ...describeHandoff({ automated: [], steps })].join("\n"), steps };
  }
}

/**
 * compile_map's `refresh` (#739): when the Editor has the Map Package open, closes it from the File
 * menu through the Host Adapter's editor.refresh, which refuses (closing nothing) while the document
 * has unsaved changes, so the author's work is never lost. `closed` says a map was closed and should
 * be reopened with `reopenMap` once the package is rewritten. Otherwise `fail` is the text for
 * `ctx.fail`, with the author's steps.
 */
export async function closeForRefresh(host: Host, mapPath: string, tool: string): Promise<{ readonly closed: boolean; readonly fail?: string }> {
  const handoff = (reason: string): string =>
    [`Not compiled: ${reason}`, ...describeHandoff({ automated: [], steps: ["Close the map in the StarCraft II Editor without saving.", `Ask for ${tool} again.`] })].join("\n");
  if (!host.has("editor.refresh")) return { closed: false, fail: handoff("this machine's Host Adapter can't close and reopen a map in the Editor (editor.refresh)") };
  const open = host.has("editor.checkClosed") ? await host.run("editor.checkClosed", { mapPath }).then(() => false, () => true) : true;
  if (!open) return { closed: false };
  try {
    await runEditorAction(host, "editor.refresh", { mapPath }, { ifIdle: true });
    return { closed: true };
  } catch (error) {
    return { closed: false, fail: handoff(error instanceof Error ? error.message : String(error)) };
  }
}

/** The line to tell the author after a refresh: the map is open again, or the step is theirs. */
export async function reopenMap(host: Host, mapPath: string): Promise<string> {
  try {
    await runEditorAction(host, "editor.open", { mapPath }, { ifIdle: true });
    return "The Editor had the map open: it was closed before the compile and opened again on the new package.";
  } catch (error) {
    const components = path.join(mapPath, "ComponentList.SC2Components");
    return `The Editor had the map open and it was closed for the compile, but the Host Adapter couldn't open it again (${error instanceof Error ? error.message : String(error)}): open ${components} in the Editor yourself.`;
  }
}

/**
 * How long test_mission may spend from the start of its compile to the game starting, in seconds:
 * under an MCP client's usual 60 s request timeout. Test Document gets what the compile leaves,
 * but never less than the minimum, so a slow compile still gets a try.
 */
export const TEST_BUDGET_SECONDS = 50;
export const TEST_MIN_SECONDS = 15;

/**
 * Plays a compiled Map Package in the game through the Editor's Test Document: all of it by the
 * Host Adapter when it can, else whatever it can't do as steps for the author. A capability that
 * fails hands its part over too, with the reason. On a machine that captures it goes through the
 * Editor Broker, refused at once while a capture runs or waits (the reason says which), since it
 * can't wait one out; and no capture starts until the game it starts has quit.
 */
export async function testInGame(host: Host, mapPath: string, seconds: number, bankFixture?: { readonly name: string; readonly dir: string }): Promise<Handoff> {
  const components = path.join(mapPath, "ComponentList.SC2Components");
  const openStep = `Open the Map Package in the StarCraft II Editor: File > Open, then choose ${components} (an unpacked Map Package opens through that file, not its folder). If the Editor already has this map open, close it without saving and open it again, since the Editor tests the copy it loaded.`;
  const testSteps = [
    "Wait until the map has finished loading.",
    "Choose File > Test Document. The game starts on the map.",
    "Play the Mission, then quit the game and say what you saw.",
  ];
  const failed = (what: string, error: unknown) => `The Host Adapter couldn't ${what}: ${error instanceof Error ? error.message : String(error)}`;
  // Busy with a capture: doing it by hand would land in the middle of the capture too.
  const busy = (error: EditorBusyError): Handoff => ({ automated: [], reason: error.message, steps: ["Wait for the Editor to be free, then ask for the test again."] });

  if (host.has("editor.testDocument")) {
    try {
      await runEditorAction(host, "editor.testDocument", { mapPath, seconds, ...(bankFixture ? { bankFixture } : {}) }, { ifIdle: true });
      return { automated: [`Opened it in the Editor and ran Test Document: the game is starting on it${bankFixture ? `, with the banks of the fixture ${bankFixture.name} copied in; your own banks are put back when the game quits` : ""}.`], steps: [testSteps[2]!] };
    } catch (error) {
      if (error instanceof EditorBusyError) return busy(error);
      // A refusal that comes with a fixture is the banks', not the Editor's: doing it by hand would play on the wrong banks.
      if (bankFixture) return { automated: [], reason: failed("run Test Document on the bank fixture", error), steps: ["Fix that, then ask for the test again."] };
      return { automated: [], reason: failed("run Test Document", error), steps: [openStep, ...testSteps] };
    }
  }
  if (host.has("editor.open")) {
    try {
      await runEditorAction(host, "editor.open", { mapPath }, { ifIdle: true });
      return { automated: ["Opened it in the Editor."], steps: testSteps };
    } catch (error) {
      if (error instanceof EditorBusyError) return busy(error);
      return { automated: [], reason: failed("open the Editor", error), steps: [openStep, ...testSteps] };
    }
  }
  return { automated: [], steps: [openStep, ...testSteps] };
}
