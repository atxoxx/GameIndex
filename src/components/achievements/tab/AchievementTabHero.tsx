import type { ReactNode } from "react";
import { RefreshCw, Trophy } from "lucide-react";
import type { AchievementSource, Game } from "../../../types/game";
import { gameDisplayName } from "../../../types/game";
import { useLanguage } from "../../../context/LanguageContext";
import { Button } from "../../ui";
import AchievementSourceBadge from "../AchievementSourceBadge";
import {
  formatRelativeTime,
  formatUnlockDate,
} from "../achievementUtils";

export interface AchievementTabHeroProps {
  game: Game;
  source: AchievementSource;
  pct: number;
  unlocked: number;
  total: number;
  gamerscore: { earned: number; total: number; pct: number };
  firstUnlock: number;
  lastUnlock: number;
  isPerfect: boolean;
  syncing: boolean;
  onRefresh: () => void;
  onEditManual?: () => void;
  /** Multi-source switcher rendered beside the identity, when relevant. */
  sourcePicker?: ReactNode;
}

/** The game's completion masthead: cover, ring, points, dates and sync. */
export default function AchievementTabHero({
  game,
  source,
  pct,
  unlocked,
  total,
  gamerscore,
  firstUnlock,
  lastUnlock,
  isPerfect,
  syncing,
  onRefresh,
  onEditManual,
  sourcePicker,
}: AchievementTabHeroProps) {
  const { t } = useLanguage();

  return (
    <div className={`ach-tab-hero${isPerfect ? " is-perfect" : ""}`}>
      <div className="ach-tab-cover">
        {game.coverArtUrl ? (
          <img src={game.coverArtUrl} alt="" loading="lazy" />
        ) : (
          <div className="ach-tab-cover-placeholder">
            <Trophy size={26} aria-hidden="true" />
          </div>
        )}
      </div>

      <div className="ach-tab-ring">
        <svg className="achievements-ring" viewBox="0 0 120 120">
          <circle
            className="achievements-ring-bg"
            cx="60"
            cy="60"
            r="52"
            stroke="var(--color-bg-tertiary)"
            strokeWidth="9"
            fill="transparent"
          />
          <circle
            className="achievements-ring-fill"
            cx="60"
            cy="60"
            r="52"
            strokeWidth="9"
            stroke={isPerfect ? "var(--color-warning)" : "var(--color-accent)"}
            strokeDasharray={2 * Math.PI * 52}
            strokeDashoffset={2 * Math.PI * 52 * (1 - pct / 100)}
            strokeLinecap="round"
            fill="transparent"
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div className="achievements-ring-label">
          <span className="achievements-ring-pct">{pct}%</span>
          <span className="achievements-ring-sub">
            {unlocked}/{total}
          </span>
        </div>
      </div>

      <div className="ach-tab-identity">
        <div className="ach-tab-title-row">
          <h3 className="ach-tab-name">{gameDisplayName(game)}</h3>
          <AchievementSourceBadge source={source} />
          {isPerfect && (
            <span className="ach-tab-perfect-pill" title={t("achievements.perfectComplete")}>
              <Trophy size={12} aria-hidden="true" /> 100%
            </span>
          )}
        </div>

        <div className="ach-tab-points-row">
          <span className="ach-tab-points-val">
            {gamerscore.earned}{" "}
            <span className="ach-tab-points-max">
              / {gamerscore.total} {t("achievements.pointsShort")}
            </span>
          </span>
          <span className="ach-tab-points-level">
            {gamerscore.pct}% {t("achievementsPage.pointsEarned")}
          </span>
        </div>

        <div className="ach-tab-dates">
          <span className="ach-tab-date">
            <b>{t("achievements.firstUnlock")}</b>
            {firstUnlock ? formatUnlockDate(firstUnlock) : "—"}
          </span>
          <span className="ach-tab-date">
            <b>{t("achievements.lastUnlock")}</b>
            {lastUnlock
              ? `${formatUnlockDate(lastUnlock)} (${formatRelativeTime(lastUnlock)})`
              : "—"}
          </span>
        </div>

        {sourcePicker && <div className="ach-tab-sources">{sourcePicker}</div>}
      </div>

      <div className="ach-tab-actions">
        {onEditManual && (
          <Button variant="ghost" size="sm" onClick={onEditManual}>
            {t("achievements.editManualUnlocks")}
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<RefreshCw size={14} className={syncing ? "spin-animation" : undefined} />}
          onClick={onRefresh}
          disabled={syncing}
        >
          {t("achievements.sync")}
        </Button>
      </div>
    </div>
  );
}
