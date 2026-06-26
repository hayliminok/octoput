import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "renderer",
  base: "./",
  // Glaze injected these compile-time constants; define them ourselves now.
  // Referencing an undeclared identifier is a ReferenceError (crashes the
  // renderer), not `undefined`, so the `|| document.title` fallback never runs.
  define: {
    __APP_DISPLAY_NAME__: JSON.stringify("Octoput"),
  },
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      "@ui": resolve(__dirname, "renderer/ui"),
      "@platform": resolve(__dirname, "renderer/platform"),
    },
  },
  build: {
    outDir: resolve(__dirname, "build/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        "main-window": resolve(__dirname, "renderer/main-window.html"),
      },
    },
  },
  server: { port: 5273, strictPort: true },
});
