import { defineConfig } from "vite";

// Relative base so the build works on GitHub Pages (any repo/subpath).
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
