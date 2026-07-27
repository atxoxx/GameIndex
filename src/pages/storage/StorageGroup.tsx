import { useState, useMemo } from "react";
import type { Game } from "../../types/game";
import { formatSize } from "../../types/game";
import { useSizeUnit } from "../../hooks/useSizeUnit";
import { useLanguage } from "../../context/LanguageContext";
import { StorageRow } from "./StorageRow";

interface Props {
  /** Section display label (already localised). */
  label: string;
  /** Games in this section (already search/sort filtered). */
  games: Game[];
  /** Pre-computed total footprint (game + mods) for the header. */
  bytes: number;
  density: string;
  /** Drive label when this section represents a drive bucket, so the
   *  header can show a disk glyph; otherwise undefined. */
  driveLabel?: string;
  // Row passthrough props (selection / management).
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onSizeUpdated: (id: string) => void;
  onOpenFolder: (g: Game) => void;
  onMove: (g: Game) => void;
  onUninstall: (g: Game) => void;
  /** Per-game staleness map (path no longer resolves on disk). */
  staleMap?: Map<string, boolean>;
}

/** A collapsible group in the Storage game list. The header shows the group
 *  label, the number of games, and the combined footprint so the user can
 *  scan totals at a glance and collapse sections they don't care about. */
export function StorageGroup({
  label,
  games,
  bytes,
  density,
  driveLabel,
  selectMode,
  selected,
  onToggleSelect,
  onSizeUpdated,
  onOpenFolder,
  onMove,
  onUninstall,
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
    <li className={`storage__group${collapsed ? " storage__group--collapsed" : ""}`}>
      <button
        type="button"
        className="storage__group-header"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <span className="storage__group-chevron" aria-hidden="true">
          {"\u25BE"}
        </span>
        <span className="storage__group-label">
          {driveLabel ? `${driveLabel}` : label}
        </span>
        <span className="storage__group-count">{countLabel}</span>
        <span className="storage__group-size">{formatSize(bytes, unit)}</span>
      </button>
      {!collapsed && (
        <ul className={`storage__list density-${density}`}>
          {games.map((g) => (
            <StorageRow
              key={g.id}
              game={g}
              stale={staleMap?.get(g.id) === true}
              density={density}
              selectMode={selectMode}
              selected={selected.has(g.id)}
              onToggleSelect={() => onToggleSelect(g.id)}
              onSizeUpdated={() => onSizeUpdated(g.id)}
              onOpenFolder={() => onOpenFolder(g)}
              onMove={() => onMove(g)}
              onUninstall={() => onUninstall(g)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
