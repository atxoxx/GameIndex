/**
 * Install-state + size pass shared by the Steam sync.
 *
 * Mirrors `steam/sync.rs`: one manifest walk feeds the fully-installed set, the
 * manifest-presence set and the per-app install directory, then folder sizes
 * are measured with a bounded pool. The Rust build kept a second cache just
 * for sizes; here the measurement is explicit because `sizeBytes` is written
 * into the sync result.
 */
import path from "node:path";
import { measureFolder } from "./exe";
import { scanSteamManifests, type SteamManifestInfo } from "./steam";

export interface SteamInstallScan {
  installedAppids: Set<number>;
  manifestAppids: Set<number>;
  manifests: Map<number, SteamManifestInfo>;
  /** appid → bytes measured on disk (absent when the walk exceeded its budget). */
  sizes: Map<number, number>;
}

export async function steamInstallScan(
  measureSizes = true,
): Promise<SteamInstallScan> {
  const { manifests } = await scanSteamManifests();
  const installedAppids = new Set<number>();
  const manifestAppids = new Set<number>();
  const byAppId = new Map<number, SteamManifestInfo>();

  for (const manifest of manifests) {
    manifestAppids.add(manifest.appId);
    byAppId.set(manifest.appId, manifest);
    if (manifest.fullyInstalled) installedAppids.add(manifest.appId);
  }

  const sizes = new Map<number, number>();
  if (measureSizes) {
    const targets = [...installedAppids]
      .map((appId) => byAppId.get(appId))
      .filter((manifest): manifest is SteamManifestInfo => Boolean(manifest));

    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= targets.length) return;
        const manifest = targets[index];
        const installDir = path.join(
          manifest.libraryRoot,
          "steamapps",
          "common",
          manifest.installDir,
        );
        const size = await measureFolder(installDir);
        if (size !== null && size > 0) sizes.set(manifest.appId, size);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, Math.max(1, targets.length)) }, () => worker()),
    );
  }

  return { installedAppids, manifestAppids, manifests: byAppId, sizes };
}
