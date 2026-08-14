import { useState, useMemo } from "react";
import type { Game } from "../../types/game";
import { formatSize } from "../../types/game";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import { StorageRow } from "./StorageRow";
import { StorageGridCard } from "./StorageGridCard";

interface Props {
  label: string;
  games: Game[];
  bytes: number;
  maxBytes?: number;
  density: string;
  viewMode?: "list" | "grid";
  driveLabel?: string;
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onSizeUpdated: (id: string) => void;
  onOpenFolder: (g: Game) => void;
  onMove: (g: Game) => void;
  onUninstall: (g: Game) => void;
  onLaunch?: (g: Game) => void;
  staleMap?: Map<string, boolean>;
}

export function StorageGroup({
  label,
  games,
  bytes,
  maxBytes = 0,
  density,
  viewMode = "list",
  driveLabel,
  selectMode,
  selected,
  onToggleSelect,
  onSizeUpdated,
  onOpenFolder,
  onMove,
  onUninstall,
  onLaunch,
  staleMap,
}: Props) {
  const { t } = useLanguage();
  const { unit } = useSizeUnit();
  const [collapsed, setCollapsed] = useState(false);

  const countLabel = useMemo(
    () =>
      t("storage.sectionCount", {
        count: games.length,
        plural: games.length === 1 ? "" : "s",
      }),
    [games.length, t]
  );

  return (
    <li className={`storage__group ${collapsed ? "storage__group--collapsed" : ""}`}>
      <button
        type="button"
        className="storage__group-header"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <span className="storage__group-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
        <span className="storage__group-label">
          {driveLabel ? `${driveLabel}` : label}
        </span>
        <span className="storage__group-count">{countLabel}</span>
        <span className="storage__group-size">{formatSize(bytes, unit)}</span>
      </button>

      {!collapsed && (
        <>
          {viewMode === "grid" ? (
            <div className={`storage__grid density-${density}`}>
              {games.map((g) => (
                <StorageGridCard
                  key={g.id}
                  game={g}
                  maxBytes={maxBytes}
                  stale={staleMap?.get(g.id) === true}
                  density={density}
                  selectMode={selectMode}
                  selected={selected.has(g.id)}
                  onToggleSelect={() => onToggleSelect(g.id)}
                  onSizeUpdated={() => onSizeUpdated(g.id)}
                  onOpenFolder={() => onOpenFolder(g)}
                  onMove={() => onMove(g)}
                  onUninstall={() => onUninstall(g)}
                  onLaunch={onLaunch ? () => onLaunch(g) : undefined}
                />
              ))}
            </div>
          ) : (
            <ul className={`storage__list density-${density}`}>
              {games.map((g) => (
                <StorageRow
                  key={g.id}
                  game={g}
                  maxBytes={maxBytes}
                  stale={staleMap?.get(g.id) === true}
                  density={density}
                  selectMode={selectMode}
                  selected={selected.has(g.id)}
                  onToggleSelect={() => onToggleSelect(g.id)}
                  onSizeUpdated={() => onSizeUpdated(g.id)}
                  onOpenFolder={() => onOpenFolder(g)}
                  onMove={() => onMove(g)}
                  onUninstall={() => onUninstall(g)}
                  onLaunch={onLaunch ? () => onLaunch(g) : undefined}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}
