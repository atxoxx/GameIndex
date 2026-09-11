import { useEffect, useRef, useState } from "react";
import { useLanguage } from "../../context/LanguageContext";

export type LibraryGroupBy = "none" | "platform" | "playStatus" | "genre" | "releaseYear" | "alphabetical";

interface LibraryGroupMenuProps {
  value: LibraryGroupBy;
  onChange: (g: LibraryGroupBy) => void;
  className?: string;
}

const GROUP_OPTIONS: readonly { value: LibraryGroupBy; labelKey: string }[] = [
  { value: "none", labelKey: "library.groupBy.none" },
  { value: "platform", labelKey: "library.groupBy.platform" },
  { value: "playStatus", labelKey: "library.groupBy.playStatus" },
  { value: "genre", labelKey: "library.groupBy.genre" },
  { value: "releaseYear", labelKey: "library.groupBy.releaseYear" },
  { value: "alphabetical", labelKey: "library.groupBy.alphabetical" },
];

const GROUP_ICONS: Record<LibraryGroupBy, React.ReactNode> = {
  none: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
    </svg>
  ),
  platform: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  playStatus: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polygon points="10 8 16 12 10 16 10 8" />
    </svg>
  ),
  genre: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
    </svg>
  ),
  releaseYear: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </svg>
  ),
  alphabetical: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" y1="20" x2="15" y2="20" />
      <line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  ),
};

/**
 * LibraryGroupMenu: compact dropdown for the library grouping mode. Mirrors
 * LibrarySortMenu so the two toolbar controls read as one family; closes on
 * outside click and Escape.
 */
export default function LibraryGroupMenu({
  value,
  onChange,
  className,
}: LibraryGroupMenuProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const activeOption = GROUP_OPTIONS.find((opt) => opt.value === value) ?? GROUP_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`lib-groupby${className ? " " + className : ""}`}>
      <button
        type="button"
        className={`lib-groupby-trigger${value !== "none" ? " has-value" : ""}${open ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={t("library.groupBy.label")}
      >
        <span className="lib-groupby-trigger-icon" aria-hidden="true">{GROUP_ICONS[value]}</span>
        <span className="lib-groupby-trigger-label">{t(activeOption.labelKey)}</span>
        <svg className="lib-groupby-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <ul className="lib-groupby-list" role="listbox" aria-label={t("library.groupBy.label")}>
          {GROUP_OPTIONS.map((opt) => (
            <li key={opt.value} role="option" aria-selected={opt.value === value}>
              <button
                type="button"
                className={`lib-groupby-option${opt.value === value ? " active" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span className="lib-groupby-option-icon" aria-hidden="true">{GROUP_ICONS[opt.value]}</span>
                <span>{t(opt.labelKey)}</span>
                {opt.value === value && (
                  <svg className="lib-groupby-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
