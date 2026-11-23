// How the Windows Host Adapter picks a voice for tts.speak from the voices System.Speech has
// installed: the speech helper's list, as it printed it on 2026-11-18 (Windows 11 ARM64).
import { describe, expect, it } from "vitest";

import { chooseVoice, parseVoices, VoiceNotInstalled } from "../speech-windows.ts";

const LIST = "Microsoft David Desktop\ten-US\tMale\r\nMicrosoft Zira Desktop\ten-US\tFemale\r\n";

describe("voices on Windows", () => {
  it("reads the speech helper's voice list", () => {
    expect(parseVoices(LIST)).toEqual([
      { name: "Microsoft David Desktop", culture: "en-US", gender: "Male" },
      { name: "Microsoft Zira Desktop", culture: "en-US", gender: "Female" },
    ]);
    expect(parseVoices("")).toEqual([]);
  });

  it("takes an installed voice by its whole name, ignoring case", () => {
    const voices = parseVoices(LIST);
    expect(chooseVoice("Microsoft Zira Desktop", voices)).toBe("Microsoft Zira Desktop");
    expect(chooseVoice("microsoft zira desktop", voices)).toBe("Microsoft Zira Desktop");
  });

  it("takes a voice by the words of its name that tell it apart, such as Zira", () => {
    const voices = parseVoices(LIST);
    expect(chooseVoice("Zira", voices)).toBe("Microsoft Zira Desktop");
    expect(chooseVoice("david desktop", voices)).toBe("Microsoft David Desktop");
    // Words, not letters.
    expect(() => chooseVoice("Zir", voices)).toThrow('No Windows voice "Zir"');
  });

  it("uses Windows' default voice when the line names none", () => {
    expect(chooseVoice(undefined, parseVoices(LIST))).toBeUndefined();
  });

  it("fails on a voice that isn't installed, listing the ones that are", () => {
    expect(() => chooseVoice("Eddy (English (US))", parseVoices(LIST))).toThrow(
      'No Windows voice "Eddy (English (US))": the installed voices are Microsoft David Desktop (en-US, Male), Microsoft Zira Desktop (en-US, Female). docs/windows-host.md says how to add more.',
    );
    expect(() => chooseVoice("Zira", [])).toThrow('No Windows voice "Zira": no voices are installed.');
    // Only a voice that isn't installed is worth listing the voices again for.
    expect(() => chooseVoice("Zira", [])).toThrow(VoiceNotInstalled);
  });

  it("fails on words that more than one voice has, naming them", () => {
    expect(() => chooseVoice("Microsoft", parseVoices(LIST))).toThrow('"Microsoft" could be any of Microsoft David Desktop, Microsoft Zira Desktop: name the voice in full');
    expect(() => chooseVoice("Microsoft", parseVoices(LIST))).not.toThrow(VoiceNotInstalled);
  });
});
