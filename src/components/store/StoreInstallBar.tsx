import { useCallback } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { formatBytesPerSecond } from "../../types/download";
import type { StoreInstall } from "../../types/storeInstalls";
import {
  formatEtaLabel,
  storeInstallDetail,
  storeInstallHeadline,
  storeInstallPercent,
} from "./storeInstallText";
import "../../styles/store-installs.css";

interface StoreInstallBarProps {
  entry: StoreInstall;
  /**
   * `overlay` pins the bar to the bottom of a cover image; `inline` sits in
   * the flow for list rows, where there is no room to overlay anything.
   */
  variant?: "overlay" | "inline";
  /** The game is already installed, so this transfer is an update. */
  updating?: boolean;
}

/**
 * A store transfer drawn as a thin bar with a one-line caption. Purely
 * informational: it never intercepts a click, because on a card the whole
 * surface already navigates to the game.
 */
export default function StoreInstallBar({
  entry,
  variant = "overlay",
  updating = false,
}: StoreInstallBarProps) {
  const { t, language } = useLanguage();
  const { unit } = useSizeUnit();
  const percent = storeInstallPercent(entry);

  const formatSpeed = useCallback(
    (bytesPerSecond: number) => formatBytesPerSecond(bytesPerSecond, unit, language),
    [unit, language],
  );
  const formatEtaSeconds = useCallback((seconds: number) => formatEtaLabel(seconds, t), [t]);

  const headline = storeInstallHeadline(entry, t, updating);
  const detail = storeInstallDetail(entry, formatSpeed, formatEtaSeconds);
  const indeterminate = percent == null;

  return (
    <div
      className={`store-install-bar store-install-bar--${variant} is-${entry.state}${indeterminate ? " is-indeterminate" : ""}`}
      role="progressbar"
      aria-label={headline}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : percent}
      aria-valuetext={headline}
    >
      <div className="store-install-track">
        <div
          className="store-install-fill"
          style={indeterminate ? undefined : { width: `${percent}%` }}
        />
      </div>
      <span className="store-install-caption">
        {headline}
        {detail ? <span className="store-install-caption-detail"> · {detail}</span> : null}
      </span>
    </div>
  );
}
