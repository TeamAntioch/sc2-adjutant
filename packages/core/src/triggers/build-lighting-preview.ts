import { BASELINE_LIGHT, type FlareLightCandidate } from "../catalog/flare-lights.js";
import { NTVE_FUNCTIONS as F, NTVE_PRESETS as P } from "./trigger-catalog.js";
import type { TriggerCall, TriggerDocument, TriggerParam } from "./trigger-model.js";
import { call, stableElementId } from "./build-mission-triggers.js";

export const FLARE_SOUND = "Kerrigan_Extinction_ShockwaveExplosion";

const allPlayers = (path: string): TriggerParam["value"] => ({ kind: "call", call: call(path, F.allPlayers, {}) });

function setLighting(path: string, light: string, blendSeconds: number): TriggerCall {
  return call(path, F.setLighting, {
    blendTime: { kind: "fixed", value: blendSeconds },
    light: { kind: "gamelink", gameType: "Light", value: light },
  });
}

function wait(path: string, seconds: number): TriggerCall {
  return call(path, F.wait, {
    time: { kind: "fixed", value: seconds },
    timeType: { kind: "preset", preset: P.timeGame },
  });
}

function subtitle(path: string, text: string): TriggerCall {
  return call(path, F.textMessage, {
    players: allPlayers(`${path}/players`),
    area: { kind: "preset", preset: P.messageAreaSubtitle },
    message: { kind: "text", text },
  });
}

/**
 * One map-init trigger that plays each candidate as a flare would: baseline,
 * fast blend to the candidate with the roar, hold, slow blend back.
 */
export function buildLightingPreview(candidates: readonly FlareLightCandidate[]): TriggerDocument {
  const actions: TriggerCall[] = [];
  candidates.forEach((candidate, index) => {
    const path = `preview/${index}`;
    const number = `${index + 1}/${candidates.length}`;
    actions.push(
      subtitle(`${path}/baselineText`, `${number} baseline: ${BASELINE_LIGHT}`),
      wait(`${path}/baselineWait`, 4),
      setLighting(`${path}/flare`, candidate.id, 0.5),
      call(`${path}/roar`, F.playSound, {
        owningPlayer: { kind: "preset", preset: P.globalSoundPlayer },
        audibleTo: allPlayers(`${path}/roar/players`),
        volume: { kind: "fixed", value: 100 },
        offset: { kind: "fixed", value: 0 },
        sound: { kind: "soundlink", sound: FLARE_SOUND },
      }),
      subtitle(`${path}/flareText`, `${number} FLARE: ${candidate.id} (${candidate.label})`),
      wait(`${path}/flareWait`, 6),
      setLighting(`${path}/restore`, BASELINE_LIGHT, 3),
      wait(`${path}/restoreWait`, 3),
    );
  });
  actions.push(subtitle("preview/done", "Preview finished."));

  return {
    variables: [],
    triggers: [
      {
        id: stableElementId("preview"),
        name: "Lighting Preview",
        events: [call("preview/event", F.mapInit, {})],
        actions,
      },
    ],
  };
}
