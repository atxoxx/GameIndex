import { memo, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames, NO_IGDB_MATCH_SOURCE } from "../../context/GameContext";
import { useSteamGridArt } from "../../context/SteamGridDbContext";
import { useLanguage } from "../../context/LanguageContext";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import { accentForPlatform } from "../../types/emulator";
import { preloadGameDetail } from "../../utils/routePreload";
import { toWebviewAssetUrl } from "../../utils/artworkUrl";
import HighlightedName from "./HighlightedName";
import type { SidebarGameItemProps } from "./types";

/**
 * SidebarGameItem
 * ───────────────
 * Single row in the sidebar's game list.
 * Features:
 *   • Multi-density rendering: Compact (28px), Standard (42px), Detailed (56px).
 *   • Lazy cover & icon metadata enrichment via IntersectionObserver.
 *   • Favorite / Pin star toggle button.
 *   • Dynamic emulator console tag & play-status micro-dots.
 *   • Steam / Retro achievement unlock progress badge.
 *   • Rating score badge in detailed mode.
 *   • Search match highlighting.
 *   • Pulsing running indicator with glow halo.
 *   • Smooth quick-play launch on hover.
 *   • Multi-select checkmark indicator.
 */
function SidebarGameItemBase({
  game,
  isSelected,
  isRunning,
  isPinned,
  bulkSelected,
  isRandomHighlight,
  density = "standard",
  viewOptions,
  searchQuery,
  prefersCover,
  onPointerEnter,
  onPointerLeave,
  onQuickPlay,
  onTogglePin,
}: SidebarGameItemProps) {
  const { updateGame, enrichGameMetadata, getGame } = useGames();
  const { t } = useLanguage();
  const coverRef = useRef<HTMLDivElement | null>(null);

  const [isNearViewport, setIsNearViewport] = useState(false);
  const sgdb = useSteamGridArt(
    isNearViewport && !game.iconUrl ? game.steamAppId : null
  );
  const attemptedIconAppIdRef = useRef<number | null>(null);

  const canAutoFetchCover =
    !game.coverArtUrl &&
    (game.igdbId != null || game.metadataSource !== NO_IGDB_MATCH_SOURCE) &&
    !!game.name;

  useEffect(() => {
    if (game.iconUrl) return;
    if (!game.steamAppId) return;
    if (attemptedIconAppIdRef.current === game.steamAppId) return;
    const iconUrl = sgdb?.iconUrl;
    if (!iconUrl) {
      if (sgdb) attemptedIconAppIdRef.current = game.steamAppId;
      return;
    }
    attemptedIconAppIdRef.current = game.steamAppId;
    let cancelled = false;
    invoke<string | null>("download_artwork", { gameId: game.id, slot: "icon", url: iconUrl })
      .then(async (relativePath) => {
        if (cancelled || !relativePath) return;
        const assetUrl = toWebviewAssetUrl(
          await invoke<string>("artwork_asset_url", { relativePath })
        );
        if (cancelled) return;
        updateGame(game.id, { iconUrl: assetUrl });
        const fresh = getGame(game.id) ?? game;
        invoke("save_game", { game: { ...fresh, iconUrl: assetUrl } }).catch(
          (err) => console.warn(`Persist sidebar icon failed for ${game.name}:`, err)
        );
      })
      .catch((err) =>
        console.warn(`Sidebar icon download failed for ${game.name}:`, err)
      );
    return () => {
      cancelled = true;
    };
  }, [sgdb, game, updateGame, getGame]);

  useEffect(() => {
    if (!coverRef.current) return;
    const node = coverRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        setIsNearViewport(true);
        if (canAutoFetchCover) {
          enrichGameMetadata(game.id, game.name, game.steamAppId).catch((err) =>
            console.warn(`Sidebar auto-cover fetch failed for ${game.name}:`, err)
          );
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canAutoFetchCover, game.id, game.name, game.steamAppId, enrichGameMetadata]);

  // Achievement stats if available
  const achievementCount = game.steamAchievements ? game.steamAchievements.length : 0;
  const unlockedCount = game.steamAchievements
    ? game.steamAchievements.filter((a) => a.achieved).length
    : 0;
  const achievementPercent =
    achievementCount > 0 ? Math.round((unlockedCount / achievementCount) * 100) : null;

  // Rating
  const rating =
    typeof game.igdbRating === "number"
      ? Math.round(game.igdbRating)
      : typeof game.criticRating === "number"
      ? Math.round(game.criticRating)
      : null;

  const showPlaytime = viewOptions ? viewOptions.showPlaytime : true;
  const showPlatformBadge = viewOptions ? viewOptions.showPlatformBadge : true;
  const showAchievements = viewOptions ? viewOptions.showAchievements : true;
  const showRatings = viewOptions ? viewOptions.showRatings : true;

  const rowClasses = [
    "sidebar-game-item",
    `sidebar-game-item--${density}`,
    isSelected ? "active" : "",
    bulkSelected ? "bulk-selected" : "",
    game.iconUrl ? "has-icon" : "",
    isRandomHighlight ? "random-picked" : "",
    isPinned ? "is-pinned" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      role="button"
      tabIndex={0}
      ref={coverRef}
      data-sidebar-game-id={game.id}
      className={rowClasses}
      onMouseEnter={() => {
        preloadGameDetail();
        onPointerEnter(game);
      }}
      onFocus={() => {
        preloadGameDetail();
      }}
      onMouseLeave={() => onPointerLeave(game)}
      aria-selected={isSelected}
    >
      <div className="sidebar-game-icon">
        {prefersCover && game.coverArtUrl ? (
          <img
            src={game.coverArtUrl}
            alt={game.name}
            onError={(e) => {
              const img = e.currentTarget;
              const appId = game.steamAppId;
              if (appId) {
                if (img.src.includes("library_600x900_2x")) {
                  img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
                  return;
                }
                if (img.src.includes("library_600x900")) {
                  img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
                  return;
                }
              }
              if (game.iconUrl && img.src !== game.iconUrl) {
                img.src = game.iconUrl;
              }
            }}
          />
        ) : game.iconUrl ? (
          <img src={game.iconUrl} alt={game.name} />
        ) : game.coverArtUrl ? (
          <img
            src={game.coverArtUrl}
            alt={game.name}
            onError={(e) => {
              const img = e.currentTarget;
              const appId = game.steamAppId;
              if (appId) {
                if (img.src.includes("library_600x900_2x")) {
                  img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;
                  return;
                }
                if (img.src.includes("library_600x900")) {
                  img.src = `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`;
                  return;
                }
              }
              updateGame(game.id, { coverArtUrl: undefined, coverSourceUrl: undefined });
            }}
          />
        ) : (
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            opacity={0.3}
            aria-hidden="true"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        )}
      </div>

      <div className="sidebar-game-info">
        <div className="sidebar-game-name">
          {game.emulatorId && showPlatformBadge && (
            <span
              className="sidebar-game-console-badge"
              style={{
                color: accentForPlatform(game.platform),
                borderColor: accentForPlatform(game.platform),
              }}
              title={t("emulators.consoleBadge")}
            >
              {game.platform}
            </span>
          )}
          <HighlightedName name={game.name} query={searchQuery} />
        </div>

        {density !== "compact" && (
          <div className="sidebar-game-meta">
            {game.playStatus && game.playStatus !== "backlog" && (
              <span
                className="sidebar-game-meta-dot"
                style={{ background: PLAY_STATUS_DETAILS[game.playStatus].color }}
                title={t(PLAY_STATUS_DETAILS[game.playStatus].labelKey)}
                aria-hidden="true"
              />
            )}
            <span className="sidebar-game-meta-text">
              {showPlatformBadge && game.platform ? `${game.platform}` : ""}
              {showPlatformBadge && showPlaytime && game.playTime ? " · " : ""}
              {showPlaytime ? game.playTime : ""}
            </span>

            {/* Achievement badge in detailed mode */}
            {density === "detailed" && showAchievements && achievementPercent !== null && (
              <span
                className="sidebar-game-achievement-badge"
                title={`${unlockedCount}/${achievementCount} achievements unlocked (${achievementPercent}%)`}
              >
                🏆 {achievementPercent}%
              </span>
            )}

            {/* Rating badge in detailed mode */}
            {density === "detailed" && showRatings && rating !== null && (
              <span className="sidebar-game-rating-badge" title={`Rating: ${rating}%`}>
                ★ {rating}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Favorite pin button */}
      {onTogglePin && (
        <button
          type="button"
          className={`sidebar-game-pin-btn${isPinned ? " is-pinned" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onTogglePin(game);
          }}
          title={isPinned ? t("sidebar.unpin") : t("sidebar.pinToTop")}
          aria-label={isPinned ? t("sidebar.unpin") : t("sidebar.pinToTop")}
        >
          <svg viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
            <path d="M12 2 9 9 2 9.5l5.5 4.5L5 22l7-4 7 4-2.5-8 5.5-4.5L15 9z" />
          </svg>
        </button>
      )}

      {/* Install / running status dot */}
      <div
        className={`sidebar-game-status ${isRunning ? "running" : game.installed ? "installed" : "not-installed"}`}
        aria-label={
          isRunning
            ? t("game.running")
            : game.installed
            ? t("filter.installed")
            : t("game.notInstalled")
        }
      />

      {/* Quick Play hover button */}
      {!isRunning && (
        <button
          type="button"
          className="sidebar-game-play"
          aria-label={t("game.playGame")}
          title={t("game.playGame")}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onQuickPlay(game);
          }}
          onContextMenu={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
        </button>
      )}

      {/* Multi-select checkmark */}
      <div className="sidebar-game-item__check" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
    </div>
  );
}

export const SidebarGameItem = memo(SidebarGameItemBase);
export default SidebarGameItem;
