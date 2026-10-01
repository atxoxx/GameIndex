import { useLanguage } from "../../context/LanguageContext";
import { hasReliabilitySample, type SourceReliability } from "./reliability";

/**
 * Compact success-rate pill for a download source. Renders nothing when
 * the sample is too small to be meaningful.
 */
export function ReliabilityBadge({
  reliability,
  compact = false,
}: {
  reliability?: SourceReliability;
  compact?: boolean;
}) {
  const { t } = useLanguage();
  if (!hasReliabilitySample(reliability)) return null;

  const pct = Math.round(reliability.successRate * 100);
  const tier = pct >= 90 ? "high" : pct >= 60 ? "mid" : "low";
  const label = t("downloadModal.reliability", { pct });
  const tooltip = t("downloadModal.reliabilityTooltip", {
    completed: reliability.completed,
    total: reliability.total,
  });

  return (
    <span
      className={`dl-reliability-badge dl-reliability-badge--${tier}`}
      title={tooltip}
      aria-label={tooltip}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
      <span>{compact ? `${pct}%` : label}</span>
    </span>
  );
}
