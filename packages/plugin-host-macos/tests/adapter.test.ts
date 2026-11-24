// The macOS Host Adapter as core loads it: as bundled:host-macos, the name a machine config gives it,
// with its capabilities and what they need from the machine config.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadHost } from "@team-antioch/sc2-adjutant/src/host/host.js";
import { loadMachineConfig } from "@team-antioch/sc2-adjutant/src/host/machine-config.js";
import { afterEach, describe, expect, it } from "vitest";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
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

describe("the macOS Host Adapter", () => {
  it("loads as bundled:host-macos with Editor launch, Test Document, captures, speech and models", async () => {
    const host = await loadHost(await loadMachineConfig({ file: await machineConfig({ hostAdapter: "bundled:host-macos" }), env: {} }));
    expect(host.adapter).toMatchObject({
      name: "host-macos",
      source: "bundled:host-macos",
      roles: ["host-adapter"],
      contributions: { capabilities: ["editor.open", "editor.checkClosed", "editor.refresh","editor.testDocument", "editor.save", "editor.captureTour", "editor.closeCaptureCopies", "game.running", "game.banksDir", "game.list", "game.quit", "screen.capture", "tts.speak", "model.render", "model.rendererKey", "model.export", "model.exportGltf"] },
    });
  });

  it("doesn't load on a Mac when the machine config names no Host Adapter", async () => {
    const machine = await loadMachineConfig({ file: await machineConfig({}), env: {}, platform: "darwin" });
    expect((await loadHost(machine)).adapter).toBeUndefined();
  });

  it("loads from its folder too, as a local folder Plugin", async () => {
    const file = await machineConfig({ hostAdapter: fileURLToPath(new URL("..", import.meta.url)) });
    expect((await loadHost(await loadMachineConfig({ file, env: {} }))).adapter).toMatchObject({ name: "host-macos", roles: ["host-adapter"] });
  });

  it("needs the Editor's path from the machine config to open the Editor", async () => {
    const file = await machineConfig({ hostAdapter: "bundled:host-macos" });
    const host = await loadHost(await loadMachineConfig({ file, env: {} }));
    await expect(host.run("editor.open", { mapPath: "/tmp/Mission.SC2Map" })).rejects.toThrow(`No editorPath is set: add "editorPath" to the machine config ${file}`);
  });

  it.runIf(process.platform === "darwin")("speaks a placeholder line into a WAV with say", async () => {
    const host = await loadHost(await loadMachineConfig({ file: await machineConfig({ hostAdapter: "bundled:host-macos" }), env: {} }));
    const outputPath = path.join(await tempFolder(), "line.wav");
    await host.run("tts.speak", { text: "Captain, the relay is back on line.", character: "Raynor", outputPath });
    const wav = await readFile(outputPath);
    expect(wav.subarray(8, 12).toString()).toBe("WAVE");
    expect(wav.length).toBeGreaterThan(22050);
  }, 30_000);
});
