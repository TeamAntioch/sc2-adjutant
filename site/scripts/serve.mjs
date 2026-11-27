// Serves the static export in site/out/ on http://localhost:3975 (or --port N), to look at a build
// before it deploys: `pnpm --filter sc2-adjutant-site run build && pnpm --filter sc2-adjutant-site run serve`. The pages link their assets
// from the site's root (/_next/...), so they need a server; opening the files directly shows them
// unstyled.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../out/", import.meta.url));
const portFlag = process.argv.indexOf("--port");
const PORT = portFlag >= 0 ? Number(process.argv[portFlag + 1]) : 3975;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** The file under out/ for a request path, or undefined when there is none. */
async function resolve(urlPath) {
  const file = path.join(OUT, decodeURIComponent(urlPath));
  if (!file.startsWith(OUT)) return undefined;
  const info = await stat(file).catch(() => undefined);
  if (info?.isFile()) return file;
  if (info?.isDirectory()) return resolve(path.posix.join(urlPath, "index.html"));
  return undefined;
}

createServer(async (request, response) => {
  const urlPath = new URL(request.url ?? "/", "http://localhost").pathname;
  const file = await resolve(urlPath);
  const status = file ? 200 : 404;
  const served = file ?? (await resolve("/404.html"));
  if (!served) {
    response.writeHead(404).end("Not found. Run `pnpm --filter sc2-adjutant-site run build` first.");
    return;
  }
  response.writeHead(status, { "content-type": TYPES[path.extname(served)] ?? "application/octet-stream" });
  createReadStream(served).pipe(response);
}).listen(PORT, () => console.log(`Serving ${OUT} on http://localhost:${PORT}`));
