/**
 * Renderer build options shared by the browser-only Vite config and the
 * electron-vite renderer bundle, so chunking stays identical in both.
 */
import react from "@vitejs/plugin-react";
import type { UserConfig } from "vite";

export const rendererPlugins = [react()];

export const rendererBuild: UserConfig["build"] = {
  chunkSizeWarningLimit: 1500,
  // Don't fetch the heavy, purely-on-demand chunks at startup. Vite's default
  // modulePreload fetches every dynamic-import dependency (bigscreen,
  // html2canvas, hls.js, nostr, qrcode) alongside the first paint even though
  // most desktop users never open Big Screen Mode or export a capture. Those
  // stay lazy: they download + parse only when the view that needs them
  // actually loads.
  modulePreload: {
    polyfill: true,
    resolveDependencies(_currentModule, deps) {
      const excluded = /\/(bigscreen|html2canvas|hls|nostr|qrcode)-/;
      return deps.filter((d) => !excluded.test(d.fileName ?? ""));
    },
  },
  rollupOptions: {
    output: {
      manualChunks(id: string) {
        if (!id.includes("node_modules")) return undefined;
        // Nostr and QR are dynamic-import-only; keep their transitive
        // crypto/QR dependencies in the same lazy chunk.
        if (id.includes("nostr-tools") || id.includes("@noble") || id.includes("@scure")) {
          return "nostr";
        }
        if (id.includes("html2canvas")) return "html2canvas";
        if (id.includes("qrcode") || id.includes("dijkstrajs")) return "qrcode";
        if (id.includes("src/shims")) return "shims";
        if (id.includes("react-router")) return "router";
        if (id.includes("hls.js")) return "hls";
        if (id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler")) {
          return "react-vendor";
        }
        return "vendor";
      },
    },
  },
};
