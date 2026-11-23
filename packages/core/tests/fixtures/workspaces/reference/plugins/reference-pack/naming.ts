// The reference naming template. A line gives its sound id in backticks, R-<chapter>-<scene>-<line>-<SPEAKER>;
// its scene and line parts give its conversation line id (Line<scene><line>). The conversation is
// Ref<chapter>, from the Screenplay's Chapter field.
import type { LineNamingContext, NamingTemplate, ScreenplayNamingContext } from "@team-antioch/sc2-adjutant/plugin-sdk";

const SOUND_ID = /^R-[^-]+-(\d+)-(\d+[a-z]*)-[^-]+$/;

function chapter(context: ScreenplayNamingContext): string {
  const value = context.fields["Chapter"];
  if (!value) throw new Error('The Screenplay is missing "- Chapter:"');
  return value.padStart(2, "0");
}

function soundIdParts(context: LineNamingContext): { readonly scriptId: string; readonly scene: string; readonly line: string } {
  if (!context.scriptId) throw new Error("the line has no sound id in backticks after its speaker");
  const parts = SOUND_ID.exec(context.scriptId);
  if (!parts?.[1] || !parts[2]) throw new Error(`unrecognised sound id ${context.scriptId}`);
  return { scriptId: context.scriptId, scene: parts[1], line: parts[2] };
}

export const naming: NamingTemplate = {
  name: "reference",
  conversationId: (context) => `Ref${chapter(context)}`,
  lineId: (context) => {
    const { scene, line } = soundIdParts(context);
    return `Line${scene.padStart(2, "0")}${line.padStart(3, "0")}`;
  },
  soundId: (context) => soundIdParts(context).scriptId,
  soundLine: ({ lineId }) => lineId.replace(/^Line/, ""),
};
