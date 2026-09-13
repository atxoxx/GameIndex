import type { ReactNode } from "react";
import { useWidgetVisible } from "../context/SettingsContext";
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
