import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  build: {
    chunkSizeWarningLimit: 1500,
    // Don't fetch the heavy, purely-on-demand chunks at startup. Vite's default
    // modulePreload fetches every dynamic-import dependency (bigscreen,
    // html2canvas, hls.js, nostr, qrcode) alongside the first paint even though
    // most desktop users never open Big Screen Mode or export a capture. Those
    // stay lazy: they download + parse only when the view that needs them
    // actually loads. The small initial set (index, react-vendor, tauri,
    // router, vendor) still preloads so first navigation stays snappy.
    modulePreload: {
      polyfill: true,
      resolveDependencies(_currentModule, deps: { fileName?: string }[]) {
        const excluded = /\/(bigscreen|html2canvas|hls|nostr|qrcode)-/;
        return deps.filter((d) => !excluded.test(d.fileName ?? ""));
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("nostr-tools")) return "nostr";
            if (id.includes("html2canvas")) return "html2canvas";
            if (id.includes("qrcode")) return "qrcode";
            if (id.includes("@tauri-apps")) return "tauri";
            if (id.includes("react-router")) return "router";
            if (id.includes("hls.js")) return "hls";
            if (
              id.includes("react-dom") ||
              id.includes("/react/") ||
              id.includes("scheduler")
            ) {
              return "react-vendor";
            }
            return "vendor";
          }
          // Big Screen views are already React.lazy in src/bigscreen/registry.tsx,
          // so we deliberately DON'T lump them into a single mega-chunk: each
          // controller-first view stays its own async chunk and only loads the
          // sections the user actually opens (entering Big Screen Home no longer
          // drags in the Store, Treasury, Mods, Emulators, etc.).
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
