import { useMemo } from "react";
import { Plug } from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import MultiSelectDropdown, {
  type MultiSelectOption,
} from "../ui/MultiSelectDropdown";
import type { PluginInfo } from "../../types/plugins";
import type { SourceLink } from "../../types/source";

export interface StoreAvailabilityFilterProps {
  /** Enabled download sources (the built-in source list). */
  sources: SourceLink[];
  selectedSourceIds: string[];
  sourceCounts: Record<string, { checked: number; available: number }>;
  sourceMatchMode: "all" | "any";
  onSourcesChange: (ids: string[]) => void;
  onSourceMatchModeChange: (mode: "all" | "any") => void;
  /** Enabled plugins only — a disabled plugin can never match. */
  plugins: PluginInfo[];
  selectedPluginIds: string[];
  pluginCounts: Record<string, { checked: number; available: number }>;
  /** Plugin id → last probe error. */
  pluginErrors: Record<string, string>;
  pluginMatchMode: "all" | "any";
  onPluginsChange: (ids: string[]) => void;
  onPluginMatchModeChange: (mode: "all" | "any") => void;
  /** True while availability probes are in flight. */
  checking: boolean;
  /** Enabled plugins that could not be checked. */
  uncheckedPlugins: number;
  /** Probe-level failure, when the last check call itself failed. */
  probeError: string | null;
}

const CATEGORY_LABEL_KEY: Record<string, string> = {
  pc: "settings.plugins.categoryPc",
  hybrid: "settings.plugins.categoryHybrid",
  console: "settings.plugins.categoryConsole",
};

/** Per-option badge value: how many loaded games that route matched. */
function availableCounts(
  counts: Record<string, { checked: number; available: number }>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, entry] of Object.entries(counts)) {
    if (entry.checked > 0) out[id] = entry.available;
  }
  return out;
}

/**
 * "Availability" facet: which download routes actually have the game.
 *
 * Built-in sources and plugins answer different questions (the sources
 * cache is a local FTS index, plugins are live third-party searches), so
 * each group keeps its own dropdown selection and any/all mode. The
 * section only probes while something is selected — see
 * `useSourceAvailabilityCache` and `usePluginAvailabilityCache`.
 */
export default function StoreAvailabilityFilter({
  sources,
  selectedSourceIds,
  sourceCounts,
  sourceMatchMode,
  onSourcesChange,
  onSourceMatchModeChange,
  plugins,
  selectedPluginIds,
  pluginCounts,
  pluginErrors,
  pluginMatchMode,
  onPluginsChange,
  onPluginMatchModeChange,
  checking,
  uncheckedPlugins,
  probeError,
}: StoreAvailabilityFilterProps) {
  const { t } = useLanguage();

  const sourceOptions = useMemo<MultiSelectOption[]>(
    () =>
      [...sources]
        .filter((s) => s.enabled)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({ value: s.id, label: s.name })),
    [sources]
  );

  // Plugins arrive ordered PC → hybrid → console, so the menu sections
  // follow the same order without extra sorting.
  const pluginOptions = useMemo<MultiSelectOption[]>(
    () =>
      plugins.map((p) => ({
        value: p.id,
        label: p.name,
        group: t(CATEGORY_LABEL_KEY[p.platformCategory ?? "pc"]),
        warning: pluginErrors[p.id]
          ? t("store.filter.pluginCheckFailed")
          : undefined,
      })),
    [plugins, pluginErrors, t]
  );

  const sourceCountValues = useMemo(
    () => availableCounts(sourceCounts),
    [sourceCounts]
  );
  const pluginCountValues = useMemo(
    () => availableCounts(pluginCounts),
    [pluginCounts]
  );

  const modeToggle = (
    mode: "all" | "any",
    onChange: (mode: "all" | "any") => void
  ) => (
    <div className="store-availability-mode" role="group">
      <button
        type="button"
        aria-pressed={mode === "any"}
        onClick={() => onChange("any")}
      >
        {t("store.filter.matchAny")}
      </button>
      <button
        type="button"
        aria-pressed={mode === "all"}
        onClick={() => onChange("all")}
      >
        {t("store.filter.matchAll")}
      </button>
    </div>
  );

  return (
    <div className="store-filter-section store-filter-section--availability">
      <h4 className="store-filter-heading">
        <Plug size={14} aria-hidden="true" />
        {t("store.filter.availability")}
        {checking && (
          <span className="store-spinner store-availability-spinner" aria-hidden="true" />
        )}
      </h4>

      {sourceOptions.length > 0 && (
        <div className="store-availability-group">
          <div className="store-availability-group-head">
            <h5>{t("store.filter.downloadSources")}</h5>
            {selectedSourceIds.length > 1 &&
              modeToggle(sourceMatchMode, onSourceMatchModeChange)}
          </div>
          <MultiSelectDropdown
            label={t("store.filter.downloadSources")}
            placeholder={t("common.all")}
            options={sourceOptions}
            selected={selectedSourceIds}
            onChange={onSourcesChange}
            counts={sourceCountValues}
            clearLabel={t("common.clear")}
            searchPlaceholder={t("store.filters.searchSources")}
            noResultsLabel={t("common.noResults")}
          />
        </div>
      )}

      <div className="store-availability-group">
        <div className="store-availability-group-head">
          <h5>{t("store.filter.plugins")}</h5>
          {selectedPluginIds.length > 1 &&
            modeToggle(pluginMatchMode, onPluginMatchModeChange)}
        </div>

        {pluginOptions.length === 0 ? (
          <p className="store-availability-empty">
            {t("store.filter.noPlugins")}
          </p>
        ) : (
          <MultiSelectDropdown
            label={t("store.filter.plugins")}
            placeholder={t("common.all")}
            options={pluginOptions}
            selected={selectedPluginIds}
            onChange={onPluginsChange}
            counts={pluginCountValues}
            clearLabel={t("common.clear")}
            searchPlaceholder={t("store.filters.searchPlugins")}
            noResultsLabel={t("common.noResults")}
          />
        )}
      </div>

      {selectedPluginIds.length > 0 && (
        <p className="store-filter-counts-note">
          {t("store.filter.pluginCaveat")}
          {uncheckedPlugins > 0 &&
            ` ${t("store.filter.uncheckedPlugins", { count: uncheckedPlugins })}`}
          {probeError &&
            ` ${t("store.filter.pluginProbeFailed", { error: probeError })}`}
        </p>
      )}
    </div>
  );
}
