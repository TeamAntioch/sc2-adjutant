// The SVG preview rasterized to PNG, for clients that show images but not SVG (most MCP clients
// pass tool images to the model, which reads PNG, JPEG, GIF and WebP). Labels use the system's
// fonts. Rendering runs off the event loop, so other tool calls aren't held up.

import { renderAsync } from "@resvg/resvg-js";

export async function renderSvgToPng(svg: string): Promise<Buffer> {
  return (await renderAsync(svg, { font: { loadSystemFonts: true, defaultFontFamily: "Arial" } })).asPng();
}
