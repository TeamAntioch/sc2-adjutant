// The clipboard "look closer" copies its prompt to (#635, #844). The process copies it with the
// system's clipboard command, not the page with navigator.clipboard: the page's copy would come
// after the process has answered, and a browser may no longer count that as the author's click.
// macOS has pbcopy and Windows has clip. Linux has whichever of wl-copy (Wayland), xclip and xsel
// is installed and has a display, so each with its display set is tried in turn. When none copies,
// the page shows the prompt to copy by hand.

import { spawn } from "node:child_process";

export type Copy = (text: string) => Promise<void>;

/** A clipboard command, and how it wants the text. */
export type ClipboardCommand = {
  readonly command: string;
  readonly args: readonly string[];
  /** clip reads UTF-8 as the console's code page, so it is given UTF-16LE with a byte-order mark. */
  readonly encoding: "utf8" | "utf16le-bom";
};

/** How long a copy may take before it counts as failed: one with no pasteboard or display (over ssh) can hang. */
const COPY_MS = 5000;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The commands that copy to this platform's clipboard, in the order they are tried. On Linux,
 * wl-copy only with WAYLAND_DISPLAY and xclip and xsel only with DISPLAY: without its display each
 * fails, or hangs until the timeout, which look closer would wait out before the page answers.
 */
export function clipboardCommands(platform: NodeJS.Platform = process.platform, env: Env = process.env): readonly ClipboardCommand[] {
  switch (platform) {
    case "darwin":
      return [{ command: "pbcopy", args: [], encoding: "utf8" }];
    case "win32":
      return [{ command: "clip", args: [], encoding: "utf16le-bom" }];
    case "linux":
    case "freebsd":
    case "openbsd":
      return [
        ...(env.WAYLAND_DISPLAY ? [{ command: "wl-copy", args: [], encoding: "utf8" } as const] : []),
        ...(env.DISPLAY
          ? ([
              { command: "xclip", args: ["-selection", "clipboard"], encoding: "utf8" },
              { command: "xsel", args: ["--clipboard", "--input"], encoding: "utf8" },
            ] as const)
          : []),
      ];
    default:
      return [];
  }
}

const encode = (text: string, encoding: ClipboardCommand["encoding"]): Buffer =>
  encoding === "utf16le-bom" ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]) : Buffer.from(text, "utf8");

/** Runs one command with the text on its stdin; rejects when it can't run, fails or hangs. */
const runCopy = ({ command, args, encoding }: ClipboardCommand, text: string, timeoutMs: number) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"], timeout: timeoutMs, windowsHide: true });
    child.once("error", reject);
    child.once("close", (code, signal) => (code === 0 ? resolve() : reject(new Error(`${command} ${signal ? `was stopped (${signal})` : `exited with ${code}`}`))));
    // A command that never started or quit early breaks the pipe: that's the failure above, not a crash.
    child.stdin.once("error", () => {});
    child.stdin.end(encode(text, encoding));
  });

/** Copies with the first of the commands that works; rejects with each one's failure when none does. */
export function copyWith(commands: readonly ClipboardCommand[], { timeoutMs = COPY_MS }: { readonly timeoutMs?: number } = {}): Copy {
  return async (text) => {
    const failures: string[] = [];
    for (const command of commands) {
      try {
        await runCopy(command, text, timeoutMs);
        return;
      } catch (error) {
        failures.push((error as Error).message);
      }
    }
    throw new Error(`No clipboard command copied: ${failures.join("; ")}`);
  };
}

/** This machine's clipboard, or none where the platform has no clipboard command to try. */
export const systemClipboard = (platform: NodeJS.Platform = process.platform, env: Env = process.env): Copy | undefined => {
  const commands = clipboardCommands(platform, env);
  return commands.length ? copyWith(commands) : undefined;
};
