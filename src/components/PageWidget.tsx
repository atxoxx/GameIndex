import type { CSSProperties, ReactNode } from "react";
import { usePageWidgetOrder, useWidgetVisible } from "../context/SettingsContext";
import type { InterfacePageKey, PageWidgetKey } from "../context/interfaceLayout";

interface PageWidgetProps {
  /** Page key that owns the widget. */
  page: InterfacePageKey;
  /** Widget category, matching the element's `ui-item-*` marker. */
  widget: PageWidgetKey;
  children: ReactNode;
}

/**
 * PageWidget
 * ──────────
 * Mounts its children only while the Layout Studio keeps the widget visible.
 * Hiding a widget unmounts it — no effects, subscriptions or fetches run for an
 * element the user switched off.
 *
 * The component renders children directly (a fragment) so it never adds a DOM
 * node: the `.ui-item-*` element stays the direct child of its parent, which
 * keeps the `order`-based layout in theme.css working unchanged.
 */
export default function PageWidget({ page, widget, children }: PageWidgetProps) {
  return useWidgetVisible(page, widget) ? <>{children}</> : null;
}

interface PageWidgetSlotProps {
  page: InterfacePageKey;
  widget: PageWidgetKey;
  /** Element class, e.g. `"ui-item-gameInfoKpi"` (may include `ui-complete-only`). */
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * PageWidgetSlot
 * ──────────────
 * The single-card counterpart of `PageWidget`: it wraps one card in its own
 * `.ui-item-*` element and applies the per-page `order` inline, so individually
 * reordered/hidden side-column cards lay out correctly. It renders nothing
 * when the widget is switched off.
 */
export function PageWidgetSlot({ page, widget, className, style, children }: PageWidgetSlotProps) {
  const visible = useWidgetVisible(page, widget);
  const order = usePageWidgetOrder(page, widget);
  if (!visible) return null;
  return (
    <div className={className} style={order === undefined ? style : { ...style, order }}>
      {children}
    </div>
  );
}
