// Extra Community > Profile components: activity heatmap + streak,
// time-of-day donut, monthly goal ring, period-compare deltas, and a
// recently-unlocked achievements showcase. Each is a self-contained
// presentational component fed by data computed in communityProfileStats.

import { useMemo, useState } from "react";
import { useLanguage } from "../context/LanguageContext";
import DonutChart from "../components/charts/DonutChart";
import { Card } from "../components/ui";
import type {
  DayCell,
  StreakInfo,
  TimeOfDaySlice,
  PeriodCompare,
} from "./communityProfileStats";
import { computeGoalPace } from "./communityProfileStats";
import type { GameAchievementData } from "../types/game";

function formatHours(totalMinutes: number): string {
  if (!totalMinutes || totalMinutes <= 0) return "0m";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h >= 1000) return `${(h / 1000).toFixed(1)}k h`;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── Heatmap intensity bucket (0 = none, 4 = max) ──────────────────────
function heatLevel(minutes: number, max: number): number {
  if (minutes <= 0) return 0;
  if (max <= 0) return 1;
  const ratio = minutes / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

const WEEKDAY_LABELS = ["Mon", "Wed", "Fri"];

export function ActivityHeatmap({
  cells,
  maxMinutes,
  activeDays,
  totalMinutes,
  bestDay,
}: {
  cells: DayCell[];
  maxMinutes: number;
  activeDays: number;
  totalMinutes: number;
  bestDay: DayCell | null;
}) {
  const { t } = useLanguage();
  // Group cells into 7 columns (Mon–Sun) × up to 7 rows.
  const weeks = useMemo(() => {
    const cols: DayCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      cols.push(cells.slice(i, i + 7));
    }
    return cols;
  }, [cells]);

  return (
    <Card variant="surface" elevation="1" className="community-chart-card community-heatmap-card">
      <div className="community-chart-header">
        <h3>{t("communityExtras.activityHeatmap")}</h3>
        <span className="community-chart-subtitle">
          {t("communityExtras.heatmapSubtitle", { count: activeDays })}
        </span>
      </div>
      <div className="community-heatmap">
        <div className="community-heatmap-weekdays">
          {WEEKDAY_LABELS.map((l) => (
            <span key={l} className="community-heatmap-weekday">
              {t(`communityExtras.weekday.${l.toLowerCase()}`)}
            </span>
          ))}
        </div>
        <div className="community-heatmap-grid">
          {weeks.map((week, wi) => (
            <div key={wi} className="community-heatmap-week">
              {week.map((cell) => {
                const level = heatLevel(cell.minutes, maxMinutes);
                const future = cell.date > new Date();
                return (
                  <div
                    key={cell.key}
                    className={`community-heatmap-cell level-${level}${future ? " is-future" : ""}`}
                    title={
                      future
                        ? ""
                        : `${cell.date.toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}: ${cell.minutes > 0 ? formatHours(cell.minutes) : t("communityExtras.noPlay")}`
                    }
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="community-heatmap-legend">
        <span>{t("activityDash.less")}</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`community-heatmap-cell level-${l}`} />
        ))}
        <span>{t("activityDash.more")}</span>
      </div>
      <div className="community-heatmap-footer">
        <div className="community-heatmap-stat">
          <span className="community-heatmap-stat-value">
            {bestDay
              ? `${bestDay.date.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })} · ${formatHours(bestDay.minutes)}`
              : "—"}
          </span>
          <span className="community-heatmap-stat-label">{t("communityExtras.bestDay")}</span>
        </div>
        <div className="community-heatmap-stat">
          <span className="community-heatmap-stat-value">{activeDays}</span>
          <span className="community-heatmap-stat-label">{t("communityExtras.activeDays")}</span>
        </div>
        <div className="community-heatmap-stat">
          <span className="community-heatmap-stat-value">{formatHours(totalMinutes)}</span>
          <span className="community-heatmap-stat-label">{t("communityExtras.heatmapTotal")}</span>
        </div>
      </div>
    </Card>
  );
}

// ── Weekday split (Mon–Sun horizontal bars) ──────────────────────────

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function WeekdaySplitCard({
  minutes,
  maxMinutes,
  favoriteIndex,
}: {
  minutes: number[];
  maxMinutes: number;
  favoriteIndex: number;
}) {
  const { t } = useLanguage();
  const total = minutes.reduce((s, m) => s + m, 0);

  return (
    <Card variant="surface" elevation="1" className="community-chart-card community-weekday-card">
      <div className="community-chart-header">
        <h3>{t("communityExtras.weekdaySplit")}</h3>
        <span className="community-chart-subtitle">{t("communityExtras.byTotalPlaytime")}</span>
      </div>
      {total > 0 ? (
        <div className="community-weekday-list">
          {minutes.map((m, i) => {
            const isFav = i === favoriteIndex;
            const pct = maxMinutes > 0 ? Math.round((m / maxMinutes) * 100) : 0;
            return (
              <div
                key={WEEKDAY_KEYS[i]}
                className={`community-weekday-row${isFav ? " is-favorite" : ""}`}
              >
                <span className="community-weekday-label">
                  {t(`communityExtras.weekday.${WEEKDAY_KEYS[i]}`)}
                </span>
                <div className="community-weekday-track" aria-hidden>
                  <div className="community-weekday-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="community-weekday-value">{formatHours(m)}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="community-empty-chart">
          <p>{t("communityExtras.weekdayEmpty")}</p>
        </div>
      )}
    </Card>
  );
}

export function StreakCard({ streak }: { streak: StreakInfo }) {
  const { t } = useLanguage();
  const flame = streak.current > 0 ? "🔥" : "❄️";
  return (
    <Card variant="surface" elevation="1" className="community-streak-card">
      <div className="community-streak-flame">{flame}</div>
      <div className="community-streak-body">
        <span className="community-streak-current">{streak.current}</span>
        <span className="community-streak-label">{t("communityExtras.dayStreak")}</span>
      </div>
      <div className="community-streak-meta">
        <span>{t("communityExtras.longest", { days: streak.longest })}</span>
        <span>{streak.playedToday ? t("communityExtras.playedToday") : t("communityExtras.noPlayToday")}</span>
      </div>
    </Card>
  );
}

export function TimeOfDayCard({ slices }: { slices: TimeOfDaySlice[] }) {
  const { t } = useLanguage();
  const filtered = slices.filter((s) => s.minutes > 0);
  return (
    <Card variant="surface" elevation="1" className="community-chart-card">
      <div className="community-chart-header">
        <h3>{t("communityExtras.timeOfDay")}</h3>
        <span className="community-chart-subtitle">{t("communityExtras.byTotalPlaytime")}</span>
      </div>
      {filtered.length > 0 ? (
        <DonutChart
          slices={filtered.map((s) => ({
            label: s.label,
            value: s.minutes,
            color: s.color,
          }))}
          size={200}
          innerRadius={55}
          formatValue={(v) => formatHours(v)}
        />
      ) : (
        <div className="community-empty-chart">
          <p>{t("communityExtras.playGamesSplit")}</p>
        </div>
      )}
    </Card>
  );
}

export function GoalCard({
  currentMin,
  goalMin,
  onChangeGoal,
}: {
  currentMin: number;
  goalMin: number;
  onChangeGoal: (min: number) => void;
}) {
  const { t } = useLanguage();
  const pct = goalMin > 0 ? Math.min(100, Math.round((currentMin / goalMin) * 100)) : 0;
  const ringRadius = 52;
  const circumference = 2 * Math.PI * ringRadius;
  const offset = circumference - (pct / 100) * circumference;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(goalMin / 60 || 0));
  const pace = useMemo(() => computeGoalPace(currentMin, goalMin), [currentMin, goalMin]);

  return (
    <Card variant="surface" elevation="1" className="community-goal-card">
      <div className="community-chart-header">
        <h3>{t("communityExtras.monthlyGoal")}</h3>
        <button
          type="button"
          className="community-goal-edit"
          onClick={() => {
            setDraft(String(goalMin / 60 || 0));
            setEditing((e) => !e);
          }}
        >
          {editing ? t("editImage.done") : t("communityExtras.setGoal")}
        </button>
      </div>
      {editing ? (
        <div className="community-goal-edit-row">
          <input
            type="number"
            min={0}
            className="community-goal-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={t("communityExtras.goalInHours")}
          />
          <span className="community-goal-unit">{t("communityExtras.hoursUnit")}</span>
          <button
            type="button"
            className="community-goal-save"
            onClick={() => {
              const hours = Math.max(0, Number(draft) || 0);
              onChangeGoal(hours * 60);
              setEditing(false);
            }}
            >
              {t("common.save")}
            </button>
        </div>
      ) : (
        <div className="community-goal-ring-wrap">
          <svg width="130" height="130" viewBox="0 0 130 130" className="community-goal-ring">
            <circle
              cx="65"
              cy="65"
              r={ringRadius}
              fill="none"
              stroke="var(--color-bg-tertiary)"
              strokeWidth="12"
            />
            <circle
              cx="65"
              cy="65"
              r={ringRadius}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth="12"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              transform="rotate(-90 65 65)"
              style={{ transition: "stroke-dashoffset 400ms ease" }}
            />
            <text x="65" y="60" textAnchor="middle" className="community-goal-pct">
              {pct}%
            </text>
            <text x="65" y="80" textAnchor="middle" className="community-goal-sub">
              {formatHours(currentMin)}
            </text>
          </svg>
          <span className="community-goal-target">
            {goalMin > 0 ? t("communityExtras.ofGoal", { time: formatHours(goalMin) }) : t("communityExtras.noGoalSet")}
          </span>
          {pace && (
            <span
              className={`community-goal-pace ${pace.diffMin > 0 ? "ahead" : pace.diffMin < 0 ? "behind" : "on"}`}
            >
              {pace.diffMin > 0
                ? t("communityExtras.goalAhead", { time: formatHours(pace.diffMin) })
                : pace.diffMin < 0
                ? t("communityExtras.goalBehind", { time: formatHours(-pace.diffMin) })
                : t("communityExtras.goalOnPace")}
            </span>
          )}
        </div>
      )}
    </Card>
  );
}

export function PeriodCompareBadge({ compare }: { compare: PeriodCompare }) {
  const { t } = useLanguage();
  const up = compare.deltaMin >= 0;
  const label =
    compare.pct === null
      ? "—"
      : `${up ? "+" : ""}${compare.pct}%`;
  return (
    <span
      className={`community-compare-badge ${up ? "up" : "down"}`}
      title={t("communityExtras.compareTitle", {
        this: formatHours(compare.thisMonthMin),
        last: formatHours(compare.lastMonthMin),
      })}
    >
      {up ? "▲" : "▼"} {label}
    </span>
  );
}

interface UnlockedAchievement {
  gameName: string;
  name: string;
  description: string;
  unlockTime: number;
  coverArtUrl?: string;
}

export function AchievementsShowcase({
  items,
}: {
  items: UnlockedAchievement[];
}) {
  const { t } = useLanguage();
  if (items.length === 0) {
    return (
      <Card variant="surface" elevation="1" className="community-year-card community-breakdown-card">
        <div className="community-year-header">
          <span className="community-year-icon">🏅</span>
          <span>{t("communityExtras.recentlyUnlocked")}</span>
        </div>
        <div className="community-empty-chart">
          <p>{t("communityExtras.unlockToSee")}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card
      variant="surface"
      elevation="1"
      className="community-year-card community-breakdown-card"
      header={
        <h3 className="community-year-header">
          <span className="community-year-icon">🏅</span>
          <span>{t("communityExtras.recentlyUnlocked")}</span>
        </h3>
      }
    >
      <div className="community-unlocked-rail">
        {items.map((a, i) => (
          <div key={`${a.gameName}-${a.name}-${i}`} className="community-unlocked-card">
            <div className="community-unlocked-cover">
              {a.coverArtUrl ? (
                <img src={a.coverArtUrl} alt="" loading="lazy" />
              ) : (
                <div className="community-unlocked-cover-fallback">🎮</div>
              )}
            </div>
            <span className="community-unlocked-game">{a.gameName}</span>
            <span className="community-unlocked-name" title={a.name}>
              {a.name}
            </span>
            <span className="community-unlocked-time">
              {new Date(a.unlockTime).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Re-export for the page so it can build the showcase items.
export function collectUnlockedAchievements(
  cache: Record<string, GameAchievementData>,
  games: { id: string; name: string; coverArtUrl?: string }[]
): UnlockedAchievement[] {
  const byId = new Map(games.map((g) => [g.id, g]));
  const out: UnlockedAchievement[] = [];
  for (const gid of Object.keys(cache)) {
    const data = cache[gid];
    const lib = byId.get(gid);
    for (const ach of data.achievements) {
      if (ach.unlockTime && ach.unlockTime > 0) {
        out.push({
          gameName: lib?.name ?? String(data.steamAppId),
          name: ach.displayName,
          description: ach.description,
          unlockTime: ach.unlockTime,
          coverArtUrl: lib?.coverArtUrl,
        });
      }
    }
  }
  out.sort((a, b) => b.unlockTime - a.unlockTime);
  return out.slice(0, 12);
}
