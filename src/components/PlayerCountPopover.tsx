import type { RefObject } from "react";
import { SteamStatsPopoverBody } from "./SteamPlayerCountPopover";
import SteamStatsPopoverShell from "./SteamStatsPopoverShell";
import { useLanguage } from "../context/LanguageContext";

interface PlayerCountPopoverProps {
  appId: number;
  anchorRef: RefObject<HTMLElement | null>;
  steamCount: number;
  onClose: () => void;
}

export default function PlayerCountPopover({ appId, anchorRef, steamCount, onClose }: PlayerCountPopoverProps) {
  const { t } = useLanguage();

  return (
    <SteamStatsPopoverShell anchorRef={anchorRef} onClose={onClose}>
      <header className="steam-stats-popover-header">
        <div className="steam-stats-popover-header-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className="steam-brand-icon">
            <path d="M12 2a10 10 0 0 0-10 10c0 4.7 3.25 8.65 7.66 9.7l2.84-4.14a2.98 2.98 0 0 1-.5-.06l-3.23-1.32a3.02 3.02 0 0 1-1.77-2.78c0-1.66 1.34-3 3-3 .76 0 1.45.28 1.99.75l3.24-1.32c.1-.8.5-1.5 1.12-2.02A4.5 4.5 0 0 1 21 12.5a4.5 4.5 0 0 1-4.5 4.5c-.75 0-1.46-.19-2.08-.52l-2.42 3.52c4.4-.38 7.84-4.08 7.84-8.6A10 10 0 0 0 12 2zm4.5 8a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />
          </svg>
        </div>
        <div className="steam-stats-popover-header-body">
          <div className="steam-stats-popover-header-title">{t("steamPlayer.steam")} · {t("steamPlayer.livePlayerStats")}</div>
          <div className="steam-stats-popover-header-subtitle">{t("steamPlayer.appId", { appId })}</div>
        </div>
        <button type="button" className="steam-stats-popover-close" onClick={onClose} aria-label={t("playerStats.closeAria")} title={t("common.close")}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>
      <SteamStatsPopoverBody appId={appId} currentCount={steamCount} />
    </SteamStatsPopoverShell>
  );
}
