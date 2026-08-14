import { useRef, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { Button } from "../ui";
import { ENGINE_LABELS, type GameMod, type ModConflict, type ModEngine } from "../../types/mods";
import ModRow from "./ModRow";

function EngineChip({ engine }: { engine: ModEngine | string }) {
  const label = ENGINE_LABELS[engine as ModEngine] ?? engine;
  return <span className={`mods-engine-chip mods-engine-${engine}`}>{label}</span>;
}

interface ModListProps {
  mods: GameMod[];
  sortedMods: GameMod[];
  selectedId: string | null;
  onSelectMod: (id: string) => void;
  selectedIds: Set<string>;
  onToggleSelectMod: (id: string, shiftKey: boolean) => void;
  onToggleSelectAll: () => void;
  allSelected: boolean;
  onToggleEnabled: (mod: GameMod) => void;
  onReorder: (orderedIds: string[]) => void;
  conflictsByMod: Map<string, ModConflict[]>;
  engines: string[];
  supportsReorder: boolean;
  dragEnabled: boolean;
  bulkProcessing: boolean;
  onBulkEnable: () => void;
  onBulkDisable: () => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
  onClearFilters: () => void;
}

export default function ModList({
  mods,
  sortedMods,
  selectedId,
  onSelectMod,
  selectedIds,
  onToggleSelectMod,
  onToggleSelectAll,
  allSelected,
  onToggleEnabled,
  onReorder,
  conflictsByMod,
  engines,
  supportsReorder,
  dragEnabled,
  bulkProcessing,
  onBulkEnable,
  onBulkDisable,
  onBulkDelete,
  onClearSelection,
  onClearFilters,
}: ModListProps) {
  const { t } = useLanguage();
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const handleDrop = (targetId: string) => {
    const sourceId = dragId.current;
    dragId.current = null;
    setDragOverId(null);
    if (!sourceId || sourceId === targetId) return;
    const ids = mods.map((m) => m.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    onReorder(ids);
  };

  if (sortedMods.length === 0) {
    return (
      <div className="mods-list-pane">
        <div className="mods-empty">
          <div className="mods-empty-glyph">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <h3>{t("mods.noModsMatch")}</h3>
          <p>{t("mods.noModsMatchHint")}</p>
          <div className="mods-empty-actions">
            <Button variant="secondary" size="sm" onClick={onClearFilters}>
              {t("mods.clearFilter")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mods-list-pane">
      {/* Header bar */}
      <div className="mods-list-header">
        <div className="mods-list-header-title">
          <input
            type="checkbox"
            className="mods-header-checkbox"
            checked={allSelected}
            onChange={onToggleSelectAll}
            title={allSelected ? t("mods.deselectAll") : t("mods.selectAll")}
          />
          <span>{t("mods.loadOrder")}</span>
          {engines.map((e) => (
            <EngineChip key={e} engine={e} />
          ))}
        </div>
        <span className="mods-list-header-hint">
          {selectedIds.size > 0
            ? t("mods.selectedCount", { count: String(selectedIds.size) })
            : supportsReorder
            ? t("mods.loadOrderHint")
            : t("mods.loadOrderReadOnly")}
        </span>
      </div>

      {/* Bulk action floating bar */}
      {selectedIds.size > 0 && (
        <div className="mods-bulk-toolbar" role="toolbar" aria-label={t("mods.selectedCount", { count: String(selectedIds.size) })}>
          <span className="mods-bulk-count">
            {t("mods.selectedCount", { count: String(selectedIds.size) })}
          </span>
          <div className="mods-bulk-actions">
            <Button
              variant="secondary"
              size="sm"
              onClick={onBulkEnable}
              isLoading={bulkProcessing}
            >
              {t("mods.enable")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onBulkDisable}
              isLoading={bulkProcessing}
            >
              {t("mods.disable")}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={onBulkDelete}
              isLoading={bulkProcessing}
            >
              {t("mods.delete")}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClearSelection}>
              {t("mods.clearSelection")}
            </Button>
          </div>
        </div>
      )}

      {/* Rows Container */}
      <div className="mods-list" role="listbox" aria-label={t("mods.loadOrder")}>
        {sortedMods.map((mod) => {
          const hasConflict = conflictsByMod.has(mod.id);
          const orderIndex = mods.indexOf(mod);
          const isMultiSelected = selectedIds.has(mod.id);
          return (
            <ModRow
              key={mod.id}
              mod={mod}
              orderIndex={orderIndex}
              isSelected={mod.id === selectedId}
              isMultiSelected={isMultiSelected}
              hasConflict={hasConflict}
              dragEnabled={dragEnabled}
              dragOver={dragOverId === mod.id}
              onSelect={() => onSelectMod(mod.id)}
              onToggleSelect={(shift) => onToggleSelectMod(mod.id, shift)}
              onToggleEnabled={() => onToggleEnabled(mod)}
              onDragStart={() => {
                dragId.current = mod.id;
              }}
              onDragOver={(e) => {
                if (!dragEnabled) return;
                e.preventDefault();
                setDragOverId(mod.id);
              }}
              onDragLeave={() => setDragOverId((v) => (v === mod.id ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(mod.id);
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
