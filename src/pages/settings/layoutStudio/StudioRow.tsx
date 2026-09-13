import { ChevronDown, ChevronUp, Eye, EyeOff, GripVertical } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";

export interface StudioRowProps {
  id: string;
  index: number;
  icon: LucideIcon;
  label: string;
  hint?: string;
  hidden: boolean;
  onToggle: () => void;
  onMove?: (delta: number) => void;
  onDragStart?: () => void;
  isDragging?: boolean;
  isDropTarget?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  isModified?: boolean;
  isHighlighted?: boolean;
  onHover?: (hovering: boolean) => void;
}

export function StudioRow({
  id,
  index,
  icon: Icon,
  label,
  hint,
  hidden,
  onToggle,
  onMove,
  onDragStart,
  isDragging,
  isDropTarget,
  canMoveUp,
  canMoveDown,
  isModified,
  isHighlighted,
  onHover,
}: StudioRowProps) {
  const { t } = useLanguage();

  return (
    <div
      id={`studio-item-${id}`}
      data-studio-id={id}
      data-order-index={index}
      className={`studio-row${isDragging ? " is-dragging" : ""}${
        isDropTarget ? " is-drop-target" : ""
      }${hidden ? " is-hidden-item" : ""}${isHighlighted ? " is-highlighted" : ""}`}
      role="listitem"
      title={hint}
      onMouseEnter={() => onHover?.(true)}
      onMouseLeave={() => onHover?.(false)}
    >
      {onDragStart && (
        <span
          className="studio-row__handle"
          title={t("settings.interface.studioDragHandle")}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            onDragStart();
          }}
        >
          <GripVertical size={15} aria-hidden="true" />
        </span>
      )}

      <Icon className="studio-row__icon" size={16} aria-hidden="true" />

      <span className="studio-row__label">{label}</span>

      {isModified && (
        <span
          className="studio-row__modified-dot"
          title={t("settings.interface.modifiedHint")}
          aria-label={t("settings.interface.modifiedHint")}
        />
      )}

      {hidden && (
        <span className="studio-row__badge">
          {t("settings.interface.studioHidden")}
        </span>
      )}

      {onMove && (
        <div className="studio-row__moves">
          <button
            type="button"
            className="studio-row__move"
            disabled={!canMoveUp}
            onClick={() => onMove(-1)}
            aria-label={t("settings.interface.studioMoveUp")}
            title={t("settings.interface.studioMoveUp")}
          >
            <ChevronUp size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="studio-row__move"
            disabled={!canMoveDown}
            onClick={() => onMove(1)}
            aria-label={t("settings.interface.studioMoveDown")}
            title={t("settings.interface.studioMoveDown")}
          >
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      <button
        type="button"
        className="studio-row__eye"
        onClick={onToggle}
        aria-pressed={!hidden}
        aria-label={
          hidden
            ? t("settings.interface.studioShow")
            : t("settings.interface.studioHide")
        }
        title={
          hidden
            ? t("settings.interface.studioShow")
            : t("settings.interface.studioHide")
        }
      >
        {hidden ? (
          <EyeOff size={15} aria-hidden="true" />
        ) : (
          <Eye size={15} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
