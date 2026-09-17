import { useLanguage } from "../../context/LanguageContext";
import { DATE_RANGES, type DateRangeKey } from "./insights";
import { useFocusProps } from "./focusable";

function RangePill({
  range,
  active,
  onSelect,
}: {
  range: DateRangeKey;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useLanguage();
  const focus = useFocusProps(onSelect);
  return (
    <button
      ref={focus.ref}
      tabIndex={focus.tabIndex}
      type="button"
      className={`act-pill${active ? " act-pill--active" : ""}`}
      aria-pressed={active}
      onClick={focus.onClick}
    >
      {range === "all" ? t("activity.allTime") : range.toUpperCase()}
    </button>
  );
}

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
        <RangePill
          key={range}
          range={range}
          active={value === range}
          onSelect={() => onChange(range)}
        />
      ))}
    </div>
  );
}
