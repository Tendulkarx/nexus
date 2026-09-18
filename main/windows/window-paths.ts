import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the built preload script.
 * electron-vite outputs main/preload/renderer to sibling dirs under `out/`,
 * so from `out/main/index.js`, the preload bundle is `../preload/index.js`.
 */
export function getPreloadPath(): string {
  // The preload bundle is forced to CommonJS output as `index.cjs` (see
  // electron.vite.config.ts) because sandboxed preload scripts can't load
  // ESM, even from a `.mjs` file.
  return path.join(__dirname, "..", "preload", "index.cjs");
}

/**
 * Resolve the correct URL for a window: the electron-vite dev server in
 * development (electron-vite sets ELECTRON_RENDERER_URL), or the built HTML
 * file in production.
 */
export async function getWindowUrl(htmlFileName: string): Promise<string> {
  const devServerURL = process.env["ELECTRON_RENDERER_URL"];
  if (devServerURL) {
    return `${devServerURL}/${htmlFileName}`;
  }
  const builtPath = path.join(__dirname, "..", "renderer", htmlFileName);
  return pathToFileURL(builtPath).toString();
}
