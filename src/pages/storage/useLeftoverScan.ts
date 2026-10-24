import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../../types/game";
import { libraryRoots } from "./utils";

export interface LeftoverFolder {
  path: string;
  name: string;
  bytes: number;
  modifiedAt?: string | null;
}

/**
 * On-demand leftover-folder scan.
 *
 * Nothing runs until the user asks: the scan walks real folders, and a page
 * that silently touches the disk on mount is a page people stop trusting.
 */
export function useLeftoverScan(games: Game[]) {
  const roots = useMemo(() => libraryRoots(games), [games]);
  const knownPaths = useMemo(
    () =>
      games
        .filter((game) => game.installed && game.sizeRootPath)
        .map((game) => game.sizeRootPath as string),
    [games],
  );

  const [folders, setFolders] = useState<LeftoverFolder[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scan = useCallback(async () => {
    if (scanning || roots.length === 0) return;
    setScanning(true);
    setError(null);
    try {
      const found = await invoke<LeftoverFolder[]>("scan_leftover_folders", {
        roots,
        knownPaths,
      });
      setFolders(found ?? []);
    } catch (err) {
      setError(String(err));
      setFolders([]);
    } finally {
      setScanning(false);
    }
  }, [scanning, roots, knownPaths]);

  const reset = useCallback(() => {
    setFolders(null);
    setError(null);
  }, []);

  const totals = useMemo(() => {
    if (!folders) return { count: 0, bytes: 0 };
    return folders.reduce(
      (acc, folder) => ({ count: acc.count + 1, bytes: acc.bytes + (folder.bytes || 0) }),
      { count: 0, bytes: 0 },
    );
  }, [folders]);

  return { roots, knownPaths, folders, totals, scanning, error, scan, reset };
}
