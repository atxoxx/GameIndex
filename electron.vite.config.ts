import { fileURLToPath } from "node:url";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { tauriShimAliases } from "./src/shims/alias";
import { rendererBuild, rendererPlugins } from "./vite.shared";

const root = fileURLToPath(new URL(".", import.meta.url));
const entry = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

/** Keys baked into the main bundle, matching the old Rust `build.rs` contract. */
const BAKED_ENV_KEYS = [
  "TWITCH_CLIENT_ID",
  "TWITCH_CLIENT_SECRET",
  "OPENCRITIC_RAPIDAPI_KEY",
  "DISCORD_CLIENT_ID",
  "STEAMGRIDDB_API_KEY",
  "IGDB_CLIENT_ID",
  "IGDB_CLIENT_SECRET",
  "STEAM_API_KEY",
  "NEXUS_API_KEY",
  "REAL_DEBRID_KEY",
  "ALL_DEBRID_KEY",
  "PREMIUMIZE_KEY",
  "TORBOX_KEY",
] as const;

const bakedEnv = Object.fromEntries(
  BAKED_ENV_KEYS.map((key) => [key, process.env[key] ?? ""]),
);

/**
 * Three bundles:
 *   - main    → out/main/index.cjs    (Node, CJS so `__dirname` works)
 *   - preload → out/preload/index.cjs (isolated world bridge)
 *   - renderer→ out/renderer/index.html (the existing React app + shims)
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __GI_BAKED_ENV__: JSON.stringify(bakedEnv),
    },
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: { index: entry("electron/main/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: { index: entry("electron/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },

  renderer: {
    root,
    plugins: rendererPlugins,
    resolve: {
      alias: tauriShimAliases,
    },
    build: {
      ...rendererBuild,
      outDir: "out/renderer",
      // electron-vite leaves the renderer unminified by default; match the
      // plain Vite production build so bundles (and the size gate) are comparable.
      minify: "esbuild",
      rollupOptions: {
        ...rendererBuild?.rollupOptions,
        input: entry("index.html"),
      },
    },
    // Same console/debugger stripping as `vite.config.ts` in production.
    esbuild: {
      drop: ["console", "debugger"],
    },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: false,
    },
  },
});
