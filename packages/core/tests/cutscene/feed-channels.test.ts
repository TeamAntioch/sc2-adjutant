// A feed's channel (#1055): with none given, the lowest channel the screens on the shot's own Set
// show (data/display-channels.json); and a warning when no screen known there shows the channel.
import { describe, expect, it } from "vitest";

import type { LoadedCinematic } from "../../src/cutscene/cinematic.js";
import { feedChannel, feedChannelProblems } from "../../src/cutscene/feed-channels.js";

const displays = {
  SMX3_Nova_Ship_Bridge_MainScreen: { file: "a.m3", channels: [6] },
  SMHyperionBridgeBriefingCenter: { file: "b.m3", channels: [0, 1, 2] },
  SMX3_Nova_Ship_Bridge_Floor: { file: "c.m3", channels: [] },
  TombstoneDLH: { file: "d.m3", channels: [] },
};

/** Two Marines on the Nova bridge (`bridge`, with `pieces`), watching a stage play (`stage`) through `shots`. */
const watching = ({ pieces = ["SMX3_Nova_Ship_Bridge_Floor", "SMX3_Nova_Ship_Bridge_MainScreen"], cast = [] as { id: string; model: string; set: string }[], shots = [] as object[] } = {}): LoadedCinematic =>
  ({
    id: "test",
    index: -1,
    scene: undefined,
    file: "cinematics/test.json",
    cinematic: {
      sets: [
        { id: "bridge", file: "sets/bridge.json", offset: [0, 0, 0] },
        { id: "stage", file: "sets/stage.json", offset: [1000, 0, 0] },
      ],
      cast,
      shots,
    },
    sets: new Map([
      ["bridge", { name: "Bridge", lights: [], pieces: pieces.map((model) => ({ model, at: [0, 0, 0] })), marks: [], cameras: [], lamps: [] }],
      ["stage", { name: "Stage", lights: [], pieces: [{ model: "TombstoneDLH", at: [0, 0, 0] }], marks: [], cameras: [], lamps: [] }],
    ]),
  }) as unknown as LoadedCinematic;

describe("feedChannel", () => {
  it("is the channel the shot's own Set's screen shows when the feed names none: 6 on the Nova bridge", () => {
    const loaded = watching({ shots: [{ camera: "bridge/Wide", feed: "stage/Wide" }] });
    expect(feedChannel(loaded, 0, displays)).toBe(6);
  });

  it("is the lowest channel a screen shows, as the Hyperion briefing holo's front shows 0", () => {
    const loaded = watching({ pieces: ["SMHyperionBridgeBriefingCenter"], shots: [{ set: "bridge", camera: { target: [0, 0, 0], distance: 5, pitch: 5, yaw: 0, fov: 30 }, feed: "stage/Wide" }] });
    expect(feedChannel(loaded, 0, displays)).toBe(0);
  });

  it("finds a screen cast as a member on the Set, as one hidden in some shots must be", () => {
    const loaded = watching({ pieces: [], cast: [{ id: "screen", model: "SMX3_Nova_Ship_Bridge_MainScreen", set: "bridge" }], shots: [{ camera: "bridge/Wide", feed: "stage/Wide" }] });
    expect(feedChannel(loaded, 0, displays)).toBe(6);
  });

  it("keeps the channel the feed names, and 0 on a Set with no known screen", () => {
    expect(feedChannel(watching({ shots: [{ camera: "bridge/Wide", feed: { camera: "stage/Wide", channel: 1 } }] }), 0, displays)).toBe(1);
    expect(feedChannel(watching({ pieces: ["Unknown_Screen"], shots: [{ camera: "bridge/Wide", feed: "stage/Wide" }] }), 0, displays)).toBe(0);
  });

  it("reads every Set for a shot through a camera of its own with no Set, but not the Set it feeds from", () => {
    const loaded = watching({ shots: [{ camera: { target: [0, 0, 0], distance: 5, pitch: 5, yaw: 0, fov: 30 }, feed: "stage/Wide" }] });
    expect(feedChannel(loaded, 0, displays)).toBe(6);
  });
});

describe("the screens a shot shows", () => {
  /** The bridge with the holo tied to its camera Briefing and the main screen to Wide, and a Custom_Screen placed by its file. */
  const tied = (shots: object[]): LoadedCinematic => {
    const loaded = watching({ shots });
    (loaded.sets.get("bridge") as any).pieces = [
      { model: "SMHyperionBridgeBriefingCenter", at: [0, 0, 0], shots: ["Briefing"] },
      { model: "SMX3_Nova_Ship_Bridge_MainScreen", at: [0, 0, 0], shots: ["Wide"] },
      { model: "Custom_Screen", modelPath: "Assets/Custom_Screen.m3", at: [0, 0, 0] },
    ];
    return loaded;
  };

  it("counts a piece tied to cameras only through them, or through a camera of the shot's own", () => {
    expect(feedChannel(tied([{ camera: "bridge/Wide", feed: "stage/Wide" }]), 0, displays)).toBe(6);
    expect(feedChannel(tied([{ camera: "bridge/Briefing", feed: "stage/Wide" }]), 0, displays)).toBe(0);
    expect(feedChannel(tied([{ set: "bridge", camera: { target: [0, 0, 0], distance: 5, pitch: 5, yaw: 0, fov: 30 }, feed: "stage/Wide" }]), 0, displays)).toBe(0);
  });

  it("leaves out a piece placed by its file, which no CModel names, from the models it doesn't know", () => {
    expect(feedChannelProblems(tied([{ camera: "bridge/Wide", feed: { camera: "stage/Wide", channel: 3 } }]), displays)[0]!.message).toBe(
      "No screen on the Set bridge shows channel 3, so this feed shows nowhere: its screens show channel 6 (SMX3_Nova_Ship_Bridge_MainScreen)",
    );
  });
});

describe("feedChannelProblems", () => {
  it("warns of a feed no screen on the shot's Set shows, naming the channels its screens do show", () => {
    const loaded = watching({ shots: [{ camera: "bridge/Wide" }, { camera: "bridge/Wide", feed: { camera: "stage/Wide", channel: 0 } }] });
    expect(feedChannelProblems(loaded, displays)).toEqual([
      {
        file: "cinematics/test.json",
        path: "shots.1.feed.channel",
        message: "No screen on the Set bridge shows channel 0, so this feed shows nowhere: its screens show channel 6 (SMX3_Nova_Ship_Bridge_MainScreen)",
        severity: "warning",
      },
    ]);
  });

  it("names the Set's models it doesn't know, which might be screens", () => {
    const loaded = watching({ pieces: ["SMX3_Nova_Ship_Bridge_Floor", "Custom_Screen", "Custom_Screen"], shots: [{ camera: "bridge/Wide", feed: "stage/Wide" }] });
    expect(feedChannelProblems(loaded, displays)).toEqual([
      {
        file: "cinematics/test.json",
        path: "shots.0.feed",
        message: "No screen known on the Set bridge shows channel 0, so this feed may show nowhere, unless one of these shows it: Custom_Screen (an sc2-adjutant checkout's npm run display-channels -- <model id> records a game model in core's data/display-channels.json)",
        severity: "warning",
      },
    ]);
  });

  it("warns when the Set's screens show different channels and the feed names none, as it takes the lowest", () => {
    const loaded = watching({ pieces: ["SMHyperionBridgeBriefingCenter", "SMX3_Nova_Ship_Bridge_MainScreen"], shots: [{ camera: "bridge/Wide", feed: "stage/Wide" }, { camera: "bridge/Wide", feed: { camera: "stage/Wide", channel: 6 } }] });
    expect(feedChannelProblems(loaded, displays)).toEqual([
      {
        file: "cinematics/test.json",
        path: "shots.0.feed",
        message:
          "The screens on the Set bridge show different channels (channels 0, 1, 2 (SMHyperionBridgeBriefingCenter); channel 6 (SMX3_Nova_Ship_Bridge_MainScreen)), and this feed takes 0, the lowest, so SMX3_Nova_Ship_Bridge_MainScreen shows nothing of it: give the feed a `channel` to pick the screen",
        severity: "warning",
      },
    ]);
  });

  it("is quiet when a screen shows the feed's channel, or when nothing on the Set is known", () => {
    expect(feedChannelProblems(watching({ shots: [{ camera: "bridge/Wide", feed: "stage/Wide" }] }), displays)).toEqual([]);
    expect(feedChannelProblems(watching({ pieces: ["Custom_Screen"], shots: [{ camera: "bridge/Wide", feed: "stage/Wide" }] }), displays)).toEqual([]);
  });
});
