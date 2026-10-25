import { useEffect, useRef } from "react";
import { RotateCcw, X } from "lucide-react";
import { Button } from "../ui";
import { useLanguage } from "../../context/LanguageContext";
import { STEAM_LANGUAGES } from "../../types/game";
import type {
  DisplayOrder,
  PlaytimeDeviceFilter,
  PlaytimePresetFilter,
  PurchaseTypeFilter,
} from "./types";

export interface ReviewsFilterPopoverProps {
  open: boolean;
  onClose: () => void;
  display: DisplayOrder;
  onDisplayChange: (value: DisplayOrder) => void;
  purchaseType: PurchaseTypeFilter;
  onPurchaseTypeChange: (value: PurchaseTypeFilter) => void;
  languageFilter: string;
  onLanguageFilterChange: (value: string) => void;
  playtimePreset: PlaytimePresetFilter;
  onPlaytimePresetChange: (value: PlaytimePresetFilter) => void;
  playtimeMinHours: number;
  onPlaytimeMinHoursChange: (value: number) => void;
  playtimeMaxHours: number;
  onPlaytimeMaxHoursChange: (value: number) => void;
  playtimeDevice: PlaytimeDeviceFilter;
  onPlaytimeDeviceChange: (value: PlaytimeDeviceFilter) => void;
  useHelpfulSystem: boolean;
  onUseHelpfulSystemChange: (value: boolean) => void;
  showDeckVerified: boolean;
  onReset: () => void;
}

/**
 * Review filters as a popover instead of a permanent toolbar.
 *
 * The rating/sentiment choice stays in the summary rail (it is a primary
 * lens); the long tail — purchase type, language, playtime, device, ordering —
 * lives here so the feed can keep the reading width.
 */
export default function ReviewsFilterPopover({
  open,
  onClose,
  display,
  onDisplayChange,
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
  showDeckVerified,
  onReset,
}: ReviewsFilterPopoverProps) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        if (event.target instanceof Element && event.target.closest(".rv-filter-anchor")) {
          return;
        }
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="rv-filter-popover" ref={ref} role="dialog" aria-label={t("review.filters")}>
      <header className="rv-filter-popover__head">
        <span>{t("review.filters")}</span>
        <button
          type="button"
          className="rv-filter-popover__close"
          onClick={onClose}
          aria-label={t("common.close")}
          title={t("common.close")}
        >
          <X size={14} />
        </button>
      </header>

      <div className="rv-filter-popover__grid">
        <label className="rv-filter-field">
          <span>{t("review.display")}</span>
          <select
            className="game-tab-select"
            value={display}
            onChange={(event) => onDisplayChange(event.target.value as DisplayOrder)}
          >
            <option value="summary">{t("review.summary")}</option>
            <option value="all">{t("review.mostHelpful")}</option>
            <option value="recent">{t("review.recent")}</option>
            <option value="funny">{t("review.funny")}</option>
          </select>
        </label>

        <label className="rv-filter-field">
          <span>{t("review.purchaseType")}</span>
          <select
            className="game-tab-select"
            value={purchaseType}
            onChange={(event) =>
              onPurchaseTypeChange(event.target.value as PurchaseTypeFilter)
            }
          >
            <option value="all">{t("review.allPurchases")}</option>
            <option value="steam">{t("review.steamPurchasers")}</option>
            <option value="other">{t("review.otherSources")}</option>
          </select>
        </label>

        <label className="rv-filter-field">
          <span>{t("common.language")}</span>
          <select
            className="game-tab-select"
            value={languageFilter}
            onChange={(event) => onLanguageFilterChange(event.target.value)}
          >
            <option value="all">{t("common.all")}</option>
            {STEAM_LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
        </label>

        <label className="rv-filter-field">
          <span>{t("review.playtime")}</span>
          <select
            className="game-tab-select"
            value={playtimePreset}
            onChange={(event) =>
              onPlaytimePresetChange(event.target.value as PlaytimePresetFilter)
            }
          >
            <option value="none">{t("review.noMinimum")}</option>
            <option value="over_1h">{t("review.over1h")}</option>
            <option value="over_10h">{t("review.over10h")}</option>
            <option value="custom">{t("review.customOption")}</option>
          </select>
        </label>

        {playtimePreset === "custom" && (
          <div className="rv-filter-range">
            <input
              type="number"
              min={0}
              max={500}
              className="rv-filter-input"
              value={playtimeMinHours}
              onChange={(event) =>
                onPlaytimeMinHoursChange(
                  Math.max(0, Math.min(500, Number(event.target.value) || 0)),
                )
              }
              placeholder={t("review.minHours")}
              aria-label={t("review.minHours")}
            />
            <span>–</span>
            <input
              type="number"
              min={0}
              max={500}
              className="rv-filter-input"
              value={playtimeMaxHours}
              onChange={(event) =>
                onPlaytimeMaxHoursChange(
                  Math.max(0, Math.min(500, Number(event.target.value) || 0)),
                )
              }
              placeholder={t("review.maxHours")}
              aria-label={t("review.maxHours")}
            />
            <span>{t("review.hoursShort")}</span>
          </div>
        )}

        {showDeckVerified && (
          <label className="rv-filter-field">
            <span>{t("review.device")}</span>
            <select
              className="game-tab-select"
              value={playtimeDevice}
              onChange={(event) =>
                onPlaytimeDeviceChange(event.target.value as PlaytimeDeviceFilter)
              }
            >
              <option value="all">{t("review.allDevices")}</option>
              <option value="deck">{t("review.steamDeck")}</option>
            </select>
          </label>
        )}

        <label className="rv-filter-check">
          <input
            type="checkbox"
            checked={useHelpfulSystem}
            onChange={(event) => onUseHelpfulSystemChange(event.target.checked)}
          />
          <span>{t("review.helpfulnessSystem")}</span>
        </label>
      </div>

      <footer className="rv-filter-popover__foot">
        <Button
          variant="ghost"
          size="sm"
          leftIcon={<RotateCcw size={13} />}
          onClick={onReset}
        >
          {t("review.resetFilters")}
        </Button>
        <Button variant="primary" size="sm" onClick={onClose}>
          {t("common.done")}
        </Button>
      </footer>
    </div>
  );
}
