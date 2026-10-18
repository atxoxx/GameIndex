// BigScreenDesktopFallback — controller-safe chrome around a desktop
// page that has no dedicated Big Screen variant yet (saves manager,
// mods/discover).
//
// What this gives a couch user:
//   • The standard back header, so B / the back button navigate to the
//     parent section like on every other nested Big Screen page.
//   • A registered focusable scroll region wrapping the desktop
//     content: the spatial-nav engine always has a target inside the
//     content area, so the page is focusable with the D-pad and
//     drag-scrollable via the virtual cursor (Y pointer mode).
//
// What it deliberately does NOT do: re-engineer the desktop page's
// inner controls into focusable cards. Those renders are mouse-first;
// the virtual cursor is the interaction tool for them. A route gets a
// real controller-first layout when it gets its own Big Screen
// variant in the registry table.

import type { ReactNode } from "react";
import { useFocusable } from "../../hooks/useFocusable";
import { useLanguage } from "../../context/LanguageContext";
import BigScreenBackHeader from "./BigScreenBackHeader";

interface BigScreenDesktopFallbackProps {
  /** i18n key for the page title. */
  titleKey: string;
  /** Optional i18n key for the breadcrumb subtitle. */
  subtitleKey?: string;
  /** The desktop page render, dropped in as-is. */
  children: ReactNode;
}

export default function BigScreenDesktopFallback({
  titleKey,
  subtitleKey,
  children,
}: BigScreenDesktopFallbackProps) {
  const { t } = useLanguage();
  // Activation is a no-op on purpose: the field exists so the registry
  // always holds one navigable element in the content area, and so the
  // engine's controlled scrolling has an anchor element to keep in view.
  const scrollField = useFocusable(() => {});

  return (
    <div className="bigscreen-fallback-page">
      <BigScreenBackHeader title={t(titleKey)} subtitle={subtitleKey ? t(subtitleKey) : undefined} />
      <div className="bigscreen-fallback-scroll" {...scrollField}>
        {children}
      </div>
    </div>
  );
}
