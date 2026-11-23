// How a Cinematic's cutscene compares with the hand-built one it replaces, by what plays
// (compare-cutscenes.ts): here, where its actors stand and its lamps are.
import { describe, expect, it } from "vitest";

import { cutsceneDifferences } from "../../src/cutscene/compare-cutscenes.js";

/** A cutscene holding only a dockhand at `dockhand` and a lamp at `lamp`. */
const scene = (dockhand: string, lamp: string): string =>
  `<CutsceneState><CCutsceneNodeActor guid="1" modelLink="SMX3_BGPeople_06" position="${dockhand}" rotation="0,0,-90"/><CCutsceneNodeLight guid="2" name="Desk Lamp" position="${lamp}"/></CutsceneState>`;

describe("cutsceneDifferences on where things are", () => {
  it("takes an actor and a lamp a rounding away, as a set's frame writes them back, for where they were", () => {
    expect(cutsceneDifferences(scene("12.345,1,0", "3.125,4,5"), scene("12.344999,1,0", "3.124999,4,5"))).toEqual([]);
  });

  it("sees an actor or a lamp moved by as little as a z-fight nudge, a hundredth of a cell", () => {
    expect(cutsceneDifferences(scene("12.345,1,0", "3.125,4,5"), scene("12.355,1,0", "3.125,4,5.01")).map((difference) => difference.aspect)).toEqual(["actors", "lamps"]);
  });

  it("sees an actor turned a degree", () => {
    const turned = scene("12.345,1,0", "3.125,4,5").replace("0,0,-90", "0,0,-89");
    expect(cutsceneDifferences(scene("12.345,1,0", "3.125,4,5"), turned).map((difference) => difference.aspect)).toEqual(["actors"]);
  });
});

describe("cutsceneDifferences on shot copies", () => {
  /** A dockhand copied into each shot (a copy a shot, where it stands then), and a lamp copied likewise. */
  const copies = (...at: string[]): string =>
    `<CutsceneState>${at
      .map(
        (place, index) =>
          `<CCutsceneNodeActor guid="${index + 1}" name="s0${index + 1}0 dockhand" modelLink="SMX3_BGPeople_06" position="${place}" rotation="0,0,-90"><CCutsceneElementObject guid="${index + 11}" start="${index * 4000}" duration="4000"/></CCutsceneNodeActor><CCutsceneNodeLight guid="${index + 21}" name="s0${index + 1}0 Key" position="1,0,3"/>`,
      )
      .join("")}</CutsceneState>`;
  const one = `<CutsceneState><CCutsceneNodeActor guid="1" name="dockhand" modelLink="SMX3_BGPeople_06" position="-2,1,0" rotation="0,0,-90"><CCutsceneElementObject guid="3" duration="8000"/></CCutsceneNodeActor><CCutsceneNodeLight guid="2" name="Key" position="1,0,3"/></CutsceneState>`;

  it("takes an actor's copies, one a shot, for one actor where its first copy starts, and a lamp's for one lamp", () => {
    expect(cutsceneDifferences(one, copies("-2,1,0", "4,1,0"))).toEqual([]);
  });

  it("sees a first copy that starts somewhere else", () => {
    expect(cutsceneDifferences(one, copies("-3,1,0", "-2,1,0")).map((difference) => difference.aspect)).toEqual(["actors"]);
  });
});

describe("cutsceneDifferences on sounds", () => {
  /** A cutscene playing a bridge's ambience, looped at `volume` (none: the Editor's 1), and a music cue once. */
  const sounds = (ambience: string, cue = `<CCutsceneNodeSound guid="3" name="Cue" soundLink="Briefing" assetDuration="10531" speakerMixLFE="0.000000"><CCutsceneElementObject guid="4" duration="46326"/></CCutsceneNodeSound>`): string =>
    `<CutsceneState><CCutsceneNodeFolder guid="9" name="Sound">${ambience}${cue}</CCutsceneNodeFolder></CutsceneState>`;
  const ambience = (attrs: string): string => `<CCutsceneNodeSound guid="1" name="Ambience" soundLink="BridgeLoop" ${attrs}><CCutsceneElementObject guid="2" duration="46326" lockedToEnd="1"/></CCutsceneNodeSound>`;

  it("takes the Editor's form of a sound for the writer's: its asset length, speaker mix and a volume of 1 play the same", () => {
    expect(cutsceneDifferences(sounds(ambience(`mode="4294967295" assetDuration="60007" speakerMixLFE="0.000000"`)), sounds(ambience(`volumeScale="1.000000" mode="4294967295"`)))).toEqual([]);
  });

  it("sees a sound that loops where it played once, or plays at another volume", () => {
    const kept = sounds(ambience(`mode="4294967295" volumeScale="0.500000"`));
    expect(cutsceneDifferences(kept, sounds(ambience(`volumeScale="0.500000"`)))).toEqual([{ aspect: "sounds", detail: "the Cinematic adds BridgeLoop at 0.5; drops BridgeLoop looped at 0.5" }]);
    expect(cutsceneDifferences(kept, sounds(ambience(`mode="4294967295" volumeScale="0.8"`)))).toEqual([{ aspect: "sounds", detail: "the Cinematic adds BridgeLoop looped at 0.8; drops BridgeLoop looped at 0.5" }]);
  });

  it("compares a volume that isn't a number as written, so it can't pass for silence", () => {
    expect(cutsceneDifferences(sounds(ambience(`mode="4294967295" volumeScale="0"`)), sounds(ambience(`mode="4294967295" volumeScale="loud"`)))).toEqual([
      { aspect: "sounds", detail: "the Cinematic adds BridgeLoop looped at loud; drops BridgeLoop looped at 0" },
    ]);
  });

  it("takes a sound's copies, one a run of shots, and its fade for the one sound, but two cues of one Sound for two", () => {
    const run = (guid: number, tag: string, start: number, fade: string) =>
      `<CCutsceneNodeSound guid="${guid}" name="${tag} BridgeLoop" soundLink="BridgeLoop" mode="4294967295"><CCutsceneElementObject guid="${guid + 1}" start="${start}" duration="4000"/>${fade}</CCutsceneNodeSound>`;
    const fade = `<CCutsceneNodePropertyValue guid="7" name="Property - Volume" propertyName="volumeScale"><CCutsceneElementPropertyCurve guid="8" value="1.000000" time="0.000000"/><CCutsceneElementPropertyCurve guid="9" start="4000" value="0.000000" time="4000.000000"/></CCutsceneNodePropertyValue>`;
    expect(cutsceneDifferences(sounds(ambience(`mode="4294967295"`)), sounds(run(1, "s010", 0, fade) + run(5, "s030", 8000, "")))).toEqual([]);
    const twice = sounds(ambience(`mode="4294967295"`), `<CCutsceneNodeSound guid="3" name="Cue" soundLink="Briefing"/><CCutsceneNodeSound guid="5" name="Cue" soundLink="Briefing"/>`);
    expect(cutsceneDifferences(twice, sounds(ambience(`mode="4294967295"`)))).toEqual([{ aspect: "sounds", detail: "drops Briefing" }]);
  });

  it("counts a look-at and an attachment as kinds of track, whatever they aim at", () => {
    const tracks = (target: string) =>
      `<CutsceneState><CCutsceneNodeActor guid="1" modelLink="Captain"><CCutsceneNodeLookAt guid="2"><CCutsceneElementLookAt guid="3" lookAtGUID="${target}"/></CCutsceneNodeLookAt></CCutsceneNodeActor><CCutsceneNodeActor guid="5" modelLink="Pilot"/><CCutsceneNodeLight guid="6" name="Fill"><CCutsceneNodeAttachment guid="7"><CCutsceneElementAttachment guid="8" attachGuid="${target}" attachName="Ref_Overhead"/></CCutsceneNodeAttachment></CCutsceneNodeLight></CutsceneState>`;
    expect(cutsceneDifferences(tracks("5"), tracks("1"))).toEqual([]);
    expect(cutsceneDifferences(tracks("5"), `<CutsceneState><CCutsceneNodeActor guid="1" modelLink="Captain"/><CCutsceneNodeActor guid="5" modelLink="Pilot"/><CCutsceneNodeLight guid="6" name="Fill"/></CutsceneState>`)).toEqual([
      { aspect: "nodes", detail: "drops Attachment, LookAt" },
    ]);
  });
});
