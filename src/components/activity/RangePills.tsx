import { useLanguage } from "../../context/LanguageContext";
import { DATE_RANGES, type DateRangeKey } from "./insights";

export function RangePills({
  value,
  onChange,
}: {
  value: DateRangeKey;
  onChange: (range: DateRangeKey) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="act-pills" role="group" aria-label={t("activity.range")}>
      {DATE_RANGES.map((range) => (
        <button
          key={range}
          type="button"
          className={`act-pill${value === range ? " act-pill--active" : ""}`}
          aria-pressed={value === range}
          onClick={() => onChange(range)}
        >
          {range === "all" ? t("activity.allTime") : range.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
