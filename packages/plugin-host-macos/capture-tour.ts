// editor.captureTour and screen.capture on the Mac: camera-tour captures driven through the Galaxy
// Editor, as the Exemplar and cinematic-set captures were with their shell scripts. Opens the
// capture map with the Editor at `editorPath`, clicks File > Test Document, screenshots the game
// window each time the map announces a new stop in its bank, then quits the game and closes the map
// without saving. Only documents under <cacheDir>/capture/maps/ are ever closed or discarded.
//
// Mac facts it relies on (docs/reference/game-testing.md has more):
// - The Editor has to come forward for a moment to open its menu; macOS refuses that while someone
//   is using another app. Then this posts a notification and, for up to 15 minutes, tries again
//   every 30 seconds (it gets through once they pause) while waiting for their click.
// - With the Editor's Test Document window mode set to Windowed, the game can sit behind other
//   windows (`screencapture -l` reads a covered window), but not minimized; a locked or sleeping
//   screen hides every window from Accessibility, so the display is kept awake.
// - The game saves banks to ~/Library/Application Support/Blizzard/StarCraft II/Banks/.
// - Save prompts are sometimes invisible to Accessibility; they are read and answered by OCR.
// - A loading screen may wait for Space; pressing it takes focus, so only after a long wait.
// Needs Accessibility and Screen Recording for the app that runs it.

import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { CAPTURE_MAPS_FOLDER, type CaptureTourRequest, type CaptureTourResult, type GameProcess, type HostContext, ownedGame, quitOwnedGame, refuseForeignGame } from "@team-antioch/sc2-adjutant/plugin-sdk";

import { macSystem } from "./games.ts";

const run = promisify(execFile);
const sleep = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

const EDITOR = "StarCraft II Editor";
/**
 * What a window title holds for this capture copy: its file name after a slash. Not its folder: the
 * Editor shortens a long title's path ("[/.../maps/<name>]"), and with a long enough name even
 * "capture/" goes. The name is enough, since each copy's name ends in its job id.
 */
export const captureFragment = (mapPath: string): string => `/${path.basename(mapPath)}`;

/** A copy the Editor Broker named: `<map> <label>-<job id>.SC2Map`, the id base-36 milliseconds and a count. */
const BROKER_COPY_NAME = / [^/]*-[0-9a-z]{9,}\.SC2Map$/i;

/** The .SC2Map file names in the Editor's window titles, whatever of their path the title shows. */
export const titledMapNames = (titles: string): string[] =>
  [...titles.matchAll(/\/([^/\t\n]+?\.SC2Map)/gi)].map((match) => match[1]!);
const BANKS = path.join(os.homedir(), "Library/Application Support/Blizzard/StarCraft II/Banks");

/** A bank file's int or fixed value for a key, as the game writes it (`<Key name="..."><Value int="..."/>`). */
export function bankValue(bank: string, key: string, kind: "int" | "fixed"): string | undefined {
  const match = new RegExp(`name="${key}"[^\\n]*\\n[^\\n]*${kind}="([-0-9.]*)"`).exec(bank);
  return match?.[1];
}

/** Every window of the processes whose owner name contains argv[0]: owner, layer, id, size, title, tab-separated. */
const WINDOW_LIST = `
ObjC.import('CoreGraphics');
ObjC.import('Foundation');
function run(argv) {
  const arr = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionAll, 0));
  const out = [];
  for (let i = 0; i < arr.count; i++) {
    const w = ObjC.deepUnwrap(arr.objectAtIndex(i));
    if ((w.kCGWindowOwnerName || '').includes(argv[0]))
      out.push(\`\${w.kCGWindowOwnerName}\\tL\${w.kCGWindowLayer}\\t\${w.kCGWindowNumber}\\t\${w.kCGWindowBounds.Width}x\${w.kCGWindowBounds.Height}\\t\${w.kCGWindowName || ''}\`);
  }
  return out.join('\\n');
}`;

/** The Editor's window titles as Accessibility sees them, one per line. */
const AX_WINDOWS = `
tell application "System Events"
  if not (exists process "${EDITOR}") then return ""
  tell process "${EDITOR}"
    set out to ""
    repeat with w in windows
      try
        set out to out & (name of w) & linefeed
      end try
    end repeat
    return out
  end tell
end tell`;

/**
 * Makes the document whose window titles contain argv[1] the Editor's active one, then clicks
 * argv[2] > argv[3], trying for argv[4] seconds. Menu commands act on the active document and work
 * from any Editor window showing it; Test Document does nothing while an Activity window is open.
 * Prefers a window that isn't minimized, restores a minimized one only when it's the only choice,
 * and then says "restored". Never acts on another document.
 */
/** How often a capture tries again to bring the Editor forward while waiting for the author. */
const RAISE_RETRY_MS = 30_000;

/** Prints "granted" or "denied": whether this process may read other apps' windows (Screen Recording). */
const SCREEN_ACCESS_SWIFT = `import CoreGraphics
print(CGPreflightScreenCaptureAccess() ? "granted" : "denied")
`;

const MENU_CLICK = `
on run argv
  set fragment to item 1 of argv
  set m to item 2 of argv
  set i to item 3 of argv
  set tries to (item 4 of argv) as integer
  set restored to false
  tell application "System Events" to tell process "${EDITOR}"
    repeat tries times
      set loading to false
      set target to missing value
      set fallback to missing value
      repeat with w in windows
        try
          set n to name of w
          if n starts with "Activity - " then set loading to true
          if n contains fragment then
            if value of attribute "AXMinimized" of w is false then
              set target to w
            else
              set fallback to w
            end if
          end if
        end try
      end repeat
      if not loading and (target is not missing value or fallback is not missing value) then
        if target is missing value then
          set target to fallback
          set value of attribute "AXMinimized" of target to false
          set restored to true
          delay 1
        end if
        perform action "AXRaise" of target
        set value of attribute "AXFrontmost" to true
        delay 0.8
        if (name of window 1) contains fragment then
          click menu item i of menu 1 of menu bar item m of menu bar 1
          if restored then return "clicked restored"
          return "clicked"
        end if
      end if
      delay 1
    end repeat
  end tell
  error "could not make the capture copy active (still loading, or no window shows it)"
end run`;

/** Dismisses script-error and OK dialogs; says whether a window still shows a capture copy. */
const CLOSE_PREPARE = `
on run argv
  set fragment to item 1 of argv
  tell application "System Events" to tell process "${EDITOR}"
    try
      click button 1 of window "Script Compile Errors"
    end try
    repeat with w in windows
      try
        if exists button "OK" of w then click button "OK" of w
      end try
    end repeat
    repeat with w in windows
      try
        if (name of w) contains fragment then return "open"
      end try
    end repeat
  end tell
  return "nothing to close"
end run`;

/** Answers a save prompt: Don't Save for a capture copy, Cancel for any other document. */
const ANSWER_SAVE = `
on run argv
  set fragment to item 1 of argv
  tell application "System Events" to tell process "${EDITOR}"
    repeat with w in windows
      try
        set txt to (value of every static text of w) as text
        if txt contains "Save changes" then
          repeat with b in buttons of w
            if txt contains fragment and name of b starts with "Don" then
              click b
              return "discarded"
            else if txt does not contain fragment and name of b is "Cancel" then
              click b
              return "REFUSED: prompt was for another document"
            end if
          end repeat
        end if
      end try
    end repeat
  end tell
  return "closed"
end run`;

const MINIMIZE_TERRAIN = `
tell application "System Events" to tell process "${EDITOR}"
  repeat with w in windows
    try
      if (name of w) starts with "Terrain - " then set value of attribute "AXMinimized" of w to true
    end try
  end repeat
end tell`;

/**
 * The game window's size while recording, in points: 1280 wide, with a 16:9 picture under a 28-point
 * title bar. Window capture gets no frames while the game window fills the display: macOS then
 * hands it to the display without compositing it (2026-11-23: 27 s of nothing at 1728x1084, then
 * steady frames from just after it was resized, with no gaps).
 */
export const RECORD_WINDOW = { width: 1280, height: 748 } as const;

/** How many times a recorder that exits before its first frame is started again in one tour. */
const RECORD_TRIES = 3;

/** resize-game <width> <height>: resizes the game's window; prints its size afterwards, "w, h", or nothing while the game doesn't answer (it doesn't while loading). */
const RESIZE_GAME = `on run argv
  tell application "System Events" to tell process "SC2"
    if (count of windows) is 0 then return ""
    set size of window 1 to {(item 1 of argv) as integer, (item 2 of argv) as integer}
    delay 0.3
    set {w, h} to size of window 1
    return (w as text) & ", " & (h as text)
  end tell
end run`;

const PRESS_SPACE = `
tell application "System Events" to tell process "SC2" to set value of attribute "AXFrontmost" to true
delay 0.3
tell application "System Events" to key code 49`;

/**
 * dialog <owner> <must-contain> <button-text>: finds an untitled dialog window of <owner>, reads it
 * by OCR, and clicks <button-text> only if its text contains <must-contain>.
 */
const DIALOG_SWIFT = `import CoreGraphics
import Foundation
import ImageIO
import Vision

let args = CommandLine.arguments
let owner = args[1], mustContain = args[2], buttonText = args[3]
let infos = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as! [[String: Any]]
for info in infos {
  guard (info[kCGWindowOwnerName as String] as? String) == owner,
        ((info[kCGWindowName as String] as? String) ?? "").isEmpty,
        let id = info[kCGWindowNumber as String] as? CGWindowID,
        let b = info[kCGWindowBounds as String] as? [String: CGFloat],
        let w = b["Width"], let h = b["Height"], w > 150, h > 150, w < 900, h < 900
  else { continue }
  let path = NSTemporaryDirectory() + "dialog-\\(id).png"
  let cap = Process()
  cap.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  cap.arguments = ["-x", "-o", "-l", "\\(id)", path]
  try? cap.run(); cap.waitUntilExit()
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { continue }
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  try? VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
  let obs = req.results ?? []
  let text = obs.compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
  let flat = text.replacingOccurrences(of: " ", with: "")
  guard flat.contains(mustContain.replacingOccurrences(of: " ", with: "")) else {
    print("SKIP window \\(id): \\(text)"); continue
  }
  guard let btn = obs.first(where: { ($0.topCandidates(1).first?.string ?? "").replacingOccurrences(of: "\\u{2019}", with: "'") == buttonText }) else {
    print("NO BUTTON in \\(id): \\(text)"); continue
  }
  // Vision boxes are normalised with a bottom-left origin.
  let p = CGPoint(x: b["X"]! + btn.boundingBox.midX * w, y: b["Y"]! + (1 - btn.boundingBox.midY) * h)
  let source = CGEventSource(stateID: .hidSystemState)
  for t in [CGEventType.mouseMoved, .leftMouseDown, .leftMouseUp] {
    let e = CGEvent(mouseEventSource: source, mouseType: t, mouseCursorPosition: p, mouseButton: .left)
    e?.setIntegerValueField(.mouseEventClickState, value: 1)
    e?.post(tap: .cghidEventTap)
    usleep(150_000)
  }
  print("CLICKED \\(buttonText) in \\(id)")
  exit(0)
}
print("NONE")
`;

/** crop <in.jpg> <out.jpg> <quality>: cuts whatever sits above a 16:9 picture (the window's title bar). sips's --cropOffset is ignored on this macOS. */
const CROP_SWIFT = `import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 5,
  let quality = Double(args[3]),
  let width = Int(args[4]),
  let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil),
  let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
  let cropped = image.cropping(to: CGRect(x: 0, y: max(0, image.height - image.width * 9 / 16), width: image.width, height: min(image.height, image.width * 9 / 16))),
  let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
else {
  FileHandle.standardError.write("usage: crop <in.png> <out.jpg> <quality 0-1> <max width>\\n".data(using: .utf8)!)
  exit(2)
}
// Scaled so neither side is over <max width>, as sips -Z did; never enlarged.
let scale = min(1.0, Double(width) / Double(max(cropped.width, cropped.height)))
let outWidth = max(1, Int((Double(cropped.width) * scale).rounded()))
let outHeight = max(1, Int((Double(cropped.height) * scale).rounded()))
guard let context = CGContext(data: nil, width: outWidth, height: outHeight, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { exit(1) }
context.interpolationQuality = .high
context.draw(cropped, in: CGRect(x: 0, y: 0, width: outWidth, height: outHeight))
guard let scaled = context.makeImage() else { exit(1) }
CGImageDestinationAddImage(destination, scaled, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
exit(CGImageDestinationFinalize(destination) ? 0 : 1)
`;

/**
 * record <window-id> <out.mp4> <width> <fps> <quality>: records one window as HEVC at <quality>
 * (AVVideoQualityKey, 0-1), the 16:9 picture under its title bar, scaled to <width>. A covered window records; a minimized one doesn't. Frames come only
 * when the window changes, so a still scene costs next to nothing. Prints "started <unix seconds>"
 * at the first frame, which is the video's time 0; stops, finishing the file, when stdin closes
 * (so a caller that dies doesn't leave it recording) or on SIGINT/SIGTERM.
 */
const RECORD_SWIFT = `import AppKit
import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

_ = NSApplication.shared // a command-line tool needs the window server connection ScreenCaptureKit uses
let args = CommandLine.arguments
guard args.count == 6, let windowID = UInt32(args[1]), let width = Int(args[3]), let fps = Int32(args[4]), let quality = Double(args[5]), quality > 0, quality <= 1 else {
  FileHandle.standardError.write("usage: record <window-id> <out.mp4> <width> <fps> <quality 0-1>\\n".data(using: .utf8)!)
  exit(2)
}
let outURL = URL(fileURLWithPath: args[2])
try? FileManager.default.removeItem(at: outURL)

final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
  let queue = DispatchQueue(label: "record")
  var writer: AVAssetWriter?
  var input: AVAssetWriterInput?
  var started = false
  var finishing = false
  var counts: [Int: Int] = [:]
  var lastReport = Date()

  func setup(width: Int, height: Int, fps: Int32, quality: Double) throws {
    let writer = try AVAssetWriter(outputURL: outURL, fileType: .mp4)
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.hevc,
      AVVideoWidthKey: width,
      AVVideoHeightKey: height,
      AVVideoCompressionPropertiesKey: [AVVideoQualityKey: quality, AVVideoExpectedSourceFrameRateKey: Int(fps)],
    ])
    input.expectsMediaDataInRealTime = true
    writer.add(input)
    writer.startWriting()
    self.writer = writer
    self.input = input
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, !finishing, let writer, let input else { return }
    let attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]]
    let status = attachments?.first?[.status] as? Int ?? -1
    counts[status, default: 0] += 1
    // Every 5 s, how many frames came by status (0 complete, 1 idle, 2 blank, 3 suspended, 4 started, 5 stopped), to stderr.
    if Date().timeIntervalSince(lastReport) >= 5 {
      lastReport = Date()
      FileHandle.standardError.write("record: frames by status \\(counts.sorted { $0.key < $1.key })\\n".data(using: .utf8)!)
    }
    guard buffer.isValid, SCFrameStatus(rawValue: status) == .complete else { return }
    if !started {
      writer.startSession(atSourceTime: buffer.presentationTimeStamp)
      started = true
      print("started \\(Date().timeIntervalSince1970)")
      fflush(stdout)
    }
    if input.isReadyForMoreMediaData { input.append(buffer) }
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    FileHandle.standardError.write("record: the stream stopped: \\(error)\\n".data(using: .utf8)!)
    finish(code: 1)
  }

  func finish(code: Int32) {
    queue.async {
      guard !self.finishing else { return }
      self.finishing = true
      guard let writer = self.writer, let input = self.input, self.started, writer.status == .writing else { exit(code) }
      input.markAsFinished()
      writer.finishWriting { exit(writer.status == .completed ? code : 1) }
    }
  }
}

let recorder = Recorder()
var stream: SCStream?
func stop() {
  Task {
    try? await stream?.stopCapture()
    recorder.finish(code: 0)
  }
}

Task {
  do {
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
    guard let window = content.windows.first(where: { $0.windowID == windowID }) else {
      FileHandle.standardError.write("record: no window \\(windowID)\\n".data(using: .utf8)!)
      exit(3)
    }
    // The 16:9 picture at the bottom of the window: what sits above it is the title bar.
    let frame = window.frame
    let pictureHeight = min(frame.height, frame.width * 9 / 16)
    FileHandle.standardError.write("record: window \\(windowID) \\(window.owningApplication?.applicationName ?? "?") \\(Int(frame.width))x\\(Int(frame.height)) on screen: \\(window.isOnScreen)\\n".data(using: .utf8)!)
    // A window on a display of 1 pixel a point has fewer pixels than the recording is wide: it is
    // scaled up then, with no more detail than it had.
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let scale = Double(SCShareableContent.info(for: filter).pointPixelScale)
    FileHandle.standardError.write("record: \\(scale)x, recording \\(width) wide\\(Double(frame.width) * scale < Double(width) ? ", scaled up from \\(Int(Double(frame.width) * scale)) pixels: the window is on a display of fewer pixels a point" : "")\\n".data(using: .utf8)!)
    let config = SCStreamConfiguration()
    config.sourceRect = CGRect(x: 0, y: frame.height - pictureHeight, width: frame.width, height: pictureHeight)
    config.width = width & ~1
    config.height = Int((Double(width) * Double(pictureHeight / frame.width)).rounded()) & ~1
    config.minimumFrameInterval = CMTime(value: 1, timescale: fps)
    config.showsCursor = false
    config.queueDepth = 8
    try recorder.setup(width: config.width, height: config.height, fps: fps, quality: quality)
    let started = SCStream(filter: filter, configuration: config, delegate: recorder)
    try started.addStreamOutput(recorder, type: .screen, sampleHandlerQueue: recorder.queue)
    try await started.startCapture()
    stream = started
  } catch {
    FileHandle.standardError.write("record: \\(error)\\n".data(using: .utf8)!)
    exit(1)
  }
}

var signals: [DispatchSourceSignal] = []
for number in [SIGINT, SIGTERM] {
  signal(number, SIG_IGN)
  let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
  source.setEventHandler(handler: stop)
  source.resume()
  signals.append(source)
}
DispatchQueue.global().async {
  while readLine() != nil {}
  stop()
}
dispatchMain()
`;

/** A recording of the game window under way: `mark` notes a stop at the current time. */
/**
 * A recording of the game window under way: `mark` notes a stop at the current time; `failed` is
 * set when the helper exited before its first frame (no window, no permission, a stream error).
 */
type Recording = { readonly mark: (stop: string) => Promise<void>; readonly stop: () => Promise<void>; readonly failed: () => boolean };

/**
 * The recorder's HEVC quality (AVVideoQualityKey) when a request doesn't give one. At 0.5 the
 * hardware encoder made about 80 kbps of a 1280x720 tour, and smeared particles away.
 */
export const DEFAULT_VIDEO_QUALITY = 0.9;

/** The recording's file names in a tour's output folder. */
export const VIDEO_FILE = "video.mp4";
export const VIDEO_STOPS_FILE = "video-stops.txt";

/**
 * Starts recording `window` into `<outputDir>/video.mp4`. Each `mark` appends `<label> <seconds>` to
 * video-stops.txt (a stop's number, or m<n> for the bank's "mark" key), the seconds into the video
 * by the recorder's own first-frame clock; marks made before the first frame are timed from when it
 * came. A failure to write the timeline is logged, not thrown, so it never stops a tour.
 */
async function startRecording(context: HostContext, window: string, outputDir: string, video: NonNullable<CaptureTourRequest["video"]>, log: (line: string) => void): Promise<Recording> {
  const bin = await swiftTool(context, "record", RECORD_SWIFT);
  log(`recording window ${window}`);
  const stopsFile = path.join(outputDir, VIDEO_STOPS_FILE);
  await rm(stopsFile, { force: true });
  const child = spawn(bin, [window, path.join(outputDir, VIDEO_FILE), String(video.width), String(video.fps), String(video.quality ?? DEFAULT_VIDEO_QUALITY)], { stdio: ["pipe", "pipe", "pipe"] });
  let startedAt: number | undefined;
  let gone = false;
  const early: { stop: string; at: number }[] = [];
  const write = (stop: string, at: number) =>
    appendFile(stopsFile, `${stop} ${Math.max(0, at - startedAt!).toFixed(3)}\n`).catch((error: unknown) => log(`couldn't write ${VIDEO_STOPS_FILE}: ${(error as Error).message}`));
  let pending = Promise.resolve();
  // Read as whole lines: a chunk can end inside "started <seconds>".
  let partial = "";
  child.stdout.setEncoding("utf8").on("data", (text: string) => {
    const lines = (partial + text).split("\n");
    partial = lines.pop()!;
    for (const line of lines) {
      const match = /^started ([0-9.]+)$/.exec(line.trim());
      if (!match || startedAt !== undefined) continue;
      startedAt = Number(match[1]);
      pending = pending.then(async () => {
        for (const { stop, at } of early.splice(0)) await write(stop, at);
      });
    }
  });
  child.stderr.setEncoding("utf8").on("data", (text: string) => log(text.trim()));
  // A helper that can't start, or a pipe it has already closed, is logged, never thrown.
  child.on("error", (error) => log(`record helper: ${error.message}`));
  child.stdin.on("error", () => undefined);
  const exited = new Promise<void>((resolve) => {
    child.on("exit", (code) => {
      gone = true;
      if (startedAt === undefined) log(`record helper exited (${code ?? "killed"}) before its first frame`);
      resolve();
    });
    child.on("error", () => {
      gone = true;
      resolve();
    });
  });
  return {
    mark: async (stop) => {
      const at = Date.now() / 1000;
      if (startedAt === undefined) early.push({ stop, at });
      else pending = pending.then(() => write(stop, at));
      await pending;
    },
    stop: async () => {
      child.stdin.end();
      // Finishing the file is quick; one that hangs is killed, losing only its unwritten tail.
      const done = await Promise.race([exited.then(() => true), sleep(15).then(() => false)]);
      if (!done) child.kill("SIGKILL");
      await pending;
    },
    failed: () => gone && startedAt === undefined,
  };
}

/** A Swift helper, compiled once into the cache folder. */
async function swiftTool(context: HostContext, name: string, source: string): Promise<string> {
  const folder = path.join(context.requirePath("cacheDir"), "host-macos", "bin");
  const bin = path.join(folder, name);
  const sourceFile = `${bin}.swift`;
  const current = existsSync(bin) && existsSync(sourceFile) && (await readFile(sourceFile, "utf8")) === source;
  if (!current) {
    await mkdir(folder, { recursive: true });
    // The source is kept beside the binary only once it compiled, so a failed rebuild is tried again.
    const draft = `${bin}.draft.swift`;
    await writeFile(draft, source);
    await run("swiftc", ["-O", "-o", bin, draft]);
    await rename(draft, sourceFile);
  }
  return bin;
}

const osascript = async (script: string, args: readonly string[] = [], language: "AppleScript" | "JavaScript" = "AppleScript"): Promise<string> =>
  (await run("osascript", ["-l", language, "-e", script, ...args])).stdout;
const quietly = async (script: string, args: readonly string[] = []): Promise<string> => osascript(script, args).catch(() => "");

const windowList = (owner: string): Promise<string> => osascript(WINDOW_LIST, [owner], "JavaScript").catch(() => "");

/** The folder the game saves its banks in (`game.banksDir`). */
export async function banksDir(): Promise<string> {
  return BANKS;
}

/** Whether any game runs: what attaching to the author's game and the broker's hold ask. */
export async function gameRunning(): Promise<boolean> {
  return (await macSystem.list()).length > 0;
}

/** Every running game, with its start time. */
export const listGames = (): Promise<GameProcess[]> => macSystem.list();

/** Quits this game and no other, gracefully, killing it only after a timeout (games.ts). */
export const quitGame = (request: { readonly game: GameProcess; readonly log?: (line: string) => void }): Promise<"closed" | "killed" | "gone"> =>
  quitOwnedGame(request.game, macSystem, request.log ?? (() => undefined));

/** The game's main window id, for `screencapture -l`. */
async function gameWindow(): Promise<string | undefined> {
  for (const line of (await windowList("SC2")).split("\n")) {
    const fields = line.split("\t");
    if (fields[4] === "StarCraft II") return fields[2];
  }
  return undefined;
}

/** Whether the Editor shows the map; asks Accessibility and the window server, whose titles lag behind. */
async function mapOpen(mapPath: string): Promise<boolean> {
  const titles = (await quietly(AX_WINDOWS)) + (await windowList(EDITOR));
  return titles.includes(captureFragment(mapPath));
}

async function closeMap(context: HostContext, mapPath: string, log: (line: string) => void): Promise<void> {
  const dialog = await swiftTool(context, "dialog", DIALOG_SWIFT);
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!(await mapOpen(mapPath))) return;
    const fragment = captureFragment(mapPath);
    if ((await quietly(CLOSE_PREPARE, [fragment])).trim() === "open") {
      await quietly(MENU_CLICK, [fragment, "File", "Close", "90"]);
      await sleep(1.5);
      await quietly(ANSWER_SAVE, [fragment]);
    }
    await sleep(2);
    // The prompt read by OCR, where a long path can wrap: the capture folder is enough there, since
    // only capture copies are ever in it.
    await run(dialog, [EDITOR, `${CAPTURE_MAPS_FOLDER}/`, "Don't Save"]).catch(() => undefined);
    await sleep(2);
  }
  if (await mapOpen(mapPath)) log(`WARNING: ${path.basename(mapPath)} is still open in the Editor`);
}

/** An AppleScript string literal: only backslashes and double quotes need escaping. */
const appleString = (text: string): string => `"${text.replace(/[\\"]/g, (c) => `\\${c}`)}"`;

async function notify(title: string, message: string): Promise<void> {
  await quietly(`display notification ${appleString(message)} with title ${appleString(title)} sound name "Glass"`);
}

/**
 * Closes, without saving, every capture copy the Editor has open (any document whose window title
 * shows a copy in <cacheDir>/capture/maps/), after quitting the games it is given: the capture's own,
 * which the broker recorded. Another game is left running. The Editor Broker runs this as it starts and after a failed tour.
 */
export async function closeCaptureCopies(request: { readonly log?: (line: string) => void; readonly games?: readonly GameProcess[] }, context: HostContext): Promise<void> {
  const log = request.log ?? (() => undefined);
  // Only the games the broker recorded as a capture's; one it didn't is the author's to quit.
  for (const game of request.games ?? []) await quitGame({ game, log });
  const maps = path.join(context.requirePath("cacheDir"), CAPTURE_MAPS_FOLDER);
  const titles = (await quietly(AX_WINDOWS)) + "\n" + (await windowList(EDITOR));
  // Only this machine's capture folder: a copy under another cache's folder isn't this broker's to
  // close. Titles shorten the path, so a title showing the full path counts, and otherwise only a
  // name the broker made (ending in its job id) whose copy is on disk here, never an author's own
  // map that shares a name with an old copy.
  const names = new Set(
    titledMapNames(titles).filter(
      (name) => titles.includes(path.join(maps, name)) || (BROKER_COPY_NAME.test(name) && existsSync(path.join(maps, name))),
    ),
  );
  if (names.size === 0) return;
  if (!request.games?.length && (await gameRunning())) log("a game is running that this tool didn't start: left running");
  for (const name of names) {
    log(`closing ${name}`);
    await closeMap(context, path.join(maps, name), log);
  }
}

export async function captureTour(request: CaptureTourRequest, context: HostContext): Promise<CaptureTourResult> {
  const log = request.log ?? (() => undefined);
  // Checked at every wait and stop: a cancelled tour stops there and cleans up in the finally below.
  const signal = request.signal;
  const stopIfCancelled = () => {
    if (signal?.aborted) throw new Error("the capture was cancelled");
  };
  const waitFor = (seconds: number, every: number, check: () => Promise<boolean>) => waitUntil(seconds, every, check, signal);
  const maps = path.join(context.requirePath("cacheDir"), CAPTURE_MAPS_FOLDER);
  const mapPath = path.resolve(request.mapPath);
  if (!request.attach && path.dirname(mapPath) !== maps) {
    throw new Error(`editor.captureTour closes its map without saving, so it only takes maps in ${maps}; ${mapPath} isn't there`);
  }
  // Without Screen Recording, macOS hides other apps' window titles, so the game window is never
  // found and every stop is skipped; refuse before opening anything.
  const access = (await run(await swiftTool(context, "screen-access", SCREEN_ACCESS_SWIFT), []).catch(() => ({ stdout: "" }))).stdout.trim();
  if (access === "denied") {
    throw new Error(
      "Screen Recording isn't allowed for the app running this capture, so it can't find or capture the game window. " +
        "Turn it on in System Settings > Privacy & Security > Screen & System Audio Recording for that app (the terminal, or T3 Code), then quit and reopen it. " +
        "An Editor Broker it started inherits the permission, so stop a running broker too.",
    );
  }
  const crop = await swiftTool(context, "crop", CROP_SWIFT);
  // Compiled now, not in the watch loop, where a first build takes several seconds.
  if (request.video) await swiftTool(context, "record", RECORD_SWIFT);
  const bankFile = path.join(BANKS, `${request.bank}.SC2Bank`);
  await mkdir(request.outputDir, { recursive: true });
  // Keep the display awake for the whole run: a sleeping or locked screen stops every capture.
  await run("caffeinate", ["-u", "-t", "2"]).catch(() => undefined);
  const awake = spawn("caffeinate", ["-d", "-w", String(process.pid)], { stdio: "ignore" });
  let restoredTerrain = false;
  // Set once this run may have opened the map or started the game; whatever ends the run then
  // quits the game and closes the map.
  let touchedEditor = false;
  // The game this capture starts, once it appears: the only one it asks about or quits. Attaching, the author's game is watched and left alone.
  const own = ownedGame(macSystem, request.onGameStarted);
  const gameUp = request.attach ? gameRunning : () => own.running();
  const shrinking: Promise<unknown>[] = [];
  // Attached to a game already running, the bank may still hold an earlier run's last stop (-1);
  // that content is ignored until the game saves the bank again.
  let leftover: string | undefined;
  let recording: Recording | undefined;
  // The last stop noted in the video: a stop whose screenshot failed is retried, but noted once.
  let marked = 0;
  let lastMark: string | undefined;
  let lastResize = 0;
  try {
    stopIfCancelled();
    if (request.attach) {
      if (!(await gameUp())) throw new Error("no game is running to watch");
      leftover = existsSync(bankFile) ? await readFile(bankFile, "utf8") : undefined;
    } else {
      await rm(bankFile, { force: true });
      // Nothing is quit here: a game already running isn't this capture's.
      await refuseForeignGame(macSystem);
      // A copy left open by an earlier run would be tested as it was: opening only brings it forward.
      if (await mapOpen(mapPath)) {
        log("closing a stale copy");
        await closeMap(context, mapPath, log);
        if (await mapOpen(mapPath)) throw new Error(`a stale copy of ${path.basename(mapPath)} is still open in the Editor`);
      }
      stopIfCancelled();
      await request.writeMap?.();
      touchedEditor = true;
      // By the folder, not its ComponentList.SC2Components: opened by its component list, the copy's
      // Test Document game runs without the tour's script (a black world, no stop ever announced).
      await run("open", ["-g", "-a", context.requirePath("editorPath"), mapPath]);
      const opened = await waitFor(300, 2, () => mapOpen(mapPath));
      stopIfCancelled();
      if (!opened) {
        throw new Error(`the Editor never opened ${path.basename(mapPath)}`);
      }
      await waitFor(600, 2, async () => !(await quietly(AX_WINDOWS)).includes("Activity - "));
      stopIfCancelled();
      await sleep(2);
      const clicked = await osascript(MENU_CLICK, [captureFragment(mapPath), "File", "Test Document", "15"]).catch(() => "");
      if (clicked.includes("clicked")) log("Test Document clicked");
      restoredTerrain = clicked.includes("restored");
      const started = await waitFor(30, 2, gameUp);
      stopIfCancelled();
      if (!started) {
        log("couldn't bring the Editor forward; trying again every 30 s, or waiting for File > Test Document (15 min)");
        await notify("Camera tour capture", `Capture is waiting for the Editor. Stop typing for a moment, or click File > Test Document in the window for ${path.basename(mapPath)}. Capture starts by itself.`);
        let compileErrors = false;
        // macOS refuses to bring the Editor forward only while someone is using another app, so a
        // later try gets through once they pause. The game takes a few seconds to appear after a
        // click, so tries are spaced well apart and never made while it's starting.
        let lastTry = Date.now();
        await waitFor(900, 2, async () => {
          compileErrors = (await windowList(EDITOR)).includes("Script Compile Errors");
          if (compileErrors || (await gameUp())) return true;
          if (Date.now() - lastTry >= RAISE_RETRY_MS) {
            lastTry = Date.now();
            const retried = await osascript(MENU_CLICK, [captureFragment(mapPath), "File", "Test Document", "2"]).catch(() => "");
            if (retried.includes("clicked")) {
              log("Test Document clicked");
              restoredTerrain ||= retried.includes("restored");
            }
          }
          return false;
        });
        stopIfCancelled();
        if (compileErrors && !(await gameUp())) {
          throw new Error(`the Editor shows script compile errors for ${path.basename(mapPath)}`);
        }
      }
      if (!(await gameUp())) {
        throw new Error("the game never started");
      }
    }
    log("game started; it can sit behind other windows now (don't minimize it)");

    let last = 0;
    let frames = 0;
    let watch: StopWatch = { since: Date.now(), lastPress: 0 };
    let warnedNoWindow = false;
    let end: CaptureTourResult["end"] = "never started";
    // Recording, the bank is read more often, so each stop's time in the video is closer.
    const poll = request.video ? 0.1 : 0.5;
    let polled = Date.now();
    let resizeTries = 0;
    let recordTries = 0;
    for (;;) {
      await sleep(poll);
      // A watch loop this slow misses stops: say so, as a lead.
      const took = (Date.now() - polled) / 1000;
      if (took > 1.5) log(`slow watch loop: ${took.toFixed(1)} s since the last poll`);
      polled = Date.now();
      stopIfCancelled();
      // Recording waits until the game window is smaller than the display (RECORD_WINDOW), which
      // the game allows only once it has loaded; tried once a second until then.
      // A recorder that exited before its first frame is started again, up to RECORD_TRIES times.
      if (recording?.failed()) {
        recording = undefined;
        if (recordTries >= RECORD_TRIES) log(`no video: the recorder failed ${recordTries} times`);
      }
      if (request.video && !recording && recordTries < RECORD_TRIES && Date.now() - lastResize >= 1000) {
        lastResize = Date.now();
        const window = await gameWindow();
        const size = window ? (await quietly(RESIZE_GAME, [String(RECORD_WINDOW.width), String(RECORD_WINDOW.height)])).trim() : "";
        if (window && size === `${RECORD_WINDOW.width}, ${RECORD_WINDOW.height}`) {
          recordTries++;
          recording = await startRecording(context, window, request.outputDir, request.video, log);
          log(`game window resized to ${size}; recording it to ${path.join(request.outputDir, VIDEO_FILE)}`);
        } else if (window && ++resizeTries % 10 === 0) {
          log(`no recording yet: the game window is ${size || "not answering"}, and recording waits for ${RECORD_WINDOW.width}, ${RECORD_WINDOW.height}`);
        }
      }
      if (!(await gameUp())) {
        log(`game exited at stop ${last}`);
        end = "game exited";
        break;
      }
      const bank = existsSync(bankFile) ? await readFile(bankFile, "utf8") : "";
      if (leftover !== undefined && bank !== leftover) leftover = undefined;
      const stop = leftover === undefined ? bankValue(bank, "stop", "int") : undefined;
      // A tour that records may save an int key "mark" as well, just before something worth timing
      // (the effect tour: each attach), noted in the video's timeline as m<mark>.
      const mark = recording && leftover === undefined ? bankValue(bank, "mark", "int") : undefined;
      if (recording && mark !== undefined && mark !== lastMark) {
        lastMark = mark;
        await recording.mark(`m${mark}`);
      }
      const watched = watchStop(watch, stop, Date.now(), request);
      watch = watched.watch;
      if (watched.pressSpace) {
        log("no stop yet; pressing Space in the game (takes focus)");
        await quietly(PRESS_SPACE);
      }
      if (watched.neverStarted) {
        log("the tour never started");
        break;
      }
      if (stop === undefined) continue;
      if (stop === "-1") {
        end = "done";
        log(`tour done (${frames} stops)`);
        break;
      }
      if (Number(stop) === last) continue;
      if (recording && Number(stop) !== marked) {
        marked = Number(stop);
        await recording.mark(stop);
      }
      const window = await gameWindow();
      if (!window) {
        if (!warnedNoWindow) log(`stop ${stop}: no game window to capture`);
        warnedNoWindow = true;
        continue;
      }
      const frame = path.join(request.outputDir, `${stop.padStart(request.frameDigits, "0")}.jpg`);
      // Captured losslessly, then cropped, scaled and encoded as JPEG once.
      const raw = `${frame}.capture.png`;
      try {
        await run("screencapture", ["-x", "-o", "-t", "png", "-l", window, raw]);
      } catch {
        continue;
      }
      last = Number(stop);
      frames++;
      log(`stop ${stop}`);
      if (request.recordKeys) {
        await appendFile(path.join(request.outputDir, "stops.txt"), `${[stop, ...request.recordKeys.map((key) => bankValue(bank, key, "fixed") ?? "")].join(" ")}\n`);
      }
      // The window's title bar cut off the top, down to the asked width, in one encode.
      shrinking.push(
        run(crop, [raw, frame, String(request.quality / 100), String(request.width)])
          .catch(() => undefined)
          .finally(() => rm(raw, { force: true })),
      );
    }
    return { frames, end };
  } finally {
    // Whatever went wrong recording, the rest still runs: the shrinks, quitting the game, closing the map.
    await recording?.stop().catch((error: unknown) => log(`couldn't finish the recording: ${(error as Error).message}`));
    await Promise.all(shrinking);
    if (touchedEditor) {
      // A game that appeared since the last look is this capture's too.
      await own.running().catch(() => false);
      const game = own.game();
      if (game) await quitOwnedGame(game, macSystem, log).catch((error: unknown) => log(`couldn't quit the game: ${(error as Error).message}`));
      await closeMap(context, mapPath, log).catch((error: unknown) => log(`couldn't close ${path.basename(mapPath)}: ${(error as Error).message}`));
      if (restoredTerrain) await quietly(MINIMIZE_TERRAIN);
    }
    awake.kill();
  }
}

/** The watch loop's clock for time without a stop: when it last saw one, and when it last pressed Space. */
export interface StopWatch {
  since: number;
  lastPress: number;
}

/**
 * One poll of the bank, as the watch loop's clock sees it: whether to press Space, and whether the
 * tour never started. Time without a stop counts from the last stop the bank held, not from the
 * start of the tour, so a long tour whose bank is read mid-save keeps going. It is timed by the
 * clock (`now`, in ms), not by counting polls: a recording's loop polls faster, and each pass costs
 * more than its sleep.
 */
export function watchStop(
  watch: StopWatch,
  stop: string | undefined,
  now: number,
  limits: Pick<CaptureTourRequest, "pressSpaceAfterSeconds" | "startSeconds">,
): { watch: StopWatch; pressSpace: boolean; neverStarted: boolean } {
  if (stop !== undefined) return { watch: { ...watch, since: now }, pressSpace: false, neverStarted: false };
  const waited = (now - watch.since) / 1000;
  const pressSpace = waited >= limits.pressSpaceAfterSeconds && now - watch.lastPress >= 10_000;
  return {
    watch: pressSpace ? { ...watch, lastPress: now } : watch,
    pressSpace,
    neverStarted: waited > limits.startSeconds,
  };
}

/** Polls `check` every `every` seconds for up to `seconds`; whether it came true. Gives up, false, once `signal` is aborted. */
async function waitUntil(seconds: number, every: number, check: () => Promise<boolean>, signal?: AbortSignal): Promise<boolean> {
  for (let waited = 0; waited < seconds; waited += every) {
    if (signal?.aborted) return false;
    if (await check()) return true;
    await sleep(every);
  }
  return !signal?.aborted && check();
}

/** Captures the game window, else the Editor's frontmost window, as JPEG or PNG by the path's extension. */
export async function captureScreen({ outputPath }: { readonly outputPath: string }): Promise<void> {
  const editor = (await windowList(EDITOR))
    .split("\n")
    .map((line) => line.split("\t"))
    .find((fields) => fields[1] === "L0" && fields[4]);
  const window = (await gameWindow()) ?? editor?.[2];
  if (!window) throw new Error("neither the game nor the Editor has a window to capture");
  const format = path.extname(outputPath).toLowerCase() === ".png" ? "png" : "jpg";
  await run("screencapture", ["-x", "-o", "-t", format, "-l", window, outputPath]);
}
