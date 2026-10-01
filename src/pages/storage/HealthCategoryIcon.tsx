import type { ReactNode } from "react";
import type { HealthCategory } from "./health";

export type HealthTabId = "overview" | HealthCategory;

const GLYPHS: Record<HealthTabId, ReactNode> = {
  overview: (
    <>
      <path d="M12 20a8 8 0 1 0-8-8" />
      <path d="M12 12l5-3" />
      <circle cx="12" cy="12" r="1.5" />
      <path d="M4 12H2M12 4V2" />
    </>
  ),
  paths: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <line x1="10" y1="11" x2="14" y2="15" />
      <line x1="14" y1="11" x2="10" y2="15" />
    </>
  ),
  duplicates: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  metadata: (
    <>
      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </>
  ),
  artwork: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </>
  ),
  sizes: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </>
  ),
  backlog: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 14" />
    </>
  ),
};

interface Props {
  category: HealthTabId;
  className?: string;
}

/** Single inline-SVG source of truth for every health category glyph, used
 *  by both the tab rail and the overview cards so a category is visually
 *  identical wherever it appears. */
export function HealthCategoryIcon({ category, className }: Props) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {GLYPHS[category]}
    </svg>
  );
}
