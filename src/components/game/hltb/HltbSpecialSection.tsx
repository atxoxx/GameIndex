import type { ReactNode } from "react";
import { formatCount, formatDuration, type SpecialRowData, type Translate } from "./hltbShared";

interface HltbSpecialSectionProps {
  title: string;
  icon: ReactNode;
  rows: SpecialRowData[];
  metaLabel: "range" | "invested";
  t: Translate;
}

/** Speedrun and co-op/multiplayer summaries: average plus its context. */
export function HltbSpecialSection({
  title,
  icon,
  rows,
  metaLabel,
  t,
}: HltbSpecialSectionProps) {
  return (
    <section className="hltb-section">
      <div className="hltb-section__head">
        <h3 className="hltb-section__title">
          {icon}
          {title}
        </h3>
      </div>
      <div className="hltb-mini-grid">
        {rows.map((row) => {
          const meta =
            metaLabel === "range"
              ? row.stat?.low != null || row.stat?.high != null
                ? t("hltb.rangeValue", {
                    low: formatDuration(row.stat?.low),
                    high: formatDuration(row.stat?.high),
                  })
                : null
              : row.stat?.count != null
                ? t("hltb.investedCount", { count: formatCount(row.stat.count) })
                : t("hltb.average");

          return (
            <div className="hltb-mini-card" key={row.key}>
              <span className="hltb-mini-card__label">{row.label}</span>
              <span className="hltb-mini-card__value">
                {formatDuration(row.stat?.average)}
              </span>
              {meta && <span className="hltb-mini-card__meta">{meta}</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default HltbSpecialSection;
