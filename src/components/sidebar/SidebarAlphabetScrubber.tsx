import { memo, useCallback } from "react";
import type { SidebarAlphabetScrubberProps } from "./types";

/**
 * SidebarAlphabetScrubber
 * ───────────────────────
 * Fast alphabetical jump index rail positioned on the right side of the games list.
 * Helps power users instantly jump to specific letter sections in large libraries.
 */
function SidebarAlphabetScrubberBase({
  availableLetters,
  activeLetter,
  onSelectLetter,
}: SidebarAlphabetScrubberProps) {
  const handleClick = useCallback(
    (letter: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onSelectLetter(letter);
    },
    [onSelectLetter]
  );

  if (availableLetters.length <= 3) return null;

  return (
    <aside className="sidebar-alphabet-scrubber" aria-label="Alphabetical index">
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
