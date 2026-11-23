// The Windows Host Adapter's native helpers: small C# programs in helpers/, compiled on first use
// with the .NET Framework 4 csc.exe that comes with Windows, into <cacheDir>/host-windows/bin, the
// way the macOS adapter builds its Swift helpers. Nothing to install and no binaries in the repo.
// Each build is named by a hash of its source, so a changed source is built again and a helper
// another process is running is never overwritten. Without a cacheDir they go in the system temp
// folder instead (helperCacheDir), and one cleaned away from there is built again.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { HostContext } from "@team-antioch/sc2-adjutant/plugin-sdk";

const run = promisify(execFile);

/** The in-box C# compiler: the 64-bit .NET Framework's, else the 32-bit one's. */
export function cscPath(env: NodeJS.ProcessEnv = process.env, exists: (file: string) => boolean = existsSync): string {
  const windows = env.WINDIR ?? env.SystemRoot ?? "C:\\Windows";
  const candidates = ["Framework64", "Framework"].map((framework) => path.win32.join(windows, "Microsoft.NET", framework, "v4.0.30319", "csc.exe"));
  const found = candidates.find((file) => exists(file));
  if (!found) throw new Error(`No C# compiler at ${candidates[0]}: the Windows Host Adapter builds its helpers with the .NET Framework 4 csc.exe that comes with Windows`);
  return found;
}

/**
 * What csc needs besides the source to build a helper. The capture helper calls WinRT
 * (Windows.Graphics.Capture), so it references the .NET Framework's WinRT facades beside `csc` and
 * the system's WinRT metadata, and reads frame buffers through pointers (`-unsafe`). The speech
 * helper references System.Speech, which csc doesn't find by name: it's in the framework's WPF folder.
 */
export function compileOptions(name: string, csc: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const framework = path.win32.dirname(csc);
  if (name === "speech") return [`-r:${path.win32.join(framework, "WPF", "System.Speech.dll")}`];
  if (name !== "capture") return [];
  const metadata = path.win32.join(env.WINDIR ?? env.SystemRoot ?? "C:\\Windows", "System32", "WinMetadata");
  return [
    "-unsafe",
    ...["System.Runtime.dll", "System.Runtime.WindowsRuntime.dll", "System.Runtime.InteropServices.WindowsRuntime.dll"].map((dll) => `-r:${path.win32.join(framework, dll)}`),
    "-r:System.Drawing.dll",
    ...["Windows.Foundation.winmd", "Windows.Graphics.winmd"].map((winmd) => `-r:${path.win32.join(metadata, winmd)}`),
  ];
}

/** Where the helper built from this source lives: `<cacheDir>/host-windows/bin/<name>-<hash>.exe`. */
export function helperExe(cacheDir: string, name: string, source: string): string {
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
  return path.join(cacheDir, "host-windows", "bin", `${name}-${hash}.exe`);
}

const sources = new Map<string, Promise<string>>();
const built = new Map<string, Promise<string>>();

/**
 * Where helpers are built: the machine's cacheDir, else the system's temp folder, so a machine
 * config without cacheDir can still check whether the Editor has a map open before a compile.
 */
export const helperCacheDir = (context: HostContext): string => (context.machine.cacheDir ? context.requirePath("cacheDir") : path.join(tmpdir(), "sc2-adjutant"));

/** The helper `helpers/<name>.cs`, compiled once into the cache folder; resolves to its exe. */
export async function helper(context: HostContext, name: string): Promise<string> {
  const cacheDir = helperCacheDir(context);
  let reading = sources.get(name);
  if (!reading) {
    reading = readFile(new URL(`./helpers/${name}.cs`, import.meta.url), "utf8");
    sources.set(name, reading);
  }
  const source = await reading;
  // The options are hashed with the source: built against other references, it's another helper.
  // Their folders aren't, so a helper already built runs without looking for csc at all.
  const exe = helperExe(cacheDir, name, [source, ...optionsKey(name)].join("\n"));
  const cached = built.get(exe);
  // A helper in the temp folder can be cleaned away while the server runs: build it again then.
  if (cached && (await cached.then(existsSync, () => true))) return cached;
  if (built.get(exe) === cached) {
    const building = build(exe, name, source);
    built.set(exe, building);
    building.catch(() => {
      if (built.get(exe) === building) built.delete(exe);
    });
  }
  return built.get(exe)!;
}

/** A helper's compile options without the folders of csc and the system's metadata. */
const optionsKey = (name: string): string[] => compileOptions(name, "csc.exe", {}).map((option) => option.replace(/^(-r:).*[\\/]/, "$1"));

async function build(exe: string, name: string, source: string): Promise<string> {
  if (existsSync(exe)) return exe;
  const csc = cscPath();
  const options = compileOptions(name, csc);
  await mkdir(path.dirname(exe), { recursive: true });
  // Built beside its final name and renamed into place, so a half-written exe is never run, and
  // another process building the same source at once only loses the race. Each process compiles
  // its own copy of the source, so none rewrites the file another's csc is reading.
  const sourceFile = exe.replace(/\.exe$/, `.${process.pid}.cs`);
  const draft = exe.replace(/\.exe$/, `.${process.pid}.draft.exe`);
  await writeFile(sourceFile, source);
  try {
    await run(csc, ["-nologo", "-optimize+", ...options, `-out:${draft}`, sourceFile], { windowsHide: true });
  } catch (error) {
    // csc reports compile errors on stdout.
    const output = `${(error as { stdout?: string }).stdout ?? ""}${(error as { stderr?: string }).stderr ?? ""}`.trim();
    await rm(draft, { force: true });
    throw new Error(`couldn't build the Windows Host Adapter's ${path.basename(exe, ".exe")} helper: ${output || (error as Error).message}`, { cause: error });
  } finally {
    await rm(sourceFile, { force: true });
  }
  try {
    await rename(draft, exe);
  } catch (error) {
    await rm(draft, { force: true });
    if (!existsSync(exe)) throw error;
  }
  return exe;
}

export const sleep = (seconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** A deadline `seconds` from now: each helper run takes a moment, so waits count time, not tries. */
export function deadline(seconds: number): () => boolean {
  const end = Date.now() + seconds * 1000;
  return () => Date.now() >= end;
}

/** Runs a helper and resolves to what it printed; one given `timeoutSeconds` is killed past it. */
export async function runHelper(exe: string, args: readonly string[], timeoutSeconds?: number): Promise<string> {
  try {
    return (await run(exe, args, { windowsHide: true, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...(timeoutSeconds === undefined ? {} : { timeout: timeoutSeconds * 1000 }) })).stdout;
  } catch (error) {
    if ((error as { killed?: boolean }).killed && timeoutSeconds !== undefined) {
      throw new Error(`the Windows Host Adapter's helper (${path.basename(exe)} ${args.join(" ")}) didn't finish within ${timeoutSeconds} s`, { cause: error });
    }
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`the Windows Host Adapter's helper failed (${path.basename(exe)} ${args.join(" ")}): ${stderr || (error as Error).message}`, { cause: error });
  }
}
