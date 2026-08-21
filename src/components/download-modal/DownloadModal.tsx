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
  const [searchQuery, setSearchQuery] = useState<string>("");
  // Broad PC/console switch + download-method filter for the results.
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>("all");
  const [typeFilter, setTypeFilter] = useState<DownloadTypeFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  // Route magnets/direct links through the configured debrid service.
  const [useDebrid, setUseDebrid] = useState(false);
  // Cache probe for the selected magnet (only while the debrid toggle
  // is on and a magnet is selected).
  const [cacheStatus, setCacheStatus] = useState<CacheCheckStatus>("idle");
  const cacheCheckSeq = useRef(0);
  const [tempTorrentId, setTempTorrentId] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());
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

  // Filter raw matches by selected source, platform, type and search query
  const filteredMatches = useMemo(
    () => filterMatches(matches, sourceFilter, searchQuery, platformFilter, typeFilter),
    [matches, sourceFilter, searchQuery, platformFilter, typeFilter],
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

  // Resolved URI of the selected result, memoised so the cache-check
  // effect doesn't re-fire on every search-progress emission (which
  // rebuilds the `matches` array even when the URI is unchanged).
  const selectedSourceUri = useMemo(
    () => (selectedMatch ? resolveSourceUri(selectedMatch, 0) : null),
    [selectedMatch],
  );
  const selectedIsMagnet = useMemo(() => {
    if (!selectedMatch || !selectedSourceUri) return false;
    return classifyUri(selectedSourceUri, selectedMatch.torrentUrl).isMagnet;
  }, [selectedMatch, selectedSourceUri]);

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
  // Centralised close attempt: when a download is still starting we
  // confirm with the user before tearing it down (which would orphan the
  // temporary torrent). During `fetching_metadata` / `file_selection`
  // the temp torrent is cancelled and we return to the results step so
  // the user can pick another source rather than losing the whole flow.
  const handleCloseAttempt = useCallback(() => {
    if (step === "starting") {
      setConfirmCancelOpen(true);
      return;
    }
    if (step === "fetching_metadata" || step === "file_selection") {
      cancelledRef.current = true;
      if (tempTorrentIdRef.current) {
        invoke("torrent_remove", { id: tempTorrentIdRef.current, deleteFiles: true }).catch((e) =>
          console.error("Failed to remove list-only torrent on close:", e),
        );
      }
      setTempTorrentId(null);
      setStep("results");
      return;
    }
    onClose();
  }, [step, onClose]);

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
          ? resolveSourceUri(selectedMatch, 0)
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
    // Single source of truth for which URI the user wants — the first
    // URI, falling back to the magnet.
    const sourceUri = resolveSourceUri(match, 0);
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
      const safeGameFolder = gameName.replace(/[:*?"<>|\\/]/g, "").trim();
      const normalizedSave = savePath.replace(/\\/g, "/");
      const finalSavePath = normalizedSave.endsWith(safeGameFolder)
        ? savePath
        : `${savePath}/${safeGameFolder}`.replace(/\\/g, "/");

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
          cancelledRef.current = true;
          if (tempTorrentIdRef.current) {
            invoke("torrent_remove", { id: tempTorrentIdRef.current, deleteFiles: true }).catch((e) =>
              console.error("Failed to remove list-only torrent on escape:", e)
            );
          }
          setTempTorrentId(null);
          setStep("results");
        } else {
          handleCloseAttempt();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, handleCloseAttempt]);

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
                <div className="dl-results-split-layout">
                  <div className="dl-results-pane" ref={resultsListRef}>
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
                    match={selectedMatch}
                    isDownloaded={isDownloaded}
                    savePath={savePath}
                    gameName={gameName}
                    onPickPath={handlePickSavePath}
                    autoExtract={autoExtract}
                    onAutoExtract={setAutoExtract}
                    chooseFiles={chooseFiles}
                    onChooseFiles={setChooseFiles}
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
                  peers={live?.peers ?? 0}
                  seeds={live?.seeds ?? 0}
                />
              );
            })()}

            {step === "file_selection" && (
              <FileSelection
                files={activeDownloads.find((d) => d.id === tempTorrentId)?.files ?? []}
                selectedFiles={selectedFiles}
                onChange={setSelectedFiles}
              />
            )}

            {step === "starting" && (() => {
              const liveUri = resolveSourceUri(selectedMatch ?? undefined, 0);
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
                    count: activeDownloads.find((d) => d.id === tempTorrentId)?.files.length ?? 0,
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
                  onClick={async () => {
                    if (!tempTorrentId) return;
                    const activeId = tempTorrentId;
                    setStep("starting");
                    try {
                      setTempTorrentId(null);
                      await startSelectedDownload(activeId, Array.from(selectedFiles), autoExtract);
                      showToast(t('downloadModal.startedWithFileSelection'), "success");
                      onClose();
                    } catch (e) {
                      setTempTorrentId(activeId);
                      setError(String(e));
                      setStep("file_selection");
                    }
                  }}
                  disabled={selectedFiles.size === 0}
                >
                  {t('downloadModal.confirmDownload', { count: selectedFiles.size })}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={handleStart}
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
                    const selMatch = selectedMatch;
                    const { isDirect } = classifyUri(
                      resolveSourceUri(selMatch ?? undefined, 0),
                      selMatch?.torrentUrl,
                    );
                    if (chooseFiles && !isDirect) return t('downloadModal.fetchFiles');
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

