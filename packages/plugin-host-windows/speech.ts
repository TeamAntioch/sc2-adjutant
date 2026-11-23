// tts.speak on Windows: a placeholder voice line spoken with Windows' built-in voices (System.Speech)
// straight to a 22050 Hz, 16-bit, mono WAV, which SC2 plays (helpers/speech.cs). Core trims and
// encodes it as it does the Mac's (packages/core/src/host/placeholder-voices.ts).

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { HostContext } from "@team-antioch/sc2-adjutant/plugin-sdk";

import { helper, runHelper } from "./helpers.ts";
import { chooseVoice, parseVoices, type Voice, VoiceNotInstalled } from "./speech-windows.ts";

/** The installed voices, by helper exe: listed once, not for every line. */
const listed = new Map<string, Promise<Voice[]>>();

function installedVoices(exe: string, again = false): Promise<Voice[]> {
  let voices = listed.get(exe);
  if (!voices || again) {
    const listing = runHelper(exe, ["voices"]).then(parseVoices);
    listed.set(exe, listing);
    // A failed listing is forgotten, unless a newer one has taken its place.
    listing.catch(() => {
      if (listed.get(exe) === listing) listed.delete(exe);
    });
    voices = listing;
  }
  return voices;
}

/** How often an unknown name may list the voices again, in seconds. */
const RELIST_SECONDS = 60;

/** When each helper last listed the voices again for an unknown name, so a script of lines in one lists them once. */
const relisted = new Map<string, number>();

/** How long one line may take to speak, in seconds. */
const SPEAK_SECONDS = 120;

/**
 * The installed voice `requested` names. A name no voice has lists the voices again, at most once a
 * minute, in case its voice was installed since; a name that could be several voices fails at once.
 */
async function resolveVoice(exe: string, requested: string): Promise<string | undefined> {
  try {
    return chooseVoice(requested, await installedVoices(exe));
  } catch (error) {
    if (!(error instanceof VoiceNotInstalled) || Date.now() - (relisted.get(exe) ?? -Infinity) < RELIST_SECONDS * 1000) throw error;
    relisted.set(exe, Date.now());
    return chooseVoice(requested, await installedVoices(exe, true));
  }
}

/** Speaks `text` in the installed voice `voice` names (else, as on the Mac, Windows' default voice) to `outputPath`. */
export async function speak(request: { readonly text: string; readonly voice?: string; readonly outputPath: string }, context: HostContext): Promise<void> {
  const exe = await helper(context, "speech");
  const voice = request.voice?.trim() ? await resolveVoice(exe, request.voice) : undefined;
  const outputPath = path.resolve(request.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  // The text goes in a file, so a long line, or one with quotes, reaches the helper whole.
  const work = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-tts-"));
  try {
    const textFile = path.join(work, "line.txt");
    await writeFile(textFile, request.text, "utf8");
    await runHelper(exe, ["speak", voice ?? "-", textFile, outputPath], SPEAK_SECONDS);
  } catch (error) {
    // The voice may have been removed or disabled since it was listed: list them afresh next time.
    if (voice !== undefined) listed.delete(exe);
    throw error;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
