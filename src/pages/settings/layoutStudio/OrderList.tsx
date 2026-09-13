import { useCallback } from "react";
import { useLanguage } from "../../../context/LanguageContext";
import { useOrderDrag } from "../useOrderDrag";
import { StudioRow } from "./StudioRow";
import type { OrderListItem } from "./types";

export interface OrderListProps {
  label: string;
  items: OrderListItem[];
  onReorder?: (from: number, to: number) => void;
  onToggle: (id: string, hidden: boolean) => void;
  visibilityOnly?: boolean;
  highlightedId?: string | null;
  onHoverItem?: (id: string | null) => void;
}

export function OrderList({
  label,
  items,
  onReorder,
  onToggle,
  visibilityOnly,
  highlightedId,
  onHoverItem,
}: OrderListProps) {
  const { t } = useLanguage();
  const handleReorder = useCallback(
    (from: number, to: number) => onReorder?.(from, to),
    [onReorder],
  );
  const { containerRef, dragIndex, overIndex, startDrag } =
    useOrderDrag(handleReorder);
  const reorderable = !visibilityOnly && typeof onReorder === "function";

  return (
    <div className="studio-list" role="list" ref={containerRef} aria-label={label}>
      {items.map((item, index) => (
        <StudioRow
          key={item.id}
          id={item.id}
          index={index}
          icon={item.icon}
          label={item.label}
          hint={item.hint}
          hidden={item.hidden}
          isModified={item.isModified}
          isHighlighted={highlightedId === item.id}
          onHover={(hovering) => onHoverItem?.(hovering ? item.id : null)}
          onToggle={() => onToggle(item.id, !item.hidden)}
          onMove={
            reorderable
              ? (delta) => onReorder?.(index, index + delta)
              : undefined
          }
          onDragStart={reorderable ? () => startDrag(index) : undefined}
          isDragging={dragIndex === index}
          isDropTarget={overIndex === index && dragIndex !== null && dragIndex !== index}
          canMoveUp={index > 0}
          canMoveDown={index < items.length - 1}
        />
      ))}
      {items.length === 0 && (
        <p className="studio-list__empty">
          {t("settings.interface.studioPageItemsEmpty")}
        </p>
      )}
    </div>
  );
}
