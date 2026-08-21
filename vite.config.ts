import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("nostr-tools")) return "nostr";
            if (id.includes("html2canvas")) return "html2canvas";
            if (id.includes("qrcode")) return "qrcode";
            if (id.includes("@tauri-apps")) return "tauri";
            if (id.includes("react-router")) return "router";
            if (
              id.includes("react-dom") ||
              id.includes("/react/") ||
              id.includes("scheduler")
            ) {
              return "react-vendor";
            }
            return "vendor";
          }
          // Controller-first Big Screen shell — keep its 204 KB CSS + related
          // components out of the initial chunk so desktop users never pay
          // for TV-mode code until isBigScreen becomes true.
          if (
            id.includes("bigscreen") ||
            id.includes("BigScreen") ||
            id.includes("src/bigscreen")
          ) {
            return "bigscreen";
          }
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
