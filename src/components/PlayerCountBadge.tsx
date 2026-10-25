import { useState } from "react";
import { ChevronRight } from "lucide-react";
import useSteamPlayerCount from "../hooks/useSteamPlayerCount";
import PlayerCountModal from "./PlayerCountModal";
import { useLanguage } from "../context/LanguageContext";
import { formatCompactPlayerCount } from "../utils/playerCount";

/**
 * PlayerCountBadge
 * ────────────────
 * "X playing" pill showing the live Steam concurrent-player count
 * (`get_steam_player_count`). One component for every surface — the Game
 * hero, Store hero, Home spotlight, Library rail and Activity sessions all
 * share this trigger and the same `PlayerCountModal`.
 *
 * Interaction
 * ───────────
 *  - Click, Enter or Space opens the floating modal with Overview /
 *    Activity tabs (`aria-haspopup="dialog"`).
 *  - `interactive={false}` renders a static reading for Big Picture, where
 *    pointer overlays are not part of the controller flow.
 *  - The count polls every 60s and refetches on window focus via the shared
 *    `useSteamPlayerCount` store, so every badge for an appid stays in sync.
 *  - Renders nothing when the appid is missing, Steam reports zero players,
 *    or the fetch fails — a "0 playing" pill is noise.
 */

export interface PlayerCountBadgeProps {
  /** Steam appid. When undefined the badge is hidden. */
  appId?: number;
  /** Extra className merged onto the root pill element for per-surface
   *  positioning (e.g. "hero-player-count" for absolute top-right). */
  className?: string;
  /** Local game title, shown immediately in the modal header. */
  gameName?: string;
  /** Static reading for Big Picture; defaults to the interactive modal. */
  interactive?: boolean;
}

export default function PlayerCountBadge({
  appId,
  className = "",
  gameName,
  interactive = true,
}: PlayerCountBadgeProps) {
  const count = useSteamPlayerCount(appId);
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);

  if (!appId || count === null || count <= 0) return null;

  const formatted = count.toLocaleString(language);
  const toggle = () => setOpen((current) => !current);

  return (
    <>
      <div
        className={[
          "steam-player-count",
          interactive ? "steam-player-count--clickable" : "steam-player-count--static",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        title={
          interactive
            ? t("steamPlayer.badgeTitle", {
                count: formatted,
                breakdown: t("steamPlayer.onSteam", { count: formatted }),
              })
            : t("steamPlayer.staticBadgeTitle", { count: formatted })
        }
        role={interactive ? "button" : "img"}
        tabIndex={interactive ? 0 : undefined}
        aria-label={
          interactive
            ? t("steamPlayer.badgeAria", {
                count: formatted,
                breakdown: t("steamPlayer.onSteam", { count: formatted }),
              })
            : t("steamPlayer.staticBadgeTitle", { count: formatted })
        }
        aria-haspopup={interactive ? "dialog" : undefined}
        aria-expanded={interactive ? open : undefined}
        onClick={
          interactive
            ? (event) => {
                event.stopPropagation();
                toggle();
              }
            : undefined
        }
        onKeyDown={
          interactive
            ? (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  event.stopPropagation();
                  toggle();
                }
              }
            : undefined
        }
        data-count={count}
      >
        <span className="steam-player-count-dot" aria-hidden="true" />
        <span
          className="steam-player-count-text"
          aria-live="polite"
          aria-atomic="true"
        >
          {formatCompactPlayerCount(count)}
          <span className="steam-player-count-suffix">
            {" "}
            {t("steamPlayer.playingSuffix")}
          </span>
        </span>
        {interactive && (
          <ChevronRight
            size={12}
            className="steam-player-count-chevron"
            aria-hidden="true"
          />
        )}
      </div>

      {interactive && open && (
        <PlayerCountModal
          appId={appId}
          gameName={gameName}
          currentCount={count}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
