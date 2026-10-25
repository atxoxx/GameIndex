import { IconChevronDown, IconClock } from "../icons";
import { formatDuration, type StyleKey, type StyleRowData, type Translate } from "./hltbShared";
import HltbStyleRow from "./HltbStyleRow";
import HltbTimesTable from "./HltbTimesTable";

interface HltbTimesSectionProps {
  styles: StyleRowData[];
  activeStyle?: StyleRowData;
  playSeconds: number;
  showTable: boolean;
  onToggleTable: () => void;
  onSelect: (key: StyleKey) => void;
  t: Translate;
}

/**
 * The playstyle range chart: one shared hour scale so the four community
 * ranges are directly comparable, with the user's playtime drawn across
 * every row and the exact-value table behind a disclosure.
 */
export function HltbTimesSection({
  styles,
  activeStyle,
  playSeconds,
  showTable,
  onToggleTable,
  onSelect,
  t,
}: HltbTimesSectionProps) {
  const lows = styles
    .map((row) => row.stat?.low ?? row.stat?.average ?? 0)
    .filter((value) => value > 0);
  const highs = styles
    .map((row) => row.stat?.high ?? row.stat?.average ?? 0)
    .filter((value) => value > 0);
  const rawLow = Math.min(...lows);
  const rawHigh = Math.max(...highs);
  const padding = Math.max(1, (rawHigh - rawLow) * 0.04);
  const low = Math.max(1, rawLow - padding);
  const high = rawHigh + padding;

  return (
    <section className="hltb-section">
      <div className="hltb-section__head">
        <h3 className="hltb-section__title">
          <IconClock size={14} />
          {t("hltb.playStyles")}
        </h3>
        <span className="hltb-section__note">{t("hltb.playStylesNote")}</span>
      </div>

      <div className="hltb-styles">
        {styles.map((row) => (
          <HltbStyleRow
            key={row.key}
            row={row}
            active={activeStyle?.key === row.key}
            playSeconds={playSeconds}
            low={low}
            high={high}
            onSelect={onSelect}
            t={t}
          />
        ))}
      </div>

      <div className="hltb-chart-foot">
        <div className="hltb-legend">
          <span>
            <i className="hltb-legend__range" />
            {t("hltb.legendRange")}
          </span>
          <span>
            <i className="hltb-legend__median" />
            {t("hltb.median")}
          </span>
          <span>
            <i className="hltb-legend__avg" />
            {t("hltb.average")}
          </span>
          {playSeconds > 0 && (
            <span>
              <i className="hltb-legend__you" />
              {t("hltb.yourMarker")}
            </span>
          )}
        </div>
        <span className="hltb-chart-axis">
          {formatDuration(low)} – {formatDuration(high)}
        </span>
      </div>

      <button
        type="button"
        className="hltb-disclosure"
        aria-expanded={showTable}
        onClick={onToggleTable}
      >
        <IconChevronDown size={14} />
        {showTable ? t("hltb.hideNumbers") : t("hltb.showNumbers")}
      </button>

      {showTable && <HltbTimesTable rows={styles} t={t} />}
    </section>
  );
}

export default HltbTimesSection;
