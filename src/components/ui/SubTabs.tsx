import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export interface SubTabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  count?: number | null;
  /** Optional status indicator rendered after the label. */
  badge?: ReactNode;
  /** Extra classes for per-page hooks (layout widgets, visibility modes). */
  className?: string;
}

export interface SubTabsProps<T extends string = string> {
  items: SubTabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Accessible name for the tab list. */
  ariaLabel: string;
  /** Pins the strip under the top nav with a feathered scrim. */
  sticky?: boolean;
  /** Optional slot rendered at the far end of the strip. */
  trailing?: ReactNode;
  className?: string;
}

/**
 * SubTabs — the shared sub-navigation for every desktop route.
 *
 * Deliberately undelimited: labels sit directly in the page flow and the
 * only chrome is a single accent underline that slides between tabs. There
 * is no tray, no pill, no border — the strip reads as part of the page
 * rather than a control pasted on top of it.
 *
 * The strip scrolls itself horizontally instead of calling
 * `scrollIntoView`, which would also scroll `.app-main` and yank the page
 * back to the top whenever async tab counts resolve.
 */
export function SubTabs<T extends string = string>({
  items,
  value,
  onChange,
  ariaLabel,
  sticky = false,
  trailing,
  className,
}: SubTabsProps<T>) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [underline, setUnderline] = useState({ left: 0, width: 0, opacity: 0 });

  // `items` is commonly rebuilt inline, so the array identity changes every
  // render. Depend on a cheap signature instead: running the measure effect
  // on every identity change would set state in a render loop.
  const itemsSignature = items
    .map((item) => `${item.id}|${item.label}|${item.count ?? ""}`)
    .join("~");

  useEffect(() => {
    const strip = stripRef.current;
    const activeEl =
      tabRefs.current.get(value) ??
      (strip?.querySelector('[aria-selected="true"]') as HTMLButtonElement | null);
    if (!activeEl || !strip) return;

    const stripRect = strip.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    const targetLeft =
      strip.scrollLeft +
      (activeRect.left - stripRect.left) -
      (stripRect.width - activeRect.width) / 2;
    // jsdom has no scrollTo; fall back to the plain scroll offset there.
    if (typeof strip.scrollTo === "function") {
      strip.scrollTo({ left: targetLeft, behavior: "smooth" });
    } else {
      strip.scrollLeft = targetLeft;
    }

    const measure = () => {
      const nextStrip = strip.getBoundingClientRect();
      const nextActive = activeEl.getBoundingClientRect();
      const next = {
        left: nextActive.left - nextStrip.left + strip.scrollLeft,
        width: nextActive.width,
        opacity: 1,
      };
      setUnderline((prev) =>
        prev.left === next.left &&
        prev.width === next.width &&
        prev.opacity === 1
          ? prev
          : next,
      );
    };
    measure();
    const timer = window.setTimeout(measure, 150);
    // Web fonts and async counts resize tabs after mount; keep the underline
    // glued to the active label instead of trusting one early measurement.
    void document.fonts?.ready.then(measure).catch(() => {});
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(strip);
    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [value, itemsSignature]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const activeEl = tabRefs.current.get(value);
      if (!activeEl) return;
      const stripRect = strip.getBoundingClientRect();
      const activeRect = activeEl.getBoundingClientRect();
      const next = {
        left: activeRect.left - stripRect.left + strip.scrollLeft,
        width: activeRect.width,
        opacity: 1,
      };
      setUnderline((prev) =>
        prev.left === next.left && prev.width === next.width && prev.opacity === 1
          ? prev
          : next,
      );
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    window.addEventListener("resize", schedule);
    strip.addEventListener("scroll", schedule, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      strip.removeEventListener("scroll", schedule);
    };
  }, [value]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaX !== 0 || e.deltaY === 0) return;
      if (strip.scrollWidth <= strip.clientWidth) return;
      const atStart = strip.scrollLeft <= 0;
      const atEnd =
        strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 1;
      if ((e.deltaY < 0 && atStart) || (e.deltaY > 0 && atEnd)) return;
      e.preventDefault();
      strip.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    };

    strip.addEventListener("wheel", handleWheel, { passive: false });
    return () => strip.removeEventListener("wheel", handleWheel);
  }, []);

  const move = (delta: number) => {
    const index = items.findIndex((item) => item.id === value);
    if (index === -1) return;
    const next = items[(index + delta + items.length) % items.length];
    onChange(next.id);
    tabRefs.current.get(next.id)?.focus();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      onChange(items[0].id);
      tabRefs.current.get(items[0].id)?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      const last = items[items.length - 1];
      onChange(last.id);
      tabRefs.current.get(last.id)?.focus();
    }
  };

  return (
    <nav
      className={[
        "ui-subtabs",
        sticky ? "ui-subtabs--sticky" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={ariaLabel}
    >
      <div
        ref={stripRef}
        className="ui-subtabs__strip"
        role="tablist"
        onKeyDown={handleKeyDown}
      >
        <span
          className="ui-subtabs__underline"
          aria-hidden="true"
          style={{
            transform: `translateX(${underline.left}px)`,
            width: `${underline.width}px`,
            opacity: underline.opacity,
          }}
        />

        {items.map((item) => {
          const Icon = item.icon;
          const isActive = item.id === value;
          return (
            <button
              key={item.id}
              ref={(el) => {
                if (el) tabRefs.current.set(item.id, el);
                else tabRefs.current.delete(item.id);
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              className={[
                "ui-subtabs__tab",
                isActive ? "is-active" : "",
                item.className ?? "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onChange(item.id)}
            >
              {Icon && <Icon size={15} className="ui-subtabs__icon" />}
              <span className="ui-subtabs__label">{item.label}</span>
              {item.badge}
              {item.count !== undefined && item.count !== null && item.count > 0 && (
                <span className="ui-subtabs__count">{item.count}</span>
              )}
            </button>
          );
        })}
      </div>

      {trailing && <div className="ui-subtabs__trailing">{trailing}</div>}
    </nav>
  );
}

export default SubTabs;
