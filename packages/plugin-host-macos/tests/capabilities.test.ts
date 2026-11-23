// The macOS Host Adapter's capture and model capabilities (#112), short of driving the Editor, the
// game or the screen: what they need from the machine config, and what they refuse.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadHost } from "@team-antioch/sc2-adjutant/src/host/host.js";
import { loadMachineConfig } from "@team-antioch/sc2-adjutant/src/host/machine-config.js";

import { bankValue, captureFragment, titledMapNames } from "../capture-tour.ts";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

async function macHost(settings: Record<string, string>) {
  const folder = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-macos-"));
  folders.push(folder);
  const file = path.join(folder, "machine.json");
  await writeFile(file, JSON.stringify({ hostAdapter: "bundled:host-macos", ...settings }));
  return { host: await loadHost(await loadMachineConfig({ file, env: {} })), file, folder };
}

describe("the macOS Host Adapter's bulk capabilities", () => {
  it("renders and exports models only with the viewer the machine config names", async () => {
    const { host, file } = await macHost({ cacheDir: "./cache" });
    const request = { model: "Assets/Doodads/RockArch/RockArch.m3", outputPaths: ["a0.png"], size: 512 };
    await expect(host.run("model.render", request)).rejects.toThrow(`No modelViewerPath is set: add "modelViewerPath" to the machine config ${file}, or set SC2_ADJUTANT_MODEL_VIEWER_PATH`);
    await expect(host.run("model.export", { model: request.model, outputPath: "m.m3" })).rejects.toThrow("No modelViewerPath is set");
    await expect(host.run("model.exportGltf", { model: request.model, outputPath: "m.glb" })).rejects.toThrow("No modelViewerPath is set");
  });

  it("says when the viewer the machine config names isn't built", async () => {
    const { host, folder } = await macHost({ cacheDir: "./cache", modelViewerPath: "./WhiteoutFlakes" });
    await expect(host.run("model.export", { model: "Assets/X.m3", outputPath: "m.m3" })).rejects.toThrow(
      `No WhiteoutFlakes viewer at ${path.join(folder, "WhiteoutFlakes")} (modelViewerPath); build it with packages/plugin-host-macos/scripts/build-whiteoutflakes.sh`,
    );
  });

  it("captures tours only of maps in the cache's capture folder, which it may close unsaved", async () => {
    const { host, folder } = await macHost({ cacheDir: "./cache", editorPath: "/Applications/Editor.app" });
    const mapPath = path.join(folder, "missions", "Antioch 1-1.SC2Map");
    const tour = { mapPath, bank: "ExTour", outputDir: path.join(folder, "frames"), frameDigits: 3, width: 1600, quality: 80, startSeconds: 300, pressSpaceAfterSeconds: 30 };
    await expect(host.run("editor.captureTour", tour)).rejects.toThrow(
      `editor.captureTour closes its map without saving, so it only takes maps in ${path.join(folder, "cache", "capture", "maps")}; ${mapPath} isn't there`,
    );
  });

  it("needs the cache folder to capture", async () => {
    const { host } = await macHost({});
    await expect(host.run("editor.captureTour", { mapPath: "/x.SC2Map", bank: "ExTour", outputDir: "/frames", frameDigits: 3, width: 1600, quality: 80, startSeconds: 300, pressSpaceAfterSeconds: 30 })).rejects.toThrow(
      "No cacheDir is set",
    );
  });

  it("reads the stop and camera target the tour saved in its bank", () => {
    const bank = `<?xml version="1.0" encoding="utf-8"?>
<Bank version="1">
    <Section name="tour">
        <Key name="stop">
            <Value int="12"/>
        </Key>
        <Key name="x">
            <Value fixed="40.5"/>
        </Key>
        <Key name="y">
            <Value fixed="-3"/>
        </Key>
    </Section>
</Bank>`;
    expect(bankValue(bank, "stop", "int")).toBe("12");
    expect(bankValue(bank, "x", "fixed")).toBe("40.5");
    expect(bankValue(bank, "y", "fixed")).toBe("-3");
    expect(bankValue(bank, "z", "fixed")).toBeUndefined();
    expect(bankValue("", "stop", "int")).toBeUndefined();
  });
});

describe("capture copies in the Editor's window titles", () => {
  // Seen 2026-11-21: the Editor shortened this copy's path to "/.../maps/", dropping "capture/".
  const copy = "/Users/me/Library/Caches/sc2-adjutant/capture/maps/texture-swap-crystal shots-texture-swap-crystal-mwqbnpi90.SC2Map";
  const titles = [
    "Cutscenes - [/.../maps/texture-swap-crystal shots-texture-swap-crystal-mwqbnpi90.SC2Map > Untitled Scene] - StarCraft II Editor",
    "Messages - StarCraft II Editor",
    "Terrain - [/.../maps/texture-swap-crystal shots-texture-swap-crystal-mwqbnpi90.SC2Map] - StarCraft II Editor",
    "Terrain - [/.../cave-review/missions/cave-run/Cave-Run.SC2Map/*] - StarCraft II Editor",
  ].join("\n");

  it("finds a copy whose title shortened its path", () => {
    expect(titles).toContain(captureFragment(copy));
    expect(titles).not.toContain(captureFragment(copy.replace("mwqbnpi90", "mwqbnpi91")));
  });

  it("reads every titled map's name, however much of the path shows", () => {
    expect(new Set(titledMapNames(titles))).toEqual(new Set(["texture-swap-crystal shots-texture-swap-crystal-mwqbnpi90.SC2Map", "Cave-Run.SC2Map"]));
  });
});
