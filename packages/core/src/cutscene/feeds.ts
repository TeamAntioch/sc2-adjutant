// A display's feed through a set camera: the rig that films it. Render-to-texture renders the camera
// inside an actor's model (its m3 CAM_), never a cutscene camera node (all 108 RTT elements in
// Blizzard's and a Campaign's cutscenes point at actors), so a set camera is filmed by placing a model whose own
// camera stands at the set camera's eye, looking its way (docs/reference/editor-and-engine.md,
// "Render to texture").

import type { SetCamera } from "../domain/cinematic-set.js";
import { cameraEye } from "./import-set.js";

type Vec3 = readonly [number, number, number];

/**
 * The rig: the Nova bridge's main screen (novastoryassets.sc2mod), whose `SC2CameraRTT` is the
 * longest-reaching camera in Blizzard's RTT models (far clip 200 cells; the communicators' are 10 to
 * 20). Read from its m3: the camera's bone sits at `eye` in the model's frame, turned 90° about x, so
 * it looks level along the model's +y (as the Valerian feed in SMX3_Cutscene_MP02_040 has it), with a
 * 50° lens. Its own screen sits more than 30° below that line, out of its picture.
 */
export const FEED_RIG = { model: "SMX3_Nova_Ship_Bridge_MainScreen", cameraIndex: 0, eye: [0.031996, -5.542275, 5.388209], fov: 50, farClip: 200 } as const;

const DEG = Math.PI / 180;

/**
 * Where the rig stands, and how it's turned (the engine's world-axis (x, y, z), applied z first), so
 * its camera films what `camera` (in the Cinematic's frame) does: from the set camera's line of
 * sight, level (a feed doesn't roll), and moved along that line so the target fills its 50° lens as
 * it fills the set camera's: nearer for a wider lens, further for a narrower one.
 */
export function feedRig(camera: { readonly target: Vec3 } & Pick<SetCamera, "distance" | "pitch" | "yaw" | "fov" | "heightOffset">): { readonly at: Vec3; readonly rotation: Vec3; readonly eye: Vec3 } {
  const [yaw, pitch] = [camera.yaw * DEG, camera.pitch * DEG];
  // The view: yaw 0 looks south (-y), 90 east; a positive pitch looks down.
  const view: Vec3 = [Math.sin(yaw) * Math.cos(pitch), -Math.cos(yaw) * Math.cos(pitch), -Math.sin(pitch)];
  const from = cameraEye({ ...camera, target: [...camera.target] });
  const focus = from.map((value, axis) => value + view[axis]! * camera.distance);
  const distance = (camera.distance * Math.tan((camera.fov * DEG) / 2)) / Math.tan((FEED_RIG.fov * DEG) / 2);
  const eye = focus.map((value, axis) => value - view[axis]! * distance) as unknown as Vec3;
  // The model's +y looks along the view, its +x to the right and its +z up: R = [right | view | up].
  const right: Vec3 = [-Math.cos(yaw), -Math.sin(yaw), 0];
  const up: Vec3 = [right[1] * view[2] - right[2] * view[1], right[2] * view[0] - right[0] * view[2], right[0] * view[1] - right[1] * view[0]];
  const m = [
    [right[0], view[0], up[0]],
    [right[1], view[1], up[1]],
    [right[2], view[2], up[2]],
  ] as const;
  // Read back as Rx·Ry·Rz (turns.ts' worldFacing): m[0][2] is sin y, m[0][0] and m[0][1] give z, m[1][2] and m[2][2] give x.
  const clean = (angle: number): number => Math.round(angle * 1e6) / 1e6 + 0;
  const rotation: Vec3 = [clean(Math.atan2(-m[1][2], m[2][2]) / DEG), clean(Math.asin(Math.max(-1, Math.min(1, m[0][2]))) / DEG), clean(Math.atan2(-m[0][1], m[0][0]) / DEG)];
  const at = eye.map((value, axis) => value - (m[axis]![0] * FEED_RIG.eye[0] + m[axis]![1] * FEED_RIG.eye[1] + m[axis]![2] * FEED_RIG.eye[2])) as unknown as Vec3;
  return { at, rotation, eye };
}
