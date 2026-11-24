// The Windows Host Adapter as core loads it: as bundled:host-windows, the name a machine config gives
// it, with its capabilities and what they need from the machine config.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { HostContext } from "@team-antioch/sc2-adjutant/plugin-sdk";
import { loadHost } from "@team-antioch/sc2-adjutant/src/host/host.js";
import { loadMachineConfig } from "@team-antioch/sc2-adjutant/src/host/machine-config.js";
import { afterEach, assert, describe, expect, it } from "vitest";

import { helper, helperCacheDir, runHelper } from "../helpers.ts";

const folders: string[] = [];
// One at a time, newest first: a test that points TEMP at its own folder makes the next ones inside
// it, and two removals of one tree at once fail on Windows. The retries cover Windows' brief locks.
afterEach(async () => {
  for (const folder of folders.splice(0).reverse()) await rm(folder, { recursive: true, force: true, maxRetries: 5 });
});

async function tempFolder(): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-host-"));
  folders.push(folder);
  return folder;
}

/** A machine config file with these settings, in its own folder. */
async function machineConfig(settings: Record<string, string>): Promise<string> {
  const file = path.join(await tempFolder(), "machine.json");
  await writeFile(file, JSON.stringify(settings));
  return file;
}

const CAPABILITIES = [
  "editor.open",
  "editor.checkClosed",
  "editor.testDocument",
  "editor.save",
  "editor.captureTour",
  "editor.closeCaptureCopies",
  "game.banksDir",
  "screen.capture",
  "game.launch",
  "game.running",
  "game.list",
  "game.quit",
  "game.logsFolder",
  "tts.speak",
  "model.render",
  "model.rendererKey",
  "model.export",
  "model.exportGltf",
];

describe("the Windows Host Adapter", () => {
  it("loads as bundled:host-windows with Editor launch, the open check, Test Document, save, capture tours, screen capture, game launch, speech and models", async () => {
    const host = await loadHost(await loadMachineConfig({ file: await machineConfig({ hostAdapter: "bundled:host-windows" }), env: {} }));
    expect(host.adapter).toMatchObject({
      name: "host-windows",
      source: "bundled:host-windows",
      roles: ["host-adapter"],
      contributions: { capabilities: CAPABILITIES },
    });
    for (const capability of CAPABILITIES) expect(host.has(capability as "editor.open")).toBe(true);
  });

  it("doesn't load on Windows when the machine config names no Host Adapter", async () => {
    const machine = await loadMachineConfig({ file: await machineConfig({}), env: {}, platform: "win32" });
    expect((await loadHost(machine)).adapter).toBeUndefined();
  });

  it("loads from its folder too, as a local folder Plugin", async () => {
    const file = await machineConfig({ hostAdapter: fileURLToPath(new URL("..", import.meta.url)) });
    expect((await loadHost(await loadMachineConfig({ file, env: {} }))).adapter).toMatchObject({ name: "host-windows", roles: ["host-adapter"] });
  });

  it("needs the Editor's path from the machine config to open, test or save in the Editor", async () => {
    const file = await machineConfig({ hostAdapter: "bundled:host-windows", cacheDir: "./cache" });
    const host = await loadHost(await loadMachineConfig({ file, env: {} }));
    const mapPath = path.join(path.dirname(file), "Mission.SC2Map");
    const missing = `No editorPath is set: add "editorPath" to the machine config ${file}`;
    await expect(host.run("editor.open", { mapPath })).rejects.toThrow(missing);
    await expect(host.run("editor.testDocument", { mapPath })).rejects.toThrow(missing);
    await expect(host.run("editor.save", { mapPath })).rejects.toThrow(missing);
  });

  it("builds its helper in the temp folder without a cache folder, so the open check before a compile still answers", () => {
    expect(helperCacheDir({ machine: {}, requirePath: () => assert.fail("asked for a path") } as unknown as HostContext)).toBe(path.join(tmpdir(), "sc2-adjutant"));
    expect(helperCacheDir({ machine: { cacheDir: "C:\\cache" }, requirePath: () => "C:\\cache" } as unknown as HostContext)).toBe("C:\\cache");
  });

  it.runIf(process.platform === "win32")("answers the open check with no cache folder set", async () => {
    // The system temp folder is this test's own, so the helper is built there and nowhere else.
    const temp = { TEMP: process.env.TEMP, TMP: process.env.TMP };
    const folder = await tempFolder();
    process.env.TEMP = process.env.TMP = folder;
    try {
      const file = await machineConfig({ hostAdapter: "bundled:host-windows", editorPath: "./SC2Editor.exe" });
      const host = await loadHost(await loadMachineConfig({ file, env: {} }));
      await expect(host.run("editor.checkClosed", { mapPath: path.join(path.dirname(file), "Nobody Opened This.SC2Map") })).resolves.toBeUndefined();
      const bin = path.join(folder, "sc2-adjutant", "host-windows", "bin");
      expect(existsSync(bin)).toBe(true);
      // Cleaned away from the temp folder while the server runs, it's built again.
      await rm(bin, { recursive: true, force: true });
      await expect(host.run("editor.checkClosed", { mapPath: path.join(path.dirname(file), "Nobody Opened This.SC2Map") })).resolves.toBeUndefined();
      expect(existsSync(bin)).toBe(true);
    } finally {
      for (const [name, value] of Object.entries(temp)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }, 60_000);

  it("says when there's no Editor at the path the machine config names", async () => {
    const file = await machineConfig({ hostAdapter: "bundled:host-windows", editorPath: "./Support/SC2Editor.exe", cacheDir: "./cache" });
    const host = await loadHost(await loadMachineConfig({ file, env: {} }));
    await expect(host.run("editor.open", { mapPath: path.join(path.dirname(file), "Mission.SC2Map") })).rejects.toThrow(
      `No StarCraft II Editor at ${path.join(path.dirname(file), "Support", "SC2Editor.exe")} (editorPath); set it to the install's Support\\SC2Editor.exe`,
    );
  });

  it("needs the install folder to launch the game, and SC2Switcher in it, and the map", async () => {
    const file = await machineConfig({ hostAdapter: "bundled:host-windows", cacheDir: "./cache" });
    const folder = path.dirname(file);
    const mapPath = path.join(folder, "Mission.SC2Map");
    await expect((await loadHost(await loadMachineConfig({ file, env: {} }))).run("game.launch", { mapPath })).rejects.toThrow(`No sc2Path is set: add "sc2Path" to the machine config ${file}`);

    await writeFile(file, JSON.stringify({ hostAdapter: "bundled:host-windows", cacheDir: "./cache", sc2Path: "./StarCraft II" }));
    const host = await loadHost(await loadMachineConfig({ file, env: {} }));
    const switcher = path.join(folder, "StarCraft II", "Support", "SC2Switcher.exe");
    await expect(host.run("game.launch", { mapPath })).rejects.toThrow(`No SC2Switcher at ${switcher}: set sc2Path to the StarCraft II install folder`);

    await mkdir(path.dirname(switcher), { recursive: true });
    await writeFile(switcher, "");
    await expect(host.run("game.launch", { mapPath: "Mission.SC2Map" })).rejects.toThrow(`No map at ${path.resolve("Mission.SC2Map")}`);
  });

  it("refuses to capture to anything but a JPEG or PNG", async () => {
    const file = await machineConfig({ hostAdapter: "bundled:host-windows", cacheDir: "./cache" });
    const host = await loadHost(await loadMachineConfig({ file, env: {} }));
    const outputPath = path.join(path.dirname(file), "shot.bmp");
    await expect(host.run("screen.capture", { outputPath })).rejects.toThrow(`screen.capture writes JPEG (.jpg, .jpeg) or PNG (.png), not ${outputPath}`);
  });

  it.runIf(process.platform === "win32")("builds its capture helper against WinRT, which says when there's no such window", async () => {
    const cacheDir = await tempFolder();
    const exe = await helper({ machine: { cacheDir }, requirePath: () => cacheDir }, "capture");
    await expect(runHelper(exe, ["capture", "1", path.join(cacheDir, "shot.png"), "png"])).rejects.toThrow("no window 1");
  }, 60_000);

  const TOUR = { bank: "ExTour", frameDigits: 3, width: 1600, quality: 80, startSeconds: 300, pressSpaceAfterSeconds: 30 } as const;

  it("only tours a map in the cache's capture folder, since it closes it without saving", async () => {
    const file = await machineConfig({ hostAdapter: "bundled:host-windows", cacheDir: "./cache" });
    const folder = path.dirname(file);
    const host = await loadHost(await loadMachineConfig({ file, env: {} }));
    const mapPath = path.join(folder, "Mission.SC2Map");
    await expect(host.run("editor.captureTour", { ...TOUR, mapPath, outputDir: path.join(folder, "frames") })).rejects.toThrow(
      `editor.captureTour closes its map without saving, so it only takes maps in ${path.join(folder, "cache", "capture", "maps")}; ${mapPath} isn't there`,
    );
  });

  it("needs the cache folder to tour and to close capture copies", async () => {
    const file = await machineConfig({ hostAdapter: "bundled:host-windows" });
    const host = await loadHost(await loadMachineConfig({ file, env: {} }));
    const missing = `No cacheDir is set: add "cacheDir" to the machine config ${file}`;
    await expect(host.run("editor.captureTour", { ...TOUR, mapPath: path.join(path.dirname(file), "x.SC2Map"), outputDir: path.join(path.dirname(file), "frames") })).rejects.toThrow(missing);
    await expect(host.run("editor.closeCaptureCopies", {})).rejects.toThrow(missing);
  });

  it.runIf(process.platform === "win32")("builds its capture helper's tour frames, which says when there's no such window", async () => {
    const cacheDir = await tempFolder();
    const exe = await helper({ machine: { cacheDir }, requirePath: () => cacheDir }, "capture");
    await expect(runHelper(exe, ["frame", "1", path.join(cacheDir, "001.jpg"), "80", "1600"])).rejects.toThrow("no window 1");
  }, 60_000);

  it.runIf(process.platform === "win32")("finds Documents through the shell, for the game's banks", async () => {
    const cacheDir = await tempFolder();
    const exe = await helper({ machine: { cacheDir }, requirePath: () => cacheDir }, "editor");
    const documents = (await runHelper(exe, ["documents"])).trim();
    expect(path.isAbsolute(documents)).toBe(true);
    expect((await stat(documents)).isDirectory()).toBe(true);
  }, 60_000);

  it.runIf(process.platform === "win32")("closes no capture copies when the Editor has none open", async () => {
    const file = await machineConfig({ hostAdapter: "bundled:host-windows", cacheDir: "./cache" });
    const host = await loadHost(await loadMachineConfig({ file, env: {} }));
    const log: string[] = [];
    await expect(host.run("editor.closeCaptureCopies", { log: (line) => log.push(line) })).resolves.toBeUndefined();
    expect(log).toEqual([]);
  }, 60_000);

  it("renders, exports and keys models only with the viewer the machine config names", async () => {
    const file = await machineConfig({ hostAdapter: "bundled:host-windows", cacheDir: "./cache" });
    const host = await loadHost(await loadMachineConfig({ file, env: {} }));
    const request = { model: "Assets/Doodads/RockArch/RockArch_00.m3", outputPaths: ["a0.png"], size: 512 };
    await expect(host.run("model.render", request)).rejects.toThrow(`No modelViewerPath is set: add "modelViewerPath" to the machine config ${file}, or set SC2_ADJUTANT_MODEL_VIEWER_PATH`);
    await expect(host.run("model.export", { model: request.model, outputPath: "m.m3" })).rejects.toThrow("No modelViewerPath is set");
    await expect(host.run("model.exportGltf", { model: request.model, outputPath: "m.glb" })).rejects.toThrow("No modelViewerPath is set");
    await expect(host.run("model.rendererKey", { outputs: 4, size: 512 })).rejects.toThrow("No modelViewerPath is set");
  });

  it("says when the viewer the machine config names isn't built", async () => {
    const file = await machineConfig({ hostAdapter: "bundled:host-windows", cacheDir: "./cache", modelViewerPath: "./wf/WhiteoutFlakes.exe" });
    const host = await loadHost(await loadMachineConfig({ file, env: {} }));
    await expect(host.run("model.export", { model: "Assets/X.m3", outputPath: "m.m3" })).rejects.toThrow(
      `No WhiteoutFlakes viewer at ${path.join(path.dirname(file), "wf", "WhiteoutFlakes.exe")} (modelViewerPath); build it with packages\\plugin-host-windows\\scripts\\build-whiteoutflakes.ps1`,
    );
  });

  it("keys renders by the viewer build and the recipe", async () => {
    const file = await machineConfig({ hostAdapter: "bundled:host-windows", cacheDir: "./cache", modelViewerPath: "./WhiteoutFlakes.exe" });
    await writeFile(path.join(path.dirname(file), "WhiteoutFlakes.exe"), "");
    const host = await loadHost(await loadMachineConfig({ file, env: {} }));
    const key = await host.run("model.rendererKey", { outputs: 4, size: 512 });
    expect(key).toMatch(/^[0-9a-f]{40}$/);
    expect(await host.run("model.rendererKey", { outputs: 4, size: 512 })).toBe(key);
    expect(await host.run("model.rendererKey", { outputs: 4, size: 256 })).not.toBe(key);
  });

  it.runIf(process.platform === "win32")("speaks a line to a 22050 Hz, 16-bit, mono WAV, and fails on a voice that isn't installed", async () => {
    const folder = await tempFolder();
    const file = path.join(folder, "machine.json");
    await writeFile(file, JSON.stringify({ hostAdapter: "bundled:host-windows", cacheDir: "./cache" }));
    const host = await loadHost(await loadMachineConfig({ file, env: {} }));
    const outputPath = path.join(folder, "line.wav");
    // Quotes, a line break and dashes, which a command line would mangle.
    await host.run("tts.speak", { text: 'Commander, the "moons" are\r\nunder attack -- hurry.', character: "ADJUTANT", outputPath });
    const wav = await readFile(outputPath);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    const fmt = wav.indexOf("fmt ");
    expect({ format: wav.readUInt16LE(fmt + 8), channels: wav.readUInt16LE(fmt + 10), rate: wav.readUInt32LE(fmt + 12), bits: wav.readUInt16LE(fmt + 22) }).toEqual({
      format: 1,
      channels: 1,
      rate: 22050,
      bits: 16,
    });
    // Over a second of samples.
    expect(wav.readUInt32LE(wav.indexOf("data") + 4)).toBeGreaterThan(2 * 22050);
    // An empty voice is the default voice, as on the Mac.
    await expect(host.run("tts.speak", { text: "Hello.", character: "ADJUTANT", voice: "", outputPath })).resolves.toBeUndefined();
    await expect(host.run("tts.speak", { text: "Hello.", character: "ADJUTANT", voice: "Eddy (English (US))", outputPath })).rejects.toThrow(
      'No Windows voice "Eddy (English (US))": the installed voices are',
    );
  }, 60_000);

  it.runIf(process.platform === "win32")("builds its helper with csc and finds no Editor document for a map nobody opened", async () => {
    const folder = await tempFolder();
    const file = path.join(folder, "machine.json");
    await writeFile(file, JSON.stringify({ hostAdapter: "bundled:host-windows", cacheDir: "./cache" }));
    const host = await loadHost(await loadMachineConfig({ file, env: {} }));
    await expect(host.run("editor.checkClosed", { mapPath: path.join(folder, "Nobody Opened This.SC2Map") })).resolves.toBeUndefined();
  }, 60_000);
});
