import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../../../context/LanguageContext";
import { Card } from "../../../components/ui";
import {
  computePerfectGames,
  computeNearCompletionGames,
  computeRarestAchievements,
  collectUnlockedAchievements,
} from "../statsCalculations";
import type { Game, GameAchievementData } from "../statsTypes";

interface AchievementsTabProps {
  achievementCache: Record<string, GameAchievementData>;
  games: Game[];
  hideAchievementProgress: boolean;
}

export function AchievementsTab({
  achievementCache,
  games,
  hideAchievementProgress,
}: AchievementsTabProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  // Summary counts
  const { totalAchievements, unlockedAchievements, totalGamerscore } = useMemo(() => {
    let tot = 0;
    let unl = 0;
    for (const gid of Object.keys(achievementCache)) {
      const data = achievementCache[gid];
      tot += data.total;
      unl += data.unlocked;
    }
    // Estimated Gamerscore (avg 15G per unlock)
    return {
      totalAchievements: tot,
      unlockedAchievements: unl,
      totalGamerscore: unl * 15,
    };
  }, [achievementCache]);

  const completionPct =
    totalAchievements > 0 ? Math.round((unlockedAchievements / totalAchievements) * 100) : 0;

  // Perfect Games Wall of Fame (100% unlocked)
  const perfectGames = useMemo(
    () => computePerfectGames(achievementCache, games),
    [achievementCache, games]
  );

  // Near Completion Games (50% - 99%)
  const nearCompletionGames = useMemo(
    () => computeNearCompletionGames(achievementCache, games),
    [achievementCache, games]
  );

  // Rarest Achievements Unlocked
  const rarestAchievements = useMemo(
    () => computeRarestAchievements(achievementCache, games),
    [achievementCache, games]
  );

  // Recently Unlocked Achievements
  const recentUnlocks = useMemo(
    () => collectUnlockedAchievements(achievementCache, games),
    [achievementCache, games]
  );

  if (hideAchievementProgress) {
    return (
      <div className="stats-tab-achievements stats-empty-view">
        <p>{t("settingsPage.hideAchievementProgress")}</p>
      </div>
    );
  }

  return (
    <div className="stats-tab-achievements">
      {/* ── Gamerscore & Trophy Overview Card ───────────────────────── */}
      <Card variant="glass" elevation="glow" className="stats-achievements-hero-card">
        <div className="stats-achievements-hero-grid">
          <div className="stats-ach-hero-stat">
            <span className="stats-ach-hero-icon">🏆</span>
            <div className="stats-ach-hero-content">
              <span className="stats-ach-hero-val">{unlockedAchievements} / {totalAchievements}</span>
              <span className="stats-ach-hero-lbl">{t("community.achievements")} ({completionPct}%)</span>
            </div>
          </div>

          <div className="stats-ach-hero-stat">
            <span className="stats-ach-hero-icon">💎</span>
            <div className="stats-ach-hero-content">
              <span className="stats-ach-hero-val">{totalGamerscore.toLocaleString()} G</span>
              <span className="stats-ach-hero-lbl">{t("stats.ach.gamerscoreScore")}</span>
            </div>
          </div>

          <div className="stats-ach-hero-stat">
            <span className="stats-ach-hero-icon">👑</span>
            <div className="stats-ach-hero-content">
              <span className="stats-ach-hero-val">{perfectGames.length}</span>
              <span className="stats-ach-hero-lbl">{t("stats.ach.perfectGamesCount")}</span>
            </div>
          </div>

          <div className="stats-ach-hero-stat">
            <span className="stats-ach-hero-icon">🎯</span>
            <div className="stats-ach-hero-content">
              <span className="stats-ach-hero-val">{nearCompletionGames.length}</span>
              <span className="stats-ach-hero-lbl">{t("stats.ach.nearCompletionCount")}</span>
            </div>
          </div>
        </div>

        {/* Global Progress Bar */}
        <div className="stats-ach-hero-progress-track">
          <div
            className="stats-ach-hero-progress-fill"
            style={{ width: `${completionPct}%` }}
          />
        </div>
      </Card>

      {/* ── 100% Perfect Games Wall of Fame ───────────────────────── */}
      <section className="stats-section">
        <div className="stats-section-header-row">
          <h2 className="stats-section-title">👑 {t("stats.ach.wallOfFame")}</h2>
          <span className="stats-section-badge">{perfectGames.length} {t("stats.ach.perfected")}</span>
        </div>

        {perfectGames.length > 0 ? (
          <div className="stats-perfect-games-grid">
            {perfectGames.map((g) => (
              <div
                key={g.gameId}
                className="stats-perfect-game-card"
                onClick={() => navigate(`/library/${g.gameId}`)}
                role="button"
                tabIndex={0}
              >
                <div className="stats-perfect-card-cover">
                  {g.coverArtUrl ? (
                    <img src={g.coverArtUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="stats-perfect-cover-fallback">🎮</div>
                  )}
                  <span className="stats-perfect-badge">100%</span>
                </div>
                <div className="stats-perfect-card-info">
                  <span className="stats-perfect-name" title={g.gameName}>{g.gameName}</span>
                  <div className="stats-perfect-meta">
                    <span>{g.totalAchievements} {t("community.achievements")}</span>
                    {g.lastUnlockedTime > 0 && (
                      <span>
                        · {new Date(g.lastUnlockedTime).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Card variant="surface" elevation="1" className="stats-empty-card">
            <p>{t("stats.ach.noPerfectGamesYet")}</p>
          </Card>
        )}
      </section>

      {/* ── Near-Completion Radar (Close to 100%) ─────────────────── */}
      {nearCompletionGames.length > 0 && (
        <section className="stats-section">
          <h2 className="stats-section-title">🎯 {t("stats.ach.nearCompletionTitle")}</h2>
          <div className="stats-near-games-grid">
            {nearCompletionGames.map((g) => (
              <div
                key={g.gameId}
                className="stats-near-game-card"
                onClick={() => navigate(`/library/${g.gameId}`)}
                role="button"
                tabIndex={0}
              >
                <div className="stats-near-card-cover">
                  {g.coverArtUrl ? (
                    <img src={g.coverArtUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="stats-near-cover-fallback">🎮</div>
                  )}
                </div>
                <div className="stats-near-card-info">
                  <div className="stats-near-name-row">
                    <span className="stats-near-name" title={g.gameName}>{g.gameName}</span>
                    <span className="stats-near-pct">{g.percentage}%</span>
                  </div>
                  <div className="stats-near-track">
                    <div className="stats-near-fill" style={{ width: `${g.percentage}%` }} />
                  </div>
                  <span className="stats-near-remaining">
                    {t("stats.ach.remainingToComplete", { count: g.remaining })} ({g.unlocked}/{g.total})
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Rarest Achievements Unlocked ──────────────────────────── */}
      {rarestAchievements.length > 0 && (
        <section className="stats-section">
          <h2 className="stats-section-title">💎 {t("stats.ach.rarestUnlocksTitle")}</h2>
          <div className="stats-rarest-grid">
            {rarestAchievements.map((ach) => {
              const rarityTier =
                ach.rarityPct < 5
                  ? "diamond"
                  : ach.rarityPct < 15
                  ? "gold"
                  : ach.rarityPct < 30
                  ? "silver"
                  : "bronze";
              return (
                <div key={`${ach.gameName}-${ach.achievementId}`} className={`stats-rarest-card tier-${rarityTier}`}>
                  <div className="stats-rarest-icon-wrap">
                    {ach.iconUrl ? (
                      <img src={ach.iconUrl} alt="" loading="lazy" />
                    ) : (
                      <div className="stats-rarest-icon-fallback">🏅</div>
                    )}
                  </div>
                  <div className="stats-rarest-info">
                    <div className="stats-rarest-header">
                      <span className="stats-rarest-name" title={ach.displayName}>{ach.displayName}</span>
                      <span className={`stats-rarest-pill tier-${rarityTier}`}>{ach.rarityPct}%</span>
                    </div>
                    <span className="stats-rarest-game">{ach.gameName}</span>
                    <p className="stats-rarest-desc">{ach.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Recently Unlocked Achievements Timeline Rail ───────────── */}
      {recentUnlocks.length > 0 && (
        <section className="stats-section">
          <h2 className="stats-section-title">🏅 {t("communityExtras.recentlyUnlocked")}</h2>
          <div className="stats-recent-ach-rail">
            {recentUnlocks.map((a, i) => (
              <div key={`${a.gameName}-${a.name}-${i}`} className="stats-recent-ach-card">
                <div className="stats-recent-ach-cover">
                  {a.coverArtUrl ? (
                    <img src={a.coverArtUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="stats-recent-ach-cover-fallback">🎮</div>
                  )}
                </div>
                <div className="stats-recent-ach-body">
                  <span className="stats-recent-ach-game">{a.gameName}</span>
                  <span className="stats-recent-ach-title" title={a.name}>{a.name}</span>
                  <span className="stats-recent-ach-date">
                    {new Date(a.unlockTime).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
