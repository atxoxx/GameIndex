import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useSettings } from "../context/SettingsContext";
import {
  PAGE_WIDGET_KEYS,
  resolveInterfacePage,
  type PageWidgetKey,
} from "../context/interfaceLayout";

/**
 * PageLayoutBridge
 * ────────────────
 * Applies the Layout Studio's per-page widget settings to the live app.
 *
 * Per-page visibility and order are stored per page
 * (`gamelib.page_item_visibility` / `gamelib.page_item_order`), but only one
 * page is mounted at a time — so instead of writing one CSS rule per
 * page × widget, this bridge mirrors the *active* page's settings onto
 * `<html>`:
 *
 *   data-ui-page-hide="hero filters"   → theme.css hides those `.ui-item-*`
 *   --ui-ord-<widget>: <index>         → theme.css orders the page-level
 *                                        blocks (`data-ui-page-order`)
 *
 * The same attribute-driven approach as the existing global
 * `data-ui-hide-*` toggles, and it keeps the stylesheet static.
 *
 * Ordering is best-effort by design: only blocks that are direct children of
 * the page root participate (see the `> * >` selectors in theme.css), because
 * `order` needs a flex/grid parent. Hidden items — the main use case — work
 * everywhere their `.ui-item-*` marker appears.
 */
export default function PageLayoutBridge() {
  const location = useLocation();
  const { pageItemVisible, pageItemOrder } = useSettings();

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const page = resolveInterfacePage(location.pathname);
    const hiddenByPage = pageItemVisible[page] ?? {};
    const order = pageItemOrder[page];

    root.dataset.uiPage = page;

    const hidden = PAGE_WIDGET_KEYS.filter((key: PageWidgetKey) => hiddenByPage[key] === false);
    if (hidden.length > 0) root.dataset.uiPageHide = hidden.join(" ");
    else delete root.dataset.uiPageHide;

    if (order && order.length > 0) {
      root.dataset.uiPageOrder = "true";
      for (const key of PAGE_WIDGET_KEYS) {
        const index = order.indexOf(key);
        // Widgets the page renders but the user never reordered keep their
        // shipped relative position *after* the arranged ones.
        root.style.setProperty(
          `--ui-ord-${key}`,
          String(index === -1 ? order.length + PAGE_WIDGET_KEYS.indexOf(key) : index),
        );
      }
    } else {
      delete root.dataset.uiPageOrder;
      for (const key of PAGE_WIDGET_KEYS) root.style.removeProperty(`--ui-ord-${key}`);
    }

    return () => {
      delete root.dataset.uiPage;
      delete root.dataset.uiPageHide;
      delete root.dataset.uiPageOrder;
      for (const key of PAGE_WIDGET_KEYS) root.style.removeProperty(`--ui-ord-${key}`);
    };
  }, [location.pathname, pageItemVisible, pageItemOrder]);

  return null;
}
