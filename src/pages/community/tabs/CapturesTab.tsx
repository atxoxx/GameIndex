import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { open as tauriOpen } from "@tauri-apps/plugin-dialog";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import { Button, Card } from "../../../components/ui";
import {
  loadFavorites,
  saveFavorites,
  loadScreenshotCache,
  saveScreenshotCache,
  loadManualFolder,
  saveManualFolder,
} from "../statsStorage";
import type { Game } from "../../../types/game";
import type { ScreenshotGroup } from "../statsTypes";

const VIDEO_EXTS = ["mp4", "webm", "mov", "mkv"];
function isVideoPath(p: string): boolean {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTS.includes(ext);
}

const SOURCE_PILLS = ["steam", "nvidia", "amd", "obs", "windows"] as const;
function sourceLabel(src: string): string {
  switch (src) {
    case "steam": return "Steam";
    case "nvidia": return "NVIDIA";
    case "amd": return "AMD";
    case "obs": return "OBS";
    case "windows": return "Xbox";
    default: return src;
  }
}

// Global in-memory cache for resolved base64 data URLs
const mediaDataUrlCache = new Map<string, string>();

interface CaptureThumbProps {
  path: string;
  gameName: string;
  index: number;
  isFavorite: boolean;
  onToggleFavorite: (path: string) => void;
  onOpen: (index: number) => void;
  showOverlayName?: boolean;
}

function CaptureThumb({
  path,
  gameName,
  index,
  isFavorite,
  onToggleFavorite,
  onOpen,
  showOverlayName = false,
}: CaptureThumbProps) {
  const { t } = useLanguage();
  const [failed, setFailed] = useState(false);
  const [imgSrc, setImgSrc] = useState<string>(() => mediaDataUrlCache.get(path) || convertFileSrc(path));
  const isVid = isVideoPath(path);

  const handleError = useCallback(() => {
    if (mediaDataUrlCache.has(path)) {
      setImgSrc(mediaDataUrlCache.get(path)!);
      return;
    }
    invoke<string>("read_cover_image", { filePath: path })
      .then((dataUrl) => {
        mediaDataUrlCache.set(path, dataUrl);
        setImgSrc(dataUrl);
      })
      .catch(() => {
        setFailed(true);
      });
  }, [path]);

  useEffect(() => {
    setFailed(false);
    setImgSrc(mediaDataUrlCache.get(path) || convertFileSrc(path));
  }, [path]);

  return (
    <div
      className="stats-capture-thumb"
      onClick={() => onOpen(index)}
      role="button"
      tabIndex={0}
      aria-label={`${gameName} capture ${index + 1}`}
    >
      {!failed ? (
        isVid ? (
          <video
            src={imgSrc}
            muted
            preload="metadata"
            onError={handleError}
          />
        ) : (
          <img
            src={imgSrc}
            alt=""
            loading="lazy"
            onError={handleError}
          />
        )
      ) : (
        <div className="stats-capture-thumb-fallback">
          <span>📷</span>
          <span className="stats-fallback-name">{path.split(/[\\/]/).pop()}</span>
        </div>
      )}

      {isVid && <span className="stats-thumb-vid-tag">▶ CLIP</span>}

      {showOverlayName && (
        <div className="stats-thumb-hover-overlay">
          <span className="stats-thumb-game-name">{gameName}</span>
        </div>
      )}

      <button
        type="button"
        className={`stats-thumb-fav-btn${isFavorite ? " active" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(path);
        }}
        aria-label={isFavorite ? t("community.removeFavorite") : t("community.addFavorite")}
      >
        {isFavorite ? "★" : "☆"}
      </button>
    </div>
  );
}

interface LightboxMediaProps {
  path: string;
  gameName?: string;
}

function LightboxMedia({ path }: LightboxMediaProps) {
  const [failed, setFailed] = useState(false);
  const [src, setSrc] = useState<string>(() => mediaDataUrlCache.get(path) || convertFileSrc(path));
  const isVid = isVideoPath(path);

  useEffect(() => {
    setFailed(false);
    const cached = mediaDataUrlCache.get(path);
    if (cached) {
      setSrc(cached);
    } else {
      setSrc(convertFileSrc(path));
    }
  }, [path]);

  const handleError = useCallback(() => {
    invoke<string>("read_cover_image", { filePath: path })
      .then((dataUrl) => {
        mediaDataUrlCache.set(path, dataUrl);
        setSrc(dataUrl);
      })
      .catch(() => {
        setFailed(true);
      });
  }, [path]);

  if (failed) {
    return (
      <div className="stats-lightbox-failed">
        <span className="stats-lightbox-failed-icon">⚠️</span>
        <p>{path.split(/[\\/]/).pop()}</p>
      </div>
    );
  }

  if (isVid) {
    return (
      <video
        key={path}
        src={src}
        controls
        autoPlay
        className="stats-lightbox-video"
        onError={handleError}
      />
    );
  }

  return (
    <img
      key={path}
      src={src}
      alt=""
      className="stats-lightbox-img"
      onError={handleError}
    />
  );
}

interface CapturesTabProps {
  games: Game[];
}

export function CapturesTab({ games }: CapturesTabProps) {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const gamesRef = useRef(games);
  useEffect(() => {
    gamesRef.current = games;
  }, [games]);

  // Persistent favorites
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const toggleFavorite = useCallback((path: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      saveFavorites(next);
      return next;
    });
  }, []);

  // State
  const [groups, setGroups] = useState<ScreenshotGroup[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [isDetecting, setIsDetecting] = useState(false);
  const [manualImages, setManualImages] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  // Filters & View Mode
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [mediaTypeFilter, setMediaTypeFilter] = useState<"all" | "images" | "videos">("all");
  const [viewMode, setViewMode] = useState<"grouped" | "grid">("grouped");
  const [allExpanded, setAllExpanded] = useState(false);

  // Lightbox & Slideshow
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [slideshow, setSlideshow] = useState(false);

  // Initial re-hydrate on mount
  useEffect(() => {
    const cached = loadScreenshotCache();
    const detected = cached.filter((g) => !g.key.startsWith("manual-"));
    if (detected.length > 0) {
      setGroups(detected);
      const initialExpanded = new Set<string>();
      for (let i = 0; i < Math.min(detected.length, 3); i++) {
        initialExpanded.add(detected[i].key);
      }
      setExpandedKeys(initialExpanded);
    }

    const savedFolder = loadManualFolder();
    if (savedFolder) {
      setSelectedFolder(savedFolder);
      setIsScanning(true);
      invoke<string[]>("list_media_files", { folderPath: savedFolder })
        .then((paths) => setManualImages(paths))
        .catch(() => setManualImages([]))
        .finally(() => setIsScanning(false));
    }

    handleAutoDetect(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-detect captures
  const handleAutoDetect = useCallback(async (silent = false) => {
    setIsDetecting(true);
    if (!silent) {
      setGroups([]);
      setManualImages([]);
      setSelectedFolder(null);
      setExpandedKeys(new Set());
    }

    try {
      const [steamFolders, systemFolders] = await Promise.all([
        invoke<{
          appId: number;
          gameName: string;
          folderPath: string;
          screenshots: string[];
        }[]>("detect_steam_screenshot_folders"),
        invoke<{
          source: string;
          gameName: string;
          folderPath: string;
          screenshots: string[];
        }[]>("detect_system_screenshot_folders"),
      ]);

      const enriched: ScreenshotGroup[] = steamFolders.map((f) => {
        const libGame = gamesRef.current.find((g) => g.steamAppId === f.appId);
        const groupKey = `steam-${f.appId}`;
        return {
          key: groupKey,
          appId: f.appId,
          gameName: libGame?.name || f.gameName,
          gameId: libGame?.id,
          coverArtUrl: libGame?.coverArtUrl,
          platform: libGame?.platform || "Steam",
          folderPath: f.folderPath,
          screenshots: f.screenshots,
          source: "steam",
        };
      });

      for (const sf of systemFolders) {
        enriched.push({
          key: `${sf.source}-${sf.folderPath.replace(/[^a-zA-Z0-9]/g, "-")}`,
          gameName: sf.gameName,
          folderPath: sf.folderPath,
          screenshots: sf.screenshots,
          source: sf.source,
        });
      }

      if (enriched.length === 0) {
        if (!silent) showToast(t("community.noScreenshots"), "info");
        setIsDetecting(false);
        return;
      }

      enriched.sort((a, b) => a.gameName.localeCompare(b.gameName));

      setExpandedKeys((prev) => {
        if (!silent || prev.size === 0) {
          const initialExpanded = new Set<string>();
          for (let i = 0; i < Math.min(enriched.length, 3); i++) {
            initialExpanded.add(enriched[i].key);
          }
          return initialExpanded;
        }
        const valid = new Set(enriched.map((g) => g.key));
        const next = new Set<string>();
        for (const k of prev) if (valid.has(k)) next.add(k);
        return next;
      });

      setGroups(enriched);
      saveScreenshotCache(enriched);

      const totalCount = enriched.reduce((s, g) => s + g.screenshots.length, 0);
      if (!silent) {
        showToast(t("community.groupsFound", { groups: enriched.length, total: totalCount, sources: "" }), "success");
      }
    } catch (err) {
      console.error("[Captures] Detection failed:", err);
      if (!silent) showToast(t("community.detectFailed"), "error");
    } finally {
      setIsDetecting(false);
    }
  }, [showToast, t]);

  // Pick folder
  const handlePickFolder = useCallback(async () => {
    try {
      const folderPath = await tauriOpen({
        directory: true,
        multiple: false,
        title: t("communityExtras.selectFolder"),
      });
      if (!folderPath || typeof folderPath !== "string") return;

      setGroups([]);
      setSelectedFolder(folderPath);
      setIsScanning(true);

      const paths: string[] = await invoke("list_media_files", { folderPath });
      setManualImages(paths);
      saveManualFolder(folderPath);
      if (paths.length === 0) {
        showToast(t("community.noImagesInFolder"), "info");
      }
    } catch (err) {
      console.error("[Captures] Failed to scan folder:", err);
      showToast(t("community.scanFailed"), "error");
    } finally {
      setIsScanning(false);
    }
  }, [showToast, t]);

  // Filtered groups
  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .filter((g) => {
        if (sourceFilter && g.source !== sourceFilter) return false;
        if (q && !g.gameName.toLowerCase().includes(q)) return false;
        if (showFavOnly && !g.screenshots.some((s) => favorites.has(s))) return false;
        return true;
      })
      .map((g) => {
        let shots = g.screenshots;
        if (showFavOnly) shots = shots.filter((s) => favorites.has(s));
        if (mediaTypeFilter === "images") shots = shots.filter((s) => !isVideoPath(s));
        else if (mediaTypeFilter === "videos") shots = shots.filter((s) => isVideoPath(s));
        return { ...g, screenshots: shots };
      })
      .filter((g) => g.screenshots.length > 0);
  }, [groups, search, sourceFilter, showFavOnly, mediaTypeFilter, favorites]);

  // Filtered manual images
  const filteredManual = useMemo(() => {
    const q = search.trim().toLowerCase();
    return manualImages
      .filter((p) => (showFavOnly ? favorites.has(p) : true))
      .filter((p) => (sourceFilter ? p.toLowerCase().includes(sourceFilter) : true))
      .filter((p) => (q ? p.toLowerCase().includes(q) : true))
      .filter((p) => {
        if (mediaTypeFilter === "images") return !isVideoPath(p);
        if (mediaTypeFilter === "videos") return isVideoPath(p);
        return true;
      });
  }, [manualImages, showFavOnly, sourceFilter, search, mediaTypeFilter, favorites]);

  // Flat array of visible captures for lightbox
  const allCaptures = useMemo(() => {
    const list: { path: string; gameName: string; groupKey: string }[] = [];
    for (const g of filteredGroups) {
      for (const s of g.screenshots) {
        list.push({ path: s, gameName: g.gameName, groupKey: g.key });
      }
    }
    const manualName = selectedFolder ? selectedFolder.split(/[\\/]/).pop() || "Capture" : "Capture";
    for (const p of filteredManual) {
      list.push({ path: p, gameName: manualName, groupKey: "manual" });
    }
    return list;
  }, [filteredGroups, filteredManual, selectedFolder]);

  // Accordion toggling
  const toggleGroup = useCallback((key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleAllGroups = useCallback(() => {
    setAllExpanded((prev) => {
      const next = !prev;
      if (next) setExpandedKeys(new Set(filteredGroups.map((g) => g.key)));
      else setExpandedKeys(new Set());
      return next;
    });
  }, [filteredGroups]);

  // Lightbox controls
  const openLightbox = useCallback((index: number) => {
    setLightboxIndex(index);
  }, []);

  const closeLightbox = useCallback(() => {
    setLightboxIndex(null);
    setSlideshow(false);
  }, []);

  const goNext = useCallback(() => {
    setLightboxIndex((prev) => {
      if (prev === null || allCaptures.length === 0) return null;
      return (prev + 1) % allCaptures.length;
    });
  }, [allCaptures.length]);

  const goPrev = useCallback(() => {
    setLightboxIndex((prev) => {
      if (prev === null || allCaptures.length === 0) return null;
      return (prev - 1 + allCaptures.length) % allCaptures.length;
    });
  }, [allCaptures.length]);

  // Slideshow timer
  useEffect(() => {
    if (!slideshow || lightboxIndex === null) return;
    const timer = setInterval(() => goNext(), 3500);
    return () => clearInterval(timer);
  }, [slideshow, lightboxIndex, goNext]);

  // Keyboard navigation
  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === " ") {
        e.preventDefault();
        setSlideshow((s) => !s);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxIndex, closeLightbox, goNext, goPrev]);

  const hasContent = groups.length > 0 || manualImages.length > 0 || isScanning || isDetecting;

  return (
    <div className="stats-tab-captures">
      {/* ── Top Toolbar ─────────────────────────────────────────── */}
      <div className="stats-captures-toolbar">
        <div className="stats-captures-toolbar-left">
          <Button
            variant="primary"
            onClick={() => handleAutoDetect()}
            disabled={isDetecting}
            leftIcon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            }
          >
            {isDetecting ? t("community.detecting") : t("community.autoDetect")}
          </Button>

          <Button
            variant="secondary"
            onClick={handlePickFolder}
            disabled={isScanning || isDetecting}
            leftIcon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            }
          >
            {selectedFolder ? t("community.changeFolder") : t("community.pickFolder")}
          </Button>

          {selectedFolder && (
            <span className="stats-captures-folder-badge" title={selectedFolder}>
              📁 {selectedFolder.split(/[\\/]/).pop() || selectedFolder} ({manualImages.length})
            </span>
          )}
        </div>

        {/* View Mode & Media Filter */}
        <div className="stats-captures-toolbar-right">
          <div className="stats-view-mode-toggle">
            <button
              type="button"
              className={`stats-view-mode-btn${viewMode === "grouped" ? " active" : ""}`}
              onClick={() => setViewMode("grouped")}
              title={t("stats.captures.groupedView")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
            <button
              type="button"
              className={`stats-view-mode-btn${viewMode === "grid" ? " active" : ""}`}
              onClick={() => setViewMode("grid")}
              title={t("stats.captures.gridView")}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── Filters Bar ─────────────────────────────────────────── */}
      {hasContent && (
        <div className="stats-captures-filter-bar">
          <input
            type="search"
            className="stats-captures-search-input"
            placeholder={t("community.searchGamesPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="stats-captures-pills-row">
            <button
              type="button"
              className={`stats-filter-pill${showFavOnly ? " active" : ""}`}
              onClick={() => setShowFavOnly((v) => !v)}
            >
              ★ {t("common.favorites")} {favorites.size > 0 && `(${favorites.size})`}
            </button>

            {/* Media Type Filter */}
            <button
              type="button"
              className={`stats-filter-pill${mediaTypeFilter === "images" ? " active" : ""}`}
              onClick={() => setMediaTypeFilter((cur) => (cur === "images" ? "all" : "images"))}
            >
              🖼️ {t("stats.captures.screenshotsOnly")}
            </button>
            <button
              type="button"
              className={`stats-filter-pill${mediaTypeFilter === "videos" ? " active" : ""}`}
              onClick={() => setMediaTypeFilter((cur) => (cur === "videos" ? "all" : "videos"))}
            >
              🎬 {t("stats.captures.clipsOnly")}
            </button>

            {/* Source Pills */}
            {SOURCE_PILLS.map((src) => (
              <button
                key={src}
                type="button"
                className={`stats-filter-pill${sourceFilter === src ? " active" : ""}`}
                onClick={() => setSourceFilter((cur) => (cur === src ? null : src))}
              >
                {sourceLabel(src)}
              </button>
            ))}

            {(search || sourceFilter || showFavOnly || mediaTypeFilter !== "all") && (
              <button
                type="button"
                className="stats-filter-pill stats-filter-pill--clear"
                onClick={() => {
                  setSearch("");
                  setSourceFilter(null);
                  setShowFavOnly(false);
                  setMediaTypeFilter("all");
                }}
              >
                {t("common.clear")}
              </button>
            )}

            {viewMode === "grouped" && filteredGroups.length > 0 && (
              <button type="button" className="stats-filter-pill" onClick={toggleAllGroups}>
                {allExpanded ? t("common.collapseAll") : t("common.expandAll")}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Empty & Loading States ──────────────────────────────── */}
      {!hasContent && (
        <Card variant="surface" elevation="1" className="stats-empty-card stats-captures-empty-box">
          <span className="stats-empty-icon">📸</span>
          <h3>{t("community.browseScreenshots")}</h3>
          <p>{t("community.screenshotsHint")}</p>
        </Card>
      )}

      {(isDetecting || isScanning) && (
        <div className="stats-captures-skeleton-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="stats-capture-skeleton" />
          ))}
        </div>
      )}

      {/* ── View Mode: Grouped Accordion ────────────────────────── */}
      {!isDetecting && !isScanning && viewMode === "grouped" && filteredGroups.length > 0 && (
        <div className="stats-captures-groups-list">
          {filteredGroups.map((group) => {
            const isExpanded = expandedKeys.has(group.key);
            return (
              <div key={group.key} className="stats-capture-group-item">
                <button
                  type="button"
                  className="stats-capture-group-header"
                  onClick={() => toggleGroup(group.key)}
                  aria-expanded={isExpanded}
                >
                  <div className="stats-capture-group-cover">
                    {group.coverArtUrl ? (
                      <img src={group.coverArtUrl} alt="" loading="lazy" />
                    ) : (
                      <div className="stats-capture-group-fallback">🎮</div>
                    )}
                  </div>
                  <div className="stats-capture-group-info">
                    <span className="stats-capture-group-title">{group.gameName}</span>
                    <div className="stats-capture-group-badges">
                      {group.source && (
                        <span className={`stats-source-tag source-${group.source}`}>
                          {sourceLabel(group.source)}
                        </span>
                      )}
                      {group.platform && <span className="stats-platform-tag">{group.platform}</span>}
                    </div>
                  </div>
                  <div className="stats-capture-group-right">
                    <span className="stats-capture-count">
                      {t("community.screenshotCount", {
                        count: group.screenshots.length,
                        plural: group.screenshots.length !== 1 ? "s" : "",
                      })}
                    </span>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      width="18"
                      height="18"
                      className={`stats-group-chevron${isExpanded ? " expanded" : ""}`}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </button>

                {isExpanded && (
                  <div className="stats-captures-thumb-grid">
                    {group.screenshots.map((path) => {
                      const globalIdx = allCaptures.findIndex((c) => c.path === path);
                      const isFav = favorites.has(path);
                      return (
                        <CaptureThumb
                          key={path}
                          path={path}
                          gameName={group.gameName}
                          index={globalIdx >= 0 ? globalIdx : 0}
                          isFavorite={isFav}
                          onToggleFavorite={toggleFavorite}
                          onOpen={openLightbox}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── View Mode: Flat Grid Gallery ────────────────────────── */}
      {!isDetecting && !isScanning && (viewMode === "grid" || filteredGroups.length === 0) && allCaptures.length > 0 && (
        <div className="stats-captures-thumb-grid stats-captures-flat-grid">
          {allCaptures.map((capture, idx) => {
            const isFav = favorites.has(capture.path);
            return (
              <CaptureThumb
                key={capture.path}
                path={capture.path}
                gameName={capture.gameName}
                index={idx}
                isFavorite={isFav}
                onToggleFavorite={toggleFavorite}
                onOpen={openLightbox}
                showOverlayName={true}
              />
            );
          })}
        </div>
      )}

      {/* ── Fullscreen Lightbox & Slideshow ──────────────────────── */}
      {lightboxIndex !== null && allCaptures[lightboxIndex] && (
        <div className="stats-lightbox-overlay" onClick={closeLightbox}>
          <div className="stats-lightbox-header" onClick={(e) => e.stopPropagation()}>
            <div className="stats-lightbox-title-wrap">
              <span className="stats-lightbox-counter">
                {lightboxIndex + 1} / {allCaptures.length}
              </span>
              <span className="stats-lightbox-game">{allCaptures[lightboxIndex].gameName}</span>
            </div>

            <div className="stats-lightbox-actions">
              <button
                type="button"
                className={`stats-lightbox-tool-btn${slideshow ? " active" : ""}`}
                onClick={() => setSlideshow((s) => !s)}
                title={slideshow ? t("community.stopSlideshow") : t("community.startSlideshow")}
              >
                {slideshow ? "❚❚" : "▶"}
              </button>

              <button
                type="button"
                className={`stats-lightbox-tool-btn${favorites.has(allCaptures[lightboxIndex].path) ? " active" : ""}`}
                onClick={() => toggleFavorite(allCaptures[lightboxIndex].path)}
                title={t("community.addFavorite")}
              >
                {favorites.has(allCaptures[lightboxIndex].path) ? "★" : "☆"}
              </button>

              <button
                type="button"
                className="stats-lightbox-tool-btn"
                onClick={() => {
                  const p = allCaptures[lightboxIndex].path;
                  const folder = p.replace(/[\\/][^\\/]*$/, "");
                  invoke("open_folder", { path: folder }).catch(() => {
                    showToast(t("community.couldNotOpenFolder"), "error");
                  });
                }}
                title={t("community.openFolder")}
              >
                📁
              </button>

              <button
                type="button"
                className="stats-lightbox-tool-btn stats-lightbox-close-btn"
                onClick={closeLightbox}
                title={t("community.closeLightbox")}
              >
                ✕
              </button>
            </div>
          </div>

          <div className="stats-lightbox-main" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="stats-lightbox-nav-arrow prev" onClick={goPrev}>
              ‹
            </button>

            <div className="stats-lightbox-media-wrap">
              <LightboxMedia
                path={allCaptures[lightboxIndex].path}
                gameName={allCaptures[lightboxIndex].gameName}
              />
            </div>

            <button type="button" className="stats-lightbox-nav-arrow next" onClick={goNext}>
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
