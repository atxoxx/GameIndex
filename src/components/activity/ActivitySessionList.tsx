import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  ChevronRight,
  Clock3,
  ExternalLink,
  Link2,
  MoreHorizontal,
  Play,
  Plus,
  Rows3,
  Rows4,
  Search,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { useLanguage } from "../../context/LanguageContext";
import { useSessionNotes } from "../../context/SessionNotesContext";
import type { Game, GameSession } from "../../types/game";
import { formatPlayTime, gameDisplayName } from "../../types/game";
import type { TempUnit } from "../../context/SettingsContext";
import { formatTemp } from "../../utils/temp";
import {
  activeFilterChips,
  countActiveSessionFilters,
  filterSessions,
  sortSessions,
  type ActivitySessionFilters,
  type SessionSortField,
} from "../../utils/activity/sessionQuery";import {
  formatSessionClockRange,
  formatSessionDay,
  groupSessionsByDay,
  sessionDayKey,
} from "../../utils/activity/sessionTime";
import { Button } from "../ui";
import { Popover } from "../ui/Popover";
import { GameThumbnail } from "./GameThumbnail";
import { ActivitySessionFilterMenu } from "./ActivitySessionFilterMenu";
import * as Icons from "./Icons";

export interface ActivitySessionListProps {
  sessions: GameSession[];
  games: Game[];
  filters: ActivitySessionFilters;
  onFiltersChange: (patch: Partial<ActivitySessionFilters>) => void;
  onInspect: (session: GameSession) => void;
  onDelete: (session: GameSession) => void;
  onRequestLink?: (gameId: string, name: string) => void;
  onRequestAdd?: (gameId: string, name: string) => void;
  onLaunchGame?: (game: Game) => void;
  onOpenGame?: (gameId: string) => void;
  selectable?: boolean;
  variant?: "library" | "game";
  emptyTitle: string;
  emptyHint?: string;
  emptyAction?: ReactNode;
  rangeLabel?: string;
  tempUnit?: TempUnit;
  goal?: { percent: number; minutes: number; target: number };
  onCompare?: (a: GameSession, b: GameSession) => void;
  onBatchDelete?: (sessions: GameSession[]) => void;
  onExportSelected?: (sessions: GameSession[], format: "csv" | "json") => void;
}

const SORT_KEYS: Record<SessionSortField, string> = {
  date: "activitySessions.sortDate",
  duration: "activitySessions.sortDuration",
  fps: "activitySessions.sortFps",
  gpuTemp: "activitySessions.sortGpuTemp",
};

/**
 * One session list for the library page and the per-game tab. The toolbar
 * stays calm (search, filters, sort, density); detail lives in the drawer.
 */
export function ActivitySessionList({
  sessions,
  games,
  filters,
  onFiltersChange,
  onInspect,
  onDelete,
  onRequestLink,
  onRequestAdd,
  onLaunchGame,
  onOpenGame,
  selectable = false,
  variant = "library",
  emptyTitle,
  emptyHint,
  emptyAction,
  rangeLabel,
  tempUnit = "c",
  goal,
  onCompare,
  onBatchDelete,
  onExportSelected,
}: ActivitySessionListProps) {
  const { t, language } = useLanguage();
  const { getAllNotes } = useSessionNotes();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [visibleLimit, setVisibleLimit] = useState(60);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const gameById = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);
  const notes = useMemo(() => getAllNotes(), [getAllNotes]);

  const filtered = useMemo(
    () => filterSessions(sessions, { query, filters, notes }),
    [sessions, query, filters, notes],
  );
  const sorted = useMemo(() => sortSessions(filtered, filters), [filtered, filters]);

  // Day headers must total the whole filtered day, not just the rows inside
  // the current render window.
  const dayTotals = useMemo(() => {
    const totals = new Map<string, { count: number; minutes: number }>();
    for (const session of filtered) {
      const key = sessionDayKey(session);
      const current = totals.get(key) ?? { count: 0, minutes: 0 };
      current.count += 1;
      current.minutes += session.durationMin;
      totals.set(key, current);
    }
    return totals;
  }, [filtered]);

  useEffect(() => {
    setVisibleLimit(60);
  }, [sorted]);

  useEffect(() => {
    const ids = new Set(filtered.map((session) => session.id));
    setSelected((previous) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of previous) {
        if (ids.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : previous;
    });
  }, [filtered]);

  const visible = useMemo(() => sorted.slice(0, visibleLimit), [sorted, visibleLimit]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleLimit((previous) => previous + 120);
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visibleLimit]);

  const selectedSessions = useMemo(
    () => sessions.filter((session) => selected.has(session.id)),
    [sessions, selected],
  );

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((session) => session.id)));
  };

  const activeFilters = countActiveSessionFilters(filters);
  const chips = activeFilterChips(filters);

  const groups = useMemo(() => {
    if (filters.sort !== "date") return null;
    return groupSessionsByDay(visible);
  }, [filters.sort, visible]);

  const rows = (items: GameSession[]) =>
    items.map((session) => (
      <ActivitySessionRow
        key={session.id}
        session={session}
        game={gameById.get(session.gameId)}
        note={notes[session.id]}
        tempUnit={tempUnit}
        variant={variant}
        selectable={selectable}
        selected={selected.has(session.id)}
        onToggle={() => toggle(session.id)}
        onInspect={() => onInspect(session)}
        onDelete={() => onDelete(session)}
        onLaunchGame={onLaunchGame}
        onOpenGame={onOpenGame}
        onRequestLink={onRequestLink}
        onRequestAdd={onRequestAdd}
      />
    ));

  return (
    <div className="activity-session-panel">
      <div className="activity-session-toolbar">
        <label className="activity-session-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("activityWs.sessions.searchPlaceholder")}
            aria-label={t("activityWs.sessions.searchPlaceholder")}
          />
          {query && (
            <button
              type="button"
              className="activity-session-search__clear"
              onClick={() => setQuery("")}
              aria-label={t("activityWs.sessions.clearSearch")}
            >
              <X size={13} />
            </button>
          )}
        </label>

        <div className="activity-session-toolbar__controls">
          <ActivitySessionFilterMenu filters={filters} onChange={onFiltersChange} />

          <label className="activity-session-sort">
            <span>{t("activitySessions.sortBy")}</span>
            <select
              value={filters.sort}
              onChange={(event) =>
                onFiltersChange({ sort: event.target.value as SessionSortField })
              }
              aria-label={t("activitySessions.sortBy")}
            >
              {(Object.keys(SORT_KEYS) as SessionSortField[]).map((key) => (
                <option key={key} value={key}>
                  {t(SORT_KEYS[key])}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className="activity-session-sort-dir"
            onClick={() =>
              onFiltersChange({ dir: filters.dir === "asc" ? "desc" : "asc" })
            }
            title={filters.dir === "asc" ? t("activitySessions.ascending") : t("activitySessions.descending")}
            aria-label={filters.dir === "asc" ? t("activitySessions.ascending") : t("activitySessions.descending")}
          >
            {filters.dir === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          </button>

          <div className="activity-session-density" role="group" aria-label={t("activityWs.sessions.density")}>
            <button
              type="button"
              className={filters.density === "comfortable" ? "is-active" : ""}
              aria-pressed={filters.density === "comfortable"}
              aria-label={t("activityWs.sessions.comfortable")}
              title={t("activityWs.sessions.comfortable")}
              onClick={() => onFiltersChange({ density: "comfortable" })}
            >
              <Rows3 size={14} />
            </button>
            <button
              type="button"
              className={filters.density === "compact" ? "is-active" : ""}
              aria-pressed={filters.density === "compact"}
              aria-label={t("activityWs.sessions.compact")}
              title={t("activityWs.sessions.compact")}
              onClick={() => onFiltersChange({ density: "compact" })}
            >
              <Rows4 size={14} />
            </button>
          </div>
        </div>
      </div>

      {(chips.length > 0 || (goal && goal.target > 0)) && (
        <div className="activity-session-subbar">
          {chips.length > 0 && (
            <div className="activity-session-subbar__chips">
              {chips.map((chip) => (
                <span key={chip.key} className="activity-session-filters__chip">
                  {t(chip.labelKey)}
                  <button
                    type="button"
                    className="activity-session-filters__chip-remove"
                    aria-label={t("activityWs.sessions.clearFilters")}
                    onClick={() =>
                      onFiltersChange(
                        chip.key === "telemetry" ? { telemetry: "all" } : { duration: "all" },
                      )
                    }
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <button
                type="button"
                className="activity-session-subbar__clear"
                onClick={() =>
                  onFiltersChange({ telemetry: "all", duration: "all", sort: "date", dir: "desc" })
                }
              >
                {t("activityWs.sessions.clearFilters")}
              </button>
            </div>
          )}

          {goal && goal.target > 0 && (
            <div
              className="activity-session-goal"
              title={t("activityWs.goal.progress", {
                minutes: formatPlayTime(goal.minutes),
                target: formatPlayTime(goal.target),
              })}
            >
              <span className="activity-session-goal__label">{t("activityWs.goal.week")}</span>
              <span className="activity-session-goal__track" aria-hidden="true">
                <span
                  className="activity-session-goal__fill"
                  style={{ width: `${goal.percent}%` }}
                />
              </span>
              <span className="activity-session-goal__value">
                {formatPlayTime(goal.minutes)} / {formatPlayTime(goal.target)}
              </span>
            </div>
          )}
        </div>
      )}

      {selectable && selected.size > 0 && (
        <div className="activity-session-batch" role="region" aria-label={t("activitySessions.selectedCount", { count: selected.size })}>
          <span className="activity-session-batch__count">
            {t("activitySessions.selectedCount", { count: selected.size })}
          </span>
          <div className="activity-session-batch__actions">
            {selected.size === 2 && onCompare && (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Icons.ArrowRightLeft size={13} />}
                onClick={() => onCompare(selectedSessions[0], selectedSessions[1])}
              >
                {t("activityCompare.compareBtn")}
              </Button>
            )}
            {onExportSelected && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Icons.Download size={13} />}
                  onClick={() => onExportSelected(selectedSessions, "csv")}
                >
                  CSV
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<Icons.FileText size={13} />}
                  onClick={() => onExportSelected(selectedSessions, "json")}
                >
                  JSON
                </Button>
              </>
            )}
            {onBatchDelete && (
              <Button
                variant="danger"
                size="sm"
                leftIcon={<Trash2 size={13} />}
                onClick={() => onBatchDelete(selectedSessions)}
              >
                {t("activitySessions.deleteSelected")}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="activity-session-empty">
          <span className="activity-session-empty__icon" aria-hidden="true">
            <Clock3 size={22} />
          </span>
          <h3 className="activity-session-empty__title">
            {sessions.length === 0 ? emptyTitle : t("activityWs.sessions.noMatchesTitle")}
          </h3>
          <p className="activity-session-empty__hint">
            {sessions.length === 0 ? emptyHint : t("activityWs.sessions.noMatchesHint")}
          </p>
          <div className="activity-session-empty__actions">
            {sessions.length === 0
              ? emptyAction
              : activeFilters > 0 || query ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setQuery("");
                      onFiltersChange({ telemetry: "all", duration: "all" });
                    }}
                  >
                    {t("activityWs.sessions.clearFilters")}
                  </Button>
                ) : null}
          </div>
        </div>
      ) : (
        <div className={`activity-session-list${filters.density === "compact" ? " is-compact" : ""}`}>
          <div className="activity-session-list__head">
            {selectable ? (
              <button
                type="button"
                className="activity-session-list__select-all"
                onClick={toggleAll}
                aria-pressed={selected.size === filtered.length && filtered.length > 0}
              >
                {selected.size === filtered.length && filtered.length > 0 ? (
                  <CheckSquare size={14} />
                ) : (
                  <Square size={14} />
                )}
                <span>{t("activitySessions.selectAll")}</span>
              </button>
            ) : (
              <span className="activity-session-list__title">
                {t("activityWs.sessions.summary", {
                  count: filtered.length,
                  time: formatPlayTime(filtered.reduce((sum, session) => sum + session.durationMin, 0)),
                })}
              </span>
            )}
            <span className="activity-session-list__meta">
              {rangeLabel ??
                t("activitySessions.showingCount", {
                  count: Math.min(filtered.length, visibleLimit),
                  total: sessions.length,
                })}
            </span>
          </div>

          {groups
            ? groups.map((group) => (
                <div key={group.day} className="activity-session-day">
                  <div className="activity-session-day__head">
                    <span className="activity-session-day__label">
                      {new Date(`${group.day}T12:00:00`).toLocaleDateString(language, {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })}
                    </span>
                    <span className="activity-session-day__meta">
                      {dayTotals.get(group.day)?.count ?? group.sessions.length} ·{" "}
                      {formatPlayTime(dayTotals.get(group.day)?.minutes ?? group.minutes)}
                    </span>
                    <span className="activity-session-day__line" aria-hidden="true" />
                  </div>
                  {rows(group.sessions)}
                </div>
              ))
            : rows(visible)}

          {filtered.length > visibleLimit && (
            <div ref={sentinelRef} className="activity-session-list__sentinel" aria-hidden="true" />
          )}
        </div>
      )}
    </div>
  );
}

interface ActivitySessionRowProps {
  session: GameSession;
  game: Game | undefined;
  note: { note: string; tags: string[] } | undefined;
  tempUnit: TempUnit;
  variant: "library" | "game";
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  onInspect: () => void;
  onDelete: () => void;
  onLaunchGame?: (game: Game) => void;
  onOpenGame?: (gameId: string) => void;
  onRequestLink?: (gameId: string, name: string) => void;
  onRequestAdd?: (gameId: string, name: string) => void;
}

function ActivitySessionRow({
  session,
  game,
  note,
  tempUnit,
  variant,
  selectable,
  selected,
  onToggle,
  onInspect,
  onDelete,
  onLaunchGame,
  onOpenGame,
  onRequestLink,
  onRequestAdd,
}: ActivitySessionRowProps) {
  const { t, language } = useLanguage();
  const title = game ? gameDisplayName(game) : session.gameName;
  const dateLabel = formatSessionDay(
    session,
    language,
    variant === "game"
      ? { weekday: "short", day: "numeric", month: "short" }
      : { weekday: "short", day: "numeric", month: "short", year: "numeric" },
  );
  const timeLabel = formatSessionClockRange(session, language);
  const metrics = session.metrics;
  const hasNote = Boolean(note?.note || (note?.tags.length ?? 0) > 0);

  return (
    <div
      className={[
        "activity-session-row",
        selected ? "is-selected" : "",
        variant === "game" ? "activity-session-row--game" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {selectable && (
        <button
          type="button"
          className="activity-session-row__check"
          aria-pressed={selected}
          aria-label={t("activityWs.sessions.selectSession")}
          onClick={onToggle}
        >
          {selected ? <CheckSquare size={15} /> : <Square size={15} />}
        </button>
      )}

      <button
        type="button"
        className="activity-session-row__body"
        aria-label={`${title}, ${dateLabel} ${timeLabel}, ${formatPlayTime(session.durationMin)}`}
        onClick={onInspect}
      >
        <span className="activity-session-row__thumb">
          {variant === "game" ? (
            <Clock3 size={16} aria-hidden="true" />
          ) : (
            <GameThumbnail
              iconUrl={game?.iconUrl}
              coverArtUrl={game?.coverArtUrl}
              steamAppId={game?.steamAppId}
              name={title}
              className="activity-session-row__cover"
            />
          )}
        </span>

        <span className="activity-session-row__main">
          <span className="activity-session-row__title">
            {variant === "game" ? dateLabel : title}
          </span>
          <span className="activity-session-row__sub">
            {variant === "game" ? timeLabel : `${dateLabel} · ${timeLabel}`}
          </span>
        </span>

        <span className="activity-session-row__pills">
          {metrics?.avgFps ? (
            <span className="activity-session-pill is-fps">
              {Math.round(metrics.avgFps)} FPS
            </span>
          ) : null}
          {metrics?.avgGpuTemp ? (
            <span className="activity-session-pill">
              {formatTemp(metrics.avgGpuTemp, tempUnit)}
            </span>
          ) : null}
          {metrics?.resolution ? (
            <span className="activity-session-pill is-muted">{metrics.resolution}</span>
          ) : null}
          {hasNote ? (
            <span className="activity-session-pill is-note" title={note?.note || undefined}>
              <Icons.FileText size={10} />
              {note?.tags.length ? `${note.tags.length}` : t("activityGantt.note")}
            </span>
          ) : null}
        </span>

        <span className="activity-session-row__duration">
          {formatPlayTime(session.durationMin)}
        </span>
        <ChevronRight size={15} className="activity-session-row__chevron" aria-hidden="true" />
      </button>

      <Popover
        label={title}
        align="end"
        width={218}
        trigger={(props) => (
          <button
            {...props}
            type="button"
            className="activity-session-row__menu"
            aria-label={t("activityWs.sessions.rowActions")}
            onClick={(event) => {
              event.stopPropagation();
              props.onClick();
            }}
          >
            <MoreHorizontal size={15} />
          </button>
        )}
      >
        {(close) => (
          <>
            <button
              type="button"
              role="menuitem"
              className="ui-popover__item"
              onClick={() => {
                close();
                onInspect();
              }}
            >
              <span className="ui-popover__item-icon">
                <Clock3 size={15} />
              </span>
              <span className="ui-popover__item-label">
                {t("activitySessions.inspectSession")}
              </span>
            </button>
            {game ? (
              <>
                {onOpenGame && (
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
                      {t("activityWs.sessions.openGame")}
                    </span>
                  </button>
                )}
                {onLaunchGame && (
                  <button
                    type="button"
                    role="menuitem"
                    className="ui-popover__item"
                    onClick={() => {
                      close();
                      onLaunchGame(game);
                    }}
                  >
                    <span className="ui-popover__item-icon">
                      <Play size={15} />
                    </span>
                    <span className="ui-popover__item-label">{t("game.play")}</span>
                  </button>
                )}
              </>
            ) : (
              <>
                {onRequestLink && (
                  <button
                    type="button"
                    role="menuitem"
                    className="ui-popover__item"
                    onClick={() => {
                      close();
                      onRequestLink(session.gameId, session.gameName);
                    }}
                  >
                    <span className="ui-popover__item-icon">
                      <Link2 size={15} />
                    </span>
                    <span className="ui-popover__item-label">
                      {t("activityWs.rail.link")}
                    </span>
                  </button>
                )}
                {onRequestAdd && (
                  <button
                    type="button"
                    role="menuitem"
                    className="ui-popover__item"
                    onClick={() => {
                      close();
                      onRequestAdd(session.gameId, session.gameName);
                    }}
                  >
                    <span className="ui-popover__item-icon">
                      <Plus size={15} />
                    </span>
                    <span className="ui-popover__item-label">
                      {t("activityWs.rail.add")}
                    </span>
                  </button>
                )}
              </>
            )}
            <div className="ui-popover__separator" role="separator" />
            <button
              type="button"
              role="menuitem"
              className="ui-popover__item ui-popover__item--danger"
              onClick={() => {
                close();
                onDelete();
              }}
            >
              <span className="ui-popover__item-icon">
                <Trash2 size={15} />
              </span>
              <span className="ui-popover__item-label">{t("activitySessions.delete")}</span>
            </button>
          </>
        )}
      </Popover>
    </div>
  );
}

export default ActivitySessionList;
