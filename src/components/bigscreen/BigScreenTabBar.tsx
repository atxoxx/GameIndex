// BigScreenTabBar — generic horizontal tab bar with LB/RB bumper
// hints, used as the tab navigation surface in PS5-style tabbed
// Game pages (Overview | Media | Specs | More).
//
// Why generic
// ───────────
// The same component powers the Big Screen Game page's tabs and
// other tabbed surfaces (Friends hub, Store detail). Each consumer
// defines its own tab id literal union, and the bar's `activeTab` +
// `onActivate` callbacks preserve end-to-end type safety — no
// stringly-typed `onActivate: (id: string)` casts at the call site.
//
// Controller contract
// ───────────────────
//   • LB/RB is handled by the page's own `registerTabCycler`; the bar
//     only mirrors the resulting `activeTab` (scrolls it into view and
//     parks focus on it) so the strip stays the visible anchor.
//   • A on a tab selects it. When the caller supplies `onEnterContent`
//     the same press also hands focus to the tab body, which is what a
//     console user expects: pick a tab, you are in it. The shell then
//     falls back to the tab itself if that body has nothing to focus.
//   • `railId` turns the strip into a spatial rail, so Left/Right cycles
//     the tabs (wrapping at the ends) instead of drifting diagonally.
//
// While mounted the bar declares the "tabs" bumper scope, so the shell's
// footer legend reads LB/RB TABS rather than the default SECTIONS.
//
// Accessibility
// ─────────────
// • `role="tablist"` on the container.
// • Each tab is `<button role="tab" aria-selected={isActive}>`.
// • A single `aria-label` describes the entire tablist (defaults to
//   "Tabs"). Individual tabs are labelled by their visible label.
// • Decorative LB/RB hints are `aria-hidden` so screen readers
//   don't announce "left bumper right bumper" on every focus move.

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { useLanguage } from "../../context/LanguageContext";
import { useFocusable } from "../../hooks/useFocusable";
import { useBumperScopeDeclaration } from "./bigscreenLegend";

export interface TabDef<T extends string> {
  /** Stable id used for `activeTab` + `onActivate` discrimination. */
  id: T;
  /** Visible label, rendered inside the tab button. */
  label: string;
  /** Optional leading icon (16-20 px SVG recommended). */
  icon?: ReactNode;
  /** Optional trailing count (achievements unlocked, sessions, …). */
  count?: number | null;
}

export interface BigScreenTabBarProps<T extends string> {
  tabs: TabDef<T>[];
  activeTab: T;
  /** Invoked when a tab is activated (click / A button on focused). */
  onActivate: (id: T) => void;
  /**
   * Optional. Called on the same press as `onActivate` when the user
   * commits to a tab (A / click), never on LB/RB. The owner moves focus
   * into the tab body — or back onto the tab when the body has nothing
   * focusable.
   */
  onEnterContent?: (id: T) => void;
  /**
   * Optional spatial-rail id for the tab strip. When set, Left/Right
   * cycles the tabs with edge wrapping and the strip reads as one rail.
   */
  railId?: string;
  /** Accessible label for the tablist. Defaults to "Tabs". */
  ariaLabel?: string;
  /** Optional className passthrough for context-specific tweaks. */
  className?: string;
}

export default function BigScreenTabBar<T extends string>({
  tabs,
  activeTab,
  onActivate,
  onEnterContent,
  railId,
  ariaLabel,
  className,
}: BigScreenTabBarProps<T>) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const didMountRef = useRef(false);
  const tablistLabel = ariaLabel ?? t("bigscreen.tabbar.tabs");

  useBumperScopeDeclaration("tabs");

  const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);
  const activeTabLabel = tabs[activeIndex]?.label ?? tablistLabel;

  useEffect(() => {
    if (!containerRef.current) return;
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    // Bumper navigation changes the active section without a click. Keep
    // the strip's visible anchor on the new tab so the next D-pad press
    // starts from the tab bar instead of an element of the old section.
    // The content-entry focus (A) is a later effect owned by the page, so
    // it still wins when both run in the same commit.
    const activeEl = containerRef.current.querySelector(
      `#bigscreen-tab-${activeTab}`
    ) as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
      activeEl.focus({ preventScroll: true });
    }
  }, [activeTab]);

  return (
    <div
      ref={containerRef}
      className={["bigscreen-tab-bar", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      role="tablist"
      aria-label={tablistLabel}
    >
      {/* Decorative LB chevron — visual affordance only. */}
      <span className="bigscreen-tab-bar-bumper bigscreen-tab-bar-bumper--lb" aria-hidden>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>LB</span>
      </span>

      <div
        className="bigscreen-tab-bar-tabs"
        data-rail-id={railId}
      >
        {tabs.map((tab) => (
          <BigScreenTabBarButton
            key={tab.id}
            tab={tab}
            isActive={activeTab === tab.id}
            onActivate={() => onActivate(tab.id)}
            onEnterContent={
              onEnterContent ? () => onEnterContent(tab.id) : undefined
            }
          />
        ))}
      </div>

      <div className="bigscreen-tab-bar-status" aria-live="polite">
        <strong>{activeTabLabel}</strong>
        <span>{activeIndex + 1} / {tabs.length}</span>
      </div>

      {/* Decorative RB chevron — visual affordance only. */}
      <span className="bigscreen-tab-bar-bumper bigscreen-tab-bar-bumper--rb" aria-hidden>
        <span>RB</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </div>
  );
}

function BigScreenTabBarButton<T extends string>({
  tab,
  isActive,
  onActivate,
  onEnterContent,
}: {
  tab: TabDef<T>;
  isActive: boolean;
  onActivate: () => void;
  onEnterContent?: () => void;
}) {
  // useFocusable reads the latest callback via a ref so the parent's
  // stale-closure footgun is eliminated. We destructure rather than
  // spreading so we can override the default "button" role with
  // role="tab" — spreading would TS-error on the duplicate-key warning
  // even though the later value wins.
  const { ref, tabIndex, onClick } = useFocusable(() => {
    onActivate();
    onEnterContent?.();
  });
  return (
    <button
      type="button"
      role="tab"
      id={`bigscreen-tab-${tab.id}`}
      aria-selected={isActive}
      aria-controls={`bigscreen-tabpanel-${tab.id}`}
      ref={ref}
      tabIndex={tabIndex}
      onClick={onClick}
      className={["bigscreen-tab-bar-tab", isActive ? "active" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {tab.icon ? (
        <span className="bigscreen-tab-bar-tab-icon" aria-hidden>
          {tab.icon}
        </span>
      ) : null}
      <span className="bigscreen-tab-bar-tab-label">{tab.label}</span>
      {typeof tab.count === "number" && tab.count > 0 ? (
        <span className="bigscreen-tab-bar-tab-count">{tab.count}</span>
      ) : null}
    </button>
  );
}
