import type { CSSProperties, ReactNode } from "react";
import { Eye, EyeOff, GripVertical } from "lucide-react";
import { useLanguage } from "../../../context/LanguageContext";
import type { OrderListItem } from "./types";

export interface StudioPageWidgetCardProps {
  item: OrderListItem;
  index: number;
  isDragging?: boolean;
  isDropTarget?: boolean;
  isLit?: boolean;
  inspectMode?: boolean;
  className?: string;
  style?: CSSProperties;
  variant?: "card" | "slot" | "banner";
  onStartDrag: (e: React.PointerEvent) => void;
  onToggle: () => void;
  onInspect?: (id: string) => void;
  children?: ReactNode;
}

export function StudioPageWidgetCard({
  item,
  index,
  isDragging = false,
  isDropTarget = false,
  isLit = false,
  inspectMode = false,
  className = "",
  style,
  variant = "card",
  onStartDrag,
  onToggle,
  onInspect,
  children,
}: StudioPageWidgetCardProps) {
  const { t } = useLanguage();

  const toggleTitle = inspectMode
    ? `${item.label} — ${t("settings.interface.inspectElementHint")}`
    : `${item.label} — ${t(item.hidden ? "settings.interface.studioShow" : "settings.interface.studioHide")}`;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (inspectMode && onInspect) {
      onInspect(item.id);
    } else {
      onToggle();
    }
  };

  const handleEyeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (inspectMode && onInspect) {
      onInspect(item.id);
    } else {
      onToggle();
    }
  };

  const baseClass =
    variant === "slot"
      ? "studio-detail-slot"
      : variant === "banner"
        ? "studio-page-banner"
        : "studio-detail-card";

  const cardClasses = [
    baseClass,
    item.hidden ? "is-off" : "",
    isDragging ? "is-dragging" : "",
    isDropTarget ? "is-drop-target" : "",
    isLit ? "is-preview-lit" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const Icon = item.icon;

  if (variant === "slot") {
    return (
      <div
        id={`studio-item-${item.id}`}
        data-order-index={index}
        className={cardClasses}
        style={style}
        role="group"
        aria-label={item.label}
        onPointerDown={onStartDrag}
        onClick={handleClick}
      >
        <div className="studio-detail-slot__bar">
          <GripVertical className="studio-detail-slot__grip" size={11} aria-hidden="true" />
          <Icon size={12} className="studio-detail-slot__icon" aria-hidden="true" />
          <span className="studio-detail-slot__label">{item.label}</span>
          <button
            type="button"
            className="studio-detail-slot__eye"
            aria-label={toggleTitle}
            title={toggleTitle}
            onClick={handleEyeClick}
          >
            {item.hidden ? (
              <EyeOff size={11} aria-hidden="true" />
            ) : (
              <Eye size={11} aria-hidden="true" />
            )}
          </button>
        </div>
        <div className="studio-detail-slot__visual">{children}</div>
      </div>
    );
  }

  return (
    <div
      id={`studio-item-${item.id}`}
      data-order-index={index}
      className={cardClasses}
      style={style}
      role="group"
      aria-label={item.label}
      title={toggleTitle}
      onPointerDown={onStartDrag}
      onClick={handleClick}
    >
      <div className="studio-detail-card__head">
        <GripVertical className="studio-detail-card__grip" size={11} aria-hidden="true" />
        <Icon size={12} className="studio-detail-card__icon" aria-hidden="true" />
        <span className="studio-detail-card__title">{item.label}</span>
        <button
          type="button"
          className="studio-preview__mini-badge studio-card-eye"
          aria-label={toggleTitle}
          title={toggleTitle}
          onClick={handleEyeClick}
        >
          {item.hidden ? (
            <EyeOff size={10} aria-hidden="true" />
          ) : (
            <Eye size={10} aria-hidden="true" />
          )}
        </button>
      </div>
      <div className="studio-detail-card__body">{children}</div>
    </div>
  );
}
