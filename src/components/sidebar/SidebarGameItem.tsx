import { memo, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGames } from "../../context/GameContext";
import { useSteamGridArt } from "../../context/SteamGridDbContext";
import { useLanguage } from "../../context/LanguageContext";
import {
  PLAY_STATUS_DETAILS,
  gameDisplayName,
  gameIsVr,
  type Game,
} from "../../types/game";
import { accentForPlatform } from "../../types/emulator";
import { preloadGameDetail } from "../../utils/routePreload";
import { thumbVariantUrl, toWebviewAssetUrl } from "../../utils/artworkUrl";
import { useSharedViewportVisibility } from "../../hooks/useSharedViewportVisibility";
import HighlightedName from "./HighlightedName";
import type { SidebarGameItemProps } from "./types";

/**
 * SidebarGameItem
 * ───────────────
 * One game in the rail.
 *
 *   [art •]  Title ………………………………………                [pin][play]
 *            ● Playing · PC · 42h · ★87
 *
 * The install/running state moved onto the artwork as a corner dot, which freed
 * the right edge for the row actions and gave the title the full row width. The
 * action cluster only exists on hover (or while pinned), so a resting list is
 * just art, name and one quiet fact line.
 *
 * Densities: compact = name only (28px row), standard = two lines (44px),
 * detailed = taller art and the play-status label (56px).
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
  onPointerEnter,
  onPointerLeave,
  onQuickPlay,
  onTogglePin,
}: SidebarGameItemProps) {
  const { updateGame, enqueueEnrich } = useGames();
  const { t } = useLanguage();
  const coverRef = useRef<HTMLDivElement | null>(null);
  const displayName = gameDisplayName(game);
  const isVr = gameIsVr(game);

  const [isNearViewport, setIsNearViewport] = useState(false);
  // Always ask SteamGridDB while the row is visible: the poster, hero and
  // logo come from the same response as the icon. Previously the lookup was
  // skipped whenever an icon existed, so scrolling never backfilled anything.
  const sgdb = useSteamGridArt(isNearViewport ? game.steamAppId : null);
  const attemptedArtRef = useRef<Set<string>>(new Set());

  const needsArtwork =
    !!game.name &&
    (!game.coverArtUrl ||
      (!game.steamAppId && (!game.iconUrl || !game.logoUrl || !game.bannerUrl)));

  // Fill any missing artwork slot from SteamGridDB. Each slot is attempted
  // once per mounted row; a failed URL clears its mark so a later error/retry
  // can refill it. Slots already present are never overwritten (the user's
  // picked art wins).
  useEffect(() => {
    if (!isNearViewport || !sgdb) return;
    const candidates: Array<{
      slot: "cover" | "hero" | "logo" | "icon";
      field: "coverArtUrl" | "bannerUrl" | "logoUrl" | "iconUrl";
      url: string | null;
    }> = [
      { slot: "cover", field: "coverArtUrl", url: sgdb.gridUrl },
      { slot: "hero", field: "bannerUrl", url: sgdb.heroUrl ?? sgdb.gridUrl },
      { slot: "logo", field: "logoUrl", url: sgdb.logoUrl },
      { slot: "icon", field: "iconUrl", url: sgdb.iconUrl },
    ];
    let cancelled = false;
    void (async () => {
      const patch: Partial<Game> = {};
      for (const candidate of candidates) {
        if (!candidate.url || game[candidate.field]) continue;
        const key = `${game.id}:${candidate.slot}`;
        if (attemptedArtRef.current.has(key)) continue;
        attemptedArtRef.current.add(key);
        try {
          const relativePath = await invoke<string | null>("download_artwork", {
            gameId: game.id,
            slot: candidate.slot,
            url: candidate.url,
          });
          if (cancelled || !relativePath) continue;
          const assetUrl = toWebviewAssetUrl(
            await invoke<string>("artwork_asset_url", { relativePath }),
          );
          if (cancelled) return;
          Object.assign(patch, { [candidate.field]: assetUrl });
        } catch (err) {
          attemptedArtRef.current.delete(key);
          console.warn(`Sidebar ${candidate.slot} download failed for ${game.name}:`, err);
        }
      }
      if (cancelled || Object.keys(patch).length === 0) return;
      updateGame(game.id, patch);
      // Patch only the artwork columns: the row may be a lightweight summary,
      // so a full `save_game` would clear its heavy fields.
      invoke("patch_game", { id: game.id, patch }).catch((err) =>
        console.warn(`Persist sidebar artwork failed for ${game.name}:`, err),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [isNearViewport, sgdb, game, updateGame]);

  // Shared viewport observer (one instance app-wide): flips `isNearViewport`
  // for the lazy artwork and queues background enrichment for rows that still
  // lack art — the sidebar renders a row per game, so per-item observers
  // compounded fast.
  useSharedViewportVisibility({
    targetRef: coverRef,
    dep: game.id,
    onVisible: () => {
      setIsNearViewport(true);
      if (needsArtwork) {
        enqueueEnrich(
          { id: game.id, name: game.name, steamAppId: game.steamAppId },
          true
        );
      }
    },
  });

  const rating =
    typeof game.igdbRating === "number"
      ? Math.round(game.igdbRating)
      : typeof game.criticRating === "number"
      ? Math.round(game.criticRating)
      : null;

  const showPlaytime = viewOptions ? viewOptions.showPlaytime : true;
  const showPlatformBadge = viewOptions ? viewOptions.showPlatformBadge : true;
  const showRatings = viewOptions ? viewOptions.showRatings : true;

  const playStatus =
    game.playStatus && game.playStatus !== "backlog"
      ? PLAY_STATUS_DETAILS[game.playStatus]
      : null;

  const stateLabel = isRunning
    ? t("game.running")
    : game.installed
      ? t("filter.installed")
      : t("game.notInstalled");

  const rowClasses = [
    "sidebar-game-item",
    `sidebar-game-item--${density}`,
    isSelected ? "active" : "",
    bulkSelected ? "bulk-selected" : "",
    game.iconUrl ? "has-icon" : "",
    !game.iconUrl && !game.coverArtUrl && game.logoUrl ? "has-logo" : "",
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
      data-game-detail-route={`/library/${game.id}`}
      data-game-detail-title={displayName}
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
        {game.iconUrl ? (
          <img
            src={game.iconUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={(e) => {
              const img = e.currentTarget;
              if (game.coverArtUrl && img.dataset.fallback !== "cover") {
                img.dataset.fallback = "cover";
                img.src = thumbVariantUrl(game.coverArtUrl) ?? game.coverArtUrl;
                return;
              }
              // Icon and cover both fail (e.g. an artwork file was removed).
              // Clear only the dead icon; the cover branch handles its own
              // failure and the attempt marks stop this from looping.
              updateGame(game.id, { iconUrl: undefined });
            }}
          />
        ) : game.coverArtUrl ? (
          <img
            src={thumbVariantUrl(game.coverArtUrl) ?? game.coverArtUrl}
            alt=""
            loading="lazy"
            decoding="async"
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
              updateGame(game.id, { coverArtUrl: undefined, coverSourceUrl: undefined });            }}
          />
        ) : game.logoUrl ? (
          <img
            src={game.logoUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="sidebar-game-logo"
            onError={() => {
              updateGame(game.id, { logoUrl: undefined, logoSourceUrl: undefined });
            }}
          />
        ) : (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        )}

        <span
          className={`sidebar-game-status ${isRunning ? "running" : game.installed ? "installed" : "not-installed"}`}
          title={stateLabel}
          aria-label={stateLabel}
        />
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
          {isVr && (
            <span className="sidebar-game-vr-badge" title={t("library.vrBadge")}>
              {t("library.vrBadge")}
            </span>
          )}
          <span className="sidebar-game-name__text">
            <HighlightedName name={displayName} query={searchQuery} />
          </span>
        </div>

        {density !== "compact" && (
          <div className="sidebar-game-meta">
            {playStatus && (
              <span
                className="sidebar-game-meta-dot"
                style={{ background: playStatus.color }}
                title={t(playStatus.labelKey)}
                aria-label={t(playStatus.labelKey)}
              />
            )}
            {density === "detailed" && playStatus && (
              <span className="sbn-meta sbn-meta--status">{t(playStatus.labelKey)}</span>
            )}
            {showPlatformBadge && game.platform && (
              <span className="sbn-meta">{game.platform}</span>
            )}
            {showPlaytime && game.playTime && (
              <span className="sbn-meta">{game.playTime}</span>
            )}
            {showRatings && rating !== null && (
              <span className="sbn-meta sbn-meta--rating" title={`${t("ratings.title")}: ${rating}`}>
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                {rating}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="sidebar-game-actions">
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
      </div>

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
