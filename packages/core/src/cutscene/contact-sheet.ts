// The contact sheet: pictures of every cinematic set, taken in the game. For each set it writes a
// cutscene holding the set's own scenery and lights, copied node for node from the file the
// catalog drew it from, with the base Light that file uses and a fixed run of cameras: two
// eye-level overviews, a high three-quarter view and up to three of the set's own cameras. A map
// script plays the cutscenes in turn in a full-screen dialog (how LotV plays its cinematics) and
// announces every shot in a bank, so a watcher outside the game can screenshot it. The card sheet
// (buildCardSheet) films the Set Finder's card pictures instead, from the cameras Blender drew them
// with (card-cameras.ts), to compare the game's lighting with them.

import type { CardShot, PieceFilter } from "./card-cameras.js";
import { type CutsceneNode, readCutscene, writeCutscene } from "./read-cutscene.js";
import type { CinematicSet, CutsceneSource, SetCamera, SetOccurrence } from "./set-catalog.js";

/** Lead-in before the first shot is captured, for models and textures to stream in. */
export const LEAD_MS = 3000;
/** How long each camera holds; the watcher is told at three quarters through. */
export const SHOT_MS = 4000;
/** Original cutscenes: play this long after a jump (so the shot settles), then hold the frame this long. */
const ORIGINAL_PLAY_MS = 600;
const ORIGINAL_HOLD_MS = 1200;
/** Original cutscenes: shots to capture per set, and the shortest shot worth one. */
const ORIGINAL_SHOTS = 6;
const ORIGINAL_MIN_SHOT_MS = 1200;
/** Original cutscenes: no capture this close to the end, where files hold black before End Scene. */
const ORIGINAL_TAIL_MS = 2500;
/** The set's own cameras to include, ahead of the generated ones. */
const OWN_CAMERAS = 3;
/** Generated room views: eye in the middle at head height, a wide lens, level. */
const INSIDE_REACH = 3;
const INSIDE_PITCH = 5;
const INSIDE_FOV = 60;
const DEG = Math.PI / 180;
/** Names that mark a set's own establishing cameras, taken first. */
const ESTABLISHING = /(wide|establish|master|opening|overview|profile|warp)/i;
/** Nodes that point at objects the copy leaves out: camera ties, attachments, look-ats, paths, sound. */
const DROP = new Set(["CCutsceneNodeActiveShot", "CCutsceneNodeAttachment", "CCutsceneNodeLookAt", "CCutsceneNodeFollowPath", "CCutsceneNodeSound", "CCutsceneNodeConversation"]);

/**
 * `card`: on a card sheet, the card picture (`card/N.jpg` in the set's views folder) the shot films
 * again. `lighting`: on a sheet that films each card under several lightings, the one this shot has;
 * the collation keeps one frame per card (capture/set-capture.ts).
 */
export type SheetShot = { readonly stop: number; readonly setId: string; readonly setName: string; readonly shot: number; readonly camera: string; readonly card?: string; readonly lighting?: string };
export type SheetCutscene = { readonly file: string; readonly setId: string; readonly xml: string };
export type ContactSheet = { readonly cutscenes: readonly SheetCutscene[]; readonly shots: readonly SheetShot[]; readonly script: string };

type Vec3 = readonly [number, number, number];

/**
 * The game's story campaigns and Nova's art mod, which hold the models Blizzard's sets are built
 * from: a sheet map depends on all of them, ahead of its own dependencies (the Workspace's campaign
 * mod), so a set from any campaign draws its scenery rather than placeholder spheres.
 */
export const SHEET_CAMPAIGNS: readonly string[] = [
  "bnet:Liberty Story (Campaign)/0.0/999,file:Campaigns/LibertyStory.SC2Campaign",
  "bnet:Swarm Story (Campaign)/0.0/999,file:Campaigns/SwarmStory.SC2Campaign",
  "bnet:Void Story (Campaign)/0.0/999,file:Campaigns/VoidStory.SC2Campaign",
  "bnet:Nova Covert Ops (Art Mod)/0.0/999,file:Mods/NovaStoryAssets.SC2Mod",
];

/** A sheet map's dependencies: the story campaigns, then the base map's own, each once (by its file). */
export function sheetDependencies(own: readonly string[]): string[] {
  const file = (dependency: string): string => (/(?:^|,)file:(.+)$/.exec(dependency)?.[1] ?? dependency).replace(/\\/g, "/").toLowerCase();
  const ownFiles = new Set(own.map(file));
  return [...SHEET_CAMPAIGNS.filter((campaign) => !ownFiles.has(file(campaign))), ...own];
}

export const sourceKey = (origin: CutsceneSource["origin"], path: string): string => `${origin}:${path}`;

/**
 * A property the file changes over time (keys after its start, or more than one): visibility, a move,
 * a fade. Retimed to the sheet's single moment, its keys would all land at once, so a piece the file
 * hides for a while and shows again would stay hidden. A single value set at the start is kept.
 */
const keyed = (node: CutsceneNode): boolean =>
  node.tag === "CCutsceneNodePropertyValue" && (node.children.length !== 1 || Number(node.children[0]!.attrs.start ?? 0) !== 0);

/**
 * Every element lasts the whole sheet cutscene from its start; ties to left-out objects and keyed
 * properties are dropped, so a piece stands as the file places it, as Blender draws it.
 */
function retime(node: CutsceneNode, totalMs: number): CutsceneNode {
  const attrs: Record<string, string> = { ...node.attrs };
  if (node.tag.startsWith("CCutsceneElement")) {
    delete attrs.start;
    attrs.duration = String(totalMs);
  }
  return { tag: node.tag, attrs, children: node.children.filter((child) => !DROP.has(child.tag) && !keyed(child)).map((child) => retime(child, totalMs)) };
}

const folder = (name: string, guid: string, children: CutsceneNode[]): CutsceneNode => ({ tag: "CCutsceneNodeFolder", attrs: { guid, name }, children });
const objectElement = (guid: string, totalMs: number): CutsceneNode => ({ tag: "CCutsceneElementObject", attrs: { guid, duration: String(totalMs), lockedToEnd: "1" }, children: [] });
const fixed = (value: number): string => value.toFixed(6);

/** An orbit camera node: `position` is what it looks at, the eye `distance` back along the yaw. */
function orbitCamera(guid: string, elementGuid: string, name: string, target: Vec3, distance: number, pitch: number, yaw: number, fov: number, totalMs: number): CutsceneNode {
  return {
    tag: "CCutsceneNodeCamera",
    attrs: {
      guid,
      name,
      position: target.map(fixed).join(","),
      fov: fixed(fov),
      verticalFOV: "1",
      nearClip: fixed(0.1),
      farClip: fixed(600),
      shadowClip: fixed(75),
      distance: fixed(distance),
      pitch: fixed(pitch),
      yaw: fixed(yaw),
    },
    children: [objectElement(elementGuid, totalMs)],
  };
}

/**
 * A free camera node (the Cutscene Editor's target camera): an eye and a point it looks at, the lens
 * vertical, as Blender's is, so a 16:9 frame holds what the card holds.
 */
function targetCamera(guid: string, elementGuid: string, name: string, eye: Vec3, target: Vec3, fov: number, totalMs: number): CutsceneNode {
  const [ex, ey, ez] = eye.map(fixed) as [string, string, string];
  const [tx, ty, tz] = target.map(fixed) as [string, string, string];
  return {
    tag: "CCutsceneNodeTargetCamera",
    attrs: {
      guid,
      name,
      position: [tx, ty, tz].join(","),
      fov: fixed(fov),
      nearClip: fixed(0.1),
      farClip: fixed(600),
      shadowClip: fixed(75),
      depthOfField: fixed(0),
      roll: fixed(0),
      verticalFOV: "1",
      eyePositionX: ex,
      eyePositionY: ey,
      eyePositionZ: ez,
      targetPositionX: tx,
      targetPositionY: ty,
      targetPositionZ: tz,
    },
    children: [objectElement(elementGuid, totalMs)],
  };
}

/** A card shot's camera name: "card 2" for card/2.jpg. */
const cardName = (card: string): string => `card ${card.replace(/^card\//, "").replace(/\.jpg$/, "")}`;

/**
 * Where the room is and how big. Where the set's own still cameras aim is the best guide (they
 * point at where things happen, at face height); then its marks; then its pieces. The median, not
 * the mean: a Blizzard file stages people all over (Nova's room, a corridor, a kill shot), and
 * their mean lands in empty space between the places.
 */
function room(occurrence: SetOccurrence, still: (camera: SetCamera) => boolean): { readonly centre: Vec3; readonly radius: number } {
  const aims = occurrence.cameras.filter(still).map((camera) => camera.target);
  const fromCameras = aims.length >= 2;
  const points = fromCameras ? aims : occurrence.marks.length ? occurrence.marks.map((mark) => mark.at) : occurrence.pieces.map((piece) => piece.at);
  const median = (axis: number): number => {
    const sorted = points.map((p) => p[axis]!).sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
  };
  const [x, y, z] = [median(0), median(1), median(2)];
  const radius = Math.max(3, ...points.map((p) => Math.hypot(p[0] - x, p[1] - y)).filter((d) => d < 25));
  return { centre: [x, y, z + (fromCameras ? 0 : occurrence.marks.length ? 0.6 : 1)], radius };
}

/**
 * The set's own cameras worth showing: aimed into the room, establishing ones first, distinct names.
 * Only still cameras: one with anything under it but its lifetime element (property curves, an
 * attachment to a rig) moves, and its own position is a placeholder that films nothing.
 */
const stillIn =
  (nodes: ReadonlyMap<string, CutsceneNode>) =>
  (camera: SetCamera): boolean =>
    (nodes.get(camera.guid)?.children ?? []).every((child) => child.tag === "CCutsceneElementObject");

function ownCameras(occurrence: SetOccurrence, nodes: ReadonlyMap<string, CutsceneNode>, centre: Vec3, radius: number): SetCamera[] {
  const still = stillIn(nodes);
  const inRoom = occurrence.cameras.filter((camera) => still(camera) && Math.hypot(camera.target[0] - centre[0], camera.target[1] - centre[1]) <= radius + 5);
  const ordered = [...inRoom.filter((camera) => ESTABLISHING.test(camera.name)), ...inRoom.filter((camera) => !ESTABLISHING.test(camera.name))];
  const seen = new Set<string>();
  return ordered.filter((camera) => !seen.has(camera.name) && seen.add(camera.name)).slice(0, OWN_CAMERAS);
}

/**
 * One set's sheet cutscene, and the names of its shots in order. With `cards`, it films those card
 * cameras in place of the set's own and the generated views, with only the pieces `cards` keeps.
 */
export function setCutscene(
  set: CinematicSet,
  source: CutsceneSource,
  index: number,
  cards?: PieceFilter & { readonly cameras: readonly CardShot[] } & SheetLighting,
): { readonly xml: string; readonly cameras: readonly string[] } {
  const occurrence = set.occurrences[0]!;
  const nodes = new Map<string, CutsceneNode>();
  const collect = (node: CutsceneNode): void => {
    if (node.attrs.guid) nodes.set(node.attrs.guid, node);
    node.children.forEach(collect);
  };
  collect(readCutscene(source.xml));

  let counter = 0;
  const guid = (): string => `77${String(index).padStart(4, "0")}${String(++counter).padStart(5, "0")}`;
  const { centre, radius } = room(occurrence, stillIn(nodes));
  const own = cards ? [] : ownCameras(occurrence, nodes, centre, radius);
  const shots = cards ? cards.cameras.length : own.length + 5;
  const totalMs = LEAD_MS + shots * SHOT_MS + 500;

  // Most sets are rooms, so the generated views stand in the middle at head height and look at
  // each wall; one high view from outside covers the open ones (exteriors, space).
  const inside = (name: string, yaw: number): CutsceneNode => {
    const level = Math.cos(INSIDE_PITCH * DEG) * INSIDE_REACH;
    const target: Vec3 = [centre[0] - Math.sin(yaw * DEG) * level, centre[1] - Math.cos(yaw * DEG) * level, centre[2] - Math.sin(INSIDE_PITCH * DEG) * INSIDE_REACH];
    return orbitCamera(guid(), guid(), name, target, INSIDE_REACH, INSIDE_PITCH, yaw, INSIDE_FOV, totalMs);
  };
  const cameras: CutsceneNode[] = cards
    ? cards.cameras.map((card) => targetCamera(guid(), guid(), cardName(card.card), card.eye, card.target, card.fov, totalMs))
    : [
        ...own.map((camera) => {
          const original = nodes.get(camera.guid)!;
          return { tag: original.tag, attrs: { ...original.attrs }, children: [objectElement(guid(), totalMs)] };
        }),
        inside("From the middle, looking north", 180),
        inside("From the middle, looking east", 270),
        inside("From the middle, looking south", 0),
        inside("From the middle, looking west", 90),
        orbitCamera(guid(), guid(), "High overview from outside", centre, radius * 2.5 + 4, 50, 135, 45, totalMs),
      ];
  // As set-cards picks them for Blender: by model name, ignoring case.
  const only = cards?.only ? new RegExp(cards.only, "i") : undefined;
  const without = cards?.without ? new RegExp(cards.without, "i") : undefined;
  const kept = occurrence.pieces.filter((piece) => (!only || only.test(piece.model)) && !(without && without.test(piece.model)));
  const pieces = kept.flatMap((piece) => (nodes.has(piece.guid) ? [retime(nodes.get(piece.guid)!, totalMs)] : []));
  const lampsWanted = cards?.lamps ?? "all";
  const near = (lamp: CutsceneNode): boolean => {
    if (typeof lampsWanted === "object") return lampShots(lamp).some((shot) => lampsWanted.shots.includes(shot));
    if (typeof lampsWanted !== "number") return lampsWanted === "all";
    const at = (lamp.attrs.position ?? "").split(",").map(Number);
    return cards!.cameras.some((camera) => Math.hypot(at[0]! - camera.target[0], at[1]! - camera.target[1]) <= lampsWanted);
  };
  const lamps = occurrence.lamps.flatMap((lamp) => (nodes.has(lamp) && near(nodes.get(lamp)!) ? [retime(nodes.get(lamp)!, totalMs)] : []));
  const light = cards?.light ?? occurrence.lights[0];

  const director: CutsceneNode = {
    tag: "CCutsceneNodeDirector",
    attrs: { guid: guid(), name: "Director" },
    children: [
      {
        tag: "CCutsceneNodeActiveCamera",
        attrs: { guid: guid(), name: "Active Camera" },
        children: cameras.map((camera, shot) => ({
          tag: "CCutsceneElementActiveCamera",
          attrs: { guid: guid(), ...(shot > 0 ? { start: String(LEAD_MS + shot * SHOT_MS) } : {}), cameraIndex: "0", objectGuid: camera.attrs.guid! },
          children: [],
        })),
      },
      ...(light
        ? [{ tag: "CCutsceneNodeActiveLight", attrs: { guid: guid(), name: "Active Light" }, children: [{ tag: "CCutsceneElementActiveLight", attrs: { guid: guid(), lightGUID: "0", lightID: light, lightIndex: "0", blendTime: "0" }, children: [] }] }]
        : []),
    ],
  };
  const root: CutsceneNode = {
    tag: "CutsceneState",
    attrs: { cutsceneVersion: "1.300000" },
    children: [director, folder("Set", guid(), pieces), folder("Lights", guid(), lamps), folder("Cameras", guid(), cameras)],
  };
  return { xml: writeCutscene(root), cameras: cameras.map((camera) => camera.attrs.name ?? "camera") };
}

/** The Galaxy that plays every sheet cutscene in turn and announces each shot in bank "CsSheet". */
/** Galaxy for a cutscene path inside the map, e.g. "Cutscenes\\\\Sheet-001.SC2Cutscene". */
const cutscenePath = (file: string): string => `"Cutscenes\\\\${file}"`;

function sheetScript(calls: readonly string[], pauseSeconds: number): string {
  return [
    "// Cinematic set contact sheet (generated by npm run contact-sheet). Each shot is announced by",
    '// saving bank "CsSheet" with key "stop", so a watcher outside the game can screenshot it.',
    'include "TriggerLibs/NativeLib"',
    "bank csBank;",
    "",
    "void Cs_Announce(int stop) {",
    "    // Data and library warnings print over everything in Test Document; clear them for the frame.",
    "    UIClearMessages(PlayerGroupAll(), c_messageAreaAll);",
    "    Wait(0.25, c_timeReal);",
    '    BankValueSetFromInt(csBank, "sheet", "stop", stop);',
    "    BankSave(csBank);",
    "}",
    "",
    "int csDialog;",
    "",
    "// Plays a cutscene in a full-screen dialog (how LotV plays its cinematics) and returns it.",
    "int Cs_Open(string file) {",
    "    int control;",
    "    int cs;",
    "    DialogCreate(500, 400, c_anchorCenter, 0, 0, true);",
    "    csDialog = DialogLastCreated();",
    "    DialogSetFullscreen(csDialog, true);",
    "    DialogSetImageVisible(csDialog, false);",
    "    DialogSetVisible(csDialog, PlayerGroupAll(), true);",
    "    DialogControlCreate(csDialog, c_triggerControlTypeCutscene);",
    "    control = DialogControlLastCreated();",
    "    DialogControlSetFullDialog(control, PlayerGroupAll(), true);",
    "    libNtve_gf_SetDialogItemCutscene(control, file, PlayerGroupAll());",
    "    libNtve_gf_SetDialogItemRenderType(control, c_triggerRenderTypeHDR, PlayerGroupAll());",
    "    cs = CutsceneGetTriggerControl(control);",
    "    CutscenePlay(cs);",
    "    return cs;",
    "}",
    "",
    "void Cs_Close(int cs) {",
    "    CutsceneStop(cs);",
    "    DialogDestroy(csDialog);",
    "}",
    "",
    "// A generated sheet cutscene: its cameras cut on a fixed schedule; announce each one.",
    "void Cs_Play(string file, int firstStop, int shots) {",
    "    int cs;",
    "    int k;",
    "    cs = Cs_Open(file);",
    `    Wait(${(LEAD_MS + 0.75 * SHOT_MS) / 1000}, c_timeReal);`,
    "    Cs_Announce(firstStop);",
    "    k = 1;",
    "    while (k < shots) {",
    `        Wait(${SHOT_MS / 1000}, c_timeReal);`,
    "        Cs_Announce(firstStop + k);",
    "        k += 1;",
    "    }",
    `    Wait(${(0.25 * SHOT_MS) / 1000}, c_timeReal);`,
    "    Cs_Close(cs);",
    "}",
    "",
    "// An original cutscene: jump to a moment, let it play into the shot, hold the frame, announce.",
    "void Cs_Shot(int cs, int ms, int stop) {",
    "    CutsceneSetTime(cs, ms);",
    "    CutscenePlay(cs);",
    `    Wait(${ORIGINAL_PLAY_MS / 1000}, c_timeReal);`,
    "    CutscenePause(cs);",
    `    Wait(${ORIGINAL_HOLD_MS / 1000}, c_timeReal);`,
    "    Cs_Announce(stop);",
    "}",
    "",
    "bool Cs_Run(bool testConds, bool runActions) {",
    "    int cs;",
    '    csBank = BankLoad("CsSheet", 1);',
    // Test Document's debug panel can't be hidden from a script; the pause gives time to hide it by hand.
    ...(pauseSeconds > 0
      ? [
          `    UIDisplayMessage(PlayerGroupAll(), c_messageAreaSubtitle, StringToText("Hide the debug panel now: the contact sheet starts in ${pauseSeconds} seconds."));`,
          `    Wait(${pauseSeconds}.0, c_timeReal);`,
          "    UIClearMessages(PlayerGroupAll(), c_messageAreaAll);",
        ]
      : []),
    // Not Story Mode, whose native only Blizzard's maps may call. Hide Game UI sets a full screen itself.
    "    libNtve_gf_HideGameUI(false, PlayerGroupAll());",
    "    UISetFrameVisible(PlayerGroupAll(), c_syncFrameTypeMenuBar, false);",
    "    UISetFrameVisible(PlayerGroupAll(), c_syncFrameTypeObjectivePanel, false);",
    "    // Test Document shows data warnings and library errors over everything: switch off the",
    "    // trigger-debug output that carries them, and the error panel.",
    "    TriggerDebugOutputEnable(false);",
    "    TriggerDebugWindowOpen(false);",
    "    UISetFrameVisible(PlayerGroupAll(), c_syncFrameTypeErrorDisplayPanel, false);",
    "    UISetCursorVisible(PlayerGroupAll(), false);",
    "    // Black out the world: the dialog's cutscene draws above it, so only the set shows.",
    "    CinematicFade(false, 0.0, c_fadeStyleNormal, Color(0, 0, 0), 0.0, true);",
    "    Wait(2.0, c_timeReal);",
    ...calls,
    "    Cs_Announce(-1);",
    "    return true;",
    "}",
    "",
    "void Cs_Init() {",
    '    TriggerAddEventMapInit(TriggerCreate("Cs_Run"));',
    "}",
    "",
  ].join("\n");
}

/** The sheet for `sets`, reading each set's richest file from `sources` (keyed by sourceKey). */
/** `pauseSeconds`: a wait before the sheet takes over the screen, to hide Test Document's debug panel by hand. */
export function buildContactSheet(sets: readonly CinematicSet[], sources: ReadonlyMap<string, CutsceneSource>, pauseSeconds = 0): ContactSheet {
  const cutscenes: SheetCutscene[] = [];
  const shots: SheetShot[] = [];
  const calls: string[] = [];
  sets.forEach((set, index) => {
    const occurrence = set.occurrences[0]!;
    const source = sources.get(sourceKey(occurrence.origin, occurrence.file));
    if (!source) throw new Error(`No source file for set ${set.id}: ${occurrence.origin}:${occurrence.file}`);
    const { xml, cameras } = setCutscene(set, source, index + 1);
    const file = `Sheet-${String(index + 1).padStart(3, "0")}.SC2Cutscene`;
    const firstStop = shots.length + 1;
    cutscenes.push({ file, setId: set.id, xml });
    cameras.forEach((camera, shot) => shots.push({ stop: firstStop + shot, setId: set.id, setName: set.name, shot, camera }));
    calls.push(`    Cs_Play(${cutscenePath(file)}, ${firstStop}, ${cameras.length});`);
  });
  return { cutscenes, shots, script: sheetScript(calls, pauseSeconds) };
}

/** One set's card cameras for the card sheet, with the pieces they keep: one sheet cutscene. */
/**
 * How a sheet cutscene is lit, where not as its set's file first lights it: `light` the base Light
 * (by default the first the file switches to), `lamps` which of the file's light nodes near the set
 * stay: all (the default), none, those within this many units of a camera's aim, or those the file
 * turns on for some of its cameras' shots (`shots`, the cameras' GUIDs).
 */
export type SheetLighting = { readonly light?: string; readonly lamps?: "all" | "none" | number | { readonly shots: readonly string[] } };

/** The cameras whose shots a lamp is on for (its Active Shot ties): Blizzard's story files light every shot with its own lamps. */
export const lampShots = (lamp: CutsceneNode): string[] =>
  lamp.children.filter((child) => child.tag === "CCutsceneNodeActiveShot").flatMap((child) => (child.attrs.cameraGUID ? [child.attrs.cameraGUID] : []));

/** `label` heads its shots' names; `lighting` names how it is lit, where the sheet films each card more than one way. */
export type CardSheetEntry = PieceFilter & SheetLighting & { readonly set: CinematicSet; readonly cameras: readonly CardShot[]; readonly label?: string; readonly lighting?: string };

/**
 * The card sheet: each entry's card cameras (card-cameras.ts) over its set's pieces and base Light,
 * played as the contact sheet plays its own. Each shot names the card it films again, so the frame
 * can be laid beside Blender's picture.
 */
export function buildCardSheet(entries: readonly CardSheetEntry[], sources: ReadonlyMap<string, CutsceneSource>, pauseSeconds = 0): ContactSheet {
  const cutscenes: SheetCutscene[] = [];
  const shots: SheetShot[] = [];
  const calls: string[] = [];
  const shotsOf = new Map<string, number>();
  entries.forEach((entry, index) => {
    const { set } = entry;
    const occurrence = set.occurrences[0]!;
    const source = sources.get(sourceKey(occurrence.origin, occurrence.file));
    if (!source) throw new Error(`No source file for set ${set.id}: ${occurrence.origin}:${occurrence.file}`);
    const { xml, cameras } = setCutscene(set, source, index + 1, entry);
    const file = `Card-${String(index + 1).padStart(3, "0")}.SC2Cutscene`;
    const firstStop = shots.length + 1;
    const before = shotsOf.get(set.id) ?? 0;
    cutscenes.push({ file, setId: set.id, xml });
    const head = entry.label ?? entry.lighting;
    cameras.forEach((camera, shot) =>
      shots.push({ stop: firstStop + shot, setId: set.id, setName: set.name, shot: before + shot, camera: head ? `${head}: ${camera}` : camera, card: entry.cameras[shot]!.card, ...(entry.lighting ? { lighting: entry.lighting } : {}) }),
    );
    shotsOf.set(set.id, before + cameras.length);
    calls.push(`    Cs_Play(${cutscenePath(file)}, ${firstStop}, ${cameras.length});`);
  });
  return { cutscenes, shots, script: sheetScript(calls, pauseSeconds) };
}

/** One cut in an original cutscene: when it starts and ends, and the camera it cuts to. */
type Cut = { readonly start: number; readonly end: number; readonly camera: string; readonly name: string };

/**
 * The moments to capture in one file that builds the set: up to ORIGINAL_SHOTS cuts to cameras that film
 * the set (distinct cameras first, spread through the file), never inside a fade to black, each
 * caught a beat after the cut so the shot has settled.
 */
export function originalMoments(occurrence: SetOccurrence, source: CutsceneSource): { readonly ms: number; readonly camera: string }[] {
  const root = readCutscene(source.xml);
  const all = (node: CutsceneNode): CutsceneNode[] => [node, ...node.children.flatMap(all)];
  const nodes = all(root);
  const byGuid = new Map(nodes.filter((node) => node.attrs.guid).map((node) => [node.attrs.guid!, node]));
  const time = (node: CutsceneNode, name: string): number => Number(node.attrs[name] ?? 0);
  const end = Math.max(0, ...nodes.filter((node) => node.attrs.duration).map((node) => time(node, "start") + time(node, "duration")));

  // Fades to black: from the end of a fade out until the next fade in has half finished.
  const fades = nodes.filter((node) => node.tag === "CCutsceneElementFade").sort((a, b) => time(a, "start") - time(b, "start"));
  const black: [number, number][] = [];
  let since: number | undefined;
  for (const fade of fades) {
    if (fade.attrs.fadeIn === "1") {
      black.push([since ?? 0, time(fade, "start") + time(fade, "duration") / 2]);
      since = undefined;
    } else since ??= time(fade, "start") + time(fade, "duration");
  }
  if (since !== undefined) black.push([since, Infinity]);
  const dark = (ms: number): boolean => black.some(([from, to]) => ms >= from && ms <= to);

  const starts = nodes.filter((node) => node.tag === "CCutsceneElementActiveCamera").sort((a, b) => time(a, "start") - time(b, "start"));
  const cuts: Cut[] = starts.map((node, index) => {
    const camera = node.attrs.objectGuid ?? node.attrs.objectGUID ?? "";
    return { start: time(node, "start"), end: index + 1 < starts.length ? time(starts[index + 1]!, "start") : end, camera, name: byGuid.get(camera)?.attrs.name ?? "camera" };
  });
  const filming = new Set(occurrence.cameras.map((camera) => camera.guid));
  const moment = (cut: Cut): number => cut.start + Math.max(0, Math.min((cut.end - cut.start) * 0.4, 1500) - ORIGINAL_PLAY_MS);
  // Files close on about 2 s of black before their End Scene marker (T8), which no fade element marks.
  const usable = cuts.filter(
    (cut) => cut.end - cut.start >= ORIGINAL_MIN_SHOT_MS && !dark(moment(cut) + ORIGINAL_PLAY_MS) && moment(cut) + ORIGINAL_PLAY_MS < end - ORIGINAL_TAIL_MS,
  );
  const ofSet = usable.filter((cut) => filming.has(cut.camera));
  const candidates = ofSet.length ? ofSet : usable;
  // Each camera once (its first usable cut), then spread evenly through the file.
  const seen = new Set<string>();
  const distinct = candidates.filter((cut) => !seen.has(cut.camera) && seen.add(cut.camera));
  const picked = distinct.length <= ORIGINAL_SHOTS ? distinct : Array.from({ length: ORIGINAL_SHOTS }, (_, k) => distinct[Math.round((k * (distinct.length - 1)) / (ORIGINAL_SHOTS - 1))]!);
  return picked.map((cut) => ({ ms: Math.round(moment(cut)), camera: cut.name }));
}

/**
 * The sheet from the sets' own cutscenes: each set's richest file that cuts to something, copied into the map as it is,
 * played and captured at its own cuts, under its own lights. Sets whose file has no usable cut are
 * left out (returned in `skipped`).
 */
export function buildOriginalSheet(
  sets: readonly CinematicSet[],
  sources: ReadonlyMap<string, CutsceneSource>,
  pauseSeconds = 0,
): ContactSheet & { readonly skipped: readonly string[] } {
  const cutscenes: SheetCutscene[] = [];
  const shots: SheetShot[] = [];
  const calls: string[] = [];
  const skipped: string[] = [];
  sets.forEach((set, index) => {
    // The richest file that actually cuts to something: templates and set files have no cuts.
    let found: { readonly source: CutsceneSource; readonly moments: readonly { readonly ms: number; readonly camera: string }[] } | undefined;
    for (const occurrence of set.occurrences) {
      const source = sources.get(sourceKey(occurrence.origin, occurrence.file));
      if (!source) throw new Error(`No source file for set ${set.id}: ${occurrence.origin}:${occurrence.file}`);
      const moments = originalMoments(occurrence, source);
      if (moments.length) {
        found = { source, moments };
        break;
      }
    }
    if (!found) {
      skipped.push(set.id);
      return;
    }
    const { source, moments } = found;
    const file = `Orig-${String(index + 1).padStart(3, "0")}.SC2Cutscene`;
    cutscenes.push({ file, setId: set.id, xml: source.xml });
    calls.push(`    cs = Cs_Open(${cutscenePath(file)});`, `    Wait(${LEAD_MS / 1000}, c_timeReal);`);
    for (const [shot, { ms, camera }] of moments.entries()) {
      const stop = shots.length + 1;
      shots.push({ stop, setId: set.id, setName: set.name, shot, camera });
      calls.push(`    Cs_Shot(cs, ${ms}, ${stop});`);
    }
    calls.push("    Cs_Close(cs);");
  });
  return { cutscenes, shots, script: sheetScript(calls, pauseSeconds), skipped };
}
