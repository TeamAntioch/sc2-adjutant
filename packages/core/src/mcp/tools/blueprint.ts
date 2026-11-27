// The Blueprint and editing tools: reading and editing a Mission's Blueprint and its Kept terrain, objects and triggers, syncing the Editor's changes back, previews and layout checks.

import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { type Edit, editMissionBlueprint, type EditResult, jsonPatchEdit, moveAnchorEdit, moveZoneEdit, setZonePolygonEdit } from "../../edit/edit-blueprint.js";
import { missionPaintRegion } from "../../edit/paint-region-edit.js";
import { JsonPatchOperationSchema, readPointer } from "../../edit/json-patch.js";
import { checkMissionLayout, formatLayoutReport } from "../../layout/check-mission.js";
import { CHECK_STATUSES } from "../../layout/checks.js";
import { missionCatalogFor } from "../../map/mission-catalog.js";
import { editKeptObjects, KeptEditSchema } from "../../map/edit-kept-objects.js";
import { formatSurvey, SURVEY_KINDS, surveyMission } from "../../map/survey.js";
import { KeptTriggerEditSchema, outlineKeptTrigger, tuneKeptTriggers } from "../../map/tune-kept-triggers.js";
import { BrushSchema, editKeptTerrain, needsConfirm, swapWrites } from "../../map/edit-kept-terrain.js";
import { AreaSchema } from "../../kept-terrain/area.js";
import { readWorkspaceMod } from "../../mods/workspace-mods.js";
import { FUNCTION_KINDS } from "../../domain/library-interface.js";
import { formatFunctionSearch, searchFunctions } from "../../mods/function-search.js";
import { gameTriggerLibraries } from "../../mods/library-galaxy.js";
import { librariesInReach } from "../../mods/library-reach.js";
import { DEFAULT_DEPENDENCIES } from "../../map/write-document-info-xml.js";
import { missionMapPackage } from "../../map/mission-package.js";
import { generateTerrain } from "../../map/generate-terrain.js";
import { formatIssue, missionBlueprintPath, parseMissionBlueprint, readRawBlueprint, validateMissionBlueprint, type Workspace } from "../../plugins/workspace.js";
import { copySkills, formatSkillCopy } from "../../plugins/plugin-skills.js";
import { renderSvgToPng } from "../../preview/render-png.js";
import { writePreview } from "../../preview/write-preview.js";
import { formatSyncReport, syncMission } from "../../sync/sync-mission.js";
import { AuthoringTriggerSchema } from "../../triggers/author-trigger.js";
import { writeBlueprintTriggerShowingChange } from "../../map/outline-diff.js";
import { outlineHeading, outlineTrigger } from "../../map/outline-trigger.js";
import { formatModSync, syncMod } from "../../mods/sync-mod.js";
import { realPathOf } from "../../util/inside.js";
import { writeTarget } from "../../util/replace-file.js";
import { MissionSchema, IssueSchema, PointSchema, MapSchema, plain } from "./schemas.js";
import { stageHint, insideWorkspace, existingMapPackage, defaultOutputDir, oneAtATime, readingMapToEdit } from "./mission-files.js";
import { editorHasOpen } from "./editor-handoff.js";
import { type CallContext } from "../call-context.js";
import { ADDITIVE, DESTRUCTIVE, READ_ONLY, toolGroup } from "./tool-group.js";

/** The tools registerBlueprintTools can register, the Blueprint group. */
export const BLUEPRINT_TOOLS = ["check_layout", "get_blueprint", "patch_blueprint", "set_zone_polygon", "move_zone", "move_anchor", "paint_region", "preview", "generate_terrain", "sync", "sync_mod", "edit_kept_objects", "survey", "outline_kept_trigger", "outline_trigger", "search_trigger_functions", "write_blueprint_trigger", "tune_kept_triggers", "edit_kept_terrain"] as const;

export function registerBlueprintTools(server: McpServer, ctx: CallContext): void {
  const tool = toolGroup(server, BLUEPRINT_TOOLS);
  tool(
    "check_layout",
    {
      title: "Check a Mission's layout",
      annotations: READ_ONLY,
      description:
        "Runs the level-design checker over a Mission's layout: routes, gating, entrances, travel times, safe havens, hazards and more. Advisory: each check passes, warns, informs or can't be evaluated yet, with its findings.",
      inputSchema: { mission: MissionSchema },
      outputSchema: {
        checks: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            source: z.string(),
            status: z.enum(CHECK_STATUSES),
            findings: z.array(z.string()),
          }),
        ),
      },
    },
    async ({ mission }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const { blueprint, checks } = await checkMissionLayout(workspace, blueprintPath);
      return ctx.reply([formatLayoutReport(blueprint.title, checks), await stageHint(blueprintPath)].join("\n"), { checks });
    },
  );

  tool(
    "get_blueprint",
    {
      title: "Read a Mission Blueprint",
      annotations: READ_ONLY,
      description:
        "Returns a Mission's Blueprint as stored (JSON, before defaults are filled in), or the part a JSON Pointer names, with any reasons it doesn't validate. Edit it with patch_blueprint, or with set_zone_polygon, move_zone, move_anchor and paint_region.",
      inputSchema: {
        mission: MissionSchema,
        pointer: z.string().optional().describe('A JSON Pointer to return only that part, such as "/zones/2" or "/mechanics"'),
      },
      outputSchema: { value: z.unknown(), issues: z.array(IssueSchema) },
    },
    async ({ mission, pointer }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const raw = await readRawBlueprint(blueprintPath);
      const value = pointer ? readPointer(raw, pointer) : raw;
      const validation = validateMissionBlueprint(workspace, raw, await missionCatalogFor(workspace.catalog, blueprintPath));
      const issues = validation.success ? [] : validation.issues;
      const lines = [JSON.stringify(value, null, 2), ...(issues.length ? ["", "The Blueprint doesn't validate:", ...issues.map((issue) => `- ${formatIssue(issue)}`)] : [])];
      return ctx.reply(lines.join("\n"), { value, issues: [...issues] });
    },
  );

  /** Runs `edit` on a Mission's Blueprint, one edit of a file at a time, and replies with what was saved or why not. */
  const editTool = (mission: string, edit: Edit) => savingTool(mission, (workspace, blueprintPath) => editMissionBlueprint(workspace, blueprintPath, edit));
  /** Runs a Blueprint edit that saves through editMissionBlueprint, as editTool does. */
  const savingTool = async (mission: string, run: (workspace: Workspace, blueprintPath: string) => Promise<EditResult>) => {
    const workspace = await ctx.workspace();
    const blueprintPath = await missionBlueprintPath(workspace, mission);
    const result = await oneAtATime(`edit:${await writeTarget(blueprintPath)}`, () => run(workspace, blueprintPath));
    if (!result.saved) return ctx.refused(blueprintPath, result.issues, {});
    const lines = [`Saved ${blueprintPath}.`, ...result.notes, await stageHint(blueprintPath)];
    return ctx.reply(lines.join("\n"), { saved: true, notes: [...result.notes], issues: [] });
  };
  const EditOutputSchema = { saved: z.boolean(), notes: z.array(z.string()), issues: z.array(IssueSchema) };

  tool(
    "patch_blueprint",
    {
      title: "Patch a Mission Blueprint",
      annotations: DESTRUCTIVE,
      description:
        "Applies a JSON Patch (RFC 6902) to a Mission's Blueprint and saves it if the result validates against core and every Mechanic the Workspace's Plugins provide. Otherwise nothing is saved and the reply gives each problem's path and reason. Paths are JSON Pointers into the stored Blueprint, as get_blueprint returns it.",
      inputSchema: { mission: MissionSchema, patch: z.array(JsonPatchOperationSchema).min(1).describe("The JSON Patch operations, applied in order: all or none") },
      outputSchema: EditOutputSchema,
    },
    ({ mission, patch }) => editTool(mission, jsonPatchEdit(patch)),
  );

  tool(
    "set_zone_polygon",
    {
      title: "Reshape a Zone",
      annotations: DESTRUCTIVE,
      description:
        "Replaces a Zone's polygon. Refused if a corner is off the map or the outline crosses itself. Reports any Anchor left outside its Zone.",
      inputSchema: { mission: MissionSchema, zone: z.string().min(1).describe("The Zone's id"), polygon: z.array(PointSchema).min(3).describe("The Zone's new outline: at least three corners, in cells, in order round it") },
      outputSchema: EditOutputSchema,
    },
    ({ mission, zone, polygon }) => editTool(mission, setZonePolygonEdit(zone, polygon)),
  );

  tool(
    "move_zone",
    {
      title: "Move a Zone",
      annotations: DESTRUCTIVE,
      description:
        "Moves a Zone by an offset in cells, with its Editor region and the Anchors in it. Crossing points of its Connections stay put, and the reply names them to check.",
      inputSchema: { mission: MissionSchema, zone: z.string().min(1).describe("The Zone's id"), dx: z.number().finite().describe("Cells to move it along the map's x axis"), dy: z.number().finite().describe("Cells to move it along the map's y axis") },
      outputSchema: EditOutputSchema,
    },
    ({ mission, zone, dx, dy }) => editTool(mission, moveZoneEdit(zone, dx, dy)),
  );

  tool(
    "move_anchor",
    {
      title: "Move an Anchor",
      annotations: DESTRUCTIVE,
      description:
        "Moves an Anchor to a point. It keeps its Zone if that still holds the point, else takes the one that does (the last listed, as the terrain paints them), unless a Zone is given. A camera Anchor's target moves with it.",
      inputSchema: {
        mission: MissionSchema,
        anchor: z.string().min(1).describe("The Anchor's id"),
        position: PointSchema.extend({ z: z.number().finite().nullable().optional().describe("Height offset, as the Editor's; null clears it") }).describe("Where to put it, in cells"),
        zone: z.string().min(1).optional().describe("The Zone to put it in, instead of the one holding the point"),
      },
      outputSchema: EditOutputSchema,
    },
    ({ mission, anchor, position, zone }) => editTool(mission, moveAnchorEdit(anchor, position, zone)),
  );

  const box = (what: string) => z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).describe(what);
  tool(
    "paint_region",
    {
      title: "Write a Paint Region",
      annotations: DESTRUCTIVE,
      description:
        "Adds a Paint Region to a Mission's Blueprint, or edits one (ADR-0028): a polygon whose texture mix overrides its Zones' palette inside it, feathered at its edge. Its outline comes from one of: zone, a Zone's polygon (the region follows the Zone); rect, a rectangle of cells; or frame, a box on a Still Review frame from capture_shots, turned into cells through that Shot's camera in shots.json on flat ground at the camera target's height, and clipped to the map. Each mix entry gives a texture a blend weight (that fraction of its layer in every cell), an area share (patches over about that fraction of the region), or nothing (it takes what the others leave; at most one). Weights and shares together are at most 1. Editing an existing region, leave out what stays: its outline, mix, falloff or levels. The mix is checked before anything is saved: each texture must be in the texture set of every cell the region paints (beside Kept ground, the set the Map Package has the cells' blocks on). Compile, then texture_usage measures each region's textures as painted beside what it asked.",
      inputSchema: {
        mission: MissionSchema,
        id: z.string().min(1).describe("The Paint Region's id: a new one adds it"),
        zone: z.string().min(1).optional().describe("Outline: this Zone's polygon"),
        rect: box("Outline: [left, bottom, right, top], in cells").optional(),
        frame: z
          .object({
            capture: z.string().min(1).describe("The capture: its name (its folder in the Mission's output/shots), or the path of its shots.json from the Mission's folder"),
            shot: z.union([z.number().int().min(1), z.string().min(1)]).describe("The Shot: its number, or its label"),
            box: box("[left, top, right, bottom] on the frame, as fractions of its width and height from its top-left corner (0..1)"),
          })
          .strict()
          .optional()
          .describe("Outline: a box marked on a Still Review frame"),
        mix: z
          .array(
            z
              .object({
                texture: z.string().min(1).describe("A texture of the region's texture set"),
                weight: z.number().gt(0).max(1).optional().describe("Blend weight: that fraction of its layer in every cell"),
                share: z.number().gt(0).max(1).optional().describe("Area share: patches over about that fraction of the region"),
              })
              .strict(),
          )
          .min(1)
          .max(8)
          .optional()
          .describe("The textures and their amounts; a new region needs one"),
        falloff: z.number().min(0).nullable().optional().describe("Cells inward over which the mix fades in: 2 by default, 0 a hard edge; null removes it"),
        levels: z.array(z.number().int().min(0).max(15)).min(1).nullable().optional().describe("The cliff levels it paints; null paints every level"),
      },
      outputSchema: EditOutputSchema,
    },
    ({ mission, ...request }) => savingTool(mission, (workspace, blueprintPath) => missionPaintRegion(workspace, blueprintPath, request)),
  );

  tool(
    "preview",
    {
      title: "Preview a Mission's sketch",
      annotations: ADDITIVE,
      description:
        "Draws a Mission's layout (Zones by level, Connections, ramps, Anchors, Mechanic areas) as the shared sketch, returned as a PNG image. Also writes the SVG beside the Blueprint as preview.svg, the Mission's map of record.",
      inputSchema: { mission: MissionSchema },
    },
    async ({ mission }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const blueprint = await parseMissionBlueprint(workspace, blueprintPath);
      const { svg, svgPath, unplaced } = await writePreview(blueprint, blueprintPath);
      const lines = [
        `Preview of ${blueprint.title}, also written to ${svgPath}.`,
        ...unplaced.map((message) => `Not placed: ${message}`),
        await stageHint(blueprintPath),
      ];
      return {
        content: [
          { type: "image", data: (await renderSvgToPng(svg)).toString("base64"), mimeType: "image/png" },
          { type: "text", text: lines.join("\n") },
        ],
      };
    },
  );

  tool(
    "generate_terrain",
    {
      title: "Generate a Mission's terrain",
      annotations: DESTRUCTIVE,
      description:
        "Writes a Mission's terrain alone (heights, cliffs, ramps, textures and lighting) as a Map Package, with no objects, regions or triggers, to look at the ground before the rest is placed. Returns where it wrote the package and any warnings.",
      inputSchema: {
        mission: MissionSchema,
        outputDir: z
          .string()
          .min(1)
          .optional()
          .describe("Where to write the Map Package: a folder inside the Workspace, relative to its root. By default <mission folder>/output/<mission>-terrain.SC2Map, a folder git ignores"),
      },
      outputSchema: { outputDir: z.string(), warnings: z.array(z.string()) },
    },
    async ({ mission, outputDir }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const target = outputDir ? await insideWorkspace(workspace.root, outputDir) : await defaultOutputDir(blueprintPath, `${mission}-terrain`);
      const { blueprint, warnings } = await oneAtATime(await realPathOf(target), () => generateTerrain(workspace, blueprintPath, target));
      const lines = [`Terrain of ${blueprint.title} generated in ${target}`, ...warnings.map((warning) => `Warning: ${warning}`), await stageHint(blueprintPath)];
      return ctx.reply(lines.join("\n"), { outputDir: target, warnings: [...warnings] });
    },
  );

  tool(
    "sync",
    {
      title: "Sync Editor changes into a Blueprint",
      annotations: DESTRUCTIVE,
      description:
        "Reads a Map Package compiled from a Mission and saved in the Galaxy Editor, and syncs what the author changed there back into the Blueprint: doodads moved, edited, added or deleted; units, points and cameras; regions; and on a generated map, ground raised or lowered (terrainEdits.heights), water areas drawn, moved or deleted (water pools with a rect), and the pathing brush's paint and erasing over what the compile paints under dug pools and solid doodads (pathingPaint, a stroke near a doodad kept relative to it; docs/reference/doodad-pathing.md). Cliff-level changes and texture paint are listed as not synced. In the Mission's own package only Compiled Content on its compile record comes back: an object or region the author made there is Kept Content and stays where it lies, except a doodad standing on ground the compile writes (a generating Zone's, or any Zone's on a generated map), which becomes an Anchor at its own Editor Id (editorId), so the compile takes it over where it stands. Beside Kept ground, objects and regions sync only from the Mission's own package with a compile record, against the ground and dressing the compile writes there; the Zones' hidden cells sync there too. Run it after each Editor save, before changing the Blueprint again. The Blueprint is saved only if it still validates. Editor settings the Blueprint can't keep are listed, not kept. It also copies the skills of the Plugins the Workspace lists into its .claude/skills/, as the Claude Code plugin's SessionStart hook does, so a Plugin listed since the session started brings its skills.",
      inputSchema: { mission: MissionSchema, map: MapSchema },
      outputSchema: {
        saved: z.boolean(),
        changes: z.array(z.object({ label: z.string(), ids: z.array(z.string()) })),
        notes: z.array(z.object({ label: z.string(), items: z.array(z.string()) })),
        issues: z.array(IssueSchema),
      },
    },
    async ({ mission, map }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const mapPath = await existingMapPackage(workspace.root, blueprintPath, map);
      const result = await readingMapToEdit(mapPath, blueprintPath, () => syncMission(workspace, blueprintPath, mapPath));
      // As the SessionStart hook does, so a Plugin listed mid-session brings its skills (ADR-0023).
      const skills = formatSkillCopy(await copySkills(workspace.root, workspace.registry.contributions("skills")));
      const changes = result.changes.map(({ label, ids }) => ({ label, ids: [...ids] }));
      const notes = result.notes.map(({ label, items }) => ({ label, items: [...items] }));
      if (result.edit && !result.edit.saved) return ctx.refused(blueprintPath, result.edit.issues, { changes, notes }, ["These changes were not saved:", ...formatSyncReport(result, mapPath), ...skills]);
      const lines = [...formatSyncReport(result, mapPath), ...(result.edit?.saved ? result.edit.notes : []), ...skills, await stageHint(blueprintPath)];
      return ctx.reply(lines.join("\n"), { saved: result.edit?.saved ?? false, changes, notes, issues: [] });
    },
  );

  tool(
    "sync_mod",
    {
      title: "Sync Editor changes into a Mod Blueprint",
      annotations: DESTRUCTIVE,
      description:
        "Brings what the author changed in the Editor in a Campaign Mod's package back into its Mod Blueprint: for now its Set cutscenes (setCutscenes). Each one saved since the last compile is imported again, as import_set reads a set, into the Set it was written from, in the Set's own frame and keeping what no cutscene holds (piece ids, a camera that moves, the Set's name and provenance); the compile record then takes the saved file as the compile's, so compile_mod writes the Set over it. Run it when compile_mod stops on a Set cutscene the Editor changed, then compile again.",
      inputSchema: { mod: z.string().min(1).describe("The mod's id, as the Workspace config's mods names it (its folder in mods/)") },
      outputSchema: { synced: z.array(z.object({ cutscene: z.string(), set: z.string(), notes: z.array(z.string()) })) },
    },
    async ({ mod }) => {
      const workspace = await ctx.workspace();
      const { blueprintPath } = await readWorkspaceMod(workspace, mod);
      const result = await oneAtATime(await realPathOf(path.dirname(blueprintPath)), () => syncMod(blueprintPath, workspace));
      const relative = (file: string) => path.relative(workspace.root, path.join(path.dirname(blueprintPath), file)).split(path.sep).join("/");
      const synced = result.synced.map((entry) => ({ ...entry, set: relative(entry.set), notes: [...entry.notes] }));
      return ctx.reply(formatModSync(result, relative).join("\n"), { synced });
    },
  );

  tool(
    "edit_kept_objects",
    {
      title: "Edit Kept objects and regions",
      annotations: DESTRUCTIVE,
      description:
        "Edits Kept Content in the Mission's own Map Package (ADR-0010), changing only the elements it touches in Objects and Regions, so every other byte stays as the Editor wrote it. Doodads: move, rotate, tilt, scale, tint (null clears it), swap (type, variation), add (with at.z, or like: a doodad whose height and flags it takes) and remove. Units, points and cameras: move (a camera's target moves with it), rotate (a camera's yaw too), rename (points and cameras) and flags (set or clear Editor flags, such as UnitHidden). Regions: move, resize about the centre of their bounds, and redraw with new shapes. An object is named by its Editor Id, or a Kept unit, point or camera by its Kept Reference id; a region by its id or Kept Reference id. Angles are degrees. The edits apply in order, and all are checked before anything is written: one that names Compiled Content (on the compile record) is refused with the Blueprint field to change instead, and nothing is written while the Editor has the map open (when the Host Adapter can tell). A moved doodad keeps its height unless given z.",
      inputSchema: {
        mission: MissionSchema,
        edits: z.array(KeptEditSchema).min(1).describe("The edits, applied in order, each { op, object | region, ... }"),
      },
      outputSchema: { changed: z.array(z.string()), warnings: z.array(z.string()), files: z.array(z.string()) },
    },
    async ({ mission, edits }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const mapPackage = await missionMapPackage(blueprintPath);
      // Checked here for the author's steps; editKeptObjects asks again just before it writes.
      const open = await editorHasOpen(ctx.host, mapPackage, "edit_kept_objects", "Not edited");
      if (open) return ctx.fail(open.text);
      // One writer at a time per package, as the compile tools.
      const result = await oneAtATime(await realPathOf(mapPackage), () => editKeptObjects(workspace, blueprintPath, edits, { host: ctx.host }));
      const where = path.relative(workspace.root, result.mapPackage).split(path.sep).join("/");
      const lines = [...result.changed, ...result.warnings.map((warning) => `warning: ${warning}`), result.files.length ? `Wrote ${result.files.join(" and ")} in ${where}` : "Nothing changed"];
      return ctx.reply(lines.join("\n"), { changed: [...result.changed], warnings: [...result.warnings], files: [...result.files] });
    },
  );

  tool(
    "survey",
    {
      title: "Survey Kept Content",
      annotations: READ_ONLY,
      description:
        "Lists what the Mission's own Map Package holds (ADR-0010), read from the package each time and never stored, with anything on the compile record marked [Compiled] and everything else Kept Content: units, points and cameras with Editor Id, type, player and position; doodads counted by type, with named ones listed; regions with their shapes; triggers by category, with their events as MapScript.galaxy adds them and the functions, structs and globals filed beside them; cutscenes with the conversation lines each plays, in order; conversations with their line count; and map-local catalog entries by GameData file. Use it to talk about an imported map by name, and to find the Editor Ids a Kept Reference or edit_kept_objects needs.",
      inputSchema: {
        mission: MissionSchema,
        kinds: z.array(z.enum(SURVEY_KINDS)).min(1).optional().describe("Only these kinds; by default every kind, or with an area every kind with a place (unit, point, camera, doodad, region)"),
        area: z
          .string()
          .min(1)
          .optional()
          .describe("Only what lies in this area: x0,y0,x1,y1, or a region's name or id (its bounds). Every doodad in it is listed one by one; kinds without a place are left out unless kinds names them"),
      },
    },
    async ({ mission, kinds, area }) => {
      const workspace = await ctx.workspace();
      const survey = await surveyMission(await missionBlueprintPath(workspace, mission), { ...(kinds ? { kinds } : {}), ...(area ? { area } : {}) });
      return ctx.reply(formatSurvey(survey).join("\n"));
    },
  );

  tool(
    "outline_kept_trigger",
    {
      title: "Outline a Kept trigger",
      annotations: READ_ONLY,
      description:
        "Lists a Kept trigger's or function's calls and parameters with their element Ids and current Galaxy values, to pick what tune_kept_triggers changes, and says whether it can be tuned here (every function and preset it uses in the trigger catalog, and the script's Galaxy for it the Editor's) or why not. The trigger is named by its name, its element Id or its Kept Reference id. To read a trigger in the Editor's terms, to edit and write it, use outline_trigger.",
      inputSchema: { mission: MissionSchema, trigger: z.string().min(1).describe("The trigger's or function's name, element Id or Kept Reference id") },
      outputSchema: { outline: z.string(), tunable: z.boolean(), reason: z.string().optional() },
    },
    async ({ mission, trigger }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const result = await outlineKeptTrigger(workspace, blueprintPath, trigger);
      return ctx.reply([result.outline, ...(result.reason ? [result.reason] : [])].join("\n"), { ...result });
    },
  );

  tool(
    "outline_trigger",
    {
      title: "Outline a trigger in the Editor's terms",
      annotations: READ_ONLY,
      description:
        "Reads one of a Mission's triggers, Kept in its Map Package or the Blueprint's own, back as write_blueprint_trigger's input: each function, parameter, block, preset value, global, member, trigger and type by the name the Editor shows it where that name settles on it, else by its reference, and each literal as a number, true/false or its text where it can be. The outline is the same whichever owns the trigger, so a Kept one reads as it will once converted. A Blueprint trigger's outline, edited or not, is given to write_blueprint_trigger to rewrite it (unchanged, it writes the same file); a Kept one is converted with convert_triggers first. What the input can't express is listed by place. The trigger is named by its name or element Id.",
      inputSchema: { mission: MissionSchema, trigger: z.string().min(1).describe("The trigger's name or element Id") },
      outputSchema: {
        name: z.string(),
        id: z.string(),
        owner: z.enum(["Kept", "Blueprint"]),
        file: z.string().optional(),
        trigger: z.record(z.string(), z.unknown()).describe("write_blueprint_trigger's input"),
        unwritable: z.array(z.string()),
        text: z.string(),
      },
    },
    async ({ mission, trigger }) => {
      const workspace = await ctx.workspace();
      const outline = await outlineTrigger(workspace, await missionBlueprintPath(workspace, mission), trigger);
      return ctx.reply([outlineHeading(outline), outline.text].join("\n"), { ...outline });
    },
  );

  tool(
    "search_trigger_functions",
    {
      title: "Search trigger functions",
      annotations: READ_ONLY,
      description:
        "Searches the trigger functions in reach of a Mission (the game's libraries and those of the mods its dependencies load) or, without one, the game's: by words of the name or identifier, category, kind (action, function, condition, event), the types of parameter it takes and its return type, each type by the Editor's name (Unit Group) or its own (unitgroup). Each hit is given as the Editor's function list shows it: its name, library, category, kind, parameters' names and types, return type and hint. Ids only when `ids` is set.",
      inputSchema: {
        mission: MissionSchema.optional(),
        text: z.string().min(1).optional().describe("Words each found in the function's name or identifier"),
        category: z.string().min(1).optional().describe("Words found in its category (Unit Group > Groups)"),
        kind: z.enum(FUNCTION_KINDS).optional().describe("Its kind: action, function, condition or event"),
        takes: z.array(z.string().min(1)).optional().describe("Types it takes a parameter of, each"),
        returns: z.string().min(1).optional().describe("Its return type"),
        library: z.string().min(1).optional().describe("Its library, by id (Ntve) or name (Built-In)"),
        limit: z.number().int().positive().max(200).optional().describe("Hits given at most (25 by default)"),
        ids: z.boolean().optional().describe("Give each function's and parameter's Id (<library>/<id>)"),
      },
      outputSchema: {
        hits: z.array(
          z.object({
            id: z.string().optional(),
            name: z.string(),
            library: z.string(),
            libraryName: z.string().optional(),
            category: z.string().optional(),
            kind: z.enum(FUNCTION_KINDS),
            identifier: z.string(),
            parameters: z.array(z.object({ id: z.string().optional(), name: z.string(), type: z.string() })),
            returns: z.string().optional(),
            hint: z.string().optional(),
          }),
        ),
        total: z.number(),
        refused: z.array(z.object({ library: z.string(), why: z.string() })),
      },
    },
    async ({ mission, ...query }) => {
      const workspace = await ctx.workspace();
      const libraries = mission === undefined ? gameTriggerLibraries() : await librariesInReach(workspace, (await parseMissionBlueprint(workspace, await missionBlueprintPath(workspace, mission))).dependencies ?? DEFAULT_DEPENDENCIES);
      const found = searchFunctions(libraries, query);
      return ctx.reply(formatFunctionSearch(found), plain(found));
    },
  );

  tool(
    "write_blueprint_trigger",
    {
      title: "Write a Blueprint trigger",
      annotations: DESTRUCTIVE,
      description:
        "Writes one of the Mission Blueprint's own triggers (ADR-0026) from calls given in the Editor's terms, or rewrites the Blueprint trigger of that name (or of `id`, to rename it). A call is { function, library?, params?, blocks?, disabled? }: the function by its name as the Editor shows it (Periodic Event), its identifier (TriggerAddEventTimePeriodic) or <library>/<id>, with library (Ntve or Built-In, or map for the map's own) only when the name is ambiguous (where functions share a name, the one whose kind fits where the call stands is taken); params by parameter name (or by <library>/<id> where two share a name), each left out taking the default a new call gets in the Editor (a text's words too), null leaving it unset in a disabled statement, a list giving a parameter its template repeats (Combine Text Multiple's Text) each value; blocks by slot name (If, Then, Else), each a list of statements, in the order given. A value is a number, true/false, or a string read by the parameter's type (a preset value's name such as Game Time, the map's own too, a text's words, a String, a trigger's name, a game link's id); or { function, … } for a call's value, { preset } (a library's or the map's preset value by name or reference), { bits: [value names], preset? } for a set of bits (preset naming its bits preset type where the parameter takes any), { variable, library?, index?, member? } (a local, a Blueprint or Kept global, or a library's global, by name or reference; member a structure's member by name), { trigger }, { text }, { value?, type, gameType?, valueId?, typeInfo?, context? } for a literal as the Editor writes it (valueId a placed unit's, point's or region's number), { expression, type, slots? } for an Arithmetic or Expression value (type Integer, Real, String or Text; expression its text with ~<code>~ slots, a Text one's words; slots each code's value), { customScript, type? }. A statement is a call, { comment } or { customScript } (Galaxy text, written only where asked for); events may hold comments. The trigger is { name, id?, initiallyOff?, disabled?, identifier?, label?, section?, variables?: [{ name, type (Unit Group, or a preset type's name), value?, array?, constant?, identifier? }], events, conditions, actions }. Each value is checked against its parameter's type, and every name against the libraries in reach and the map's own; an unknown, ambiguous or wrongly typed one is refused in the Editor's terms, and nothing is written. When no game function does the job, the refusal says so: write custom script only where the mapper asks, and offer a Missing-Feature Report (report-missing-feature). outline_trigger reads a trigger back in this form, to edit and rewrite. Rewriting keeps the trigger's Id, its locals' and every unchanged call's, and returns the rewrite as the trigger after it in the Editor's form (each call by its function's name and every argument, one to a line, a block's statements under its slot's name) with each line it changed marked: \"← new\", \"← was: <the old line>\" or \"← remove\" (a removed line stays in its place), to show the mapper before and after in the Editor's form. Writes missions/<id>/triggers/<name>.json and lists it in the Blueprint's triggers; compile_map writes it into the Map Package.",
      inputSchema: {
        mission: MissionSchema,
        trigger: AuthoringTriggerSchema.describe("The trigger: { name, id?, initiallyOff?, disabled?, identifier?, section?, variables?, events, conditions, actions }, its calls in the Editor's terms"),
      },
      outputSchema: { name: z.string(), id: z.string(), file: z.string(), created: z.boolean(), calls: z.number(), keptCalls: z.number(), diff: z.string().optional() },
    },
    async ({ mission, trigger }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const { written, diff } = await writeBlueprintTriggerShowingChange(workspace, blueprintPath, trigger);
      const kept = written.created ? "" : `, ${written.keptCalls} of its ${written.calls} calls keeping their Ids`;
      return ctx.reply([`${written.created ? "Wrote" : "Rewrote"} the trigger ${written.name} (${written.id}) to ${written.file}${kept}. Compile the Mission to write it into the Map Package.`, ...(diff ? [diff] : [])].join("\n"), { ...written, ...(diff ? { diff } : {}) });
    },
  );

  tool(
    "tune_kept_triggers",
    {
      title: "Tune Kept triggers",
      annotations: DESTRUCTIVE,
      description:
        "Tunes Kept triggers and functions in the Mission's own Map Package (ADR-0010), changing each one's XML in Triggers and its Galaxy in MapScript.galaxy together, so Test Document runs the change without an Editor save. Edits, applied in order: set (a parameter's value in the form it has: a number, true/false or text; { preset: \"<library>/<id>\" }; { id } for a placed unit, point, region or camera; { trigger } for a trigger), remove (a call or comment) and copy (a call, after itself or `after`, with `set` giving the copy's parameters new values by the copied parameters' Ids). Ids come from outline_kept_trigger. A trigger is refused, naming each function or preset by library and id, unless the trigger catalog knows every one it uses; then edit it in the Editor and save there. It is refused too when the script's Galaxy for it isn't the Editor's for its XML (save in the Editor first), when it is Compiled Content, and while the Editor has the map open. All edits are checked before anything is written. dryRun checks and applies every edit in memory, writes nothing (so it runs with the Editor having the map open) and returns, for each trigger edited, the trigger after the edits in the Editor's form (each call by its function's name and every argument, one to a line, a block's statements under its slot's name) with each line they changed marked: \"← new\", \"← was: <the old line>\" or \"← remove\" (a removed line stays in its place), to show the mapper before and after in the Editor's form; a function has none, and a trigger the Editor's form can't read says why.",
      inputSchema: {
        mission: MissionSchema,
        edits: z.array(KeptTriggerEditSchema).min(1).describe("The edits, applied in order, each { op, trigger, ... }"),
        dryRun: z.boolean().optional().describe("Check and apply the edits in memory and return each trigger's change in the Editor's form, writing nothing"),
      },
      outputSchema: { changed: z.array(z.string()), files: z.array(z.string()), diffs: z.array(z.object({ trigger: z.string(), diff: z.string() })).optional() },
    },
    async ({ mission, edits, dryRun }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const mapPackage = await missionMapPackage(blueprintPath);
      if (!dryRun) {
        const open = await editorHasOpen(ctx.host, mapPackage, "tune_kept_triggers", "Not tuned");
        if (open) return ctx.fail(open.text);
      }
      const result = await oneAtATime(await realPathOf(mapPackage), () => tuneKeptTriggers(workspace, blueprintPath, edits, { host: ctx.host, ...(dryRun ? { dryRun } : {}) }));
      const where = path.relative(workspace.root, result.mapPackage).split(path.sep).join("/");
      const lines = dryRun ? [...result.changed, "Dry run: nothing written", ...(result.diffs ?? []).map(({ diff }) => diff)] : [...result.changed, result.files.length ? `Wrote ${result.files.join(", ")} in ${where}` : "Nothing changed"];
      return ctx.reply(lines.join("\n"), { changed: [...result.changed], files: [...result.files], ...(result.diffs ? { diffs: result.diffs.map((each) => ({ ...each })) } : {}) });
    },
  );

  tool(
    "edit_kept_terrain",
    {
      title: "Edit Kept terrain",
      annotations: DESTRUCTIVE,
      description:
        "Edits the heights, cliffs, ramps, textures and painted pathing of the Mission's Kept ground, in its own Map Package (ADR-0010). The area is a Kept region ({ region }: Editor id, Kept Reference id or name), a point and a radius ({ point, radius }: a point's Editor Id, Kept Reference id or name, or { x, y }), a rectangle of cells ({ rect: { x, y, width, height } }) or a polygon ({ polygon }), with a falloff: \"soft\" (the default, 3 cells), \"sharp\" or a width in cells. Height brushes: raise / lower { by } in height units (a cliff level is 2), flatten { to: \"mean\" (the default) | a height | { at: point } }, smooth { passes }. They change the height map's base layer, so cliffs keep their height: only t3HeightMap and t3SyncHeightMap change, vertex by vertex. Cliff brushes: raise-cliff / lower-cliff { cliffSet? } move every corner of the 2-cell cliff grid inside the area one level (no falloff), with new cliffs in the set painted on each cell or the one named from the map's cliff sets. add-ramp { at, uphill, low, high, narrow?, cliffSet? } stamps one of the generator's stock ramps (straight for north/south/east/west: at is the middle of its top edge; diagonal: at is the corner it cuts), refused unless the ground there is the generator's edge from low to high = low + 1. remove-ramp { at } takes out the stock ramp nearest a point. A ramp brush takes no area: its footprint is the area. Cliff and ramp edits also write t3SyncCliffLevel, t3CellFlags and t3Terrain.xml, and reset t3VertCol's static shadow bake: the author then rebakes, Data > Generate Static Shadows (Cmd-Shift-L) in the Editor. Paint brushes: paint { texture } paints the area with one of the map's textures (its name, or its slot: 0-7 in set 0, 8s to 8s+7 in texture set s), feathered in t3TextureMasks over the falloff, and gives each changed cell its dominant texture in t3SyncTextureInfo; a texture the map lacks is refused, naming its textures. On a map with several texture sets (one per 8×8-cell block) a stroke paints only blocks whose set holds the texture, leaving 2 texels each side of a boundary between sets, as the Editor does, and names the blocks it left. swap-slot { slot, texture } (no area) puts another texture in a slot map-wide, changing the look of every cell painted with it (at most 16 different textures a map): without confirm it only renders the cells the slot covers, map-wide (area.png), for the author to see; with confirm: true, after the author's yes, it writes t3Terrain.xml's texture list and t3SyncTextureInfo's names. set-blocks { set } (index or name) moves the 8×8-cell blocks the area touches onto another texture set, as the Editor's Texture Set brush: each texel keeps its weights, so its textures swap slot for slot. Without confirm it only renders the blocks before and after; with confirm: true it writes their tileSet in t3Terrain.xml and their cells' set in t3SyncTextureInfo. clear-slot { slot } (no area) empties a slot (its number, or the name of the texture in it) to make room under the 16, writing its name as \"\" in t3Terrain.xml's texture list and t3SyncTextureInfo's names, as the Editor writes an empty slot; it is refused, naming the cells, while any cell of the slot's set has weight on its layer or has it as its sync texture, so it changes no cell's look and needs no confirm, and refused, naming the Zones, while a generating Zone the next compile paints from that set names its texture. A slot of a texture set of the Blueprint's (textureSets) is Compiled Content, for swap-slot and clear-slot alike: change the set in the Blueprint instead. The other paint brushes warn where a texture touches itself across a boundary between sets, which the Editor renders with glitches. Pathing brushes: block-pathing paints the area's cells unpathable, and clear-pathing clears their paint so they're pathable again, in CellAttribute_Pnp (the Editor's pathing brush layer), whole cells with no falloff (leave falloff out, or \"sharp\"). Only the paint changes: cliffs and doodad footprints still block. Objects changes when Kept doodads on the changed cells move with the ground (leaveDoodads leaves them). Writes an area render (confirm it shows the right ground), and before, after and difference renders, to missions/<id>/renders/<name>/; clear-slot, which changes no cell's look, renders nothing. dryRun renders and reports without writing the package: use it to confirm the area first. Refused on cells the compile record lists (naming the Blueprint field) and while the Editor has the map open. To look at the edits in game, when the author asks or after a batch, run `npm run capture-edit -- <blueprint.json> <edit.json>...` in sc2-adjutant: a camera tour of each area on a copy, frames in the research archive (it takes minutes, and needs the Host Adapter's editor.captureTour).",
      inputSchema: {
        mission: MissionSchema,
        area: AreaSchema.optional().describe("Where to edit; left out for add-ramp, remove-ramp, swap-slot and clear-slot"),
        brush: BrushSchema,
        leaveDoodads: z.boolean().optional().describe("Leave Kept doodads at their heights, to bury one on purpose"),
        dryRun: z.boolean().optional().describe("Render and report the edit, writing nothing to the package"),
        name: z.string().regex(/^[\w.-]+$/).optional().describe("The renders' folder under renders/; by default the brush and the time"),
        confirm: z.boolean().optional().describe("swap-slot and set-blocks only: the author's yes, given after seeing the slot's reach in area.png or the blocks in before.png and after.png"),
      },
      outputSchema: {
        cells: z.number().int(),
        cliffCells: z.number().int().optional(),
        texels: z.number().int().optional(),
        legend: z.record(z.string(), z.string()).optional(),
        change: z.object({ min: z.number(), max: z.number() }),
        doodads: z.array(z.object({ id: z.number().int(), type: z.string(), by: z.number() })),
        warnings: z.array(z.string()),
        files: z.array(z.string()),
        removed: z.array(z.string()).optional(),
        renders: z.object({ area: z.string(), before: z.string(), after: z.string(), difference: z.string() }).optional(),
      },
    },
    async ({ mission, area, brush, leaveDoodads, dryRun, name, confirm }) => {
      const workspace = await ctx.workspace();
      const blueprintPath = await missionBlueprintPath(workspace, mission);
      const mapPackage = await missionMapPackage(blueprintPath);
      // A slot swap or block move without confirm only renders, so it may run with the map open.
      if (needsConfirm(brush) ? swapWrites({ dryRun, confirm }) : !dryRun) {
        // Checked here for the author's steps; editKeptTerrain asks again just before it writes.
        const open = await editorHasOpen(ctx.host, mapPackage, "edit_kept_terrain", "Not edited");
        if (open) return ctx.fail(open.text);
      }
      // One writer at a time per package, as the compile tools.
      const result = await oneAtATime(await realPathOf(mapPackage), () =>
        editKeptTerrain(workspace, blueprintPath, { ...(area ? { area } : {}), brush }, { host: ctx.host, ...(leaveDoodads ? { leaveDoodads } : {}), ...(dryRun ? { dryRun } : {}), ...(name ? { name } : {}), ...(confirm ? { confirm } : {}) }),
      );
      const relative = (file: string) => path.relative(workspace.root, file).split(path.sep).join("/");
      const renders = result.renders && { area: relative(result.renders.area), before: relative(result.renders.before), after: relative(result.renders.after), difference: relative(result.renders.difference) };
      const lines = [
        result.summary,
        ...result.warnings.map((warning) => `warning: ${warning}`),
        result.files.length ? `Wrote ${result.files.join(", ")} in ${relative(result.mapPackage)}` : result.removed?.length ? `Removed ${result.removed.join(", ")} from ${relative(result.mapPackage)}` : "Nothing written",
        ...(renders ? [`Renders: ${path.posix.dirname(renders.area)}/ (area.png, before.png, after.png, difference.png)`] : []),
        ...(result.legend ? [`Colours: ${Object.entries(result.legend).map(([texture, colour]) => `${texture} ${colour}`).join(", ")}`] : []),
      ];
      return ctx.reply(lines.join("\n"), {
          cells: result.cells,
          ...(result.cliffCells === undefined ? {} : { cliffCells: result.cliffCells }),
          ...(result.texels === undefined ? {} : { texels: result.texels }),
          ...(result.legend === undefined ? {} : { legend: { ...result.legend } }),
          change: result.change, doodads: [...result.doodads], warnings: [...result.warnings], files: [...result.files], ...(result.removed ? { removed: [...result.removed] } : {}), ...(renders ? { renders } : {}) });
    },
  );
}
