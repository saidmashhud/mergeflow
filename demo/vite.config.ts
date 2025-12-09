import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname),
  resolve: {
    alias: {
      collabtext: resolve(__dirname, "../src/index.ts"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
