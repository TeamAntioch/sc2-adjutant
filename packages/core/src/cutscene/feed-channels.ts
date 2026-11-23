// Which render-to-texture channel a shot's feed draws into (#1055). A feed shows on every model that
// shows its channel, and on nothing else, so a feed into channel 0 leaves the Nova bridge's main
// screen (channel 6) blank. With no `channel` given, a feed takes the lowest channel the screens on
// the shot's own Set show, by core's data/display-channels.json; with none known there, 0. And
// `check` and the compile warn of a feed that no screen known on that Set shows.

import { bundledDisplayChannels, displayChannels, type DisplayChannels } from "../catalog/display-channels.js";
import { feedOf } from "../domain/cinematic.js";
// Types only: cinematic.ts calls feedChannel, so this module takes no values from it.
import type { CinematicProblem, LoadedCinematic } from "./cinematic.js";

/** A set camera's reference, `"<set>/<camera name>"`, split; undefined for anything else (a cast id). As cinematic.ts reads one. */
function setCameraOf(reference: string): { readonly set: string; readonly name: string } | undefined {
  const at = reference.indexOf("/");
  return at > 0 ? { set: reference.slice(0, at), name: reference.slice(at + 1) } : undefined;
}

/**
 * The Sets a shot shows, and the set camera it films through (undefined for a camera of its own):
 * its camera's Set or its `set`, or with neither every Set but the one it feeds from.
 */
function shotSets(loaded: LoadedCinematic, at: number): { readonly sets: readonly string[]; readonly camera: string | undefined } {
  const shot = loaded.cinematic.shots[at]!;
  const through = typeof shot.camera === "string" ? setCameraOf(shot.camera) : undefined;
  const own = through?.set ?? shot.set;
  if (own !== undefined) return { sets: [own], camera: through?.name };
  const target = feedOf(shot.feed)?.camera;
  const fed = target === undefined ? undefined : (setCameraOf(target)?.set ?? loaded.cinematic.cast.find((member) => member.id === target)?.set);
  return { sets: loaded.cinematic.sets.map((set) => set.id).filter((id) => id !== fed), camera: undefined };
}

/**
 * The models a shot shows on its Sets, pieces and cast members, each once, sorted into the screens
 * known, the other models known and the unknown. A piece tied to cameras counts only through them
 * (or a camera of the shot's own, which shows tied pieces); one placed by its file is no CModel the
 * display channels could name, so it's left out.
 */
function shotScreens(loaded: LoadedCinematic, at: number, displays: DisplayChannels) {
  const { sets, camera } = shotSets(loaded, at);
  const seen = (piece: { readonly shots?: readonly string[] | undefined }) => !piece.shots || camera === undefined || piece.shots.includes(camera);
  const models = new Set([
    ...sets.flatMap((id) => (loaded.sets.get(id)?.pieces ?? []).filter((piece) => !piece.hidden && !piece.modelPath && seen(piece)).map((piece) => piece.model)),
    ...loaded.cinematic.cast.filter((member) => member.set !== undefined && sets.includes(member.set)).map((member) => member.model),
  ]);
  const screens: { model: string; channels: readonly number[] }[] = [];
  const unknown: string[] = [];
  let known = 0;
  for (const model of models) {
    const channels = displayChannels(displays, model);
    if (channels === undefined) unknown.push(model);
    else {
      known++;
      if (channels.length) screens.push({ model, channels });
    }
  }
  return { sets, screens, unknown: unknown.sort(), known };
}

/** The channel shot `at`'s feed draws into: its own `channel`, else the lowest its Set's screens show, else 0. */
export function feedChannel(loaded: LoadedCinematic, at: number, displays: DisplayChannels): number {
  const feed = feedOf(loaded.cinematic.shots[at]?.feed);
  if (feed?.channel !== undefined) return feed.channel;
  const shown = shotScreens(loaded, at, displays).screens.flatMap((screen) => screen.channels);
  return shown.length ? Math.min(...shown) : 0;
}

/** A warning for each feed that no screen known on its shot's Set shows; none where nothing there is known. */
export function feedChannelProblems(loaded: LoadedCinematic, displays: DisplayChannels): CinematicProblem[] {
  return loaded.cinematic.shots.flatMap((shot, at): CinematicProblem[] => {
    const feed = feedOf(shot.feed);
    if (!feed) return [];
    const { sets, screens, unknown, known } = shotScreens(loaded, at, displays);
    const channel = feedChannel(loaded, at, displays);
    const where = `the Set${sets.length > 1 ? "s" : ""} ${sets.join(", ")}`;
    const shownBy = (list: typeof screens) => list.map((screen) => `channel${screen.channels.length > 1 ? "s" : ""} ${screen.channels.join(", ")} (${screen.model})`).join("; ");
    if (screens.some((screen) => screen.channels.includes(channel))) {
      // Screens on other channels show nothing of a feed that took the lowest: the author picks.
      const others = screens.filter((screen) => !screen.channels.includes(channel));
      if (feed.channel !== undefined || others.length === 0) return [];
      const message = `The screens on ${where} show different channels (${shownBy(screens)}), and this feed takes ${channel}, the lowest, so ${others.map((screen) => screen.model).join(", ")} show${others.length > 1 ? "" : "s"} nothing of it: give the feed a \`channel\` to pick the screen`;
      return [{ file: loaded.file, path: `shots.${at}.feed`, message, severity: "warning" }];
    }
    if (known === 0) return [];
    const path = feed.channel !== undefined ? `shots.${at}.feed.channel` : `shots.${at}.feed`;
    const message = unknown.length
      ? `No screen known on ${where} shows channel ${channel}, so this feed may show nowhere, unless one of these shows it: ${unknown.join(", ")} (an sc2-adjutant checkout's npm run display-channels -- <model id> records a game model in core's data/display-channels.json)`
      : `No screen on ${where} shows channel ${channel}, so this feed shows nowhere: ${screens.length ? `its screens show ${shownBy(screens)}` : "nothing on it shows a channel"}`;
    return [{ file: loaded.file, path, message, severity: "warning" }];
  });
}

/** The feed warnings for a Mission's Cinematics `loaded`, against core's display channels: compile_map, compile_cutscene and check give them. */
export async function missionFeedChannelProblems(loaded: readonly LoadedCinematic[]): Promise<CinematicProblem[]> {
  if (!loaded.some((entry) => entry.cinematic.shots.some((shot) => shot.feed !== undefined))) return [];
  const displays = await bundledDisplayChannels();
  return loaded.flatMap((entry) => feedChannelProblems(entry, displays));
}
