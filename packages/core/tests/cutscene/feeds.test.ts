import { describe, expect, it } from "vitest";

import { FEED_RIG, feedRig } from "../../src/cutscene/feeds.js";
import { cameraEye } from "../../src/cutscene/import-set.js";

type Vec3 = readonly [number, number, number];
const DEG = Math.PI / 180;

/** The engine's rotation for a world-axis triple, Rx·Ry·Rz, applied to `v`. */
function rotate([x, y, z]: Vec3, v: Vec3): Vec3 {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x * DEG), Math.sin(x * DEG), Math.cos(y * DEG), Math.sin(y * DEG), Math.cos(z * DEG), Math.sin(z * DEG)];
  const rz: Vec3 = [cz * v[0] - sz * v[1], sz * v[0] + cz * v[1], v[2]];
  const ry: Vec3 = [cy * rz[0] + sy * rz[2], rz[1], -sy * rz[0] + cy * rz[2]];
  return [ry[0], cx * ry[1] - sx * ry[2], sx * ry[1] + cx * ry[2]];
}
const close = (a: readonly number[], b: readonly number[]) => a.forEach((value, axis) => expect(value).toBeCloseTo(b[axis]!, 5));

describe("a feed's rig", () => {
  const cameras = [
    { target: [0, 0, 8], distance: 56, pitch: 7, yaw: 183, fov: 40 },
    { target: [100, 1, 1], distance: 8, pitch: 5, yaw: 0, fov: 35, heightOffset: -0.5 },
    { target: [-3, 12, 30], distance: 26, pitch: -12, yaw: 128, fov: 48 },
    { target: [5, -6, -0.5], distance: 1.75, pitch: 2, yaw: 90, fov: 55 },
  ] as const;

  it.each(cameras)("stands so its own camera looks along the set camera's line of sight, through the same point, level", (camera) => {
    const { at, rotation, eye } = feedRig(camera);
    // Its camera's eye, from the model's frame: where the rig says it is.
    close(
      rotate(rotation, FEED_RIG.eye as unknown as Vec3).map((value, axis) => value + at[axis]!),
      eye,
    );
    // Its camera looks along the model's +y: the set camera's view, yaw 0 south and a positive pitch down.
    const view: Vec3 = [Math.sin(camera.yaw * DEG) * Math.cos(camera.pitch * DEG), -Math.cos(camera.yaw * DEG) * Math.cos(camera.pitch * DEG), -Math.sin(camera.pitch * DEG)];
    close(rotate(rotation, [0, 1, 0]), view);
    // Level: its right hand stays on the horizon.
    expect(rotate(rotation, [1, 0, 0])[2]).toBeCloseTo(0, 6);
    // On the set camera's line of sight, from its eye through what it looks at.
    const from = cameraEye({ ...camera, target: [...camera.target] });
    const along = eye.map((value, axis) => value - from[axis]!);
    const off = Math.hypot(along[1]! * view[2] - along[2]! * view[1], along[2]! * view[0] - along[0]! * view[2], along[0]! * view[1] - along[1]! * view[0]);
    expect(off).toBeCloseTo(0, 6);
  });

  it("frames the target as the set camera does: a narrower lens than its 50° brings it nearer, a wider one takes it back", () => {
    const focusDistance = (camera: (typeof cameras)[number]) => {
      const { eye } = feedRig(camera);
      const from = cameraEye({ ...camera, target: [...camera.target] });
      const view: Vec3 = [Math.sin(camera.yaw * DEG) * Math.cos(camera.pitch * DEG), -Math.cos(camera.yaw * DEG) * Math.cos(camera.pitch * DEG), -Math.sin(camera.pitch * DEG)];
      const focus = from.map((value, axis) => value + view[axis]! * camera.distance);
      return Math.hypot(...focus.map((value, axis) => value - eye[axis]!));
    };
    // 56 · tan 20° / tan 25° and 1.75 · tan 27.5° / tan 25°.
    expect(focusDistance(cameras[0])).toBeCloseTo(43.71, 2);
    expect(focusDistance(cameras[3])).toBeCloseTo(1.9536, 3);
  });

  it("turns the model to face the way the camera looks: north as it is, east a quarter turn clockwise", () => {
    expect(feedRig({ target: [0, 0, 0], distance: 10, pitch: 0, yaw: 180, fov: 50 }).rotation).toEqual([0, 0, 0]);
    expect(feedRig({ target: [0, 0, 0], distance: 10, pitch: 0, yaw: 90, fov: 50 }).rotation).toEqual([0, 0, -90]);
    // Level, looking north from 10 cells south: the model stands its eye's offset back from there.
    const { at } = feedRig({ target: [0, 0, 0], distance: 10, pitch: 0, yaw: 180, fov: 50 });
    close(at, [-FEED_RIG.eye[0], -10 - FEED_RIG.eye[1], -FEED_RIG.eye[2]]);
  });
});
