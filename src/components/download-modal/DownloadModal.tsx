// Download flow modal — opened from a Download button on the
// GamePage, StoreGameDetail, or anywhere else. Orchestrates:
//
//   1. `check_ownership`        — warn if the user owns the game on
//                                 Steam/Epic so they're nudged to
//                                 support the developers first
//   2. `sources_search_game`    — fuzzy-match the game name against
//                                 every enabled source's cache
//   3. (optional) `torrent_select_save_path` — open folder picker
//   4. `torrent_add`            — enqueue the download
//
// State machine (the `step` field):
//   `checking`  → fetch ownership + search in parallel
//   `results`   → user picks a source result, then a save path
//   `starting`  → torrent_add in flight
//   `error`     → unrecoverable error (e.g. save path selection
//                 cancelled, torrent_add rejected)
//
// The view is composed from small units under `./download-modal`
// (header, toolbar, results pane, detail inspector, compare tray,
// queue preview, step states) so this file stays focused on the
// orchestration: state, backend calls, and keyboard handling.

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useDownloads } from "../../context/DownloadContext";
import { searchDownloadsStream } from "../../context/SourceContext";
import { useGames } from "../../context/GameContext";
import { useGameUpdateCheck } from "../../hooks/useGameUpdateCheck";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import { ConfirmModal } from "../ui/ConfirmModal";
import { type OwnershipResult } from "../../types/download";
import {
  classifyUri,
  extractReleaseGroups,
  extractSourceFilters,
  filterMatches,
  hosterNeedsBrowser,
  resolveSourceUri,
  sortMatches,
  webUrlFor,
} from "./helpers";
import type {
  DownloadStep,
  SortKey,
  DisplayMatch,
  CacheCheckStatus,
  PlatformFilter,
  DownloadTypeFilter,
} from "./types";
import type { DownloadSearchResult, SearchProgressEvent } from "../../types/plugins";
import { OwnershipBanner } from "./OwnershipBanner";
import { ConfidenceWarning } from "./ConfidenceWarning";
import { DownloadHeader } from "./DownloadHeader";
import { DownloadToolbar } from "./DownloadToolbar";
import { ResultsPane } from "./ResultsPane";
import { DetailPanel } from "./DetailPanel";
import { CompareTray } from "./CompareTray";
import { CompareDrawer } from "./CompareDrawer";
import { QueuePreview } from "./QueuePreview";
import { FileSelection } from "./FileSelection";
import {
  CheckingState,
  ErrorState,
  FetchingMetadataState,
  StartingStatus,
} from "./StepStates";
import { parseQuery } from "./searchQuery";
import { compareVersions, parseVersionFromTitle } from "../../utils/gameVersions";
import { rankByRecommendation, recommendationScore } from "./ranking";
import { useSourceReliability } from "./useSourceReliability";
import {
  DEFAULT_FILTERS,
  loadLastFilters,
  saveLastFilters,
  useFilterPresets,
  type DownloadFilters,
  type FilterPreset,
} from "./useFilterPresets";

export interface DownloadModalProps {
  /** The game to look up. Required. */
  gameName: string;
  /** Optional: when set, the new download is tagged with this
   *  GameContext id so the progress panel can deep-link back. */
  gameId?: string;
  /** Optional: poster of the game page this download started from,
   *  persisted on the download record so the Downloads page can show
   *  the same artwork. */
  gamePoster?: string;
  /** Optional: Steam AppID — used by the ownership check to look
   *  up Steam-specific ownership data. */
  steamAppId?: number;
  onClose: () => void;
}

const MAX_COMPARE = 3;

/** Best-effort target filename for a direct-link download. */
function directFileName(match: DisplayMatch, uri: string): string {
  let name = "download";
  try {
    const urlObj = new URL(uri);
    const lastSeg = urlObj.pathname.substring(urlObj.pathname.lastIndexOf("/") + 1);
    if (lastSeg && lastSeg.includes(".")) {
      name = lastSeg;
    } else {
      name = match.title.match(/\.[a-zA-Z0-9]{2,4}$/) ? match.title : `${match.title}.zip`;
    }
  } catch {
    name = match.title ? `${match.title}.zip` : "download.zip";
  }
  return name.replace(/[:*?"<>|\\/]/g, "").trim();
}

export default function DownloadModal({
  gameName,
  gameId,
  gamePoster,
  steamAppId,
  onClose,
}: DownloadModalProps) {
  const {
    addDownload,
    addDirectDownload,
    addDebridDownload,
    selectSavePath,
    activeDownloads,
    completedDownloads,
    startSelectedDownload,
    defaultDownloadPath,
    debridProvider,
    debridApiKey,
  } = useDownloads();
  const { games } = useGames();
  const { showToast } = useToast();
  const { t } = useLanguage();
  const reliability = useSourceReliability();
  const { presets, savePreset, deletePreset } = useFilterPresets();

  const currentGame = useMemo(() => {
    return games.find((g) => g.id === gameId || (gameName && g.name.toLowerCase() === gameName.toLowerCase())) ?? null;
  }, [games, gameId, gameName]);
  const { installedVersion } = useGameUpdateCheck(currentGame);

  const [step, setStep] = useState<DownloadStep>("checking");
  const [ownership, setOwnership] = useState<OwnershipResult | null>(null);
  const [matches, setMatches] = useState<DisplayMatch[]>([]);
  const [searchProgress, setSearchProgress] = useState<{
    completed: number;
    total: number;
    activeSource: string;
    isDone: boolean;
  } | null>(null);

  // Filters — seeded from the previous session so the modal reopens
  // where the user left off.
  const [sourceFilter, setSourceFilter] = useState<string>(() => loadLastFilters().sourceFilter);
  const [groupFilter, setGroupFilter] = useState<string>(() => loadLastFilters().groupFilter);
  const [searchQuery, setSearchQuery] = useState<string>(() => loadLastFilters().searchQuery);
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>(() => loadLastFilters().platformFilter);
  const [typeFilter, setTypeFilter] = useState<DownloadTypeFilter>(() => loadLastFilters().typeFilter);
  const [updatesOnly, setUpdatesOnly] = useState<boolean>(() => loadLastFilters().updatesOnly);
  const [sortBy, setSortBy] = useState<SortKey>(() => loadLastFilters().sortBy);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMirrorIndex, setSelectedMirrorIndex] = useState<number>(0);
  const [savePath, setSavePath] = useState<string | null>(() => {
    return (
      localStorage.getItem("gamelib-last-download-path") ||
      defaultDownloadPath ||
      null
    );
  });
  const [error, setError] = useState<string | null>(null);

  const [chooseFiles, setChooseFiles] = useState(false);
  const [autoExtract, setAutoExtract] = useState(false);
  const [compactTab, setCompactTab] = useState<"results" | "details">("results");
  const [useDebrid, setUseDebrid] = useState(false);
  const [cacheStatus, setCacheStatus] = useState<CacheCheckStatus>("idle");
  const cacheCheckSeq = useRef(0);
  const [tempTorrentId, setTempTorrentId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());
  const [fetchedFiles, setFetchedFiles] = useState<{ name: string; size: number }[] | null>(null);
  const [fetchMode, setFetchMode] = useState<"debrid" | "p2p" | null>(null);
  const [showWeakMatches, setShowWeakMatches] = useState(false);
  const [metadataTimedOut, setMetadataTimedOut] = useState(false);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  // ── Compare ───────────────────────────────────────────────────────
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);

  // ── Batch selection ───────────────────────────────────────────────
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set());
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  // ── Filter presets ────────────────────────────────────────────────
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  const [resolverSession, setResolverSession] = useState<{
    sessionId: string;
    status: "opening" | "capturing" | "done" | "error";
    partsCaptured: number;
  } | null>(null);
  const [needsBrowserHint, setNeedsBrowserHint] = useState(false);

  // Composite filter object shared by the toolbar + presets.
  const filters: DownloadFilters = useMemo(
    () => ({
      searchQuery,
      sourceFilter,
      groupFilter,
      platformFilter,
      typeFilter,
      updatesOnly,
      sortBy,
    }),
    [searchQuery, sourceFilter, groupFilter, platformFilter, typeFilter, updatesOnly, sortBy],
  );

  const applyFilters = useCallback((next: DownloadFilters) => {
    setSearchQuery(next.searchQuery);
    setSourceFilter(next.sourceFilter);
    setGroupFilter(next.groupFilter);
    setPlatformFilter(next.platformFilter);
    setTypeFilter(next.typeFilter);
    setUpdatesOnly(next.updatesOnly);
    setSortBy(next.sortBy);
  }, []);

  const handleFiltersChange = useCallback(
    (patch: Partial<DownloadFilters>) => {
      applyFilters({ ...filters, ...patch });
      setActivePresetId(null);
    },
    [filters, applyFilters],
  );

  useEffect(() => {
    saveLastFilters(filters);
  }, [filters]);

  const handleApplyPreset = useCallback(
    (preset: FilterPreset) => {
      applyFilters(preset.filters);
      setActivePresetId(preset.id);
    },
    [applyFilters],
  );

  const handleSavePreset = useCallback(
    (name: string) => {
      savePreset(name, filters);
      showToast(t("downloadModal.presetSaved"), "success");
    },
    [savePreset, filters, showToast, t],
  );

  const reliabilityFor = useCallback(
    (sourceName: string) => reliability.get(sourceName)?.successRate ?? null,
    [reliability],
  );

  // Available source filter options extracted from raw matches
  const sourceFilterOptions = useMemo(
    () => extractSourceFilters(matches, t),
    [matches, t],
  );

  const availableGroups = useMemo(() => extractReleaseGroups(matches), [matches]);

  // Filter raw matches by every active filter.
  const filteredMatches = useMemo(
    () =>
      filterMatches(
        matches,
        sourceFilter,
        searchQuery,
        platformFilter,
        typeFilter,
        groupFilter,
        updatesOnly,
        installedVersion,
      ),
    [
      matches,
      sourceFilter,
      searchQuery,
      platformFilter,
      typeFilter,
      groupFilter,
      updatesOnly,
      installedVersion,
    ],
  );

  const isSingleSourceFiltered =
    sourceFilter !== "all" &&
    sourceFilter !== "source" &&
    sourceFilter !== "sources" &&
    sourceFilter !== "plugin" &&
    sourceFilter !== "plugins";

  const parsedQuery = useMemo(() => parseQuery(searchQuery), [searchQuery]);

  // Releases carrying a version newer than the installed build.
  const newerCount = useMemo(() => {
    if (!installedVersion) return 0;
    return filteredMatches.filter((m) => {
      const ver = parseVersionFromTitle(m.title);
      return ver ? compareVersions(ver, installedVersion) > 0 : false;
    }).length;
  }, [filteredMatches, installedVersion]);

  // Collapse low-confidence source hits behind the weak-match accordion
  // unless the user is actively narrowing the list.
  const isSearching = Boolean(searchQuery.trim());
  const weakCount = useMemo(
    () => filteredMatches.filter((m) => m.matchScore < 0.4 && m.provider !== "plugin").length,
    [filteredMatches],
  );
  const visibleMatches = useMemo(() => {
    if (
      showWeakMatches ||
      isSingleSourceFiltered ||
      sourceFilter !== "all" ||
      groupFilter !== "all" ||
      isSearching
    ) {
      return filteredMatches;
    }
    return filteredMatches.filter((m) => m.matchScore >= 0.4 || m.provider === "plugin");
  }, [filteredMatches, showWeakMatches, isSingleSourceFiltered, sourceFilter, groupFilter, isSearching]);

  const scoreFor = useCallback(
    (m: DisplayMatch) =>
      recommendationScore(m, { reliability: reliabilityFor(m.sourceName) }),
    [reliabilityFor],
  );

  const sortedMatches = useMemo(
    () =>
      sortMatches(
        visibleMatches,
        sortBy,
        isSingleSourceFiltered,
        sortBy === "recommended" ? scoreFor : undefined,
      ),
    [visibleMatches, sortBy, isSingleSourceFiltered, scoreFor],
  );

  // Smart default: the top-ranked result is badged and auto-selected.
  const recommendedId = useMemo(() => {
    if (filteredMatches.length === 0) return null;
    const ranked = rankByRecommendation(filteredMatches, (m) => ({
      reliability: reliabilityFor(m.sourceName),
    }));
    return ranked[0]?.id ?? null;
  }, [filteredMatches, reliabilityFor]);

  const selectedMatch = useMemo(
    () => matches.find((m) => m.id === selectedId) ?? null,
    [matches, selectedId],
  );

  useEffect(() => {
    setSelectedMirrorIndex(0);
  }, [selectedId]);

  const selectedSourceUri = useMemo(
    () => (selectedMatch ? resolveSourceUri(selectedMatch, selectedMirrorIndex) : null),
    [selectedMatch, selectedMirrorIndex],
  );
  const selectedIsMagnet = useMemo(() => {
    if (!selectedMatch || !selectedSourceUri) return false;
    return classifyUri(selectedSourceUri, selectedMatch.torrentUrl).isMagnet;
  }, [selectedMatch, selectedSourceUri]);

  const fileSelectionEligible = useMemo(() => {
    if (!selectedMatch) return false;
    const uri = resolveSourceUri(selectedMatch, selectedMirrorIndex);
    if (!uri) return false;
    const { isMagnet, isTorrentFile } = classifyUri(uri, selectedMatch.torrentUrl);
    return isMagnet || isTorrentFile;
  }, [selectedMatch, selectedMirrorIndex]);
  const wantFileSelection = chooseFiles && fileSelectionEligible;

  const finalSavePath = useMemo(() => {
    const safeGameFolder = gameName.replace(/[:*?"<>|\\/]/g, "").trim();
    const normalizedSave = (savePath ?? "").replace(/\\/g, "/");
    return normalizedSave.endsWith(safeGameFolder)
      ? savePath ?? ""
      : `${normalizedSave}/${safeGameFolder}`.replace(/\\/g, "/");
  }, [savePath, gameName]);

  useEffect(() => {
    if (sortedMatches.length > 0) {
      if (!selectedId || !sortedMatches.some((m) => m.id === selectedId)) {
        setSelectedId(sortedMatches[0].id);
      }
    } else {
      setSelectedId(null);
    }
  }, [sortedMatches, selectedId]);

  const handleClearFilters = useCallback(() => {
    applyFilters({ ...DEFAULT_FILTERS, sortBy });
    setActivePresetId(null);
  }, [applyFilters, sortBy]);

  const debridConfigured = useMemo(() => {
    return debridProvider !== "none" && !!debridApiKey;
  }, [debridProvider, debridApiKey]);

  useEffect(() => {
    if (
      !useDebrid ||
      !debridConfigured ||
      !selectedIsMagnet ||
      !selectedSourceUri ||
      debridProvider === "none" ||
      !debridApiKey
    ) {
      setCacheStatus("idle");
      return;
    }

    const seq = ++cacheCheckSeq.current;
    setCacheStatus("checking");
    const timer = window.setTimeout(async () => {
      try {
        const res = await invoke<{ cached: boolean }>("debrid_check_cache", {
          provider: debridProvider,
          apikey: debridApiKey,
          magnet: selectedSourceUri,
        });
        if (seq === cacheCheckSeq.current) {
          setCacheStatus(res.cached ? "cached" : "uncached");
        }
      } catch (err) {
        console.debug("[DownloadModal] cache check failed:", err);
        if (seq === cacheCheckSeq.current) {
          setCacheStatus("error");
        }
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [useDebrid, debridConfigured, selectedIsMagnet, selectedSourceUri, debridProvider, debridApiKey]);

  const selectedWebUrl = useMemo(
    () => webUrlFor(selectedMatch ?? undefined),
    [selectedMatch],
  );

  useEffect(() => {
    const match = matches.find((m) => m.id === selectedId);
    if (!match) return;
    const { isDirect } = classifyUri(resolveSourceUri(match, 0), match.torrentUrl);
    if (isDirect && chooseFiles) setChooseFiles(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, matches, chooseFiles]);

  useEffect(() => {
    if (step === "fetching_metadata" || step === "file_selection") return;
    setFetchedFiles(null);
    setFetchMode(null);
  }, [selectedId, selectedMirrorIndex, useDebrid, step]);

  const metadataEnteredAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (step !== "fetching_metadata" || !tempTorrentId) {
      metadataEnteredAtRef.current = null;
      return;
    }
    if (metadataEnteredAtRef.current == null) {
      metadataEnteredAtRef.current = Date.now();
    }
    const onFilesReady = () => {
      const dl = activeDownloads.find((d) => d.id === tempTorrentId);
      if (dl && dl.files && dl.files.length > 0) {
        setSelectedFiles(new Set(dl.files.map((_, i) => i)));
        setStep("file_selection");
        return true;
      }
      return false;
    };
    if (onFilesReady()) return;
    const elapsed = Date.now() - metadataEnteredAtRef.current;
    const remaining = Math.max(0, 30_000 - elapsed);
    const timeout = window.setTimeout(() => {
      if (cancelledRef.current) return;
      invoke("torrent_remove", { id: tempTorrentId, deleteFiles: true }).catch((e) =>
        console.error("Failed to clean up timed-out temporary torrent:", e),
      );
      setTempTorrentId(null);
      setMetadataTimedOut(true);
      setError(t("downloadModal.metadataTimeout"));
      setStep("results");
    }, remaining);
    return () => window.clearTimeout(timeout);
  }, [activeDownloads, step, tempTorrentId, t]);

  const startAttemptedRef = useRef(false);
  const cancelledRef = useRef(false);
  const resultsListRef = useRef<HTMLDivElement | null>(null);
  const tempTorrentIdRef = useRef<string | null>(null);
  tempTorrentIdRef.current = tempTorrentId;
  const [elapsedSec, setElapsedSec] = useState(0);

  const namesKey = useMemo(
    () => games.map((g) => g.name).sort().join("\u0000"),
    [games],
  );
  const localLibraryNames = useMemo(
    () => games.map((g) => g.name),
    [namesKey],
  );

  // ── Step 1: ownership check + streaming source search in parallel ──
  const runSearch = useCallback(async () => {
    setStep("checking");
    setError(null);
    setOwnership(null);
    setMatches([]);
    setSelectedId(null);
    setSearchProgress(null);

    try {
      const ownershipPromise: Promise<OwnershipResult> = steamAppId != null
        ? invoke<OwnershipResult>("check_ownership_for_ids", {
            gameName,
            steamAppId,
            localLibraryNames,
          })
        : invoke<OwnershipResult>("check_ownership", {
            gameName,
            localLibraryNames,
          });

      ownershipPromise
        .then((own) => setOwnership(own))
        .catch((e) => console.error("[DownloadModal] ownership check failed:", e));

      const accumulatedRaw: DownloadSearchResult[] = [];

      await searchDownloadsStream(
        gameName,
        steamAppId,
        (progressEvt: SearchProgressEvent) => {
          setSearchProgress({
            completed: progressEvt.completedSources,
            total: progressEvt.totalSources,
            activeSource: progressEvt.sourceName,
            isDone: progressEvt.isDone,
          });

          if (progressEvt.newResults && progressEvt.newResults.length > 0) {
            accumulatedRaw.push(...progressEvt.newResults);
            const sourceItems = accumulatedRaw.filter((r) => r.provider !== "plugin");
            const pluginItems = accumulatedRaw.filter((r) => r.provider === "plugin");
            const ordered = [
              ...[...sourceItems].sort((a, b) => b.matchScore - a.matchScore),
              ...pluginItems,
            ];
            const withIds: DisplayMatch[] = ordered.map((m, i) => ({
              ...m,
              id: `${m.sourceId}::${m.title}::${i}`,
            }));
            setMatches(withIds);
            setStep((curr) => (curr === "checking" ? "results" : curr));
          }

          if (progressEvt.isDone) {
            setStep((curr) => (curr === "checking" ? "results" : curr));
          }
        },
      ).catch((e: unknown) => {
        console.error("[DownloadModal] searchDownloadsStream failed:", e);
        return [];
      });

      setStep((curr) => (curr === "checking" ? "results" : curr));
    } catch (err) {
      console.error("[DownloadModal] initial checks failed:", err);
      setError(String(err));
      setStep("error");
    }
  }, [gameName, steamAppId, searchDownloadsStream, localLibraryNames]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);

  const cancelFileListing = useCallback(() => {
    cancelledRef.current = true;
    if (tempTorrentIdRef.current) {
      invoke("torrent_remove", { id: tempTorrentIdRef.current, deleteFiles: true }).catch((e) =>
        console.error("Failed to remove list-only torrent:", e),
      );
    }
    setTempTorrentId(null);
    setFetchedFiles(null);
    setFetchMode(null);
    setStep("results");
  }, []);

  const handleCloseAttempt = useCallback(() => {
    if (batchRunning) return;
    if (step === "starting") {
      setConfirmCancelOpen(true);
      return;
    }
    if (step === "fetching_metadata" || step === "file_selection") {
      cancelFileListing();
      return;
    }
    onClose();
  }, [batchRunning, step, onClose, cancelFileListing]);

  const handleConfirmCancel = useCallback(() => {
    setConfirmCancelOpen(false);
    cancelledRef.current = true;
    onClose();
  }, [onClose]);

  const handlePickSavePath = useCallback(async () => {
    try {
      const path = await selectSavePath();
      if (path) {
        setSavePath(path);
        localStorage.setItem("gamelib-last-download-path", path);
      }
    } catch (err) {
      showToast(t("settings.couldNotOpenFolder", { error: String(err) }), "error");
    }
  }, [selectSavePath, showToast, t]);

  const handleOpenPage = useCallback(
    async (targetUrl?: string) => {
      const url = targetUrl || selectedWebUrl || selectedMatch?.detailUrl;
      if (!url) return;
      try {
        await openUrl(url);
        showToast(t("downloadModal.openedInDefaultBrowser"), "info");
      } catch (err) {
        console.error("[DownloadModal] open page failed:", err);
        showToast(String(err), "error");
      }
    },
    [selectedWebUrl, selectedMatch, showToast, t],
  );

  const handleOpenBrowserResolver = useCallback(
    async (targetUrl?: string) => {
      const urlToOpen =
        targetUrl ||
        selectedWebUrl ||
        (selectedMatch ? resolveSourceUri(selectedMatch, selectedMirrorIndex) : null) ||
        selectedMatch?.detailUrl;
      if (!urlToOpen) return;

      try {
        const res = await invoke<{ sessionId: string; ok: boolean; message?: string }>(
          "open_download_resolver",
          {
            url: urlToOpen,
            gameName,
            gameId: gameId ?? null,
            savePath: savePath ?? null,
            autoExtract,
            sourceName: selectedMatch?.sourceName || "Browser Resolver",
          },
        );

        if (!res.ok) {
          showToast(t("downloadModal.resolverAlreadyOpen"), "info");
          return;
        }
        setResolverSession({
          sessionId: res.sessionId,
          status: "opening",
          partsCaptured: 0,
        });
        showToast(t("downloadModal.resolverOpened"), "info");
      } catch (err) {
        console.error("[DownloadModal] resolver open failed:", err);
        setResolverSession(null);
        showToast(t("downloadModal.resolverError", { error: String(err) }), "error");
      }
    },
    [
      selectedWebUrl,
      selectedMatch,
      selectedMirrorIndex,
      gameName,
      gameId,
      savePath,
      autoExtract,
      showToast,
      t,
    ],
  );

  useEffect(() => {
    let unlistenIntercepted: UnlistenFn | undefined;
    let unlistenEnded: UnlistenFn | undefined;

    const subscribe = async () => {
      unlistenIntercepted = await listen<{
        sessionId: string;
        filename?: string;
        partIndex?: number;
        partsCaptured?: number;
      }>("download-intercepted", (event) => {
        const p = event.payload;
        setResolverSession((prev) => {
          if (!prev || prev.sessionId !== p.sessionId) return prev;
          return {
            ...prev,
            status: "capturing",
            partsCaptured: p.partsCaptured ?? p.partIndex ?? prev.partsCaptured + 1,
          };
        });
        if (p.filename) {
          showToast(t("downloadModal.resolverCaptured", { filename: p.filename }), "success");
        }
      });

      unlistenEnded = await listen<{
        sessionId: string;
        partsCaptured?: number;
        cancelled?: boolean;
      }>("resolver-session-ended", (event) => {
        const p = event.payload;
        setResolverSession((prev) => {
          if (!prev || prev.sessionId !== p.sessionId) return prev;
          return null;
        });
        if (p.cancelled && (p.partsCaptured ?? 0) === 0) {
          showToast(t("downloadModal.resolverNoCapture"), "info");
        }
      });
    };

    subscribe().catch((err) => {
      console.error("[DownloadModal] resolver event subscription failed:", err);
    });

    return () => {
      unlistenIntercepted?.();
      unlistenEnded?.();
    };
  }, [t, showToast]);

  const handleCloseResolver = useCallback(async () => {
    if (!resolverSession) return;
    const { sessionId } = resolverSession;
    try {
      await invoke("close_download_resolver", { sessionId });
    } catch (err) {
      console.error("[DownloadModal] close resolver failed:", err);
    }
  }, [resolverSession]);

  const handleStart = useCallback(async () => {
    if (step === "starting" || step === "fetching_metadata") return;
    cancelledRef.current = false;
    startAttemptedRef.current = true;
    setMetadataTimedOut(false);
    setNeedsBrowserHint(false);
    if (!selectedMatch) {
      setError(t("downloadModal.pickResult"));
      return;
    }
    const match = selectedMatch;
    const sourceUri = resolveSourceUri(match, selectedMirrorIndex);
    const webUrl = webUrlFor(match);
    if (!sourceUri && webUrl) {
      setError(null);
      await handleOpenPage(webUrl);
      return;
    }
    if (!savePath) {
      setError(t("downloadModal.chooseSave"));
      return;
    }
    if (!sourceUri) {
      setError(t("downloadModal.noLink"));
      return;
    }
    setError(null);
    try {
      const { isDirect, isMagnet } = classifyUri(sourceUri, match.torrentUrl);
      const debridActive = useDebrid && debridConfigured;

      if (isDirect) {
        setStep("starting");
        const targetFileName = directFileName(match, sourceUri);
        const fullSavePath = `${finalSavePath}/${targetFileName}`.replace(/\\/g, "/");

        try {
          await addDirectDownload(
            sourceUri,
            fullSavePath,
            gameId ?? null,
            match.sourceName,
            autoExtract,
            match.uris,
            debridActive,
            match.referer ?? null,
            gamePoster ?? null,
          );
        } catch (directErr) {
          if (hosterNeedsBrowser(sourceUri)) {
            setNeedsBrowserHint(true);
            setError(t("downloadModal.resolverNeedsBrowser"));
            setStep("results");
            return;
          }
          throw directErr;
        }
        showToast(
          t("downloadModal.downloadingDirect", { fileName: targetFileName, source: match.sourceName }),
          "success",
        );
        onClose();
        return;
      }

      if (debridActive && isMagnet) {
        setStep("starting");
        await addDebridDownload(sourceUri, finalSavePath, gameId ?? null, match.sourceName, autoExtract, gamePoster ?? null);
        showToast(
          t("downloadModal.downloadingDebrid", { title: match.title, source: match.sourceName }),
          "success",
        );
        onClose();
        return;
      }

      if (chooseFiles) {
        setStep("fetching_metadata");
        let newDl;
        try {
          newDl = await addDownload(sourceUri, finalSavePath, gameId ?? null, match.sourceName, autoExtract, true, match.referer ?? null, gamePoster ?? null);
        } catch (addErr) {
          if (cancelledRef.current) return;
          console.error("[DownloadModal] list-only add failed:", addErr);
          setError(t("downloadModal.couldNotStart", { error: String(addErr) }));
          setStep("results");
          return;
        }
        if (cancelledRef.current) {
          invoke("torrent_remove", { id: newDl.id, deleteFiles: true }).catch((e) =>
            console.error("Failed to clean up cancelled temporary torrent:", e)
          );
          return;
        }
        setTempTorrentId(newDl.id);
      } else {
        setStep("starting");
        await addDownload(sourceUri, finalSavePath, gameId ?? null, match.sourceName, autoExtract, false, match.referer ?? null, gamePoster ?? null);
        showToast(
          t("downloadModal.downloadingFrom", { title: match.title, source: match.sourceName }),
          "success",
        );
        onClose();
      }
    } catch (err) {
      if (cancelledRef.current) return;
      console.error("[DownloadModal] download failed:", err);
      setError(String(err));
      setStep("results");
    }
  }, [
    savePath,
    selectedMatch,
    selectedMirrorIndex,
    addDownload,
    addDirectDownload,
    addDebridDownload,
    finalSavePath,
    gameId,
    gamePoster,
    showToast,
    onClose,
    chooseFiles,
    autoExtract,
    useDebrid,
    debridConfigured,
    handleOpenPage,
    step,
    t,
  ]);

  const handleFetchFiles = useCallback(async () => {
    if (step === "starting" || step === "fetching_metadata" || step === "file_selection") return;
    if (!selectedMatch) {
      setError(t("downloadModal.pickResult"));
      return;
    }
    if (!savePath) {
      setError(t("downloadModal.chooseSave"));
      return;
    }
    const sourceUri = resolveSourceUri(selectedMatch, selectedMirrorIndex);
    if (!sourceUri) {
      setError(t("downloadModal.noLink"));
      return;
    }
    cancelledRef.current = false;
    startAttemptedRef.current = true;
    setError(null);
    setMetadataTimedOut(false);

    const { isMagnet, isTorrentFile } = classifyUri(sourceUri, selectedMatch.torrentUrl);
    const debridActive =
      useDebrid && debridConfigured && debridProvider !== "none" && !!debridApiKey;

    const showListing = (files: { name: string; size: number }[]) => {
      if (cancelledRef.current) return;
      setFetchedFiles(files);
      setSelectedFiles(new Set(files.map((_, i) => i)));
      setStep("file_selection");
    };

    if (isTorrentFile) {
      setStep("fetching_metadata");
      setFetchMode("p2p");
      try {
        const files = await invoke<{ name: string; size: number }[]>("torrent_list_files", {
          uri: sourceUri,
          referer: selectedMatch.referer ?? null,
        });
        showListing(files);
      } catch (err) {
        if (cancelledRef.current) return;
        console.error("[DownloadModal] torrent file list failed:", err);
        setError(String(err));
        setStep("results");
      }
      return;
    }

    if (isMagnet && debridActive) {
      setStep("fetching_metadata");
      setFetchMode("debrid");
      try {
        const res = await invoke<{ files: { name: string; size: number }[] }>(
          "debrid_list_files",
          {
            provider: debridProvider,
            apikey: debridApiKey,
            magnet: sourceUri,
          },
        );
        showListing(res.files);
      } catch (err) {
        if (cancelledRef.current) return;
        console.error("[DownloadModal] debrid file list failed:", err);
        setError(String(err));
        setStep("results");
      }
      return;
    }

    if (isMagnet || isTorrentFile) {
      setStep("fetching_metadata");
      setFetchMode("p2p");
      try {
        const dl = await addDownload(
          sourceUri,
          finalSavePath,
          gameId ?? null,
          selectedMatch.sourceName,
          autoExtract,
          true,
          selectedMatch.referer ?? null,
          gamePoster ?? null,
        );
        if (cancelledRef.current) {
          invoke("torrent_remove", { id: dl.id, deleteFiles: true }).catch((e) =>
            console.error("Failed to clean up cancelled temporary torrent:", e),
          );
          return;
        }
        setTempTorrentId(dl.id);
      } catch (addErr) {
        if (cancelledRef.current) return;
        console.error("[DownloadModal] list-only add failed:", addErr);
        setError(t("downloadModal.couldNotStart", { error: String(addErr) }));
        setStep("results");
      }
      return;
    }

    setError(t("downloadModal.noLink"));
  }, [
    step,
    selectedMatch,
    savePath,
    selectedMirrorIndex,
    useDebrid,
    debridConfigured,
    debridProvider,
    debridApiKey,
    finalSavePath,
    gameId,
    gamePoster,
    autoExtract,
    addDownload,
    t,
  ]);

  const handleConfirmFileSelection = useCallback(async () => {
    if (!selectedMatch) return;
    if (selectedFiles.size === 0) {
      setError(t("downloadModal.fileSelectRequired"));
      return;
    }
    const sourceUri = resolveSourceUri(selectedMatch, selectedMirrorIndex);
    if (!sourceUri) {
      setError(t("downloadModal.noLink"));
      return;
    }
    cancelledRef.current = false;
    setError(null);
    setStep("starting");
    try {
      if (fetchMode === "debrid") {
        await addDebridDownload(
          sourceUri,
          finalSavePath,
          gameId ?? null,
          selectedMatch.sourceName,
          autoExtract,
          gamePoster ?? null,
          Array.from(selectedFiles),
        );
        showToast(t("downloadModal.startedWithFileSelection"), "success");
        onClose();
        return;
      }
      let activeId = tempTorrentId;
      if (!activeId) {
        const dl = await addDownload(
          sourceUri,
          finalSavePath,
          gameId ?? null,
          selectedMatch.sourceName,
          autoExtract,
          true,
          selectedMatch.referer ?? null,
          gamePoster ?? null,
        );
        if (cancelledRef.current) {
          invoke("torrent_remove", { id: dl.id, deleteFiles: true }).catch((e) =>
            console.error("Failed to clean up cancelled temporary torrent:", e),
          );
          return;
        }
        activeId = dl.id;
        setTempTorrentId(activeId);
      }
      setTempTorrentId(null);
      await startSelectedDownload(activeId, Array.from(selectedFiles), autoExtract);
      showToast(t("downloadModal.startedWithFileSelection"), "success");
      onClose();
    } catch (err) {
      if (cancelledRef.current) return;
      console.error("[DownloadModal] file-selection download failed:", err);
      setError(String(err));
      setStep("file_selection");
    }
  }, [
    selectedMatch,
    selectedMirrorIndex,
    selectedFiles,
    fetchMode,
    tempTorrentId,
    finalSavePath,
    gameId,
    gamePoster,
    autoExtract,
    addDownload,
    addDebridDownload,
    startSelectedDownload,
    showToast,
    onClose,
    t,
  ]);

  useEffect(() => {
    if (startAttemptedRef.current) {
      setError(null);
      setNeedsBrowserHint(false);
    }
  }, [selectedId, savePath]);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (tempTorrentIdRef.current) {
        invoke("torrent_remove", { id: tempTorrentIdRef.current, deleteFiles: true }).catch((e) =>
          console.error("Failed to clean up temporary torrent on unmount:", e)
        );
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "starting") {
        if (step === "fetching_metadata" || step === "file_selection") {
          cancelFileListing();
        } else {
          handleCloseAttempt();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, handleCloseAttempt, cancelFileListing]);

  useEffect(() => {
    if (step !== "results" && step !== "starting") return;
    if (sortedMatches.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
      if (e.key === "Enter") {
        if (step === "results" && selectedId != null) {
          const target = e.target as HTMLElement | null;
          const isInteractive = !!target?.closest("input, select, textarea, button, a");
          const isResultCard = !!target?.closest(".dl-result-card, .dl-result-row");
          if (isResultCard && !isInteractive) handleStart();
        }
        return;
      }
      e.preventDefault();
      setSelectedId((prevId) => {
        const baseIdx = sortedMatches.findIndex((m) => m.id === prevId);
        const base = baseIdx < 0 ? -1 : baseIdx;
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const next = Math.min(sortedMatches.length - 1, Math.max(0, base + delta));
        const el = resultsListRef.current?.querySelectorAll(".dl-result-card")[next] as
          | HTMLElement
          | undefined;
        el?.scrollIntoView({ block: "nearest" });
        return sortedMatches[next].id;
      });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, sortedMatches, selectedId, handleStart]);

  useEffect(() => {
    if (step !== "starting") {
      setElapsedSec(0);
      return;
    }
    const id = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [step]);

  const targetGame = useMemo(() => {
    if (gameId) return games.find((g) => g.id === gameId);
    return games.find((g) => g.name.toLowerCase() === gameName.toLowerCase());
  }, [games, gameId, gameName]);

  const downloadedTitles = useMemo(() => {
    const set = new Set<string>();
    for (const d of completedDownloads) {
      if (d.name) set.add(d.name.trim().toLowerCase());
    }
    return set;
  }, [completedDownloads]);

  const isDownloaded = useCallback(
    (title: string) => downloadedTitles.has(title.trim().toLowerCase()),
    [downloadedTitles],
  );

  const queueDownloads = useMemo(
    () => [...activeDownloads, ...completedDownloads],
    [activeDownloads, completedDownloads],
  );

  const statusChip = useMemo(() => {
    switch (step) {
      case "checking":
        return { label: t("downloadModal.stepSearching"), tone: "muted" as const };
      case "results":
        return { label: t("downloadModal.stepReady"), tone: "success" as const };
      case "starting":
        return { label: t("downloadModal.stepStarting"), tone: "accent" as const };
      case "fetching_metadata":
        return { label: t("downloadModal.stepPreparing"), tone: "accent" as const };
      case "file_selection":
        return { label: t("downloadModal.stepSelectFiles"), tone: "accent" as const };
      case "error":
        return { label: t("downloadModal.stepError"), tone: "danger" as const };
    }
  }, [step, t]);

  const showResultsUI = step === "results" || step === "starting";
  const filesFetching = step === "fetching_metadata";
  const gameCover = targetGame?.coverArtUrl || targetGame?.iconUrl || gamePoster;

  const hasActiveFilters =
    sourceFilter !== "all" ||
    groupFilter !== "all" ||
    platformFilter !== "all" ||
    typeFilter !== "all" ||
    updatesOnly ||
    Boolean(searchQuery.trim());

  // ── Compare handlers ──────────────────────────────────────────────
  const compareIdSet = useMemo(() => new Set(compareIds), [compareIds]);
  const compareMatches = useMemo(
    () =>
      compareIds
        .map((id) => matches.find((m) => m.id === id))
        .filter((m): m is DisplayMatch => Boolean(m)),
    [compareIds, matches],
  );
  const handleToggleCompare = useCallback(
    (id: string) => {
      setCompareIds((prev) => {
        if (prev.includes(id)) return prev.filter((x) => x !== id);
        if (prev.length >= MAX_COMPARE) {
          showToast(t("downloadModal.compareHint"), "info");
          return prev;
        }
        return [...prev, id];
      });
    },
    [showToast, t],
  );

  // ── Batch handlers ────────────────────────────────────────────────
  const batchMatches = useMemo(
    () =>
      Array.from(batchSelected)
        .map((id) => matches.find((m) => m.id === id))
        .filter((m): m is DisplayMatch => Boolean(m)),
    [batchSelected, matches],
  );

  const handleToggleBatch = useCallback((id: string) => {
    setBatchSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleBatchMode = useCallback(() => {
    setBatchMode((prev) => {
      if (prev) setBatchSelected(new Set());
      return !prev;
    });
  }, []);

  const handleBatchDownload = useCallback(async () => {
    if (!savePath || batchMatches.length === 0) return;
    setBatchConfirmOpen(false);
    setBatchRunning(true);
    let ok = 0;
    let failed = 0;
    let current = 0;
    for (const match of batchMatches) {
      current += 1;
      setBatchProgress({ current, total: batchMatches.length });
      const sourceUri = resolveSourceUri(match, 0);
      if (!sourceUri) {
        failed += 1;
        continue;
      }
      try {
        const { isDirect, isMagnet, isTorrentFile } = classifyUri(sourceUri, match.torrentUrl);
        const debridActive = useDebrid && debridConfigured;
        if (isDirect) {
          const targetFileName = directFileName(match, sourceUri);
          const fullSavePath = `${finalSavePath}/${targetFileName}`.replace(/\\/g, "/");
          await addDirectDownload(
            sourceUri,
            fullSavePath,
            gameId ?? null,
            match.sourceName,
            autoExtract,
            match.uris,
            debridActive,
            match.referer ?? null,
            gamePoster ?? null,
          );
        } else if (isMagnet && debridActive) {
          await addDebridDownload(
            sourceUri,
            finalSavePath,
            gameId ?? null,
            match.sourceName,
            autoExtract,
            gamePoster ?? null,
          );
        } else if (isMagnet || isTorrentFile) {
          await addDownload(
            sourceUri,
            finalSavePath,
            gameId ?? null,
            match.sourceName,
            autoExtract,
            false,
            match.referer ?? null,
            gamePoster ?? null,
          );
        } else {
          failed += 1;
          continue;
        }
        ok += 1;
      } catch (err) {
        console.error("[DownloadModal] batch item failed:", err);
        failed += 1;
      }
    }
    setBatchRunning(false);
    setBatchProgress(null);
    setBatchSelected(new Set());
    if (failed === 0) {
      showToast(t("downloadModal.batchDone", { count: ok }), "success");
    } else {
      showToast(t("downloadModal.batchPartial", { ok, failed }), "error");
    }
    if (ok > 0) onClose();
  }, [
    savePath,
    batchMatches,
    useDebrid,
    debridConfigured,
    finalSavePath,
    gameId,
    gamePoster,
    autoExtract,
    addDirectDownload,
    addDebridDownload,
    addDownload,
    showToast,
    onClose,
    t,
  ]);

  return createPortal(
    <>
      <div
        className="modal-backdrop dl-modal-backdrop"
        onMouseDown={() => {
          if (step !== "starting" && !batchRunning) {
            handleCloseAttempt();
          }
        }}
      >
        <div
          className="modal dl-modal"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-label={t("downloadButton.download")}
        >
          {gameCover && (
            <div
              className="dl-modal-backdrop-glow"
              style={{ backgroundImage: `url(${gameCover})` }}
              aria-hidden
            />
          )}

          <DownloadHeader
            gameName={gameName}
            gameCover={gameCover}
            statusChip={statusChip}
            resultCount={matches.length}
            searchProgress={
              searchProgress && !searchProgress.isDone
                ? { completed: searchProgress.completed, total: searchProgress.total }
                : null
            }
            onClose={handleCloseAttempt}
          />

          <div className="dl-modal-body">
            <OwnershipBanner ownership={ownership} step={step} />

            {showResultsUI && <ConfidenceWarning matches={matches} gameName={gameName} />}

            {step === "checking" && <CheckingState searchProgress={searchProgress} />}

            {step === "error" && <ErrorState error={error} onRetry={() => runSearch()} />}

            {showResultsUI && (
              <>
                <div className="dl-compact-view-switch" role="tablist">
                  <button
                    type="button"
                    className={`dl-compact-switch-btn${compactTab === "results" ? " active" : ""}`}
                    onClick={() => setCompactTab("results")}
                    role="tab"
                    aria-selected={compactTab === "results"}
                  >
                    {t("downloadModal.sourceResults", {
                      count: matches.length,
                      s: matches.length !== 1 ? "s" : "",
                    })}
                  </button>
                  <button
                    type="button"
                    className={`dl-compact-switch-btn${compactTab === "details" ? " active" : ""}`}
                    onClick={() => setCompactTab("details")}
                    role="tab"
                    aria-selected={compactTab === "details"}
                  >
                    {t("downloadModal.configHeader")}
                  </button>
                </div>

                <div className="dl-results-split-layout">
                  <div
                    className={`dl-results-pane${compactTab !== "results" ? " compact-hidden" : ""}`}
                    ref={resultsListRef}
                  >
                    {matches.length > 0 && (
                      <DownloadToolbar
                        filters={filters}
                        onChange={handleFiltersChange}
                        onClearFilters={handleClearFilters}
                        sourceFilterOptions={sourceFilterOptions}
                        groupOptions={availableGroups}
                        installedVersion={installedVersion}
                        newerCount={newerCount}
                        shownCount={sortedMatches.length}
                        totalCount={matches.length}
                        presets={presets}
                        activePresetId={activePresetId}
                        onApplyPreset={handleApplyPreset}
                        onSavePreset={handleSavePreset}
                        onDeletePreset={deletePreset}
                        batchMode={batchMode}
                        onToggleBatchMode={handleToggleBatchMode}
                        selectedCount={batchSelected.size}
                      />
                    )}
                    <ResultsPane
                      matches={sortedMatches}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      isDownloaded={isDownloaded}
                      installedVersion={installedVersion}
                      highlightQuery={parsedQuery}
                      reliabilityFor={reliability.get}
                      recommendedId={recommendedId}
                      batchMode={batchMode}
                      batchSelected={batchSelected}
                      onToggleBatch={handleToggleBatch}
                      compareIds={compareIdSet}
                      onToggleCompare={handleToggleCompare}
                      totalRawMatchesCount={matches.length}
                      searchProgress={searchProgress}
                      hasActiveFilters={hasActiveFilters}
                      onClearFilters={handleClearFilters}
                      weakCount={weakCount}
                      showWeakMatches={showWeakMatches}
                      onToggleWeak={() => setShowWeakMatches((v) => !v)}
                    />
                  </div>

                  <div
                    className={`dl-detail-column${compactTab !== "details" ? " compact-hidden" : ""}`}
                  >
                    <DetailPanel
                      match={selectedMatch}
                      selectedMirrorIndex={selectedMirrorIndex}
                      onSelectMirror={setSelectedMirrorIndex}
                      installedVersion={installedVersion}
                      isDownloaded={isDownloaded}
                      savePath={savePath}
                      gameName={gameName}
                      onPickPath={handlePickSavePath}
                      autoExtract={autoExtract}
                      onAutoExtract={setAutoExtract}
                      chooseFiles={chooseFiles}
                      onChooseFiles={setChooseFiles}
                      onSelectFiles={handleFetchFiles}
                      isFetchingFiles={filesFetching}
                      useDebrid={useDebrid}
                      onUseDebrid={setUseDebrid}
                      debridConfigured={debridConfigured}
                      cacheStatus={cacheStatus}
                      onOpenPage={handleOpenPage}
                      onOpenBrowserResolver={handleOpenBrowserResolver}
                      resolverActive={!!resolverSession}
                      resolverPartsCaptured={resolverSession?.partsCaptured ?? 0}
                    />
                    <QueuePreview downloads={queueDownloads} />
                  </div>
                </div>
              </>
            )}

            {error && step === "results" && (
              <div className="dl-inline-error-banner" role="alert">
                <div className="dl-inline-error-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div className="dl-inline-error-body">
                  <p className="dl-inline-error-msg">{error}</p>
                </div>
                <div className="dl-inline-error-actions">
                  {needsBrowserHint && (
                    <Button variant="primary" size="sm" onClick={() => handleOpenBrowserResolver()}>
                      {t("downloadModal.resolverOpen")}
                    </Button>
                  )}
                  {metadataTimedOut && (
                    <Button variant="secondary" size="sm" onClick={() => handleStart()}>
                      {t("downloadModal.tryAgain")}
                    </Button>
                  )}
                </div>
              </div>
            )}

            {step === "fetching_metadata" && (() => {
              const live = activeDownloads.find((d) => d.id === tempTorrentId);
              return (
                <FetchingMetadataState
                  variant={tempTorrentId ? "swarm" : "fast"}
                  peers={live?.peers ?? 0}
                  seeds={live?.seeds ?? 0}
                />
              );
            })()}

            {step === "file_selection" && (
              <FileSelection
                files={fetchedFiles ?? activeDownloads.find((d) => d.id === tempTorrentId)?.files ?? []}
                selectedFiles={selectedFiles}
                onChange={setSelectedFiles}
              />
            )}

            {step === "starting" && (() => {
              const liveUri = resolveSourceUri(selectedMatch ?? undefined, selectedMirrorIndex);
              const live = liveUri
                ? activeDownloads.find((d) => d.sourceUri === liveUri)
                : undefined;
              return (
                <StartingStatus
                  match={selectedMatch}
                  elapsedSec={elapsedSec}
                  peers={live?.peers ?? 0}
                  seeds={live?.seeds ?? 0}
                />
              );
            })()}

            <CompareTray
              matches={compareMatches}
              onRemove={(id) => setCompareIds((prev) => prev.filter((x) => x !== id))}
              onClear={() => setCompareIds([])}
              onOpen={() => setCompareOpen(true)}
            />
          </div>

          {/* Modal Footer */}
          <div className="dl-modal-footer">
            <div className="dl-modal-footer-info">
              {batchRunning && batchProgress ? (
                <span className="dl-footer-count-text">
                  {t("downloadModal.batchStarting", {
                    current: batchProgress.current,
                    total: batchProgress.total,
                  })}
                </span>
              ) : step === "results" && matches.length > 0 ? (
                <span className="dl-footer-count-text">
                  {t("downloadModal.sourceResults", {
                    count: matches.length,
                    s: matches.length !== 1 ? "s" : "",
                  })}
                </span>
              ) : step === "file_selection" ? (
                <span className="dl-footer-count-text">
                  {t("downloadModal.totalFiles", {
                    count: (fetchedFiles ?? activeDownloads.find((d) => d.id === tempTorrentId)?.files ?? [])
                      .length,
                  })}
                </span>
              ) : (
                <span className="dl-footer-count-text">&nbsp;</span>
              )}
            </div>

            <div className="dl-modal-footer-actions">
              {resolverSession && (
                <Button
                  variant="secondary"
                  onClick={() => handleCloseResolver()}
                  leftIcon={
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  }
                >
                  {resolverSession.partsCaptured > 0
                    ? t("downloadModal.resolverDone")
                    : t("downloadModal.resolverClose")}
                </Button>
              )}

              {batchMode ? (
                <>
                  <Button variant="ghost" onClick={handleToggleBatchMode} disabled={batchRunning}>
                    {t("common.cancel")}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={batchSelected.size === 0 || batchRunning}
                    isLoading={batchRunning}
                    onClick={() => setBatchConfirmOpen(true)}
                  >
                    {t("downloadModal.batchDownload", { count: batchSelected.size })}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" onClick={() => handleCloseAttempt()}>
                    {t("common.cancel")}
                  </Button>
                  {step === "file_selection" ? (
                    <Button
                      variant="primary"
                      onClick={handleConfirmFileSelection}
                      disabled={selectedFiles.size === 0}
                    >
                      {t("downloadModal.confirmDownload", { count: selectedFiles.size })}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={wantFileSelection ? handleFetchFiles : handleStart}
                      disabled={
                        step === "starting" ||
                        step === "checking" ||
                        step === "fetching_metadata" ||
                        selectedMatch == null
                      }
                      isLoading={step === "starting"}
                      leftIcon={
                        step !== "starting" ? (
                          selectedWebUrl ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <polyline points="8 17 12 21 16 17" />
                              <line x1="12" y1="12" x2="12" y2="21" />
                              <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
                            </svg>
                          )
                        ) : undefined
                      }
                    >
                      {(() => {
                        if (selectedWebUrl) return t("downloadModal.openInBrowser");
                        if (wantFileSelection) return t("downloadModal.selectFiles");
                        return t("downloadModal.startDownload");
                      })()}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {compareOpen && (
        <CompareDrawer
          matches={compareMatches}
          onClose={() => setCompareOpen(false)}
          onSelect={setSelectedId}
          installedVersion={installedVersion}
          reliabilityFor={reliability.get}
        />
      )}

      <ConfirmModal
        open={confirmCancelOpen}
        title={t("downloadModal.cancelTitle")}
        message={t("downloadModal.cancelBody")}
        confirmLabel={t("downloadModal.cancelDownload")}
        cancelLabel={t("downloadModal.keepWaiting")}
        onConfirm={handleConfirmCancel}
        onCancel={() => setConfirmCancelOpen(false)}
      />

      <ConfirmModal
        open={batchConfirmOpen}
        title={t("downloadModal.batchConfirmTitle", { count: batchMatches.length })}
        message={t("downloadModal.batchConfirmBody", { count: batchMatches.length })}
        confirmLabel={t("downloadModal.batchConfirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleBatchDownload}
        onCancel={() => setBatchConfirmOpen(false)}
      />
    </>,
    document.body,
  );
}
