// The add-doodad-note and contribute-doodad-notes CLIs' arguments (src/cli/doodad-notes-args.ts).
import { describe, expect, it } from "vitest";

import { ADD_DOODAD_NOTE_USAGE, CONTRIBUTE_DOODAD_NOTES_USAGE, parseAddDoodadNoteArgs, parseContributeDoodadNotesArgs } from "../../src/cli/doodad-notes-args.js";

describe("the add-doodad-note CLI's arguments", () => {
  it("asks for the usage on --help or -h", () => {
    expect(parseAddDoodadNoteArgs(["--help"])).toEqual({ help: true });
    expect(parseAddDoodadNoteArgs(["Crate", "-h"])).toEqual({ help: true });
    expect(ADD_DOODAD_NOTE_USAGE).toMatch(/^Usage: add-doodad-note /);
  });

  it("takes one id and a use, a look or both", () => {
    expect(parseAddDoodadNoteArgs(["Crate", "--use", "cargo by a dock", "--json"])).toEqual({ id: "Crate", use: "cargo by a dock", json: true });
    expect(() => parseAddDoodadNoteArgs(["Crate"])).toThrow(/Give a --use, a --look or both/);
    expect(() => parseAddDoodadNoteArgs(["Crate", "Barrel", "--look", "x"])).toThrow(/Name one doodad id/);
    expect(() => parseAddDoodadNoteArgs(["Crate", "--colour", "red"])).toThrow(/Unknown option --colour/);
  });

  it("takes a use's variation, scale and source, as numbers where they are numbers", () => {
    expect(parseAddDoodadNoteArgs(["DOM_Crate", "--use", "press head", "--variation", "01", "--scale", "3", "--from", "crushing-press search, 2026-11-09"])).toEqual({
      id: "DOM_Crate",
      use: "press head",
      variation: 1,
      scale: 3,
      from: "crushing-press search, 2026-11-09",
      json: false,
    });
    expect(parseAddDoodadNoteArgs(["Lamp", "--use", "lamp", "--scale", "0.6"])).toMatchObject({ scale: 0.6 });
    expect(() => parseAddDoodadNoteArgs(["Crate", "--use", "x", "--variation", "two"])).toThrow(/--variation needs a whole number from 0/);
    expect(() => parseAddDoodadNoteArgs(["Crate", "--use", "x", "--variation", "-1"])).toThrow(/--variation needs a whole number from 0/);
    expect(() => parseAddDoodadNoteArgs(["Crate", "--use", "x", "--scale", "0"])).toThrow(/--scale needs a number above 0/);
    expect(() => parseAddDoodadNoteArgs(["Crate", "--use", "x", "--scale", "3x"])).toThrow(/--scale needs a number above 0/);
    expect(() => parseAddDoodadNoteArgs(["Crate", "--look", "x", "--variation", "1"])).toThrow(/--variation, --scale and --from go with a --use/);
  });

  it("takes -h as a value where one is due, and no option as a value", () => {
    expect(parseAddDoodadNoteArgs(["Crate", "--use", "-h"])).toEqual({ id: "Crate", use: "-h", json: false });
    expect(() => parseAddDoodadNoteArgs(["Crate", "--use", "--look", "lamp"])).toThrow(/--use needs a value/);
  });
});

describe("the contribute-doodad-notes CLI's arguments", () => {
  it("asks for the usage on --help or -h", () => {
    expect(parseContributeDoodadNotesArgs(["--help"])).toEqual({ help: true });
    expect(parseContributeDoodadNotesArgs(["--dry-run", "-h"])).toEqual({ help: true });
    expect(CONTRIBUTE_DOODAD_NOTES_USAGE).toMatch(/^Usage: contribute-doodad-notes /);
  });

  it("takes an sc2-asset-catalog checkout, or none for a fresh clone, and --dry-run and --json", () => {
    expect(parseContributeDoodadNotesArgs(["--checkout", "../sc2-asset-catalog", "--dry-run"])).toEqual({ checkout: "../sc2-asset-catalog", dryRun: true, json: false });
    expect(parseContributeDoodadNotesArgs(["--json"])).toEqual({ dryRun: false, json: true });
    expect(CONTRIBUTE_DOODAD_NOTES_USAGE).toContain("[--checkout <sc2-asset-catalog checkout>]");
    expect(() => parseContributeDoodadNotesArgs(["--checkout"])).toThrow(/--checkout needs a value/);
    expect(() => parseContributeDoodadNotesArgs(["--checkout", "--dry-run"])).toThrow(/--checkout needs a value/);
    expect(() => parseContributeDoodadNotesArgs(["--checkout", "x", "extra"])).toThrow(/Unknown argument extra/);
  });
});
