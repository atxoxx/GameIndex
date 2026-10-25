import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Clock,
  Flame,
  Gamepad2,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
} from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import {
  computeGoalPace,
  computeMilestones,
  computeMonthToDate,
  computeMonthlyTrend,
  computePeriodCompare,
  computeStreaks,
  collectUnlockedAchievements,
  formatHours,
} from "../statsCalculations";
import { saveMonthlyGoal, loadMonthlyGoal } from "../statsStorage";
import { MilestoneIcon } from "../statsIcons";
import { CapturePreviewStrip } from "../gallery/CapturePreviewStrip";
import type {
  Game,
  GameSession,
  StatsSubtab,
  TimeframePreset,
} from "../statsTypes";
import type { AchievementUnlockRecord } from "../../../types/game";

interface OverviewTabProps {
  sessions: GameSession[];
  allSessions: GameSession[];
  games: Game[];
  recentUnlocks: AchievementUnlockRecord[];
  range: TimeframePreset;
  totalAchievementsUnlocked: number;
  hideAchievementProgress: boolean;
  showSecondaryTabs: boolean;
  onOpenTab: (tab: StatsSubtab) => void;
}

interface RankedGame {
  gameId: string;
  name: string;
  coverArtUrl?: string;
  platform?: string;
  lastPlayed?: number;
  minutes: number;
  sessions: number;
  pct: number;
}

const GOAL_RING_RADIUS = 26;
const GOAL_RING_CIRCUMFERENCE = 2 * Math.PI * GOAL_RING_RADIUS;

function sparklinePath(values: number[], width = 120, height = 26): string {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  return values
    .map((value, index) => {
      const x = index * step;
      const y = height - (value / max) * (height - 4) - 2;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/**
 * Overview — the digest, not the dashboard.
 *
 * Four highlights answer "how am I doing", the ranked list answers "what am
 * I playing" and the side rail answers "what happened lately". Anything
 * that needs a chart lives on Insights.
 */
export function OverviewTab({
  sessions,
  allSessions,
  games,
  recentUnlocks,
  range,
  totalAchievementsUnlocked,
  hideAchievementProgress,
  showSecondaryTabs,
  onOpenTab,
}: OverviewTabProps) {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const monthToDate = useMemo(() => computeMonthToDate(allSessions), [allSessions]);
  const periodCompare = useMemo(() => computePeriodCompare(allSessions), [allSessions]);
  const monthlyTrend = useMemo(() => computeMonthlyTrend(allSessions, 6), [allSessions]);

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
  const nextMilestone = useMemo(
    () => milestones.find((milestone) => !milestone.unlocked) ?? null,
    [milestones]
  );

  // Monthly goal — persisted locally, independent of the range.
  const [goalMin, setGoalMin] = useState<number>(() => loadMonthlyGoal());
  const [editingGoal, setEditingGoal] = useState(false);
  const [draftGoalHours, setDraftGoalHours] = useState(() => String(loadMonthlyGoal() / 60 || 0));

  const goalPct = goalMin > 0 ? Math.min(100, Math.round((monthToDate / goalMin) * 100)) : 0;
  const goalPace = useMemo(() => computeGoalPace(monthToDate, goalMin), [monthToDate, goalMin]);

  const handleSaveGoal = useCallback(() => {
    const hours = Math.max(0, Number(draftGoalHours) || 0);
    const minutes = Math.round(hours * 60);
    setGoalMin(minutes);
    saveMonthlyGoal(minutes);
    setEditingGoal(false);
  }, [draftGoalHours]);

  const rankedGames = useMemo<RankedGame[]>(() => {
    const gameById = new Map(games.map((game) => [game.id, game]));
    const byGame = new Map<string, { minutes: number; sessions: number; name: string }>();

    for (const session of sessions) {
      const entry = byGame.get(session.gameId) ?? {
        minutes: 0,
        sessions: 0,
        name: session.gameName,
      };
      entry.minutes += session.durationMin;
      entry.sessions += 1;
      byGame.set(session.gameId, entry);
    }

    const list = Array.from(byGame.entries()).map(([gameId, entry]) => {
      const libraryGame = gameById.get(gameId);
      return {
        gameId,
        name: libraryGame?.name ?? entry.name,
        coverArtUrl: libraryGame?.coverArtUrl,
        platform: libraryGame?.platform,
        lastPlayed: libraryGame?.lastPlayed,
        minutes: entry.minutes,
        sessions: entry.sessions,
        pct: 0,
      };
    });

    list.sort((a, b) => b.minutes - a.minutes);
    const maxMinutes = list[0]?.minutes || 1;
    return list.map((game) => ({
      ...game,
      pct: Math.round((game.minutes / maxMinutes) * 100),
    }));
  }, [sessions, games]);

  const topGame = rankedGames[0] ?? null;
  const recentAchievements = useMemo(
    () => collectUnlockedAchievements(recentUnlocks, games).slice(0, 5),
    [recentUnlocks, games]
  );

  const monthDelta = periodCompare.deltaMin;
  const hasMonthlyPlaytime = monthlyTrend.some((month) => month.minutes > 0);
  const sparkPoints = useMemo(
    () => sparklinePath(monthlyTrend.map((month) => month.minutes)),
    [monthlyTrend]
  );

  const openGame = useCallback(
    (gameId: string) => navigate(`/library/${gameId}`),
    [navigate]
  );

  const openLibraryGame = (gameId: string) => ({
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

  return (
    <div className="profile-overview">
      <section className="profile-section" aria-label={t("profile.highlights")}>
        <div className="profile-section__head">
          <h2>{t("profile.highlights")}</h2>
          <span className="profile-section__meta">{t("profile.highlightsMeta")}</span>
        </div>

        <div className="profile-highlights">
          {/* Monthly goal */}
          <div className="profile-card profile-goal">
            <div className="profile-goal__ring">
              <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
                <circle cx="32" cy="32" r={GOAL_RING_RADIUS} fill="none" stroke="var(--color-border)" strokeWidth="5" />
                <circle
                  cx="32"
                  cy="32"
                  r={GOAL_RING_RADIUS}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray={GOAL_RING_CIRCUMFERENCE}
                  strokeDashoffset={GOAL_RING_CIRCUMFERENCE * (1 - goalPct / 100)}
                  transform="rotate(-90 32 32)"
                />
                <text x="32" y="36" textAnchor="middle" className="profile-goal__pct">
                  {goalPct}%
                </text>
              </svg>
            </div>
            <div className="profile-goal__body">
              <span className="profile-card__label">{t("communityExtras.monthlyGoal")}</span>
              {editingGoal ? (
                <div className="profile-goal__edit">
                  <input
                    type="number"
                    min={0}
                    value={draftGoalHours}
                    aria-label={t("communityExtras.goalInHours")}
                    onChange={(event) => setDraftGoalHours(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleSaveGoal();
                      if (event.key === "Escape") setEditingGoal(false);
                    }}
                    autoFocus
                  />
                  <span>{t("communityExtras.hoursUnit")}</span>
                  <button type="button" className="profile-link" onClick={handleSaveGoal}>
                    {t("common.save")}
                  </button>
                </div>
              ) : (
                <>
                  <span className="profile-card__value">
                    {formatHours(monthToDate)}
                    {goalMin > 0 && <small> / {formatHours(goalMin)}</small>}
                  </span>
                  <span className="profile-card__sub">
                    {goalPace
                      ? goalPace.diffMin > 0
                        ? t("communityExtras.goalAhead", { time: formatHours(goalPace.diffMin) })
                        : goalPace.diffMin < 0
                          ? t("communityExtras.goalBehind", { time: formatHours(-goalPace.diffMin) })
                          : t("communityExtras.goalOnPace")
                      : t("communityExtras.noGoalSet")}
                  </span>
                </>
              )}
            </div>
            {!editingGoal && (
              <button
                type="button"
                className="profile-card__action"
                onClick={() => {
                  setDraftGoalHours(String(goalMin / 60 || 0));
                  setEditingGoal(true);
                }}
              >
                {t("communityExtras.setGoal")}
              </button>
            )}
          </div>

          {/* Month vs last month */}
          <div className="profile-card">
            <span className="profile-card__label">{t("profile.thisMonth")}</span>
            <span className="profile-card__value">
              {formatHours(monthToDate)}
              {periodCompare.pct !== null && (
                <span className={`profile-delta${monthDelta >= 0 ? " is-up" : " is-down"}`}>
                  {monthDelta >= 0 ? <TrendingUp size={12} aria-hidden="true" /> : <TrendingDown size={12} aria-hidden="true" />}
                  {periodCompare.pct > 0 ? "+" : ""}
                  {periodCompare.pct}%
                </span>
              )}
            </span>
            <svg className="profile-spark" viewBox="0 0 120 26" preserveAspectRatio="none" aria-hidden="true">
              {hasMonthlyPlaytime && (
                <path d={sparkPoints} fill="none" stroke="var(--color-info)" strokeWidth="1.6" />
              )}
            </svg>
            <span className="profile-card__sub">
              {t("communityExtras.compareTitle", {
                this: formatHours(periodCompare.thisMonthMin),
                last: formatHours(periodCompare.lastMonthMin),
              })}
            </span>
          </div>

          {/* Most played */}
          <div className="profile-card profile-top-game">
            <span className="profile-card__label">{t("profile.mostPlayed")}</span>
            {topGame ? (
              <div className="profile-top-game__body" {...openLibraryGame(topGame.gameId)}>
                <div className="profile-top-game__cover">
                  {topGame.coverArtUrl ? (
                    <img src={topGame.coverArtUrl} alt="" loading="lazy" />
                  ) : (
                    <Gamepad2 size={18} aria-hidden="true" />
                  )}
                </div>
                <div className="profile-top-game__meta">
                  <span className="profile-card__value profile-card__value--sm" title={topGame.name}>
                    {topGame.name}
                  </span>
                  <span className="profile-card__sub">
                    {formatHours(topGame.minutes)} · {t("gameActivity.sessionCount", {
                      count: topGame.sessions,
                      s: topGame.sessions !== 1 ? "s" : "",
                    })}
                  </span>
                </div>
              </div>
            ) : (
              <span className="profile-card__sub">{t("profile.noSessionsInRange")}</span>
            )}
          </div>

          {/* Next milestone */}
          <div className="profile-card">
            <span className="profile-card__label">{t("profile.nextMilestone")}</span>
            {nextMilestone ? (
              <>
                <span className="profile-milestone-card__title">
                  <span className="profile-milestone-card__icon">
                    <MilestoneIcon category={nextMilestone.category} size={15} />
                  </span>
                  {t(nextMilestone.titleKey)}
                </span>
                <div className="profile-meter" aria-hidden="true">
                  <span
                    style={{
                      width: `${Math.min(100, Math.round((nextMilestone.currentValue / nextMilestone.targetValue) * 100))}%`,
                    }}
                  />
                </div>
                <span className="profile-card__sub">
                  {nextMilestone.currentValue.toLocaleString()} / {nextMilestone.targetValue.toLocaleString()}
                </span>
                <button
                  type="button"
                  className="profile-link profile-card__link-row"
                  onClick={() => onOpenTab("achievements")}
                >
                  {t("profile.openAchievements")} <ArrowRight size={12} aria-hidden="true" />
                </button>
              </>
            ) : (
              <span className="profile-card__sub">{t("profile.allMilestonesDone")}</span>
            )}
          </div>
        </div>
      </section>

      <div className="profile-overview__columns">
        <section className="profile-section" aria-label={t("profile.mostPlayed")}>
          <div className="profile-section__head">
            <h2>{t("profile.mostPlayed")}</h2>
            <button type="button" className="profile-link" onClick={() => navigate("/activity")}>
              {t("profile.viewAllActivity")} <ArrowRight size={13} aria-hidden="true" />
            </button>
          </div>

          {rankedGames.length > 0 ? (
            <div className="profile-card profile-ranked">
              <ol className="profile-ranked__list">
                {rankedGames.slice(0, 6).map((game, index) => (
                  <li key={game.gameId} className="profile-ranked__row" {...openLibraryGame(game.gameId)}>
                    <span className="profile-ranked__pos">{index + 1}</span>
                    <span className="profile-ranked__cover">
                      {game.coverArtUrl ? (
                        <img src={game.coverArtUrl} alt="" loading="lazy" />
                      ) : (
                        <Gamepad2 size={16} aria-hidden="true" />
                      )}
                    </span>
                    <span className="profile-ranked__info">
                      <span className="profile-ranked__title" title={game.name}>
                        {game.name}
                      </span>
                      <span className="profile-ranked__track" aria-hidden="true">
                        <span style={{ width: `${game.pct}%` }} />
                      </span>
                      <span className="profile-ranked__meta">
                        {t("gameActivity.sessionCount", {
                          count: game.sessions,
                          s: game.sessions !== 1 ? "s" : "",
                        })}
                        {game.platform && <span>· {game.platform}</span>}
                      </span>
                    </span>
                    <span className="profile-ranked__hours">
                      <Clock size={12} aria-hidden="true" /> {formatHours(game.minutes)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : (
            <div className="profile-card profile-empty">
              <Gamepad2 size={22} aria-hidden="true" />
              <p>{t("profile.noSessionsInRange")}</p>
              {showSecondaryTabs && (
                <button type="button" className="profile-link" onClick={() => onOpenTab("insights")}>
                  {t("profile.tab.insights")} <ArrowRight size={13} aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </section>

        <div className="profile-overview__rail">
          {!hideAchievementProgress && (
            <section className="profile-card profile-recent" aria-label={t("profile.recent")}>
              <div className="profile-card__head">
                <h3>
                  <Trophy size={15} aria-hidden="true" /> {t("profile.recent")}
                </h3>
                <button type="button" className="profile-link" onClick={() => onOpenTab("achievements")}>
                  {t("profile.openAchievements")} <ArrowRight size={13} aria-hidden="true" />
                </button>
              </div>

              {recentAchievements.length > 0 ? (
                <ul className="profile-feed">
                  {recentAchievements.map((achievement, index) => (
                    <li key={`${achievement.gameName}-${achievement.name}-${index}`} className="profile-feed__item">
                      <span className="profile-feed__icon is-gold">
                        <Trophy size={13} aria-hidden="true" />
                      </span>
                      <span className="profile-feed__body">
                        <span className="profile-feed__title" title={achievement.name}>
                          {achievement.name}
                        </span>
                        <span className="profile-feed__meta">
                          {achievement.gameName}
                          {achievement.unlockTime > 0 && (
                            <> · {new Date(achievement.unlockTime).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</>
                          )}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="profile-card__sub">{t("profile.noRecentUnlocks")}</p>
              )}
            </section>
          )}

          {showSecondaryTabs && (
            <CapturePreviewStrip onOpenGallery={() => onOpenTab("gallery")} />
          )}

          <section className="profile-card profile-streak-card" aria-label={t("communityExtras.dayStreak")}>
            <span className="profile-card__label">
              <Flame size={13} aria-hidden="true" /> {t("communityExtras.dayStreak")}
            </span>
            <span className="profile-card__value">
              {lifetimeStreak.current}
              <small> / {t("communityExtras.longest", { days: lifetimeStreak.longest })}</small>
            </span>
            <span className="profile-card__sub">
              {lifetimeStreak.playedToday ? t("profile.playedToday") : t("profile.playToday")}
            </span>
          </section>

          {showSecondaryTabs && (
            <section className="profile-card profile-explore" aria-label={t("profile.tab.insights")}>
              <span className="profile-card__label">
                <Sparkles size={13} aria-hidden="true" /> {t("profile.tab.insights")}
              </span>
              <p className="profile-card__sub">{t("profile.insightsTeaser")}</p>
              <button type="button" className="profile-link" onClick={() => onOpenTab("insights")}>
                {t("profile.openInsights")} <ArrowRight size={13} aria-hidden="true" />
              </button>
            </section>
          )}
        </div>
      </div>

      <p className="profile-overview__hint">
        <Target size={13} aria-hidden="true" />
        {range === "all" ? t("profile.rangeAllTimeHint") : t("profile.rangeHint")}
      </p>
    </div>
  );
}
