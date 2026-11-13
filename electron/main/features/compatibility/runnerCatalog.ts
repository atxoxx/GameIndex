/**
 * Pure catalogue rules for downloadable runners.
 *
 * Kept separate from `runners.ts` (which touches Electron, disk and HTTP) so
 * the source/asset matching table can be unit-tested directly.
 */

export interface RunnerSource {
  repo: string;
  targetType: "proton" | "wine";
}

/** Source id → GitHub repository, exactly the set the UI exposes. */
export const RUNNER_SOURCES: Record<string, RunnerSource> = {
  "ge-proton": { repo: "GloriousEggroll/proton-ge-custom", targetType: "proton" },
  cachyos: { repo: "CachyOS/proton-cachyos", targetType: "proton" },
  "proton-em": { repo: "BananaWorks07/Proton", targetType: "proton" },
  "wine-ge": { repo: "GloriousEggroll/wine-ge-custom", targetType: "wine" },
  kron4ek: { repo: "Kron4ek/Wine-Builds", targetType: "wine" },
  soda: { repo: "bottlesdevs/wine", targetType: "wine" },
};

export function isChecksumAsset(name: string): boolean {
  const lower = name.toLowerCase();
  // Symbols/debug packages share the release but are not runnable builds.
  if (lower.includes("-symbols") || lower.includes(".symbols")) return true;
  return [
    ".sha512sum",
    ".sha256sum",
    ".sha512",
    ".sha256",
    ".sum",
    ".sig",
    ".asc",
    ".txt",
  ].some((suffix) => lower.endsWith(suffix));
}

export function assetArchMatches(name: string): boolean {
  const lower = name.toLowerCase();
  const arm = lower.includes("aarch64") || lower.includes("arm64");
  const x64 = lower.includes("x86_64") || lower.includes("amd64");
  if (!arm && !x64) return true; // architecture-agnostic asset
  return process.arch === "arm64" ? arm : x64;
}

/** Port of the Rust `runner_asset_matches` table. */
export function runnerAssetMatches(source: string, name: string): boolean {
  if (!name || isChecksumAsset(name)) return false;
  const lower = name.toLowerCase();
  if (!assetArchMatches(lower)) return false;
  switch (source) {
    case "ge-proton":
      return lower.endsWith(".tar.gz") || lower.endsWith(".tgz");
    case "cachyos":
      return (lower.endsWith(".tar.xz") || lower.endsWith(".txz")) && !lower.includes("_v3");
    case "proton-em":
    case "wine-ge":
    case "soda":
      return lower.endsWith(".tar.xz") || lower.endsWith(".txz");
    case "kron4ek":
      return (
        (lower.endsWith(".tar.xz") || lower.endsWith(".txz")) &&
        (lower.includes("amd64") || lower.includes("x86_64"))
      );
    default:
      return false;
  }
}
