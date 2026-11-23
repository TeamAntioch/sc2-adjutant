// The Windows Host Adapter's native helpers: C# sources compiled on first use with the in-box .NET
// Framework csc.exe, into the cache folder, under a name that changes with the source.
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compileOptions, cscPath, helperExe } from "../helpers.ts";

describe("the helper build", () => {
  it("uses the 64-bit .NET Framework compiler, else the 32-bit one", () => {
    const framework64 = path.win32.join("D:\\Win", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    const framework = path.win32.join("D:\\Win", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe");
    expect(cscPath({ WINDIR: "D:\\Win" }, () => true)).toBe(framework64);
    expect(cscPath({ WINDIR: "D:\\Win" }, (file) => file === framework)).toBe(framework);
    expect(cscPath({}, (file) => file.startsWith("C:\\Windows\\"))).toBe(path.win32.join("C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"));
    expect(() => cscPath({ WINDIR: "D:\\Win" }, () => false)).toThrow(`No C# compiler at ${framework64}: the Windows Host Adapter builds its helpers with the .NET Framework 4 csc.exe that comes with Windows`);
  });

  it("names the built helper by its source, in the cache folder, so a changed source is built again", () => {
    const first = helperExe("C:\\cache", "editor", "class A {}");
    expect(path.dirname(first)).toBe(path.join("C:\\cache", "host-windows", "bin"));
    expect(path.basename(first)).toMatch(/^editor-[0-9a-f]{12}\.exe$/);
    expect(helperExe("C:\\cache", "editor", "class A {}")).toBe(first);
    expect(helperExe("C:\\cache", "editor", "class B {}")).not.toBe(first);
  });

  it("compiles the capture helper unsafe, against the .NET WinRT facades and the system's WinRT metadata", () => {
    const framework = path.win32.join("D:\\Win", "Microsoft.NET", "Framework64", "v4.0.30319");
    const metadata = path.win32.join("D:\\Win", "System32", "WinMetadata");
    expect(compileOptions("capture", path.win32.join(framework, "csc.exe"), { WINDIR: "D:\\Win" })).toEqual([
      "-unsafe",
      `-r:${path.win32.join(framework, "System.Runtime.dll")}`,
      `-r:${path.win32.join(framework, "System.Runtime.WindowsRuntime.dll")}`,
      `-r:${path.win32.join(framework, "System.Runtime.InteropServices.WindowsRuntime.dll")}`,
      "-r:System.Drawing.dll",
      `-r:${path.win32.join(metadata, "Windows.Foundation.winmd")}`,
      `-r:${path.win32.join(metadata, "Windows.Graphics.winmd")}`,
    ]);
    expect(compileOptions("editor", path.win32.join(framework, "csc.exe"), { WINDIR: "D:\\Win" })).toEqual([]);
  });

  it("compiles the speech helper against System.Speech, which csc finds only by its path in the framework's WPF folder", () => {
    const framework = path.win32.join("D:\\Win", "Microsoft.NET", "Framework64", "v4.0.30319");
    expect(compileOptions("speech", path.win32.join(framework, "csc.exe"), { WINDIR: "D:\\Win" })).toEqual([`-r:${path.win32.join(framework, "WPF", "System.Speech.dll")}`]);
  });
});
