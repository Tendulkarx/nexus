import { defineConfig, externalizePackage } from "@glaze/core/build";

// `ssh2` (used by ssh2-sftp-client and the terminal) can't be bundled into the
// ESM backend: its agent.js relies on `__dirname` and it ships an optional
// native binding (cpu-features). Bundling it makes Node unable to determine the
// module format ("both '__dirname' and top-level await are present"), crashing
// the backend on startup. Externalize it so it loads from node_modules at
// runtime; the plugin copies ssh2 + its transitive deps into the build output.
const ssh2 = externalizePackage("ssh2");

export default defineConfig({
  build: {
    external: [...ssh2.externals],
    plugins: [ssh2.plugin],
  },
});
