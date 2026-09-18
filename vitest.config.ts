import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["main/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "renderer/shared"),
    },
  },
});
