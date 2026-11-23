// Which installed Windows voice speaks a line, from the speech helper's list (helpers/speech.cs).
// Pure, so it's tested without speaking. docs/windows-host.md has the voices Windows ships.

/** A voice System.Speech has installed and enabled. */
export type Voice = { readonly name: string; readonly culture: string; readonly gender: string };

/** The speech helper's `voices` output: `<name>\t<culture>\t<gender>`, one a line. */
export function parseVoices(stdout: string): Voice[] {
  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name = "", culture = "", gender = ""] = line.split("\t");
      return { name, culture, gender };
    });
}

/** No installed voice has the name asked for: listing the voices again may find one installed since. */
export class VoiceNotInstalled extends Error {}

const words = (text: string): string[] => text.toLowerCase().split(/\s+/).filter(Boolean);

/** Whether `part`'s words come one after another in `whole`'s. */
function hasWords(whole: readonly string[], part: readonly string[]): boolean {
  if (part.length === 0) return false;
  for (let start = 0; start + part.length <= whole.length; start++) {
    if (part.every((word, index) => whole[start + index] === word)) return true;
  }
  return false;
}

/**
 * The installed voice's full name for a line's `voice`, or undefined for Windows' default voice when
 * it names none. A voice is named in full, ignoring case, or by the words of its name that tell it
 * apart from the others ("Zira" for "Microsoft Zira Desktop"). Anything else fails, listing the
 * installed voices.
 */
export function chooseVoice(requested: string | undefined, voices: readonly Voice[]): string | undefined {
  if (requested === undefined) return undefined;
  const exact = voices.find((voice) => voice.name.toLowerCase() === requested.trim().toLowerCase());
  if (exact) return exact.name;
  const matches = voices.filter((voice) => hasWords(words(voice.name), words(requested)));
  if (matches.length === 1) return matches[0]!.name;
  if (matches.length > 1) throw new Error(`"${requested}" could be any of ${matches.map((voice) => voice.name).join(", ")}: name the voice in full`);
  const installed = voices.length > 0 ? `the installed voices are ${voices.map((voice) => `${voice.name} (${voice.culture}, ${voice.gender})`).join(", ")}` : "no voices are installed";
  throw new VoiceNotInstalled(`No Windows voice "${requested}": ${installed}. docs/windows-host.md says how to add more.`);
}
