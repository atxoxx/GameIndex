import { useLanguage } from "../../context/LanguageContext";

interface AchievementsSummaryHeroProps {
  gamerscore: { earned: number; total: number; pct: number };
  stats: {
    totalAchievements: number;
    totalUnlocked: number;
    overallPct: number;
    perfectGames: number;
    gamesWithData: number;
    avgCompletion: number;
  };
}

export default function AchievementsSummaryHero({
  gamerscore,
  stats,
}: AchievementsSummaryHeroProps) {
  const { t } = useLanguage();

  return (
    <div className="ach-hero-panel">
      {/* Primary Gamerscore / Prestige Banner */}
      <div className="ach-hero-score-banner">
        <div className="ach-hero-score-left">
          <div className="ach-hero-badge-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" width="32" height="32">
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
              <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
              <path d="M4 22h16" />
              <path d="M10 14.66V17c0 .55-.45 1-1 1H7" />
              <path d="M14 14.66V17c0 .55.45 1 1 1h2" />
              <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
            </svg>
          </div>
          <div className="ach-hero-score-info">
            <span className="ach-hero-score-eyebrow">
              {t("achievementsPage.gamerscoreTitle")}
            </span>
            <div className="ach-hero-score-row">
              <span className="ach-hero-score-earned">
                {gamerscore.earned.toLocaleString()}
              </span>
              <span className="ach-hero-score-divider">/</span>
              <span className="ach-hero-score-total">
                {gamerscore.total.toLocaleString()} {t("achievementsPage.pointsShort")}
              </span>
            </div>
          </div>
        </div>

        {/* Global Level / Progress Ring or Bar */}
        <div className="ach-hero-score-bar-wrap">
          <div className="ach-hero-score-bar-header">
            <span className="ach-hero-score-pct-label">
              {t("achievementsPage.totalPointsProgress")}
            </span>
            <span className="ach-hero-score-pct-val">{gamerscore.pct}%</span>
          </div>
          <div className="ach-hero-score-bar">
            <div
              className="ach-hero-score-bar-fill"
              style={{ width: `${gamerscore.pct}%` }}
            />
          </div>
        </div>
      </div>

      {/* KPI Tiles */}
      <div className="achievements-summary-grid">
        <div className="achievements-summary-card ach-kpi-unlocked">
          <div className="ach-kpi-icon-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M12 15l-2 5-1-3-3-1 5-2z" />
              <path d="M18.364 5.636a9 9 0 0 1-12.728 12.728" />
            </svg>
          </div>
          <div className="ach-kpi-data">
            <span className="achievements-summary-value">{stats.totalUnlocked.toLocaleString()}</span>
            <span className="achievements-summary-label">{t("achievementsPage.unlocked")}</span>
          </div>
        </div>

        <div className="achievements-summary-card ach-kpi-total">
          <div className="ach-kpi-icon-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <div className="ach-kpi-data">
            <span className="achievements-summary-value">{stats.totalAchievements.toLocaleString()}</span>
            <span className="achievements-summary-label">{t("achievementsPage.total")}</span>
          </div>
        </div>

        <div className="achievements-summary-card ach-kpi-completion">
          <div className="ach-kpi-icon-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div className="ach-kpi-data">
            <span className="achievements-summary-value">{stats.overallPct}%</span>
            <span className="achievements-summary-label">{t("achievementsPage.completion")}</span>
          </div>
        </div>

        <div className="achievements-summary-card achievements-summary-perfect">
          <div className="ach-kpi-icon-wrap ach-kpi-gold">
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </div>
          <div className="ach-kpi-data">
            <span className="achievements-summary-value ach-val-gold">{stats.perfectGames}</span>
            <span className="achievements-summary-label">{t("achievementsPage.perfectGames")}</span>
          </div>
        </div>

        <div className="achievements-summary-card ach-kpi-avg">
          <div className="ach-kpi-icon-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
          </div>
          <div className="ach-kpi-data">
            <span className="achievements-summary-value">{stats.avgCompletion}%</span>
            <span className="achievements-summary-label">{t("achievementsPage.avgCompletion")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
