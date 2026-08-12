import { useRef, useState } from "react";
import useSteamPlayerCount from "../hooks/useSteamPlayerCount";
import PlayerCountPopover from "./PlayerCountPopover";
import { formatCompactPlayerCount } from "./SteamPlayerCount";
import { useLanguage } from "../context/LanguageContext";

/**
 * PlayerCountBadge
 * ────────────────
 * "X playing" glass pill showing the live Steam player count
 * (`get_steam_player_count`). Supersedes the side-by-side
 * `<SteamPlayerCount>` + `<HydraPlayerCount>` pair on every banner.
 * (Hydra integration is disabled pending approval; re-enable by
 * restoring the hydra hook + popover props.)
 *
 * Visuals: the familiar pill with one pulsing green dot for Steam.
 *
 * Click-to-expand
 * ───────────────
 * Opens `<PlayerCountPopover>`, a card with a Steam tab (live count,
 * review breakdown, 24h activity sparkline, store link).
 *
 * Behavior:
 *  - Polls every 60s + refetches on window focus (owned by the hook,
 *    in lockstep with the Rust-side cache TTLs).
 *  - Renders nothing silently when appId is missing or Steam reports
 *    zero/no players — a "0 playing" badge is noise.
 */
export interface PlayerCountBadgeProps {
  /** Steam appid (Hydra keys its catalog on Steam appids too). When
   *  undefined the badge is hidden. */
  appId?: number;
  /** Extra className merged onto the root pill element for per-banner
   *  positioning (e.g. "hero-player-count" for absolute top-right). */
  className?: string;
}

export default function PlayerCountBadge({
  appId,
  className = "",
}: PlayerCountBadgeProps) {
  const steamCount = useSteamPlayerCount(appId);
  const { t } = useLanguage();

  // Open on click only (per product decision). The popover closes via
  // its own click-outside / Escape / X handlers.
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Anchor + click-outside exclusion for the popover, same contract
  // as the original Steam badge (see SteamPlayerCount.tsx).
  const badgeRef = useRef<HTMLDivElement>(null);

  const steam = steamCount ?? 0;
  const total = steam;

  if (!appId || total <= 0) return null;

  const breakdown = [
    steam > 0 ? t("steamPlayer.onSteam", { count: steam.toLocaleString() }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const title = t("steamPlayer.badgeTitle", {
    count: total.toLocaleString(),
    breakdown,
  });

  return (
    <>
      <div
        ref={badgeRef}
        className={`steam-player-count steam-player-count--clickable ${className}`.trim()}
        title={title}
        role="button"
        tabIndex={0}
        aria-label={t("steamPlayer.badgeAria", {
          count: total.toLocaleString(),
          breakdown,
        })}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        onClick={() => setPopoverOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setPopoverOpen((o) => !o);
          }
        }}
        data-count={total}
      >
        {/* Green Steam dot — the pill self-documents its source. */}
        {steam > 0 && (
          <span className="steam-player-count-dot" aria-hidden="true" />
        )}
        <span
          className="steam-player-count-text"
          aria-live="polite"
          aria-atomic="true"
        >
          {formatCompactPlayerCount(total)}
          <span className="steam-player-count-suffix"> {t("steamPlayer.playingSuffix")}</span>
        </span>
      </div>
      {popoverOpen && (
        <PlayerCountPopover
          appId={appId}
          anchorRef={badgeRef}
          steamCount={steam}
          onClose={() => setPopoverOpen(false)}
        />
      )}
    </>
  );
}
