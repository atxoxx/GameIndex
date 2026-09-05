import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

interface MultiSelectDropdownProps {
  /** Localized facet name (e.g. "Genres") — read out by screen readers. */
  label: string;
  /** Shown in the trigger when nothing is selected (e.g. "All"). */
  placeholder: string;
  /** Full ordered option list (display order is preserved). */
  options: readonly string[];
  /** Currently selected options. */
  selected: readonly string[];
  /** Called with the whole next selection on every toggle. */
  onChange: (next: string[]) => void;
  /** Optional localized "clear" action label — hides when omitted. */
  clearLabel?: string;
  /** Optional per-option live match counts rendered as badges. */
  counts?: Record<string, number>;
  /** Optional localized search input placeholder. */
  searchPlaceholder?: string;
  /** Optional localized message shown when the search matches nothing. */
  noResultsLabel?: string;
}

const GAP = 8;
const MAX_LIST_HEIGHT = 320;

const ChevronIcon = (
  <svg
    className="msd__chevron"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CheckIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const SearchIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

/**
 * MultiSelectDropdown — a compact multi-select facet control for filter
 * sidebars (replaces sprawling pill rows for Genres / Platforms).
 *
 * The menu is portaled to <body> and anchored with `position: fixed` so it
 * escapes the `overflow` clipping of accordion bodies and scrollable filter
 * rails; it flips above the trigger when there is no room below. Selection
 * is multi and the menu stays open while picking (like a checkbox list),
 * closing on trigger re-click, outside click, or Escape.
 */
export default function MultiSelectDropdown({
  label,
  placeholder,
  options,
  selected,
  onChange,
  clearLabel,
  counts,
  searchPlaceholder,
  noResultsLabel,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
    openUp: boolean;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rafRef = useRef<number | null>(null);

  const showSearch = options.length > 6;

  const recompute = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const spaceBelow = vh - rect.bottom - GAP;
    const spaceAbove = rect.top - GAP;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(120, Math.min(MAX_LIST_HEIGHT, openUp ? spaceAbove : spaceBelow));
    const width = Math.min(Math.max(rect.width, 220), vw - GAP * 2);
    const left = Math.max(GAP, Math.min(rect.left, vw - width - GAP));
    setPos((prev) => {
      const next = openUp
        ? { left, width, top: undefined as number | undefined, bottom: vh - rect.top + GAP, maxHeight, openUp }
        : { left, width, top: rect.bottom + GAP, bottom: undefined as number | undefined, maxHeight, openUp };
      if (
        prev &&
        prev.left === next.left &&
        prev.width === next.width &&
        prev.top === next.top &&
        prev.bottom === next.bottom &&
        prev.maxHeight === next.maxHeight &&
        prev.openUp === next.openUp
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const scheduleReposition = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      recompute();
    });
  }, [recompute]);

  const close = useCallback(() => setOpen(false), []);

  // Listeners while open: outside click, Escape, reposition on scroll/resize.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      // The menu is portaled to <body> and stops mousedown propagation
      // itself, so any other mousedown means a click outside.
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", scheduleReposition, true);
    window.addEventListener("resize", scheduleReposition);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", scheduleReposition, true);
      window.removeEventListener("resize", scheduleReposition);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [open, close, scheduleReposition]);

  // Fresh search each open + focus the box.
  useLayoutEffect(() => {
    if (!open) return;
    setQuery("");
    if (showSearch) {
      const id = requestAnimationFrame(() => searchRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open, showSearch]);

  const handleTriggerClick = useCallback(() => {
    if (!open) {
      recompute();
      setOpen(true);
    } else {
      close();
    }
  }, [open, recompute, close]);

  const toggle = useCallback(
    (value: string) => {
      onChange(
        selected.includes(value)
          ? selected.filter((v) => v !== value)
          : [...selected, value]
      );
    },
    [selected, onChange]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...options];
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? selected[0]
        : `${selected[0]} +${selected.length - 1}`;

  return (
    <div className="msd">
      <button
        ref={triggerRef}
        type="button"
        className={`msd__trigger${selected.length > 0 ? " has-value" : ""}${open ? " open" : ""}`}
        onClick={handleTriggerClick}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={open ? `${label}, ${summary}` : label}
      >
        <span className="msd__summary" title={summary}>
          {summary}
        </span>
        {ChevronIcon}
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            className={`msd__menu${pos.openUp ? " open-up" : ""}`}
            role="listbox"
            aria-multiselectable="true"
            aria-label={label}
            style={
              {
                position: "fixed",
                left: pos.left,
                width: pos.width,
                top: pos.top,
                bottom: pos.bottom,
                maxHeight: pos.maxHeight,
                // Above filter overlays / modals (--z-modal), below toasts.
                zIndex: "calc(var(--z-modal) + 2)",
              } as CSSProperties
            }
            onMouseDown={(e) => e.stopPropagation()}
          >
            {showSearch && (
              <div className="msd__search">
                {SearchIcon}
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder ?? placeholder}
                  aria-label={label}
                />
                {query && (
                  <button
                    type="button"
                    className="msd__search-clear"
                    onClick={() => {
                      setQuery("");
                      searchRef.current?.focus();
                    }}
                    aria-label={clearLabel ?? placeholder}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            )}

            <div className="msd__list">
              {filtered.map((option) => {
                const active = selected.includes(option);
                const count = counts ? counts[option] : undefined;
                return (
                  <button
                    key={option}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`msd__option${active ? " active" : ""}`}
                    onClick={() => toggle(option)}
                  >
                    <span className={`msd__check${active ? " checked" : ""}`} aria-hidden="true">
                      {active && CheckIcon}
                    </span>
                    <span className="msd__option-label">{option}</span>
                    {count != null && count > 0 && (
                      <span className="msd__option-count">{count}</span>
                    )}
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <div className="msd__empty">{noResultsLabel ?? placeholder}</div>
              )}
            </div>

            {clearLabel && selected.length > 0 && (
              <div className="msd__footer">
                <button type="button" className="msd__clear" onClick={() => onChange([])}>
                  {clearLabel}
                </button>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
