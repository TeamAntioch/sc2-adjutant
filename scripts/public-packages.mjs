// The packages published to npm, as folders under packages/, in publish order: core first, since
// every other one names it as a peer. The pack check (check-packs.mjs) checks each one. A package
// that isn't listed here isn't published, so adding or dropping one is a line here.
export const PUBLIC_PACKAGES = [
  "core",
  "plugin-host-macos",
  "plugin-host-windows",
  "plugin-style-antioch",
  "plugin-anim-testbed",
  "doodad-finder",
  "set-finder",
];
