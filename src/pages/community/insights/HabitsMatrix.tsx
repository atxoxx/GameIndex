import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Flame } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { Card } from "../../../components/ui";
import { computeHabitMatrix, formatHours } from "../statsCalculations";
import type { HabitCell, GameSession } from "../statsTypes";

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

interface HabitsMatrixProps {
  sessions: GameSession[];
}

interface CellSummary {
  cell: HabitCell;
  count: number;
}

function cellKey(day: number, hour: number): string {
  return `${day}-${hour}`;
}

/**
 * 7×24 habit matrix.
 *
 * Reads as one compact heatmap rather than a wall of tiles: hover or keyboard
 * focus reveals the exact slot, the right rail sums each weekday, the bar
 * strip under the grid sums each hour, and the busiest slot is marked. No
 * click state — the matrix answers "when do I play", the detail lives in the
 * tooltip.
 */
export function HabitsMatrix({ sessions }: HabitsMatrixProps) {
  const { t } = useLanguage();
  const [focused, setFocused] = useState({ day: 0, hour: 0 });
  const [legendLevel, setLegendLevel] = useState<number | null>(null);
  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // TEMP preview hook for visual QA; removed once the matrix is checked.
  const { cells, dayTotals, hourTotals, peak, totalMinutes } = useMemo(() => {
    const habit = computeHabitMatrix(sessions);

    const countBySlot = new Map<string, number>();
    for (const session of sessions) {
      const date = new Date(session.date);
      const day = (date.getDay() + 6) % 7;
      const key = cellKey(day, date.getHours());
      countBySlot.set(key, (countBySlot.get(key) || 0) + 1);
    }

    const byDay = Array.from({ length: 7 }, () => 0);
    const byHour = Array.from({ length: 24 }, () => 0);
    let total = 0;
    let busiest: HabitCell | null = null;

    for (const cell of habit.cells) {
      byDay[cell.dayIndex] += cell.minutes;
      byHour[cell.hour] += cell.minutes;
      total += cell.minutes;
      if (cell.minutes > 0 && (!busiest || cell.minutes > busiest.minutes)) {
        busiest = cell;
      }
    }

    const summaries = new Map<string, CellSummary>();
    for (const cell of habit.cells) {
      summaries.set(cellKey(cell.dayIndex, cell.hour), {
        cell,
        count: countBySlot.get(cellKey(cell.dayIndex, cell.hour)) || 0,
      });
    }

    return {
      cells: summaries,
      dayTotals: byDay,
      hourTotals: byHour,
      peak: busiest as HabitCell | null,
      totalMinutes: total,
    };
  }, [sessions]);

  const maxDay = Math.max(...dayTotals, 1);
  const maxHour = Math.max(...hourTotals, 1);

  const focusCell = useCallback((day: number, hour: number) => {
    const clampedDay = Math.max(0, Math.min(6, day));
    const clampedHour = Math.max(0, Math.min(23, hour));
    setFocused({ day: clampedDay, hour: clampedHour });
    cellRefs.current.get(cellKey(clampedDay, clampedHour))?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const { day, hour } = focused;
      switch (event.key) {
        case "ArrowRight":
          event.preventDefault();
          focusCell(day, hour + 1);
          break;
        case "ArrowLeft":
          event.preventDefault();
          focusCell(day, hour - 1);
          break;
        case "ArrowDown":
          event.preventDefault();
          focusCell(day + 1, hour);
          break;
        case "ArrowUp":
          event.preventDefault();
          focusCell(day - 1, hour);
          break;
        case "Home":
          event.preventDefault();
          focusCell(day, 0);
          break;
        case "End":
          event.preventDefault();
          focusCell(day, 23);
          break;
        default:
          break;
      }
    },
    [focused, focusCell]
  );

  // On narrow screens the 24 hours don't fit; open on the busiest stretch
  // instead of a column of empty morning cells.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !peak) return;
    if (scroller.scrollWidth <= scroller.clientWidth + 1) return;
    const target = cellRefs.current.get(cellKey(peak.dayIndex, peak.hour));
    if (!target) return;

    const frame = requestAnimationFrame(() => {
      const viewport = scroller.getBoundingClientRect();
      const cellRect = target.getBoundingClientRect();
      const delta = cellRect.left - viewport.left - (viewport.width - cellRect.width) / 2;
      scroller.scrollLeft = Math.max(0, scroller.scrollLeft + delta);
    });
    return () => cancelAnimationFrame(frame);
  }, [peak]);

  const peakLabel = peak
    ? t("profile.habits.peak", {
        day: t(`communityExtras.weekday.${DAY_KEYS[peak.dayIndex]}`),
        hour: peak.hour,
        time: formatHours(peak.minutes),
      })
    : null;

  return (
    <Card variant="surface" elevation="1" className="profile-card habits-card">
      <div className="profile-card__head habits-head">
        <div>
          <h3>{t("stats.habit.title")}</h3>
          <span className="profile-card__sub">{t("stats.habit.desc")}</span>
        </div>

        <div className="habits-head__side">
          {peakLabel && (
            <span className="habits-peak" title={peakLabel}>
              <Flame size={12} aria-hidden="true" />
              {peakLabel}
            </span>
          )}

          {totalMinutes > 0 && (
            <div
              className="habits-legend"
              onMouseLeave={() => setLegendLevel(null)}
              aria-hidden="true"
            >
              <span className="habits-legend__label">{t("activityDash.less")}</span>
              {[1, 2, 3, 4].map((level) => (
                <span
                  key={level}
                  className={`habits-swatch level-${level}${legendLevel === level ? " is-active" : ""}`}
                  onMouseEnter={() => setLegendLevel(level)}
                />
              ))}
              <span className="habits-legend__label">{t("activityDash.more")}</span>
            </div>
          )}
        </div>
      </div>

      {totalMinutes === 0 ? (
        <div className="habits-empty">
          <Flame size={18} aria-hidden="true" />
          <p>{t("profile.habits.empty")}</p>
        </div>
      ) : (
        <>
          <div className="habits-scroll-wrap">
            <div className="habits-scroll" ref={scrollRef}>
              <div
                className="habits-grid"
                role="grid"
                aria-label={t("profile.habits.aria")}
                aria-readonly="true"
                onKeyDown={handleKeyDown}
              >
              <div className="habits-row habits-row--hours" role="row">
                <span className="habits-day habits-day--head" aria-hidden="true" />
                {HOURS.map((hour) => (
                  <span key={hour} className="habits-hour" aria-hidden="true">
                    {hour % 3 === 0 ? `${hour}h` : ""}
                  </span>
                ))}
                <span className="habits-day-total habits-day-total--head" aria-hidden="true" />
              </div>

              {DAY_KEYS.map((dayKey, dayIndex) => {
                const dayLabel = t(`communityExtras.weekday.${dayKey}`);
                return (
                  <div className="habits-row" role="row" key={dayKey}>
                    <span className="habits-day" role="rowheader">
                      {dayLabel}
                    </span>

                    {HOURS.map((hour) => {
                      const key = cellKey(dayIndex, hour);
                      const summary = cells.get(key);
                      const minutes = summary?.cell.minutes ?? 0;
                      const count = summary?.count ?? 0;
                      const intensity = summary?.cell.intensity ?? 0;
                      const isPeak =
                        peak !== null && peak.dayIndex === dayIndex && peak.hour === hour;
                      const isFocused = focused.day === dayIndex && focused.hour === hour;
                      const levelState =
                        legendLevel === null
                          ? ""
                          : intensity === legendLevel
                            ? " is-lit"
                            : " is-dimmed";

                      return (
                        <div
                          key={hour}
                          ref={(element) => {
                            if (element) cellRefs.current.set(key, element);
                            else cellRefs.current.delete(key);
                          }}
                          role="gridcell"
                          tabIndex={isFocused ? 0 : -1}
                          aria-label={t("profile.habits.cellAria", {
                            day: dayLabel,
                            hour,
                            time: minutes > 0 ? formatHours(minutes) : t("communityExtras.noPlay"),
                          })}
                          className={`habits-cell level-${intensity}${isPeak ? " is-peak" : ""}${levelState}`}
                          onFocus={() => setFocused({ day: dayIndex, hour })}
                        >
                          <span className="habits-tip" role="tooltip" aria-hidden="true">
                            <b>
                              {dayLabel} · {hour}:00
                            </b>
                            <span>
                              {minutes > 0 ? formatHours(minutes) : t("communityExtras.noPlay")}
                              {count > 0 && (
                                <>
                                  {" · "}
                                  {t("gameActivity.sessionCount", {
                                    count,
                                    s: count !== 1 ? "s" : "",
                                  })}
                                </>
                              )}
                            </span>
                          </span>
                        </div>
                      );
                    })}

                    <span
                      className="habits-day-total"
                      title={t("profile.habits.dayTotal", { time: formatHours(dayTotals[dayIndex]) })}
                    >
                      <span className="habits-day-bar" aria-hidden="true">
                        <span style={{ width: `${Math.round((dayTotals[dayIndex] / maxDay) * 100)}%` }} />
                      </span>
                      <span className="habits-day-value">{formatHours(dayTotals[dayIndex])}</span>
                    </span>
                  </div>
                );
              })}

              <div className="habits-row habits-row--totals" role="row" aria-hidden="true">
                <span className="habits-day" />
                {HOURS.map((hour) => (
                  <span
                    key={hour}
                    className="habits-hour-bar"
                    title={t("profile.habits.hourTotal", {
                      hour,
                      time: formatHours(hourTotals[hour]),
                    })}
                  >
                    <span
                      style={{
                        height: `${Math.round((hourTotals[hour] / maxHour) * 100)}%`,
                      }}
                    />
                  </span>
                ))}
                <span className="habits-day-total" />
              </div>
              </div>
            </div>
          </div>

          <p className="habits-hint">
            <span className="habits-hint__wide">{t("profile.habits.hint")}</span>
            <span className="habits-hint__narrow">{t("profile.habits.hintTouch")}</span>
          </p>
        </>
      )}
    </Card>
  );
}
