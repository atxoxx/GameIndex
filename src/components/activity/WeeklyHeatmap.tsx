import { useMemo } from "react";
import { useLanguage } from "../../context/LanguageContext";
import type { GameSession } from "../../types/game";
import { formatPlayTime } from "../../types/game";

export interface WeeklyHeatmapProps {
  sessions: GameSession[];
  timeframeDays?: number;
  onSelectDate?: (date: string) => void;
  selectedDate?: string | null;
}

export function WeeklyHeatmap({
  sessions,
  timeframeDays = 365,
  onSelectDate,
  selectedDate,
}: WeeklyHeatmapProps) {
  const { t, language } = useLanguage();

  const { cells, activeDaysCount, totalMinutes } = useMemo(() => {
    const dayMap = new Map<string, number>();
    const dayGames = new Map<string, Set<string>>();
    const daySessCount = new Map<string, number>();
    let totalMins = 0;

    for (const s of sessions) {
      const key = s.date.slice(0, 10);
      dayMap.set(key, (dayMap.get(key) || 0) + s.durationMin);
      daySessCount.set(key, (daySessCount.get(key) || 0) + 1);
      totalMins += s.durationMin;

      if (!dayGames.has(key)) dayGames.set(key, new Set());
      if (s.gameName) dayGames.get(key)!.add(s.gameName);
    }

    const list: { date: string; minutes: number; games: string[]; sessionsCount: number }[] = [];
    const start = new Date();
    start.setDate(start.getDate() - timeframeDays + 1);

    let activeDays = 0;
    for (let i = 0; i < timeframeDays; i++) {
      const date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
      const minutes = dayMap.get(date) || 0;
      const games = Array.from(dayGames.get(date) || []);
      const sessCount = daySessCount.get(date) || 0;
      if (minutes > 0) activeDays++;
      list.push({ date, minutes, games, sessionsCount: sessCount });
      start.setDate(start.getDate() + 1);
    }

    return {
      cells: list,
      activeDaysCount: activeDays,
      totalMinutes: totalMins,
      dayGamesMap: dayGames,
      daySessionsCountMap: daySessCount,
    };
  }, [sessions, timeframeDays]);

  const padded = useMemo<({ date: string; minutes: number; games: string[]; sessionsCount: number } | null)[]>(() => {
    if (cells.length === 0) return [];
    const leading = new Date(cells[0].date + "T00:00:00").getDay();
    const pad: ({ date: string; minutes: number; games: string[]; sessionsCount: number } | null)[] = Array.from(
      { length: leading },
      () => null,
    );
    return pad.concat(cells);
  }, [cells]);

  const monthLabels = useMemo(() => {
    const list: { col: number; label: string }[] = [];
    if (cells.length === 0) return list;
    const leading = new Date(cells[0].date + "T00:00:00").getDay();
    let prevMonth = "";
    cells.forEach((c, i) => {
      const month = c.date.slice(0, 7);
      if (month !== prevMonth) {
        list.push({
          col: Math.floor((leading + i) / 7),
          label: new Date(c.date + "T00:00:00").toLocaleDateString(language, { month: "short" }),
        });
        prevMonth = month;
      }
    });
    return list;
  }, [cells, language]);

  const intensity = (minutes: number) => {
    if (minutes <= 0) return "act-heatmap__cell--empty";
    if (minutes < 15) return "act-heatmap__cell--low";
    if (minutes < 45) return "act-heatmap__cell--medium";
    if (minutes < 120) return "act-heatmap__cell--high";
    return "act-heatmap__cell--peak";
  };

  const dayLabels = [
    t("activityDash.sun"),
    t("activityDash.mon"),
    t("activityDash.tue"),
    t("activityDash.wed"),
    t("activityDash.thu"),
    t("activityDash.fri"),
    t("activityDash.sat"),
  ];

  return (
    <div className="act-heatmap">
      <div className="act-heatmap__header">
        <div className="act-heatmap__summary">
          <span className="act-heatmap__stat-badge">
            <strong>{activeDaysCount}</strong> {t("activity.activeDays")}
          </span>
          <span className="act-heatmap__stat-badge">
            <strong>{formatPlayTime(totalMinutes)}</strong> {t("activity.totalPlaytime")}
          </span>
        </div>
      </div>

      <div className="act-heatmap__scroll">
        <div className="act-heatmap__body">
          <div className="act-heatmap__labels">
            {dayLabels.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="act-heatmap__cols">
            <div className="act-heatmap__months" aria-hidden="true">
              {monthLabels.map((m) => (
                <span key={m.label + m.col} style={{ left: `calc(${m.col} * 16px)` }}>
                  {m.label}
                </span>
              ))}
            </div>
            <div className="act-heatmap__grid">
              {padded.map((cell, i) => {
                if (cell === null) {
                  return <div key={`pad-${i}`} className="act-heatmap__cell act-heatmap__cell--pad" />;
                }

                const isSelected = selectedDate === cell.date;
                const formattedDate = new Date(cell.date + "T00:00:00").toLocaleDateString(language, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                });
                const gamesInfo = cell.games.length > 0 ? `\nGames: ${cell.games.join(", ")}` : "";
                const sessionsInfo =
                  cell.sessionsCount > 0 ? `\nSessions: ${cell.sessionsCount}` : "";
                const title = `${formattedDate} — ${cell.minutes > 0 ? formatPlayTime(cell.minutes) : t("activity.noPlaytimeData")}${sessionsInfo}${gamesInfo}`;

                return (
                  <button
                    type="button"
                    key={cell.date}
                    className={`act-heatmap__cell ${intensity(cell.minutes)}${isSelected ? " act-heatmap__cell--selected" : ""}`}
                    title={title}
                    aria-label={title}
                    onClick={() => onSelectDate?.(cell.date)}
                    tabIndex={onSelectDate ? 0 : -1}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="act-heatmap__footer">
        <span>{t("activityDash.less")}</span>
        <span className="act-heatmap__cell act-heatmap__cell--empty" />
        <span className="act-heatmap__cell act-heatmap__cell--low" />
        <span className="act-heatmap__cell act-heatmap__cell--medium" />
        <span className="act-heatmap__cell act-heatmap__cell--high" />
        <span className="act-heatmap__cell act-heatmap__cell--peak" />
        <span>{t("activityDash.more")}</span>
      </div>
    </div>
  );
}
