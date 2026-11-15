import { useEffect, useRef } from "react";
import {
  sourceInitials,
  type SourceNavEntry,
} from "./sourceNavigation";
import "../../styles/download-modal-sources.css";

/**
 * Horizontal source rail for the download modal: one aggregate pill for
 * every result, then a compact tab per built-in source, plus a visually
 * distinct bucket for grouped plugin results. Purely presentational —
 * filtering stays with the caller.
 */
export function SourceNavigator({
  entries,
  activeSource,
  onSelect,
  totalCount,
  className,
  ariaLabel,
}: {
  entries: SourceNavEntry[];
  activeSource: string;
  onSelect: (id: string) => void;
  totalCount: number;
  className?: string;
  ariaLabel?: string;
}) {
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());

  // Keep the selected tab visible when the active source changes (or the
  // rail narrows), without ever scrolling the modal/page itself.
  useEffect(() => {
    const node = itemRefs.current.get(activeSource);
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [activeSource, entries.length]);

  if (entries.length <= 1) return null;

  const rootClassName = className ? `dlm-sources ${className}` : "dlm-sources";

  return (
    <div
      className={rootClassName}
      role="group"
      aria-label={ariaLabel}
    >
      <div className="dlm-sources-rail">
        {entries.map((entry) => {
          const active = entry.id === activeSource;
          const count = entry.provider === "all" ? totalCount : entry.count;
          const classes = [
            "dlm-sources-tab",
            active ? "is-active" : "",
            entry.provider === "plugin" ? "is-plugin" : "",
            entry.available === false ? "is-unavailable" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={entry.id}
              ref={(node) => {
                if (node) itemRefs.current.set(entry.id, node);
                else itemRefs.current.delete(entry.id);
              }}
              type="button"
              className={classes}
              aria-pressed={active}
              title={entry.label}
              onClick={() => onSelect(entry.id)}
            >
              <span className="dlm-sources-mark" aria-hidden>
                {entry.provider === "all" ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    focusable="false"
                  >
                    <rect x="3" y="3" width="7" height="7" rx="1.6" />
                    <rect x="14" y="3" width="7" height="7" rx="1.6" />
                    <rect x="3" y="14" width="7" height="7" rx="1.6" />
                    <rect x="14" y="14" width="7" height="7" rx="1.6" />
                  </svg>
                ) : entry.provider === "plugin" ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    focusable="false"
                  >
                    <path d="M9 2v6" />
                    <path d="M15 2v6" />
                    <path d="M6 8h12v3a6 6 0 0 1-12 0z" />
                    <path d="M12 17v5" />
                  </svg>
                ) : (
                  sourceInitials(entry.label)
                )}
              </span>
              <span className="dlm-sources-label">{entry.label}</span>
              <span className="dlm-sources-count">{count.toLocaleString()}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
