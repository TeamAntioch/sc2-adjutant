// The light test: one card camera of a set, filmed again under each of a run of lighting variants,
// so the set's look in game can be judged light by light, and a rule for lighting card cameras chosen.
//
// Blizzard's story cutscene Lights give next to no light of their own (ambient and directional
// lights at zero, an environment map for reflections): each shot is lit by the lamps the file turns
// on for it (their Active Shot ties). Every lamp near the set at once blows a room out; none leaves
// it black. So each variant lights the card camera with the lamps of some of the file's shots, picked
// by one of a few rules (LAMP_RULES), under the base Light the file has active when it cuts to the
// first of them. A set no shot's lamp lights (an exterior) has only its base Light's HDR exposure to
// turn, through a test Light that inherits the rest.

import type { CardShot } from "./card-cameras.js";
import { type CardSheetEntry, lampShots } from "./contact-sheet.js";
import { type CutsceneNode, readCutscene } from "./read-cutscene.js";
import type { CinematicSet, CutsceneSource, SetCamera } from "./set-catalog.js";

/** A test Light: `parent` with its first time of day's HDR exposure changed. */
export type TestLight = { readonly id: string; readonly parent: string; readonly exposure: number };

/** HDR exposures tried on a set no shot's lamp lights; Blizzard's story cutscene Lights mostly sit at 1. */
export const UNLIT_EXPOSURES: readonly number[] = [2, 3.5, 5];
/** A shot whose camera stands closer than this to its aim is a close-up, lit for its subject alone. */
export const CLOSE_UP_REACH = 1.5;
/** The rules that gather several shots stop adding them once they hold this many lamps. */
export const LAMP_CAP = 24;
/** "Standing near": a wide shot whose eye is this close to the card camera's. */
const NEAR_EYE = 5;
/** "Looking the same way": a wide shot within this many degrees of the card camera's view, standing this close. */
const SAME_WAY_DEGREES = 45;
const SAME_WAY_EYE = 8;

type Vec3 = readonly [number, number, number];
/** A shot of the file that has lamps: its camera, its lamp count, how far it is from the card camera and how far its view turns from the card's. */
type Candidate = { readonly camera: SetCamera; readonly lamps: number; readonly eye: number; readonly aim: number; readonly degrees: number; readonly reach: number };

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (v: Vec3): number => Math.hypot(...v);
function degreesBetween(a: Vec3, b: Vec3): number {
  const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (length(a) * length(b) || 1);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Shots in order until they hold LAMP_CAP lamps (at least one shot). */
function upToCap(candidates: readonly Candidate[]): Candidate[] {
  const taken: Candidate[] = [];
  let lamps = 0;
  for (const candidate of candidates) {
    if (taken.length > 0 && lamps + candidate.lamps > LAMP_CAP) break;
    taken.push(candidate);
    lamps += candidate.lamps;
  }
  return taken;
}

/** The rules a card camera's shots are picked by, each from the shots that have lamps; one may pick none. */
export const LAMP_RULES: readonly { readonly name: string; readonly pick: (candidates: readonly Candidate[]) => Candidate[] }[] = [
  // Round two's rule: where the camera stands, then what it aims at.
  { name: "closest shot", pick: (all) => [...all].sort((a, b) => a.eye + a.aim / 2 - (b.eye + b.aim / 2)).slice(0, 1) },
  {
    name: "best-matching wide shot",
    pick: (all) =>
      all
        .filter((c) => c.reach >= CLOSE_UP_REACH)
        .sort((a, b) => a.degrees / 15 + a.eye - (b.degrees / 15 + b.eye))
        .slice(0, 1),
  },
  { name: "wide shots standing near", pick: (all) => upToCap(all.filter((c) => c.reach >= CLOSE_UP_REACH && c.eye <= NEAR_EYE).sort((a, b) => a.eye - b.eye)) },
  {
    name: "wide shots looking the same way",
    pick: (all) =>
      upToCap(
        all
          .filter((c) => c.reach >= CLOSE_UP_REACH && c.degrees <= SAME_WAY_DEGREES && c.eye <= SAME_WAY_EYE)
          .sort((a, b) => a.degrees / 15 + a.eye - (b.degrees / 15 + b.eye)),
      ),
  },
];

/** The base Light the file has active when it first cuts to each camera, by camera GUID. */
function lightAtCuts(root: CutsceneNode): Map<string, string> {
  const all = (node: CutsceneNode): CutsceneNode[] => [node, ...node.children.flatMap(all)];
  const nodes = all(root);
  const start = (node: CutsceneNode): number => Number(node.attrs.start ?? 0);
  const lights = nodes.filter((node) => node.tag === "CCutsceneElementActiveLight" && node.attrs.lightID).sort((a, b) => start(a) - start(b));
  const cuts = nodes.filter((node) => node.tag === "CCutsceneElementActiveCamera").sort((a, b) => start(a) - start(b));
  const byCamera = new Map<string, string>();
  for (const cut of cuts) {
    const camera = cut.attrs.objectGuid ?? cut.attrs.objectGUID;
    if (!camera || byCamera.has(camera)) continue;
    const light = lights.filter((node) => start(node) <= start(cut)).pop() ?? lights[0];
    if (light) byCamera.set(camera, light.attrs.lightID!);
  }
  return byCamera;
}

/** One way to light a card camera: a name for it, its lamps and base Light, and the test Lights it needs. */
export type Lighting = { readonly name: string; readonly lamps: NonNullable<CardSheetEntry["lamps"]>; readonly light?: string; readonly lights: readonly TestLight[] };

/**
 * The ways to light one set's card camera: all its lamps (`all`), then each lamp rule's shots,
 * under the base Light active at the first one's cut (rules picking the same shots as an earlier one
 * are left out); for a set no shot's lamp lights, its base Light at each of UNLIT_EXPOSURES (the test
 * Lights named `<prefix>_<n>`). `source` is the file the set was catalogued from.
 */
export function lightings(set: CinematicSet, source: CutsceneSource, camera: CardShot, prefix: string, options: { readonly all: boolean }): Lighting[] {
  const occurrence = set.occurrences[0]!;
  const root = readCutscene(source.xml);
  const nodes = new Map<string, CutsceneNode>();
  const collect = (node: CutsceneNode): void => {
    if (node.attrs.guid) nodes.set(node.attrs.guid, node);
    node.children.forEach(collect);
  };
  collect(root);
  const lampsFor = new Map<string, number>();
  for (const guid of occurrence.lamps) for (const shot of nodes.has(guid) ? lampShots(nodes.get(guid)!) : []) lampsFor.set(shot, (lampsFor.get(shot) ?? 0) + 1);
  const atCuts = lightAtCuts(root);
  const view = sub(camera.target, camera.eye);
  const candidates: Candidate[] = occurrence.cameras
    .filter((own) => lampsFor.has(own.guid))
    .map((own) => {
      const eye: Vec3 = [own.eye[0], own.eye[1], own.eyeHeight];
      return { camera: own, lamps: lampsFor.get(own.guid)!, eye: length(sub(eye, camera.eye)), aim: length(sub(own.target, camera.target)), degrees: degreesBetween(sub(own.target, eye), view), reach: length(sub(own.target, eye)) };
    });

  const base = occurrence.lights[0];
  const found: Lighting[] = [];
  if (options.all && candidates.length > 0) found.push({ name: `all ${occurrence.lamps.length} lamps, ${base ?? "no light"}`, lamps: "all", ...(base ? { light: base } : {}), lights: [] });
  const seen = new Set<string>();
  for (const rule of LAMP_RULES) {
    const picked = rule.pick(candidates);
    const key = picked.map((c) => c.camera.guid).join(",");
    if (picked.length === 0 || seen.has(key)) continue;
    seen.add(key);
    const light = atCuts.get(picked[0]!.camera.guid) ?? base;
    const shots = picked.length === 1 ? `shot "${picked[0]!.camera.name}"` : `${picked.length} shots from "${picked[0]!.camera.name}"`;
    const lamps = picked.reduce((sum, c) => sum + c.lamps, 0);
    found.push({ name: `${rule.name}: ${shots}, ${lamps} lamps, ${light ?? "no light"}`, lamps: { shots: picked.map((c) => c.camera.guid) }, ...(light ? { light } : {}), lights: [] });
  }
  if (candidates.length === 0 && base) {
    UNLIT_EXPOSURES.forEach((exposure, k) => {
      const id = `${prefix}_${k + 1}`;
      found.push({ name: `no lamps, ${base} at exposure ${exposure}`, lamps: "none", light: id, lights: [{ id, parent: base, exposure }] });
    });
  }
  return found;
}

/**
 * The light test's variants for one set's card camera: no lamps, then each of its lightings but
 * all its lamps, each a card sheet entry labelled with how it is lit, and the test Lights they need.
 */
export function lightVariants(set: CinematicSet, source: CutsceneSource, camera: CardShot, index: number, prefix: string): { readonly entries: CardSheetEntry[]; readonly lights: TestLight[] } {
  const base = set.occurrences[0]!.lights[0];
  const entry = (label: string, lighting: Pick<CardSheetEntry, "light" | "lamps">): CardSheetEntry => ({ set, cameras: [camera], label, ...lighting });
  const found = lightings(set, source, camera, `${prefix}${index}`, { all: false });
  return {
    entries: [entry(`no lamps, ${base ?? "no light"}`, { lamps: "none" }), ...found.map((lighting) => entry(lighting.name, { lamps: lighting.lamps, ...(lighting.light ? { light: lighting.light } : {}) }))],
    lights: found.flatMap((lighting) => lighting.lights),
  };
}

/** LightData.xml holding the test Lights, each inheriting all but its exposure; undefined when there are none. */
export function testLightData(lights: readonly TestLight[]): string | undefined {
  if (lights.length === 0) return undefined;
  const entries = lights.map(
    (light) =>
      `    <CLight id="${light.id}" parent="${light.parent}">\r\n        <ToDInfoArray index="0">\r\n            <Param index="HDRExposure" value="${light.exposure.toFixed(6)}"/>\r\n        </ToDInfoArray>\r\n    </CLight>`,
  );
  return ['<?xml version="1.0" encoding="utf-8"?>', "<Catalog>", ...entries, "</Catalog>", ""].join("\r\n");
}
