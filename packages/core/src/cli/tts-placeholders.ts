// Writes placeholder voice lines for a Mission's Screenplay: one per line, named by its sound id
// from the Campaign Pack's naming template, in the Mission's voice format (screenplay.script.
// voiceFormat): Ogg Vorbis by default, encoded with ffmpeg from a 16-bit mono WAV, or that WAV.
// The machine's Host Adapter speaks them when it has `tts.speak` (the macOS one uses `say`), in
// the voice the speaker's character gives; otherwise each line gets silence of its estimated
// length. A spoken line is trimmed to its speech before it's encoded, and one spoken before core
// trimmed them is trimmed in place. A manifest records what each placeholder was made from, so
// unchanged lines are skipped on later runs, and voice files the manifest doesn't know (real
// recordings, .ogg or .wav) are kept. An up-to-date .wav placeholder of an "ogg" Mission is
// encoded to .ogg in place, and a placeholder a recording in the other format now voices is
// deleted. Writes to the Screenplay's `audioDir` unless given one.
//
// A manifest written by an older `npm run tts` records no hash of each file, so a placeholder it
// wrote can't be told from a recording dropped over it, and a line whose text changed is kept and
// reported. `--adopt-unhashed` vouches that those files are all placeholders: their entries get
// the files' hashes, and the changed lines are written again.
//
//   npm run tts -- missions/<id>/blueprint.json [audio-dir] [--adopt-unhashed]

import { loadHost } from "../host/host.js";
import { loadMachineConfig } from "../host/machine-config.js";
import { writePlaceholderVoices } from "../host/placeholder-voices.js";
import { readMissionBlueprint } from "../plugins/workspace.js";
import { readMissionScript, scriptLines } from "../script/name-script.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const adoptUnhashed = args.includes("--adopt-unhashed");
  const [blueprintPath, audioDir, ...extra] = args.filter((arg) => arg !== "--adopt-unhashed");
  if (!blueprintPath || extra.length || [blueprintPath, audioDir].some((arg) => arg?.startsWith("--"))) {
    console.error("Usage: tts-placeholders <blueprint.json> [audio-dir] [--adopt-unhashed]");
    process.exitCode = 2;
    return;
  }
  const { blueprint, workspace } = await readMissionBlueprint(blueprintPath);
  const mission = await readMissionScript(blueprint, blueprintPath, workspace);
  if (!mission) throw new Error(`${blueprintPath} references no Screenplay (screenplay.script)`);
  const { script, voiceFormat } = mission;
  const outDir = audioDir ?? mission.audioDir;
  const host = await loadHost(await loadMachineConfig());
  if (!host.has("tts.speak")) {
    console.warn(`The machine's Host Adapter can't speak (no tts.speak; set hostAdapter in ${host.machine.file}), so new and changed lines get silence.`);
  }
  const { spoken, silent, outdated, unhashed, trimmed, converted, superseded } = await writePlaceholderVoices(host, script, outDir, "stale", { adoptUnhashed, format: voiceFormat });
  const unchanged = scriptLines(script).length - spoken.length - silent.length - outdated.length - unhashed.length - converted.length - superseded.length;
  console.log(`${spoken.length} line(s) spoken, ${silent.length} silent, ${unchanged} unchanged, in ${outDir} (.${voiceFormat})`);
  if (converted.length) console.log(`${converted.length} .wav placeholder(s) encoded to .ogg, the Mission's voice format: ${converted.join(", ")}`);
  if (superseded.length) console.log(`${superseded.length} placeholder(s) deleted, since a recording in the other format now voices the line: ${superseded.join(", ")}`);
  if (trimmed.length) console.log(`${trimmed.length} spoken placeholder(s) written before core trimmed them now end with their speech: ${trimmed.join(", ")}`);
  if (outdated.length) console.warn(`${outdated.length} spoken placeholder(s) may no longer match their text and were kept, since this host can't speak: ${outdated.join(", ")}`);
  if (unhashed.length) {
    console.warn(
      `${unhashed.length} voice file(s) no longer match their line but were kept, since an older npm run tts recorded no hash of them and each might be a real recording: ${unhashed.join(", ")}. ` +
        "If they are all placeholders, run again with --adopt-unhashed to replace them.",
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
