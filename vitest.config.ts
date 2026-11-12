import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { tauriShimAliases } from "./src/shims/alias";

export default defineConfig({
  plugins: [react()],
  // The same aliases the app builds with, so `vi.mock("@tauri-apps/api/core")`
  // keeps intercepting the shim module the source actually imports.
  resolve: {
    alias: tauriShimAliases,
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
