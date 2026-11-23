// Map Options' Unexplored Areas, as a Blueprint names it and as MapInfo stores it: the fog C string
// after the difficulty level (docs/reference/editor-and-engine.md, "Unexplored areas"). The compile
// writes the string, and Import and sync read it back.

/** A Blueprint's `unexploredAreas` values, the default first. */
export const UNEXPLORED_AREAS = ["black", "grey", "black-reduced-radius"] as const;

export type UnexploredAreas = (typeof UNEXPLORED_AREAS)[number];

/** MapInfo's fog string for each value. */
export const MAPINFO_FOG = { black: "Black", grey: "Dark", "black-reduced-radius": "BlackNoUnhide" } as const satisfies Record<UnexploredAreas, string>;

export type MapInfoFog = (typeof MAPINFO_FOG)[UnexploredAreas];

/** What the Editor's Map Options call each value. */
const LABEL: Record<UnexploredAreas, string> = { black: "Black Mask", grey: "Grey Mask", "black-reduced-radius": "Black Mask (Reduced Radius)" };

/** Whether `value` is one of a Blueprint's `unexploredAreas` values: own values only, not inherited keys such as "constructor". */
export const isUnexploredAreas = (value: unknown): value is UnexploredAreas => typeof value === "string" && (UNEXPLORED_AREAS as readonly string[]).includes(value);

/** The Blueprint value MapInfo's fog string stands for; undefined for a string the Editor's three don't include. */
export function unexploredAreasOf(fog: string): UnexploredAreas | undefined {
  return UNEXPLORED_AREAS.find((value) => MAPINFO_FOG[value] === fog);
}

/** What the Editor calls a Blueprint value, or the value quoted when it isn't one. */
export const labelOf = (value: unknown): string => (isUnexploredAreas(value) ? LABEL[value] : String(JSON.stringify(value)));

/** What the Editor calls a MapInfo fog string, or the string quoted when it isn't one of the Editor's three. */
export const fogLabelOf = (fog: string): string => labelOf(unexploredAreasOf(fog) ?? fog);

/** Whether the fog string is one of the Black Masks, under which a Beat's reveals explore ground the player hasn't seen. */
export const isBlackMask = (fog: string): boolean => fog === MAPINFO_FOG.black || fog === MAPINFO_FOG["black-reduced-radius"];
