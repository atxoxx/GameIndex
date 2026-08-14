import { useLanguage } from "../../context/LanguageContext";
import { ENGINE_LABELS, type GameMod, type ModEngine } from "../../types/mods";

function formatModSize(bytes?: number): string {
  if (bytes == null || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function EngineChip({ engine }: { engine: ModEngine | string }) {
  const label = ENGINE_LABELS[engine as ModEngine] ?? engine;
  return <span className={`mods-engine-chip mods-engine-${engine}`}>{label}</span>;
}

interface ModRowProps {
  mod: GameMod;
  orderIndex: number;
  isSelected: boolean;
  isMultiSelected: boolean;
  hasConflict: boolean;
  dragEnabled: boolean;
  dragOver: boolean;
  onSelect: () => void;
  onToggleSelect: (shiftKey: boolean) => void;
  onToggleEnabled: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
}

export default function ModRow({
  mod,
  orderIndex,
  isSelected,
  isMultiSelected,
  hasConflict,
  dragEnabled,
  dragOver,
  onSelect,
  onToggleSelect,
  onToggleEnabled,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: ModRowProps) {
  const { t } = useLanguage();

  return (
    <div
      role="option"
      aria-selected={isSelected}
      tabIndex={0}
      className={[
        "mods-row",
        isSelected ? "selected" : "",
        isMultiSelected ? "multi-selected" : "",
        mod.enabled ? "" : "disabled",
        dragOver ? "drag-over" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      draggable={dragEnabled}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Multi-select Checkbox */}
      <input
        type="checkbox"
        className="mods-row-checkbox"
        checked={isMultiSelected}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onToggleSelect((e.nativeEvent as MouseEvent).shiftKey)}
        title={t("mods.selectModTitle")}
        aria-label={t("mods.selectModTitle")}
      />

      {/* Drag handle */}
      {dragEnabled && (
        <span className="mods-drag-handle" aria-hidden title={t("mods.loadOrderHint")}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="5" r="1" />
            <circle cx="9" cy="12" r="1" />
            <circle cx="9" cy="19" r="1" />
            <circle cx="15" cy="5" r="1" />
            <circle cx="15" cy="12" r="1" />
            <circle cx="15" cy="19" r="1" />
          </svg>
        </span>
      )}

      {/* Load order index */}
      <span className="mods-order-num">#{orderIndex + 1}</span>

      {/* Cyber Switch Toggle */}
      <label
        className="mods-toggle-switch"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={mod.enabled}
          onChange={onToggleEnabled}
          aria-label={t("mods.toggleMod", {
            name: mod.name,
            state: mod.enabled ? t("mods.disabled") : t("mods.enabled"),
          })}
        />
        <span className="mods-toggle-slider" />
      </label>

      {/* Name and Version */}
      <div className="mods-row-main">
        <span className="mods-row-name" title={mod.name}>
          {mod.name}
        </span>
        <div className="mods-row-sub">
          {mod.version && (
            <span className="mods-row-version" title={`v${mod.version}`}>
              v{mod.version}
            </span>
          )}
          {mod.author && (
            <span className="mods-row-author" title={mod.author}>
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span>{mod.author}</span>
            </span>
          )}
        </div>
      </div>

      {/* Badges & Size */}
      <div className="mods-row-badges">
        {mod.updateAvailable && (
          <span className="mods-badge mods-badge-update" title={t("mods.updateAvailable")}>
            ↑ {t("mods.updateAvailable")}
          </span>
        )}
        {hasConflict && (
          <span className="mods-badge mods-badge-conflict" title={t("mods.filter.conflicts")}>
            ⚠ {t("mods.filter.conflicts")}
          </span>
        )}
        <EngineChip engine={mod.engine} />
        <span className="mods-row-size">{formatModSize(mod.sizeBytes)}</span>
      </div>
    </div>
  );
}
