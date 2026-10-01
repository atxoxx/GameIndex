import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Game } from "../../types/game";
import {
  computeHealthScore,
  countIssues,
  findBacklogIssues,
  findDuplicates,
  findMetadataIssues,
  findSizeIssues,
  findStalePaths,
  type BacklogIssue,
  type DuplicateGroup,
  type HealthCounts,
  type HealthScore,
  type MetadataIssue,
  type OrphanArtwork,
  type PathPresence,
  type SizeIssue,
  type StalePathIssue,
} from "./health";

export interface LibraryHealth {
  /** True while a scan is in flight. */
  scanning: boolean;
  /** Unix ms of the last completed scan, or null before the first one. */
  scannedAt: number | null;
  /** Re-run the disk sweep (path existence + orphaned artwork). */
  scan: () => void;
  stalePaths: StalePathIssue[];
  duplicateGroups: DuplicateGroup[];
  metadataIssues: MetadataIssue[];
  orphanArtwork: OrphanArtwork[];
  sizeIssues: SizeIssue[];
  backlogIssues: BacklogIssue[];
  counts: HealthCounts;
  score: HealthScore;
}

interface PathTarget {
  id: string;
  field: "path" | "sizeRootPath";
  value: string;
}

/** Store launch protocols (`steam://…`, `goggalaxy://…`) are not paths and
 *  `check_paths_exist` would always report them missing. */
function isFilesystemPath(value: string | undefined): value is string {
  return !!value?.trim() && !value.includes("://");
}

/**
 * Runs the disk half of the library health scan (folder existence and
 * orphaned artwork) and combines it with the in-memory library to derive
 * every issue category. The disk sweep is explicit — it only runs when
 * the health view is active or the user asks for a rescan — so browsing
 * the storage list never walks the artwork directory.
 */
export function useLibraryHealth(games: Game[], active: boolean): LibraryHealth {
  const [presence, setPresence] = useState<Map<string, PathPresence>>(() => new Map());
  const [orphanArtwork, setOrphanArtwork] = useState<OrphanArtwork[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  // Bumping this re-runs the scan *after* the render that applied a fix, so
  // the path list always reflects the just-updated library. Calling the
  // sweep directly from a fix handler would read the pre-commit targets.
  const [scanToken, setScanToken] = useState(0);
  const hasScannedRef = useRef(false);

  // Every recorded folder worth checking, in a stable order so the
  // parallel `check_paths_exist` result maps 1:1 back onto it.
  const targets = useMemo<PathTarget[]>(() => {
    const list: PathTarget[] = [];
    for (const game of games) {
      if (isFilesystemPath(game.sizeRootPath)) {
        list.push({ id: game.id, field: "sizeRootPath", value: game.sizeRootPath });
      }
      if (
        isFilesystemPath(game.path) &&
        game.path !== game.sizeRootPath
      ) {
        list.push({ id: game.id, field: "path", value: game.path });
      }
    }
    return list;
  }, [games]);

  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  const runScan = useCallback(async () => {
    hasScannedRef.current = true;
    setScanning(true);
    const current = targetsRef.current;
    try {
      const [exists, orphans] = await Promise.all([
        current.length > 0
          ? invoke<boolean[]>("check_paths_exist", { paths: current.map((t) => t.value) })
          : Promise.resolve([] as boolean[]),
        invoke<OrphanArtwork[]>("scan_orphaned_artwork").catch((err) => {
          console.error("scan_orphaned_artwork failed", err);
          return [] as OrphanArtwork[];
        }),
      ]);
      const next = new Map<string, PathPresence>();
      current.forEach((target, index) => {
        const entry = next.get(target.id) ?? {};
        entry[target.field] = exists[index] === true;
        next.set(target.id, entry);
      });
      setPresence(next);
      setOrphanArtwork(orphans);
      setScannedAt(Date.now());
    } catch (err) {
      console.error("library health scan failed", err);
    } finally {
      setScanning(false);
    }
  }, []);

  // Runs once on mount (first time the view is shown) and again whenever a
  // fix bumps `scanToken`. Not keyed on `games`: enrichment patches churn
  // the array constantly and must not re-walk the filesystem.
  useEffect(() => {
    if (!active) return;
    if (scanToken === 0 && hasScannedRef.current) return;
    void runScan();
  }, [active, scanToken, runScan]);

  const stalePaths = useMemo(() => findStalePaths(games, presence), [games, presence]);
  const duplicateGroups = useMemo(() => findDuplicates(games), [games]);
  const metadataIssues = useMemo(() => findMetadataIssues(games), [games]);
  const sizeIssues = useMemo(() => findSizeIssues(games), [games]);
  const backlogIssues = useMemo(() => findBacklogIssues(games), [games]);

  const counts = useMemo(
    () =>
      countIssues({
        stalePaths,
        duplicateGroups,
        metadataIssues,
        orphanArtwork,
        sizeIssues,
        backlogIssues,
      }),
    [stalePaths, duplicateGroups, metadataIssues, orphanArtwork, sizeIssues, backlogIssues]
  );

  const score = useMemo(() => computeHealthScore(counts, games.length), [counts, games.length]);

  const scan = useCallback(() => {
    setScanToken((token) => token + 1);
  }, []);

  return {
    scanning,
    scannedAt,
    scan,
    stalePaths,
    duplicateGroups,
    metadataIssues,
    orphanArtwork,
    sizeIssues,
    backlogIssues,
    counts,
    score,
  };
}
