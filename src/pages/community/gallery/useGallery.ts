import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLanguage } from "../../../context/LanguageContext";
import { useToast } from "../../../context/ToastContext";
import {
  loadCustomFolders,
  loadFavorites,
  loadManualFolder,
  loadScreenshotCache,
  saveCustomFolders,
  saveFavorites,
  saveManualFolder,
  saveScreenshotCache,
} from "../statsStorage";
import { rangeCutoffMs } from "../statsCalculations";
import { isVideoPath } from "./mediaUtils";
import type { Game, CustomFolder, MediaFile, ScreenshotGroup, TimeframePreset } from "../statsTypes";

export type MediaKindFilter = "all" | "images" | "videos";

interface SteamFolderDto {
  appId: number;
  gameName: string;
  folderPath: string;
  screenshots: MediaFile[];
}

interface SystemFolderDto {
  source: string;
  gameName: string;
  folderPath: string;
  screenshots: MediaFile[];
}

export interface GalleryAlbum {
  group: ScreenshotGroup;
  media: MediaFile[];
  /** Newest capture in the album (unix seconds). */
  latest: number;
  isCustom: boolean;
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "-");
}

// Detected folders are cached; avoid re-walking the filesystem every time
// the user returns to the Gallery within the same session.
const DETECT_COOLDOWN_MS = 2 * 60 * 1000;
let lastDetectAt = 0;

/**
 * Capture scanning, caching and filtering for the Gallery tab.
 *
 * Keeps every filesystem action in one place so the tab only decides what to
 * draw. Groups are built from the detected folders plus named custom folders,
 * and the page-wide range is applied to each capture's timestamp.
 */
export function useGallery(
  games: Game[],
  range: TimeframePreset,
  onCountChange: (count: number) => void
) {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const gamesRef = useRef(games);
  useEffect(() => {
    gamesRef.current = games;
  }, [games]);

  const [groups, setGroups] = useState<ScreenshotGroup[]>([]);
  const [customFolders, setCustomFolders] = useState<CustomFolder[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());
  const [isDetecting, setIsDetecting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isAddFolderOpen, setIsAddFolderOpen] = useState(false);

  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [mediaKind, setMediaKind] = useState<MediaKindFilter>("all");
  const [selectedAlbumKey, setSelectedAlbumKey] = useState<string | null>(null);

  const toggleFavorite = useCallback((path: string) => {
    setFavorites((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      saveFavorites(next);
      return next;
    });
  }, []);

  const detect = useCallback(
    async (silent = false) => {
      setIsDetecting(true);
      lastDetectAt = Date.now();
      try {
        const [steamFolders, systemFolders] = await Promise.all([
          invoke<SteamFolderDto[]>("detect_steam_screenshot_folders"),
          invoke<SystemFolderDto[]>("detect_system_screenshot_folders"),
        ]);

        const enriched: ScreenshotGroup[] = steamFolders.map((folder) => {
          const game = gamesRef.current.find((entry) => entry.steamAppId === folder.appId);
          return {
            key: `steam-${folder.appId}`,
            appId: folder.appId,
            gameName: game?.name ?? folder.gameName,
            gameId: game?.id,
            coverArtUrl: game?.coverArtUrl,
            platform: game?.platform || "Steam",
            folderPath: folder.folderPath,
            screenshots: folder.screenshots,
            source: "steam",
          };
        });

        for (const folder of systemFolders) {
          enriched.push({
            key: `${folder.source}-${sanitize(folder.folderPath)}`,
            gameName: folder.gameName,
            folderPath: folder.folderPath,
            screenshots: folder.screenshots,
            source: folder.source,
          });
        }

        if (enriched.length === 0) {
          if (!silent) showToast(t("community.noScreenshots"), "info");
          return;
        }

        setGroups(enriched);
        saveScreenshotCache(enriched);

        if (!silent) {
          const total = enriched.reduce((sum, group) => sum + group.screenshots.length, 0);
          showToast(
            t("community.groupsFound", { groups: enriched.length, total, sources: "" }),
            "success"
          );
        }
      } catch (error) {
        console.error("[Gallery] Detection failed:", error);
        if (!silent) showToast(t("community.detectFailed"), "error");
      } finally {
        setIsDetecting(false);
      }
    },
    [showToast, t]
  );

  // Re-hydrate from the cache, migrate the legacy single folder, then refresh
  // in the background without blocking the first paint.
  useEffect(() => {
    const cached = loadScreenshotCache().filter((group) => !group.key.startsWith("manual-"));
    if (cached.length > 0) setGroups(cached);

    const savedCustom = loadCustomFolders();
    const legacyFolder = loadManualFolder();
    if (savedCustom.length === 0 && legacyFolder) {
      const migrated: CustomFolder = {
        id: `custom-${Date.now().toString(36)}`,
        name: legacyFolder.split(/[\\/]/).pop() || "Custom Folder",
        folderPath: legacyFolder,
        media: [],
      };
      setCustomFolders([migrated]);
      saveCustomFolders([migrated]);
      saveManualFolder(null);
      invoke<MediaFile[]>("list_media_files", { folderPath: legacyFolder })
        .then((media) => {
          setCustomFolders((previous) => {
            const next = previous.map((folder) =>
              folder.id === migrated.id ? { ...folder, media } : folder
            );
            saveCustomFolders(next);
            return next;
          });
        })
        .catch(() => {});
    } else if (savedCustom.length > 0) {
      setCustomFolders(savedCustom);
      // Refresh saved folders in the background: captures may be new and
      // older cache entries carry no timestamp until rescanned.
      void Promise.all(
        savedCustom.map((folder) =>
          invoke<MediaFile[]>("list_media_files", { folderPath: folder.folderPath }).catch(
            () => null
          )
        )
      ).then((results) => {
        if (results.every((media) => media === null)) return;
        setCustomFolders((previous) => {
          const next = previous.map((folder) => {
            const index = savedCustom.findIndex((entry) => entry.id === folder.id);
            const media = index >= 0 ? results[index] : null;
            return media ? { ...folder, media } : folder;
          });
          saveCustomFolders(next);
          return next;
        });
      });
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (Date.now() - lastDetectAt < DETECT_COOLDOWN_MS) return;
    void detect(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addFolder = useCallback(
    async (name: string, folderPath: string) => {
      const trimmed = name.trim();
      if (customFolders.some((folder) => folder.name.toLowerCase() === trimmed.toLowerCase())) {
        showToast(t("community.folderExists"), "error");
        return;
      }

      setIsScanning(true);
      try {
        const media = await invoke<MediaFile[]>("list_media_files", { folderPath });
        const folder: CustomFolder = {
          id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          name: trimmed,
          folderPath,
          media,
        };
        setCustomFolders((previous) => {
          const next = [...previous, folder];
          saveCustomFolders(next);
          return next;
        });
        setIsAddFolderOpen(false);
        showToast(t("community.folderAdded"), "success");
      } catch (error) {
        console.error("[Gallery] Folder scan failed:", error);
        showToast(t("community.scanFailed"), "error");
      } finally {
        setIsScanning(false);
      }
    },
    [customFolders, showToast, t]
  );

  const removeFolder = useCallback(
    (id: string) => {
      setCustomFolders((previous) => {
        const next = previous.filter((folder) => folder.id !== id);
        saveCustomFolders(next);
        return next;
      });
      if (selectedAlbumKey === `custom-${id}`) setSelectedAlbumKey(null);
      showToast(t("community.folderRemoved"), "info");
    },
    [selectedAlbumKey, showToast, t]
  );

  const customGroups = useMemo<ScreenshotGroup[]>(
    () =>
      customFolders.map((folder) => ({
        key: `custom-${folder.id}`,
        gameName: folder.name,
        folderPath: folder.folderPath,
        screenshots: folder.media,
        source: "custom",
        customFolderId: folder.id,
      })),
    [customFolders]
  );

  const allGroups = useMemo(() => {
    const merged = [...groups, ...customGroups];
    merged.sort((a, b) => a.gameName.localeCompare(b.gameName));
    return merged;
  }, [groups, customGroups]);

  // Badge count is range-independent so the tab never claims a gallery shrank
  // just because the range moved.
  const totalCaptures = useMemo(
    () => allGroups.reduce((sum, group) => sum + group.screenshots.length, 0),
    [allGroups]
  );
  useEffect(() => {
    onCountChange(totalCaptures);
  }, [totalCaptures, onCountChange]);

  const cutoff = rangeCutoffMs(range);
  const query = search.trim().toLowerCase();

  const albums = useMemo<GalleryAlbum[]>(() => {
    const list = allGroups
      .filter((group) => {
        if (sourceFilter && group.source !== sourceFilter) return false;
        if (query && !group.gameName.toLowerCase().includes(query)) return false;
        return true;
      })
      .map((group) => {
        const media = group.screenshots.filter((file) => {
          if (favoritesOnly && !favorites.has(file.path)) return false;
          if (mediaKind === "images" && isVideoPath(file.path)) return false;
          if (mediaKind === "videos" && !isVideoPath(file.path)) return false;
          if (cutoff !== null && (file.modifiedAt === 0 || file.modifiedAt * 1000 < cutoff)) return false;
          return true;
        });
        const latest = media.reduce((max, file) => Math.max(max, file.modifiedAt), 0);
        return { group, media, latest, isCustom: Boolean(group.customFolderId) };
      })
      .filter((album) => album.media.length > 0);

    list.sort((a, b) => b.latest - a.latest || a.group.gameName.localeCompare(b.group.gameName));
    return list;
  }, [allGroups, sourceFilter, query, favoritesOnly, favorites, mediaKind, cutoff]);

  const selectedAlbum = useMemo(
    () => albums.find((album) => album.group.key === selectedAlbumKey) ?? null,
    [albums, selectedAlbumKey]
  );

  // Falling out of a filtered album (e.g. new source filter) returns to the
  // album grid instead of leaving an empty detail view.
  useEffect(() => {
    if (selectedAlbumKey && !selectedAlbum) setSelectedAlbumKey(null);
  }, [selectedAlbum, selectedAlbumKey]);

  const visibleMedia = useMemo<{ media: MediaFile; label: string }[]>(() => {
    if (selectedAlbum) {
      return selectedAlbum.media.map((media) => ({ media, label: selectedAlbum.group.gameName }));
    }
    return albums.flatMap((album) =>
      album.media.map((media) => ({ media, label: album.group.gameName }))
    );
  }, [albums, selectedAlbum]);

  const filtersActive =
    Boolean(search) || Boolean(sourceFilter) || favoritesOnly || mediaKind !== "all";

  const clearFilters = useCallback(() => {
    setSearch("");
    setSourceFilter(null);
    setFavoritesOnly(false);
    setMediaKind("all");
  }, []);

  return {
    albums,
    selectedAlbum,
    selectAlbum: setSelectedAlbumKey,
    allGroups,
    totalCaptures,
    visibleMedia,
    favorites,
    toggleFavorite,
    isDetecting,
    isScanning,
    isAddFolderOpen,
    openAddFolder: () => setIsAddFolderOpen(true),
    closeAddFolder: () => setIsAddFolderOpen(false),
    addFolder,
    removeFolder,
    detect,
    search,
    setSearch,
    sourceFilter,
    setSourceFilter,
    favoritesOnly,
    setFavoritesOnly,
    mediaKind,
    setMediaKind,
    filtersActive,
    clearFilters,
  };
}

export type GalleryController = ReturnType<typeof useGallery>;
