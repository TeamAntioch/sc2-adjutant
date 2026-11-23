// Cross-repo work on the doodad catalog, the Doodad Finder and the Set Finder (ADR-0022, #802):
// sc2-adjutant depends on the published @team-antioch/sc2-asset-catalog, sc2-finder-kit,
// sc2-doodad-finder and sc2-set-finder, pinned. This swaps them, in node_modules only, for a sibling
// sc2-asset-catalog checkout's packages, and back:
//
//   npm run link-catalog [-- --from <checkout>]   link ../sc2-asset-catalog's packages (built first)
//   npm run unlink-catalog                       put the published packages back
//   node scripts/link-catalog.mjs status          say which are linked
//
// The sibling is ../sc2-asset-catalog beside this checkout, or beside the main checkout when this is
// a linked worktree. Linking builds it (`npm ci` there first when it has no node_modules), keeps
// the installed packages aside in node_modules/.published-catalog/, and links each package's folder
// in their place; unlinking puts them back (or runs `npm ci` when they're gone). package.json and
// package-lock.json are never touched, and CI never links: it always runs the published pin
// (scripts/check-catalog-moved.mjs --installed refuses a link). `npm install` or `npm ci` while
// linked also puts the published packages back. Rebuild the sibling after changing it
// (`npm run build` there): sc2-adjutant runs its dist/.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const PACKAGES = ["sc2-asset-catalog", "sc2-finder-kit", "sc2-doodad-finder", "sc2-set-finder"];
const SCOPE = "@team-antioch";
const ASIDE = ".published-catalog";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { root: { type: "string" }, from: { type: "string" }, "no-build": { type: "boolean", default: false } },
});
const ROOT = path.resolve(values.root ?? fileURLToPath(new URL("..", import.meta.url)));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

/** The main working tree when `folder` is a linked worktree (its .git is a file naming the gitdir); else `folder`. */
function mainCheckout(folder) {
  const dotGit = path.join(folder, ".git");
  if (!existsSync(dotGit) || !statSync(dotGit).isFile()) return folder;
  const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"))?.[1]?.trim();
  if (!gitdir) return folder;
  const worktreeGitDir = path.resolve(folder, gitdir);
  // A submodule's or a --separate-git-dir checkout's gitdir has no commondir: it isn't a linked worktree.
  if (!existsSync(path.join(worktreeGitDir, "commondir"))) return folder;
  const commonDir = path.resolve(worktreeGitDir, readFileSync(path.join(worktreeGitDir, "commondir"), "utf8").trim());
  return path.basename(commonDir) === ".git" ? path.dirname(commonDir) : folder;
}

const installedAt = (name) => path.join(ROOT, "node_modules", SCOPE, name);
const asideAt = (name) => path.join(ROOT, "node_modules", ASIDE, name);
const isLink = (file) => existsSync(file) && lstatSync(file).isSymbolicLink();
const versionAt = (folder) => JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8")).version;
/** The version sc2-adjutant pins, from core's or a wrapper's package.json. */
const pinned = (name) =>
  ["packages/core/package.json", "packages/doodad-finder/package.json", "packages/set-finder/package.json"]
    .map((file) => path.join(ROOT, file))
    .filter(existsSync)
    .map((file) => JSON.parse(readFileSync(file, "utf8")).dependencies?.[`${SCOPE}/${name}`])
    .find(Boolean);

function link() {
  const sibling = path.resolve(values.from ?? path.join(path.dirname(mainCheckout(ROOT)), "sc2-asset-catalog"));
  const missing = PACKAGES.filter((name) => {
    const manifest = path.join(sibling, "packages", name, "package.json");
    return !existsSync(manifest) || JSON.parse(readFileSync(manifest, "utf8")).name !== `${SCOPE}/${name}`;
  });
  if (missing.length) throw new Error(`${sibling} isn't an sc2-asset-catalog checkout: it has no packages/${missing.join(", packages/")}. Clone TeamAntioch/sc2-asset-catalog there, or give --from <checkout>`);
  if (!values["no-build"]) {
    if (!existsSync(path.join(sibling, "node_modules"))) execFileSync(npm, ["ci"], { cwd: sibling, stdio: "inherit" });
    execFileSync(npm, ["run", "build"], { cwd: sibling, stdio: "inherit" });
  }
  try {
    for (const name of PACKAGES) linkOne(name, sibling);
  } catch (error) {
    // Half-linked is worse than either: put back what was linked so far.
    unlink();
    throw error;
  }
  console.log("npm run unlink-catalog goes back to the published packages.");
}

/** Keeps the installed package aside (once) and links the sibling's in its place. */
function linkOne(name, sibling) {
  const at = installedAt(name);
  if (isLink(at)) rmSync(at);
  else if (existsSync(at)) {
    rmSync(asideAt(name), { recursive: true, force: true });
    mkdirSync(path.dirname(asideAt(name)), { recursive: true });
    renameSync(at, asideAt(name));
  }
  mkdirSync(path.dirname(at), { recursive: true });
  const target = path.join(sibling, "packages", name);
  symlinkSync(process.platform === "win32" ? target : path.relative(path.dirname(at), target), at, "junction");
  console.log(`${SCOPE}/${name} ${versionAt(target)} linked from ${target} (pinned ${pinned(name) ?? "nowhere"})`);
}

function unlink() {
  let reinstall = false;
  for (const name of PACKAGES) {
    const at = installedAt(name);
    // A link, or nothing where a link failed half-way: the published package goes back.
    if (isLink(at)) rmSync(at);
    else if (existsSync(at)) continue;
    if (existsSync(asideAt(name))) renameSync(asideAt(name), at);
    else reinstall = true;
  }
  rmSync(path.join(ROOT, "node_modules", ASIDE), { recursive: true, force: true });
  if (reinstall) {
    console.log("The published packages weren't kept aside: reinstalling them with npm ci");
    execFileSync(npm, ["ci"], { cwd: ROOT, stdio: "inherit" });
  }
  status();
}

function status() {
  for (const name of PACKAGES) {
    const at = installedAt(name);
    if (isLink(at)) console.log(`${SCOPE}/${name}: linked to ${realpathSync(at)}`);
    else if (existsSync(at)) console.log(`${SCOPE}/${name}: published ${versionAt(at)}${versionAt(at) === pinned(name) ? "" : ` (pinned ${pinned(name)}: run npm ci)`}`);
    else console.log(`${SCOPE}/${name}: not installed (run npm ci)`);
  }
}

const commands = { link, unlink, status };
const command = commands[positionals[0] ?? ""];
if (!command) {
  console.error("Usage: node scripts/link-catalog.mjs link [--from <checkout>] | unlink | status");
  process.exitCode = 2;
} else {
  try {
    command();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
