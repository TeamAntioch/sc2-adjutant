import { fileURLToPath } from "node:url";

import createMDX from "@next/mdx";

// The repo root: the npm workspaces hoist the site's dependencies there, and the site reads core's
// package.json for the version it shows.
const root = fileURLToPath(new URL("..", import.meta.url));

const withMDX = createMDX({});

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A static site in site/out/: it needs no functions.
  output: "export",
  // Each page is <path>/index.html, so any static server (npm run serve) serves /install/ and the rest.
  trailingSlash: true,
  pageExtensions: ["ts", "tsx", "md", "mdx"],
  images: { unoptimized: true },
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default withMDX(nextConfig);
