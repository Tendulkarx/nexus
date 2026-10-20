/**
 * `postinstall` hook — names the dev Electron bundle "Nexus".
 *
 * macOS takes the bold app-menu title and the Dock/Cmd-Tab name from the
 * running bundle's Info.plist, not from app.name, so `npm run dev` showed
 * "Electron" there. Packaged builds already say Nexus (electron-builder writes
 * their plist). macOS only; a no-op elsewhere or when already renamed.
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const plist = path.join(__dirname, "..", "node_modules", "electron", "dist", "Electron.app", "Contents", "Info.plist");
if (process.platform === "darwin" && fs.existsSync(plist)) {
  for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
    const current = (() => {
      try {
        return execFileSync("plutil", ["-extract", key, "raw", plist], { encoding: "utf8" }).trim();
      } catch {
        return null;
      }
    })();
    if (current === "Nexus") continue;
    execFileSync("plutil", ["-replace", key, "-string", "Nexus", plist]);
    console.log(`[name-dev-electron] set ${key} to Nexus`);
  }
}
