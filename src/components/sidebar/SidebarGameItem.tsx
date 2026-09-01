import { memo, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames, NO_IGDB_MATCH_SOURCE } from "../../context/GameContext";
import { useSteamGridArt } from "../../context/SteamGridDbContext";
import { useLanguage } from "../../context/LanguageContext";
import { PLAY_STATUS_DETAILS } from "../../types/game";
import { accentForPlatform } from "../../types/emulator";
import { preloadGameDetail } from "../../utils/routePreload";
import HighlightedName from "./HighlightedName";
import type { SidebarGameItemProps } from "./types";

/**
 * SidebarGameItem
 * ───────────────
 * Single row in the sidebar's game list.
 * Features:
 *   • Lazy cover metadata enrichment via IntersectionObserver (300px root margin).
 *   • Resilient image priority & Steam-CDN fallback chain.
 *   • Dynamic emulator console tag & play-status micro-dots.
 *   • Search match highlighting.
 *   • Pulsing running state / installed / uninstalled status dot.
 *   • Smooth quick-play launch on hover.
 *   • Multi-select checkmark indicator.
 */
function SidebarGameItemBase({
  game,
  isSelected,
  isRunning,
  bulkSelected,
  searchQuery,
  onPointerEnter,
  onPointerLeave,
  onQuickPlay,
}: SidebarGameItemProps) {
  const { updateGame, enrichGameMetadata, getGame } = useGames();
  const { t } = useLanguage();
  const coverRef = useRef<HTMLDivElement | null>(null);
  // The sidebar renders every row (no virtualization), so SteamGridDB
  // batch registration is gated on the row being near the viewport —
  // otherwise a big library would register hundreds of AppIDs at once.
  const [isNearViewport, setIsNearViewport] = useState(false);
  // Rows with an icon already skip the lookup entirely.
  const sgdb = useSteamGridArt(
    isNearViewport && !game.iconUrl ? game.steamAppId : null
  );
  const iconFetchRef = useRef(false);

  // Auto-enrich criteria — short-circuits the observer setup so we
  // don't spam IGDB for games we already know are unmatched.
  const canAutoFetchCover =
    !game.coverArtUrl &&
    (game.igdbId != null || game.metadataSource !== NO_IGDB_MATCH_SOURCE) &&
    !!game.name;

  // Auto-fetch the SteamGridDB icon: when the batched lookup resolves and
  // the row still has no icon, download the community icon to a base64
  // data URL (keeping PNG alpha) and persist it on the game row so the
  // icon survives restarts and is used everywhere iconUrl is read.
  useEffect(() => {
    if (iconFetchRef.current) return;
    if (game.iconUrl) {
      iconFetchRef.current = true;
      return;
    }
    if (!game.steamAppId) {
      iconFetchRef.current = true; // nothing SteamGridDB can do without an appid
      return;
    }
    const iconUrl = sgdb?.iconUrl;
    if (!iconUrl) return; // lookup not resolved yet, or no community icon
    iconFetchRef.current = true;
    let cancelled = false;
    invoke<string | null>("download_artwork", { gameId: game.id, slot: "icon", url: iconUrl })
      .then(async (relativePath) => {
        if (cancelled || !relativePath) return;
        const assetUrl = await invoke<string>("artwork_asset_url", { relativePath });
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

  // Set up the IntersectionObserver for lazy cover art retrieval + icon
  // visibility gating. The same 300px root margin arms both: enrichment
  // fires for games missing a cover, and the row registers for the
  // SteamGridDB batch so its icon auto-fetches as it scrolls into view.
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

  return (
    <div
      role="button"
      tabIndex={0}
      ref={coverRef}
      data-sidebar-game-id={game.id}
      className={`sidebar-game-item${isSelected ? " active" : ""}${bulkSelected ? " bulk-selected" : ""}${game.iconUrl ? " has-icon" : ""}`}
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
        {game.iconUrl ? (
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
              console.warn(
                `Sidebar cover image failed for ${game.name}, falling back to placeholder`
              );
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
          {game.emulatorId && (
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
            {game.platform} · {game.playTime}
          </span>
        </div>
      </div>

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
