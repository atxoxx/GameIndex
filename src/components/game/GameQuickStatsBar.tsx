import { useMemo } from "react";
import type { Game, SizeUnit } from "../../types/game";
import { formatSize, parsePlayTime } from "../../types/game";
import { useSteamGameStats } from "../../hooks/useSteamGameStats";
import { useLanguage } from "../../context/LanguageContext";
import { IconClock, IconHardDrive, IconStar, IconShield, IconCalendar } from "./icons";

interface GameQuickStatsBarProps {
  game: Game;
  steamAppId?: number | null;
  sizeUnit: SizeUnit;
  isStoreMode?: boolean;
}

function formatRelativeTime(timestamp: number | undefined, neverText: string): string {
  if (!timestamp || timestamp <= 0) return neverText;
  const now = Date.now();
  const diffMs = now - timestamp;
  if (diffMs < 0) return "Just now";

  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays === 0) {
    if (diffHours === 0) {
      if (diffMin <= 1) return "Just now";
      return `${diffMin}m ago`;
    }
    return `${diffHours}h ago`;
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months}mo ago`;
  }
  const years = Math.floor(diffDays / 365);
  return `${years}y ago`;
}

export default function GameQuickStatsBar({
  game,
  steamAppId: steamAppIdProp,
  sizeUnit,
  isStoreMode = false,
}: GameQuickStatsBarProps) {
  const { t } = useLanguage();
  const effectiveSteamAppId = steamAppIdProp !== undefined ? steamAppIdProp : game.steamAppId;
  const { data: steamStats } = useSteamGameStats(effectiveSteamAppId ?? undefined);

  // 1. Reception stats
  const ratingScore = game.igdbRating || game.criticRating || null;
  const steamReviews = steamStats?.reviews;
  const steamPositivePercent =
    steamReviews && steamReviews.totalReviews > 0
      ? Math.round((steamReviews.totalPositive / steamReviews.totalReviews) * 100)
      : null;

  // 2. Time to beat & playtime progress
  const ttb = game.timeToBeat;
  const storySeconds = ttb?.normally || ttb?.hastily || 0;
  const storyHours = storySeconds > 0 ? Math.round(storySeconds / 3600) : null;
  const completionistSeconds = ttb?.completely || 0;
  const completionistHours = completionistSeconds > 0 ? Math.round(completionistSeconds / 3600) : null;

  const currentMinutes = parsePlayTime(game.playTime || "0h");
  const currentHours = Math.round((currentMinutes / 60) * 10) / 10;
  const storyProgressPercent =
    storyHours && storyHours > 0 ? Math.min(100, Math.round((currentHours / storyHours) * 100)) : null;

  // 3. Storage
  const sizeValue = game.sizeBytes ?? null;
  const formattedSize = sizeValue != null ? formatSize(sizeValue, sizeUnit) : null;

  // 4. Last played
  const lastPlayedRelative = useMemo(() => {
    return formatRelativeTime(game.lastPlayed, t("game.quickStats.neverPlayed"));
  }, [game.lastPlayed, t]);

  const scoreClass =
    ratingScore && ratingScore >= 75
      ? "quick-stats__score--high"
      : ratingScore && ratingScore >= 50
      ? "quick-stats__score--mid"
      : "quick-stats__score--low";

  return (
    <div className="game-quick-stats-bar" aria-label="Game Quick Stats">
      {/* 1. Reception Tile */}
      {(ratingScore != null || steamPositivePercent != null) && (
        <div className="quick-stats-tile">
          <div className="quick-stats-tile__icon-wrap">
            <IconStar size={16} className="quick-stats-tile__icon" />
          </div>
          <div className="quick-stats-tile__content">
            <div className="quick-stats-tile__label">{t("game.quickStats.reception")}</div>
            <div className="quick-stats-tile__value-row">
              {ratingScore != null && (
                <span className={`quick-stats__score-pill ${scoreClass}`}>
                  {Math.round(ratingScore)}
                </span>
              )}
              {steamPositivePercent != null && (
                <span className="quick-stats__sub-badge" title="Steam Positive Reviews">
                  {steamPositivePercent}% {t("review.positive")}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. Time to Beat Tile */}
      {(storyHours != null || completionistHours != null) && (
        <div className="quick-stats-tile">
          <div className="quick-stats-tile__icon-wrap">
            <IconClock size={16} className="quick-stats-tile__icon" />
          </div>
          <div className="quick-stats-tile__content">
            <div className="quick-stats-tile__label">{t("game.quickStats.timeToBeat")}</div>
            <div className="quick-stats-tile__value-row">
              {storyHours != null && (
                <span className="quick-stats-tile__value">
                  {storyHours}h <span className="quick-stats__hint">({t("game.quickStats.story")})</span>
                </span>
              )}
              {completionistHours != null && (
                <span className="quick-stats__divider">•</span>
              )}
              {completionistHours != null && (
                <span className="quick-stats-tile__value">
                  {completionistHours}h <span className="quick-stats__hint">({t("game.quickStats.completionist")})</span>
                </span>
              )}
            </div>
            {storyProgressPercent != null && !isStoreMode && (
              <div className="quick-stats-tile__mini-bar" title={`${storyProgressPercent}% completed`}>
                <div
                  className="quick-stats-tile__mini-fill"
                  style={{ width: `${storyProgressPercent}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. Storage Footprint Tile */}
      {formattedSize && (
        <div className="quick-stats-tile">
          <div className="quick-stats-tile__icon-wrap">
            <IconHardDrive size={16} className="quick-stats-tile__icon" />
          </div>
          <div className="quick-stats-tile__content">
            <div className="quick-stats-tile__label">{t("game.quickStats.storage")}</div>
            <div className="quick-stats-tile__value-row">
              <span className="quick-stats-tile__value">{formattedSize}</span>
              <span className="quick-stats__hint">
                {game.installed ? t("filter.installed") : t("game.quickStats.storage")}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 4. Compatibility / Platform Readiness */}
      {effectiveSteamAppId != null && (
        <div className="quick-stats-tile">
          <div className="quick-stats-tile__icon-wrap">
            <IconShield size={16} className="quick-stats-tile__icon" />
          </div>
          <div className="quick-stats-tile__content">
            <div className="quick-stats-tile__label">{t("game.quickStats.compatibility")}</div>
            <div className="quick-stats-tile__value-row">
              <span className="quick-stats__compat-pill">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                  <path d="M6 11h4M8 9v4M15 11h.01M18 11h.01M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7z" />
                </svg>
                {t("game.quickStats.deckVerified")}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* 5. Last Played (Library Only) */}
      {!isStoreMode && (
        <div className="quick-stats-tile">
          <div className="quick-stats-tile__icon-wrap">
            <IconCalendar size={16} className="quick-stats-tile__icon" />
          </div>
          <div className="quick-stats-tile__content">
            <div className="quick-stats-tile__label">{t("game.quickStats.lastPlayed")}</div>
            <div className="quick-stats-tile__value-row">
              <span className="quick-stats-tile__value">{lastPlayedRelative}</span>
              {currentHours > 0 && (
                <span className="quick-stats__hint">
                  {currentHours}h {t("hero.playTime").toLowerCase()}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
