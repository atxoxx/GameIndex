import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Button, Skeleton } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { usePersistedState } from "../../hooks/usePersistedState";
import type { SaveBackup, SaveLocation, SaveProgress } from "../../types/saves";
import { formatRelative } from "../../utils/savesTime";
import GameSavePane from "./GameSavePane";
import { ProtectionBadge } from "./SavesBadges";
import SavesCover from "./SavesCover";
import {
  filterTrackedGames,
  protectionLabelKey,
  type GameFilter,
  type GameSort,
  type SavesOverview,
  type TrackedSaveGame,
} from "./savesData";

interface GamesTabProps {
  overview: SavesOverview;
  loading: boolean;
  selectedId: string | null;
  onSelect: (gameId: string) => void;
  health: ReadonlyMap<string, boolean>;
  progress: SaveProgress | null;
  busyGameId: string | null;
  bulk: { done: number; total: number } | null;
  scanning: boolean;
  onScan: () => void;
  onBackupGames: (entries: TrackedSaveGame[]) => void;
  onBackup: (entry: TrackedSaveGame, note?: string) => void;
  onRescan: (entry: TrackedSaveGame) => void;
  onOpenGamePage: (gameId: string) => void;
  onViewHistory: (gameId: string) => void;
  onToggleLocation: (entry: TrackedSaveGame, location: SaveLocation) => void;
  onOpenLocation: (location: SaveLocation) => void;
  onRemoveLocation: (location: SaveLocation) => void;
  onLocationAdded: () => void;
  onOpenSnapshot: (backup: SaveBackup) => void;
  onRestore: (backup: SaveBackup) => void;
  onOpenBackupFolder: (backup: SaveBackup) => void;
  onDeleteSnapshot: (backup: SaveBackup) => void;
  onDeleteGameSnapshots: (entry: TrackedSaveGame) => void;
}

const FILTERS: { id: GameFilter; labelKey: string }[] = [
  { id: "all", labelKey: "saves.filter.all" },
  { id: "protected", labelKey: "saves.filter.backedUp" },
  { id: "needsBackup", labelKey: "saves.filter.needsBackup" },
  { id: "issues", labelKey: "saves.filter.attention" },
];

/**
 * Games tab — a roster rail beside the selected game's save cockpit.
 *
 * The rail is for scanning and comparing; the pane is where a game is
 * actually managed. Multi-select on the rail exists for one bulk operation
 * (backing up several games at once), which is why it stays secondary.
 */
export default function GamesTab({
  overview,
  loading,
  selectedId,
  onSelect,
  health,
  progress,
  busyGameId,
  bulk,
  scanning,
  onScan,
  onBackupGames,
  onBackup,
  onRescan,
  onOpenGamePage,
  onViewHistory,
  onToggleLocation,
  onOpenLocation,
  onRemoveLocation,
  onLocationAdded,
  onOpenSnapshot,
  onRestore,
  onOpenBackupFolder,
  onDeleteSnapshot,
  onDeleteGameSnapshots,
}: GamesTabProps) {
  const { t, language } = useLanguage();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<GameFilter>("all");
  const [sort, setSort] = usePersistedState<GameSort>(
    "gamelib.saves.game_sort_v1",
    "attention",
    ["attention", "name", "recent", "snapshots"],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const previousBulk = useRef(bulk);

  // Clear the selection once a bulk run finishes, so the progress label
  // stays visible for its whole duration instead of vanishing with the button.
  useEffect(() => {
    if (previousBulk.current && !bulk) setSelected(new Set());
    previousBulk.current = bulk;
  }, [bulk]);

  const visible = useMemo(
    () => filterTrackedGames(overview.tracked, { filter, search, sort }),
    [overview.tracked, filter, search, sort],
  );

  const selectable = useMemo(
    () => visible.filter((entry) => entry.includedLocations.length > 0),
    [visible],
  );

  const selectedEntries = useMemo(
    () => selectable.filter((entry) => selected.has(entry.gameId)),
    [selectable, selected],
  );

  const selectedGame = selectedId ? (overview.byId.get(selectedId) ?? null) : null;

  // A filter that hides the selected game should move the pane to the first
  // visible game instead of leaving a detail view the rail no longer lists.
  useEffect(() => {
    if (loading || visible.length === 0) return;
    if (selectedId && visible.some((entry) => entry.gameId === selectedId)) return;
    onSelect(visible[0].gameId);
  }, [loading, visible, selectedId, onSelect]);

  const toggleSelected = (gameId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(gameId)) next.delete(gameId);
      else next.add(gameId);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      const allSelected = selectable.length > 0 && selectable.every((entry) => prev.has(entry.gameId));
      if (allSelected) return new Set();
      return new Set(selectable.map((entry) => entry.gameId));
    });
  };

  if (!loading && overview.tracked.length === 0) {
    return (
      <div className="saves-empty saves-empty--page">
        <p className="saves-empty__title">{t("saves.page.noGamesTitle")}</p>
        <p className="saves-empty__text">{t("saves.page.noGamesText")}</p>
        <Button
          variant="primary"
          size="sm"
          onClick={onScan}
          isLoading={scanning}
        >
          {t("saves.action.scanLibrary")}
        </Button>
      </div>
    );
  }

  return (
    <div className="saves-layout">
      <div className="saves-rail">
        <div className="saves-rail__search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("saves.searchPlaceholder")}
            aria-label={t("saves.searchPlaceholder")}
          />
          {search && (
            <button
              type="button"
              className="saves-rail__clear"
              onClick={() => setSearch("")}
              aria-label={t("saves.rail.clearSearch")}
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div className="saves-rail__filters" role="group" aria-label={t("saves.viewsLabel")}>
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`saves-chip${filter === item.id ? " is-active" : ""}`}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {t(item.labelKey)}
              <span className="saves-chip__count">{overview.counts[item.id]}</span>
            </button>
          ))}
        </div>

        <div className="saves-rail__controls">
          <label className="saves-rail__sort">
            <span className="saves-rail__sort-label">{t("saves.rail.sort")}</span>
            <select
              className="saves-select"
              value={sort}
              onChange={(event) => setSort(event.target.value as GameSort)}
              aria-label={t("saves.sortGames")}
            >
              <option value="attention">{t("saves.sort.attention")}</option>
              <option value="recent">{t("saves.sort.recent")}</option>
              <option value="name">{t("saves.sort.title")}</option>
              <option value="snapshots">{t("saves.sort.count")}</option>
            </select>
          </label>
        </div>

        <div className="saves-rail__bulk">
          <label className="saves-rail__select-all">
            <input
              type="checkbox"
              ref={(element) => {
                if (element) {
                  element.indeterminate =
                    selectedEntries.length > 0 && selectedEntries.length < selectable.length;
                }
              }}
              checked={selectable.length > 0 && selectedEntries.length === selectable.length}
              onChange={toggleAll}
              disabled={selectable.length === 0}
              aria-label={t("saves.rail.selectAll")}
            />
            <span>{t("saves.rail.showing", { count: visible.length })}</span>
          </label>
          {selectedEntries.length > 0 && (
            <Button
              variant="tertiary"
              size="sm"
              onClick={() => {
                onBackupGames(selectedEntries);
              }}
            >
              {bulk
                ? t("saves.rail.bulkProgress", { done: bulk.done, total: bulk.total })
                : t("saves.rail.backupSelected", { count: selectedEntries.length })}
            </Button>
          )}
        </div>

        {loading ? (
          <div className="saves-rail__skeleton" aria-busy="true">
            <Skeleton width="100%" height="54px" />
            <Skeleton width="100%" height="54px" />
            <Skeleton width="100%" height="54px" />
          </div>
        ) : visible.length === 0 ? (
          <div className="saves-empty saves-empty--compact">
            <p className="saves-empty__title">{t("saves.rail.emptyTitle")}</p>
            <p className="saves-empty__text">{t("saves.rail.emptyText")}</p>
            <Button
              variant="tertiary"
              size="sm"
              onClick={() => {
                setSearch("");
                setFilter("all");
              }}
            >
              {t("saves.rail.clearFilters")}
            </Button>
          </div>
        ) : (
          <ul className="saves-rail__list" aria-label={t("saves.page.yourGames")}>
            {visible.map((entry) => {
              const isActive = entry.gameId === selectedId;
              const canSelect = entry.includedLocations.length > 0;
              const isChecked = selected.has(entry.gameId);
              return (
                <li
                  key={entry.gameId}
                  className={[
                    "saves-game",
                    isActive ? "is-active" : "",
                    isChecked ? "is-checked" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <label className="saves-game__select" title={t("saves.rail.selectGame")}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelected(entry.gameId)}
                      disabled={!canSelect}
                      aria-label={t("saves.rail.selectGame", { name: entry.name })}
                    />
                  </label>
                  <button
                    type="button"
                    className="saves-game__main"
                    ref={(element) => {
                      if (element) buttonRefs.current.set(entry.gameId, element);
                      else buttonRefs.current.delete(entry.gameId);
                    }}
                    onClick={() => onSelect(entry.gameId)}
                    aria-current={isActive ? "true" : undefined}
                    tabIndex={isActive ? 0 : -1}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                      event.preventDefault();
                      const index = visible.indexOf(entry);
                      const next = visible[index + (event.key === "ArrowDown" ? 1 : -1)];
                      if (!next) return;
                      onSelect(next.gameId);
                      buttonRefs.current.get(next.gameId)?.focus();
                    }}
                  >
                    <SavesCover game={entry.game} name={entry.name} size="sm" />
                    <span className="saves-game__body">
                      <span className="saves-game__name">{entry.name}</span>
                      <span className="saves-game__meta">
                        {t("saves.game.locations", {
                          count: entry.includedLocations.length,
                        })}
                        <span aria-hidden="true"> · </span>
                        {entry.latest
                          ? formatRelative(entry.latest.createdAt, language)
                          : t("saves.game.noBackup")}
                      </span>
                    </span>
                    <ProtectionBadge
                      state={entry.state}
                      title={t(protectionLabelKey(entry.state))}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="saves-pane-wrap">
        <GameSavePane
          entry={selectedGame}
          health={health}
          progress={progress}
          busyGameId={busyGameId}
          onBackup={onBackup}
          onRescan={onRescan}
          onOpenGamePage={onOpenGamePage}
          onViewHistory={onViewHistory}
          onToggleLocation={onToggleLocation}
          onOpenLocation={onOpenLocation}
          onRemoveLocation={onRemoveLocation}
          onLocationAdded={onLocationAdded}
          onOpenSnapshot={onOpenSnapshot}
          onRestore={onRestore}
          onOpenBackupFolder={onOpenBackupFolder}
          onDeleteSnapshot={onDeleteSnapshot}
          onDeleteGameSnapshots={onDeleteGameSnapshots}
        />
      </div>
    </div>
  );
}
