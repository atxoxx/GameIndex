import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import type { SidebarAlphabetScrubberProps } from "./types";

/** Tallest a single letter row is allowed to get. */
const RAIL_ROW_MAX = 14;
/** Below this the glyphs turn into an unreadable smudge, so the rail hides. */
const RAIL_ROW_MIN = 7;
/** Rail's own vertical padding plus a little breathing room off the list edges. */
const RAIL_VERTICAL_INSET = 12;

/**
 * Height of one letter row for a rail inside a list viewport of
 * `availableHeight` pixels, or `0` when the viewport is too short to show
 * every letter legibly — the rail is hidden in that case rather than
 * overflowing its container and clipping the first letters.
 */
export function computeRailRowHeight(availableHeight: number, count: number): number {
  if (count <= 0) return 0;
  const usable = availableHeight - RAIL_VERTICAL_INSET;
  if (!Number.isFinite(usable) || usable <= 0) return 0;
  const row = Math.min(RAIL_ROW_MAX, usable / count);
  return row >= RAIL_ROW_MIN ? row : 0;
}

/**
 * SidebarAlphabetScrubber
 * ───────────────────────
 * Fast alphabetical jump index rail positioned on the right side of the games list.
 * Helps power users instantly jump to specific letter sections in large libraries.
 *
 * The number of letters grows with the library, so the rail measures the list
 * viewport (its parent) and spaces the letters to fit it exactly. That keeps
 * the rail centred on the list instead of the whole sidebar, where a tall
 * header or a short list used to shift and clip it.
 */
function SidebarAlphabetScrubberBase({
  availableLetters,
  activeLetter,
  onSelectLetter,
}: SidebarAlphabetScrubberProps) {
  const railRef = useRef<HTMLElement | null>(null);
  const letterCount = availableLetters.length;
  const [rowHeight, setRowHeight] = useState(RAIL_ROW_MAX);

  useLayoutEffect(() => {
    // The rail is absolutely positioned inside the list viewport, so its
    // parent is the box whose height it has to live within.
    const viewport = railRef.current?.parentElement;
    if (!viewport) return;

    const measure = () =>
      setRowHeight(computeRailRowHeight(viewport.clientHeight, letterCount));

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [letterCount]);

  const handleClick = useCallback(
    (letter: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onSelectLetter(letter);
    },
    [onSelectLetter]
  );

  if (letterCount <= 3) return null;

  return (
    <aside
      ref={railRef}
      className="sidebar-alphabet-scrubber"
      aria-label="Alphabetical index"
      hidden={rowHeight === 0}
      style={
        { "--rail-row": `${rowHeight || RAIL_ROW_MIN}px` } as React.CSSProperties
      }
    >
      {availableLetters.map((letter) => {
        const isActive = activeLetter === letter;
        return (
          <button
            key={letter}
            type="button"
            className={`sidebar-alphabet-scrubber__btn${isActive ? " active" : ""}`}
            onClick={(e) => handleClick(letter, e)}
            aria-label={`Jump to ${letter}`}
          >
            {letter}
          </button>
        );
      })}
    </aside>
  );
}

export const SidebarAlphabetScrubber = memo(SidebarAlphabetScrubberBase);
export default SidebarAlphabetScrubber;
