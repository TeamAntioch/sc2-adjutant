import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { NO_CHARACTERS } from "../../src/mods/characters.js";
import { EMPTY_REGISTRY } from "../../src/plugins/plugin-api.js";
import { readMissionBlueprint } from "../../src/plugins/workspace.js";
import { nameScript, readMissionScript } from "../../src/script/name-script.js";
import { parseScript } from "../../src/script/parse-script.js";
import { lineMoves, refreshScreenplay, sceneMoves } from "../../src/script/refresh-screenplay.js";

/** A Screenplay of one scene per entry, its lines `SPEAKER: text`; core's naming numbers them by place (outpost-<scene>-<n>). */
const markdown = (...scenes: string[][]): string =>
  `# Outpost\n\n${scenes.map((lines, at) => `## Scene ${at + 1}: SCENE\n\n${lines.map((line) => `**${line.split(": ")[0]}**: ${line.split(": ")[1]}`).join("\n\n")}\n`).join("\n")}`;
const script = (...scenes: string[][]) => nameScript(parseScript(markdown(...scenes)), "outpost", EMPTY_REGISTRY, NO_CHARACTERS);

const SCENE = ["RAYNOR: One.", "HORNER: Two.", "RAYNOR: Three.", "HORNER: Four.", "RAYNOR: Five."];

describe("lineMoves", () => {
  it("follows the lines after a cut to their new sound IDs, and reports the cut line gone", () => {
    const moves = lineMoves(script(SCENE), script(SCENE.filter((line) => line !== "HORNER: Two.")));

    expect(moves).toEqual({
      moved: [
        { from: "outpost-1-3", to: "outpost-1-2" },
        { from: "outpost-1-4", to: "outpost-1-3" },
        { from: "outpost-1-5", to: "outpost-1-4" },
      ],
      changed: [],
      gone: ["outpost-1-2"],
    });
  });

  it("follows lines across an insert and a move to another scene", () => {
    const moves = lineMoves(script(SCENE, ["TYCHUS: Six."]), script(["RAYNOR: Zero.", ...SCENE.slice(0, 4)], ["RAYNOR: Five.", "TYCHUS: Six."]));

    expect(moves.gone).toEqual([]);
    expect(moves.changed).toEqual([]);
    expect(moves.moved).toEqual([
      { from: "outpost-1-1", to: "outpost-1-2" },
      { from: "outpost-1-2", to: "outpost-1-3" },
      { from: "outpost-1-3", to: "outpost-1-4" },
      { from: "outpost-1-4", to: "outpost-1-5" },
      { from: "outpost-1-5", to: "outpost-2-1" },
      { from: "outpost-2-1", to: "outpost-2-2" },
    ]);
  });

  it("finds a line whose text or speaker changed between unchanged neighbours, even renumbered", () => {
    const moves = lineMoves(script(SCENE), script(["RAYNOR: One.", "TYCHUS: Three, said otherwise.", "HORNER: Four.", "RAYNOR: Five."]));

    // Two was cut and Three rewritten: two unpaired lines between One and Four face one, so neither can be told from a cut.
    expect(moves.changed).toEqual([]);
    expect(moves.gone).toEqual(["outpost-1-2", "outpost-1-3"]);

    // One was cut and Three rewritten: Three is alone between Two and Four, renumbered with them.
    expect(lineMoves(script(SCENE), script(["HORNER: Two.", "TYCHUS: Three, again.", "HORNER: Four.", "RAYNOR: Five."]))).toEqual({
      moved: [
        { from: "outpost-1-2", to: "outpost-1-1" },
        { from: "outpost-1-4", to: "outpost-1-3" },
        { from: "outpost-1-5", to: "outpost-1-4" },
      ],
      changed: [{ from: "outpost-1-3", to: "outpost-1-2" }],
      gone: ["outpost-1-1"],
    });
    expect(lineMoves(script(SCENE), script(["RAYNOR: One.", "HORNER: Two.", "TYCHUS: Three, again.", "HORNER: Four.", "RAYNOR: Five."]))).toEqual({
      moved: [],
      changed: [{ from: "outpost-1-3", to: "outpost-1-3" }],
      gone: [],
    });
  });

  it("pairs lines with the same speaker and text in order, and ignores a change of mood", () => {
    const before = script(["RAYNOR: Yes.", "HORNER: No.", "RAYNOR: Yes."]);
    const after = nameScript(parseScript(markdown(["HORNER: No.", "RAYNOR: [Happy 30]Yes.[/Happy]", "RAYNOR: Yes."])), "outpost", EMPTY_REGISTRY, NO_CHARACTERS);

    expect(lineMoves(before, after)).toEqual({
      moved: [
        { from: "outpost-1-1", to: "outpost-1-2" },
        { from: "outpost-1-2", to: "outpost-1-1" },
      ],
      changed: [],
      gone: [],
    });
  });
});

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

/** A Source that serves the Workspace's `source.md`, as a script editor would after an edit. */
const FILE_PACK = `
import { readFile } from "node:fs/promises";
export default { screenplaySource: { name: "file", fetch: async () => readFile(new URL("../source.md", import.meta.url), "utf8") } };
`;

async function workspace(screenplay: string, shots: unknown[], { campaignMod }: { campaignMod?: string } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "sc2-adjutant-refresh-"));
  roots.push(root);
  await writeFile(path.join(root, "sc2-adjutant.workspace.json"), JSON.stringify({ campaign: { id: "fixtures", name: "Fixture Campaign" }, campaignPack: "./file" }));
  await mkdir(path.join(root, "file"));
  await writeFile(
    path.join(root, "file", "sc2-adjutant-plugin.json"),
    JSON.stringify({ name: "file", version: "0.1.0", pluginApi: 2, roles: ["campaign-pack"], contributions: { screenplaySource: ["file"], ...(campaignMod ? { campaignMod } : {}) }, entry: "./index.mjs" }),
  );
  await writeFile(path.join(root, "file", "index.mjs"), FILE_PACK);
  const dir = path.join(root, "missions", "outpost");
  await mkdir(path.join(dir, "cinematics"), { recursive: true });
  const blueprint = JSON.parse(await readFile(new URL("../fixtures/workspaces/screenplay/missions/outpost/blueprint.json", import.meta.url), "utf8"));
  blueprint.screenplay.script = { ...blueprint.screenplay.script, ref: "outpost", cinematics: [{ id: "yard", scene: 1 }] };
  const blueprintPath = path.join(dir, "blueprint.json");
  await writeFile(blueprintPath, JSON.stringify(blueprint));
  await writeFile(path.join(dir, "outpost.md"), screenplay);
  const cinematic = path.join(dir, "cinematics", "yard.json");
  await writeFile(cinematic, `{\n  "sets": [{ "id": "yard", "file": "sets/yard.json" }],\n  "shots": [\n${shots.map((shot) => `    ${JSON.stringify(shot)}`).join(",\n")}\n  ]\n}\n`);
  return { root, blueprintPath, cinematic };
}

describe("sceneMoves", () => {
  /** A Screenplay of headed scenes, each `[TITLE, ...lines]`. */
  const headed = (...scenes: string[][]) =>
    nameScript(
      parseScript(`# Outpost\n\n${scenes.map(([title, ...lines], at) => `## Scene ${at + 1}: ${title}\n\n${lines.map((line) => `**${line.split(": ")[0]}**: ${line.split(": ")[1]}`).join("\n\n")}\n`).join("\n")}`),
      "outpost",
      EMPTY_REGISTRY,
      NO_CHARACTERS,
    );
  const follow = (before: ReturnType<typeof headed>, after: ReturnType<typeof headed>) => sceneMoves(before, after, lineMoves(before, after));

  it("follows the scenes after an inserted one to their new numbers", () => {
    const before = headed(["LANDING", "RAYNOR: Down."], ["CAMP", "HORNER: Up."], ["END", "RAYNOR: Out."]);
    const after = headed(["LANDING", "RAYNOR: Down."], ["RAID", "TYCHUS: Here they come!"], ["CAMP", "HORNER: Up."], ["END", "RAYNOR: Out."]);

    expect(follow(before, after)).toEqual({ moved: [{ from: 2, to: 3 }, { from: 3, to: 4 }], unsure: [] });
  });

  it("follows a scene with no lines by its heading, and is unsure of one split across scenes", () => {
    const before = headed(["LANDING", "RAYNOR: Down.", "HORNER: Up."], ["QUIET"]);
    const after = headed(["NEW"], ["LANDING", "RAYNOR: Down."], ["ELSEWHERE", "HORNER: Up."], ["QUIET"]);

    expect(follow(before, after)).toEqual({ moved: [{ from: 2, to: 4 }], unsure: [1] });
  });
});

describe("refreshScreenplay", () => {
  it("pulls, and moves the Cinematic's shots with their lines, keeping the file's layout", async () => {
    const { root, blueprintPath, cinematic } = await workspace(markdown(SCENE), [
      { camera: "yard/Wide", line: "outpost-1-1" },
      { camera: "yard/Raynor", line: "outpost-1-2" },
      { camera: "yard/Horner", line: "outpost-1-4" },
      { camera: "yard/Wide", line: "outpost-1-5", pauseAfterMs: 500 },
    ]);
    await writeFile(path.join(root, "source.md"), markdown(SCENE.filter((line) => line !== "HORNER: Two.")));
    const mission = await readMissionBlueprint(blueprintPath);

    const result = await refreshScreenplay(mission, blueprintPath);

    expect(result.pull.sourceName).toBe("file");
    expect(result.moves?.gone).toEqual(["outpost-1-2"]);
    expect(result.cinematics).toEqual([
      {
        id: "yard",
        file: cinematic,
        repointed: [
          { shot: 2, from: "outpost-1-4", to: "outpost-1-3" },
          { shot: 3, from: "outpost-1-5", to: "outpost-1-4" },
        ],
        orphaned: [{ shot: 1, line: "outpost-1-2" }],
      },
    ]);
    expect(await readFile(cinematic, "utf8")).toBe(
      '{\n  "sets": [{ "id": "yard", "file": "sets/yard.json" }],\n  "shots": [\n' +
        '    {"camera":"yard/Wide","line":"outpost-1-1"},\n' +
        '    {"camera":"yard/Raynor","line":"outpost-1-2"},\n' +
        '    {"camera":"yard/Horner","line":"outpost-1-3"},\n' +
        '    {"camera":"yard/Wide","line":"outpost-1-4","pauseAfterMs":500}\n  ]\n}\n',
    );
  });

  it("moves the Blueprint's scene numbers with their scenes when a scene is inserted before them", async () => {
    const { root, blueprintPath } = await workspace(markdown(SCENE, ["TYCHUS: Six."]), [{ camera: "yard/Wide", line: "outpost-1-1" }]);
    const blueprint = JSON.parse(await readFile(blueprintPath, "utf8"));
    blueprint.screenplay.script.cues = [
      { scene: 1, cue: { type: "missionStart" } },
      { scene: 2, cue: { type: "missionStart" } },
    ];
    await writeFile(blueprintPath, JSON.stringify(blueprint, null, 2));
    await writeFile(path.join(root, "source.md"), markdown(["RAYNOR: Zero."], SCENE, ["TYCHUS: Six."]));
    const mission = await readMissionBlueprint(blueprintPath);

    const result = await refreshScreenplay(mission, blueprintPath);

    expect(result.scenes).toEqual({ moved: [{ from: 1, to: 2 }, { from: 2, to: 3 }], unsure: [], repointed: [{ from: 1, to: 2 }, { from: 2, to: 3 }] });
    const after = JSON.parse(await readFile(blueprintPath, "utf8"));
    expect(after.screenplay.script.cues.map((cue: { scene: number }) => cue.scene)).toEqual([2, 3]);
    expect(after.screenplay.script.cinematics).toEqual([{ id: "yard", scene: 2 }]);
  });

  it("pulls and moves nothing when there was no readable Screenplay before", async () => {
    const { root, blueprintPath, cinematic } = await workspace("", [{ camera: "yard/Wide", line: "outpost-1-1" }]);
    await rm(path.join(root, "missions", "outpost", "outpost.md"));
    await writeFile(path.join(root, "source.md"), markdown(SCENE));
    const before = await readFile(cinematic, "utf8");

    const mission = await readMissionBlueprint(blueprintPath);
    const result = await refreshScreenplay(mission, blueprintPath);

    expect(result.moves).toBeUndefined();
    expect(result.cinematics).toEqual([]);
    expect(await readFile(cinematic, "utf8")).toBe(before);
    expect((await readMissionScript(mission.blueprint, blueprintPath, mission.workspace))?.script.scenes[0]?.items).toHaveLength(5);
  });

  it("pulls and moves the shots of a Screenplay whose speakers the Campaign Mod doesn't declare, before and after", async () => {
    const { root, blueprintPath, cinematic } = await workspace(markdown(SCENE), [{ camera: "yard/Horner", line: "outpost-1-4" }], { campaignMod: "File-Story" });
    await writeFile(path.join(root, "source.md"), markdown(SCENE.filter((line) => line !== "HORNER: Two.")));

    const result = await refreshScreenplay(await readMissionBlueprint(blueprintPath), blueprintPath);

    expect(result.cinematics).toEqual([{ id: "yard", file: cinematic, repointed: [{ shot: 0, from: "outpost-1-4", to: "outpost-1-3" }], orphaned: [] }]);
  });
});
