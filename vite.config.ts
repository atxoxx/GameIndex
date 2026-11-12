import { defineConfig } from "vite";
import { tauriShimAliases } from "./src/shims/alias";
import { rendererBuild, rendererPlugins } from "./vite.shared";

/**
 * Browser-only dev/build (`npm run dev`, `npm run build:web`).
 *
 * The desktop app is built by `electron.vite.config.ts`; both share the same
 * plugins, chunking and `@tauri-apps/*` → `src/shims/*` aliases.
 */
export default defineConfig(({ mode }) => ({
  plugins: rendererPlugins,
  resolve: {
    alias: tauriShimAliases,
  },

  // Strip console.* + debugger from production bundles only.
  esbuild: mode === "production" ? { drop: ["console", "debugger"] } : undefined,

  build: {
    ...rendererBuild,
    outDir: "dist",
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/electron/**", "**/out/**", "**/release/**"],
    },
  },
}));
