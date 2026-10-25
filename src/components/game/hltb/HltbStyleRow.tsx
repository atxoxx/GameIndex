import { Tooltip } from "../../ui";
import {
  formatCount,
  formatDuration,
  type StyleKey,
  type StyleRowData,
  type Translate,
} from "./hltbShared";

interface HltbStyleRowProps {
  row: StyleRowData;
  active: boolean;
  playSeconds: number;
  low: number;
  high: number;
  onSelect: (key: StyleKey) => void;
  t: Translate;
}

function percentToneClass(percent: number): string {
  return percent >= 100 ? " hltb-style-row__pct--done" : "";
}

/**
 * One playstyle in the range chart. The button pins the style for the hero
 * gauge; hovering or focusing it reveals the exact HLTB quartets.
 */
export function HltbStyleRow({
  row,
  active,
  playSeconds,
  low,
  high,
  onSelect,
  t,
}: HltbStyleRowProps) {
  const stat = row.stat;
  const average = stat?.average ?? 0;
  const speed = Math.max(1, high - low);
  const lowPct = Math.max(0, Math.min(100, (((stat?.low ?? average) - low) / speed) * 100));
  const highPct = Math.max(0, Math.min(100, (((stat?.high ?? average) - low) / speed) * 100));
  const medianPct =
    stat?.median != null
      ? Math.max(0, Math.min(100, ((stat.median - low) / speed) * 100))
      : null;
  const averagePct = Math.max(0, Math.min(100, ((average - low) / speed) * 100));
  const youPct =
    playSeconds > 0 ? Math.max(0, Math.min(100, ((playSeconds - low) / speed) * 100)) : null;
  const percent =
    average > 0 && playSeconds > 0 ? Math.round((playSeconds / average) * 100) : null;
  const toneClass =
    row.key === "plus"
      ? " hltb-style-row--info"
      : row.key === "hundred"
        ? " hltb-style-row--success"
        : "";

  return (
    <div className="hltb-style-shell">
      <Tooltip
        content={
          <div className="hltb-style-tip">
            <strong>{row.label}</strong>
            <span>
              <em>{t("hltb.fastest")}</em>
              <b>{formatDuration(stat?.low)}</b>
            </span>
            <span>
              <em>{t("hltb.median")}</em>
              <b>{formatDuration(stat?.median)}</b>
            </span>
            <span>
              <em>{t("hltb.average")}</em>
              <b>{formatDuration(stat?.average)}</b>
            </span>
            <span>
              <em>{t("hltb.slowest")}</em>
              <b>{formatDuration(stat?.high)}</b>
            </span>
            {stat?.count != null && (
              <span>
                <em>{t("hltb.submissionsShort")}</em>
                <b>{formatCount(stat.count)}</b>
              </span>
            )}
            {playSeconds > 0 && (
              <span>
                <em>{t("hltb.yourPlaytime")}</em>
                <b>{formatDuration(playSeconds)}</b>
              </span>
            )}
          </div>
        }
        placement="top"
        maxWidth={300}
        delay={160}
      >
        <button
          type="button"
          className={`hltb-style-row${toneClass}`}
          aria-pressed={active}
          onClick={() => onSelect(row.key)}
        >
          <span className="hltb-style-row__head">
            <span className="hltb-style-row__label">{row.label}</span>
            {stat?.count != null && (
              <span className="hltb-style-row__count">
                {t("hltb.submissions", { count: formatCount(stat.count) })}
              </span>
            )}
            <span className="hltb-style-row__avg">{formatDuration(average)}</span>
            {percent != null && (
              <span className={`hltb-style-row__pct${percentToneClass(percent)}`}>
                {percent}%
              </span>
            )}
          </span>

          <span className="hltb-style-row__chart" aria-hidden="true">
            <span className="hltb-style-row__track" />
            <span
              className="hltb-style-row__range"
              style={{ left: `${lowPct}%`, width: `${Math.max(0, highPct - lowPct)}%` }}
            />
            {medianPct != null && (
              <span className="hltb-style-row__median" style={{ left: `${medianPct}%` }} />
            )}
            <span className="hltb-style-row__avg-dot" style={{ left: `${averagePct}%` }} />
            {youPct != null && (
              <span
                className={`hltb-style-row__you${
                  playSeconds < low
                    ? " hltb-style-row__you--before"
                    : playSeconds > high
                      ? " hltb-style-row__you--after"
                      : ""
                }`}
                style={{ left: `${youPct}%` }}
              />
            )}
          </span>
        </button>
      </Tooltip>
    </div>
  );
}

export default HltbStyleRow;
