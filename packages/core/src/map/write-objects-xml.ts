import type { UnitAi } from "../ai/enemy-ai.js";

export type WriteObjectsOptions = {
  readonly anchors: readonly {
    readonly id: number;
    readonly name: string;
    readonly zoneId: string;
    readonly kind: "unit" | "point" | "camera" | "prop" | "doodad";
    readonly position: { readonly x: number; readonly y: number; readonly z?: number };
    readonly rotation?: number | undefined;
    /** Doodads only: tilt in radians. */
    readonly pitch?: number | undefined;
    readonly roll?: number | undefined;
    /** Uniform scale, or [x, y, z]; defaults to 1. */
    readonly scale?: number | readonly [number, number, number] | undefined;
    readonly unitType?: string | undefined;
    readonly player?: number | undefined;
    readonly pointType?: string | undefined;
    readonly cameraTarget?: { readonly x: number; readonly y: number } | undefined;
    readonly cameraValues?: readonly { readonly index: string; readonly value: number }[] | undefined;
    readonly doodadType?: string | undefined;
    readonly variation?: number | undefined;
    /** "r,g,b", written as the Editor's TintColor. */
    readonly tint?: string | undefined;
    /** The Editor's "ignore placement" flag (doodads, units, points). */
    readonly forcePlacement?: boolean | undefined;
    /** Other Editor flags, each written set. */
    readonly flags?: readonly string[] | undefined;
    /** Units only: a resource's amount. */
    readonly resources?: number | undefined;
    /** Units only: an enemy unit's AI settings, written as the Editor's unit properties. */
    readonly ai?: UnitAi | undefined;
  }[];
};

/**
 * The default game camera's values, as the Editor writes them for a new camera object. A value
 * left out reads as about zero, not as this default: a FarClip of 0 clips the whole world and
 * leaves only the skybox. So every camera writes all of them, with its own values on top.
 */
export const DEFAULT_CAMERA_VALUES: readonly [string, number][] = [
  ["FieldOfView", 27.7995],
  ["NearClip", 0.0998],
  ["FarClip", 600],
  ["ShadowClip", 75],
  ["Distance", 34],
  ["Pitch", 56],
  ["Yaw", 180],
  ["FocalDepth", 8],
  ["FalloffStart", 0.0002],
  ["FalloffEnd", 8],
  ["FalloffStartNear", 0.0002],
  ["FalloffEndNear", 0.0002],
  ["BokehFStop", 0.0097],
  ["BokehMaxCoC", 1],
];

/** The Editor writes positions, rotations and scales with at most 4 decimals. */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * The Editor's AI unit properties, in Blizzard's order: Rebuild Count per difficulty (1-4,
 * Casual-Brutal), Active unticked where the unit sits a difficulty out, and "Available For Attack
 * Waves" unticked (enemy-ai §3.1).
 */
function aiElements(ai: UnitAi | undefined): string[] {
  if (!ai) return [];
  return [
    ...ai.rebuild.map((count, index) => `    <AIRebuild Index="${index + 1}" Value="${count}"/>`),
    ...ai.active.flatMap((active, index) => (active ? [] : [`    <AIActive Index="${index + 1}" Value="0"/>`])),
    ...(ai.waveable ? [] : ['    <AIFlag Index="IsUseable" Value="0"/>']),
  ];
}

export function writeObjectsXml(options: WriteObjectsOptions): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="utf-8"?>');
  lines.push('<PlacedObjects Version="27">');

  for (const anchor of options.anchors) {
    const pos = `${anchor.position.x},${anchor.position.y},${round4(anchor.position.z ?? 0)}`;
    const rot = round4(anchor.rotation ?? 0);
    const [sx, sy, sz] = typeof anchor.scale === "object" ? anchor.scale : [anchor.scale ?? 1, anchor.scale ?? 1, anchor.scale ?? 1];
    const scale = `${round4(sx)},${round4(sy)},${round4(sz)}`;

    // The Editor writes "ignore placement" as a child flag.
    const flagIndices = [...(anchor.forcePlacement ? ["ForcePlacement"] : []), ...(anchor.flags ?? [])];
    const children = [...flagIndices.map((index) => `    <Flag Index="${index}" Value="1"/>`), ...(anchor.kind === "unit" ? aiElements(anchor.ai) : [])];
    const element = (tag: string, attrs: string): string[] =>
      children.length > 0 ? [`  <${tag} ${attrs}>`, ...children, `  </${tag}>`] : [`  <${tag} ${attrs}/>`];
    if (anchor.kind === "unit") {
      const variationAttr = anchor.variation !== undefined ? ` Variation="${anchor.variation}"` : "";
      const playerAttr = anchor.player !== undefined ? ` Player="${anchor.player}"` : "";
      const resourcesAttr = anchor.resources !== undefined ? ` Resources="${anchor.resources}"` : "";
      lines.push(
        ...element("ObjectUnit", `Id="${anchor.id}"${variationAttr} Position="${pos}" Rotation="${rot}" Scale="${scale}" UnitType="${anchor.unitType ?? "Unknown"}"${playerAttr}${resourcesAttr}`),
      );
    } else if (anchor.kind === "point") {
      lines.push(
        ...element("ObjectPoint", `Id="${anchor.id}" Position="${pos}" Rotation="${rot}" Scale="${scale}" Type="${anchor.pointType ?? "Normal"}" Name="${anchor.name}" Color="0,0,0,0"`),
      );
    } else if (anchor.kind === "camera") {
      const target = anchor.cameraTarget ? ` CameraTarget="${anchor.cameraTarget.x},${anchor.cameraTarget.y}"` : "";
      const values = new Map(DEFAULT_CAMERA_VALUES);
      for (const cv of anchor.cameraValues ?? []) values.set(cv.index, cv.value);
      // The Editor keeps the yaw again as the object's Rotation, in radians, and culls the view by
      // it: a Rotation of 0 under a Yaw of 180 drops everything far up the view.
      const facing = round4(((values.get("Yaw") ?? 0) * Math.PI) / 180);
      lines.push(
        `  <ObjectCamera Id="${anchor.id}" Position="${pos}" Rotation="${facing}" Scale="${scale}" Name="${anchor.name}" Color="0,0,0,0"${target}>`,
      );
      for (const [index, value] of values) {
        lines.push(`    <CameraValue Index="${index}" Value="${value}"/>`);
      }
      for (const index of flagIndices) lines.push(`    <Flag Index="${index}" Value="1"/>`);
      lines.push(`  </ObjectCamera>`);
    } else if (anchor.kind === "doodad") {
      const varAttr = anchor.variation !== undefined ? ` Variation="${anchor.variation}"` : "";
      const tintAttr = anchor.tint !== undefined ? ` TintColor="${anchor.tint}"` : "";
      const tilt = `${anchor.pitch ? ` Pitch="${round4(anchor.pitch)}"` : ""}${anchor.roll ? ` Roll="${round4(anchor.roll)}"` : ""}`;
      lines.push(...element("ObjectDoodad", `Id="${anchor.id}"${varAttr} Position="${pos}" Rotation="${rot}"${tilt} Scale="${scale}" Type="${anchor.doodadType ?? "Unknown"}"${tintAttr}`));
    }
  }

  lines.push("</PlacedObjects>");
  return lines.join("\n");
}
