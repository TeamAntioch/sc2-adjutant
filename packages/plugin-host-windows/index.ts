// The Windows Host Adapter, a first-party Plugin package (spec #727) that core loads as
// bundled:host-windows: what an author's Windows machine can do with
// StarCraft II. It opens Map Packages in the Galaxy Editor, tells whether the Editor has one open,
// runs Test Document through the Editor's menu, and saves a copy of a map there (the MapScript drift
// test) (editor.ts). It captures camera tours through the Editor and the game (capture-tour.ts),
// starts the game on a map with no Editor and captures the game's window (game.ts), and speaks
// placeholder voice lines with Windows' built-in voices (speech.ts), and renders and exports game
// models with WhiteoutFlakes (whiteoutflakes.ts). Every path comes from the machine config
// (`editorPath`, `sc2Path`, `cacheDir`, `modelViewerPath`); nothing about the machine is built in. Its
// native helpers (helpers/*.cs) are compiled on first use into <cacheDir>/host-windows/bin
// (helpers.ts). docs/windows-host.md has the Editor and game facts it relies on.

import type { PluginCode } from "@team-antioch/sc2-adjutant/plugin-sdk";

import { banksDir, captureTour, closeCaptureCopies } from "./capture-tour.ts";
import { checkClosed, openInEditor, saveInEditor, testDocument } from "./editor.ts";
import { captureScreen, gameRunning, launchGame, listGames, quitGame } from "./game.ts";
import { speak } from "./speech.ts";
import { exportModel, exportModelGltf, rendererKey, renderModel } from "./whiteoutflakes.ts";

const plugin: PluginCode = {
  capabilities: {
    "editor.open": openInEditor,
    "editor.checkClosed": checkClosed,
    "editor.testDocument": testDocument,
    "editor.save": saveInEditor,
    "editor.captureTour": captureTour,
    "editor.closeCaptureCopies": closeCaptureCopies,
    "game.banksDir": banksDir,
    "screen.capture": captureScreen,
    "game.launch": launchGame,
    "game.running": gameRunning,
    "game.list": listGames,
    "game.quit": quitGame,
    "tts.speak": speak,
    "model.render": renderModel,
    "model.rendererKey": rendererKey,
    "model.export": exportModel,
    "model.exportGltf": exportModelGltf,
  },
};
export default plugin;
