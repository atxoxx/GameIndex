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
// The component is intentionally not routable — it's a transient
// overlay that calls `onClose` to dismiss itself. The parent owns
// the open/close state.
//
// The view is split into small presentational sub-components under
// `./download-modal` (results list, mirror picker, options, save-path
// picker, file selection, step states) so this file stays focused on
// the orchestration: state, backend calls, and keyboard handling.

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useDownloads } from "../../context/DownloadContext";
import { searchDownloadsStream } from "../../context/SourceContext";
import { useGames } from "../../context/GameContext";
import { useToast } from "../../context/ToastContext";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import { ConfirmModal } from "../ui/ConfirmModal";
import { type OwnershipResult } from "../../types/download";
import {
  classifyUri,
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
import { ResultsList } from "./ResultsList";
import { DetailPanel } from "./DetailPanel";
import { FileSelection } from "./FileSelection";
import {
  CheckingState,
  ErrorState,
  FetchingMetadataState,
  StartingStatus,
} from "./StepStates";

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

  const [step, setStep] = useState<DownloadStep>("checking");
  const [ownership, setOwnership] = useState<OwnershipResult | null>(null);
  const [matches, setMatches] = useState<DisplayMatch[]>([]);
  const [searchProgress, setSearchProgress] = useState<{
    completed: number;
    total: number;
    activeSource: string;
    isDone: boolean;
  } | null>(null);
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  // Broad PC/console switch + download-method filter for the results.
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [typeFilter, setTypeFilter] = useState<DownloadTypeFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMirrorIndex, setSelectedMirrorIndex] = useState<number>(0);
  const [sortBy, setSortBy] = useState<SortKey>("date");
  // Reflected copy of `sortBy` so `runSearch` can pick the default
  // selected row from the currently-sorted list without re-running the
  // search every time the user changes the sort.
  const sortByRef = useRef<SortKey>(sortBy);
  sortByRef.current = sortBy;
  const [savePath, setSavePath] = useState<string | null>(() => {
    // Prefer the last-used path (so repeated downloads stay in one
    // place), then fall back to the configured default download
    // folder from Settings, then to "no path picked yet".
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
  // Route magnets/direct links through the configured debrid service.
  const [useDebrid, setUseDebrid] = useState(false);
  // Cache probe for the selected magnet (only while the debrid toggle
  // is on and a magnet is selected).
  const [cacheStatus, setCacheStatus] = useState<CacheCheckStatus>("idle");
  const cacheCheckSeq = useRef(0);
  const [tempTorrentId, setTempTorrentId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());
  // Fast file list for the "Choose files" flow: when set, the selection
  // screen reads from here instead of a live temp torrent. `fetchMode`
  // records how the confirmed selection must be started ("debrid" = via
  // the AllDebrid provider, "p2p" = via the torrent engine).
  const [fetchedFiles, setFetchedFiles] = useState<{ name: string; size: number }[] | null>(null);
  const [fetchMode, setFetchMode] = useState<"debrid" | "p2p" | null>(null);
  // Collapse low-confidence matches (score < 0.4) behind a toggle so
  // the list stays focused on the most likely correct title.
  const [showWeakMatches, setShowWeakMatches] = useState(false);
  // True after the 30s metadata fetch times out, so we can offer an
  // explicit "Try again" affordance rather than just an error string.
  const [metadataTimedOut, setMetadataTimedOut] = useState(false);
  // Confirm-before-close guard shown while a download is starting.
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  // In-app browser resolver session. Non-blocking (FR-5): the invoke
  // returns a session id immediately and captured files stream back over
  // the `download-intercepted` event while the window stays open for
  // multi-part releases (FR-4). Null while no session is active.
  const [resolverSession, setResolverSession] = useState<{
    sessionId: string;
    status: "opening" | "capturing" | "done" | "error";
    partsCaptured: number;
  } | null>(null);
  // Set when a direct Start hard-fails on a hoster that needs a browser
  // (G9) so the inline error shows a guided next step to the resolver.
  const [needsBrowserHint, setNeedsBrowserHint] = useState(false);

  // Available source filter options extracted from raw matches
  const sourceFilterOptions = useMemo(
    () => extractSourceFilters(matches, t),
    [matches, t],
  );

  // Filter raw matches by selected source, platform, type, scene group and search query
  const filteredMatches = useMemo(
    () => filterMatches(matches, sourceFilter, searchQuery, platformFilter, typeFilter, groupFilter),
    [matches, sourceFilter, searchQuery, platformFilter, typeFilter, groupFilter],
  );

  const isSingleSourceFiltered =
    sourceFilter !== "all" &&
    sourceFilter !== "source" &&
    sourceFilter !== "sources" &&
    sourceFilter !== "plugin" &&
    sourceFilter !== "plugins";

  // Display order (re-sorted copy of `filteredMatches`) and the currently
  // selected match object. Selection is id-based so re-sorting never
  // desyncs the highlight from the underlying match.
  const sortedMatches = useMemo(
    () => sortMatches(filteredMatches, sortBy, isSingleSourceFiltered),
    [filteredMatches, sortBy, isSingleSourceFiltered],
  );
  const selectedMatch = useMemo(
    () => matches.find((m) => m.id === selectedId) ?? null,
    [matches, selectedId],
  );

  // Reset mirror selection when switching result rows
  useEffect(() => {
    setSelectedMirrorIndex(0);
  }, [selectedId]);

  // Resolved URI of the selected result, memoised so the cache-check
  // effect doesn't re-fire on every search-progress emission (which
  // rebuilds the `matches` array even when the URI is unchanged).
  const selectedSourceUri = useMemo(
    () => (selectedMatch ? resolveSourceUri(selectedMatch, selectedMirrorIndex) : null),
    [selectedMatch, selectedMirrorIndex],
  );
  const selectedIsMagnet = useMemo(() => {
    if (!selectedMatch || !selectedSourceUri) return false;
    return classifyUri(selectedSourceUri, selectedMatch.torrentUrl).isMagnet;
  }, [selectedMatch, selectedSourceUri]);

  // Whether the selected result supports per-file selection (any
  // magnet/.torrent source — direct links and web-only hits do not).
  const fileSelectionEligible = useMemo(() => {
    if (!selectedMatch) return false;
    const uri = resolveSourceUri(selectedMatch, selectedMirrorIndex);
    if (!uri) return false;
    const { isMagnet, isTorrentFile } = classifyUri(uri, selectedMatch.torrentUrl);
    return isMagnet || isTorrentFile;
  }, [selectedMatch, selectedMirrorIndex]);
  const wantFileSelection = chooseFiles && fileSelectionEligible;

  // Game subfolder path appended to the chosen save folder — shared by
  // the start and the file-listing flows so both target the same place.
  const finalSavePath = useMemo(() => {
    const safeGameFolder = gameName.replace(/[:*?"<>|\\/]/g, "").trim();
    const normalizedSave = (savePath ?? "").replace(/\\/g, "/");
    return normalizedSave.endsWith(safeGameFolder)
      ? savePath ?? ""
      : `${normalizedSave}/${safeGameFolder}`.replace(/\\/g, "/");
  }, [savePath, gameName]);

  // Keep selection aligned with the visible sorted matches when filtering
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
    setSourceFilter("all");
    setGroupFilter("all");
    setSearchQuery("");
    setPlatformFilter("all");
    setTypeFilter("all");
  }, []);

  // Whether an AllDebrid/TorBox key is configured in Settings. Read once
  // per mount — the modal is reopened fresh for each download flow.
  const debridConfigured = useMemo(() => {
    return debridProvider !== "none" && !!debridApiKey;
  }, [debridProvider, debridApiKey]);

  // Probe the debrid provider for cache status whenever the selected
  // magnet changes (debounced, and only while the debrid toggle is on).
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

  // Web-link-only results (no magnet/torrent/direct URI) open the site
  // in the browser rather than starting a download.
  const selectedWebUrl = useMemo(
    () => webUrlFor(selectedMatch ?? undefined),
    [selectedMatch],
  );

  // Drop the "Choose files" flag whenever the resolved URI is no longer
  // a torrent (e.g. a direct-link result) so the hidden checkbox can't
  // leave the flag stale across source types.
  useEffect(() => {
    const match = matches.find((m) => m.id === selectedId);
    if (!match) return;
    const { isDirect } = classifyUri(
      resolveSourceUri(match, 0),
      match.torrentUrl,
    );
    if (isDirect && chooseFiles) setChooseFiles(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, matches, chooseFiles]);
  // A fetched file list belongs to one specific source + mirror (+ the
  // debrid toggle state at fetch time). Switching any of those while
  // back on the results screen invalidates the listing so the next
  // fetch starts clean.
  useEffect(() => {
    if (step === "fetching_metadata" || step === "file_selection") return;
    setFetchedFiles(null);
    setFetchMode(null);
  }, [selectedId, selectedMirrorIndex, useDebrid, step]);
  // Marks the moment we entered the metadata-fetch phase so the 30s
  // timeout below is measured from first entry, not from the latest
  // progress poll (which would otherwise keep re-arming and never fire).
  const metadataEnteredAtRef = useRef<number | null>(null);

  // Wait for metadata loaded to show file checklist. The engine emits a
  // `download-progress` event once peers return the file list; when that
  // happens we flip to `file_selection`. If the swarm is dead / the
  // source is unreachable the event may never come, so we also arm a
  // timeout that bails back to `results` with a clear error instead of
  // hanging on the spinner forever.
  useEffect(() => {
    if (step !== "fetching_metadata" || !tempTorrentId) {
      metadataEnteredAtRef.current = null;
      return;
    }
    // Arm the watchdog once, on first entry into this step.
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
    // Only time out against the original entry timestamp, so the 2s
    // progress polls that re-run this effect don't keep resetting it.
    const elapsed = Date.now() - metadataEnteredAtRef.current;
    const remaining = Math.max(0, 30_000 - elapsed);
    const timeout = window.setTimeout(() => {
      if (cancelledRef.current) return;
      // Clean up the orphaned list-only torrent.
      invoke("torrent_remove", { id: tempTorrentId, deleteFiles: true }).catch((e) =>
        console.error("Failed to clean up timed-out temporary torrent:", e),
      );
      setTempTorrentId(null);
      setMetadataTimedOut(true);
      setError(t('downloadModal.metadataTimeout'));
      setStep("results");
    }, remaining);
    return () => window.clearTimeout(timeout);
  }, [activeDownloads, step, tempTorrentId]);
  // Suppress the "user has not picked a save path" inline error
  // until they've tried to start at least once.
  const startAttemptedRef = useRef(false);
  const cancelledRef = useRef(false);
  // Ref to the results list container so we can scroll the keyboard-
  // highlighted row into view as the user arrows through results.
  const resultsListRef = useRef<HTMLDivElement | null>(null);
  const tempTorrentIdRef = useRef<string | null>(null);
  tempTorrentIdRef.current = tempTorrentId;
  // Seconds elapsed since the user clicked Start. Reset to 0 the
  // moment `step` leaves "starting" (success → modal closes, or
  // failure → step becomes "results" again). The footer renders
  // this as a "Starting for Ns…" hint so the user knows the
  // engine is still working, not stalled — especially important
  // for `http(s)://.torrent` sources where librqbit has to
  // download the torrent file before it can return.
  const [elapsedSec, setElapsedSec] = useState(0);

  // Snapshot the local library name list. The Rust `check_ownership*`
  // commands require a `local_library_names` argument; we pass the
  // names (not the whole Game records) so the wire payload stays
  // tiny even for a 5000-game library. The names array only needs
  // to re-snapshot when the *set* of names actually changes, so we
  // build a set-equality key (sorted + NUL-joined) that is
  // order-independent and immune to newline collisions in names.
  const namesKey = useMemo(
    () => games.map((g) => g.name).sort().join("\u0000"),
    [games],
  );
  const localLibraryNames = useMemo(
    () => games.map((g) => g.name),
    [namesKey],
  );

  // ── Step 1: ownership check + streaming source search in parallel ──
  // Extracted into a callback so the Retry button can re-run it after
  // an error or a dead-swarm timeout.
  const runSearch = useCallback(async () => {
    setStep("checking");
    setError(null);
    setOwnership(null);
    setMatches([]);
    setSelectedId(null);
    setSearchProgress(null);

    try {
      // 1. Check ownership in background so slow store checks don't block
      // the search results from displaying immediately.
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

      // 2. Stream results live as each source / plugin completes
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
            // Sort source items by match score, keep plugin items newest-first
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
            // Switch to results view as soon as files start arriving
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

      // Ensure we switch to results step once the stream completes
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

  // ── Helpers ──────────────────────────────────────────────────────
  // Abort an in-flight or completed file listing: remove any temp
  // torrent and return to the results screen. Shared by the close path,
  // the Escape handler, and the metadata watchdog.
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

  // Centralised close attempt: when a download is still starting we
  // confirm with the user before tearing it down (which would orphan the
  // temporary torrent). During `fetching_metadata` / `file_selection`
  // the listing is cancelled and we return to the results step so the
  // user can pick another source rather than losing the whole flow.
  const handleCloseAttempt = useCallback(() => {
    if (step === "starting") {
      setConfirmCancelOpen(true);
      return;
    }
    if (step === "fetching_metadata" || step === "file_selection") {
      cancelFileListing();
      return;
    }
    onClose();
  }, [step, onClose, cancelFileListing]);

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
      showToast(t('settings.couldNotOpenFolder', { error: String(err) }), "error");
    }
  }, [selectSavePath, showToast]);

  // Open the selected result's source page in the default OS browser
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

  // Fire-and-forget resolver open (FR-5): returns a session id immediately
  // and the modal stays open so the user keeps context while the webview
  // solves the hoster flow. Results stream back via events (see the
  // subscription effect below).
  const handleOpenBrowserResolver = useCallback(
    async (targetUrl?: string) => {
      const urlToOpen =
        targetUrl ||
        selectedWebUrl ||
        (selectedMatch
          ? resolveSourceUri(selectedMatch, selectedMirrorIndex)
          : null) ||
        selectedMatch?.detailUrl;
      if (!urlToOpen) return;

      try {
        const res = await invoke<{
          sessionId: string;
          ok: boolean;
          message?: string;
        }>("open_download_resolver", {
          url: urlToOpen,
          gameName,
          gameId: gameId ?? null,
          savePath: savePath ?? null,
          autoExtract,
          sourceName: selectedMatch?.sourceName || "Browser Resolver",
        });

        if (!res.ok) {
          // FR-7: a resolver window is already open — surface that instead
          // of silently replacing it.
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
        showToast(
          t("downloadModal.resolverError", { error: String(err) }),
          "error",
        );
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

  // Subscribe to resolver events so captured parts stream into the session
  // state (and toast) without blocking the modal (FR-4, G3). The session
  // ends cleanly when the window closes, either from the user's X or the
  // "Done" action below.
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
            partsCaptured:
              p.partsCaptured ?? p.partIndex ?? prev.partsCaptured + 1,
          };
        });
        if (p.filename) {
          showToast(
            t("downloadModal.resolverCaptured", { filename: p.filename }),
            "success",
          );
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

  // Close the active resolver window ("Done") and end the session cleanly.
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
    // Guard against double-firing (rapid clicks / Enter key) while a
    // download or metadata fetch is already in flight.
    if (step === "starting" || step === "fetching_metadata") return;
    cancelledRef.current = false;
    startAttemptedRef.current = true;
    setMetadataTimedOut(false);
    setNeedsBrowserHint(false);
    if (!selectedMatch) {
      setError(t('downloadModal.pickResult'));
      return;
    }
    const match = selectedMatch;
    // Single source of truth for which URI the user wants — the selected
    // mirror URI, falling back to the magnet.
    const sourceUri = resolveSourceUri(match, selectedMirrorIndex);
    // Web-link-only / protected results open in the default OS browser
    // so the user can complete the anti-bot challenge and download.
    const webUrl = webUrlFor(match);
    if (!sourceUri && webUrl) {
      setError(null);
      await handleOpenPage(webUrl);
      return;
    }
    if (!savePath) {
      setError(t('downloadModal.chooseSave'));
      return;
    }
    if (!sourceUri) {
      setError(t('downloadModal.noLink'));
      return;
    }
    setError(null);
    try {
      const { isDirect, isMagnet } = classifyUri(sourceUri, match.torrentUrl);
      const debridActive = useDebrid && debridConfigured;

      if (isDirect) {
        setStep("starting");
        let targetFileName = "download";
        try {
          const urlObj = new URL(sourceUri);
          const pathname = urlObj.pathname;
          const lastSeg = pathname.substring(pathname.lastIndexOf('/') + 1);
          if (lastSeg && lastSeg.includes('.')) {
            targetFileName = lastSeg;
          } else {
            const titleMatch = match.title.match(/\.[a-zA-Z0-9]{2,4}$/);
            if (titleMatch) {
              targetFileName = match.title;
            } else {
              targetFileName = match.title + ".zip";
            }
          }
        } catch {
          targetFileName = match.title + ".zip";
        }

        targetFileName = targetFileName.replace(/[:*?"<>|\\/]/g, "").trim();
        const fullSavePath = `${finalSavePath}/${targetFileName}`.replace(/\\/g, "/");

        // `debridActive` flips direct links onto the debrid-unrestrict
        // path; otherwise they stream straight from the hoster.
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
          // G9: hosters that gate the file behind a browser challenge
          // (gofile, datanodes, vikingfile, filecrypt) hard-fail the
          // fast path — surface a guided next step instead of a raw error.
          if (hosterNeedsBrowser(sourceUri)) {
            setNeedsBrowserHint(true);
            setError(t('downloadModal.resolverNeedsBrowser'));
            setStep("results");
            return;
          }
          throw directErr;
        }
        showToast(
          t('downloadModal.downloadingDirect', { fileName: targetFileName, source: match.sourceName }),
          "success",
        );
        onClose();
        return;
      }

      // Magnet + debrid toggle: upload to the debrid provider and pull
      // the resolved link over HTTP (no P2P swarm involved).
      if (debridActive && isMagnet) {
        setStep("starting");
        await addDebridDownload(sourceUri, finalSavePath, gameId ?? null, match.sourceName, autoExtract, gamePoster ?? null);
        showToast(
          t('downloadModal.downloadingDebrid', { title: match.title, source: match.sourceName }),
          "success",
        );
        onClose();
        return;
      }

      // Everything else (`magnet` without debrid, or a `.torrent` file
      // URL) stays on the P2P torrent engine via `torrent_add`.
      if (chooseFiles) {
        setStep("fetching_metadata");
        let newDl;
        try {
          newDl = await addDownload(sourceUri, finalSavePath, gameId ?? null, match.sourceName, autoExtract, true, match.referer ?? null, gamePoster ?? null);
        } catch (addErr) {
          if (cancelledRef.current) return;
          console.error("[DownloadModal] list-only add failed:", addErr);
          setError(t('downloadModal.couldNotStart', { error: String(addErr) }));
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
          t('downloadModal.downloadingFrom', { title: match.title, source: match.sourceName }),
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
    matches,
    addDownload,
    addDirectDownload,
    addDebridDownload,
    gameId,
    gamePoster,
    showToast,
    onClose,
    chooseFiles,
    autoExtract,
    useDebrid,
    debridConfigured,
    gameName,
    step,
    selectedId,
    selectedMirrorIndex,
  ]);

  // ── "Choose files" flow ────────────────────────────────────────────
  // Fetch the file list of the selected source WITHOUT starting a
  // download, then hand the user the selection screen. Fast paths:
  //   • `.torrent` link → parse the metadata embedded in the torrent
  //     file (instant — no swarm contact needed)
  //   • AllDebrid on    → ask the provider to list the magnet's files
  //     (one API round-trip; cached magnets answer immediately)
  // Slow fallback (kept for plain magnets without debrid): register a
  // list-only temp torrent and let librqbit pull the metadata from the
  // swarm, exactly like the old flow.
  const handleFetchFiles = useCallback(async () => {
    if (step === "starting" || step === "fetching_metadata" || step === "file_selection") return;
    if (!selectedMatch) {
      setError(t('downloadModal.pickResult'));
      return;
    }
    if (!savePath) {
      setError(t('downloadModal.chooseSave'));
      return;
    }
    const sourceUri = resolveSourceUri(selectedMatch, selectedMirrorIndex);
    if (!sourceUri) {
      setError(t('downloadModal.noLink'));
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

    // Fast path 1 — `.torrent` files embed their file list: parse the
    // metadata directly, no swarm needed.
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

    // Fast path 2 — magnets route through AllDebrid when the toggle is
    // on and a key is configured. The probe magnet is removed from the
    // account automatically after listing.
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

    // Fallback — plain magnet without debrid: register a list-only temp
    // torrent so librqbit fetches the metadata from the swarm. Files
    // arrive via the `download-progress` event (see the watchdog effect).
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
        setError(t('downloadModal.couldNotStart', { error: String(addErr) }));
        setStep("results");
      }
      return;
    }

    setError(t('downloadModal.noLink'));
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

  // User confirmed a file selection on the `file_selection` screen.
  //   • debrid → hand the magnet + picked indices to the provider flow
  //     (the backend filters the resolved files to the selection).
  //   • p2p    → the temp torrent is already registered (swarm path) or
  //     registered now (fast `.torrent` parse path), then started
  //     restricted to the picked indices.
  const handleConfirmFileSelection = useCallback(async () => {
    if (!selectedMatch) return;
    if (selectedFiles.size === 0) {
      setError(t('downloadModal.fileSelectRequired'));
      return;
    }
    const sourceUri = resolveSourceUri(selectedMatch, selectedMirrorIndex);
    if (!sourceUri) {
      setError(t('downloadModal.noLink'));
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
        showToast(t('downloadModal.startedWithFileSelection'), "success");
        onClose();
        return;
      }
      // P2P path: `torrent_start_selected` needs a registered torrent id.
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
        // Keep the id so a failed start can retry against the same
        // registered torrent instead of re-adding from scratch.
        setTempTorrentId(activeId);
      }
      // Null out the temp reference BEFORE starting so the unmount
      // cleanup can never remove the now-active download.
      setTempTorrentId(null);
      await startSelectedDownload(activeId, Array.from(selectedFiles), autoExtract);
      showToast(t('downloadModal.startedWithFileSelection'), "success");
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

  // Clear the inline error when the user actively changes their
  // selection or save path. Note: `step` is intentionally NOT in
  // the dep array — `handleStart`'s catch block sets `step` to
  // "results" right after setting the error, and we don't want
  // this effect to immediately wipe that error. Only user-driven
  // changes (selectedIndex / savePath) should clear it.
  useEffect(() => {
    if (startAttemptedRef.current) {
      setError(null);
      setNeedsBrowserHint(false);
    }
  }, [selectedId, savePath]);

  // Clean up any temporary listing-only torrent on unmount (e.g. backdrop clicks, escape)
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

  // Escape to close the modal — except when starting
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

  // Arrow-key navigation through the results list
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
        const el = resultsListRef.current?.querySelectorAll(".dl-result-card, .dl-result-row")[next] as
          | HTMLElement
          | undefined;
        el?.scrollIntoView({ block: "nearest" });
        return sortedMatches[next].id;
      });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, sortedMatches, selectedId, handleStart]);

  // Elapsed-seconds counter during download initiation
  useEffect(() => {
    if (step !== "starting") {
      setElapsedSec(0);
      return;
    }
    const id = window.setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [step]);

  // Target Game lookup for rich header poster and metadata
  const targetGame = useMemo(() => {
    if (gameId) return games.find((g) => g.id === gameId);
    return games.find((g) => g.name.toLowerCase() === gameName.toLowerCase());
  }, [games, gameId, gameName]);

  // Titles of completed downloads for badge indicators
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

  const statusChip = useMemo(() => {
    switch (step) {
      case "checking":
        return { label: t('downloadModal.stepSearching'), tone: "muted" as const };
      case "results":
        return { label: t('downloadModal.stepReady'), tone: "success" as const };
      case "starting":
        return { label: t('downloadModal.stepStarting'), tone: "accent" as const };
      case "fetching_metadata":
        return { label: t('downloadModal.stepPreparing'), tone: "accent" as const };
      case "file_selection":
        return { label: t('downloadModal.stepSelectFiles'), tone: "accent" as const };
      case "error":
        return { label: t('downloadModal.stepError'), tone: "danger" as const };
    }
  }, [step, t]);

  const showResultsUI = step === "results" || step === "starting";
  // File-list fetch in flight (parsing a .torrent / asking AllDebrid /
  // waiting for swarm metadata). Computed at top level so it stays a
  // plain boolean inside the step-narrowed JSX below.
  const filesFetching = step === "fetching_metadata";
  const gameCover = targetGame?.coverArtUrl || targetGame?.iconUrl || gamePoster;

  return createPortal(
    <>
      <div
        className="modal-backdrop dl-modal-backdrop"
        onMouseDown={() => {
          if (step !== "starting") {
            handleCloseAttempt();
          }
        }}
      >
        <div
          className="modal dl-modal"
          onMouseDown={(e) => e.stopPropagation()}
          role="dialog"
          aria-label={t('downloadButton.download')}
        >
          {/* Ambient Backdrop Artwork */}
          {gameCover && (
            <div
              className="dl-modal-backdrop-glow"
              style={{ backgroundImage: `url(${gameCover})` }}
              aria-hidden
            />
          )}

          {/* Modal Header */}
          <div className="dl-modal-header">
            <div className="dl-modal-header-game">
              {gameCover ? (
                <img
                  src={gameCover}
                  alt={gameName}
                  className="dl-modal-game-thumb"
                />
              ) : (
                <div className="dl-modal-header-icon-box">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </div>
              )}
              <div className="dl-modal-header-titles">
                <h2 className="dl-modal-game-name" title={gameName}>
                  {gameName}
                </h2>
                <p className="dl-modal-flow-tag">
                  {t('downloadButton.download')}
                  {matches.length > 0 && ` · ${t('downloadModal.sourceResults', { count: matches.length, s: matches.length !== 1 ? "s" : "" })}`}
                </p>
              </div>
            </div>

            <div className="dl-modal-header-right">
              <span className={`dl-modal-status-badge dl-modal-status-badge--${statusChip.tone}`}>
                <span className="dl-modal-status-dot" aria-hidden />
                <span>{statusChip.label}</span>
              </span>

              <button
                type="button"
                className="dl-modal-close-button"
                onClick={handleCloseAttempt}
                aria-label={t("common.close")}
                title={`${t("common.close")} (Esc)`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Live Search Progress Ribbon (Integrated Header Progress) */}
            {searchProgress && searchProgress.total > 1 && !searchProgress.isDone && (
              <div
                className="dl-header-progress-line"
                role="progressbar"
                aria-valuenow={searchProgress.completed}
                aria-valuemin={0}
                aria-valuemax={searchProgress.total}
              >
                <div
                  className="dl-header-progress-fill"
                  style={{
                    width: `${Math.max(4, (searchProgress.completed / searchProgress.total) * 100)}%`,
                  }}
                />
              </div>
            )}
          </div>

          {/* Modal Body */}
          <div className="dl-modal-body">
            <OwnershipBanner ownership={ownership} step={step} />

            {showResultsUI && (
              <ConfidenceWarning matches={matches} gameName={gameName} />
            )}

            {step === "checking" && <CheckingState searchProgress={searchProgress} />}

            {step === "error" && (
              <ErrorState error={error} onRetry={() => runSearch()} />
            )}

            {showResultsUI && (
              matches.length === 0 ? (
                <ResultsList
                  matches={sortedMatches}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  showWeakMatches={showWeakMatches}
                  onToggleWeak={() => setShowWeakMatches((v) => !v)}
                  isDownloaded={isDownloaded}
                  sortBy={sortBy}
                  onSortChange={setSortBy}
                  sourceFilter={sourceFilter}
                  onSourceFilterChange={setSourceFilter}
                  sourceFilterOptions={sourceFilterOptions}
                  groupFilter={groupFilter}
                  onGroupFilterChange={setGroupFilter}
                  searchQuery={searchQuery}
                  onSearchQueryChange={setSearchQuery}
                  totalRawMatchesCount={matches.length}
                  onClearFilters={handleClearFilters}
                  searchProgress={searchProgress}
                  platformFilter={platformFilter}
                  onPlatformFilterChange={setPlatformFilter}
                  typeFilter={typeFilter}
                  onTypeFilterChange={setTypeFilter}
                />
              ) : (
                <>
                  <div className="dl-compact-view-switch" role="tablist">
                    <button
                      type="button"
                      className={`dl-compact-switch-btn${compactTab === "results" ? " active" : ""}`}
                      onClick={() => setCompactTab("results")}
                      role="tab"
                      aria-selected={compactTab === "results"}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <line x1="8" y1="6" x2="21" y2="6" />
                        <line x1="8" y1="12" x2="21" y2="12" />
                        <line x1="8" y1="18" x2="21" y2="18" />
                        <line x1="3" y1="6" x2="3.01" y2="6" />
                        <line x1="3" y1="12" x2="3.01" y2="12" />
                        <line x1="3" y1="18" x2="3.01" y2="18" />
                      </svg>
                      <span>{t('downloadModal.sourceResults', { count: matches.length, s: matches.length !== 1 ? "s" : "" })}</span>
                    </button>
                    <button
                      type="button"
                      className={`dl-compact-switch-btn${compactTab === "details" ? " active" : ""}`}
                      onClick={() => setCompactTab("details")}
                      role="tab"
                      aria-selected={compactTab === "details"}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                      </svg>
                      <span>{t('downloadModal.configHeader')}</span>
                    </button>
                  </div>
                  <div className="dl-results-split-layout">
                    <div className={`dl-results-pane${compactTab !== "results" ? " compact-hidden" : ""}`} ref={resultsListRef}>
                      <ResultsList
                        matches={sortedMatches}
                        selectedId={selectedId}
                        onSelect={(id) => {
                          setSelectedId(id);
                        }}
                        showWeakMatches={showWeakMatches}
                        onToggleWeak={() => setShowWeakMatches((v) => !v)}
                        isDownloaded={isDownloaded}
                        sortBy={sortBy}
                        onSortChange={setSortBy}
                        sourceFilter={sourceFilter}
                        onSourceFilterChange={setSourceFilter}
                        sourceFilterOptions={sourceFilterOptions}
                        groupFilter={groupFilter}
                        onGroupFilterChange={setGroupFilter}
                        searchQuery={searchQuery}
                        onSearchQueryChange={setSearchQuery}
                        totalRawMatchesCount={matches.length}
                        onClearFilters={handleClearFilters}
                        searchProgress={searchProgress}
                        platformFilter={platformFilter}
                        onPlatformFilterChange={setPlatformFilter}
                        typeFilter={typeFilter}
                        onTypeFilterChange={setTypeFilter}
                      />
                    </div>
                    <DetailPanel
                      className={compactTab !== "details" ? "compact-hidden" : ""}
                      match={selectedMatch}
                      selectedMirrorIndex={selectedMirrorIndex}
                      onSelectMirror={setSelectedMirrorIndex}
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
                  </div>
                </>
              )
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
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleOpenBrowserResolver()}
                    >
                      {t('downloadModal.resolverOpen')}
                    </Button>
                  )}
                  {metadataTimedOut && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleStart()}
                    >
                      {t('downloadModal.tryAgain')}
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
          </div>

          {/* Modal Footer */}
          <div className="dl-modal-footer">
            <div className="dl-modal-footer-info">
              {step === "results" && matches.length > 0 ? (
                <span className="dl-footer-count-text">
                  {t('downloadModal.sourceResults', { count: matches.length, s: matches.length !== 1 ? "s" : "" })}
                </span>
              ) : step === "file_selection" ? (
                <span className="dl-footer-count-text">
                  {t('downloadModal.totalFiles', {
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
                    ? t('downloadModal.resolverDone')
                    : t('downloadModal.resolverClose')}
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => handleCloseAttempt()}
              >
                {t('common.cancel')}
              </Button>
              {step === "file_selection" ? (
                <Button
                  variant="primary"
                  onClick={handleConfirmFileSelection}
                  disabled={selectedFiles.size === 0}
                >
                  {t('downloadModal.confirmDownload', { count: selectedFiles.size })}
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
                    if (selectedWebUrl) return t('downloadModal.openInBrowser');
                    if (wantFileSelection) return t('downloadModal.selectFiles');
                    return t('downloadModal.startDownload');
                  })()}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmCancelOpen}
        title={t('downloadModal.cancelTitle')}
        message={t('downloadModal.cancelBody')}
        confirmLabel={t('downloadModal.cancelDownload')}
        cancelLabel={t('downloadModal.keepWaiting')}
        onConfirm={handleConfirmCancel}
        onCancel={() => setConfirmCancelOpen(false)}
      />
    </>,
    document.body,
  );
}

