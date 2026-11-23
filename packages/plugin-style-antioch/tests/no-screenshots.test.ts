// The pack ships no screenshots (#847): its in-game frames are generated into the research archive,
// and the repo ignores captures/, frames/ and evidence/ under its Exemplar Maps. So its documents
// must stand without them: no link to an image there and no file name of one, only what the frame
// shows. A local checkout may still hold the ignored folders, so a link into them is caught by its
// path, not by whether the file exists.
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PACK = fileURLToPath(new URL("..", import.meta.url));

/** The folders under an Exemplar Map that hold generated screenshots. */
const SCREENSHOT_FOLDERS = ["captures", "frames", "evidence"];

/** The pack's Markdown documents, from its root: README, knowledge, prompts and the Exemplar Maps' docs. */
async function documents(): Promise<string[]> {
  const inFolder = async (folder: string) => (await readdir(path.join(PACK, folder))).filter((name) => name.endsWith(".md")).map((name) => path.posix.join(folder, name));
  return ["README.md", ...(await inFolder("knowledge")), ...(await inFolder("prompts")), ...(await inFolder("exemplar-maps"))];
}

/** The targets of a Markdown document's relative links, less their anchors. */
function relativeLinks(text: string): string[] {
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)].map(([, target]) => target!.split("#")[0]!).filter((target) => target !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(target));
}

/** Whether a path inside the pack goes into an Exemplar Map's screenshot folder. */
const inScreenshotFolder = (relative: string) => relative.split(/[\\/]/).some((part) => SCREENSHOT_FOLDERS.includes(part));

/** The problems with one document: links into a screenshot folder or to a missing file, and image file names under one. */
function screenshotProblems(file: string, text: string, exists: (absolute: string) => boolean = existsSync): string[] {
  const problems: string[] = [];
  for (const target of relativeLinks(text)) {
    const resolved = path.resolve(PACK, path.dirname(file), decodeURIComponent(target));
    if (inScreenshotFolder(path.relative(PACK, resolved))) problems.push(`links to ${target}, a screenshot the pack doesn't ship`);
    else if (!exists(resolved)) problems.push(`links to ${target}, which doesn't exist`);
  }
  for (const [mention] of text.matchAll(/(?:[\w.<>{}-]+\/)?(?:captures|frames|evidence)\/[^\s`)"']*\.(?:jpe?g|png|webp|gif|tga|bmp)/gi)) problems.push(`names ${mention}, a screenshot the pack doesn't ship`);
  return problems;
}

const DOCUMENTS = await documents();

describe("the pack's documents", () => {
  it("catch links into screenshot folders, missing files and screenshot file names, and leave the rest alone", () => {
    const text = [
      "See [162](1-4/evidence/Char2-162.jpg) and [a tour](3-11/frames/places-Temple/stops.txt).",
      "Frames: `3-11/evidence/Temple-019.jpg`, `2-0/frames/places-Avernus/005.jpg`, `<id>/captures/default/001.jpg`, `evidence/Temple-019.webp`.",
      "Read [the lessons](LESSONS.md), [gone](GONE.md) and [the site](https://example.com/a.jpg).",
      "3-11 under `Temple`: a bare lava pit. Frames go to `<id>/frames/<tour>/`.",
    ].join("\n");
    expect(screenshotProblems("exemplar-maps/README.md", text, (file) => !file.endsWith("GONE.md"))).toEqual([
      "links to 1-4/evidence/Char2-162.jpg, a screenshot the pack doesn't ship",
      "links to 3-11/frames/places-Temple/stops.txt, a screenshot the pack doesn't ship",
      "links to GONE.md, which doesn't exist",
      "names 1-4/evidence/Char2-162.jpg, a screenshot the pack doesn't ship",
      "names 3-11/evidence/Temple-019.jpg, a screenshot the pack doesn't ship",
      "names 2-0/frames/places-Avernus/005.jpg, a screenshot the pack doesn't ship",
      "names <id>/captures/default/001.jpg, a screenshot the pack doesn't ship",
      "names evidence/Temple-019.webp, a screenshot the pack doesn't ship",
    ]);
  });

  it.each(DOCUMENTS)("%s cites no screenshot by its file and links only to files the pack has", async (file) => {
    expect(screenshotProblems(file, await readFile(path.join(PACK, file), "utf8"))).toEqual([]);
  });
});
