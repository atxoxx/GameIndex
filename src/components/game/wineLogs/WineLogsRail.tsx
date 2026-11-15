import { ChevronRight } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import { EDIT_GAME_TABS, type EditGameTab } from "../editGameTabs";
import {
  SEVERITY_FILTERS,
  formatCount,
  formatLogSize,
  formatRelativeTime,
  relativeTimeLabel,
  type SeverityCounts,
  type SeverityFilter,
} from "./logAnalysis";
import { WineLogsPathChip } from "./WineLogsPathChip";

/** WINEDEBUG presets offered in the rail; labels reuse compatibility copy. */
const VERBOSE_OPTIONS: ReadonlyArray<{ value: string; labelKey: string }> = [
  { value: "-all", labelKey: "compatibility.debugDisabled" },
  { value: "warn+all", labelKey: "compatibility.debugWarnOnly" },
  { value: "fixme-all", labelKey: "compatibility.debugFixmeOnly" },
  { value: "+loaddll", labelKey: "compatibility.debugDllLoads" },
  { value: "all", labelKey: "compatibility.debugAllVerbose" },
];

interface WineLogsRailProps {
  logPath?: string;
  sizeBytes: number;
  lineCount: number;
  lastModified?: number;
  counts: SeverityCounts;
  filter: SeverityFilter;
  onFilterChange: (filter: SeverityFilter) => void;
  wrap: boolean;
  onWrapChange: (wrap: boolean) => void;
  autoScroll: boolean;
  onAutoScrollChange: (autoScroll: boolean) => void;
  verboseValue: string;
  onVerboseChange: (value: string) => void;
  onCopyPath: () => Promise<boolean>;
  onOpenEditTab?: (tab: EditGameTab) => void;
}

export function WineLogsRail({
  logPath,
  sizeBytes,
  lineCount,
  lastModified,
  counts,
  filter,
  onFilterChange,
  wrap,
  onWrapChange,
  autoScroll,
  onAutoScrollChange,
  verboseValue,
  onVerboseChange,
  onCopyPath,
  onOpenEditTab,
}: WineLogsRailProps) {
  const { t } = useLanguage();

  const hasCustomVerbose =
    verboseValue !== "" && !VERBOSE_OPTIONS.some((option) => option.value === verboseValue);

  const updatedLabel = lastModified
    ? (() => {
        const relative = formatRelativeTime(lastModified, Date.now());
        const label = relativeTimeLabel(relative);
        return t(label.key, label.vars) || label.key;
      })()
    : "—";

  return (
    <aside className="wine-logs-rail">
      <section className="wine-logs-rail-section">
        <h3 className="wine-logs-rail-label">{t("wineLogs.sectionLog")}</h3>
        {logPath ? <WineLogsPathChip path={logPath} onCopy={onCopyPath} /> : null}
        <dl className="wine-logs-stats">
          <div className="wine-logs-stat">
            <dt className="wine-logs-stat-label">{t("wineLogs.size")}</dt>
            <dd className="wine-logs-stat-value">{formatLogSize(sizeBytes)}</dd>
          </div>
          <div className="wine-logs-stat">
            <dt className="wine-logs-stat-label">{t("wineLogs.lines")}</dt>
            <dd className="wine-logs-stat-value">{formatCount(lineCount)}</dd>
          </div>
          <div className="wine-logs-stat">
            <dt className="wine-logs-stat-label">{t("wineLogs.updated")}</dt>
            <dd className="wine-logs-stat-value">{updatedLabel}</dd>
          </div>
        </dl>
      </section>

      <section className="wine-logs-rail-section">
        <h3 className="wine-logs-rail-label" id="wine-logs-filter-label">
          {t("wineLogs.sectionFilter")}
        </h3>
        <div
          className="wine-logs-filter-list"
          role="radiogroup"
          aria-labelledby="wine-logs-filter-label"
        >
          {SEVERITY_FILTERS.map((option) => {
            const active = filter === option.id;
            const count = Math.max(0, counts[option.id]);
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`wine-logs-filter-row${active ? " is-active" : ""}`}
                data-filter={option.id}
                data-empty={count === 0 ? "true" : undefined}
                onClick={() => onFilterChange(option.id)}
              >
                <span
                  className="wine-logs-filter-dot"
                  data-severity={option.id}
                  aria-hidden
                />
                <span className="wine-logs-filter-label">{t(option.labelKey)}</span>
                <span className="wine-logs-filter-count">{formatCount(count)}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="wine-logs-rail-section">
        <h3 className="wine-logs-rail-label">{t("wineLogs.sectionDisplay")}</h3>
        <label className="wine-logs-switch">
          <input
            type="checkbox"
            checked={wrap}
            onChange={(event) => onWrapChange(event.target.checked)}
          />
          <span>{t("wineLogs.wrap")}</span>
        </label>
        <label className="wine-logs-switch">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(event) => onAutoScrollChange(event.target.checked)}
          />
          <span>{t("wineLogs.autoScroll")}</span>
        </label>
      </section>

      <section className="wine-logs-rail-section">
        <label className="wine-logs-rail-label" htmlFor="wine-logs-verbose">
          {t("wineLogs.verbose")}
        </label>
        <select
          id="wine-logs-verbose"
          className="wine-logs-select"
          value={verboseValue}
          onChange={(event) => onVerboseChange(event.target.value)}
          title={t("wineLogs.verboseDesc")}
        >
          <option value="">{t("wineLogs.verboseGlobal")}</option>
          {hasCustomVerbose ? <option value={verboseValue}>{verboseValue}</option> : null}
          {VERBOSE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey) || option.value}
            </option>
          ))}
        </select>
        <p className="wine-logs-rail-help">{t("wineLogs.verboseDesc")}</p>
      </section>

      {onOpenEditTab ? (
        <section className="wine-logs-rail-section">
          <h3 className="wine-logs-rail-label">{t("wineLogs.sectionEditor")}</h3>
          {EDIT_GAME_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className="wine-logs-rail-link"
              onClick={() => onOpenEditTab(tab.key)}
            >
              {tab.icon}
              <span>{t(tab.labelKey)}</span>
              <ChevronRight size={13} aria-hidden />
            </button>
          ))}
        </section>
      ) : null}
    </aside>
  );
}
