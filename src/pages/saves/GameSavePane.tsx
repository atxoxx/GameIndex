import { useEffect, useState } from "react";
import {
  Archive,
  Clock,
  FileText,
  FolderOpen,
  Gamepad2,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { Button, StatBand, type StatBandItem } from "../../components/ui";
import { useLanguage } from "../../context/LanguageContext";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import type { SaveBackup, SaveLocation, SaveProgress } from "../../types/saves";
import { formatRelative } from "../../utils/savesTime";
import AddLocationForm from "./AddLocationForm";
import SaveLocationList from "./SaveLocationList";
import SavesCover from "./SavesCover";
import { ProtectionBadge } from "./SavesBadges";
import SnapshotRow from "./SnapshotRow";
import type { TrackedSaveGame } from "./savesData";

interface GameSavePaneProps {
  entry: TrackedSaveGame | null;
  health: ReadonlyMap<string, boolean>;
  progress: SaveProgress | null;
  busyGameId: string | null;
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

/**
 * The master–detail detail half: everything about one game's saves.
 *
 * Locations and recent snapshots live together so a restore decision can be
 * made without leaving the roster. Long-term browsing stays a tab away.
 */
export default function GameSavePane({
  entry,
  health,
  progress,
  busyGameId,
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
}: GameSavePaneProps) {
  const { t, language } = useLanguage();
  const { formatBytes } = useSizeUnit();
  const [addOpen, setAddOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  // Switching games must not carry a half-filled form onto the next one.
  useEffect(() => {
    setAddOpen(false);
    setNoteOpen(false);
    setNote("");
  }, [entry?.gameId]);

  if (!entry) {
    return (
      <div className="saves-pane saves-pane--empty">
        <Gamepad2 size={26} className="saves-pane__empty-icon" aria-hidden="true" />
        <strong>{t("saves.pane.emptyTitle")}</strong>
        <p>{t("saves.pane.emptyText")}</p>
      </div>
    );
  }

  const game = entry.game;
  const busy = busyGameId === entry.gameId;
  const activeProgress = progress && progress.gameId === entry.gameId ? progress : null;
  const canBackup = entry.includedLocations.length > 0 && !busy;

  const stats: StatBandItem[] = [
    {
      id: "snapshots",
      label: t("saves.kpi.backups"),
      value: entry.snapshots.length,
      detail: formatBytes(entry.snapshotBytes),
      icon: <Archive size={14} />,
      tone: entry.snapshots.length > 0 ? "accent" : "default",
    },
    {
      id: "locations",
      label: t("saves.kpi.locations"),
      value: entry.includedLocations.length,
      detail: t("saves.pane.locationsDetail", { total: entry.locations.length }),
      icon: <FolderOpen size={14} />,
      ...(entry.missingCount > 0 ? { tone: "danger" as const } : {}),
    },
    {
      id: "last",
      label: t("saves.kpi.lastBackup"),
      value: entry.latest
        ? formatRelative(entry.latest.createdAt, language)
        : t("saves.kpi.never"),
      icon: <Clock size={14} />,
      tone: entry.state === "never" || entry.state === "stale" ? "warning" : "info",
    },
  ];

  if (entry.missingCount > 0) {
    stats.push({
      id: "missing",
      label: t("saves.pane.missingPaths"),
      value: entry.missingCount,
      detail: t("saves.locations.missingHint"),
      icon: <TriangleAlert size={14} />,
      tone: "danger",
    });
  }

  const recent = entry.snapshots.slice(0, 3);

  return (
    <div className="saves-pane">
      <header className="saves-pane__head">
        <SavesCover game={game} name={entry.name} size="lg" />
        <div className="saves-pane__identity">
          <div className="saves-pane__title-row">
            <h2 className="saves-pane__title">{entry.name}</h2>
            <ProtectionBadge state={entry.state} />
            {!entry.installed && (
              <span className="saves-pane__not-installed">{t("saves.state.notInstalled")}</span>
            )}
          </div>
          <p className="saves-pane__sub">
            {entry.includedLocations.length > 0
              ? t("saves.game.locations", { count: entry.includedLocations.length })
              : t("saves.pane.noIncluded")}
            {entry.latest && (
              <>
                <span className="saves-pane__sep" aria-hidden="true">·</span>
                {t("saves.game.lastBackup", {
                  when: formatRelative(entry.latest.createdAt, language),
                })}
              </>
            )}
          </p>
        </div>
        <div className="saves-pane__actions">
          {game && (
            <Button variant="ghost" size="sm" onClick={() => onOpenGamePage(entry.gameId)}>
              {t("saves.pane.openGame")}
            </Button>
          )}
          <Button
            variant="tertiary"
            size="sm"
            leftIcon={<RefreshCw size={14} />}
            onClick={() => onRescan(entry)}
            disabled={busy}
            title={t("saves.action.rescan")}
          >
            {t("saves.action.rescan")}
          </Button>
          <Button
            variant="tertiary"
            size="sm"
            leftIcon={<FileText size={14} />}
            onClick={() => setNoteOpen((open) => !open)}
            disabled={!canBackup}
            aria-expanded={noteOpen}
          >
            {t("saves.snapshot.takeWithNote")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<Zap size={14} />}
            onClick={() => onBackup(entry)}
            isLoading={busy}
            disabled={!canBackup}
          >
            {t("saves.action.backupNow")}
          </Button>
        </div>
      </header>

      {noteOpen && (
        <div className="saves-note">
          <input
            type="text"
            className="saves-input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("saves.snapshot.notePlaceholder")}
            aria-label={t("saves.snapshot.notePlaceholder")}
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                onBackup(entry, note);
                setNote("");
                setNoteOpen(false);
              }
              if (event.key === "Escape") setNoteOpen(false);
            }}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              onBackup(entry, note);
              setNote("");
              setNoteOpen(false);
            }}
            disabled={!canBackup}
          >
            {t("saves.action.backupNow")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setNoteOpen(false)}>
            {t("common.cancel")}
          </Button>
        </div>
      )}

      {activeProgress && activeProgress.percent < 100 && (
        <div className="saves-progress" role="status" aria-live="polite">
          <div
            className="saves-progress__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={activeProgress.percent}
          >
            <div
              className="saves-progress__fill"
              style={{ width: `${Math.max(4, activeProgress.percent)}%` }}
            />
          </div>
          <span className="saves-progress__label">
            {activeProgress.message || t("saves.progress.working")}
          </span>
        </div>
      )}

      <StatBand items={stats} ariaLabel={t("saves.pane.statsLabel")} />

      <section className="saves-section">
        <header className="saves-section__head">
          <h3 className="saves-section__title">
            {t("saves.locations.title")}
            <span className="saves-section__count">{entry.locations.length}</span>
          </h3>
          <div className="saves-section__actions">
            <Button
              variant="tertiary"
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => setAddOpen((open) => !open)}
              aria-expanded={addOpen}
            >
              {t("saves.action.addLocation")}
            </Button>
          </div>
        </header>

        {addOpen && (
          <AddLocationForm
            gameId={entry.gameId}
            onAdded={() => {
              setAddOpen(false);
              onLocationAdded();
            }}
            onCancel={() => setAddOpen(false)}
          />
        )}

        {entry.locations.length === 0 ? (
          <div className="saves-empty saves-empty--compact">
            <p className="saves-empty__title">{t("saves.locations.emptyTitle")}</p>
            <p className="saves-empty__text">{t("saves.locations.emptyText")}</p>
            <div className="saves-empty__actions">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<RefreshCw size={14} />}
                onClick={() => onRescan(entry)}
                disabled={busy}
              >
                {t("saves.action.scanForSaves")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Plus size={14} />}
                onClick={() => setAddOpen(true)}
              >
                {t("saves.action.addLocation")}
              </Button>
            </div>
          </div>
        ) : (
          <SaveLocationList
            locations={entry.locations}
            health={health}
            onToggle={(location) => onToggleLocation(entry, location)}
            onOpen={onOpenLocation}
            onRemove={onRemoveLocation}
          />
        )}
      </section>

      <section className="saves-section">
        <header className="saves-section__head">
          <h3 className="saves-section__title">
            {t("saves.pane.recentSnapshots")}
            <span className="saves-section__count">{entry.snapshots.length}</span>
          </h3>
          <div className="saves-section__actions">
            {entry.snapshots.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="saves-section__danger"
                leftIcon={<Trash2 size={14} />}
                onClick={() => onDeleteGameSnapshots(entry)}
              >
                {t("saves.snapshots.deleteAllForGame")}
              </Button>
            )}
            {entry.snapshots.length > 0 && (
              <Button variant="tertiary" size="sm" onClick={() => onViewHistory(entry.gameId)}>
                {t("saves.pane.viewAll")}
              </Button>
            )}
          </div>
        </header>

        {recent.length === 0 ? (
          <div className="saves-empty saves-empty--compact">
            <p className="saves-empty__title">{t("saves.snapshots.noneTitle")}</p>
            <p className="saves-empty__text">
              {entry.includedLocations.length === 0
                ? t("saves.pane.noIncluded")
                : t("saves.snapshots.noneText")}
            </p>
          </div>
        ) : (
          <ul className="saves-snaps">
            {recent.map((backup) => (
              <SnapshotRow
                key={backup.id}
                backup={backup}
                onOpenDetails={() => onOpenSnapshot(backup)}
                onRestore={() => onRestore(backup)}
                onOpenFolder={() => onOpenBackupFolder(backup)}
                onDelete={() => onDeleteSnapshot(backup)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
