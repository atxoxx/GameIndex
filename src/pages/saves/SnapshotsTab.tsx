import { useEffect, useMemo, useState } from "react";
import { Search, Trash2, X } from "lucide-react";
import { Button, Skeleton } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import type { Game } from "../../types/game";
import { SAVE_KIND_LABEL_KEY, type SaveBackup } from "../../types/saves";
import { formatDayKey, todayKey, yesterdayKey } from "../../utils/savesTime";
import SnapshotRow from "./SnapshotRow";
import {
  filterSnapshots,
  groupSnapshotsByDay,
  type SnapshotSort,
} from "./savesData";

interface SnapshotsTabProps {
  backups: SaveBackup[];
  games: Game[];
  loading: boolean;
  initialGameId: string;
  onOpenSnapshot: (backup: SaveBackup) => void;
  onRestore: (backup: SaveBackup) => void;
  onOpenBackupFolder: (backup: SaveBackup) => void;
  onDeleteSnapshot: (backup: SaveBackup) => void;
  onDeleteMany: (backups: SaveBackup[]) => void;
  onBackupAll: () => void;
}

const KIND_FILTERS = ["all", "manual", "auto-exit", "pre-restore"] as const;

/**
 * Library-wide snapshot archive.
 *
 * Grouped by local day so a long history stays navigable; multi-select exists
 * for cleanup only — restoring several snapshots of one game would just make
 * the last one win, so restore stays a deliberate per-snapshot action.
 */
export default function SnapshotsTab({
  backups,
  games,
  loading,
  initialGameId,
  onOpenSnapshot,
  onRestore,
  onOpenBackupFolder,
  onDeleteSnapshot,
  onDeleteMany,
  onBackupAll,
}: SnapshotsTabProps) {
  const { t, language } = useLanguage();
  const { formatBytes } = useSizeUnit();
  const [search, setSearch] = useState("");
  const [gameId, setGameId] = useState(initialGameId || "all");
  const [kind, setKind] = useState<string>("all");
  const [sort, setSort] = useState<SnapshotSort>("newest");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Drop ids that disappeared after a delete/restore refresh instead of
  // silently keeping an invisible selection.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const existing = new Set(backups.map((backup) => backup.id));
      const next = new Set([...prev].filter((id) => existing.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [backups]);

  const gameById = useMemo(() => new Map(games.map((game) => [game.id, game])), [games]);

  const gamesWithSnapshots = useMemo(() => {
    const map = new Map<string, string>();
    for (const backup of backups) {
      if (!map.has(backup.gameId)) map.set(backup.gameId, backup.gameName);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [backups]);

  const filtered = useMemo(
    () => filterSnapshots(backups, { search, gameId, kind, sort }),
    [backups, search, gameId, kind, sort],
  );

  const groups = useMemo(() => groupSnapshotsByDay(filtered), [filtered]);
  const selectedBackups = useMemo(
    () => filtered.filter((backup) => selected.has(backup.id)),
    [filtered, selected],
  );

  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = { all: backups.length };
    for (const backup of backups) {
      counts[backup.kind] = (counts[backup.kind] ?? 0) + 1;
    }
    return counts;
  }, [backups]);

  const totalBytes = filtered.reduce((sum, backup) => sum + backup.totalBytes, 0);
  const today = todayKey();
  const yesterday = yesterdayKey();
  const hasFilters = search.trim() !== "" || gameId !== "all" || kind !== "all";

  const clearFilters = () => {
    setSearch("");
    setGameId("all");
    setKind("all");
    setSort("newest");
  };

  const toggle = (backup: SaveBackup) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(backup.id)) next.delete(backup.id);
      else next.add(backup.id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      filtered.length > 0 && filtered.every((backup) => prev.has(backup.id))
        ? new Set()
        : new Set(filtered.map((backup) => backup.id)),
    );
  };

  return (
    <div className="saves-timeline">
      <div className="saves-timeline__bar">
        <div className="saves-timeline__search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("saves.snapshots.searchPlaceholder")}
            aria-label={t("saves.snapshots.searchPlaceholder")}
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

        <select
          className="saves-select"
          value={gameId}
          onChange={(event) => setGameId(event.target.value)}
          aria-label={t("saves.filterByGame")}
        >
          <option value="all">{t("saves.snapshots.allGames")}</option>
          {gamesWithSnapshots.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>

        <select
          className="saves-select"
          value={sort}
          onChange={(event) => setSort(event.target.value as SnapshotSort)}
          aria-label={t("saves.sortSnapshots")}
        >
          <option value="newest">{t("saves.sort.recent")}</option>
          <option value="oldest">{t("saves.sort.oldest")}</option>
          <option value="size">{t("saves.sort.size")}</option>
        </select>

        <span className="saves-timeline__count">
          {t("saves.snapshots.showingCount", {
            count: filtered.length,
            size: formatBytes(totalBytes),
          })}
        </span>
      </div>

      <div className="saves-timeline__chips" role="group" aria-label={t("saves.filterByType")}>
        {KIND_FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            className={`saves-chip${kind === item ? " is-active" : ""}`}
            aria-pressed={kind === item}
            onClick={() => setKind(item)}
          >
            {item === "all" ? t("saves.snapshots.allKinds") : t(SAVE_KIND_LABEL_KEY[item])}
            <span className="saves-chip__count">{kindCounts[item] ?? 0}</span>
          </button>
        ))}
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            {t("saves.rail.clearFilters")}
          </Button>
        )}
      </div>

      {selectedBackups.length > 0 && (
        <div className="saves-bulk" role="status" aria-live="polite">
          <span className="saves-bulk__count">
            {t("saves.snapshots.selected", { count: selectedBackups.length })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Trash2 size={14} />}
            className="saves-bulk__delete"
            onClick={() => {
              onDeleteMany(selectedBackups);
            }}
          >
            {t("saves.snapshots.deleteSelected")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            {t("saves.snapshots.clearSelection")}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="saves-timeline__skeleton" aria-busy="true">
          <Skeleton width="100%" height="62px" />
          <Skeleton width="100%" height="62px" />
          <Skeleton width="100%" height="62px" />
        </div>
      ) : backups.length === 0 ? (
        <div className="saves-empty saves-empty--page">
          <p className="saves-empty__title">{t("saves.snapshots.noneTitle")}</p>
          <p className="saves-empty__text">{t("saves.snapshots.noneText")}</p>
          <Button variant="primary" size="sm" onClick={onBackupAll}>
            {t("saves.action.backupAll")}
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="saves-empty saves-empty--page">
          <p className="saves-empty__title">{t("saves.snapshots.emptyFilter")}</p>
          <p className="saves-empty__text">{t("saves.snapshots.emptyFilterText")}</p>
          <Button variant="tertiary" size="sm" onClick={clearFilters}>
            {t("saves.rail.clearFilters")}
          </Button>
        </div>
      ) : (
        <>
          <label className="saves-timeline__select-all">
            <input
              type="checkbox"
              checked={filtered.length > 0 && selectedBackups.length === filtered.length}
              onChange={toggleAll}
              aria-label={t("saves.snapshots.selectAll")}
            />
            <span>{t("saves.snapshots.selectAll")}</span>
          </label>

          {groups.map((group) => {
            const label =
              group.key === today
                ? t("saves.day.today")
                : group.key === yesterday
                  ? t("saves.day.yesterday")
                  : formatDayKey(group.key, language);
            return (
              <section className="saves-day" key={group.key}>
                <header className="saves-day__head">
                  <h3 className="saves-day__title">{label}</h3>
                  <span className="saves-day__meta">
                    {t("saves.snapshots.showingCount", {
                      count: group.backups.length,
                      size: formatBytes(group.bytes),
                    })}
                  </span>
                </header>
                <ul className="saves-snaps">
                  {group.backups.map((backup) => (
                    <SnapshotRow
                      key={backup.id}
                      backup={backup}
                      game={gameById.get(backup.gameId)}
                      showGame
                      selectable
                      selected={selected.has(backup.id)}
                      onToggleSelect={() => toggle(backup)}
                      onOpenDetails={() => onOpenSnapshot(backup)}
                      onRestore={() => onRestore(backup)}
                      onOpenFolder={() => onOpenBackupFolder(backup)}
                      onDelete={() => onDeleteSnapshot(backup)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
