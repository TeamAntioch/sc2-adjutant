// The root's preinstall: this repo installs with pnpm (pnpm-workspace.yaml, pnpm-lock.yaml), so an
// `npm install` or `npm ci` here stops before it writes a package-lock.json or an npm-made
// node_modules. `npm run <script>` doesn't install, so it still works.
const agent = process.env.npm_config_user_agent ?? "";
if (!agent.startsWith("pnpm/")) {
  console.error("This repo installs with pnpm: run pnpm install (https://pnpm.io/installation).");
  process.exit(1);
}
