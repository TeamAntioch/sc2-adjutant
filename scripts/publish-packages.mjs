// The release (#853), run by .github/workflows/publish.yml:
//
//   node scripts/publish-packages.mjs check [--tag v<version>]
//   node scripts/publish-packages.mjs publish [--dry-run]
//
// `check` fails unless every public package (public-packages.mjs), the Claude Code plugin's manifest
// and its package.json are at one version, core names the public packages it depends on at that
// version exactly and as a peer at ^ that major.minor, and the public packages are publishable (not `private`). With --tag it also fails
// a tag that isn't `v` and that version, so a tag can't publish packages at another version.
//
// `publish` runs `npm publish --provenance --access public` in each public package's folder, in
// public-packages.mjs's order (core first), on the packages as built: the workflow builds and tests
// first. A package whose version is already on npm is skipped, saying so, so a run that stopped
// part way can be run again. --dry-run runs `npm publish --dry-run` instead, which needs no npm
// token and publishes nothing, so a pull request finds a bad name or a missing `files` entry.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PUBLIC_PACKAGES } from "./public-packages.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PLUGIN = path.join(ROOT, "packages", "claude-plugin");

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/** Each public package's folder and package.json, in publish order. */
function publicPackages() {
  return PUBLIC_PACKAGES.map((name) => {
    const folder = path.join(ROOT, "packages", name);
    return { folder, manifest: readJson(path.join(folder, "package.json")) };
  });
}

/**
 * What stops a release at `tag` (or, with none, at the packages' own version): `packages` are the
 * public packages' package.jsons in publish order, `plugin` the version of each plugin file by its
 * name. Gives `{ version, problems }`.
 */
function releaseProblems({ tag, packages, plugin }) {
  const problems = [];
  const version = packages[0].version;
  const tagged = tag === undefined ? version : /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag)?.[1];
  if (tag !== undefined && !tagged) problems.push(`The tag ${tag} isn't v and a version, such as v${version}`);
  const want = tagged ?? version;
  const differs = (what, found) => found !== want && problems.push(`${what} is at ${found ?? "no version"}, not ${want}${tag ? ` (the tag ${tag})` : ` (${packages[0].name}'s)`}`);
  for (const manifest of packages) {
    differs(manifest.name, manifest.version);
    if (manifest.private) problems.push(`${manifest.name} is private, and npm won't publish it`);
  }
  for (const [file, found] of Object.entries(plugin)) differs(`The Claude Code plugin's ${file}`, found);
  const names = new Set(packages.map((manifest) => manifest.name));
  for (const manifest of packages) {
    for (const field of ["dependencies", "optionalDependencies"]) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (names.has(name) && range !== want) problems.push(`${manifest.name} names ${name} at ${range} in its ${field}, not ${want}`);
      }
    }
    // A peer on another public package (a Plugin's on core) takes any patch of this major.minor.
    const peer = `^${want.split(".").slice(0, 2).join(".")}.0`;
    for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
      if (names.has(name) && range !== peer) problems.push(`${manifest.name} names ${name} at ${range} in its peerDependencies, not ${peer}`);
    }
  }
  return { version: want, problems };
}

function check(tag) {
  const { version, problems } = releaseProblems({
    tag,
    packages: publicPackages().map(({ manifest }) => manifest),
    plugin: {
      ".claude-plugin/plugin.json": readJson(path.join(PLUGIN, ".claude-plugin", "plugin.json")).version,
      "package.json": readJson(path.join(PLUGIN, "package.json")).version,
    },
  });
  if (problems.length) {
    console.error(`Can't release ${tag ?? version}:\n${problems.map((problem) => `  ${problem}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`The public packages and the plugin are all at ${version}${tag ? `, as the tag ${tag} says` : ""}.`);
}

const npm = (args, cwd) =>
  // npm is npm.cmd on Windows, which Node runs only through a shell.
  execFileSync("npm", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });

/** Whether `name`@`version` is on npm already. */
function published(name, version, cwd) {
  try {
    return npm(["view", `${name}@${version}`, "version"], cwd).trim() === version;
  } catch {
    // npm view fails with E404 for a package that has never been published.
    return false;
  }
}

function publish(dryRun) {
  for (const { folder, manifest } of publicPackages()) {
    const id = `${manifest.name}@${manifest.version}`;
    if (published(manifest.name, manifest.version, folder)) {
      console.log(`${id} is on npm already: skipped.`);
      continue;
    }
    // Built and tested already, so the packages' prepack builds don't run again.
    const args = ["publish", "--access", "public", "--ignore-scripts", ...(dryRun ? ["--dry-run"] : ["--provenance"])];
    console.log(`npm ${args.join(" ")}  (${id})`);
    execFileSync("npm", args, { cwd: folder, stdio: "inherit", shell: process.platform === "win32" });
  }
}

const [command, ...args] = process.argv.slice(2);
const USAGE = "Usage: node scripts/publish-packages.mjs check [--tag v<version>] | publish [--dry-run]";
if (command === "check" && (args.length === 0 || (args.length === 2 && args[0] === "--tag"))) check(args[1]);
else if (command === "publish" && (args.length === 0 || (args.length === 1 && args[0] === "--dry-run"))) publish(args[0] === "--dry-run");
else {
  console.error(USAGE);
  process.exit(2);
}
