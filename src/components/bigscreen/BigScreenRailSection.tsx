// BigScreenRailSection — the shared horizontal rail for Big Screen
// pages. One component, everywhere: Home's "Continue Playing", the
// Deals rails, any future spotlight-driven section must move the
// same way under the D-pad or the shell feels broken on one screen.
//
// Contract (matches library/BigScreenRail.tsx, minus game specifics):
//   • `<section data-rail-id="…">` marks the rail for the spatial-nav
//     engine, which keeps horizontal focus inside the track and wraps
//     end-to-start.
//   • When a card inside THIS rail gains focus the viewport nudges
//     the scroll position so the focused card lands ~25% from the
//     left edge.
//   • Left/right edge fades are rendered outside the scroll track so
//     they don't scroll with the cards.
//
// Cards stay fully owned by the caller through `renderItem` — that
// keeps each card component's focusable hooks unconditional (one
// hook instance per rendered component, no hook-in-map coupling).

import { useEffect, useRef, type ReactNode } from "react";
import { useGamepad } from "../../hooks/GamepadProvider";

export interface BigScreenRailSectionProps<T> {
  /** Stable rail identifier consumed by the spatial-nav engine. */
  railId: string;
  /** Rail title (already localized — plain string or node). */
  title: ReactNode;
  /** Optional icon glyph shown before the title. */
  icon?: ReactNode;
  /** Ordered items to render. */
  items: T[];
  /** Stable key for a card wrapper. */
  itemKey: (item: T, index: number) => string;
  /** Card factory — typically a component that owns its focusable. */
  renderItem: (item: T, index: number) => ReactNode;
  /** Extra node after the title (a count, a link, …). */
  headerRight?: ReactNode;
}

export default function BigScreenRailSection<T>({
  railId,
  title,
  icon,
  items,
  itemKey,
  renderItem,
  headerRight,
}: BigScreenRailSectionProps<T>) {
  const gamepad = useGamepad();
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ── Auto-scroll a focused card into view ─────────────────────
  // getBoundingClientRect is viewport-relative; anchoring both cards
  // and the track off genuine rects keeps this correct no matter how
  // deeply the track is nested inside the page's scroll regions.
  useEffect(() => {
    const el = gamepad.focusedElement;
    if (!el || !scrollRef.current) return;
    if (!scrollRef.current.contains(el)) return;
    const cardRect = el.getBoundingClientRect();
    const containerRect = scrollRef.current.getBoundingClientRect();
    const offsetWithinContainer =
      cardRect.left - containerRect.left + scrollRef.current.scrollLeft;
    const desiredLeft = containerRect.width * 0.25;
    const delta = offsetWithinContainer - desiredLeft;
    if (Math.abs(delta) > 8) {
      scrollRef.current.scrollTo({
        left: scrollRef.current.scrollLeft + delta,
        behavior: "smooth",
      });
    }
  }, [gamepad.focusedElement]);

  return (
    <section
      className="bigscreen-rail"
      aria-label={typeof title === "string" ? title : undefined}
      data-rail-id={railId}
    >
      <div className="bigscreen-rail-header">
        {icon ? (
          <span className="bigscreen-rail-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <h3 className="bigscreen-rail-title">{title}</h3>
        <span className="bigscreen-rail-count">{headerRight ?? `${items.length}`}</span>
      </div>

      <div className="bigscreen-rail-viewport">
        <div ref={scrollRef} className="bigscreen-rail-track" role="list">
          {items.map((item, index) => (
            <div
              key={itemKey(item, index)}
              role="listitem"
              className="bigscreen-rail-item"
            >
              {renderItem(item, index)}
            </div>
          ))}
        </div>
        <div className="bigscreen-rail-fade bigscreen-rail-fade--left" aria-hidden="true" />
        <div className="bigscreen-rail-fade bigscreen-rail-fade--right" aria-hidden="true" />
      </div>
    </section>
  );
}
