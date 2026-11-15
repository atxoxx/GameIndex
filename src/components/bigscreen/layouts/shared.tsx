// Shared primitives for the five Big Screen interface layouts.
//
// Every layout composes its own pages, but they all speak the same
// vocabulary: a game tile that registers with the spatial-navigation
// engine, a horizontal shelf, and a selection panel that keeps the
// focused game's title + description on screen. Layout identity lives
// in CSS (`[data-layout]` on the shell root plus `data-tile` on the
// tile), not in five copies of the card logic.

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Game } from "../../../types/game";
import { gameDisplayName } from "../../../types/game";
import { useFocusable } from "../../../hooks/useFocusable";
import { useGameCardArt } from "../../../hooks/useGameCardArt";
import { useRunningIds } from "../../../context/GameContext";
import { useLanguage } from "../../../context/LanguageContext";
import { ArtworkImage } from "../../ui/ArtworkImage";
import { parseFocusGameKey } from "../../../utils/focusMemory";
import { extractYear } from "../bigscreenFormat";

export type TileVariant = "wide" | "poster" | "square" | "compact";

export interface GameTileProps {
  game: Game;
  onSelect: (game: Game) => void;
  variant?: TileVariant;
  /** Marks the page's entry point for the shell's route-focus pass. */
  autoFocus?: boolean;
  /** Hide the platform/playtime line (Switch grid is intentionally bare). */
  minimal?: boolean;
  /** Index inside its grid, used for a staggered entrance. */
  index?: number;
}

/**
 * The one game card every layout renders. Composition differs through
 * `data-tile` + the layout's stylesheet; behaviour (focus registration,
 * animated art, running badge, artwork fallbacks) is identical.
 */
export function GameTile({
  game,
  onSelect,
  variant = "wide",
  autoFocus = false,
  minimal = false,
  index = 0,
}: GameTileProps) {
  const runningIds = useRunningIds();
  const { t } = useLanguage();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const isRunning = runningIds.includes(game.id);

  const focusable = useFocusable(() => onSelect(game));
  const { staticPosterUrl, displayUrl, animatedPosterUrl, handleError } =
    useGameCardArt({
      game,
      isHovered: hovered,
      isFocused: focused,
    });

  const isActive = hovered || focused;
  const releaseYear = extractYear(game.releaseDate);
  const art = staticPosterUrl || displayUrl;

  return (
    <div
      className="bst-tile"
      data-tile={variant}
      data-running={isRunning ? "true" : undefined}
      data-active={isActive ? "true" : undefined}
      data-game-id={game.id}
      data-bs-autofocus={autoFocus ? "true" : undefined}
      style={index ? { ["--bst-index" as string]: index } : undefined}
      {...focusable}
      role="link"
      aria-label={gameDisplayName(game)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <div className="bst-tile-art">
        {art ? (
          <ArtworkImage
            src={art}
            alt={gameDisplayName(game)}
            onError={handleError}
            className="bst-tile-art-static"
          />
        ) : (
          <span className="bst-tile-art-fallback" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m8 12 3 3 5-6" />
            </svg>
          </span>
        )}
        {animatedPosterUrl && isActive ? (
          <img
            src={animatedPosterUrl}
            alt=""
            aria-hidden="true"
            decoding="async"
            className="bst-tile-art-animated"
            onError={handleError}
          />
        ) : null}
        <span className="bst-tile-scrim" aria-hidden="true" />
        {isRunning ? (
          <span className="bst-tile-running" title={t("game.running")}>
            <span aria-hidden="true" />
            {t("game.running")}
          </span>
        ) : null}
        <div className="bst-tile-copy">
          <h3 className="bst-tile-title" title={gameDisplayName(game)}>
            {gameDisplayName(game)}
          </h3>
          {minimal ? null : (
            <p className="bst-tile-sub">
              {game.platform}
              {game.playTime ? ` · ${game.playTime}` : ""}
              {!game.playTime && releaseYear ? ` · ${releaseYear}` : ""}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export interface GameShelfProps {
  title: string;
  games: Game[];
  onSelect: (game: Game) => void;
  railId: string;
  variant?: TileVariant;
  subtitle?: string;
  /** Glyph or icon rendered before the title. */
  eyebrow?: ReactNode;
  /** Marks the first tile as the page entry point. */
  autoFocusFirst?: boolean;
  /** Grid-like wrap instead of a horizontal rail (Switch home). */
  wrap?: boolean;
  className?: string;
}

/**
 * A titled horizontal shelf. The track declares `[data-rail-id]`, which
 * is what the spatial engine uses for wrapping and focus memory, and
 * horizontal moves stay inside it instead of drifting into a
 * neighbouring row.
 */
export function GameShelf({
  title,
  games,
  onSelect,
  railId,
  variant = "wide",
  subtitle,
  eyebrow,
  autoFocusFirst = false,
  wrap = false,
  className,
}: GameShelfProps) {
  const { t } = useLanguage();
  const trackRef = useRef<HTMLDivElement | null>(null);

  // Route-return focus: the shell remembers the card the user left and
  // fires this event when the page remounts.
  useEffect(() => {
    const onFocusGame = (event: Event) => {
      const parsed = parseFocusGameKey(
        `game:${(event as CustomEvent<string>).detail}`,
      );
      if (!parsed) return;
      if (parsed.railId && parsed.railId !== railId) return;
      const el = trackRef.current?.querySelector<HTMLElement>(
        `[data-game-id="${CSS.escape(parsed.gameId)}"]`,
      );
      el?.focus({ preventScroll: true });
    };
    window.addEventListener("bigscreen:focus-game", onFocusGame);
    return () => window.removeEventListener("bigscreen:focus-game", onFocusGame);
  }, [railId]);

  if (games.length === 0) return null;

  return (
    <section
      className={`bst-shelf${className ? ` ${className}` : ""}`}
      aria-label={title}
      data-rail-id={wrap ? undefined : railId}
    >
      <header className="bst-shelf-head">
        {eyebrow ? (
          <span className="bst-shelf-eyebrow" aria-hidden="true">
            {eyebrow}
          </span>
        ) : null}
        <h2 className="bst-shelf-title">{title}</h2>
        {subtitle ? <p className="bst-shelf-sub">{subtitle}</p> : null}
        <span className="bst-shelf-count">{games.length}</span>
      </header>
      <div
        className="bst-shelf-track"
        data-rail-id={railId}
        data-wrap={wrap ? "true" : undefined}
        ref={trackRef}
      >
        {games.map((game, index) => (
          <GameTile
            key={game.id}
            game={game}
            variant={variant}
            onSelect={onSelect}
            autoFocus={autoFocusFirst && index === 0}
            index={index}
          />
        ))}
      </div>
      {games.length === 0 ? (
        <p className="bst-shelf-empty">{t("bigscreen.rail.empty")}</p>
      ) : null}
    </section>
  );
}

/** Read the game a shelf card represents from a focus event target. */
export function gameIdFromTarget(target: Element | null): string | null {
  return target?.closest<HTMLElement>("[data-game-id]")?.dataset.gameId ?? null;
}
