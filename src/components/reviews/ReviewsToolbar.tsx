import { useEffect, useRef, useState } from "react";
import {
  type DisplayOrder,
  type DropdownItem,
  type PlaytimeDeviceFilter,
  type PlaytimePresetFilter,
  type PurchaseTypeFilter,
  type ReviewTypeFilter,
  type SourceFilter,
} from "./types";
import { useLanguage } from "../../context/LanguageContext";
import { STEAM_LANGUAGES } from "../../types/game";
import { FlagIcon } from "../ui";

interface ReviewsToolbarProps {
  display: DisplayOrder;
  onDisplayChange: (val: DisplayOrder) => void;
  reviewType: ReviewTypeFilter;
  onReviewTypeChange: (val: ReviewTypeFilter) => void;
  purchaseType: PurchaseTypeFilter;
  onPurchaseTypeChange: (val: PurchaseTypeFilter) => void;
  languageFilter: string;
  onLanguageFilterChange: (val: string) => void;
  playtimePreset: PlaytimePresetFilter;
  onPlaytimePresetChange: (val: PlaytimePresetFilter) => void;
  playtimeMinHours: number;
  onPlaytimeMinHoursChange: (val: number) => void;
  playtimeMaxHours: number;
  onPlaytimeMaxHoursChange: (val: number) => void;
  playtimeDevice: PlaytimeDeviceFilter;
  onPlaytimeDeviceChange: (val: PlaytimeDeviceFilter) => void;
  useHelpfulSystem: boolean;
  onUseHelpfulSystemChange: (val: boolean) => void;
  searchQuery: string;
  onSearchQueryChange: (val: string) => void;
  sourceFilter: SourceFilter;
  onSourceFilterChange: (val: SourceFilter) => void;
  totalAll: number;
  steamCount: number;
  criticCounts: {
    metacritic: number;
    opencritic: number;
  };
  criticLoading: {
    metacritic: boolean;
    opencritic: boolean;
  };
  matchCount?: number;
  onResetFilters: () => void;
}

function Dropdown({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: DropdownItem[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const selected = items.find((i) => i.value === value);

  return (
    <div className="rv-dd" ref={ref}>
      <button
        type="button"
        className={`rv-dd-trigger${open ? " active" : ""}`}
        onClick={() => setOpen((p) => !p)}
      >
        {selected?.flag && <FlagIcon code={selected.flag} size={15} />}
        <span>{selected?.label ?? label}</span>
        <svg className="rv-dd-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="rv-dd-menu">
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`rv-dd-opt${item.value === value ? " active" : ""}`}
              onClick={() => {
                onChange(item.value);
                setOpen(false);
              }}
            >
              {item.flag && <FlagIcon code={item.flag} size={15} className="rv-dd-flag" />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SourceMonogram({ source }: { source: SourceFilter }) {
  if (source === "steam") {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 5h18v14H3V5zm9 2L5 19h4l1-2.5h2L13 19h4L12 7zm0 4.6L13.2 14h-2.4L12 11.6z" />
      </svg>
    );
  }
  if (source === "metacritic") return <span className="rv-mono" aria-hidden="true">MC</span>;
  if (source === "opencritic") return <span className="rv-mono" aria-hidden="true">OC</span>;
  return null;
}

export function ReviewsToolbar({
  display,
  onDisplayChange,
  reviewType,
  onReviewTypeChange,
  purchaseType,
  onPurchaseTypeChange,
  languageFilter,
  onLanguageFilterChange,
  playtimePreset,
  onPlaytimePresetChange,
  playtimeMinHours,
  onPlaytimeMinHoursChange,
  playtimeMaxHours,
  onPlaytimeMaxHoursChange,
  playtimeDevice,
  onPlaytimeDeviceChange,
  useHelpfulSystem,
  onUseHelpfulSystemChange,
  searchQuery,
  onSearchQueryChange,
  sourceFilter,
  onSourceFilterChange,
  totalAll,
  steamCount,
  criticCounts,
  criticLoading,
  matchCount,
  onResetFilters,
}: ReviewsToolbarProps) {
  const { t } = useLanguage();

  const isCriticSource =
    sourceFilter === "metacritic" || sourceFilter === "opencritic";

  const hasActiveFilters =
    reviewType !== "all" ||
    purchaseType !== "all" ||
    languageFilter !== "all" ||
    playtimePreset !== "none" ||
    playtimeDevice !== "all" ||
    useHelpfulSystem ||
    Boolean(searchQuery.trim());

  return (
    <div className="rv-toolbar-container">
      {/* ── Source Tabs ── */}
      <div className="rv-source-tabs">
        <div className="rv-source-seg">
          <button
            type="button"
            aria-pressed={sourceFilter === "all"}
            className={`rv-source-seg-btn${sourceFilter === "all" ? " active" : ""}`}
            onClick={() => onSourceFilterChange("all")}
          >
            {t("review.allReviewsCount", { count: totalAll > 0 ? totalAll.toLocaleString() : totalAll })}
          </button>
          <button
            type="button"
            aria-pressed={sourceFilter === "steam"}
            className={`rv-source-seg-btn${sourceFilter === "steam" ? " active" : ""}`}
            onClick={() => onSourceFilterChange("steam")}
          >
            <SourceMonogram source="steam" />
            {t("review.steamCount", { count: steamCount > 0 ? steamCount.toLocaleString() : steamCount })}
          </button>
        </div>

        <div className="rv-source-tabs-divider" aria-hidden="true">
          <span>{t("reviewsTab.critics")}</span>
        </div>

        <div className="rv-source-seg">
          {(["metacritic", "opencritic"] as const).map((src) => {
            const active = sourceFilter === src;
            const loading = criticLoading[src];
            const count = criticCounts[src];
            const labels: Record<string, string> = {
              metacritic: "Metacritic",
              opencritic: "OpenCritic",
            };
            return (
              <button
                key={src}
                type="button"
                aria-pressed={active}
                className={`rv-source-seg-btn rv-source-seg-btn--${src}${active ? " active" : ""}`}
                onClick={() => onSourceFilterChange(src)}
              >
                <span className="rv-source-seg-mono">
                  <SourceMonogram source={src} />
                </span>
                <span className="rv-source-seg-name">{labels[src]}</span>
                {loading ? (
                  <span className="rv-source-seg-spinner" aria-hidden="true" />
                ) : count > 0 ? (
                  <span className="rv-source-seg-count">{count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Toolbar: Sort + Filters + Search ── */}
      {!isCriticSource && (
        <div className="rv-toolbar">
          <div className="rv-toolbar-segs">
            {/* Display / Sort */}
            <div className="rv-seg" role="group" aria-label={t("review.display")}>
              <button
                type="button"
                aria-pressed={display === "summary"}
                className={`rv-seg-btn${display === "summary" ? " active" : ""}`}
                onClick={() => onDisplayChange("summary")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
                {t("review.summary")}
              </button>
              <button
                type="button"
                aria-pressed={display === "all"}
                className={`rv-seg-btn${display === "all" ? " active" : ""}`}
                onClick={() => onDisplayChange("all")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                </svg>
                {t("review.mostHelpful")}
              </button>
              <button
                type="button"
                aria-pressed={display === "recent"}
                className={`rv-seg-btn${display === "recent" ? " active" : ""}`}
                onClick={() => onDisplayChange("recent")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                {t("review.recent")}
              </button>
              <button
                type="button"
                aria-pressed={display === "funny"}
                className={`rv-seg-btn${display === "funny" ? " active" : ""}`}
                onClick={() => onDisplayChange("funny")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                  <line x1="9" y1="9" x2="9.01" y2="9" />
                  <line x1="15" y1="9" x2="15.01" y2="9" />
                </svg>
                {t("review.funny")}
              </button>
            </div>

            {/* Sentiment / Recommendation Filter */}
            <div className="rv-seg" role="group" aria-label={t("review.reviewType")}>
              <button
                type="button"
                aria-pressed={reviewType === "all"}
                className={`rv-seg-btn${reviewType === "all" ? " active" : ""}`}
                onClick={() => onReviewTypeChange("all")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                {t("review.allReviews")}
              </button>
              <button
                type="button"
                aria-pressed={reviewType === "positive"}
                className={`rv-seg-btn${reviewType === "positive" ? " active" : ""}`}
                onClick={() => onReviewTypeChange("positive")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                </svg>
                {t("review.recommended")}
              </button>
              <button
                type="button"
                aria-pressed={reviewType === "negative"}
                className={`rv-seg-btn${reviewType === "negative" ? " active" : ""}`}
                onClick={() => onReviewTypeChange("negative")}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" />
                </svg>
                {t("review.notRecommended")}
              </button>
            </div>
          </div>

          <div className="rv-toolbar-tools">
            {/* Purchase Type */}
            <Dropdown
              label={t("review.purchaseType")}
              value={purchaseType}
              onChange={(v) => onPurchaseTypeChange(v as PurchaseTypeFilter)}
              items={[
                { value: "all", label: t("review.allPurchases") },
                { value: "steam", label: t("review.steamPurchasers") },
                { value: "other", label: t("review.otherSources") },
              ]}
            />

            {/* Language */}
            <Dropdown
              label={t("common.language")}
              value={languageFilter}
              onChange={onLanguageFilterChange}
              items={STEAM_LANGUAGES.map((l) => ({ value: l.code, label: l.label, flag: l.flag }))}
            />

            {/* Playtime */}
            <Dropdown
              label={t("review.playtime")}
              value={playtimePreset}
              onChange={(v) => onPlaytimePresetChange(v as PlaytimePresetFilter)}
              items={[
                { value: "none", label: t("review.noMinimum") },
                { value: "over_1h", label: t("review.over1h") },
                { value: "over_10h", label: t("review.over10h") },
                { value: "custom", label: t("review.customOption") },
              ]}
            />
            {playtimePreset === "custom" && (
              <div className="rv-playtime-range">
                <input
                  type="number"
                  min={0}
                  max={500}
                  className="rv-input"
                  value={playtimeMinHours}
                  onChange={(e) => onPlaytimeMinHoursChange(Math.max(0, Math.min(500, Number(e.target.value) || 0)))}
                  placeholder="Min h"
                  aria-label="Min hours"
                />
                <span className="rv-playtime-range-sep">–</span>
                <input
                  type="number"
                  min={0}
                  max={500}
                  className="rv-input"
                  value={playtimeMaxHours}
                  onChange={(e) => onPlaytimeMaxHoursChange(Math.max(0, Math.min(500, Number(e.target.value) || 0)))}
                  placeholder="Max h"
                  aria-label="Max hours"
                />
                <span className="rv-playtime-range-hint">hours</span>
              </div>
            )}

            {/* Device */}
            <Dropdown
              label={t("review.device")}
              value={playtimeDevice}
              onChange={(v) => onPlaytimeDeviceChange(v as PlaytimeDeviceFilter)}
              items={[
                { value: "all", label: t("review.allDevices") },
                { value: "deck", label: t("review.steamDeck") },
              ]}
            />

            {/* Helpfulness System Toggle */}
            <label className="rv-toggle-label" title={t("reviewsTab.helpfulSystemTooltip")}>
              <input
                type="checkbox"
                checked={useHelpfulSystem}
                onChange={(e) => onUseHelpfulSystemChange(e.target.checked)}
              />
              <span>{t("review.helpfulnessSystem")}</span>
            </label>

            {/* Search Input */}
            <div className="rv-search-wrap">
              <svg className="rv-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="rv-search"
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchQueryChange(e.target.value)}
                placeholder={t("review.searchPlaceholder")}
                aria-label={t("review.searchPlaceholder")}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="rv-search-clear"
                  onClick={() => onSearchQueryChange("")}
                  aria-label="Clear search"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Active Filter Chips ── */}
      {hasActiveFilters && !isCriticSource && (
        <div className="rv-filter-chips">
          {reviewType !== "all" && (
            <button className="rv-chip" onClick={() => onReviewTypeChange("all")}>
              {reviewType === "positive" ? t("review.recommended") : t("review.notRecommended")} ✕
            </button>
          )}
          {purchaseType !== "all" && (
            <button className="rv-chip" onClick={() => onPurchaseTypeChange("all")}>
              {purchaseType === "steam" ? t("review.chipSteamPurchases") : t("review.otherSources")} ✕
            </button>
          )}
          {playtimePreset !== "none" && (
            <button className="rv-chip" onClick={() => onPlaytimePresetChange("none")}>
              {playtimePreset === "over_1h"
                ? t("review.chipOver1h")
                : playtimePreset === "over_10h"
                ? t("review.chipOver10h")
                : t("review.customOption")}{" "}
              ✕
            </button>
          )}
          {playtimeDevice !== "all" && (
            <button className="rv-chip" onClick={() => onPlaytimeDeviceChange("all")}>
              {t("review.steamDeck")} ✕
            </button>
          )}
          {useHelpfulSystem && (
            <button className="rv-chip" onClick={() => onUseHelpfulSystemChange(false)}>
              {t("review.helpfulnessSystem")} ✕
            </button>
          )}
          {languageFilter !== "all" && (
            <button className="rv-chip" onClick={() => onLanguageFilterChange("all")}>
              {t("review.languageChip", {
                language:
                  STEAM_LANGUAGES.find((l) => l.code === languageFilter)?.label ?? languageFilter,
              })}{" "}
              ✕
            </button>
          )}
          {searchQuery && (
            <button className="rv-chip" onClick={() => onSearchQueryChange("")}>
              “{searchQuery}” ✕
            </button>
          )}

          {matchCount !== undefined && (
            <span className="rv-match-counter">
              {t("reviewsTab.searchMatches", { count: matchCount.toLocaleString() })}
            </span>
          )}

          <button type="button" className="rv-chip-reset" onClick={onResetFilters}>
            {t("review.resetFilters")}
          </button>
        </div>
      )}
    </div>
  );
}
