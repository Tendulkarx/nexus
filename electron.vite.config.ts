import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// `ssh2` (used by ssh2-sftp-client and the interactive terminal) can't be bundled
// into the main process: its agent.js relies on `__dirname` and it ships an
// optional native binding (cpu-features). `externalizeDepsPlugin()` externalizes
// every runtime dependency (ssh2 included) so it's `require()`d from
// node_modules at runtime instead of bundled — same constraint, expressed the
// electron-vite way.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "main/index.ts"),
        },
      },
    },
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "renderer/shared"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "renderer/preload.ts"),
        },
        output: {
          // Sandboxed preload scripts (webPreferences.sandbox: true) load
          // through Electron's CJS-only sandbox bundle loader, which can't
          // execute ESM `import` syntax — even from a `.mjs` file. Force
          // CommonJS output here despite `"type": "module"` in package.json;
          // `.cjs` is always treated as CommonJS by Node regardless of that
          // field.
          format: "cjs",
          entryFileNames: "index.cjs",
        },
      },
    },
    resolve: {
      alias: {
        "@shared": resolve(__dirname, "renderer/shared"),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "renderer"),
    build: {
      outDir: resolve(__dirname, "out/renderer"),
      rollupOptions: {
        input: {
          "main-window": resolve(__dirname, "renderer/main-window.html"),
          "settings-window": resolve(__dirname, "renderer/settings-window.html"),
          "session-window": resolve(__dirname, "renderer/session-window.html"),
        },
      },
    },
    resolve: {
      alias: {
        "@renderer": resolve(__dirname, "renderer"),
        "@shared": resolve(__dirname, "renderer/shared"),
        "@main": resolve(__dirname, "main"),
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
