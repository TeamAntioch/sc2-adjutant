// The system clipboard look closer copies with (src/clipboard.ts, #844): each platform's commands,
// tried in order until one copies, clip's UTF-16 text, and a copy that can't run, fails or hangs.
// The commands here are small Node scripts standing in for pbcopy and the rest: nothing touches
// this machine's clipboard.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ClipboardCommand, clipboardCommands, copyWith, systemClipboard } from "../src/clipboard.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "doodad-finder-clipboard-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A stand-in clipboard: a Node script given the text on stdin. */
const node = (script: string, encoding: ClipboardCommand["encoding"] = "utf8", ...args: string[]): ClipboardCommand => ({ command: process.execPath, args: ["-e", script, ...args], encoding });
/** One that writes what it was given to a file. */
const saving = (file: string, encoding: ClipboardCommand["encoding"] = "utf8") => node("process.stdin.pipe(require('fs').createWriteStream(process.argv[1]))", encoding, file);

describe("the system clipboard", () => {
  const displays = { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" };
  const line = ({ command, args }: ClipboardCommand) => [command, ...args].join(" ");

  it("is pbcopy on macOS, clip on Windows, and wl-copy, xclip then xsel on Linux", () => {
    expect(clipboardCommands("darwin", {}).map(line)).toEqual(["pbcopy"]);
    expect(clipboardCommands("win32", {})).toEqual([{ command: "clip", args: [], encoding: "utf16le-bom" }]);
    expect(clipboardCommands("linux", displays).map(line)).toEqual(["wl-copy", "xclip -selection clipboard", "xsel --clipboard --input"]);
  });

  it("tries a Linux command only with its display, so one with none can't hang look closer", () => {
    expect(clipboardCommands("linux", { WAYLAND_DISPLAY: "wayland-0" }).map(line)).toEqual(["wl-copy"]);
    expect(clipboardCommands("linux", { DISPLAY: ":0" }).map(line)).toEqual(["xclip -selection clipboard", "xsel --clipboard --input"]);
    expect(systemClipboard("linux", {})).toBeUndefined();
  });

  it("is none where the platform has no clipboard command, so the page shows the prompt", () => {
    expect(systemClipboard("aix", displays)).toBeUndefined();
    expect(systemClipboard("darwin", {})).toBeTypeOf("function");
    expect(systemClipboard("win32", {})).toBeTypeOf("function");
    expect(systemClipboard("linux", displays)).toBeTypeOf("function");
  });

  it("copies with the first command that works, past one that isn't installed and one that fails", async () => {
    const file = path.join(dir, "copied.txt");
    await copyWith([{ command: "no-such-clipboard-command", args: [], encoding: "utf8" }, node("process.exit(1)"), saving(file)])("Carry on the Doodad Search in é/search.json");
    expect(await readFile(file, "utf8")).toBe("Carry on the Doodad Search in é/search.json");
  });

  it("gives clip UTF-16LE with a byte-order mark, so text outside ASCII survives", async () => {
    const file = path.join(dir, "copied.bin");
    await copyWith([saving(file, "utf16le-bom")])("Dépôt/search.json");
    const bytes = await readFile(file);
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xfe]);
    expect(bytes.subarray(2).toString("utf16le")).toBe("Dépôt/search.json");
  });

  it("fails, naming each command's failure, when none copies", async () => {
    await expect(copyWith([{ command: "no-such-clipboard-command", args: [], encoding: "utf8" }, node("process.exit(3)")])("text")).rejects.toThrow(
      /^No clipboard command copied: .*no-such-clipboard-command.*; .* exited with 3$/,
    );
  });

  it("fails a command that hangs, as one with no display can", async () => {
    await expect(copyWith([node("setInterval(() => {}, 1000)")], { timeoutMs: 200 })("text")).rejects.toThrow(/was stopped/);
  });
});
