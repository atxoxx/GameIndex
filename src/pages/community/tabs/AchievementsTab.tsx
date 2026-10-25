import { useCallback, useMemo, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Crown, Flag, Gamepad2, Gem, Medal, Target, Trophy } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { Card } from "../../../components/ui";
import {
  collectUnlockedAchievements,
  computeMilestones,
  computeNearCompletionGames,
  computePerfectGames,
  computeRarestAchievements,
  computeStreaks,
  rangeCutoffMs,
} from "../statsCalculations";
import { MilestoneIcon } from "../statsIcons";
import type { Game, GameSession, TimeframePreset } from "../statsTypes";
import type {
  AchievementSummary,
  AchievementUnlockRecord,
} from "../../../types/game";

interface AchievementsTabProps {
  summaries: Record<string, AchievementSummary>;
  rarestUnlocks: AchievementUnlockRecord[];
  recentUnlocks: AchievementUnlockRecord[];
  games: Game[];
  allSessions: GameSession[];
  range: TimeframePreset;
  totalAchievementsUnlocked: number;
  hideAchievementProgress: boolean;
}

/**
 * Achievements — the trophy case.
 *
 * The /achievements page owns syncing, filtering and per-game detail, so this
 * tab stays a curated summary with a clear way through. Milestone badges live
 * here too, next to the perfect games they belong with.
 */
export function AchievementsTab({
  summaries,
  rarestUnlocks,
  recentUnlocks,
  games,
  allSessions,
  range,
  totalAchievementsUnlocked,
  hideAchievementProgress,
}: AchievementsTabProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const { totalAchievements, unlockedAchievements } = useMemo(() => {
    let total = 0;
    let unlocked = 0;
    for (const gameId of Object.keys(summaries)) {
      total += summaries[gameId].total;
      unlocked += summaries[gameId].unlocked;
    }
    return { totalAchievements: total, unlockedAchievements: unlocked };
  }, [summaries]);

  const completionPct =
    totalAchievements > 0 ? Math.round((unlockedAchievements / totalAchievements) * 100) : 0;

  const cutoff = rangeCutoffMs(range);

  const perfectGames = useMemo(() => {
    const list = computePerfectGames(summaries, games);
    if (cutoff === null) return list;
    return list.filter((game) => game.lastUnlockedTime >= cutoff);
  }, [summaries, games, cutoff]);

  const nearCompletionGames = useMemo(
    () => computeNearCompletionGames(summaries, games),
    [summaries, games]
  );

  const rarestAchievements = useMemo(() => {
    const list = computeRarestAchievements(rarestUnlocks, games);
    if (cutoff === null) return list;
    return list.filter((achievement) => (achievement.unlockTime ?? 0) >= cutoff);
  }, [rarestUnlocks, games, cutoff]);

  const recentAchievements = useMemo(() => {
    const list = collectUnlockedAchievements(recentUnlocks, games);
    if (cutoff === null) return list;
    return list.filter((achievement) => achievement.unlockTime >= cutoff);
  }, [recentUnlocks, games, cutoff]);

  const lifetimePlaytime = useMemo(
    () => allSessions.reduce((sum, session) => sum + session.durationMin, 0),
    [allSessions]
  );
  const lifetimeStreak = useMemo(() => computeStreaks(allSessions), [allSessions]);
  const milestones = useMemo(
    () =>
      computeMilestones(
        lifetimePlaytime,
        games.length,
        lifetimeStreak.longest,
        totalAchievementsUnlocked
      ),
    [lifetimePlaytime, games.length, lifetimeStreak.longest, totalAchievementsUnlocked]
  );
  const unlockedMilestones = milestones.filter((milestone) => milestone.unlocked).length;

  const openGame = useCallback(
    (gameId: string) => navigate(`/library/${gameId}`),
    [navigate]
  );
  const gameProps = (gameId: string) => ({
    role: "button" as const,
    tabIndex: 0,
    "data-game-detail-route": `/library/${gameId}`,
    onClick: () => openGame(gameId),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openGame(gameId);
      }
    },
  });

  if (hideAchievementProgress) {
    return (
      <div className="profile-empty profile-empty--page">
        <Trophy size={24} aria-hidden="true" />
        <p>{t("settingsPage.hideAchievementProgress")}</p>
      </div>
    );
  }

  return (
    <div className="profile-achievements">
      {/* Summary */}
      <Card variant="surface" elevation="1" className="profile-card profile-ach-hero">
        <div className="profile-ach-hero__top">
          <div className="profile-ach-hero__grid">
            <div className="profile-ach-hero__stat">
              <span className="profile-ach-hero__icon"><Trophy size={18} aria-hidden="true" /></span>
              <span className="profile-ach-hero__value">
                {unlockedAchievements.toLocaleString()} <small>/ {totalAchievements.toLocaleString()}</small>
              </span>
              <span className="profile-ach-hero__label">
                {t("community.achievements")} ({completionPct}%)
              </span>
            </div>

            <div className="profile-ach-hero__stat">
              <span className="profile-ach-hero__icon"><Crown size={18} aria-hidden="true" /></span>
              <span className="profile-ach-hero__value">{perfectGames.length}</span>
              <span className="profile-ach-hero__label">{t("stats.ach.perfectGamesCount")}</span>
            </div>

            <div className="profile-ach-hero__stat">
              <span className="profile-ach-hero__icon"><Target size={18} aria-hidden="true" /></span>
              <span className="profile-ach-hero__value">{nearCompletionGames.length}</span>
              <span className="profile-ach-hero__label">{t("stats.ach.nearCompletionCount")}</span>
            </div>

            <div className="profile-ach-hero__stat">
              <span className="profile-ach-hero__icon"><Flag size={18} aria-hidden="true" /></span>
              <span className="profile-ach-hero__value">
                {unlockedMilestones} <small>/ {milestones.length}</small>
              </span>
              <span className="profile-ach-hero__label">{t("stats.milestones.title")}</span>
            </div>
          </div>

          <button
            type="button"
            className="profile-link profile-ach-hero__open"
            onClick={() => navigate("/achievements")}
          >
            {t("profile.openAchievements")} <ArrowRight size={13} aria-hidden="true" />
          </button>
        </div>

        <div
          className="profile-meter profile-meter--lg"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completionPct}
        >
          <span style={{ width: `${completionPct}%` }} />
        </div>

        {range !== "all" && (
          <p className="profile-note profile-note--tight">{t("profile.achievementsRangeNote")}</p>
        )}
      </Card>

      {/* Perfect games */}
      <section className="profile-section" aria-label={t("stats.ach.wallOfFame")}>
        <div className="profile-section__head">
          <h2><Crown size={15} aria-hidden="true" /> {t("stats.ach.wallOfFame")}</h2>
          <span className="profile-section__badge">
            {perfectGames.length} {t("stats.ach.perfected")}
          </span>
        </div>

        {perfectGames.length > 0 ? (
          <div className="profile-game-grid">
            {perfectGames.map((game) => (
              <div key={game.gameId} className="profile-game-card is-perfect" {...gameProps(game.gameId)}>
                <span className="profile-game-card__cover">
                  {game.coverArtUrl ? (
                    <img src={game.coverArtUrl} alt="" loading="lazy" />
                  ) : (
                    <Gamepad2 size={18} aria-hidden="true" />
                  )}
                  <span className="profile-game-card__badge">100%</span>
                </span>
                <span className="profile-game-card__info">
                  <span className="profile-game-card__name" title={game.gameName}>{game.gameName}</span>
                  <span className="profile-game-card__meta">
                    {game.totalAchievements} {t("community.achievements")}
                    {game.lastUnlockedTime > 0 && (
                      <> · {new Date(game.lastUnlockedTime).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</>
                    )}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="profile-empty">
            <Crown size={20} aria-hidden="true" />
            <p>{t("stats.ach.noPerfectGamesYet")}</p>
          </div>
        )}
      </section>

      {/* Near completion */}
      {nearCompletionGames.length > 0 && (
        <section className="profile-section" aria-label={t("stats.ach.nearCompletionTitle")}>
          <div className="profile-section__head">
            <h2><Target size={15} aria-hidden="true" /> {t("stats.ach.nearCompletionTitle")}</h2>
          </div>
          <div className="profile-near-grid">
            {nearCompletionGames.map((game) => (
              <div key={game.gameId} className="profile-near" {...gameProps(game.gameId)}>
                <span className="profile-near__cover">
                  {game.coverArtUrl ? (
                    <img src={game.coverArtUrl} alt="" loading="lazy" />
                  ) : (
                    <Gamepad2 size={16} aria-hidden="true" />
                  )}
                </span>
                <span className="profile-near__info">
                  <span className="profile-near__row">
                    <span className="profile-near__name" title={game.gameName}>{game.gameName}</span>
                    <span className="profile-near__pct">{game.percentage}%</span>
                  </span>
                  <span className="profile-meter" aria-hidden="true">
                    <span style={{ width: `${game.percentage}%` }} />
                  </span>
                  <span className="profile-near__meta">
                    {t("stats.ach.remainingToComplete", { count: game.remaining })} ({game.unlocked}/{game.total})
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Rarest */}
      {rarestAchievements.length > 0 && (
        <section className="profile-section" aria-label={t("stats.ach.rarestUnlocksTitle")}>
          <div className="profile-section__head">
            <h2><Gem size={15} aria-hidden="true" /> {t("stats.ach.rarestUnlocksTitle")}</h2>
          </div>
          <div className="profile-rarest-grid">
            {rarestAchievements.map((achievement) => {
              const tier =
                achievement.rarityPct < 5
                  ? "diamond"
                  : achievement.rarityPct < 15
                    ? "gold"
                    : achievement.rarityPct < 30
                      ? "silver"
                      : "bronze";
              return (
                <div key={`${achievement.gameName}-${achievement.achievementId}`} className={`profile-rarest tier-${tier}`}>
                  <span className="profile-rarest__icon">
                    {achievement.iconUrl ? (
                      <img src={achievement.iconUrl} alt="" loading="lazy" />
                    ) : (
                      <Medal size={17} aria-hidden="true" />
                    )}
                  </span>
                  <span className="profile-rarest__body">
                    <span className="profile-rarest__row">
                      <span className="profile-rarest__name" title={achievement.displayName}>
                        {achievement.displayName}
                      </span>
                      <span className={`profile-rarest__pill tier-${tier}`}>{achievement.rarityPct}%</span>
                    </span>
                    <span className="profile-rarest__game">{achievement.gameName}</span>
                    <span className="profile-rarest__desc">{achievement.description}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Recent */}
      {recentAchievements.length > 0 && (
        <section className="profile-section" aria-label={t("communityExtras.recentlyUnlocked")}>
          <div className="profile-section__head">
            <h2><Medal size={15} aria-hidden="true" /> {t("communityExtras.recentlyUnlocked")}</h2>
            <button type="button" className="profile-link" onClick={() => navigate("/achievements")}>
              {t("profile.openAchievements")} <ArrowRight size={13} aria-hidden="true" />
            </button>
          </div>
          <div className="profile-recent-rail">
            {recentAchievements.map((achievement, index) => (
              <div key={`${achievement.gameName}-${achievement.name}-${index}`} className="profile-recent-card">
                <span className="profile-recent-card__cover">
                  {achievement.coverArtUrl ? (
                    <img src={achievement.coverArtUrl} alt="" loading="lazy" />
                  ) : (
                    <Gamepad2 size={16} aria-hidden="true" />
                  )}
                </span>
                <span className="profile-recent-card__body">
                  <span className="profile-recent-card__game">{achievement.gameName}</span>
                  <span className="profile-recent-card__title" title={achievement.name}>{achievement.name}</span>
                  <span className="profile-recent-card__date">
                    {new Date(achievement.unlockTime).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Milestones */}
      <section className="profile-section" aria-label={t("stats.milestones.title")}>
        <div className="profile-section__head">
          <h2><Flag size={15} aria-hidden="true" /> {t("stats.milestones.title")}</h2>
          <span className="profile-section__badge">
            {unlockedMilestones} / {milestones.length} {t("stats.milestones.unlocked")}
          </span>
        </div>

        <div className="profile-milestones">
          {milestones.map((milestone) => {
            const pct = Math.min(
              100,
              Math.round((milestone.currentValue / milestone.targetValue) * 100)
            );
            return (
              <div
                key={milestone.id}
                className={`profile-milestone${milestone.unlocked ? " is-unlocked" : ""}`}
              >
                <div className="profile-milestone__head">
                  <span className="profile-milestone__icon">
                    <MilestoneIcon category={milestone.category} size={17} />
                  </span>
                  {milestone.unlocked && <span className="profile-milestone__stamp">{t("profile.unlocked")}</span>}
                </div>
                <span className="profile-milestone__title">{t(milestone.titleKey)}</span>
                <p className="profile-milestone__desc">
                  {t(milestone.descKey, { target: milestone.targetValue })}
                </p>
                <div className="profile-meter" aria-hidden="true">
                  <span style={{ width: `${pct}%` }} />
                </div>
                <div className="profile-milestone__footer">
                  <span>{milestone.currentValue.toLocaleString()} / {milestone.targetValue.toLocaleString()}</span>
                  <span>{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
