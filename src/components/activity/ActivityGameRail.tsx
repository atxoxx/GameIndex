import { useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  LayoutGrid,
  Link2,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { formatPlayTime } from "../../types/game";
import type { ActivityGameSummary } from "../../utils/activity/scoping";
import { Popover } from "../ui/Popover";
import { GameThumbnail } from "./GameThumbnail";

export interface ActivityGameRailProps {
  games: ActivityGameSummary[];
  selectedGameId: string | null;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelect: (gameId: string | null) => void;
  onOpenGame: (gameId: string) => void;
  onLaunchGame: (gameId: string) => void;
  onRequestDelete: (gameId: string, name: string) => void;
  onRequestLink: (gameId: string, name: string) => void;
  onRequestAdd: (gameId: string, name: string) => void;
}

/**
 * The library rail beside the playtime chart: a ranked, collapsible list of
 * every game played in the scope. Collapsed it becomes a strip of covers, so
 * the chart can take the full width without losing the game switch.
 */
export function ActivityGameRail({
  games,
  selectedGameId,
  collapsed,
  onToggleCollapsed,
  onSelect,
  onOpenGame,
  onLaunchGame,
  onRequestDelete,
  onRequestLink,
  onRequestAdd,
}: ActivityGameRailProps) {
  const { t } = useLanguage();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return games;
    return games.filter((game) => game.name.toLowerCase().includes(q));
  }, [games, query]);

  const maxMinutes = useMemo(
    () => games.reduce((max, game) => Math.max(max, game.minutes), 0) || 1,
    [games],
  );

  if (collapsed) {
    return (
      <aside className="activity-rail activity-rail--collapsed" aria-label={t("activityWs.rail.title")}>
        <button
          type="button"
          className={`activity-rail__cover-btn activity-rail__cover-btn--all${
            selectedGameId === null ? " is-active" : ""
          }`}
          title={t("activityWs.rail.allGames")}
          aria-label={t("activityWs.rail.allGames")}
          aria-pressed={selectedGameId === null}
          onClick={() => onSelect(null)}
        >
          <LayoutGrid size={15} />
        </button>
        <div className="activity-rail__covers">
          {games.map((game) => (
            <button
              key={game.id}
              type="button"
              className={`activity-rail__cover-btn${selectedGameId === game.id ? " is-active" : ""}`}
              title={`${game.name} · ${formatPlayTime(game.minutes)}`}
              aria-label={`${game.name} · ${formatPlayTime(game.minutes)}`}
              aria-pressed={selectedGameId === game.id}
              onClick={() => onSelect(game.id)}
            >
              <GameThumbnail
                iconUrl={game.iconUrl}
                coverArtUrl={game.coverArtUrl}
                steamAppId={game.steamAppId}
                name={game.name}
                className="activity-rail__cover"
              />
            </button>
          ))}
        </div>
        <button
          type="button"
          className="activity-rail__collapse"
          onClick={onToggleCollapsed}
          title={t("activityWs.rail.expand")}
          aria-label={t("activityWs.rail.expand")}
        >
          <ChevronRight size={15} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="activity-rail" aria-label={t("activityWs.rail.title")}>
      <div className="activity-rail__head">
        <div className="activity-rail__title">
          <LayoutGrid size={14} aria-hidden="true" />
          <span>{t("activityWs.rail.title")}</span>
          <span className="activity-rail__count">
            {t("activityWs.rail.played", { count: games.length })}
          </span>
        </div>
        <button
          type="button"
          className="activity-rail__collapse"
          onClick={onToggleCollapsed}
          title={t("activityWs.rail.collapse")}
          aria-label={t("activityWs.rail.collapse")}
        >
          <ChevronLeft size={15} />
        </button>
      </div>

      {games.length > 6 && (
        <label className="activity-rail__search">
          <Search size={13} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("activityWs.rail.search")}
            aria-label={t("activityWs.rail.search")}
          />
        </label>
      )}

      <div className="activity-rail__list">
        <button
          type="button"
          className={`activity-rail__row activity-rail__row--all${
            selectedGameId === null ? " is-active" : ""
          }`}
          aria-pressed={selectedGameId === null}
          onClick={() => onSelect(null)}
        >
          <span className="activity-rail__all-icon">
            <LayoutGrid size={15} />
          </span>
          <span className="activity-rail__info">
            <span className="activity-rail__name">{t("activityWs.rail.allGames")}</span>
            <span className="activity-rail__meta">
              {t("activityWs.rail.scopeHint")}
            </span>
          </span>
          <span className="activity-rail__minutes">{games.length}</span>
        </button>

        {filtered.map((game) => {
          const active = selectedGameId === game.id;
          const share = Math.max(2, Math.round((game.minutes / maxMinutes) * 100));
          return (
            <div key={game.id} className={`activity-rail__row-wrap${active ? " is-active" : ""}`}>
              <button
                type="button"
                className="activity-rail__row"
                aria-pressed={active}
                onClick={() => onSelect(active ? null : game.id)}
              >
                <span className="activity-rail__cover-box">
                  <GameThumbnail
                    iconUrl={game.iconUrl}
                    coverArtUrl={game.coverArtUrl}
                    steamAppId={game.steamAppId}
                    name={game.name}
                    className="activity-rail__cover"
                  />
                </span>
                <span className="activity-rail__info">
                  <span className="activity-rail__name">{game.name}</span>
                  <span className="activity-rail__bar" aria-hidden="true">
                    <span className="activity-rail__bar-fill" style={{ width: `${share}%` }} />
                  </span>
                </span>
                <span className="activity-rail__minutes">{formatPlayTime(game.minutes)}</span>
              </button>

              <Popover
                label={game.name}
                align="end"
                width={210}
                trigger={(props) => (
                  <button
                    {...props}
                    type="button"
                    className="activity-rail__menu"
                    aria-label={game.name}
                    title={game.name}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                )}
              >
                {(close) => (
                  <>
                    {game.linked ? (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          className="ui-popover__item"
                          onClick={() => {
                            close();
                            onOpenGame(game.id);
                          }}
                        >
                          <span className="ui-popover__item-icon">
                            <ExternalLink size={15} />
                          </span>
                          <span className="ui-popover__item-label">
                            {t("activityWs.rail.open")}
                          </span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="ui-popover__item"
                          onClick={() => {
                            close();
                            onLaunchGame(game.id);
                          }}
                        >
                          <span className="ui-popover__item-icon">
                            <Play size={15} />
                          </span>
                          <span className="ui-popover__item-label">{t("game.play")}</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          role="menuitem"
                          className="ui-popover__item"
                          onClick={() => {
                            close();
                            onRequestLink(game.id, game.name);
                          }}
                        >
                          <span className="ui-popover__item-icon">
                            <Link2 size={15} />
                          </span>
                          <span className="ui-popover__item-label">
                            {t("activityWs.rail.link")}
                          </span>
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="ui-popover__item"
                          onClick={() => {
                            close();
                            onRequestAdd(game.id, game.name);
                          }}
                        >
                          <span className="ui-popover__item-icon">
                            <Plus size={15} />
                          </span>
                          <span className="ui-popover__item-label">
                            {t("activityWs.rail.add")}
                          </span>
                        </button>
                      </>
                    )}
                    <div className="ui-popover__separator" role="separator" />
                    <button
                      type="button"
                      role="menuitem"
                      className="ui-popover__item ui-popover__item--danger"
                      onClick={() => {
                        close();
                        onRequestDelete(game.id, game.name);
                      }}
                    >
                      <span className="ui-popover__item-icon">
                        <Trash2 size={15} />
                      </span>
                      <span className="ui-popover__item-label">
                        {t("activityWs.rail.delete")}
                      </span>
                    </button>
                  </>
                )}
              </Popover>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <p className="activity-rail__empty">
            {games.length === 0
              ? t("activityWs.rail.noGames")
              : t("activityDash.noGames")}
          </p>
        )}
      </div>
    </aside>
  );
}

export default ActivityGameRail;
