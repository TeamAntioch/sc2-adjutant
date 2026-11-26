// Writes dist/.built for the package in the current folder, at the end of its build: a digest of
// the TypeScript it compiled, which core's packageBuild (src/plugins/built-package.ts) checks before
// loading the package from a checkout. Needs core built, which every such package builds after.
//
// Usage, from the package's folder, after its tsc: node ../core/scripts/write-built-stamp.mjs
import { writeBuiltStamp } from "../dist/plugins/built-package.js";

writeBuiltStamp(process.cwd());
