// The effect tour (capture/effect-tour.ts): each effect's frames planned from its animations and
// bounds, the batch's CModels, and its Galaxy.
import { describe, expect, it } from "vitest";

import { batchRange, effectModelData, effectTourScript, planEffect, planEffectBatch, type TourEffect } from "../../src/capture/effect-tour.js";

const seq = (name: string, seconds: number, looping = true) => ({ name, durationMs: seconds * 1000, moveSpeed: 0, looping });
const effect = (file: string, sequences: TourEffect["sequences"], size = 2): TourEffect => ({ file, sequences, min: [-size / 2, -size / 2, 0], max: [size / 2, size / 2, size] });

describe("planEffect", () => {
  it("films Birth, Stand, the move, a plain Destroy and Death for a looping effect that has them all", () => {
    const plan = planEffect(effect("Assets/Effects/Terran/A/A.m3", [seq("Birth", 1), seq("Stand", 2), seq("Death", 1, false)]), 10);
    expect(plan.stops).toEqual({ birth: 10, stand: 11, moving: 12, "after-destroy": 13, death: 14 });
    expect(plan.birth).toBe(0.5);
    expect(plan.standShot).toBe(1);
    expect(plan.death).toBe(0.5);
  });

  it("films a one-shot half way through, and doesn't move one too short to", () => {
    // As the Yamato charge-up: one Stand of 3.5 s that plays once.
    const charge = planEffect(effect("Assets/Effects/Terran/YamatoMissileCharge/YamatoMissileCharge.m3", [seq("Stand", 3.5, false)]), 1);
    expect(charge.standShot).toBe(1.75);
    expect(charge.move).toBe(1);
    expect(charge.stops).toEqual({ birth: 0, stand: 1, moving: 2, "after-destroy": 3, death: 0 });
    const flash = planEffect(effect("Assets/Effects/Terran/Flash/Flash.m3", [seq("Stand", 1, false)]), 1);
    expect(flash.move).toBe(0);
    expect(flash.stops).toEqual({ birth: 0, stand: 1, moving: 0, "after-destroy": 2, death: 0 });
  });

  it("plays the only animation of a model with neither Birth nor Stand at once, and takes no second death frame", () => {
    // As the Yamato impact: only Death, 2.5 s.
    const impact = planEffect(effect("Assets/Effects/Terran/YamatoMissileImpact/YamatoMissileImpact.m3", [seq("Death", 2.5, false)]), 1);
    expect(impact.play).toBe("Death");
    expect(impact.death).toBe(0);
    expect(impact.stops).toEqual({ birth: 0, stand: 1, moving: 0, "after-destroy": 2, death: 0 });
    expect(planEffect(effect("Assets/Effects/A/A.m3", [seq("Stand", 2), seq("Death", 1, false)]), 1).play).toBe("");
  });

  it("plays a loop not named Stand as Birth ends, and films it as the Stand, which the bracket wouldn't play", () => {
    const plan = planEffect(effect("Assets/Effects/A/A.m3", [seq("Birth", 1.2, false), seq("GLstand", 0.33), seq("GLstand 01", 0.33), seq("Death", 1, false)]), 1);
    expect(plan.loop).toBe("GLstand");
    expect(plan.play).toBe("");
    expect(plan.standShot).toBe(0.25);
    expect(plan.stops).toEqual({ birth: 1, stand: 2, moving: 3, "after-destroy": 4, death: 5 });
    // A model with a Stand keeps the bracket's; one with only one-shots has no loop to play.
    expect(planEffect(effect("Assets/Effects/B/B.m3", [seq("Birth", 1, false), seq("Stand", 2), seq("GLstand", 1)]), 1).loop).toBe("");
    expect(planEffect(effect("Assets/Effects/C/C.m3", [seq("Birth", 1, false), seq("Spell A", 1, false)]), 1).loop).toBe("");
  });

  it("plays at once a loop not named Stand of a model with no Birth, before its first animation", () => {
    const plan = planEffect(effect("Assets/Effects/A/A.m3", [seq("Death", 1, false), seq("GLstand", 0.33)]), 1);
    expect(plan.play).toBe("GLstand");
    expect(plan.loop).toBe("");
    expect(plan.death).toBe(0.5);
  });

  it("frames an effect by its bounds: a big one from farther away, a tiny one no closer than 6", () => {
    const big = planEffect(effect("Assets/Effects/Big/Big.m3", [seq("Stand", 2)], 20), 1);
    const small = planEffect(effect("Assets/Effects/Small/Small.m3", [seq("Stand", 2)], 0.2), 1);
    expect(big.distance).toBeGreaterThan(40);
    expect(small.distance).toBe(6);
    expect(big.distance).toBeLessThanOrEqual(70);
  });
});

describe("planEffectBatch", () => {
  it("numbers the frames of every effect on from 1, in order", () => {
    const batch = planEffectBatch([effect("Assets/Effects/A/A.m3", [seq("Birth", 1), seq("Stand", 2)]), effect("Assets/Effects/B/B.m3", [seq("Stand", 1, false)])]);
    expect(batch.shots.map((shot) => `${shot.stop} ${shot.effect} ${shot.label}`)).toEqual(["1 0 birth", "2 0 stand", "3 0 moving", "4 0 after-destroy", "5 1 stand", "6 1 after-destroy"]);
    expect(batch.ids).toEqual(["FxTour0001", "FxTour0002"]);
  });

  it("writes one CModel per effect with its file", () => {
    const batch = planEffectBatch([effect("Assets/Effects/Terran/A/A.m3", [])]);
    expect(effectModelData(batch)).toContain('<CModel id="FxTour0001" parent="FX">\n        <Model value="Assets\\Effects\\Terran\\A\\A.m3"/>');
  });
});

describe("effectTourScript", () => {
  const batch = planEffectBatch([effect("Assets/Effects/A/A.m3", [seq("Birth", 1), seq("Stand", 2), seq("Death", 1, false)])]);

  it("announces each frame in bank FxTour, attaches each effect to the host, and ends with stop -1", () => {
    const script = effectTourScript(batch);
    expect(script).toContain('BankLoad("FxTour", 1)');
    expect(script).toContain('fxModel[0] = "FxTour0001";');
    expect(script).toContain("fxShot[0][0] = 1; fxShot[0][1] = 2; fxShot[0][2] = 3; fxShot[0][3] = 4; fxShot[0][4] = 5;");
    expect(script).toContain('libNtve_gf_AttachModelToUnit(fxHost, fxModel[i], "Ref_Origin")');
    expect(script).toContain('ActorSend(fx, "Destroy");');
    expect(script).toContain('ActorSend(fx, "AnimPlay FxTour Death");');
    expect(script).toContain('BankValueSetFromInt(fxBank, "tour", "stop", -1);');
    expect(script).toContain('UnitCreate(1, "Marine", c_unitCreateIgnorePlacement, 1, fxPad, 270.0);');
  });

  it("plays a loop not named Stand forever once Birth is over, its words as anim props", () => {
    const looping = effectTourScript(planEffectBatch([effect("Assets/Effects/A/A.m3", [seq("Birth", 1, false), seq("GLstand 01", 0.33)])]));
    expect(looping).toContain('fxLoop[0] = "GLstand,01";');
    const film = looping.slice(looping.indexOf("void FxTour_Film(int i) {"));
    expect(film.indexOf('ActorSend(fx, "AnimPlay FxTour " + fxLoop[i] + " PlayForever");')).toBeGreaterThan(film.indexOf("FxTour_Shot(fxShot[i][0]);"));
    expect(effectTourScript(batch)).toContain('fxLoop[0] = "";');
  });

  it("holds the game still for each frame only when asked: the game writes no bank while held", () => {
    expect(effectTourScript(batch)).toContain("const bool fxFreeze = false;");
    expect(effectTourScript(batch, { freeze: true })).toContain("const bool fxFreeze = true;");
  });

  it("writes Galaxy that has no ?: conditional, which Galaxy lacks (a map using one doesn't compile)", () => {
    for (const options of [{}, { video: true }, { freeze: true }]) {
      const code = effectTourScript(batch, options)
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      expect(code).not.toContain("?");
    }
  });

  it("waits longer before the first effect when recording, for the recording to start", () => {
    expect(effectTourScript(batch, { video: true })).toContain("if (fxVideo) {\n        Wait(12.0, c_timeReal);\n    } else {\n        Wait(3.0, c_timeReal);\n    }");
  });

  it("saves a mark once the pad is reset, a second before the attach, when the capture records video", () => {
    expect(effectTourScript(batch)).toContain("const bool fxVideo = false;");
    const script = effectTourScript(batch, { video: true });
    expect(script).toContain("const bool fxVideo = true;");
    const reset = script.slice(script.indexOf("void FxTour_Reset(int i) {"), script.indexOf("void FxTour_Film(int i) {"));
    expect(reset).toContain('BankValueSetFromInt(fxBank, "tour", "mark", i + 1);\n        BankSave(fxBank);\n        Wait(1.0, c_timeReal);');
    expect(reset.indexOf('"mark"')).toBeGreaterThan(reset.indexOf("CameraPan("));
  });
});

describe("batchRange", () => {
  it("takes one batch, a range, or every batch", () => {
    expect(batchRange("3")).toEqual([3, 3]);
    expect(batchRange("3-5")).toEqual([3, 5]);
    expect(batchRange(undefined)).toEqual([1, Infinity]);
  });

  it("refuses an open, reversed or unreadable range", () => {
    for (const bad of ["3-", "-3", "5-3", "0", "a", "3-x"]) expect(() => batchRange(bad), bad).toThrow(/--batches takes/);
  });
});
