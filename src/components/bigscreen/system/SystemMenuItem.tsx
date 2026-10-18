// SystemMenuItem — one row in the System hub's left-menu tablist.
// Owns its focusable registration (rules-of-hooks safety) and carries
// the aria-selected state LB/RB cycles through.

import { useFocusable } from "../../../hooks/useFocusable";
import type { ReactNode } from "react";

export interface SystemMenuItemData {
  id: string;
  label: string;
  icon: ReactNode;
}

export default function SystemMenuItem({
  item,
  isActive,
  onSelect,
}: {
  item: SystemMenuItemData;
  isActive: boolean;
  onSelect: () => void;
}) {
  const focusProps = useFocusable(onSelect);

  return (
    <button
      type="button"
      aria-selected={isActive}
      className={`bigscreen-system-menu-item ${isActive ? "active" : ""}`}
      {...focusProps}
    >
      <span className="menu-item-icon">{item.icon}</span>
      <span className="menu-item-label">{item.label}</span>
    </button>
  );
}
