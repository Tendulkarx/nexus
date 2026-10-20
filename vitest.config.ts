import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // renderer/**/*.test.ts is limited to DOM-free pure logic (e.g.
    // connection-manager/tag-filter.ts) — a real renderer/component test
    // environment (jsdom) isn't set up yet, see CLAUDE.md.
    include: ["main/**/*.test.ts", "renderer/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "renderer/shared"),
      "@renderer": resolve(__dirname, "renderer"),
    },
  },
});
