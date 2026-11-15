import { useEffect, useRef, type ReactNode } from "react";
import { useLanguage } from "../../context/LanguageContext";
import BigScreenStoreGameCard from "./BigScreenStoreGameCard";
import type { StoreGameSummary } from "../../types/game";
import { parseFocusGameKey } from "../../utils/focusMemory";

interface BigScreenStoreRailProps {
  title: string;
  icon?: ReactNode;
  games: StoreGameSummary[];
  emptyLabel?: string;
  onCardClick: (game: StoreGameSummary) => void;
  /** Stable identifier used by the parent to track the focused rail. */
  railId?: string;
  /** Visually marks the rail containing the current controller focus. */
  isActive?: boolean;
  /** Drops the title/count row (see BigScreenRail); `title` still labels the section. */
  hideHeader?: boolean;
}

export default function BigScreenStoreRail({
  title,
  icon,
  games,
  emptyLabel,
  onCardClick,
  railId,
  isActive = false,
  hideHeader = false,
}: BigScreenStoreRailProps) {
  const { t } = useLanguage();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Shell restore: see BigScreenRail — the layout fires this event with
  // the remembered game id (and owning rail) and the rail re-focuses.
  // Scrolling is the gamepad engine's job (one scroll owner per
  // container), so this file has no focusedElement subscription.
  useEffect(() => {
    const onFocusGame = (event: Event) => {
      const parsed = parseFocusGameKey(
        `game:${(event as CustomEvent<string>).detail}`,
      );
      if (!parsed) return;
      if (parsed.railId && railId && parsed.railId !== railId) return;
      const card = scrollRef.current?.querySelector<HTMLElement>(
        `[data-game-id="${CSS.escape(parsed.gameId)}"]`,
      );
      card?.focus({ preventScroll: true });
    };
    window.addEventListener("bigscreen:focus-game", onFocusGame);
    return () => window.removeEventListener("bigscreen:focus-game", onFocusGame);
  }, [railId]);

  return (
    <section
      className={`bigscreen-rail${isActive ? " is-active" : ""}`}
      aria-label={title}
      data-rail-id={railId}
      data-active={isActive ? "true" : "false"}
    >
      {hideHeader ? null : (
        <div className="bigscreen-rail-header">
          {icon ? (
            <span className="bigscreen-rail-icon" aria-hidden>
              {icon}
            </span>
          ) : null}
          <h3 className="bigscreen-rail-title">{title}</h3>
          <span className="bigscreen-rail-count">
            {games.length > 0 ? `${games.length}` : ""}
          </span>
        </div>
      )}

      <div className="bigscreen-rail-viewport">
        {games.length === 0 ? (
          <div className="bigscreen-rail-empty" role="status">
            <span>{emptyLabel ?? t("bigscreen.store.railEmpty")}</span>
          </div>
        ) : (
          <>
            <div ref={scrollRef} className="bigscreen-rail-track" role="list">
              {games.map((game) => (
                <div key={game.id} role="listitem" className="bigscreen-rail-item">
                  <BigScreenStoreGameCard
                    game={game}
                    onClick={onCardClick}
                  />
                </div>
              ))}
            </div>
            <div
              className="bigscreen-rail-fade bigscreen-rail-fade--left"
              aria-hidden
            />
            <div
              className="bigscreen-rail-fade bigscreen-rail-fade--right"
              aria-hidden
            />
          </>
        )}
      </div>
    </section>
  );
}
